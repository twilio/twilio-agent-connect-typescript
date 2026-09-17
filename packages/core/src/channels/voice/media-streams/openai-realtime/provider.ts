import type { WebSocket } from 'ws';
import type { TACConfig } from '../../../../lib/config';
import {
  InitiateVoiceConversationOptionsOpenAIRealtimeSchema,
  StreamStartMessageSchema,
  callOptionsToCreateParams,
  type ConversationId,
  type ConversationSession,
  type InitiateVoiceConversationOptions,
  type InitiateVoiceConversationOptionsOpenAIRealtime,
} from '../../../../types/index';
import type { InitiateVoiceConversationResult } from '../../../../types/conversation';
import { maskPhone, redactTwimlParameters } from '../../../../util/log-redaction';
import type { VoiceChannel } from '../../channel';
import {
  MediaStreamsOpenAIProvider,
  OPENAI_USER_AGENT,
  describeIssues,
} from '../shared/openai-provider';
import type { OpenAIRealtimeProviderConfig } from './config';
import { CallState } from './state';

/**
 * Reserved `<Stream>` custom parameter used to correlate an outbound call's
 * `sessionConfig` override to its WebSocket `start` event.
 *
 * Why a token instead of the call SID: `calls.create()` returning `call.sid`
 * does not happen-before Twilio connecting the media stream, so the SID is not
 * yet a usable correlation key when the `start` event may already be arriving.
 * The token is embedded in the TwiML before the call is placed, so it always
 * is.
 */
const SESSION_CONFIG_TOKEN_PARAM = '_tac_session_config_token';

/**
 * The audio format both directions of a call must use.
 *
 * Twilio Media Streams always sends and expects 8kHz G.711 u-law — see
 * https://www.twilio.com/docs/voice/media-streams/websocket-messages. Not
 * configurable. No `rate` key: Realtime's `session.audio.*.format` schema
 * rejects it as unknown, since g711 is inherently fixed-rate.
 */
export const TWILIO_AUDIO_FORMAT_FOR_REALTIME = { type: 'audio/pcmu' } as const;

/**
 * G.711 u-law at 8kHz is 1 byte per sample, 8000 samples/sec — a fixed,
 * non-configurable rate, so an audio byte count converts to milliseconds by
 * this constant alone, whatever the session config says.
 */
const PCMU_BYTES_PER_MS = 8;

/**
 * Whether `value` is exactly {@link TWILIO_AUDIO_FORMAT_FOR_REALTIME}.
 *
 * Compared field by field rather than by serializing both sides, so key order
 * in a caller's session config can't decide the answer.
 */
function isTwilioMediaStreamAudioFormat(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const expected: Record<string, unknown> = TWILIO_AUDIO_FORMAT_FOR_REALTIME;
  const actual = value as Record<string, unknown>;
  const keys = Object.keys(actual);
  return (
    keys.length === Object.keys(expected).length && keys.every(key => actual[key] === expected[key])
  );
}

/**
 * A {@link VoiceProvider} bridging Twilio Media Streams to OpenAI's Realtime
 * API.
 *
 * Twilio streams call audio to TAC's own WebSocket via `<Connect><Stream>`, and
 * this provider relays it to and from a second WebSocket it opens to OpenAI's
 * Realtime API.
 *
 * ```ts
 * const channel = new VoiceChannel(
 *   tac,
 *   new OpenAIRealtimeProviderConfig({ defaultSessionConfig: { instructions: '...' } })
 * );
 * ```
 */
export class OpenAIRealtimeProvider extends MediaStreamsOpenAIProvider<CallState> {
  /**
   * The Realtime-specific config this provider was built with.
   *
   * `declare`: `target: ES2022` implies `useDefineForClassFields`, so a plain
   * redeclaration would emit a field definition that runs after `super()` and
   * overwrite the value the base constructor assigned with `undefined`. This
   * exists only to narrow the base's `MediaStreamsOpenAIProviderConfig` to the
   * Realtime shape `connectModel` reads `welcomeGreetingResponse` from.
   *
   * No `override`: TypeScript rejects it alongside `declare` (TS1243), and
   * `noImplicitOverride` does not require it for a `declare`d field.
   */
  declare protected readonly config: OpenAIRealtimeProviderConfig;

  constructor(channel: VoiceChannel, tacConfig: TACConfig, config: OpenAIRealtimeProviderConfig) {
    super(channel, tacConfig, config);
  }

  public override get channelName(): string {
    return 'VOICE_MEDIA_STREAM_OPENAI_REALTIME';
  }

  // =========================================================================
  // Outbound Call Handling
  // =========================================================================

  /**
   * Initiate an outbound voice conversation.
   *
   * Places an outbound call with inline TwiML that connects to a Media Stream.
   * Unlike inbound, there is no local session yet at this point — one is
   * created when Twilio's WebSocket `start` event arrives.
   *
   * TwiML fields are merged per-field — see
   * {@link TwiMLBuilderMediaStreams.build}. The WebSocket URL is derived from
   * `TACConfig.voicePublicDomain` + `TACConfig.voiceWebsocketPath` unless
   * overridden per-call via `options.websocketUrl`.
   *
   * Pass `InitiateVoiceConversationOptionsOpenAIRealtime` with `sessionConfig`
   * set to override `OpenAIRealtimeProviderConfig.defaultSessionConfig` for
   * this call.
   *
   * @param options - Outbound call options, validated in full against
   *   `InitiateVoiceConversationOptionsOpenAIRealtimeSchema`.
   * @throws {TypeError} if `options` is not a valid
   *   `InitiateVoiceConversationOptionsOpenAIRealtime` — including an unknown
   *   key, a missing `to`, or a `twimlOptions` that is not a
   *   `VoiceTwiMLOptionsMediaStreams`.
   * @throws {Error} if no WebSocket URL can be resolved — neither
   *   `options.websocketUrl` nor any TwiML layer sets one and
   *   `TACConfig.voicePublicDomain` is unset.
   */
  public override async initiateOutboundConversation(
    options: InitiateVoiceConversationOptions | InitiateVoiceConversationOptionsOpenAIRealtime
  ): Promise<InitiateVoiceConversationResult> {
    // Validate the whole options object, not just twimlOptions: this is the
    // only gate between a host's input and `calls.create()`, and it's what
    // makes the schema's `.strict()` upgrade guard fire for this provider.
    const parsedOptions = InitiateVoiceConversationOptionsOpenAIRealtimeSchema.safeParse(options);
    if (!parsedOptions.success) {
      throw new TypeError(
        'OpenAIRealtimeProvider.initiateOutboundConversation requires options to be an ' +
          `InitiateVoiceConversationOptionsOpenAIRealtime: ${describeIssues(
            parsedOptions.error.issues
          )}`
      );
    }
    const validated = parsedOptions.data;
    let twimlOptions = validated.twimlOptions;

    // The token embedded in the TwiML below — not `call.sid` — correlates this
    // override to its WebSocket `start` event; see SESSION_CONFIG_TOKEN_PARAM.
    // Minting it here touches nothing shared: the map is only written once the
    // TwiML has been built, so a `build()` failure has nothing to leak.
    const sessionConfig = validated.sessionConfig ?? null;
    let sessionConfigToken: string | null = null;
    if (sessionConfig !== null) {
      sessionConfigToken = crypto.randomUUID().replace(/-/g, '');
      // Rebuilt rather than mutated because `twimlOptions` is absent whenever
      // the caller omitted it — there is no object to assign the token into.
      twimlOptions = {
        ...twimlOptions,
        customParameters: {
          ...twimlOptions?.customParameters,
          [SESSION_CONFIG_TOKEN_PARAM]: sessionConfigToken,
        },
      };
    }

    const fromNumber = this.tacConfig.phoneNumber;

    this.logger.info(
      { to: maskPhone(validated.to), from: maskPhone(fromNumber) },
      'Initiating outbound voice conversation'
    );

    // Outbound has no inbound customizer and no host layer; the per-call
    // override is options.twimlOptions. `options.websocketUrl` is the dedicated
    // per-call outbound override and wins over any websocketUrl that came
    // through the layered twimlOptions merge.
    const twiml = this.twimlBuilder.build('initiateOutboundConversation', {
      perCall: twimlOptions,
      websocketUrl: validated.websocketUrl,
    });

    const callParams = this.applyCallEventCallbacks(
      validated.callOptions ? callOptionsToCreateParams(validated.callOptions) : {}
    );

    if (sessionConfigToken !== null && sessionConfig !== null) {
      this.pendingSessionConfigs.set(sessionConfigToken, sessionConfig);
    }

    try {
      // The inline TwiML handed to Twilio. customParameters values are masked —
      // they're arbitrary developer data (profile IDs, caller names), unlike the
      // WebSocket URL.
      this.logger.debug(
        { twiml: redactTwimlParameters(twiml), to: maskPhone(validated.to) },
        'Outbound call TwiML'
      );

      const client = this.channel.getTwilioClientInternal();
      const call = await client.calls.create({
        to: validated.to,
        from: fromNumber,
        twiml,
        ...callParams,
      });

      this.logger.info(
        { call_sid: call.sid, to: maskPhone(validated.to) },
        'Outbound voice call placed'
      );

      return { callSid: call.sid };
    } catch (error) {
      if (sessionConfigToken !== null) {
        this.pendingSessionConfigs.delete(sessionConfigToken);
      }
      this.logger.error(
        { err: error, to: maskPhone(validated.to) },
        'Failed to initiate outbound call'
      );
      // Deliberately not routed through `channel.handleErrorInternal`, unlike
      // ConversationRelayProvider: this matches the Python SDK, where an
      // outbound failure is the caller's to handle and is surfaced only by the
      // rethrow below.
      throw error;
    }
  }

  // =========================================================================
  // Audio Bridge
  // =========================================================================

  /**
   * Drive one Twilio Media Stream connection from `start` to disconnect.
   *
   * Twilio's `start` event names the call, which opens the matching OpenAI
   * Realtime socket; from then on caller audio is relayed to the model and the
   * model's audio back to Twilio, until either side goes away. Whichever leg
   * closes first takes the other down with it, so a caller is never left
   * connected to silence.
   *
   * Twilio streams audio without waiting for the OpenAI socket to finish
   * connecting, so audio that arrives during that handshake is held and
   * forwarded, in order, once the model is ready — a caller who speaks the
   * instant the call connects is heard in full.
   *
   * Called by `VoiceChannel.handleWebSocketConnection`; hosts serve the socket
   * rather than calling this directly.
   *
   * @param ws - The accepted Twilio-facing WebSocket.
   */
  public override handleWebSocket(ws: WebSocket): void {
    let conversationId: ConversationId | null = null;

    ws.on('message', (data: Buffer) => {
      // `EventEmitter` invokes this later with nothing awaiting it, so an async
      // body's rejection would surface as an unhandled rejection. Own it here.
      void (async (): Promise<void> => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        const event = typeof message.event === 'string' ? message.event : '';

        if (event === 'start') {
          try {
            const registered = this.registerCall(message.start, ws);
            conversationId = registered.conversationId;
            // Published on the call before the first `await`, so caller audio
            // arriving mid-handshake always finds something to wait on.
            // Mapped to a boolean so waiting frames observe the outcome
            // without re-raising the failure handled below.
            const connecting = this.connectModel(registered.conversationId);
            registered.call.modelReady = connecting.then(
              () => true,
              () => false
            );
            await connecting;
          } catch (err) {
            // No model, no bridge: closing the Twilio socket ends the call
            // instead of holding the caller on an open line to nothing.
            this.logger.error(
              { err, conversation_id: conversationId },
              'Failed to bridge the call to OpenAI Realtime, ending the call'
            );
            ws.close();
          }
        } else if (event === 'media') {
          const media = (message.media ?? {}) as Record<string, unknown>;
          const payload = media.payload;
          if (conversationId !== null && typeof payload === 'string' && payload) {
            // Twilio does not wait for the OpenAI handshake before streaming,
            // so hold this frame until the model socket exists instead of
            // discarding the caller's first word. See `CallState.modelReady`
            // for why ordering survives the wait.
            const call = this.calls.get(conversationId);
            if (call === undefined) {
              return;
            }
            if (call.modelReady !== null && !(await call.modelReady)) {
              // The handshake failed and the `start` branch above has already
              // logged it and ended the call. Drop the frame without comment.
              return;
            }
            this.modelSend(conversationId, {
              type: 'input_audio_buffer.append',
              audio: payload,
            });
          }
        } else if (event === 'stop') {
          this.logger.info({ conversation_id: conversationId }, 'Media stream stopped');
          if (conversationId !== null) {
            await this.cleanupCall(conversationId);
          }
          // Python returns from its endpoint here, which drops the connection;
          // an event handler has no such exit, so close the leg explicitly.
          ws.close();
        }
      })().catch((err: unknown) => {
        this.logger.error(
          { err, conversation_id: conversationId },
          'Unhandled error in Media Stream message handler'
        );
      });
    });

    ws.on('close', () => {
      this.logger.info({ conversation_id: conversationId }, 'Media stream WebSocket closed');
      if (conversationId !== null) {
        void this.cleanupCall(conversationId).catch((err: unknown) => {
          this.logger.error({ err, conversation_id: conversationId }, 'Call cleanup error');
        });
      }
    });

    ws.on('error', (error: Error) => {
      // Routed to the host, unlike the outbound-call failure above: that one is
      // rethrown, so its caller already sees it. A socket error has no caller
      // to rethrow to, so logging alone would hide it from the host entirely.
      this.channel.handleErrorInternal(error, { conversationId });
    });
  }

  /**
   * Handle Twilio's `start` event: track the call and open its session.
   *
   * @param start - The event's `start` body, parsed against
   *   `StreamStartMessageSchema`.
   * @param ws - The Twilio-facing socket this call arrived on.
   * @returns The conversation id — which is the call SID — and the call's
   *   freshly tracked transport state.
   */
  private registerCall(
    start: unknown,
    ws: WebSocket
  ): { conversationId: ConversationId; call: CallState } {
    const message = StreamStartMessageSchema.parse(start ?? {});
    const conversationId = message.callSid as ConversationId;

    // This call's Media Stream connected, so an inbound override stashed when
    // the TwiML was answered is about to be consumed — stop its expiry timer.
    // A no-op for outbound calls, which arm no such timer.
    this.cancelInboundConfigExpiry(conversationId);

    // An outbound override was stashed under a token before the call was
    // placed, because its SID wasn't known yet. Twilio hands the token back
    // here, which is the first point the two can be joined up.
    const token = message.customParameters[SESSION_CONFIG_TOKEN_PARAM];
    if (token !== undefined) {
      const pending = this.pendingSessionConfigs.get(token);
      if (pending !== undefined) {
        this.pendingSessionConfigs.delete(token);
        this.pendingSessionConfigs.set(conversationId, pending);
      }
    }

    try {
      // No profile id: this provider's session lifecycle is independent of
      // Conversation Orchestrator, like ConversationRelay's relay-only mode.
      const session = this.channel.startConversationInternal(conversationId);
      session.callSid = message.callSid;
      session.metadata.streamSid = message.streamSid;
      session.metadata.transcript = [];
    } catch (err) {
      // startConversationInternal inserts the session before invoking the
      // host's onConversationStarted callback unguarded. A throw from that
      // callback unwinds registerCall before handleWebSocket has learned the
      // conversation id, so its catch path can't reach it. Roll back the
      // pending config just re-keyed under this id and the started session.
      // The `calls` entry is tracked below, after this point, so there is
      // nothing to remove there yet.
      this.pendingSessionConfigs.delete(conversationId);
      void this.channel.endConversationInternal(conversationId).catch(() => undefined);
      throw err;
    }

    // Tracked last, once nothing else here can throw: startConversationInternal
    // invokes the host's onConversationStarted callback unguarded, and a throw
    // would leave the caller of this method without the id needed to reclaim
    // the entry, stranding a dead socket in `calls` forever.
    const call = new CallState();
    call.twilioWs = ws;
    this.calls.set(conversationId, call);

    this.logger.debug(
      { conversation_id: conversationId, media_format: message.mediaFormat },
      'Media stream started'
    );
    return { conversationId, call };
  }

  /**
   * Open this call's OpenAI Realtime socket and send its session config.
   *
   * @internal
   */
  public async connectModel(conversationId: ConversationId): Promise<void> {
    const sessionConfig = this.resolveSessionConfig(conversationId);

    const modelWs = await this.openModelSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(String(sessionConfig.model))}`,
      {
        Authorization: `Bearer ${this.config.openaiApiKey}`,
        'User-Agent': OPENAI_USER_AGENT,
      }
    );

    const call = this.calls.get(conversationId);
    if (call === undefined) {
      // The call ended while the handshake was in flight. Nothing tracks this
      // socket now, so close it rather than leak it.
      modelWs.close();
      return;
    }
    call.modelWs = modelWs;
    this.attachModelHandlers(conversationId, modelWs);
    this.logger.info({ conversation_id: conversationId }, 'Connected to OpenAI Realtime');

    this.modelSend(conversationId, { type: 'session.update', session: sessionConfig });

    // Server VAD waits for the caller to speak first, so without an explicit
    // response request an outbound call opens on silence.
    if (this.config.welcomeGreetingResponse !== undefined) {
      this.modelSend(conversationId, {
        type: 'response.create',
        response: this.config.welcomeGreetingResponse,
      });
    }
  }

  /**
   * The validated session config for this call: its own stashed override if it
   * has one, else the channel-wide default.
   *
   * @throws {Error} if neither exists, if it has no `model`, or if either audio
   *   direction is set to a format Twilio can't carry.
   */
  private resolveSessionConfig(conversationId: ConversationId): Record<string, unknown> {
    const sessionConfig =
      this.pendingSessionConfigs.get(conversationId) ?? this.config.defaultSessionConfig;
    this.pendingSessionConfigs.delete(conversationId);

    if (sessionConfig === undefined) {
      throw new Error(
        `No sessionConfig available for call ${conversationId} — this call supplied none ` +
          "and defaultSessionConfig isn't set either."
      );
    }
    if (!sessionConfig.model) {
      throw new Error(
        `sessionConfig for call ${conversationId} must include a 'model' field — it's used ` +
          'as the ?model= query param when opening the OpenAI Realtime WebSocket.'
      );
    }

    const audio = (sessionConfig.audio ?? {}) as Record<string, unknown>;
    for (const direction of ['input', 'output'] as const) {
      const format = ((audio[direction] ?? {}) as Record<string, unknown>).format;
      if (!isTwilioMediaStreamAudioFormat(format)) {
        throw new Error(
          `sessionConfig for call ${conversationId} has audio.${direction}.format=` +
            `${JSON.stringify(format)}, expected ` +
            `${JSON.stringify(TWILIO_AUDIO_FORMAT_FOR_REALTIME)}. Twilio Media Streams is ` +
            `always 8kHz G.711 u-law; set audio.${direction}.format to ` +
            `TWILIO_AUDIO_FORMAT_FOR_REALTIME.`
        );
      }
    }

    return sessionConfig;
  }

  /**
   * Wire up the model socket: dispatch its events, and tear the call down when
   * it goes away.
   *
   * The Python SDK races its two read loops so the Twilio leg dies with the
   * model leg; `ws` is event-driven, so the same guarantee is a close/error
   * handler instead. Python's sequential read loop also handles each model
   * event to completion before reading the next, which `ws` does not — see
   * {@link CallState.modelEvents} for the chain that restores it.
   */
  private attachModelHandlers(conversationId: ConversationId, modelWs: WebSocket): void {
    modelWs.on('message', (raw: Buffer | string) => {
      const call = this.calls.get(conversationId);
      if (call === undefined) {
        return;
      }
      // `handleModelMessage` swallows its own failures, so the chain cannot
      // reject; the catch keeps one escaped bug from poisoning the tail and
      // silently dropping every event after it.
      call.modelEvents = call.modelEvents
        .then(() => this.handleModelMessage(conversationId, raw))
        .catch((err: unknown) => {
          this.logger.error(
            { err, conversation_id: conversationId },
            'Unhandled error in model message handler'
          );
        });
    });

    modelWs.on('close', () => {
      // Still tracked means the model leg went first and closed cleanly: an
      // ordinary Twilio `stop` has already run cleanup, which closed this
      // socket itself, and a model-socket error has already logged itself.
      if (this.calls.has(conversationId)) {
        this.logger.info({ conversation_id: conversationId }, 'Model connection ended');
      }
      this.endCallFromModel(conversationId);
    });

    modelWs.on('error', (error: Error) => {
      this.logger.error({ err: error, conversation_id: conversationId }, 'Model socket error');
      this.endCallFromModel(conversationId);
    });
  }

  /**
   * Hang up the Twilio leg because the model leg is gone, then clean up. A
   * no-op once the call has already been cleaned up, so both the model socket's
   * `close` and its `error` can call it.
   */
  private endCallFromModel(conversationId: ConversationId): void {
    this.calls.get(conversationId)?.twilioWs?.close();
    void this.cleanupCall(conversationId).catch((err: unknown) => {
      this.logger.error({ err, conversation_id: conversationId }, 'Call cleanup error');
    });
  }

  /** Apply one parsed OpenAI Realtime event to the call. */
  protected override async dispatchModelEvent(
    conversationId: ConversationId,
    session: ConversationSession,
    event: Record<string, unknown>
  ): Promise<void> {
    const call = this.calls.get(conversationId);
    if (call === undefined) {
      return;
    }
    const bargeIn = call.bargeIn;

    switch (event.type) {
      case 'error': {
        const error = (event.error ?? {}) as Record<string, unknown>;
        if (error.code === 'response_cancel_not_active') {
          // Benign race: a `response.cancel` sent while a response was in
          // flight lost to the model's own `response.done`. There is nothing
          // left to cancel, which is exactly what was wanted.
          this.logger.debug(
            { conversation_id: conversationId, error },
            'response.cancel raced response.done'
          );
        } else {
          this.logger.error(
            { conversation_id: conversationId, error },
            'OpenAI Realtime error event'
          );
        }
        break;
      }

      case 'input_audio_buffer.speech_started': {
        this.logger.debug({ conversation_id: conversationId }, 'Caller speech detected (VAD)');
        this.handleBargeIn(conversationId, session, call);
        break;
      }

      case 'response.created': {
        bargeIn.responseActive = true;
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        if (typeof event.transcript === 'string' && event.transcript) {
          this.appendTranscript(session, 'user', event.transcript);
        }
        break;
      }

      case 'response.output_item.done': {
        // Fires per item, ahead of `response.done`, for lower tool-call
        // latency. Only "completed" calls are run: one cut short by an
        // interruption can carry a truncated `arguments` fragment.
        const item = (event.item ?? {}) as Record<string, unknown>;
        if (item.type === 'function_call' && item.status === 'completed') {
          await this.handleFunctionCall(conversationId, item);
        }
        break;
      }

      case 'response.done': {
        // `lastAssistantItem` stays set — the model generates faster than
        // realtime, so Twilio may still be playing this reply. `responseActive`
        // clears, though: there is nothing left to cancel.
        bargeIn.responseActive = false;
        const response = (event.response ?? {}) as Record<string, unknown>;
        const output = Array.isArray(response.output) ? response.output : [];
        for (const entry of output as Record<string, unknown>[]) {
          if (entry.role !== 'assistant') {
            continue;
          }
          const contents = Array.isArray(entry.content) ? entry.content : [];
          for (const content of contents as Record<string, unknown>[]) {
            if (typeof content.transcript === 'string' && content.transcript) {
              this.appendTranscript(session, 'assistant', content.transcript);
            }
          }
        }
        break;
      }

      case 'response.output_audio.delta': {
        const delta = event.delta;
        if (typeof delta !== 'string' || !delta) {
          break;
        }
        const itemId = typeof event.item_id === 'string' ? event.item_id : '';
        if (itemId && itemId === bargeIn.mutedItemId) {
          // Stale audio for an item already truncated by a barge-in.
          break;
        }
        if (itemId && itemId !== bargeIn.lastAssistantItem) {
          bargeIn.lastAssistantItem = itemId;
          bargeIn.currentItemAudioMs = 0;
        }
        bargeIn.currentItemAudioMs += Math.floor(
          Buffer.from(delta, 'base64').length / PCMU_BYTES_PER_MS
        );
        this.twilioSend(conversationId, {
          event: 'media',
          streamSid: session.metadata.streamSid,
          media: { payload: delta },
        });
        break;
      }

      default:
        break;
    }
  }

  /** Record one turn on the session's running transcript. */
  private appendTranscript(session: ConversationSession, role: string, text: string): void {
    const existing = session.metadata.transcript;
    const transcript = Array.isArray(existing) ? (existing as Record<string, string>[]) : [];
    if (transcript !== existing) {
      session.metadata.transcript = transcript;
    }
    transcript.push({ role, text });
  }

  /**
   * The caller started talking. Cancel any response still generating, truncate
   * the model's memory of the last reply at the point actually heard, then
   * clear Twilio's buffered audio so playback stops immediately.
   *
   * If no assistant audio has been sent since the last barge-in this is a
   * no-op: there is nothing queued at Twilio to clear, no item id to name in a
   * truncate, and any response still generating is left to run.
   */
  private handleBargeIn(
    conversationId: ConversationId,
    session: ConversationSession,
    call: CallState
  ): void {
    const bargeIn = call.bargeIn;

    const lastAssistantItem = bargeIn.lastAssistantItem;
    if (lastAssistantItem === null) {
      this.logger.debug(
        { conversation_id: conversationId },
        'Barge-in: no assistant item to interrupt'
      );
      return;
    }

    this.logger.debug({ conversation_id: conversationId }, 'Barge-in: truncating assistant reply');
    if (bargeIn.responseActive) {
      // Stop the model generating more of a reply nobody will hear — it would
      // otherwise keep burning tokens on discarded audio. Only while a
      // response is actually in flight: `response.cancel` with nothing to
      // cancel is itself an error event.
      this.modelSend(conversationId, { type: 'response.cancel' });
      bargeIn.responseActive = false;
    }
    this.modelSend(conversationId, {
      type: 'conversation.item.truncate',
      item_id: lastAssistantItem,
      content_index: 0,
      // Derived from bytes actually sent for this item, so for every delta
      // that carried an `item_id` it can never overstate the duration —
      // `conversation.item.truncate` rejects an `audio_end_ms` past the item's
      // real content.
      audio_end_ms: bargeIn.currentItemAudioMs,
    });
    this.twilioSend(conversationId, { event: 'clear', streamSid: session.metadata.streamSid });

    bargeIn.mutedItemId = lastAssistantItem;
    bargeIn.lastAssistantItem = null;
    bargeIn.currentItemAudioMs = 0;
  }

  /**
   * Run a model-requested tool call and hand the result back.
   *
   * Always sends a `function_call_output` once a `call_id` is present — even a
   * tool that ran successfully can return something `JSON.stringify` throws on
   * (a circular object, a `BigInt`) or has no JSON form at all, which
   * `JSON.stringify` reports by returning `undefined` rather than throwing (a
   * void tool, a bare function, a `Symbol`). Either way the model would
   * otherwise be left waiting on a `call_id` it never gets a result for.
   * Without a `call_id` there is nothing to reply to, so the item is dropped
   * instead.
   */
  private async handleFunctionCall(
    conversationId: ConversationId,
    item: Record<string, unknown>
  ): Promise<void> {
    const callId = item.call_id;
    if (typeof callId !== 'string' || !callId) {
      // Keys only, never the item: `arguments` carries whatever the caller
      // said, so logging it verbatim would put conversation content in logs.
      this.logger.error(
        { conversation_id: conversationId, item_keys: Object.keys(item) },
        'Received malformed function_call item without call_id'
      );
      return;
    }

    const name = item.name;
    let output: string;
    if (typeof name !== 'string' || !name) {
      // No name means no tool can be selected, so none runs.
      this.logger.error(
        { conversation_id: conversationId, call_id: callId, item_keys: Object.keys(item) },
        'Received malformed function_call item without tool name'
      );
      output = JSON.stringify({ error: 'Malformed function call: missing tool name.' });
    } else {
      const result = await this.runToolCall(conversationId, name, item.arguments);
      try {
        // `JSON.stringify` returns `undefined`, not a string, for a value with
        // no JSON form (a void tool, a bare function): `null` keeps the reply
        // addressed to `call_id` instead of dropping the required field.
        const serialized: string | undefined = JSON.stringify(result);
        output = serialized ?? 'null';
      } catch (err) {
        this.logger.error(
          { err, conversation_id: conversationId, tool_name: name },
          'Tool returned a non-JSON-serializable result'
        );
        output = JSON.stringify({ error: `Tool '${name}' returned a non-serializable result.` });
      }
    }

    this.modelSend(conversationId, {
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output },
    });
    this.modelSend(conversationId, { type: 'response.create' });
  }

  /**
   * Drop this call's transport state, close the model socket, and end the
   * session.
   *
   * Both legs can report the call ending, and the first one to arrive tears
   * down the other, so this runs at most once per call: a second invocation
   * finds nothing tracked and returns.
   */
  private async cleanupCall(conversationId: ConversationId): Promise<void> {
    const call = this.calls.get(conversationId);
    if (call === undefined) {
      return;
    }
    this.calls.delete(conversationId);

    if (call.modelWs !== null) {
      try {
        call.modelWs.close();
      } catch (err) {
        this.logger.debug({ err, conversation_id: conversationId }, 'Error closing model socket');
      }
    }
    await this.channel.endConversationInternal(conversationId);
  }
}
