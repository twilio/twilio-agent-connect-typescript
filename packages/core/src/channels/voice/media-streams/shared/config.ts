import type { TACTool } from '@twilio/tac-tools';
import type { TwiMLRequest } from '../../../../types/index';
import { MediaStreamsProviderConfig } from '../config';
import type { MediaStreamsProviderConfigOptions } from '../config';

/**
 * Options accepted by {@link MediaStreamsOpenAIProviderConfig}.
 */
export interface MediaStreamsOpenAIProviderConfigOptions extends MediaStreamsProviderConfigOptions {
  /**
   * OpenAI API key. Defaults to the `OPENAI_API_KEY` environment variable.
   */
  openaiApiKey?: string;

  /**
   * Executable `TACTool` implementations, looked up by name to run mid-call
   * tool requests. This alone does not tell the model these tools exist — the
   * session config sent to OpenAI must separately declare each tool's schema.
   */
  // `never`, not `unknown`: `implementation` is a property, so its parameter is
  // contravariant and `TACTool[]` would reject every tool with typed params.
  tools?: TACTool<never, unknown>[];

  /**
   * Session configuration sent to OpenAI once the model connects — used for any
   * call that doesn't supply its own via
   * {@link MediaStreamsOpenAIProviderConfigOptions.onInboundCallSessionConfig}
   * or per-call outbound options.
   *
   * If using {@link MediaStreamsOpenAIProviderConfigOptions.tools}, this config
   * must separately list each tool's schema — it is passed to OpenAI as-is,
   * with no tool schemas merged in.
   */
  defaultSessionConfig?: Record<string, unknown>;

  /**
   * Per-inbound-call override for
   * {@link MediaStreamsOpenAIProviderConfigOptions.defaultSessionConfig},
   * called with the `TwiMLRequest`. Its return value is used verbatim (not
   * merged with `defaultSessionConfig`); return `null` to fall back to it.
   * Outbound calls don't use this — they pass their session config per call.
   */
  onInboundCallSessionConfig?: (req: TwiMLRequest) => Promise<Record<string, unknown> | null>;
}

/**
 * Base configuration for an OpenAI-backed Media Streams provider.
 *
 * Holds what every OpenAI-backed Media Streams provider needs — credentials,
 * executable tools, and the session config sent when the model connects —
 * independent of which OpenAI API runs over the stream.
 */
export class MediaStreamsOpenAIProviderConfig extends MediaStreamsProviderConfig {
  /** OpenAI API key. Defaults to the `OPENAI_API_KEY` environment variable. */
  public readonly openaiApiKey: string;

  /**
   * Executable `TACTool` implementations, looked up by name to run mid-call
   * tool requests. This alone does not tell the model these tools exist — the
   * session config sent to OpenAI must separately declare each tool's schema.
   */
  // See the `never` note on `MediaStreamsOpenAIProviderConfigOptions.tools`.
  public readonly tools: TACTool<never, unknown>[];

  /**
   * Session configuration sent to OpenAI once the model connects — used for any
   * call that doesn't supply its own via
   * {@link MediaStreamsOpenAIProviderConfig.onInboundCallSessionConfig} or
   * per-call outbound options.
   *
   * If using {@link MediaStreamsOpenAIProviderConfig.tools}, this config must
   * separately list each tool's schema — it is passed to OpenAI as-is, with no
   * tool schemas merged in.
   */
  public readonly defaultSessionConfig?: Record<string, unknown>;

  /**
   * Per-inbound-call override for
   * {@link MediaStreamsOpenAIProviderConfig.defaultSessionConfig}, called with
   * the `TwiMLRequest`. Its return value is used verbatim (not merged with
   * `defaultSessionConfig`); return `null` to fall back to it. Outbound calls
   * don't use this — they pass their session config per call.
   */
  public readonly onInboundCallSessionConfig?: (
    req: TwiMLRequest
  ) => Promise<Record<string, unknown> | null>;

  constructor(options?: MediaStreamsOpenAIProviderConfigOptions) {
    super(options);

    this.openaiApiKey = options?.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.tools = options?.tools ?? [];
    if (options?.defaultSessionConfig !== undefined) {
      this.defaultSessionConfig = options.defaultSessionConfig;
    }
    if (options?.onInboundCallSessionConfig !== undefined) {
      this.onInboundCallSessionConfig = options.onInboundCallSessionConfig;
    }

    if (!this.openaiApiKey) {
      throw new Error(
        'openaiApiKey is required. Set the OPENAI_API_KEY environment ' +
          `variable or provide openaiApiKey in ${this.constructor.name}.`
      );
    }
  }
}
