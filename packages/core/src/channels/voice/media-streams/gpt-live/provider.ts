import type { WebSocket } from 'ws';
import {
  MediaStreamsOpenAIProvider,
  OPENAI_USER_AGENT,
  describeIssues,
} from '../shared/openai-provider';
import {
  InitiateVoiceConversationOptionsGPTLiveSchema,
  StreamStartMessageSchema,
  callOptionsToCreateParams,
  type ConversationId,
  type ConversationSession,
  type InitiateVoiceConversationOptions,
  type InitiateVoiceConversationOptionsGPTLive,
} from '../../../../types/index';
import type { InitiateVoiceConversationResult } from '../../../../types/conversation';
import { maskPhone, redactTwimlParameters } from '../../../../util/log-redaction';
import type { GPTLiveProviderConfig } from './config';
import { CallState } from './state';

/**
 * The audio format both directions of a call must use.
 *
 * Twilio Media Streams always sends and expects 8kHz G.711 u-law — see
 * https://www.twilio.com/docs/voice/media-streams/websocket-messages. Not
 * configurable. GPT-Live speaks it natively on both legs, so a single
 * `session.audio.format` covers input and output and nothing transcodes.
 *
 * Spelled with an explicit `rate`, which GPT-Live's schema wants and Realtime's
 * rejects — that is why this is a separate constant from
 * `TWILIO_AUDIO_FORMAT_FOR_REALTIME` rather than a shared one.
 */
export const TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE = { type: 'audio/pcmu', rate: 8000 } as const;

/**
 * `ConversationSession.metadata` key holding OpenAI's id for the GPT-Live
 * session behind this call, set once `session.started` arrives. Quote it to
 * OpenAI support when reporting a session.
 *
 * Opaque: the prefix differs across GPT-Live's alpha (`rtc_`) and GA (`live_`),
 * so never parse it, validate it, or branch on it.
 */
export const GPT_LIVE_SESSION_ID_METADATA_KEY = 'gpt_live_session_id';

/**
 * Reserved <Stream> customParameters key correlating an outbound call's
 * sessionConfig override to its WebSocket start event.
 */
const SESSION_CONFIG_TOKEN_PARAM = '_tac_session_config_token';

/**
 * How long a pending sessionConfig entry may outlive its outbound call before
 * it is purged — covers no-answer, busy, and every other outcome where Twilio
 * never connects the media stream to consume it via `registerCall`.
 */
const SESSION_CONFIG_TOKEN_TTL_MS = 120_000;

/**
 * The GPT-Live endpoint. Unlike Realtime's, it carries no `?model=` query
 * param — the model is named inside the `session.start` payload instead.
 */
const GPT_LIVE_URL = 'wss://api.openai.com/v1/live/sessions';

/**
 * Whether `value` is exactly {@link TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE}.
 *
 * Compared field by field rather than by serializing both sides, so key order
 * in a caller's session config can't decide the answer.
 */
function isTwilioMediaStreamAudioFormat(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const expected: Record<string, unknown> = TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE;
  const actual = value as Record<string, unknown>;
  const keys = Object.keys(actual);
  return (
    keys.length === Object.keys(expected).length && keys.every(key => actual[key] === expected[key])
  );
}

/**
 * A {@link VoiceProvider} bridging Twilio Media Streams to OpenAI's GPT-Live
 * API.
 */
export class GPTLiveProvider extends MediaStreamsOpenAIProvider<CallState> {
  /**
   * No `override`: TypeScript rejects it alongside `declare` (TS1243), and
   * `declare` is what keeps this a pure type narrowing of the base's field
   * rather than a second field that shadows it.
   */
  declare protected readonly config: GPTLiveProviderConfig;

  private readonly pendingTokenExpiries = new Map<string, ReturnType<typeof setTimeout>>();

  public override get channelName(): string {
    return 'VOICE_MEDIA_STREAM_OPENAI_GPT_LIVE';
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
   * Pass `InitiateVoiceConversationOptionsGPTLive` with `sessionConfig` set to
   * override `GPTLiveProviderConfig.defaultSessionConfig` for this call.
   *
   * @param options - Outbound call options.
   * @throws {TypeError} if `options` does not satisfy
   *   `InitiateVoiceConversationOptionsGPTLiveSchema`.
   * @throws {Error} if no WebSocket URL can be resolved — neither
   *   `options.websocketUrl` nor any TwiML layer sets one and
   *   `TACConfig.voicePublicDomain` is unset.
   */
  public override async initiateOutboundConversation(
    options: InitiateVoiceConversationOptions | InitiateVoiceConversationOptionsGPTLive
  ): Promise<InitiateVoiceConversationResult> {
    // Validate the whole options object, not just twimlOptions: this is the
    // only gate between a host's input and `calls.create()`, and it's what
    // makes the schema's `.strict()` upgrade guard fire for this provider.
    // Python gets the same coverage for free from Pydantic; TypeScript has no
    // runtime type to lean on.
    const parsedOptions = InitiateVoiceConversationOptionsGPTLiveSchema.safeParse(options);
    if (!parsedOptions.success) {
      throw new TypeError(
        'GPTLiveProvider.initiateOutboundConversation requires options to be an ' +
          `InitiateVoiceConversationOptionsGPTLive: ${describeIssues(parsedOptions.error.issues)}`
      );
    }
    const validated = parsedOptions.data;
    let twimlOptions = validated.twimlOptions;

    // Why a token instead of the call SID. `calls.create()` returning
    // `call.sid` does not happen-before Twilio connecting the media stream, so
    // the SID is not yet a usable correlation key when the `start` event may
    // already be arriving. The token is embedded in the TwiML before the call
    // is placed, so it always is.
    //
    // Minting it here touches nothing shared: the map is only written once the
    // TwiML has been built, so a `build()` failure has nothing to leak.
    const sessionConfig = validated.sessionConfig ?? null;
    let sessionConfigToken: string | null = null;
    if (sessionConfig !== null) {
      sessionConfigToken = crypto.randomUUID().replace(/-/g, '');
      // Rebuilt rather than mutated because `twimlOptions` is absent whenever
      // the caller omitted it — there is no object to assign the token into,
      // and the caller's own object is never written through.
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

      if (sessionConfigToken !== null) {
        this.armTokenExpiry(sessionConfigToken);
      }

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

  /**
   * Start the clock on a stashed token, so a call that never connects cannot
   * strand its override in {@link pendingSessionConfigs} forever.
   *
   * Unref'd: a two-minute timer must not be what keeps the process alive after
   * the call it belongs to is long over.
   */
  private armTokenExpiry(token: string): void {
    const timer = setTimeout(() => {
      this.pendingTokenExpiries.delete(token);
      this.pendingSessionConfigs.delete(token);
    }, SESSION_CONFIG_TOKEN_TTL_MS);
    timer.unref();
    this.pendingTokenExpiries.set(token, timer);
  }

  /**
   * Stop the clock on a token, once the call it belongs to has claimed it.
   *
   * Without this a two-minute timer outlives every call that connected
   * normally, waiting to purge an entry that is already gone.
   */
  private cancelTokenExpiry(token: string): void {
    const timer = this.pendingTokenExpiries.get(token);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pendingTokenExpiries.delete(token);
    }
  }

  // =========================================================================
  // Audio Bridge
  // =========================================================================

  /**
   * Drive one Twilio Media Stream connection from `start` to disconnect.
   *
   * Twilio's `start` event names the call, which opens the matching GPT-Live
   * socket; from then on caller audio is relayed to the model and the model's
   * audio back to Twilio, until either side goes away. Whichever leg closes
   * first takes the other down with it, so a caller is never left connected to
   * silence.
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
          conversationId = this.registerCall(message.start, ws);
          await this.connectModel(conversationId);
        } else if (event === 'media') {
          const media = (message.media ?? {}) as Record<string, unknown>;
          const payload = media.payload;
          if (conversationId !== null && typeof payload === 'string' && payload) {
            this.modelSend(conversationId, {
              type: 'session.input_audio.append',
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
        // Python breaks its read loop on any exception and cleans up in the
        // `finally`; closing here reaches the same end through the `close`
        // handler below, rather than holding the caller on a line to nothing.
        this.logger.error({ err, conversation_id: conversationId }, 'Media stream WebSocket error');
        ws.close();
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
   * @returns The conversation id, which is the call SID.
   */
  private registerCall(start: unknown, ws: WebSocket): ConversationId {
    const message = StreamStartMessageSchema.parse(start ?? {});
    const conversationId = message.callSid as ConversationId;

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
      this.cancelTokenExpiry(token);
    }

    const call = new CallState();
    call.twilioWs = ws;
    this.calls.set(conversationId, call);

    // No profile id: this provider's session lifecycle is independent of
    // Conversation Orchestrator, like ConversationRelay's relay-only mode.
    const session = this.channel.startConversationInternal(conversationId);
    session.callSid = message.callSid;
    session.metadata.streamSid = message.streamSid;
    session.metadata.transcript = [];

    this.logger.debug(
      { conversation_id: conversationId, media_format: message.mediaFormat },
      'Media stream started'
    );
    return conversationId;
  }

  /**
   * Open this call's GPT-Live socket and send its session config.
   *
   * @internal
   */
  public async connectModel(conversationId: ConversationId): Promise<void> {
    const sessionConfig = this.resolveSessionConfig(conversationId);

    const modelWs = await this.openModelSocket(GPT_LIVE_URL, {
      Authorization: `Bearer ${this.config.openaiApiKey}`,
      'User-Agent': OPENAI_USER_AGENT,
    });

    const call = this.calls.get(conversationId);
    if (call === undefined) {
      // The call ended while the handshake was in flight. Nothing tracks this
      // socket now, so close it rather than leak it.
      modelWs.close();
      return;
    }
    call.modelWs = modelWs;
    this.attachModelHandlers(conversationId, modelWs);
    this.logger.info({ conversation_id: conversationId }, 'Connected to GPT-Live');

    this.modelSend(conversationId, { type: 'session.start', session: sessionConfig });
    // `welcomeInstruction` is sent once `session.started` arrives, not here —
    // unlike the Realtime provider, which requests its greeting at connect time.
  }

  /**
   * The validated session config for this call: its own stashed override if it
   * has one, else the channel-wide default.
   *
   * @throws {Error} if neither exists, if the audio format is one Twilio can't
   *   carry, or if it names no model.
   */
  private resolveSessionConfig(conversationId: ConversationId): Record<string, unknown> {
    const sessionConfig =
      this.pendingSessionConfigs.get(conversationId) ?? this.config.defaultSessionConfig;
    this.pendingSessionConfigs.delete(conversationId);

    if (sessionConfig === undefined) {
      throw new Error(
        `No sessionConfig available for call ${conversationId} — this call supplied none ` +
          'and defaultSessionConfig is not set either.'
      );
    }

    const audio = (sessionConfig.audio ?? {}) as Record<string, unknown>;
    if (!isTwilioMediaStreamAudioFormat(audio.format)) {
      throw new Error(
        `sessionConfig for call ${conversationId} has audio.format=` +
          `${JSON.stringify(audio.format)}, expected ` +
          `${JSON.stringify(TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE)}. Twilio Media Streams is ` +
          'always 8kHz G.711 u-law; set audio.format to TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE.'
      );
    }
    if (!sessionConfig.model) {
      throw new Error(`sessionConfig for call ${conversationId} must include 'model'.`);
    }

    return sessionConfig;
  }

  /**
   * Wire up the model socket: dispatch its events, and tear the call down when
   * it goes away.
   *
   * The Python SDK races its Twilio read against its model-event reader so the
   * Twilio leg dies with the model leg; `ws` is event-driven, so the same
   * guarantee is a close/error handler instead.
   */
  private attachModelHandlers(conversationId: ConversationId, modelWs: WebSocket): void {
    modelWs.on('message', (raw: Buffer | string) => {
      // `handleModelMessage` owns its own failures, so nothing here can reject.
      void this.handleModelMessage(conversationId, raw);
    });

    modelWs.on('close', () => {
      // Still tracked means the model leg went first: an ordinary Twilio `stop`
      // has already run cleanup, which closed this socket itself.
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

  /** Apply one parsed GPT-Live event to the call. */
  // eslint-disable-next-line @typescript-eslint/require-await -- Stays `async` to satisfy the base's abstract signature; the branch that awaits (tool calls) lands with `handleFunctionCall`.
  protected override async dispatchModelEvent(
    conversationId: ConversationId,
    session: ConversationSession,
    event: Record<string, unknown>
  ): Promise<void> {
    switch (event.type) {
      case 'error': {
        this.logger.error(
          { conversation_id: conversationId, error: event.error },
          'GPT-Live error event'
        );
        break;
      }

      case 'session.closed': {
        // Carries the session snapshot too, so it is the backstop for a
        // `session.started` that never arrived or arrived malformed.
        this.recordGptLiveSessionId(conversationId, session, event);
        this.calls.get(conversationId)?.markClosed();
        break;
      }

      case 'session.started': {
        this.recordGptLiveSessionId(conversationId, session, event);
        // Sending `session.commentary.append` before this event is
        // undocumented behavior, so the greeting waits for it.
        const instruction = this.config.welcomeInstruction;
        if (instruction !== null) {
          this.modelSend(conversationId, {
            type: 'session.commentary.append',
            delegation_id: null,
            content: instruction,
          });
        }
        break;
      }

      case 'session.input_transcript.delta': {
        GPTLiveProvider.appendTranscriptDelta(session, 'user', event);
        break;
      }

      case 'session.output_transcript.delta': {
        GPTLiveProvider.appendTranscriptDelta(session, 'assistant', event);
        break;
      }

      case 'session.output_audio.delta': {
        // No item_id or barge-in bookkeeping: GPT-Live is full-duplex and
        // handles interruption server-side, so there is nothing to truncate.
        const delta = event.delta;
        if (typeof delta !== 'string' || !delta) {
          break;
        }
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

  /**
   * Surface the GPT-Live session id from a session-snapshot event.
   *
   * OpenAI support asks for this id when investigating a session, so it goes
   * where a caller can reach it — `session.metadata`, which outlives the call
   * into `onConversationEnded` — and is logged once per call.
   */
  private recordGptLiveSessionId(
    conversationId: ConversationId,
    session: ConversationSession,
    event: Record<string, unknown>
  ): void {
    const snapshot = (event.session ?? {}) as Record<string, unknown>;
    const sessionId = snapshot.id;
    if (typeof sessionId !== 'string' || sessionId === '') {
      return;
    }
    // Idempotent: `session.started` and `session.closed` both carry the
    // snapshot, and a normal call sees both.
    if (session.metadata[GPT_LIVE_SESSION_ID_METADATA_KEY] === sessionId) {
      return;
    }
    session.metadata[GPT_LIVE_SESSION_ID_METADATA_KEY] = sessionId;
    this.logger.info(
      { conversation_id: conversationId, gpt_live_session_id: sessionId },
      'GPT-Live session id'
    );
  }

  /** Accumulate one transcript delta into the in-progress turn. */
  private static appendTranscriptDelta(
    session: ConversationSession,
    role: 'user' | 'assistant',
    event: Record<string, unknown>
  ): void {
    const text = event.delta;
    if (typeof text !== 'string' || text === '') {
      return;
    }

    const existing = session.metadata.transcript;
    const transcript = Array.isArray(existing)
      ? (existing as { role: string; text: string }[])
      : [];
    if (transcript !== existing) {
      session.metadata.transcript = transcript;
    }
    const last = transcript[transcript.length - 1];
    if (last !== undefined && last.role === role) {
      last.text += text;
    } else {
      transcript.push({ role, text });
    }
  }
}
