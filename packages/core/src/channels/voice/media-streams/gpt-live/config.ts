import { MediaStreamsOpenAIProviderConfig } from '../shared';
import type { MediaStreamsOpenAIProviderConfigOptions } from '../shared';
import type { VoiceProvider } from '../../provider';
import type { VoiceChannel } from '../../channel';
import type { TACConfig } from '../../../../lib/config';
import { GPTLiveProvider } from './provider';

export interface GPTLiveProviderConfigOptions extends MediaStreamsOpenAIProviderConfigOptions {
  /**
   * If set, sent verbatim as a `session.commentary.append` once `session.started`
   * arrives. Word it as an instruction, not just a greeting — e.g. "Greet the
   * caller immediately using: Hi, how can I help you today?". A bare greeting
   * will not make the model speak first.
   */
  welcomeInstruction?: string;
}

/**
 * Configuration for `GPTLiveProvider`.
 *
 * Two GPT-Live-specific notes on inherited members:
 *
 * - `tools` holds executable implementations looked up by name. It does **not**
 *   tell the model the tools exist — also add each tool's `toRealtimeFormat()`
 *   schema to `defaultSessionConfig.delegation.responses.tools`.
 * - `defaultSessionConfig` is the `session.start` payload's `session` body. It
 *   must include `model` (e.g. `'gpt-live-1'`), and `audio.format`
 *   must be `TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE`.
 */
export class GPTLiveProviderConfig extends MediaStreamsOpenAIProviderConfig {
  readonly welcomeInstruction: string | null;

  constructor(opts: GPTLiveProviderConfigOptions = {}) {
    super(opts);
    this.welcomeInstruction = opts.welcomeInstruction ?? null;
  }

  public override createProvider(channel: VoiceChannel, tacConfig: TACConfig): VoiceProvider {
    return new GPTLiveProvider(channel, tacConfig, this);
  }
}
