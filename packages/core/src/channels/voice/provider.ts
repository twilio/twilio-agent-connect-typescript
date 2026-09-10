import type { WebSocket } from 'ws';
import type { TACConfig } from '../../lib/config';
import { createLogger, type Logger } from '../../lib/logger';
import type {
  CallEventKind,
  ConversationId,
  InitiateVoiceConversationOptions,
  MemoryMode,
  VoiceTwiMLOptions,
  TwiMLRequest,
} from '../../types/index';
import type { InitiateVoiceConversationResult } from '../../types/conversation';
import type { BaseChannelOptions } from '../base';
import type { VoiceChannel } from './channel';

/**
 * Base class for a {@link VoiceChannel}'s real-time media provider.
 *
 * Holds the owning `channel` (Calls API lifecycle, conversation bookkeeping,
 * `TAC`). Every method here has a default that either declines the capability
 * or does nothing, so a provider only implements the transport it actually
 * supports — ConversationRelay serves inbound TwiML and a WebSocket, while a
 * provider with no inbound story simply inherits the refusal.
 */
export class VoiceProvider {
  /** The `VoiceChannel` that owns this provider. */
  public readonly channel: VoiceChannel;

  /** Logger named after the concrete provider class. */
  protected readonly logger: Logger;

  constructor(channel: VoiceChannel) {
    this.channel = channel;
    this.logger = createLogger({ name: this.constructor.name });
  }

  /**
   * Channel name identifier, e.g. `"VOICE"`.
   *
   * A label for this provider's transport; it does not change how
   * `VoiceChannel` reports its `ChannelType`.
   */
  public get channelName(): string {
    return 'VOICE';
  }

  /**
   * Build the response for an inbound call. Default: not supported.
   *
   * @param _twimlRequest - Parsed Twilio webhook fields for the inbound call.
   * @param _options - Additional per-call inputs.
   * @param _options.hostTwimlOptions - Per-call TwiML supplied by a custom
   *   in-process host.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Default rejects without awaiting, but stays `async` so callers always get a Promise
  public async handleIncomingCall(
    _twimlRequest?: TwiMLRequest,
    _options?: { hostTwimlOptions?: VoiceTwiMLOptions }
  ): Promise<string> {
    throw new Error(`${this.constructor.name} does not support inbound calls.`);
  }

  /**
   * Handle this provider's own out-of-band lifecycle webhook, if it has one.
   *
   * Not every provider has an equivalent — Twilio's ConversationRelay posts to
   * `<Connect action=...>` when the session ends (`ConversationRelayProvider`
   * uses this as a WebSocket-disconnect backup); Media Streams instead has its
   * own independent `statusCallback` (`stream-started` / `stream-stopped` /
   * `stream-error`), which is purely informational and doesn't gate call flow.
   * Default no-op for providers with nothing to do here.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Default no-ops without awaiting, but stays `async` so callers always get a Promise
  public async handleTwilioProviderCallback(_payload: Record<string, string>): Promise<void> {
    return undefined;
  }

  /**
   * Drive one WebSocket connection from accept to disconnect.
   *
   * Implementations may be synchronous or asynchronous: a provider that only
   * attaches event handlers can return `void`, while one that awaits an
   * upstream handshake before serving traffic returns a `Promise<void>`. The
   * owning `VoiceChannel` is responsible for handling a returned promise's
   * rejection, so an async override never produces an unhandled rejection.
   */
  public handleWebSocket(_websocket: WebSocket): void | Promise<void> {
    throw new Error(`${this.constructor.name} does not support WebSocket connections.`);
  }

  /** Place an outbound call. Default: not supported. */
  // eslint-disable-next-line @typescript-eslint/require-await -- Default rejects without awaiting, but stays `async` so callers always get a Promise
  public async initiateOutboundConversation(
    _options: InitiateVoiceConversationOptions
  ): Promise<InitiateVoiceConversationResult> {
    throw new Error(`${this.constructor.name} does not support outbound calls.`);
  }

  /** Send a text response back through this provider's transport, if supported. */
  // eslint-disable-next-line @typescript-eslint/require-await -- Default rejects without awaiting, but stays `async` so callers always get a Promise
  public async sendResponse(
    _conversationId: ConversationId,
    _message: string,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    throw new Error(`${this.constructor.name} does not support sendResponse.`);
  }

  /**
   * Stream a text response back through this provider's transport, token by
   * token, if supported. Default: not supported.
   *
   * @param _conversationId - Conversation whose transport receives the tokens.
   * @param _stream - Async iterable of text chunks to relay as they arrive.
   * @param _options - Additional per-call inputs.
   * @param _options.signal - Aborts the stream mid-flight, e.g. when the caller
   *   interrupts.
   * @returns The accumulated response text.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Default rejects without awaiting, but stays `async` so callers always get a Promise
  public async sendStreamingResponse(
    _conversationId: ConversationId,
    _stream: AsyncIterable<string>,
    _options?: { signal?: AbortSignal }
  ): Promise<string> {
    throw new Error(`${this.constructor.name} does not support sendStreamingResponse.`);
  }

  /** Return the Twilio-facing WebSocket for a conversation, if tracked. */
  public getWebSocket(_conversationId: ConversationId): WebSocket | null {
    return null;
  }

  /**
   * Drop this provider's transport state on channel shutdown.
   *
   * Called by {@link VoiceChannel.shutdown} before the channel clears its own
   * conversation bookkeeping. Default no-op — providers override this to drop
   * whatever transport state they track. Live WebSocket connections are owned
   * and closed by the server, so an override only clears in-process tracking.
   */
  public shutdown(): void {
    return undefined;
  }

  /**
   * Set callback URLs on `callParams` for every registered call-event handler.
   *
   * A URL is derived only when its handler is registered — an unwanted
   * call-event URL would otherwise surface as silent 11200 alerts for a
   * feature nobody asked for. If TAC isn't serving these routes, set the URLs
   * explicitly via `CallOptions` (or the provider config's default call
   * options, where available). An explicit URL from either options layer is
   * never overwritten.
   */
  protected applyCallEventCallbacks(callParams: Record<string, unknown>): Record<string, unknown> {
    const handlers = this.channel.getCallEventHandlers();
    const wiring: [CallEventKind, string, unknown][] = [
      ['status', 'statusCallback', handlers.status],
      ['amd', 'asyncAmdStatusCallback', handlers.amd],
      ['recording', 'recordingStatusCallback', handlers.recording],
    ];
    for (const [kind, param, handler] of wiring) {
      if (!handler) continue;
      const url = this.channel.getTacConfig().callEventUrl(kind);
      // An explicit URL from either options layer is never overwritten.
      if (url !== undefined && callParams[param] === undefined) {
        callParams[param] = url;
      }
    }
    return callParams;
  }
}

/**
 * Base configuration for a {@link VoiceChannel}'s real-time media provider.
 *
 * Subclasses add their provider's own settings and implement
 * {@link VoiceProviderConfig.createProvider} to build the provider they
 * configure.
 */
export class VoiceProviderConfig {
  /** Memory retrieval mode for this channel. Defaults to `'never'`. */
  public memoryMode: MemoryMode;

  /**
   * The {@link BaseChannelOptions} this config was constructed with, retained
   * verbatim so `VoiceChannel` can hand them to `BaseChannel`.
   *
   * A provider config carries channel-level options (`dedupCapacity` and
   * friends) alongside its own provider settings; without this they would be
   * dropped on the config path while still applying on the plain-object path,
   * which is the same channel configured two ways.
   *
   * @internal
   */
  public readonly channelOptions: BaseChannelOptions;

  constructor(options?: BaseChannelOptions) {
    this.memoryMode = options?.memoryMode ?? 'never';
    this.channelOptions = { ...options };
  }

  /**
   * Build the {@link VoiceProvider} this config configures.
   *
   * @param _channel - The owning `VoiceChannel`.
   * @param _tacConfig - `TACConfig` — providers that talk TwiML need it to
   *   derive default URLs (`voicePublicDomain` etc.).
   */
  public createProvider(_channel: VoiceChannel, _tacConfig: TACConfig): VoiceProvider {
    throw new Error(
      `${this.constructor.name} must implement createProvider() to be usable ` +
        'as a VoiceChannel config.'
    );
  }
}
