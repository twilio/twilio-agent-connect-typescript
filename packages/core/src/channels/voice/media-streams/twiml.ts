import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import type { VoiceTwiMLOptionsMediaStreams } from '../../../types/index';
import { TwiMLBuilderBase, stringifyParameterValue } from '../twiml';

/**
 * The slice of a Media Streams provider's config this builder reads. Declared
 * structurally rather than importing the provider's config class, so the
 * builder does not depend on which Media Streams provider owns it.
 */
export interface MediaStreamsTwiMLBuilderConfig {
  defaultTwimlOptions?: VoiceTwiMLOptionsMediaStreams | undefined;
}

/**
 * Generate TwiML that connects the call to a bidirectional Media Stream.
 *
 * See https://www.twilio.com/docs/voice/twiml/stream for the `<Stream>` verb.
 *
 * The WebSocket URL may be passed positionally or as `options.websocketUrl`
 * (positional wins when both are given), so a caller can pass everything in one
 * object: `generateStreamTwiml(undefined, { websocketUrl: ... })`.
 *
 * @param websocketUrl - Public `wss://` URL of the WebSocket endpoint Twilio
 *   should stream call audio to (the `<Stream url=...>` attribute). Optional if
 *   `options.websocketUrl` is set.
 * @param options - Optional Media Streams TwiML options.
 * @returns TwiML XML string ready to return to Twilio.
 * @throws {Error} if no WebSocket URL is provided via either source.
 */
export function generateStreamTwiml(
  websocketUrl?: string,
  options?: VoiceTwiMLOptionsMediaStreams
): string {
  const resolved = websocketUrl ?? options?.websocketUrl;
  if (!resolved || !resolved.trim()) {
    throw new Error(
      'generateStreamTwiml requires a WebSocket URL — pass it positionally or ' +
        'set options.websocketUrl.'
    );
  }

  const response = new VoiceResponse();

  // <Connect> takes its attributes at construction so they land in the opening
  // tag; only action/method belong here, the rest are <Stream> attributes.
  const connectAttrs: Record<string, unknown> = {};
  if (options?.actionUrl) {
    connectAttrs.action = options.actionUrl;
  }
  if (options?.actionMethod) {
    connectAttrs.method = options.actionMethod;
  }
  const connect = response.connect(connectAttrs as Parameters<typeof response.connect>[0]);

  const streamAttrs: Record<string, unknown> = { url: resolved };
  if (options?.name) {
    streamAttrs.name = options.name;
  }
  if (options?.statusCallback) {
    streamAttrs.statusCallback = options.statusCallback;
  }
  if (options?.statusCallbackMethod) {
    streamAttrs.statusCallbackMethod = options.statusCallbackMethod;
  }
  const stream = connect.stream(streamAttrs as Parameters<typeof connect.stream>[0]);

  // Emit custom parameters as <Parameter> children, skipping null/undefined.
  if (options?.customParameters) {
    for (const [name, value] of Object.entries(options.customParameters)) {
      if (value !== null && value !== undefined) {
        stream.parameter({ name, value: stringifyParameterValue(value) });
      }
    }
  }

  return response.toString();
}

/** Per-call inputs to {@link TwiMLBuilderMediaStreams.build}. */
export interface BuildStreamTwiMLInputs {
  /**
   * Per-call overrides from the host owning the route (e.g. a per-call
   * `websocketUrl` with an affinity token). Lowest of the option layers.
   */
  host?: VoiceTwiMLOptionsMediaStreams | undefined;
  /**
   * Per-call overrides — the `onInboundCallTwiml` customizer's output for
   * inbound, or `InitiateVoiceConversationOptions.twimlOptions` for outbound.
   * Highest layer.
   */
  perCall?: VoiceTwiMLOptionsMediaStreams | undefined;
  /**
   * Dedicated per-call WebSocket override that wins over any `websocketUrl`
   * coming through the option layers. Used by outbound, which takes it as its
   * own argument.
   */
  websocketUrl?: string | undefined;
}

/**
 * Builds the TwiML for a Media Streams call, owning the layering and WebSocket
 * URL resolution so the provider doesn't have to.
 */
export class TwiMLBuilderMediaStreams extends TwiMLBuilderBase<MediaStreamsTwiMLBuilderConfig> {
  /**
   * Build the TwiML XML for one call.
   *
   * TwiML fields are merged per-field, highest precedence first:
   *   1. `perCall` — the `onInboundCallTwiml` customizer's output for inbound,
   *      or `InitiateVoiceConversationOptions.twimlOptions` for outbound
   *   2. the provider config's `defaultTwimlOptions` — channel-wide defaults
   *   3. `host` — per-call transport facts supplied by the host
   *   4. TAC defaults: the WebSocket URL derived from
   *      `TACConfig.voicePublicDomain` + `voiceWebsocketPath`
   *
   * @param caller - Name of the calling method, used in the "no WebSocket URL"
   *   error so it points at the API the developer actually called.
   * @param options - Per-call option layers and WebSocket override.
   * @throws {Error} if no layer and no `TACConfig`-derived default supplies a
   *   WebSocket URL.
   */
  public build(caller: string, options?: BuildStreamTwiMLInputs): string {
    const merged = this.buildTwimlOptions(options?.host, options?.perCall);

    // Falsy rather than nullish: an empty-string websocketUrl from any layer
    // must fall through instead of emitting <Stream url="">.
    const resolvedWebsocketUrl =
      options?.websocketUrl || merged.websocketUrl || this.defaultWebsocketUrl();
    if (!resolvedWebsocketUrl) {
      throw this.missingWebsocketUrlError(caller);
    }

    return generateStreamTwiml(resolvedWebsocketUrl, merged);
  }

  /**
   * Layer TwiML options, lowest precedence first: `host` →
   * `defaultTwimlOptions` → `perCall`.
   *
   * `customParameters` replaces wholesale when set at a higher-priority layer —
   * there's no per-key merging.
   */
  protected buildTwimlOptions(
    host: VoiceTwiMLOptionsMediaStreams | undefined,
    perCall: VoiceTwiMLOptionsMediaStreams | undefined
  ): VoiceTwiMLOptionsMediaStreams {
    const merged: VoiceTwiMLOptionsMediaStreams = {};
    if (host) {
      this.overlayFields(merged, host);
    }
    if (this.channelConfig.defaultTwimlOptions) {
      this.overlayFields(merged, this.channelConfig.defaultTwimlOptions);
    }
    if (perCall) {
      this.overlayFields(merged, perCall);
    }
    return merged;
  }
}
