import type { TACConfig } from '../../lib/config';
import type { Logger } from '../../lib/logger';

/**
 * Filter out undefined values from a configuration object.
 * Keeps null, false, 0, and empty strings as they are valid values.
 */
export function filterUnsetValues(config: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Common construction and option-layering helpers shared by every provider's
 * TwiML builder.
 *
 * Subclasses take `TACConfig` and their provider's channel config wholesale
 * (not individual derived values) so a later change to either — a new field, a
 * new default — is a change to the builder alone, not a change to what
 * `VoiceChannel` has to compute and hand over.
 *
 * @internal
 */
export abstract class TwiMLBuilderBase<TChannelConfig = unknown> {
  protected readonly tacConfig: TACConfig;
  protected readonly channelConfig: TChannelConfig;
  protected readonly logger: Logger;

  constructor(tacConfig: TACConfig, channelConfig: TChannelConfig, logger: Logger) {
    this.tacConfig = tacConfig;
    this.channelConfig = channelConfig;
    this.logger = logger;
  }

  /**
   * Apply fields explicitly present on `source` onto `target`, except those
   * named in `skip`.
   *
   * Nested objects, arrays, and dicts replace wholesale — there's no per-key
   * merging.
   *
   * "Explicitly present" is detected via key presence (`Object.keys`), which
   * mirrors Python's `model_fields_set`: a key set to `undefined` is still
   * "present" and overrides lower layers, while an absent key falls through.
   */
  protected overlayFields(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    skip: readonly string[] = []
  ): void {
    for (const key of Object.keys(source)) {
      if (skip.includes(key)) {
        continue;
      }
      target[key] = source[key];
    }
  }

  /**
   * The error thrown when no layer and no `TACConfig`-derived default supplies
   * a WebSocket URL. `caller` names the API the developer actually called.
   */
  protected missingWebsocketUrlError(caller: string): Error {
    return new Error(
      `${caller} needs a WebSocket URL. Set TWILIO_VOICE_PUBLIC_DOMAIN ` +
        '(or TACConfig.voicePublicDomain).'
    );
  }

  /**
   * The WebSocket URL derived from `TACConfig.voicePublicDomain` +
   * `TACConfig.voiceWebsocketPath`, or undefined when `voicePublicDomain` is
   * unset.
   */
  protected defaultWebsocketUrl(): string | undefined {
    if (!this.tacConfig.voicePublicDomain) {
      return undefined;
    }
    return `wss://${this.tacConfig.voicePublicDomain}${this.tacConfig.voiceWebsocketPath}`;
  }

  /**
   * Resolve the default `<Connect action=...>` cleanup URL from
   * `TACConfig.voicePublicDomain` + `TACConfig.voiceActionPath`.
   *
   * Returns undefined if `voicePublicDomain` isn't set; that's fine because
   * actionUrl has higher-priority layers (customizer, twimlOptions, Studio
   * handoff) above this fallback.
   */
  protected defaultActionUrl(): string | undefined {
    if (this.tacConfig.voicePublicDomain) {
      return `https://${this.tacConfig.voicePublicDomain}${this.tacConfig.voiceActionPath}`;
    }
    return undefined;
  }
}
