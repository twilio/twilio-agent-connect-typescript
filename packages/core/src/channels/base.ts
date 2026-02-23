import { ConversationSession, ChannelType, ConversationId, ProfileId } from '../types/index';
import { TACConfig } from '../lib/config';
import { ConversationClient } from '../clients/conversation';
import { Logger } from '../lib/logger';
import type { TAC } from '../lib/tac';

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

  constructor(tac: TAC) {
    this.tac = tac;
    this.config = tac.getConfig();
    this.logger = tac.logger.child({ component: 'channel' });
    this.conversationClient = new ConversationClient(this.config);
    this.activeConversations = new Map();
    this.callbacks = {};
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
          profile_id: this.activeConversations.get(conversationId)?.profile_id,
          service_id: this.activeConversations.get(conversationId)?.service_id,
        },
        'Conversation already active'
      );
      return this.activeConversations.get(conversationId)!;
    }

    const session: ConversationSession = {
      conversation_id: conversationId,
      profile_id: profileId,
      service_id: serviceId,
      channel: this.channelType,
      started_at: new Date(),
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
          service_id: session.service_id,
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
    delete this.callbacks.onConversationStarted;
    delete this.callbacks.onConversationEnded;
    delete this.callbacks.onError;
  }
}
