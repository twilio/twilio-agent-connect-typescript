import {
  ActionChannelSettings,
  CommunicationSchema,
  ConversationAddress,
  ConversationId,
  ConversationParticipant,
  ConversationParticipantSchema,
  ConversationResponseSchema,
  InitiateConversationResult,
  ProfileId,
  SendMessageActionRequest,
  isConversationId,
  isProfileId,
} from '../types/index';
import { BaseChannel, BaseChannelEvents } from './base';
import type { TAC } from '../lib/tac';

/**
 * Messaging channel configuration options
 */
export interface MessagingChannelConfig {
  /** Maximum number of idempotency tokens to track for deduplication (default: 10,000) */
  dedupCapacity?: number;
}

const DEFAULT_DEDUP_CAPACITY = 10_000;

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
  private readonly processedTokens = new Set<string>();
  private readonly maxTrackedTokens: number;

  constructor(tac: TAC, config?: MessagingChannelConfig) {
    super(tac);
    this.messagingCallbacks = {};
    const capacity = config?.dedupCapacity ?? DEFAULT_DEDUP_CAPACITY;
    if (capacity < 1 || !Number.isInteger(capacity)) {
      throw new Error('dedupCapacity must be a positive integer');
    }
    this.maxTrackedTokens = capacity;
  }

  /**
   * Check if a webhook has already been processed, and if not, record the token immediately.
   * This is intentionally a single synchronous check-and-record to prevent race conditions
   * where a duplicate arrives while the first request is still awaiting async work.
   * Uses a sliding window with FIFO eviction at capacity.
   */
  private isDuplicateWebhook(idempotencyToken: string): boolean {
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
   * Fast-path check: is the author address this channel's default agent address?
   * (e.g., config.phoneNumber for SMS, agentAddress for Chat)
   */
  protected abstract isDefaultAgentAddress(authorAddress: string): boolean;

  /**
   * Check if a message is from the bot itself.
   *
   * 1. Default agent address (stateless, no API call)
   * 2. Session metadata fromAddress (works same-process for custom `from`)
   * 3. API lookup: resolve participantId → participant type (works cross-process
   *    for custom `from` when session is missing, e.g., after restart or on
   *    another worker)
   */
  private async isOwnMessage(
    authorAddress: string,
    conversationId: ConversationId,
    authorParticipantId: string | undefined
  ): Promise<boolean> {
    // Fast path: default agent address
    if (this.isDefaultAgentAddress(authorAddress)) return true;

    // Session path: custom fromAddress stored during outbound initiation
    const session = this.activeConversations.get(conversationId);
    if (session?.metadata?.fromAddress === authorAddress) return true;

    // If we have a local session and neither fromAddress nor authorInfo
    // matches, this is a normal inbound customer message — no API call needed.
    // The fallback below is only for when there's no session (e.g., webhook
    // arrived on a different process or after restart for a custom-from
    // outbound conversation).
    if (session) return false;

    // Fallback: no local session — look up participant type via API.
    if (authorParticipantId) {
      try {
        const participants = await this.conversationClient.listParticipants(conversationId);
        const authorParticipant = participants.find(p => p.id === authorParticipantId);
        if (authorParticipant) {
          if (authorParticipant.type === undefined) {
            this.logger.warn(
              { conversation_id: conversationId, participant_id: authorParticipantId },
              'Participant type is undefined — cannot determine if this is an agent message'
            );
          }
          if (
            authorParticipant.type === 'AI_AGENT' ||
            authorParticipant.type === 'HUMAN_AGENT' ||
            authorParticipant.type === 'AGENT'
          ) {
            return true;
          }
        }
      } catch (error) {
        this.logger.warn(
          { err: error, conversation_id: conversationId, participant_id: authorParticipantId },
          'Failed to look up participant type for self-message check; falling through'
        );
      }
    }

    return false;
  }

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
  private isEventForThisChannel(eventType: string, data: Record<string, unknown>): boolean {
    // COMMUNICATION_CREATED: require author.channel for safe filtering
    if (eventType === 'COMMUNICATION_CREATED') {
      const author = data.author as { channel?: string } | undefined;
      if (!author?.channel) {
        return false;
      }
      return author.channel === this.channelType.toUpperCase();
    }

    // CONVERSATION_UPDATED: only process if this channel tracks the conversation
    if (eventType === 'CONVERSATION_UPDATED') {
      const convId = (data.id as string) || (data.conversationId as string);
      if (convId && isConversationId(convId) && !this.isConversationActive(convId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Process messaging channel webhook from Twilio Conversations Service
   */
  public async processWebhook(payload: unknown, idempotencyToken?: string): Promise<void> {
    this.logger.debug({ operation: 'webhook_processing', payload }, 'Processing webhook');

    try {
      if (idempotencyToken && this.isDuplicateWebhook(idempotencyToken)) {
        this.logger.debug({ idempotency_token: idempotencyToken }, 'Skipping duplicate webhook');
        return;
      }

      if (!this.validateWebhookPayload(payload)) {
        throw new Error('Invalid webhook payload');
      }

      const webhookData = payload as { eventType?: string; data?: Record<string, unknown> };
      const eventType = webhookData.eventType;
      const data = webhookData.data;

      if (!eventType || !data) {
        this.logger.warn({ payload }, 'Webhook missing eventType or data field');
        return;
      }

      const conversationId = (data.conversationId as string) || (data.id as string);

      // Self-filter: ignore events meant for other channel types
      if (!this.isEventForThisChannel(eventType, data)) {
        this.logger.debug(
          { event_type: eventType, channel: this.channelType, conversation_id: conversationId },
          'Ignoring event for different channel type'
        );
        return;
      }

      this.logger.info(
        {
          event_type: eventType,
          raw_event_type: eventType,
          conversation_id: conversationId,
        },
        'Processing webhook event'
      );

      switch (eventType) {
        case 'CONVERSATION_CREATED':
          this.logger.debug(
            { conversation_id: conversationId, profile_id: data.profileId },
            'Handling CONVERSATION_CREATED'
          );
          this.handleConversationCreated(data);
          break;

        case 'PARTICIPANT_ADDED':
          this.logger.debug(
            { conversation_id: conversationId, profile_id: data.profileId },
            'Handling PARTICIPANT_ADDED'
          );
          this.handleParticipantAdded(data);
          break;

        case 'COMMUNICATION_CREATED':
          this.logger.debug({ conversation_id: conversationId }, 'Handling COMMUNICATION_CREATED');
          await this.handleCommunicationCreated(data);
          break;

        case 'CONVERSATION_UPDATED':
          this.logger.debug(
            { conversation_id: conversationId, status: data.status },
            'Handling CONVERSATION_UPDATED'
          );
          await this.handleConversationUpdated(data);
          break;

        default:
          this.logger.warn(
            {
              event_type: eventType,
              raw_event_type: eventType,
              conversation_id: conversationId,
              payload,
            },
            'Unhandled event type - this event will be ignored'
          );
      }

      this.logger.debug({ event_type: eventType }, 'Webhook processing completed');
    } catch (error) {
      // Remove the token so retries are not blocked
      if (idempotencyToken) {
        this.processedTokens.delete(idempotencyToken);
      }
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
  private handleConversationCreated(data: Record<string, unknown>): void {
    const parseResult = ConversationResponseSchema.safeParse(data);
    if (!parseResult.success) {
      this.logger.warn(
        { validation_errors: parseResult.error.errors, data },
        'Invalid conversation.created payload'
      );
      throw new Error('Invalid conversation.created payload');
    }

    const conversation = parseResult.data;
    const conversationId = conversation.id;
    const profileId = null;

    if (!isConversationId(conversationId)) {
      throw new Error('Invalid conversation ID in conversation.created event');
    }

    this.startConversation(conversationId, profileId ?? undefined, conversation.configurationId);
  }

  /**
   * Handle participant added event
   */
  private handleParticipantAdded(data: Record<string, unknown>): void {
    const parseResult = ConversationParticipantSchema.safeParse(data);
    if (!parseResult.success) {
      this.logger.warn(
        { validation_errors: parseResult.error.errors, data },
        'Invalid participant.added payload'
      );
      throw new Error('Invalid participant.added payload');
    }

    const participant = parseResult.data;
    const conversationId = participant.conversationId;
    const profileId = participant.profileId ?? null;

    if (!isConversationId(conversationId)) {
      throw new Error('Invalid conversation ID in participant.added event');
    }

    // Update conversation with profile ID if conversation exists
    if (this.isConversationActive(conversationId)) {
      const session = this.getConversationSession(conversationId);
      if (session) {
        if (profileId && isProfileId(profileId)) {
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

        const serviceId = (data.serviceId as string) || undefined;
        if (serviceId && session.serviceId !== serviceId) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_service_id: session.serviceId,
              new_service_id: serviceId,
            },
            'Updating conversation configuration ID from participant.added'
          );
          session.serviceId = serviceId;
        }
      }
    } else {
      // Auto-initialize conversation if not already started
      this.logger.debug(
        { conversation_id: conversationId, profile_id: profileId },
        'Auto-starting conversation from participant.added'
      );
      this.startConversation(
        conversationId,
        profileId && isProfileId(profileId) ? profileId : undefined,
        (data.serviceId as string) || undefined
      );
    }
  }

  /**
   * Handle new communication event (incoming message)
   */
  private async handleCommunicationCreated(data: Record<string, unknown>): Promise<void> {
    const parseResult = CommunicationSchema.safeParse(data);
    if (!parseResult.success) {
      this.logger.warn(
        { validation_errors: parseResult.error.errors, data },
        'Invalid communication.created payload'
      );
      throw new Error('Invalid communication.created payload');
    }

    const communication = parseResult.data;
    const conversationId = communication.conversationId;
    const message = communication.content.text?.trim();
    const author = communication.author.address;
    const communicationId = communication.id;

    this.logger.info(
      {
        conversation_id: conversationId,
        author,
        message,
        message_length: message?.length,
        operation: 'handle_communication_created',
      },
      'Handling communication.created'
    );

    if (!isConversationId(conversationId)) {
      throw new Error('Invalid conversation ID in communication.created event');
    }

    if (!message) {
      this.logger.info({ conversation_id: conversationId }, 'Ignoring empty message');
      return;
    }

    // Per-conversation communication ID dedup
    const session = this.getConversationSession(conversationId);
    if (session?.metadata?.lastCommunicationId === communicationId) {
      this.logger.debug(
        { conversation_id: conversationId, communication_id: communicationId },
        'Skipping already-processed communication'
      );
      return;
    }

    // Filter out messages from the bot itself
    if (await this.isOwnMessage(author, conversationId, communication.author.participantId)) {
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
      this.startConversation(conversationId, undefined, (data.serviceId as string) || undefined);
    } else {
      const serviceId = (data.serviceId as string) || undefined;
      if (session && serviceId && session.serviceId !== serviceId) {
        this.logger.debug(
          {
            conversation_id: conversationId,
            old_service_id: session.serviceId,
            new_service_id: serviceId,
          },
          'Updating conversation configuration ID from communication.created'
        );
        session.serviceId = serviceId;
      }
    }

    // Get session and update with author info for profile lookup
    const updatedSession = this.getConversationSession(conversationId);
    if (updatedSession) {
      updatedSession.authorInfo = {
        address: author,
        participantId: communication.author.participantId,
      };

      // Store channelId (Chat Channel SID) in session metadata for reply sending
      if (communication.channelId) {
        if (!updatedSession.metadata) {
          updatedSession.metadata = {};
        }
        updatedSession.metadata.channelId = communication.channelId;
        this.logger.debug(
          { conversation_id: conversationId, channel_id: communication.channelId },
          'Stored channelId in session metadata'
        );
      }

      // Track communication ID for dedup
      if (!updatedSession.metadata) {
        updatedSession.metadata = {};
      }
      updatedSession.metadata.lastCommunicationId = communicationId;
    }

    // Retrieve user memory
    let userMemory;
    if (updatedSession) {
      this.logger.debug({ conversation_id: conversationId, author }, 'Retrieving user memory');
      try {
        userMemory = await this.tac.retrieveMemory(updatedSession, message);
        this.logger.debug(
          { conversation_id: conversationId, profile_id: updatedSession.profileId },
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
        profileId: (updatedSession?.profileId as ProfileId | undefined) ?? undefined,
        message,
        author,
        userMemory,
      });
    }
  }

  /**
   * Handle conversation updated event
   */
  private async handleConversationUpdated(data: Record<string, unknown>): Promise<void> {
    const parseResult = ConversationResponseSchema.safeParse(data);
    if (!parseResult.success) {
      this.logger.warn(
        { validation_errors: parseResult.error.errors, data },
        'Invalid conversation.updated payload'
      );
      throw new Error('Invalid conversation.updated payload');
    }

    const conversation = parseResult.data;
    const conversationId = conversation.id;

    if (!isConversationId(conversationId)) {
      throw new Error('Invalid conversation ID in conversation.updated event');
    }

    // Check if conversation is closed
    if (conversation.status === 'CLOSED') {
      this.logger.info(
        { conversation_id: conversationId, status: conversation.status },
        'Conversation closed, cleaning up'
      );
      await this.endConversation(conversationId);
    }
  }

  /**
   * Extract conversation ID from webhook payload (for compatibility)
   */
  protected extractConversationId(payload: unknown): ConversationId | null {
    const data = (payload as { data?: Record<string, unknown> }).data;
    if (!data) return null;

    const conversationId = (data.conversationId as string) || (data.id as string);
    if (conversationId && isConversationId(conversationId)) {
      return conversationId;
    }

    return null;
  }

  /**
   * Extract profile ID from webhook data (for logging/compatibility)
   */
  protected extractProfileId(payload: unknown): ProfileId | null {
    const data = (payload as { data?: Record<string, unknown> }).data;
    if (!data) return null;

    return this.extractProfileIdFromData(data);
  }

  /**
   * Extract profile ID from parsed data
   */
  private extractProfileIdFromData(data: Record<string, unknown>): ProfileId | null {
    const profileId = data.profileId as string | null | undefined;

    if (profileId && isProfileId(profileId)) {
      this.logger.debug(
        { profile_id: profileId, conversation_id: data.conversationId || data.id },
        'Extracted profile ID from webhook payload'
      );
      return profileId;
    }

    this.logger.debug(
      { conversation_id: data.conversationId || data.id },
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

    const webhookData = payload as { eventType?: string; data?: unknown };
    return (
      typeof webhookData === 'object' &&
      typeof webhookData.eventType === 'string' &&
      webhookData.eventType.length > 0
    );
  }

  /**
   * Return the conversation's AI_AGENT participant, creating one if absent.
   *
   * Returns the first participant in `existingParticipants` whose type is
   * AI_AGENT / HUMAN_AGENT / AGENT and owns `agentAddress`. If none match,
   * creates an AI_AGENT with that address. On failure from another worker
   * creating it concurrently (typically 409), re-lists and re-matches.
   *
   * Returns undefined if match-then-create-then-retry all fail. The caller
   * should log and bail on undefined.
   */
  protected async ensureAgentParticipant(
    conversationId: ConversationId,
    existingParticipants: ConversationParticipant[],
    agentAddress: ConversationAddress
  ): Promise<ConversationParticipant | undefined> {
    const matches = (p: ConversationParticipant): boolean =>
      (p.type === 'AI_AGENT' || p.type === 'HUMAN_AGENT' || p.type === 'AGENT') &&
      Array.isArray(p.addresses) &&
      p.addresses.some(
        a => a.channel === agentAddress.channel && a.address === agentAddress.address
      );

    const existing = existingParticipants.find(matches);
    if (existing) {
      return existing;
    }

    this.logger.debug(
      {
        conversation_id: conversationId,
        channel: agentAddress.channel,
        address: agentAddress.address,
      },
      'No agent participant found, creating AI_AGENT'
    );

    try {
      const agent = await this.conversationClient.addParticipant(
        conversationId,
        [agentAddress],
        'AI_AGENT'
      );
      this.logger.debug(
        {
          conversation_id: conversationId,
          participant_id: agent.id,
        },
        'Created AI_AGENT participant'
      );
      return agent;
    } catch (error) {
      // Most likely a 409 race (another worker just created the agent), but
      // we catch broadly here — log the original error so a real 5xx isn't
      // hidden by the generic "failed to create or find" log below.
      this.logger.warn(
        { err: error, conversation_id: conversationId },
        'Failed to create AI_AGENT, retrying participant list'
      );
    }

    let retried: ConversationParticipant[];
    try {
      retried = await this.conversationClient.listParticipants(conversationId);
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: conversationId },
        'Failed to retry listing participants'
      );
      return undefined;
    }

    const agent = retried.find(matches);
    if (!agent) {
      this.logger.error(
        { conversation_id: conversationId },
        'Failed to create or find AI_AGENT participant'
      );
    }
    return agent;
  }

  /**
   * Shared outbound conversation initiation for messaging channels (SMS/Chat).
   *
   * Handles the full flow: create conversation → find participants → start
   * session → send initial message → error cleanup.
   */
  protected async initiateOutboundMessagingConversation(params: {
    channel: 'SMS' | 'CHAT';
    to: string;
    from: string;
    message: string;
    metadata?: Record<string, unknown>;
    channelId?: string;
    channelSettings?: ActionChannelSettings;
  }): Promise<InitiateConversationResult> {
    const {
      channel,
      to,
      from: fromAddress,
      message,
      metadata,
      channelId,
      channelSettings,
    } = params;

    let conversationId: string | undefined;
    let conversationReused = false;

    try {
      const customerAddress: ConversationAddress = {
        channel,
        address: to,
        ...(channelId ? { channelId } : {}),
      };
      const agentAddress: ConversationAddress = {
        channel,
        address: fromAddress,
        ...(channelId ? { channelId } : {}),
      };

      const result = await this.conversationClient.createOrReuseConversation([
        { type: 'CUSTOMER', addresses: [customerAddress] },
        { type: 'AI_AGENT', addresses: [agentAddress] },
      ]);
      conversationId = result.conversation.id;
      conversationReused = result.reused;

      if (!isConversationId(conversationId)) {
        throw new Error(`Invalid conversation ID returned: ${conversationId}`);
      }

      const participants = await this.conversationClient.listParticipants(conversationId);

      const customerParticipant = participants.find(
        p =>
          p.type === 'CUSTOMER' &&
          Array.isArray(p.addresses) &&
          p.addresses.some(
            a =>
              a.channel === channel &&
              a.address === to &&
              (channelId === undefined || a.channelId === channelId)
          )
      );
      if (!customerParticipant) {
        throw new Error('Customer participant not found after conversation creation');
      }

      const agentParticipant = participants.find(
        p =>
          (p.type === 'AI_AGENT' || p.type === 'HUMAN_AGENT' || p.type === 'AGENT') &&
          Array.isArray(p.addresses) &&
          p.addresses.some(
            a =>
              a.channel === channel &&
              a.address === fromAddress &&
              (channelId === undefined || a.channelId === channelId)
          )
      );
      if (!agentParticipant) {
        throw new Error('Agent participant not found after conversation creation');
      }

      // Start local session BEFORE sending the initial message so the
      // COMMUNICATION_CREATED webhook (triggered by createAction) finds a
      // correctly-configured session instead of auto-starting one with wrong
      // metadata.
      const session = this.startConversation(conversationId);
      session.authorInfo = {
        address: to,
        participantId: customerParticipant.id,
      };
      session.metadata = {
        ...session.metadata,
        ...(metadata ?? {}),
        direction: 'outbound',
        fromAddress,
        ...(channelId ? { channelId } : {}),
      };

      const actionRequest: SendMessageActionRequest = {
        type: 'SEND_MESSAGE',
        payload: {
          from: { channel, participantId: agentParticipant.id },
          to: [{ channel, participantId: customerParticipant.id }],
          content: { text: message },
          ...(channelSettings ? { channelSettings } : {}),
        },
      };

      await this.conversationClient.createAction(conversationId, actionRequest);

      this.logger.info(
        { conversation_id: conversationId, to },
        `Outbound ${channel} conversation initiated`
      );

      return { conversationId, session };
    } catch (error) {
      if (conversationId) {
        this.activeConversations.delete(conversationId as ConversationId);
      }
      if (conversationId && !conversationReused) {
        await this.conversationClient
          .updateConversation(conversationId, 'CLOSED')
          .catch(closeErr => {
            this.logger.warn(
              { err: closeErr, conversation_id: conversationId },
              'Failed to close orphaned conversation after initiation error'
            );
          });
      }
      this.logger.error({ err: error, to }, `Failed to initiate outbound ${channel}`);
      this.handleError(error instanceof Error ? error : new Error(String(error)), { to });
      throw error;
    }
  }
}
