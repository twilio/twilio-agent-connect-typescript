import type { TACTool } from '@twilio/tac-tools';
import type { TACConfig } from '../../../../lib/config';
import type { TwiMLRequest } from '../../../../types/index';
import type { VoiceChannel } from '../../channel';
import type { VoiceProvider } from '../../provider';
import { MediaStreamsOpenAIProviderConfig } from '../shared/config';
import type { MediaStreamsOpenAIProviderConfigOptions } from '../shared/config';
import { OpenAIRealtimeProvider } from './provider';

/**
 * Options accepted by {@link OpenAIRealtimeProviderConfig}.
 */
export interface OpenAIRealtimeProviderConfigOptions extends MediaStreamsOpenAIProviderConfigOptions {
  /**
   * Executable `TACTool` implementations, looked up by name to run mid-call
   * tool requests. This alone does not tell the model these tools exist — also
   * add each tool's `toRealtimeFormat()` schema to
   * {@link OpenAIRealtimeProviderConfigOptions.defaultSessionConfig}'s `tools`
   * entry.
   */
  // `never`, not `unknown`: `implementation` is a property, so its parameter is
  // contravariant and `TACTool[]` would reject every tool with typed params.
  tools?: TACTool<never, unknown>[];

  /**
   * If set, sent verbatim as `response.create`'s `response` payload when the
   * call connects — e.g. `{ instructions: 'Hi there!' }`. No SDK-added wrapping
   * text or language assumption.
   */
  welcomeGreetingResponse?: Record<string, unknown>;

  /**
   * The `session.update` payload's `session` body, sent once the model connects
   * — used for any call that doesn't supply its own via
   * {@link OpenAIRealtimeProviderConfigOptions.onInboundCallSessionConfig} or
   * `InitiateVoiceConversationOptionsOpenAIRealtime`.
   *
   * See
   * https://developers.openai.com/api/reference/resources/realtime/client-events#session.update
   * for the schema. If using {@link OpenAIRealtimeProviderConfigOptions.tools},
   * its `tools` entry must separately list each tool's `toRealtimeFormat()`
   * schema — this config is passed to OpenAI as-is, with no tool schemas merged
   * in.
   */
  defaultSessionConfig?: Record<string, unknown>;

  /**
   * Per-inbound-call override for
   * {@link OpenAIRealtimeProviderConfigOptions.defaultSessionConfig}, called
   * with the `TwiMLRequest`. Its return value is used verbatim (not merged with
   * `defaultSessionConfig`); return `null` to fall back to it. Outbound calls
   * don't use this — see `InitiateVoiceConversationOptionsOpenAIRealtime`.
   */
  onInboundCallSessionConfig?: (req: TwiMLRequest) => Promise<Record<string, unknown> | null>;
}

/**
 * Configuration for `OpenAIRealtimeProvider`.
 */
export class OpenAIRealtimeProviderConfig extends MediaStreamsOpenAIProviderConfig {
  /**
   * Executable `TACTool` implementations, looked up by name to run mid-call
   * tool requests. This alone does not tell the model these tools exist — also
   * add each tool's `toRealtimeFormat()` schema to
   * {@link OpenAIRealtimeProviderConfig.defaultSessionConfig}'s `tools` entry.
   */
  // See the `never` note on `OpenAIRealtimeProviderConfigOptions.tools`.
  //
  // `declare`: `target: ES2022` implies `useDefineForClassFields`, so a plain
  // redeclaration would emit a field definition that runs after `super()` and
  // overwrite the value the base constructor assigned with `undefined`. These
  // three exist only to carry Realtime-specific TSDoc onto the docs site.
  declare public readonly tools: TACTool<never, unknown>[];

  /**
   * If set, sent verbatim as `response.create`'s `response` payload when the
   * call connects — e.g. `{ instructions: 'Hi there!' }`. No SDK-added wrapping
   * text or language assumption.
   */
  public readonly welcomeGreetingResponse?: Record<string, unknown>;

  /**
   * The `session.update` payload's `session` body, sent once the model connects
   * — used for any call that doesn't supply its own via
   * {@link OpenAIRealtimeProviderConfig.onInboundCallSessionConfig} or
   * `InitiateVoiceConversationOptionsOpenAIRealtime`.
   *
   * See
   * https://developers.openai.com/api/reference/resources/realtime/client-events#session.update
   * for the schema. If using {@link OpenAIRealtimeProviderConfig.tools}, its
   * `tools` entry must separately list each tool's `toRealtimeFormat()` schema
   * — this config is passed to OpenAI as-is, with no tool schemas merged in.
   */
  declare public readonly defaultSessionConfig?: Record<string, unknown>;

  /**
   * Per-inbound-call override for
   * {@link OpenAIRealtimeProviderConfig.defaultSessionConfig}, called with the
   * `TwiMLRequest`. Its return value is used verbatim (not merged with
   * `defaultSessionConfig`); return `null` to fall back to it. Outbound calls
   * don't use this — see `InitiateVoiceConversationOptionsOpenAIRealtime`.
   */
  declare public readonly onInboundCallSessionConfig?: (
    req: TwiMLRequest
  ) => Promise<Record<string, unknown> | null>;

  constructor(options?: OpenAIRealtimeProviderConfigOptions) {
    super(options);

    if (options?.welcomeGreetingResponse !== undefined) {
      this.welcomeGreetingResponse = options.welcomeGreetingResponse;
    }
  }

  public override createProvider(channel: VoiceChannel, tacConfig: TACConfig): VoiceProvider {
    return new OpenAIRealtimeProvider(channel, tacConfig, this);
  }
}
