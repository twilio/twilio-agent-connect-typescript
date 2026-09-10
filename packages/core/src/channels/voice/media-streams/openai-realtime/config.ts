import type { TACTool } from '@twilio/tac-tools';
import type { TACConfig } from '../../../../lib/config';
import type { TwiMLRequest } from '../../../../types/index';
import type { VoiceChannel } from '../../channel';
import type { VoiceProvider } from '../../provider';
import { MediaStreamsProviderConfig } from '../config';
import type { MediaStreamsProviderConfigOptions } from '../config';
import { OpenAIRealtimeProvider } from './provider';

/**
 * Options accepted by {@link OpenAIRealtimeProviderConfig}.
 */
export interface OpenAIRealtimeProviderConfigOptions extends MediaStreamsProviderConfigOptions {
  /**
   * OpenAI API key. Defaults to the `OPENAI_API_KEY` environment variable.
   */
  openaiApiKey?: string;

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
export class OpenAIRealtimeProviderConfig extends MediaStreamsProviderConfig {
  /** OpenAI API key. Defaults to the `OPENAI_API_KEY` environment variable. */
  public readonly openaiApiKey: string;

  /**
   * Executable `TACTool` implementations, looked up by name to run mid-call
   * tool requests. This alone does not tell the model these tools exist — also
   * add each tool's `toRealtimeFormat()` schema to
   * {@link OpenAIRealtimeProviderConfig.defaultSessionConfig}'s `tools` entry.
   */
  // See the `never` note on `OpenAIRealtimeProviderConfigOptions.tools`.
  public readonly tools: TACTool<never, unknown>[];

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
  public readonly defaultSessionConfig?: Record<string, unknown>;

  /**
   * Per-inbound-call override for
   * {@link OpenAIRealtimeProviderConfig.defaultSessionConfig}, called with the
   * `TwiMLRequest`. Its return value is used verbatim (not merged with
   * `defaultSessionConfig`); return `null` to fall back to it. Outbound calls
   * don't use this — see `InitiateVoiceConversationOptionsOpenAIRealtime`.
   */
  public readonly onInboundCallSessionConfig?: (
    req: TwiMLRequest
  ) => Promise<Record<string, unknown> | null>;

  constructor(options?: OpenAIRealtimeProviderConfigOptions) {
    super(options);

    const apiKey = options?.openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'openaiApiKey is required. Set the OPENAI_API_KEY environment ' +
          'variable or provide openaiApiKey in OpenAIRealtimeProviderConfig.'
      );
    }
    this.openaiApiKey = apiKey;

    this.tools = options?.tools ?? [];
    if (options?.welcomeGreetingResponse !== undefined) {
      this.welcomeGreetingResponse = options.welcomeGreetingResponse;
    }
    if (options?.defaultSessionConfig !== undefined) {
      this.defaultSessionConfig = options.defaultSessionConfig;
    }
    if (options?.onInboundCallSessionConfig !== undefined) {
      this.onInboundCallSessionConfig = options.onInboundCallSessionConfig;
    }
  }

  public override createProvider(channel: VoiceChannel, tacConfig: TACConfig): VoiceProvider {
    return new OpenAIRealtimeProvider(channel, tacConfig, this);
  }
}
