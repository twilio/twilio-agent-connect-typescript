import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import type { VoiceTwiMLOptionsConversationRelay } from '../../../types/index';
import type { ConversationRelayProviderConfigOptions } from './config';
import { studioVoiceHandoffUrl } from '../../../util/handoff-urls';
import { TwiMLBuilderBase, filterUnsetValues } from '../twiml';

/** Fixed default welcome greeting applied when no layer sets one. */
const DEFAULT_WELCOME_GREETING = 'Hello! How can I assist you today?';

/** Fields excluded from the option overlays; resolved separately. */
const SKIP_ACTION_URL = ['actionUrl'] as const;

/**
 * Stringify a custom-parameter value for emission as a `<Parameter value=...>`.
 * Parameter values are scalars in practice; objects are JSON-encoded rather
 * than producing '[object Object]'.
 */
function stringifyParameterValue(value: unknown): string {
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  // string | number | boolean | bigint | symbol — all safely stringifiable.
  return String(value as string | number | boolean | bigint);
}

/** Per-call inputs to {@link TwiMLBuilderConversationRelay.build}. */
export interface BuildTwiMLInputs {
  /**
   * Per-call overrides from the host owning the route (e.g. a per-call
   * `websocketUrl` with an affinity token). Lowest of the option layers.
   */
  host?: VoiceTwiMLOptionsConversationRelay | undefined;
  /**
   * Per-call overrides — the `onInboundCallTwiml` customizer's output for
   * inbound, or `InitiateVoiceConversationOptions.twimlOptions` for outbound.
   * Highest layer.
   */
  perCall?: VoiceTwiMLOptionsConversationRelay | undefined;
  /**
   * Dedicated per-call WebSocket override that wins over any `websocketUrl`
   * coming through the option layers. Used by outbound, which takes it as its
   * own argument.
   */
  websocketUrl?: string | undefined;
}

/**
 * Builds the TwiML for a ConversationRelay call, owning every layering and
 * resolution decision so `VoiceChannel` doesn't have to.
 */
export class TwiMLBuilderConversationRelay extends TwiMLBuilderBase<ConversationRelayProviderConfigOptions> {
  /**
   * Field names on {@link VoiceTwiMLOptionsConversationRelay} that map directly to `<ConversationRelay>`
   * attributes (camelCase, emitted as-is). Excludes the fields handled specially
   * by {@link generateTwiml}: websocketUrl (resolved through the layered merge and
   * emitted as the `url` attribute), actionUrl, languages, customParameters, extra.
   */
  protected static readonly RELAY_ATTR_FIELDS: readonly (keyof VoiceTwiMLOptionsConversationRelay)[] =
    [
      'welcomeGreeting',
      'welcomeGreetingInterruptible',
      'conversationConfiguration',
      'language',
      'ttsLanguage',
      'transcriptionLanguage',
      'voice',
      'ttsProvider',
      'transcriptionProvider',
      'speechModel',
      'elevenlabsTextNormalization',
      'eotThreshold',
      'partialPrompts',
      'deepgramSmartFormat',
      'speechTimeout',
      'interruptible',
      'interruptSensitivity',
      'reportInputDuringAgentSpeech',
      'ignoreBackchannel',
      'preemptible',
      'dtmfDetection',
      'hints',
      'events',
      'debug',
      'intelligenceService',
    ];

  /**
   * Build the TwiML XML for one call.
   *
   * @param caller - Name of the calling method, used in the "no WebSocket URL"
   *   error so it points at the API the developer actually called.
   * @param options - Per-call option layers and WebSocket override.
   * @throws {Error} if no layer and no `TACConfig`-derived default supplies a
   *   WebSocket URL.
   */
  public build(caller: string, options?: BuildTwiMLInputs): string {
    const merged = this.buildTwimlOptions(options?.host, options?.perCall);

    const resolvedWebsocketUrl =
      options?.websocketUrl ?? merged.websocketUrl ?? this.defaultWebsocketUrl();
    if (!resolvedWebsocketUrl) {
      throw this.missingWebsocketUrlError(caller);
    }

    return this.generateTwiml(resolvedWebsocketUrl, merged);
  }

  /**
   * Layer TwiML options, lowest precedence first: TAC defaults → `host`
   * (calling host's per-call values) → channel `defaultTwimlOptions` → `perCall`
   * (application customizer output for inbound, or
   * `InitiateVoiceConversationOptions.twimlOptions` for outbound).
   *
   * `actionUrl` is skipped by the overlays on purpose — it's resolved once via
   * {@link resolveActionUrl} looking at every layer at once, and that resolved
   * value is written into `merged` before the overlays run. Letting it through
   * would let a higher-priority layer that didn't set actionUrl silently clobber
   * a lower layer that did.
   */
  protected buildTwimlOptions(
    host: VoiceTwiMLOptionsConversationRelay | undefined,
    perCall: VoiceTwiMLOptionsConversationRelay | undefined
  ): VoiceTwiMLOptionsConversationRelay {
    const merged: VoiceTwiMLOptionsConversationRelay = {
      welcomeGreeting: DEFAULT_WELCOME_GREETING,
      ...(this.tacConfig.isOrchestratorEnabled() &&
      this.tacConfig.conversationConfigurationId !== undefined
        ? { conversationConfiguration: this.tacConfig.conversationConfigurationId }
        : {}),
    };
    const resolvedActionUrl = this.resolveActionUrl(host, perCall);
    if (resolvedActionUrl !== undefined) {
      merged.actionUrl = resolvedActionUrl;
    }
    if (host) {
      this.overlayFields(merged, host, SKIP_ACTION_URL);
    }
    if (this.channelConfig.defaultTwimlOptions) {
      this.overlayFields(merged, this.channelConfig.defaultTwimlOptions, SKIP_ACTION_URL);
    }
    if (perCall) {
      this.overlayFields(merged, perCall, SKIP_ACTION_URL);
    }
    return merged;
  }

  /**
   * Resolve the TwiML `<Connect action=...>` URL.
   *
   * Precedence (highest to lowest):
   *   1. application customizer
   *   2. channel `defaultTwimlOptions`
   *   3. `host` (calling host's per-call options)
   *   4. Studio handoff (when `studioHandoffFlowSid` is configured)
   *   5. Channel default — derived from `TACConfig.voicePublicDomain` +
   *      `TACConfig.voiceActionPath`.
   *
   * User-expressed intent (Studio handoff is configured explicitly on
   * `TACConfig`) beats the SDK's generated cleanup default.
   *
   * Explicit `actionUrl: undefined` on a layer (key present, value undefined)
   * suppresses `<Connect action=...>` entirely — all lower layers are skipped.
   * `actionUrl` left absent (key not present) falls through to the next layer.
   */
  protected resolveActionUrl(
    host: VoiceTwiMLOptionsConversationRelay | undefined,
    customized: VoiceTwiMLOptionsConversationRelay | undefined
  ): string | undefined {
    if (customized && 'actionUrl' in customized) {
      return customized.actionUrl;
    }
    const defaults = this.channelConfig.defaultTwimlOptions;
    if (defaults && 'actionUrl' in defaults) {
      return defaults.actionUrl;
    }
    if (host && 'actionUrl' in host) {
      return host.actionUrl;
    }
    if (this.tacConfig.studioHandoffFlowSid) {
      return studioVoiceHandoffUrl(this.tacConfig.accountSid, this.tacConfig.studioHandoffFlowSid);
    }
    return this.defaultActionUrl();
  }

  /**
   * Generate TwiML XML for ConversationRelay from a merged {@link VoiceTwiMLOptionsConversationRelay}.
   *
   * This is the low-level emitter used by {@link build} after layering. It
   * mirrors the Python SDK's `generate_twiml`.
   *
   * @param websocketUrl - Public WebSocket URL (e.g. 'wss://example.ngrok.app/ws').
   * @param options - Merged VoiceTwiMLOptionsConversationRelay to emit.
   * @returns TwiML XML string ready to return to Twilio.
   */
  protected generateTwiml(
    websocketUrl: string,
    options: VoiceTwiMLOptionsConversationRelay
  ): string {
    const response = new VoiceResponse();

    // <Connect action=...> — actionUrl undefined means no action attribute.
    const connect = response.connect(options.actionUrl ? { action: options.actionUrl } : {});

    // Build ConversationRelay attributes. Keys on VoiceTwiMLOptionsConversationRelay are already
    // camelCase; the Twilio SDK serializes booleans/numbers as TwiML attribute
    // values.
    const relayAttrs: Record<string, unknown> = { url: websocketUrl };
    for (const field of TwiMLBuilderConversationRelay.RELAY_ATTR_FIELDS) {
      let value = options[field];
      if (value === undefined) {
        continue;
      }
      // Twilio accepts true/false on `interruptible` for backward-compat but the
      // documented enum is none|dtmf|speech|any. Normalize so we emit canonical
      // values regardless of the SDK's bool serialization.
      if (field === 'interruptible' && typeof value === 'boolean') {
        value = value ? 'any' : 'none';
      }
      relayAttrs[field] = value;
    }

    // `extra` is the escape hatch for attributes not yet typed. The schema's
    // shadow-guard rejects keys colliding with typed fields, so pass them
    // through as-is — except `url`: it's not a VoiceTwiMLOptionsConversationRelay field (invisible to
    // the shadow-guard) but IS the resolved WebSocket endpoint, so letting
    // `extra.url` through would silently point the call at the wrong socket.
    if (options.extra) {
      for (const [key, value] of Object.entries(options.extra)) {
        if (key === 'url') {
          this.logger.warn(
            'Ignoring `url` in VoiceTwiMLOptionsConversationRelay.extra; set `websocketUrl` to override the ConversationRelay URL.'
          );
          continue;
        }
        relayAttrs[key] = value;
      }
    }

    const relay = connect.conversationRelay(
      relayAttrs as Parameters<typeof connect.conversationRelay>[0]
    );

    // Emit <Language> children, if any.
    if (options.languages && options.languages.length > 0) {
      for (const lang of options.languages) {
        const langAttrs = filterUnsetValues(lang);
        relay.language(langAttrs as Parameters<typeof relay.language>[0]);
      }
    }

    // Emit custom parameters as <Parameter> children, skipping null/undefined.
    if (options.customParameters) {
      for (const [name, value] of Object.entries(options.customParameters)) {
        if (value !== null && value !== undefined) {
          relay.parameter({ name, value: stringifyParameterValue(value) });
        }
      }
    }

    return response.toString();
  }
}
