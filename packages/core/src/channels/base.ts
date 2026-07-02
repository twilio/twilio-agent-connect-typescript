import {
  ConversationSession,
  ChannelType,
  ConversationId,
  ConversationWebhookPayload,
  ProfileId,
  MemoryMode,
  MemoryModeSchema,
  isConversationId,
  isProfileId,
} from '../types/index';
import { TACConfig } from '../lib/config';
import { ConversationClient } from '../clients/conversation';
import { Logger } from '../lib/logger';
import type { TAC } from '../lib/tac';
import { TACMemoryResponse } from '../lib/tac-memory-response';

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
   * - "once": Memory is retrieved once at conversation start with an empty query and cached on the session. Subsequent messages reuse the cache until the conversation becomes INACTIVE.
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
 * Provides common functionality for:
 * - Conversation lifecycle management and session tracking
 * - Webhook deduplication using Twilio idempotency tokens
 * - Event filtering to prevent cross-channel fanout
 * - Memory retrieval integration
 * - Error handling and logging
 *
 * Subclasses must implement channel-specific webhook processing and message sending.
 */
export abstract class BaseChannel {
  protected readonly tac: TAC;
  protected readonly config: TACConfig;
  protected readonly logger: Logger;
  protected readonly conversationClient: ConversationClient | null;
  protected readonly activeConversations: Map<ConversationId, ConversationSession>;
  protected readonly callbacks: BaseChannelEvents;
  protected readonly memoryMode: MemoryMode;
  private readonly processedWebhookTokens: Set<string>;
  private readonly maxTrackedTokens: number;

  constructor(tac: TAC, options?: BaseChannelOptions) {
    this.tac = tac;
    this.config = tac.getConfig();
    this.logger = tac.logger.child({ component: 'channel' });
    this.conversationClient = tac.getConversationClient();
    this.activeConversations = new Map();
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
   * Send a response back to the user (implemented by subclasses)
   */
  public abstract sendResponse(
    conversationId: ConversationId,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Start a new conversation session
   */
  protected startConversation(
    conversationId: ConversationId,
    profileId?: ProfileId,
    serviceId?: string
  ): ConversationSession {
    if (this.activeConversations.has(conversationId)) {
      this.logger.debug(
        {
          conversation_id: conversationId,
          profile_id: this.activeConversations.get(conversationId)?.profileId,
          service_id: this.activeConversations.get(conversationId)?.serviceId,
        },
        'Conversation already active'
      );
      return this.activeConversations.get(conversationId)!;
    }

    const session: ConversationSession = {
      conversationId: conversationId,
      profileId: profileId,
      serviceId: serviceId,
      channel: this.channelType,
      startedAt: new Date(),
      metadata: {},
    };

    this.activeConversations.set(conversationId, session);

    this.logger.debug(
      {
        conversation_id: conversationId,
        profile_id: profileId,
        service_id: serviceId,
        channel: this.channelType,
      },
      'Conversation started'
    );

    if (this.callbacks.onConversationStarted) {
      this.callbacks.onConversationStarted({ session });
    }

    return session;
  }

  /**
   * End a conversation session.
   *
   * Triggers the onConversationEnded callback BEFORE removing the session,
   * so the callback receives the full ConversationSession data.
   * Errors in the callback do not prevent session cleanup.
   */
  protected async endConversation(conversationId: ConversationId): Promise<void> {
    const session = this.activeConversations.get(conversationId);

    if (session) {
      // Trigger callback BEFORE deleting the session
      if (this.callbacks.onConversationEnded) {
        try {
          await this.callbacks.onConversationEnded({ session });
        } catch (error) {
          this.logger.error(
            { err: error, conversation_id: conversationId },
            'Error in conversation ended callback'
          );
        }
      }

      this.activeConversations.delete(conversationId);
      this.logger.debug(
        {
          conversation_id: conversationId,
          channel: this.channelType,
          service_id: session.serviceId,
        },
        'Conversation ended'
      );
    } else {
      this.logger.debug(
        { conversation_id: conversationId, channel: this.channelType },
        'Conversation end requested but no active session found'
      );
    }
  }

  /**
   * Get an active conversation session
   */
  public getConversationSession(conversationId: ConversationId): ConversationSession | undefined {
    return this.activeConversations.get(conversationId);
  }

  /**
   * Check if a conversation is active
   */
  public isConversationActive(conversationId: ConversationId): boolean {
    return this.activeConversations.has(conversationId);
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
   * - CONVERSATION_UPDATED: only process if conversation is tracked locally
   * - Other events: pass through
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

    // CONVERSATION_UPDATED: only process if this channel tracks the conversation
    if (eventType === 'CONVERSATION_UPDATED') {
      const conversationId = this.extractConversationId(webhookData);
      if (conversationId && !this.activeConversations.has(conversationId)) {
        return false;
      }
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
   * - "once": Fetch once with an empty query and cache the result on the
   *   session. Subsequent calls reuse the cache until it is invalidated on the
   *   INACTIVE transition. Concurrent first-fetches are not serialized: if two
   *   messages arrive before the first fetch resolves, both fetch and the last
   *   write wins — a rare, harmless extra request rather than a bug.
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
      this.logger.debug({ conversation_id: session.conversationId }, 'Using cached memory');
      return session.cachedMemory;
    }

    try {
      // "always" uses the message as query; "once" fetches with an empty query.
      const memory = await this.tac.retrieveMemory(
        session,
        this.memoryMode === 'always' ? query : undefined
      );
      if (this.memoryMode === 'once') {
        session.cachedMemory = memory;
      }
      this.logger.debug(
        { conversation_id: session.conversationId },
        'Memory retrieved successfully'
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
   * Invalidate cached memory for "once" mode when a conversation becomes
   * INACTIVE. Conversation Orchestrator updates memory on the INACTIVE
   * transition, so the next message re-fetches fresh memory. No-op for other
   * memory modes.
   */
  protected invalidateCachedMemory(conversationId: ConversationId): void {
    if (this.memoryMode !== 'once') {
      return;
    }

    const session = this.activeConversations.get(conversationId);
    if (session?.cachedMemory !== undefined) {
      session.cachedMemory = undefined;
      this.logger.debug(
        { conversation_id: conversationId },
        'Invalidated cached memory on INACTIVE status'
      );
    }
  }

  /**
   * Cleanup resources when shutting down
   */
  public shutdown(): void {
    this.activeConversations.clear();
    delete this.callbacks.onConversationStarted;
    delete this.callbacks.onConversationEnded;
    delete this.callbacks.onError;
  }
}
