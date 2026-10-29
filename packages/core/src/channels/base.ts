import {
  ConversationSession,
  ChannelType,
  ConversationId,
  ConversationWebhookPayload,
  ConversationParticipantSchema,
  MemoryMode,
  MemoryModeSchema,
  isConversationId,
  isProfileId,
  ProfileId,
} from '../types/index';
import { TACConfig } from '../lib/config';
import { ConversationClient } from '../clients/conversation';
import { Logger } from '../lib/logger';
import { trackEvent } from '../lib/analytics';
import type { TAC } from '../lib/tac';
import { TACMemoryResponse } from '../lib/tac-memory-response';
import { resolveOutboundSender } from '../util/outbound-sender';

/**
 * Base channel event callbacks
 */
export interface BaseChannelEvents {
  onConversationStarted?: (data: { session: ConversationSession }) => void;
  onConversationEnded?: (data: { session: ConversationSession }) => Promise<void> | void;
  onError?: (data: { error: Error; context?: Record<string, unknown> }) => void;
}

/**
 * Base channel options
 */
export interface BaseChannelOptions {
  /**
   * Memory retrieval mode for this channel. Default is "never".
   *
   * - "never": Memory is not automatically retrieved. Use the memory TAC tool or manually call `tac.retrieveMemory()` in callbacks for conditional retrieval.
   * - "always": Memory is automatically retrieved (using the message as query) for every inbound message and available in `onMessageReady` callback.
   * - "once" (Voice only): Memory is retrieved once at conversation start with no query (and no conversation id) and cached on the session. Subsequent prompts reuse the cache until the conversation becomes INACTIVE. Deprecated on messaging channels (removed in 3.0), which run it as "always".
   */
  memoryMode?: MemoryMode;

  /**
   * Maximum number of idempotency tokens to track for webhook deduplication.
   * Default is 10000. Must be a positive integer.
   */
  dedupCapacity?: number;
}

/**
 * Abstract base class for all channel implementations
 *
 * Provides only what every channel family shares: webhook deduplication,
 * event filtering to prevent cross-channel fanout, lifecycle analytics from
 * Conversation Orchestrator webhooks, memory retrieval, and error handling.
 *
 * Session storage deliberately isn't here. `VoiceChannel` owns its sessions (a
 * call is pinned to the process holding its WebSocket); messaging channels
 * derive a session per webhook and hold nothing between them.
 *
 * Subclasses must implement channel-specific webhook processing and message sending.
 */
export abstract class BaseChannel {
  protected readonly tac: TAC;
  protected readonly config: TACConfig;
  protected readonly logger: Logger;
  protected readonly conversationClient: ConversationClient | null;
  protected readonly callbacks: BaseChannelEvents;
  /** TAC's forwarder to `tac.onConversationEnded`, while it fills the slot. */
  private tacConversationEndedForwarder: BaseChannelEvents['onConversationEnded'];
  protected readonly memoryMode: MemoryMode;
  private readonly processedWebhookTokens: Set<string>;
  private readonly maxTrackedTokens: number;

  constructor(tac: TAC, options?: BaseChannelOptions) {
    this.tac = tac;
    this.config = tac.getConfig();
    this.logger = tac.logger.child({ component: 'channel' });
    this.conversationClient = tac.getConversationClient();
    this.callbacks = {};

    // Validate memoryMode with runtime check for JS consumers
    const providedMode = options?.memoryMode;
    const modeToValidate = providedMode === undefined ? 'never' : providedMode;
    const parseResult = MemoryModeSchema.safeParse(modeToValidate);
    if (!parseResult.success) {
      throw new Error(
        `Invalid memoryMode: "${modeToValidate}". Must be "always", "once", or "never".`
      );
    }
    this.memoryMode = parseResult.data;

    // Validate and set deduplication capacity
    const capacity = options?.dedupCapacity ?? 10000;
    if (capacity < 1 || !Number.isInteger(capacity)) {
      throw new Error('dedupCapacity must be a positive integer');
    }
    this.maxTrackedTokens = capacity;
    this.processedWebhookTokens = new Set();
  }

  /**
   * Get the channel type (implemented by subclasses)
   */
  public abstract get channelType(): ChannelType;

  /**
   * Resolve the outbound sender address for this channel.
   *
   * `requested` (the caller's `options.from`) wins when it is one of the
   * channel's configured senders; otherwise throws. When omitted, the channel
   * default is used.
   */
  protected resolveOutboundFrom(
    requested: string | undefined,
    options: { allowlist: string[]; default: string | undefined }
  ): string {
    return resolveOutboundSender(requested, { ...options, channel: this.channelType });
  }

  /**
   * Register event callbacks
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  public on(event: string, callback: (...args: any[]) => void): void {
    switch (event) {
      case 'conversationStarted':
        this.callbacks.onConversationStarted = callback;
        break;
      case 'conversationEnded':
        this.callbacks.onConversationEnded = callback;
        break;
      case 'error':
        this.callbacks.onError = callback;
        break;
    }
  }

  /**
   * Process incoming webhook data (implemented by subclasses)
   */
  public abstract processWebhook(payload: unknown): Promise<void>;

  /**
   * Send a response back to the user (implemented by subclasses).
   *
   * Accepts the conversation id or the turn's `ConversationSession`; messaging
   * channels send straight from a session, and rebuild one from the id.
   */
  public abstract sendResponse(
    conversationId: ConversationId | ConversationSession,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Get a live conversation session held by this channel.
   *
   * Only `VoiceChannel` holds sessions (a call is pinned to one process); the
   * default returns `undefined`.
   */
  public getConversationSession(_conversationId: ConversationId): ConversationSession | undefined {
    return undefined;
  }

  /**
   * Check if this channel holds a live session for a conversation. Only
   * `VoiceChannel` holds sessions; the default returns `false`.
   */
  public isConversationActive(_conversationId: ConversationId): boolean {
    return false;
  }

  /**
   * This channel's type as Conversation Orchestrator writes it on participant
   * addresses (`SMS`, `WHATSAPP`, `VOICE`, …).
   *
   * @internal
   */
  protected get coChannel(): string {
    return this.channelType.toUpperCase();
  }

  /**
   * Whether `address` is TAC's own address on this channel. Channels override
   * this; the default claims no address.
   *
   * @internal
   */
  protected isOwnCoAddress(_address: string): boolean {
    return false;
  }

  /**
   * Report "Conversation Started" from a CO `PARTICIPANT_ADDED` event.
   *
   * Counts the customer joining on this channel: a `CUSTOMER`, or an `UNKNOWN`
   * participant that isn't TAC's own address (capture can add the customer
   * untyped). Each channel reports only its own channel type, so a webhook
   * handed to every channel counts once per channel.
   *
   * @internal
   */
  protected trackConversationStarted(eventData: unknown): void {
    const parsed = ConversationParticipantSchema.safeParse(eventData);
    if (!parsed.success) {
      this.logger.warn(
        { validation_errors: parsed.error.issues },
        'Skipping unparseable PARTICIPANT_ADDED payload'
      );
      return;
    }
    const participant = parsed.data;
    if (participant.type !== 'CUSTOMER' && participant.type !== 'UNKNOWN') {
      return;
    }
    const addresses = participant.addresses
      .filter(a => a.channel === this.coChannel)
      .map(a => a.address);
    if (addresses.length === 0) {
      return;
    }
    if (participant.type === 'UNKNOWN' && addresses.some(a => this.isOwnCoAddress(a))) {
      return;
    }
    trackEvent('Conversation Started', {
      account_sid: this.config.accountSid,
      channel: this.channelType,
      conversation_id: participant.conversationId,
      has_profile_id: !!participant.profileId,
    });
  }

  /**
   * Report "Conversation Ended" for a conversation CO closed.
   *
   * Reported once per process across channels, without a `channel` — see
   * `TAC.reportConversationEnded`. `durationMs` is CO's `updatedAt −
   * createdAt`; `undefined` leaves it out rather than guessing.
   *
   * @internal
   */
  protected trackConversationEnded(conversationId: string, durationMs: number | undefined): void {
    this.tac.reportConversationEnded(conversationId, durationMs);
  }

  /**
   * Whether anything would receive `onConversationEnded`. Channels check this
   * before rebuilding a closed conversation's session from Conversation
   * Orchestrator: with no handler, there is nothing to hand it to.
   *
   * Registering with TAC fills the slot with a forwarder to
   * `tac.onConversationEnded`; while that forwarder is installed, ask TAC. A
   * handler set with `channel.on('conversationEnded', ...)` — before or after
   * registration — replaces it and counts on its own.
   *
   * @internal
   */
  protected hasConversationEndedHandler(): boolean {
    const handler = this.callbacks.onConversationEnded;
    if (!handler) {
      return false;
    }
    if (handler !== this.tacConversationEndedForwarder) {
      return true;
    }
    return this.tac.hasConversationEndedCallback();
  }

  /**
   * Install TAC's forwarder to `tac.onConversationEnded` in this channel's
   * slot, remembering it so {@link hasConversationEndedHandler} can tell it
   * apart from a handler registered directly on the channel.
   *
   * @internal
   */
  public setConversationEndedForwarderInternal(
    forwarder: NonNullable<BaseChannelEvents['onConversationEnded']>
  ): void {
    this.callbacks.onConversationEnded = forwarder;
    this.tacConversationEndedForwarder = forwarder;
  }

  /**
   * Fire `onConversationEnded` for a session, swallowing handler errors.
   *
   * A developer callback throwing must not abort the channel's own cleanup or
   * fail the webhook, so the error is logged and dropped here.
   *
   * @internal
   */
  protected async triggerConversationEnded(session: ConversationSession): Promise<void> {
    if (!this.callbacks.onConversationEnded) {
      return;
    }
    try {
      await this.callbacks.onConversationEnded({ session });
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: session.conversationId },
        'Error in conversation ended callback'
      );
    }
  }

  /**
   * Handle errors with proper context
   */
  protected handleError(error: Error, context?: Record<string, unknown>): void {
    this.logger.error({ err: error }, 'Channel error');

    if (this.callbacks.onError) {
      if (context) {
        this.callbacks.onError({ error, context });
      } else {
        this.callbacks.onError({ error });
      }
    }
  }

  /**
   * Check if a webhook has already been processed using Twilio's idempotency token.
   * Uses a sliding window with fixed capacity to track tokens (FIFO eviction).
   *
   * This is intentionally a single synchronous check-and-record to prevent race conditions
   * where a duplicate arrives while the first request is still awaiting async work.
   */
  protected isDuplicateWebhook(idempotencyToken: string): boolean {
    if (this.processedWebhookTokens.has(idempotencyToken)) {
      return true;
    }

    if (this.processedWebhookTokens.size >= this.maxTrackedTokens) {
      const oldest = this.processedWebhookTokens.values().next().value!;
      this.processedWebhookTokens.delete(oldest);
    }

    this.processedWebhookTokens.add(idempotencyToken);
    return false;
  }

  /**
   * Remove an idempotency token from the deduplication cache.
   * Used when webhook processing fails and retries should not be blocked.
   */
  protected removeWebhookToken(idempotencyToken: string): void {
    this.processedWebhookTokens.delete(idempotencyToken);
  }

  /**
   * Self-filtering: check if webhook event belongs to this channel.
   *
   * - COMMUNICATION_CREATED: require author.channel matches this channel type
   * - Other events pass through, including CONVERSATION_UPDATED — the
   *   per-channel handler filters that one. Filtering it here on locally
   *   tracked state would drop it on any instance that didn't serve the
   *   conversation's messages.
   */
  protected isEventForThisChannel(webhookData: ConversationWebhookPayload): boolean {
    const eventType = webhookData.eventType;
    const authorChannel = webhookData.data?.author?.channel;

    // COMMUNICATION_CREATED: require author.channel for safe filtering
    // Reject events without channel to prevent fanout crosstalk
    if (eventType === 'COMMUNICATION_CREATED') {
      if (!authorChannel) {
        return false;
      }
      return authorChannel === this.channelType.toUpperCase();
    }

    return true;
  }

  /**
   * Validate webhook payload (override in subclasses for specific validation)
   */
  protected validateWebhookPayload(payload: unknown): boolean {
    return payload !== null && payload !== undefined;
  }

  /**
   * Preprocess webhook before handling event-specific logic.
   * Handles deduplication, validation, filtering, and data extraction.
   *
   * @param payload - Raw webhook payload from Twilio
   * @param idempotencyToken - Optional idempotency token for deduplication
   * @returns Preprocessed webhook data, or null if webhook should be skipped
   */
  protected preprocessWebhook(
    payload: unknown,
    idempotencyToken: string | undefined
  ): {
    webhookData: ConversationWebhookPayload;
    eventType: string;
    conversationId: string | undefined;
  } | null {
    this.logger.debug({ operation: 'webhook_processing' }, 'Processing webhook');

    if (idempotencyToken && this.isDuplicateWebhook(idempotencyToken)) {
      this.logger.debug({ idempotency_token: idempotencyToken }, 'Skipping duplicate webhook');
      return null;
    }

    if (!this.validateWebhookPayload(payload)) {
      throw new Error('Invalid webhook payload');
    }

    const webhookData = payload as ConversationWebhookPayload;
    const eventType = webhookData.eventType;
    const conversationId = webhookData.data?.conversationId || webhookData.data?.id;

    // Self-filter: ignore events meant for other channel types
    if (!this.isEventForThisChannel(webhookData)) {
      this.logger.debug(
        { event_type: eventType, channel: this.channelType, conversation_id: conversationId },
        'Ignoring event for different channel type'
      );
      return null;
    }

    return { webhookData, eventType, conversationId };
  }

  /**
   * Extract conversation ID from webhook payload with type validation.
   *
   * Extracts conversationId from webhookData.data?.conversationId || webhookData.data?.id,
   * validates the value is a non-empty string, and ensures it passes isConversationId check.
   *
   * This prevents invalid IDs from causing downstream issues like incorrect Map key
   * matching in CONVERSATION_UPDATED self-filtering or propagating malformed IDs.
   */
  protected extractConversationId(payload: unknown): ConversationId | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const webhookData = payload as ConversationWebhookPayload;
    const conversationId = webhookData.data?.conversationId || webhookData.data?.id;

    // Validate type and format before casting to ConversationId
    if (conversationId && typeof conversationId === 'string' && isConversationId(conversationId)) {
      return conversationId;
    }

    return null;
  }

  /**
   * Extract profile ID from webhook payload with type validation.
   *
   * Extracts profileId from webhookData.data?.profileId,
   * validates the value is a non-empty string, and ensures it passes isProfileId check.
   *
   * This prevents invalid IDs from propagating downstream and ensures consistent
   * validation across all channel types.
   */
  protected extractProfileId(payload: unknown): ProfileId | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const webhookData = payload as ConversationWebhookPayload;
    const profileId = webhookData.data?.profileId;

    // Validate type and format before casting to ProfileId
    if (profileId && typeof profileId === 'string' && isProfileId(profileId)) {
      return profileId;
    }

    return null;
  }

  /**
   * Retrieve memory according to the channel's memoryMode.
   *
   * This method handles the common logic for memory retrieval across all channels,
   * including error handling and debug logging.
   *
   * Modes:
   * - "always": Fetch with the provided query on every message.
   * - "once": Fetch once with neither a query nor a conversation id (skipping
   *   query expansion) and cache the result on the session. Subsequent calls
   *   reuse the cache until it is invalidated on the INACTIVE transition.
   * - "never": Skip retrieval.
   *
   * Memory retrieval failures are logged and swallowed so message processing
   * continues without memory context.
   */
  protected async retrieveMemoryIfEnabled(
    session: ConversationSession,
    query?: string
  ): Promise<TACMemoryResponse | undefined> {
    // "never" and any unexpected value: no automatic retrieval
    if (this.memoryMode !== 'always' && this.memoryMode !== 'once') {
      return undefined;
    }

    // "once" mode reuses cached memory across messages.
    if (this.memoryMode === 'once' && session.cachedMemory !== undefined) {
      this.logger.debug({ conversation_id: session.conversationId }, 'Reusing cached memory');
      return session.cachedMemory;
    }

    try {
      // "always" sends query + conversation id so Memory ranks by relevance.
      // "once" sends neither: with no query, a conversation id only buys
      // Memory's expensive server-side query expansion.
      const isAlways = this.memoryMode === 'always';
      const memory = await this.tac.retrieveMemory(
        session,
        isAlways ? query : undefined,
        isAlways ? session.conversationId : undefined
      );
      if (this.memoryMode === 'once') {
        session.cachedMemory = memory;
      }
      this.logger.debug(
        { conversation_id: session.conversationId, memory_mode: this.memoryMode },
        'Memory retrieved'
      );
      return memory;
    } catch (error) {
      this.logger.warn(
        { err: error, conversation_id: session.conversationId },
        'Failed to retrieve memory, continuing without memory context'
      );
      // Continue without memory rather than failing entire message processing
      return undefined;
    }
  }

  /**
   * Cleanup resources when shutting down
   */
  public shutdown(): void {
    delete this.callbacks.onConversationStarted;
    delete this.callbacks.onConversationEnded;
    delete this.callbacks.onError;
    this.tacConversationEndedForwarder = undefined;
  }
}
