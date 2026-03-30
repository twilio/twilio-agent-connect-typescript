import { ConversationId, ProfileId, isConversationId, isProfileId } from '../types/index';
import { BaseChannel, BaseChannelEvents } from './base';
import type { TAC } from '../lib/tac';

/**
 * Messaging webhook event types from Twilio Conversations Service
 * Supports the v2 format for SMS and Chat channels
 */
export interface MessagingWebhookPayload {
  eventType: string;
  timestamp?: string;
  data?: {
    id?: string;
    conversationId?: string;
    accountId?: string;
    serviceId?: string;
    status?: string;
    participantType?: string;
    profileId?: string;
    channelId?: string;
    author?: {
      address?: string;
      channel?: string;
      participantId?: string;
    };
    content?: {
      type?: string;
      text?: string;
    };
    recipients?: Array<{
      address?: string;
      channel?: string;
      participantId?: string;
      deliveryStatus?: string;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Messaging channel event callbacks extending base callbacks
 */
export interface MessagingChannelEvents extends BaseChannelEvents {
  onMessageReceived?: (data: {
    conversationId: ConversationId;
    profileId: ProfileId | undefined;
    message: string;
    author: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Memory structure is dynamic and defined by user
    userMemory: any;
  }) => void;
}

/**
 * Abstract Messaging Channel base class for SMS and Chat channels
 *
 * Provides shared webhook processing logic for messaging channels
 * (SMS and Chat) that use the Conversations Service webhooks.
 */
export abstract class MessagingChannel extends BaseChannel {
  protected readonly messagingCallbacks: MessagingChannelEvents;

  constructor(tac: TAC) {
    super(tac);
    this.messagingCallbacks = {};
  }

  /**
   * Abstract method to check if a message is from the bot itself
   * Subclasses implement channel-specific filtering (e.g., by phone number or agent address)
   */
  protected abstract isOwnMessage(authorAddress: string): boolean;

  /**
   * Register event callbacks (override for messaging-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  public override on(event: string, callback: (...args: any[]) => void): void {
    if (event === 'messageReceived') {
      this.messagingCallbacks.onMessageReceived = callback;
    } else {
      // Delegate to parent for base events
      super.on(event, callback);
    }
  }

  /**
   * Check if this webhook event belongs to this channel.
   * Returns false if the event is clearly for a different channel type.
   */
  private isEventForThisChannel(webhookData: MessagingWebhookPayload): boolean {
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
   * Process messaging channel webhook from Twilio Conversations Service
   */
  public async processWebhook(payload: unknown): Promise<void> {
    this.logger.debug({ operation: 'webhook_processing', payload }, 'Processing webhook');

    try {
      if (!this.validateWebhookPayload(payload)) {
        throw new Error('Invalid webhook payload');
      }

      const webhookData = payload as MessagingWebhookPayload;
      const eventType = webhookData.eventType;
      const conversationId = webhookData.data?.conversationId || webhookData.data?.id;

      // Self-filter: ignore events meant for other channel types
      if (!this.isEventForThisChannel(webhookData)) {
        this.logger.debug(
          { event_type: eventType, channel: this.channelType, conversation_id: conversationId },
          'Ignoring event for different channel type'
        );
        return;
      }

      this.logger.info(
        {
          event_type: eventType,
          raw_event_type: webhookData.eventType,
          conversation_id: conversationId,
        },
        'Processing webhook event'
      );

      switch (eventType) {
        case 'CONVERSATION_CREATED':
          this.logger.debug(
            { conversation_id: conversationId, profile_id: webhookData.data?.profileId },
            'Handling CONVERSATION_CREATED'
          );
          this.handleConversationCreated(webhookData);
          break;

        case 'PARTICIPANT_ADDED':
          this.logger.debug(
            { conversation_id: conversationId, profile_id: webhookData.data?.profileId },
            'Handling PARTICIPANT_ADDED'
          );
          this.handleParticipantAdded(webhookData);
          break;

        case 'COMMUNICATION_CREATED':
          this.logger.debug({ conversation_id: conversationId }, 'Handling COMMUNICATION_CREATED');
          await this.handleCommunicationCreated(webhookData);
          break;

        case 'CONVERSATION_UPDATED':
          this.logger.debug(
            { conversation_id: conversationId, status: webhookData.data?.status },
            'Handling CONVERSATION_UPDATED'
          );
          await this.handleConversationUpdated(webhookData);
          break;

        default:
          this.logger.warn(
            {
              event_type: eventType,
              raw_event_type: webhookData.eventType,
              conversation_id: conversationId,
              payload,
            },
            'Unhandled event type - this event will be ignored'
          );
      }

      this.logger.debug({ event_type: eventType }, 'Webhook processing completed');
    } catch (error) {
      this.logger.error(
        { err: error, operation: 'webhook_processing' },
        'Webhook processing error'
      );
      this.handleError(error instanceof Error ? error : new Error(String(error)), { payload });
    }
  }

  /**
   * Handle conversation creation event
   */
  private handleConversationCreated(payload: MessagingWebhookPayload): void {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);

    if (!conversationId) {
      this.logger.warn(
        { payload, operation: 'handle_conversation_created' },
        'Missing conversation ID in conversation.created event'
      );
      throw new Error('Missing conversation ID in conversation.created event');
    }

    this.startConversation(conversationId, profileId ?? undefined, payload.data?.serviceId);
  }

  /**
   * Handle participant added event
   */
  private handleParticipantAdded(payload: MessagingWebhookPayload): void {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);

    if (!conversationId) {
      this.logger.warn(
        { payload, operation: 'handle_participant_added' },
        'Missing conversation ID in participant.added event'
      );
      throw new Error('Missing conversation ID in participant.added event');
    }

    // Update conversation with profile ID if conversation exists
    if (this.isConversationActive(conversationId)) {
      const session = this.getConversationSession(conversationId);
      if (session) {
        if (profileId) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_profile_id: session.profileId,
              new_profile_id: profileId,
            },
            'Updating conversation profile ID from participant.added'
          );
          session.profileId = profileId;
        }

        if (payload.data?.serviceId && session.serviceId !== payload.data.serviceId) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_service_id: session.serviceId,
              new_service_id: payload.data.serviceId,
            },
            'Updating conversation configuration ID from participant.added'
          );
          session.serviceId = payload.data.serviceId;
        }
      }
    } else {
      // Auto-initialize conversation if not already started
      this.logger.debug(
        { conversation_id: conversationId, profile_id: profileId },
        'Auto-starting conversation from participant.added'
      );
      this.startConversation(conversationId, profileId ?? undefined, payload.data?.serviceId);
    }
  }

  /**
   * Handle new communication event (incoming message)
   */
  private async handleCommunicationCreated(payload: MessagingWebhookPayload): Promise<void> {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    // Extract message text from data.content.text
    const message = payload.data?.content?.text?.trim();
    // Author is in data.author.address
    const author = payload.data?.author?.address || 'unknown';

    this.logger.info(
      {
        conversation_id: conversationId,
        profile_id: profileId,
        author,
        message,
        message_length: message?.length,
        operation: 'handle_communication_created',
      },
      'Handling communication.created'
    );

    if (!conversationId) {
      this.logger.warn(
        { payload, operation: 'handle_communication_created' },
        'Missing conversation ID in communication.created event'
      );
      throw new Error('Missing conversation ID in communication.created event');
    }

    if (!message) {
      this.logger.info({ conversation_id: conversationId }, 'Ignoring empty message');
      return;
    }

    // Filter out messages from the bot itself using subclass-specific logic
    if (this.isOwnMessage(author)) {
      this.logger.info(
        {
          conversation_id: conversationId,
          author_address: author,
        },
        'Ignoring message from AI agent'
      );
      return;
    }

    // Initialize conversation if not already active
    if (!this.isConversationActive(conversationId)) {
      this.logger.debug({ conversation_id: conversationId }, 'Starting new conversation');
      this.startConversation(conversationId, profileId ?? undefined, payload.data?.serviceId);
    } else if (payload.data?.serviceId) {
      const session = this.getConversationSession(conversationId);
      if (session && session.serviceId !== payload.data.serviceId) {
        this.logger.debug(
          {
            conversation_id: conversationId,
            old_service_id: session.serviceId,
            new_service_id: payload.data.serviceId,
          },
          'Updating conversation configuration ID from communication.created'
        );
        session.serviceId = payload.data.serviceId;
      }
    }

    // Get session and update with author info for profile lookup
    const session = this.getConversationSession(conversationId);
    if (session) {
      session.authorInfo = {
        address: author,
        participantId: payload.data?.author?.participantId,
      };

      // Store channelId (Chat Channel SID) in session metadata for reply sending
      if (payload.data?.channelId) {
        if (!session.metadata) {
          session.metadata = {};
        }
        session.metadata.channelId = payload.data.channelId;
        this.logger.debug(
          { conversation_id: conversationId, channel_id: payload.data.channelId },
          'Stored channelId in session metadata'
        );
      }
    }

    // Retrieve user memory using tac.retrieveMemory, which handles profile lookup by address (e.g., phone number or email)
    let userMemory;
    if (session && this.tac.isMemoryEnabled()) {
      this.logger.debug({ conversation_id: conversationId, author }, 'Retrieving user memory');
      try {
        userMemory = await this.tac.retrieveMemory(session, message);
        this.logger.debug(
          { conversation_id: conversationId, profile_id: session.profileId },
          'User memory retrieved'
        );
      } catch (error) {
        this.logger.warn(
          { err: error, conversation_id: conversationId },
          'Failed to retrieve user memory'
        );
      }
    }

    // Invoke message received callback with memory context
    if (this.messagingCallbacks.onMessageReceived) {
      this.logger.debug({ conversation_id: conversationId }, 'Invoking message received callback');
      this.messagingCallbacks.onMessageReceived({
        conversationId,
        profileId: (session?.profileId as ProfileId | undefined) ?? profileId ?? undefined,
        message,
        author,
        userMemory,
      });
    }
  }

  /**
   * Handle conversation updated event
   */
  private async handleConversationUpdated(payload: MessagingWebhookPayload): Promise<void> {
    const conversationId = this.extractConversationId(payload);

    if (!conversationId) {
      throw new Error('Missing conversation ID in conversation.updated event');
    }

    // Check if conversation is closed
    if (payload.data?.status === 'CLOSED') {
      this.logger.info(
        { conversation_id: conversationId, status: payload.data.status },
        'Conversation closed, cleaning up'
      );
      await this.endConversation(conversationId);
    }
  }

  /**
   * Extract conversation ID from webhook payload
   */
  protected extractConversationId(payload: unknown): ConversationId | null {
    const webhookData = payload as MessagingWebhookPayload;
    const conversationId = webhookData.data?.conversationId || webhookData.data?.id;

    if (conversationId && isConversationId(conversationId)) {
      return conversationId;
    }

    return null;
  }

  /**
   * Extract profile ID from webhook payload
   */
  protected extractProfileId(payload: unknown): ProfileId | null {
    const webhookData = payload as MessagingWebhookPayload;
    const profileId = webhookData.data?.profileId;

    if (profileId && isProfileId(profileId)) {
      this.logger.debug(
        { profile_id: profileId, conversation_id: webhookData.data?.conversationId },
        'Extracted profile ID from webhook payload'
      );
      return profileId;
    }

    this.logger.debug(
      { conversation_id: webhookData.data?.conversationId },
      'Profile ID missing or invalid in webhook payload'
    );
    return null;
  }

  /**
   * Validate messaging channel webhook payload structure
   */
  protected override validateWebhookPayload(payload: unknown): boolean {
    if (!super.validateWebhookPayload(payload)) {
      return false;
    }

    const webhookData = payload as MessagingWebhookPayload;
    return (
      typeof webhookData === 'object' &&
      typeof webhookData.eventType === 'string' &&
      webhookData.eventType.length > 0
    );
  }
}
