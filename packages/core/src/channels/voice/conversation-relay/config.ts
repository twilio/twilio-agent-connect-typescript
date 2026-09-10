import type { TACConfig } from '../../../lib/config';
import type { CallOptions, VoiceTwiMLOptionsConversationRelay } from '../../../types/index';
import type { BaseChannelOptions } from '../../base';
import type { VoiceChannel } from '../channel';
import type { VoiceProvider } from '../provider';
import { VoiceProviderConfig } from '../provider';
import { ConversationRelayProvider } from './provider';

/**
 * Options accepted by {@link ConversationRelayProviderConfig}.
 *
 * `defaultTwimlOptions` is one of several TwiML layers that merge per-field;
 * see `ConversationRelayProvider.handleIncomingCall` (inbound) and
 * `ConversationRelayProvider.initiateOutboundConversation` (outbound) for the
 * full precedence order.
 */
export interface ConversationRelayProviderConfigOptions extends BaseChannelOptions {
  /**
   * Static `VoiceTwiMLOptionsConversationRelay` applied to every call (inbound and outbound).
   * Controls the TwiML inside `<ConversationRelay>` — voice, language,
   * transcription provider, welcomeGreeting, `<Language>` children, etc. Use
   * this when the same ConversationRelay configuration is correct for every call.
   *
   * Per-call inbound customization is registered via
   * `VoiceChannel.onInboundCallTwiml(...)` (not on this config).
   *
   * Note: `customParameters` and `languages` replace wholesale when a
   * higher-priority layer sets them.
   */
  defaultTwimlOptions?: VoiceTwiMLOptionsConversationRelay;

  /**
   * Static {@link CallOptions} applied to every outbound call — the
   * `calls.create` parameters, including the call-event callback URLs. This is
   * the layer to use for a custom server or non-default routes: URLs set here
   * override the ones TAC would derive from `voicePublicDomain` +
   * `voiceCallEventPath`.
   */
  defaultCallOptions?: CallOptions;
}

/**
 * Configuration for {@link ConversationRelayProvider}, the default
 * {@link VoiceChannel} provider.
 *
 * TwiML configuration layers (highest precedence first):
 *
 *   Inbound calls (`handleIncomingCall`):
 *     1. Output of the customizer registered via
 *        `VoiceChannel.onInboundCallTwiml(...)`  [optional]
 *     2. `defaultTwimlOptions`                   [optional]
 *     3. `handleIncomingCall(hostTwimlOptions)`  [optional]
 *     4. TAC defaults
 *
 *   Outbound calls (`initiateOutboundConversation`):
 *     1. `InitiateVoiceConversationOptions.twimlOptions` [optional]
 *     2. `defaultTwimlOptions`                           [optional]
 *     3. TAC defaults
 *
 *   Calls-API parameters (`initiateOutboundConversation`):
 *     1. `InitiateVoiceConversationOptions.callOptions` [optional]
 *     2. `defaultCallOptions`                          [optional]
 *     3. Callback URLs derived from `TACConfig.voicePublicDomain` +
 *        `voiceCallEventPath`, for handlers that are registered
 *
 * All layers merge per-field via key presence — only fields a layer explicitly
 * sets override lower layers. Arrays (`languages`) and nested objects
 * (`customParameters`) replace wholesale when set.
 *
 * Per-call inbound customization is registered via
 * `VoiceChannel.onInboundCallTwiml(...)` (not on this config).
 */
export class ConversationRelayProviderConfig extends VoiceProviderConfig {
  /**
   * Static `VoiceTwiMLOptionsConversationRelay` for the TwiML inside `<ConversationRelay>`, applied
   * to every call (inbound and outbound).
   */
  public readonly defaultTwimlOptions?: VoiceTwiMLOptionsConversationRelay;

  /** Static {@link CallOptions} applied to every outbound call. */
  public readonly defaultCallOptions?: CallOptions;

  constructor(options?: ConversationRelayProviderConfigOptions) {
    super(options);
    if (options?.defaultTwimlOptions !== undefined) {
      this.defaultTwimlOptions = options.defaultTwimlOptions;
    }
    if (options?.defaultCallOptions !== undefined) {
      this.defaultCallOptions = options.defaultCallOptions;
    }
  }

  public override createProvider(channel: VoiceChannel, tacConfig: TACConfig): VoiceProvider {
    return new ConversationRelayProvider(channel, tacConfig, this);
  }
}

/**
 * Pre-provider-split name for {@link ConversationRelayProviderConfigOptions} —
 * the shape `new VoiceChannel(tac, {...})` accepts. Kept so the shipped public
 * export stays valid across the provider refactor.
 */
export type VoiceChannelConfig = ConversationRelayProviderConfigOptions;
