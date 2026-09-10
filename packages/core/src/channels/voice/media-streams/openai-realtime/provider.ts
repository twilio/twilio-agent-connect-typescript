import type { WebSocket } from 'ws';
import type { TACTool } from '@twilio/tac-tools';
import type { TACConfig } from '../../../../lib/config';
import type { Logger } from '../../../../lib/logger';
import {
  InitiateVoiceConversationOptionsOpenAIRealtimeSchema,
  VoiceTwiMLOptionsMediaStreamsSchema,
  callOptionsToCreateParams,
  type ConversationId,
  type InitiateVoiceConversationOptions,
  type InitiateVoiceConversationOptionsOpenAIRealtime,
  type TwiMLRequest,
  type VoiceTwiMLOptions,
  type VoiceTwiMLOptionsMediaStreams,
} from '../../../../types/index';
import type { InitiateVoiceConversationResult } from '../../../../types/conversation';
import { maskPhone, redactTwimlParameters } from '../../../../util/log-redaction';
import type { VoiceChannel } from '../../channel';
import { VoiceProvider } from '../../provider';
import { TwiMLBuilderMediaStreams } from '../twiml';
import type { OpenAIRealtimeProviderConfig } from './config';
import type { CallState } from './state';

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
 * Render Zod validation issues as a compact `path: message` list, so a thrown
 * `TypeError` names the fields that actually failed rather than dumping the
 * raw error.
 *
 * Typed structurally rather than against Zod's issue type so it stays usable
 * with the result of any schema's `safeParse`.
 */
function describeIssues(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]
): string {
  return issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join(', ');
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
export class OpenAIRealtimeProvider extends VoiceProvider {
  /**
   * The owning channel's logger, so this provider logs under the same name the
   * rest of the voice channel does.
   */
  protected override readonly logger: Logger;

  /** Executable tools from the config, looked up by the name the model sends. */
  private readonly toolsByName: Map<string, TACTool>;

  /** Per-call transport state, keyed by conversation id. */
  private readonly calls: Map<ConversationId, CallState>;

  private readonly config: OpenAIRealtimeProviderConfig;
  private readonly tacConfig: TACConfig;
  private readonly twimlBuilder: TwiMLBuilderMediaStreams;

  /**
   * Session config overrides awaiting the call they belong to.
   *
   * Inbound entries are keyed by call SID (known when the TwiML webhook is
   * answered); outbound entries by {@link SESSION_CONFIG_TOKEN_PARAM}'s token.
   */
  private readonly pendingSessionConfigs: Map<string, Record<string, unknown>>;

  constructor(channel: VoiceChannel, tacConfig: TACConfig, config: OpenAIRealtimeProviderConfig) {
    super(channel);
    this.logger = channel.getLoggerInternal();
    this.config = config;
    this.tacConfig = tacConfig;
    this.toolsByName = new Map(config.tools.map(tool => [tool.name, tool]));
    this.calls = new Map();
    this.twimlBuilder = new TwiMLBuilderMediaStreams(tacConfig, config, this.logger);
    this.pendingSessionConfigs = new Map();
  }

  public override get channelName(): string {
    return 'VOICE_MEDIA_STREAM_OPENAI_REALTIME';
  }

  /** The Twilio-facing WebSocket for a conversation, if one is tracked. */
  public override getWebSocket(conversationId: ConversationId): WebSocket | null {
    return this.calls.get(conversationId)?.twilioWs ?? null;
  }

  /**
   * The transcript captured so far for an in-progress call.
   *
   * It lives on `ConversationSession.metadata.transcript`, so once the call
   * ends and the session is dropped it is no longer reachable here — read it
   * from the session an `onConversationEnded` handler receives instead.
   */
  public getTranscript(conversationId: ConversationId): Record<string, string>[] {
    const transcript = this.channel.getConversationSession(conversationId)?.metadata.transcript;
    return Array.isArray(transcript) ? [...(transcript as Record<string, string>[])] : [];
  }

  /**
   * The session config stashed for `key` — a call SID for inbound calls, a
   * token for outbound ones.
   *
   * @internal
   */
  public peekPendingSessionConfig(key: string): Record<string, unknown> | undefined {
    return this.pendingSessionConfigs.get(key);
  }

  /**
   * How many session config overrides are waiting for their call.
   *
   * @internal
   */
  public pendingSessionConfigCount(): number {
    return this.pendingSessionConfigs.size;
  }

  /**
   * The executable tool the model would run for `name`, if the config supplied
   * one.
   *
   * @internal
   */
  public peekTool(name: string): TACTool | undefined {
    return this.toolsByName.get(name);
  }

  // =========================================================================
  // Inbound Call Handling
  // =========================================================================

  /**
   * Build the `<Connect><Stream>` TwiML for an inbound call.
   *
   * TwiML fields are merged per-field, highest precedence first:
   *   1. Output of the customizer registered via
   *      `VoiceChannel.onInboundCallTwiml(...)`, if configured and
   *      `twimlRequest` is given
   *   2. `OpenAIRealtimeProviderConfig.defaultTwimlOptions` — channel-wide
   *      defaults
   *   3. `options.hostTwimlOptions` — per-call transport facts supplied by the
   *      host
   *   4. TAC defaults: the WebSocket URL derived from
   *      `TACConfig.voicePublicDomain` + `voiceWebsocketPath`
   *
   * Also runs `OpenAIRealtimeProviderConfig.onInboundCallSessionConfig`, if
   * set, and stashes its result for the call to pick up once it connects. The
   * hook runs only after the TwiML builds, so a call that never connects
   * leaves nothing stashed behind it.
   *
   * @param twimlRequest - Parsed Twilio webhook fields for the inbound call.
   * @param options - Additional per-call inputs.
   * @param options.hostTwimlOptions - Per-call TwiML supplied by a custom
   *   in-process host.
   * @throws {TypeError} if either the host options or the customizer's output
   *   is not a `VoiceTwiMLOptionsMediaStreams`.
   * @throws {Error} if no WebSocket URL can be resolved — none of the TwiML
   *   layers set one and `TACConfig.voicePublicDomain` is unset.
   */
  public override async handleIncomingCall(
    twimlRequest?: TwiMLRequest,
    options?: { hostTwimlOptions?: VoiceTwiMLOptions }
  ): Promise<string> {
    const host = this.narrowTwimlOptions(
      options?.hostTwimlOptions,
      'handleIncomingCall',
      'options.hostTwimlOptions'
    );

    const onInboundCallTwimlHandler = this.channel.getInboundCallTwimlHandler();
    let customized: VoiceTwiMLOptionsMediaStreams | undefined;
    if (onInboundCallTwimlHandler && twimlRequest) {
      customized = this.narrowTwimlOptions(
        await onInboundCallTwimlHandler(twimlRequest),
        'handleIncomingCall',
        'the onInboundCallTwiml customizer output'
      );
    }

    // Built before the stash, not after: build() throws when no WebSocket URL
    // can be resolved, and a throw here 500s the webhook so the call never
    // connects to drain the entry. Nothing would ever remove it.
    const twiml = this.twimlBuilder.build('handleIncomingCall', { host, perCall: customized });

    if (this.config.onInboundCallSessionConfig && twimlRequest?.callSid) {
      const sessionConfig = await this.config.onInboundCallSessionConfig(twimlRequest);
      if (sessionConfig !== null) {
        this.pendingSessionConfigs.set(twimlRequest.callSid, sessionConfig);
      }
    }

    return twiml;
  }

  /**
   * Narrow provider-agnostic {@link VoiceTwiMLOptions} to this provider's
   * concrete shape. `VoiceProvider.handleIncomingCall` is typed against the
   * base so every provider can accept its own TwiML options, so the Media
   * Streams shape has to be established at runtime.
   *
   * @param value - Options from a caller or the application customizer.
   * @param caller - Name of the calling method, for the error message.
   * @param label - What produced `value`, for the error message.
   */
  private narrowTwimlOptions(
    value: VoiceTwiMLOptions | undefined,
    caller: string,
    label: string
  ): VoiceTwiMLOptionsMediaStreams | undefined {
    if (value === undefined) {
      return undefined;
    }
    const parsed = VoiceTwiMLOptionsMediaStreamsSchema.safeParse(value);
    if (!parsed.success) {
      throw new TypeError(
        `OpenAIRealtimeProvider.${caller} requires ${label} to be a ` +
          `VoiceTwiMLOptionsMediaStreams: ${describeIssues(parsed.error.issues)}`
      );
    }
    return parsed.data;
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
}
