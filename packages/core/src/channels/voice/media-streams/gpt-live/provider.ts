import { MediaStreamsOpenAIProvider } from '../shared';
import {
  callOptionsToCreateParams,
  type ConversationId,
  type ConversationSession,
  type InitiateVoiceConversationOptions,
  type InitiateVoiceConversationOptionsGPTLive,
} from '../../../../types/index';
import type { InitiateVoiceConversationResult } from '../../../../types/conversation';
import { maskPhone, redactTwimlParameters } from '../../../../util/log-redaction';
import type { GPTLiveProviderConfig } from './config';
import type { CallState } from './state';

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
   * @throws {TypeError} if `options.twimlOptions` is not a
   *   `VoiceTwiMLOptionsMediaStreams`.
   * @throws {Error} if no WebSocket URL can be resolved — neither
   *   `options.websocketUrl` nor any TwiML layer sets one and
   *   `TACConfig.voicePublicDomain` is unset.
   */
  public override async initiateOutboundConversation(
    options: InitiateVoiceConversationOptions | InitiateVoiceConversationOptionsGPTLive
  ): Promise<InitiateVoiceConversationResult> {
    let twimlOptions = this.narrowTwimlOptions(
      options.twimlOptions,
      'initiateOutboundConversation',
      'options.twimlOptions'
    );

    // Why a token instead of the call SID. `calls.create()` returning
    // `call.sid` does not happen-before Twilio connecting the media stream, so
    // the SID is not yet a usable correlation key when the `start` event may
    // already be arriving. The token is embedded in the TwiML before the call
    // is placed, so it always is.
    //
    // Minting it here touches nothing shared: the map is only written once the
    // TwiML has been built, so a `build()` failure has nothing to leak.
    const sessionConfig = ('sessionConfig' in options ? options.sessionConfig : null) ?? null;
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
      { to: maskPhone(options.to), from: maskPhone(fromNumber) },
      'Initiating outbound voice conversation'
    );

    // Outbound has no inbound customizer and no host layer; the per-call
    // override is options.twimlOptions. `options.websocketUrl` is the dedicated
    // per-call outbound override and wins over any websocketUrl that came
    // through the layered twimlOptions merge.
    const twiml = this.twimlBuilder.build('initiateOutboundConversation', {
      perCall: twimlOptions,
      websocketUrl: options.websocketUrl,
    });

    const callParams = this.applyCallEventCallbacks(
      options.callOptions ? callOptionsToCreateParams(options.callOptions) : {}
    );

    if (sessionConfigToken !== null && sessionConfig !== null) {
      this.pendingSessionConfigs.set(sessionConfigToken, sessionConfig);
    }

    try {
      // The inline TwiML handed to Twilio. customParameters values are masked —
      // they're arbitrary developer data (profile IDs, caller names), unlike the
      // WebSocket URL.
      this.logger.debug(
        { twiml: redactTwimlParameters(twiml), to: maskPhone(options.to) },
        'Outbound call TwiML'
      );

      const client = this.channel.getTwilioClientInternal();
      const call = await client.calls.create({
        to: options.to,
        from: fromNumber,
        twiml,
        ...callParams,
      });

      this.logger.info(
        { call_sid: call.sid, to: maskPhone(options.to) },
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
        { err: error, to: maskPhone(options.to) },
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

  // eslint-disable-next-line @typescript-eslint/require-await -- Stub throws synchronously; Task 5 replaces with the real async dispatch.
  protected override async dispatchModelEvent(
    _convId: ConversationId,
    _session: ConversationSession,
    _event: Record<string, unknown>
  ): Promise<void> {
    throw new Error('not implemented');
  }
}
