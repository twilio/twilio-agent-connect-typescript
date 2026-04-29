import {
  ConversationSession,
  ChannelType,
  ConversationId,
  ProfileId,
  ConversationsWebhookPayload,
} from '../types/index';
import { TACConfig } from '../lib/config';
import { ConversationClient } from '../clients/conversation';
import { Logger } from '../lib/logger';
import type { TAC } from '../lib/tac';

/**
 * Base channel configuration options
 */
export interface BaseChannelConfig {
  /** Maximum number of idempotency tokens to track for deduplication (default: 10,000) */
  dedupCapacity?: number;
}

const DEFAULT_DEDUP_CAPACITY = 10_000;

/**
 * Base channel event callbacks
 */
export interface BaseChannelEvents {
  onConversationStarted?: (data: { session: ConversationSession }) => void;
  onConversationEnded?: (data: { session: ConversationSession }) => Promise<void> | void;
  onError?: (data: { error: Error; context?: Record<string, unknown> }) => void;
}

/**
 * Abstract base class for all channel implementations
 *
 * Provides common functionality for conversation lifecycle management,
 * session tracking, and shared utilities across different channel types.
 */
export abstract class BaseChannel {
  protected readonly tac: TAC;
  protected readonly config: TACConfig;
  protected readonly logger: Logger;
  protected readonly conversationClient: ConversationClient;
  protected readonly activeConversations: Map<ConversationId, ConversationSession>;
  protected readonly callbacks: BaseChannelEvents;
  private readonly processedTokens = new Set<string>();
  private readonly maxTrackedTokens: number;

  constructor(tac: TAC, channelConfig?: BaseChannelConfig) {
    this.tac = tac;
    this.config = tac.getConfig();
    this.logger = tac.logger.child({ component: 'channel' });
    this.conversationClient = tac.getConversationClient();
    this.activeConversations = new Map();
    this.callbacks = {};
    const capacity = channelConfig?.dedupCapacity ?? DEFAULT_DEDUP_CAPACITY;
    if (capacity < 1 || !Number.isInteger(capacity)) {
      throw new Error('dedupCapacity must be a positive integer');
    }
    this.maxTrackedTokens = capacity;
  }

  /**
   * Get the channel type (implemented by subclasses)
   */
  public abstract get channelType(): ChannelType;

  /**
   * Check if a webhook has already been processed, and if not, record the token immediately.
   * This is intentionally a single synchronous check-and-record to prevent race conditions
   * where a duplicate arrives while the first request is still awaiting async work.
   * Uses a sliding window with FIFO eviction at capacity.
   */
  protected isDuplicateWebhook(idempotencyToken: string): boolean {
    if (this.processedTokens.has(idempotencyToken)) {
      return true;
    }

    if (this.processedTokens.size >= this.maxTrackedTokens) {
      const oldest = this.processedTokens.values().next().value!;
      this.processedTokens.delete(oldest);
    }

    this.processedTokens.add(idempotencyToken);
    return false;
  }

  /**
   * Remove a token from the processed set (e.g., when processing fails and should be retried)
   */
  protected removeProcessedToken(idempotencyToken: string): void {
    this.processedTokens.delete(idempotencyToken);
  }

  /**
   * Check if this webhook event belongs to this channel.
   * Returns false if the event is clearly for a different channel type.
   *
   * This method enables webhook fanout: multiple channel instances can receive
   * the same webhook, and each self-filters based on channel-specific logic.
   */
  protected isEventForThisChannel(webhookData: ConversationsWebhookPayload): boolean {
    const eventType = webhookData.eventType;
    const authorChannel = webhookData.data?.author?.channel;

    // COMMUNICATION_CREATED: require author.channel for safe filtering
    // Reject events without channel to prevent fanout crosstalk
    if (eventType === 'COMMUNICATION_CREATED') {
      if (!authorChannel) {
        return false; // Missing channel - cannot safely determine ownership
      }
      return authorChannel === this.channelType.toUpperCase();
    }

    // CONVERSATION_UPDATED: only process if this channel tracks the conversation
    if (eventType === 'CONVERSATION_UPDATED') {
      const conversationId = this.extractConversationId(webhookData);
      if (conversationId && !this.isConversationActive(conversationId)) {
        return false;
      }
    }

    return true;
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
   * @param payload - The webhook payload to process
   * @param idempotencyToken - Optional idempotency token for deduplication
   */
  public abstract processWebhook(payload: unknown, idempotencyToken?: string): Promise<void>;

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
    this.logger.error({ err: error, ...context }, 'Channel error');

    if (this.callbacks.onError) {
      if (context) {
        this.callbacks.onError({ error, context });
      } else {
        this.callbacks.onError({ error });
      }
    }
  }

  /**
   * Validate webhook payload (override in subclasses for specific validation)
   */
  protected validateWebhookPayload(payload: unknown): boolean {
    return payload !== null && payload !== undefined;
  }

  /**
   * Extract conversation ID from webhook payload (implemented by subclasses)
   */
  protected abstract extractConversationId(payload: unknown): ConversationId | null;

  /**
   * Extract profile ID from webhook payload (implemented by subclasses)
   */
  protected abstract extractProfileId(payload: unknown): ProfileId | null;

  /**
   * Cleanup resources when shutting down
   */
  public shutdown(): void {
    this.activeConversations.clear();
    this.processedTokens.clear();
    delete this.callbacks.onConversationStarted;
    delete this.callbacks.onConversationEnded;
    delete this.callbacks.onError;
  }
}
