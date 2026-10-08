import type { VoiceTwiMLOptionsMediaStreams } from '../../../types/index';
import type { BaseChannelOptions } from '../../base';
import { VoiceProviderConfig } from '../provider';

/** Options accepted by {@link MediaStreamsProviderConfig}. */
export interface MediaStreamsProviderConfigOptions extends BaseChannelOptions {
  /**
   * Static `VoiceTwiMLOptionsMediaStreams` applied to every inbound call.
   * Per-call customization is registered via
   * `VoiceChannel.onInboundCallTwiml(...)`, which takes precedence over this.
   */
  defaultTwimlOptions?: VoiceTwiMLOptionsMediaStreams;
}

/**
 * Base configuration for a Media Streams (`<Connect><Stream>`) provider.
 *
 * Holds the transport-level settings every Media Streams provider shares,
 * independent of which model or protocol runs over the stream.
 */
export class MediaStreamsProviderConfig extends VoiceProviderConfig {
  /**
   * Static `VoiceTwiMLOptionsMediaStreams` applied to every inbound call.
   * Per-call customization is registered via
   * `VoiceChannel.onInboundCallTwiml(...)`, which takes precedence over this.
   */
  public readonly defaultTwimlOptions?: VoiceTwiMLOptionsMediaStreams;

  constructor(options?: MediaStreamsProviderConfigOptions) {
    super(options);
    if (options?.defaultTwimlOptions !== undefined) {
      this.defaultTwimlOptions = options.defaultTwimlOptions;
    }
  }
}
