import Twilio from 'twilio';
import {
  ChannelType,
  ConversationId,
  ProfileId,
  isConversationId,
  isProfileId,
} from '../types/index';
import { BaseChannel, BaseChannelEvents } from './base';
import type { TAC } from '../lib/tac';

/**
 * SMS webhook event types from Twilio Conversations Service
 * Supports the actual v2 format being received from Twilio
 */
interface SMSWebhookPayload {
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
 * SMS channel event callbacks extending base callbacks
 */
export interface SMSChannelEvents extends BaseChannelEvents {
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
 * SMS Channel implementation for Twilio Conversations Service
 *
 * Handles SMS conversations through webhook events from Twilio.
 * Automatically retrieves user memory and manages conversation lifecycle.
 */
export class SMSChannel extends BaseChannel {
  private readonly twilioClient: ReturnType<typeof Twilio>;
  private readonly smsCallbacks: SMSChannelEvents;

  constructor(tac: TAC) {
    super(tac);
    this.twilioClient = Twilio(this.config.twilioAccountSid, this.config.twilioAuthToken);
    this.smsCallbacks = {};
  }

  public get channelType(): ChannelType {
    return 'sms';
  }

  /**
   * Register event callbacks (override for SMS-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  public override on(event: string, callback: (...args: any[]) => void): void {
    if (event === 'messageReceived') {
      this.smsCallbacks.onMessageReceived = callback;
    } else {
      // Delegate to parent for base events
      super.on(event, callback);
    }
  }

  /**
   * Process SMS webhook from Twilio Conversations Service
   */
  public async processWebhook(payload: unknown): Promise<void> {
    this.logger.debug({ operation: 'webhook_processing', payload }, 'Processing webhook');

    try {
      if (!this.validateWebhookPayload(payload)) {
        throw new Error('Invalid webhook payload');
      }

      const webhookData = payload as SMSWebhookPayload;
      const eventType = webhookData.eventType;
      const conversationId = webhookData.data?.conversationId || webhookData.data?.id;

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
          this.handleConversationUpdated(webhookData);
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
  private handleConversationCreated(payload: SMSWebhookPayload): void {
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
  private handleParticipantAdded(payload: SMSWebhookPayload): void {
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
      if (profileId) {
        const session = this.getConversationSession(conversationId);
        if (session) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_profile_id: session.profile_id,
              new_profile_id: profileId,
            },
            'Updating conversation profile ID from participant.added'
          );
          session.profile_id = profileId;
        }
      }

      if (payload.data?.serviceId) {
        const session = this.getConversationSession(conversationId);
        if (session && session.service_id !== payload.data.serviceId) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_service_id: session.service_id,
              new_service_id: payload.data.serviceId,
            },
            'Updating conversation configuration ID from participant.added'
          );
          session.service_id = payload.data.serviceId;
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
  private async handleCommunicationCreated(payload: SMSWebhookPayload): Promise<void> {
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

    // Filter out messages from our own phone number (AI agent responses)
    if (author === this.config.twilioPhoneNumber) {
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
      if (session && session.service_id !== payload.data.serviceId) {
        this.logger.debug(
          {
            conversation_id: conversationId,
            old_service_id: session.service_id,
            new_service_id: payload.data.serviceId,
          },
          'Updating conversation configuration ID from communication.created'
        );
        session.service_id = payload.data.serviceId;
      }
    }

    // Retrieve user memory if profile ID is available and memory client is initialized
    let userMemory;
    const memoryClient = this.tac.getMemoryClient();
    if (profileId && memoryClient && this.config.memoryStoreId) {
      this.logger.debug(
        { profile_id: profileId, conversation_id: conversationId },
        'Retrieving user memory'
      );
      try {
        userMemory = await memoryClient.retrieveMemories(this.config.memoryStoreId, profileId);
        this.logger.debug({ profile_id: profileId }, 'User memory retrieved');
      } catch (error) {
        this.logger.warn({ err: error, profile_id: profileId }, 'Failed to retrieve user memory');
      }
    }

    // Invoke message received callback with memory context
    if (this.smsCallbacks.onMessageReceived) {
      this.logger.debug({ conversation_id: conversationId }, 'Invoking message received callback');
      this.smsCallbacks.onMessageReceived({
        conversationId,
        profileId: profileId ?? undefined,
        message,
        author,
        userMemory,
      });
    }
  }

  /**
   * Handle conversation updated event
   */
  private handleConversationUpdated(payload: SMSWebhookPayload): void {
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
      this.endConversation(conversationId);
    }
  }

  /**
   * Send SMS response using Twilio Messages API
   * Note: This is a workaround until Conversations Service supports sending messages
   */
  public async sendResponse(
    conversationId: ConversationId,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.logger.debug(
      {
        conversation_id: conversationId,
        message_length: message.length,
        operation: 'send_response',
      },
      'Sending SMS response'
    );

    try {
      const session = this.getConversationSession(conversationId);

      if (!session) {
        throw new Error(`No active session found for conversation ${conversationId}`);
      }

      // TODO: Temporary workaround until Conversations Service supports direct message sending.
      // Replace with proper Conversations Service API when available.
      // Defensively go from conversation_id -> participant -> address -> phone number
      try {
        this.logger.debug(
          { conversation_id: conversationId },
          'Listing participants for conversation'
        );
        const participants = await this.conversationClient.listParticipants(conversationId);

        this.logger.debug(
          {
            conversation_id: conversationId,
            participant_count: participants.length,
            service_id: session.service_id ?? this.config.conversationServiceId,
          },
          'Found participants'
        );

        let messagesSent = 0;
        for (const participant of participants) {
          if (participant.type !== 'CUSTOMER') {
            this.logger.debug(
              { participant_type: participant.type },
              'Skipping non-customer participant'
            );
            continue;
          }

          // Check addresses array (Conversations Service API format)
          const addresses = participant.addresses || [];
          this.logger.debug(
            { addresses_count: addresses.length },
            'Checking participant addresses'
          );

          for (const addr of addresses) {
            if (addr.channel !== 'SMS') {
              this.logger.debug({ channel: addr.channel }, 'Skipping non-SMS address');
              continue;
            }

            this.logger.debug(
              { to_address: addr.address, from_number: this.config.twilioPhoneNumber },
              'Sending SMS'
            );

            await this.twilioClient.messages.create({
              to: addr.address,
              from: this.config.twilioPhoneNumber,
              body: message,
            });

            this.logger.info(
              { conversation_id: conversationId, to_address: addr.address },
              'SMS sent successfully'
            );
            messagesSent++;
          }
        }

        if (messagesSent === 0) {
          this.logger.warn(
            { conversation_id: conversationId },
            'No SMS addresses found for any CUSTOMER participants'
          );
        }
      } catch (error) {
        this.logger.error(
          { err: error, conversation_id: conversationId },
          'Failed to list participants'
        );
        throw error;
      }
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, 'Send response error');
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message,
        metadata,
      });
      throw error;
    }
  }

  /**
   * Extract conversation ID from webhook payload
   */
  protected extractConversationId(payload: unknown): ConversationId | null {
    const webhookData = payload as SMSWebhookPayload;
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
    const webhookData = payload as SMSWebhookPayload;
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
   * Validate SMS webhook payload structure
   */
  protected override validateWebhookPayload(payload: unknown): boolean {
    if (!super.validateWebhookPayload(payload)) {
      return false;
    }

    const webhookData = payload as SMSWebhookPayload;
    return (
      typeof webhookData === 'object' &&
      typeof webhookData.eventType === 'string' &&
      webhookData.eventType.length > 0
    );
  }
}
