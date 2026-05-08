import {
  ActionChannelSettings,
  ConversationAddress,
  ConversationId,
  ConversationParticipant,
  ConversationWebhookPayload,
  InitiateConversationResult,
  ProfileId,
  SendMessageActionRequest,
  isConversationId,
  isProfileId,
} from '../types/index';
import axios from 'axios';
import { BaseChannel, BaseChannelEvents, BaseChannelOptions } from './base';
import { ConversationClient } from '../clients/conversation';
import type { TAC } from '../lib/tac';
import { maskAddress } from '../util/log-redaction';

/**
 * Participant types that represent TAC itself at TAC's (channel, address).
 *
 * `AI_AGENT` is the canonical type; `AGENT` is the legacy Conversation
 * Orchestrator form. A participant typed either way at TAC's address is
 * recognized as TAC and not overwritten; anything else (HUMAN_AGENT,
 * CUSTOMER, …) is someone else's assignment.
 */
const AGENT_TYPES = new Set<string>(['AGENT', 'AI_AGENT']);

/**
 * Memory identifier type to use when looking up / creating a profile for a
 * channel's customer address. Channels absent from this map skip profile
 * resolution during participant reconciliation.
 */
const CHANNEL_IDENTITY_TYPES: Record<string, string> = {
  SMS: 'phone',
  VOICE: 'phone',
  RCS: 'rcs',
  WHATSAPP: 'whatsapp',
};

/**
 * Messaging channel configuration options.
 * Alias for BaseChannelOptions that can be extended by specific channel implementations.
 */
export type MessagingChannelConfig = BaseChannelOptions;

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
 *
 * Subclasses must implement:
 * - `isDefaultAgentAddress`: fast-path check for the channel's default agent address
 * - `getAgentAddress`: return the agent's `ConversationAddress` for a conversation
 * - `sendResponse`: send messages back through the channel
 *
 * Subclass flags:
 * - `reconcileCustomerType`: if `true` (default), reconciliation will also
 *   promote a channel-matching UNKNOWN participant (not owning the agent
 *   address) to CUSTOMER. Set `false` for channels where the customer is
 *   identified author-driven (e.g. chat).
 */
export abstract class MessagingChannel extends BaseChannel {
  protected override readonly conversationClient: ConversationClient;
  protected readonly messagingCallbacks: MessagingChannelEvents;

  /**
   * Controls whether reconciliation promotes an UNKNOWN customer-side
   * participant to CUSTOMER. Subclasses override to opt out (e.g. chat).
   */
  protected reconcileCustomerType: boolean = true;

  constructor(tac: TAC, config?: MessagingChannelConfig) {
    super(tac, config);
    if (!tac.isOrchestratorEnabled()) {
      throw new Error(
        'Messaging channels require conversationConfigurationId to be configured. ' +
          'Voice-only mode does not support SMS or Chat channels.'
      );
    }
    // Safe: orchestrator is enabled so conversationClient is guaranteed non-null
    this.conversationClient = tac.getConversationClient() as ConversationClient;
    this.messagingCallbacks = {};
  }

  /**
   * Fast-path check: is the author address this channel's default agent address?
   * (e.g., config.phoneNumber for SMS, agentAddress for Chat)
   */
  protected abstract isDefaultAgentAddress(authorAddress: string): boolean;

  /**
   * Return the agent-side ConversationAddress for this conversation.
   *
   * Used by `reconcileParticipants` to identify which participant (by channel
   * + address) represents the agent. May read from session state (e.g. chat's
   * per-conversation channelId) to build the address.
   */
  protected abstract getAgentAddress(conversationId: ConversationId): ConversationAddress;

  /**
   * Check if a message is from the bot itself (2-tier).
   *
   * 1. Default agent address (stateless, no API call)
   * 2. API fallback via listParticipants (cross-process / multi-worker)
   */
  private async isOwnMessage(
    authorAddress: string,
    conversationId: ConversationId,
    authorParticipantId: string | undefined
  ): Promise<boolean> {
    if (this.isDefaultAgentAddress(authorAddress)) return true;

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
          if (authorParticipant.type && AGENT_TYPES.has(authorParticipant.type)) {
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
   * Process messaging channel webhook from Conversation Orchestrator
   */
  public async processWebhook(payload: unknown, idempotencyToken?: string): Promise<void> {
    this.logger.debug({ operation: 'webhook_processing' }, 'Processing webhook');

    try {
      if (idempotencyToken && this.isDuplicateWebhook(idempotencyToken)) {
        this.logger.debug({ idempotency_token: idempotencyToken }, 'Skipping duplicate webhook');
        return;
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
            },
            'Unhandled event type - this event will be ignored'
          );
      }

      this.logger.debug({ event_type: eventType }, 'Webhook processing completed');
    } catch (error) {
      // Remove the token so retries are not blocked
      if (idempotencyToken) {
        this.removeWebhookToken(idempotencyToken);
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
  private handleConversationCreated(payload: ConversationWebhookPayload): void {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);

    if (!conversationId) {
      this.logger.warn(
        { operation: 'handle_conversation_created' },
        'Missing conversation ID in conversation.created event'
      );
      throw new Error('Missing conversation ID in conversation.created event');
    }

    this.startConversation(conversationId, profileId ?? undefined, payload.data?.serviceId);
  }

  /**
   * Handle new communication event (incoming message)
   */
  private async handleCommunicationCreated(payload: ConversationWebhookPayload): Promise<void> {
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
        author: maskAddress(author),
        message_length: message?.length,
        operation: 'handle_communication_created',
      },
      'Handling communication.created'
    );

    if (!conversationId) {
      this.logger.warn(
        { operation: 'handle_communication_created' },
        'Missing conversation ID in communication.created event'
      );
      throw new Error('Missing conversation ID in communication.created event');
    }

    if (!message) {
      this.logger.info({ conversation_id: conversationId }, 'Ignoring empty message');
      return;
    }

    // Per-conversation communication ID dedup stored in the in-memory
    // ConversationSession metadata. This only prevents duplicate processing
    // within the current process/session lifetime; it does not deduplicate
    // across horizontally-scaled instances or after a restart.
    const communicationId = payload.data?.id;
    if (communicationId) {
      const session = this.getConversationSession(conversationId);
      if (session?.metadata?.lastCommunicationId === communicationId) {
        this.logger.debug(
          { conversation_id: conversationId, communication_id: communicationId },
          'Skipping already-processed communication'
        );
        return;
      }
    }

    // Filter out messages from the bot itself
    if (await this.isOwnMessage(author, conversationId, payload.data?.author?.participantId)) {
      this.logger.info(
        {
          conversation_id: conversationId,
          author_address: maskAddress(author),
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

      // Track communication ID for cross-process dedup
      if (communicationId) {
        if (!session.metadata) {
          session.metadata = {};
        }
        session.metadata.lastCommunicationId = communicationId;
      }

      // Reconcile participant types pre-LLM so v1-bridge's UNKNOWN gets
      // promoted, and to stash both participant ids on the session for
      // sendResponse. Reconcile failure means the reply would fail too —
      // skip the callback so the LLM doesn't waste a turn on an
      // un-replyable conversation.
      //
      // Gate on `aiAgentInfo` (persistent across turns) — `authorInfo` is
      // overwritten from every webhook so it's not a reliable "already
      // reconciled" signal.
      if (!session.aiAgentInfo) {
        const resolved = await this.reconcileParticipants(conversationId);
        if (!resolved) {
          this.logger.warn(
            { conversation_id: conversationId },
            'Reconciliation failed; skipping callback for this inbound'
          );
          return;
        }

        const [agentParticipant, customerParticipant] = resolved;
        const agentAddress = this.getAgentAddress(conversationId);
        session.aiAgentInfo = {
          address: agentAddress.address,
          participantId: agentParticipant.id,
        };
        // When reconcile resolved a customer (SMS path — chat disables customer
        // reconciliation and uses the authorInfo captured from the webhook
        // above), use its authoritative participant id and lift any resolved
        // profile.
        if (customerParticipant && session.authorInfo) {
          session.authorInfo.participantId = customerParticipant.id;
          if (customerParticipant.profileId && !session.profileId) {
            session.profileId = customerParticipant.profileId;
          }
        }
      }
    }

    // Retrieve user memory if enabled via memoryMode
    const userMemory = session ? await this.retrieveMemoryIfEnabled(session, message) : undefined;

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
  private async handleConversationUpdated(payload: ConversationWebhookPayload): Promise<void> {
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
    const webhookData = payload as ConversationWebhookPayload;
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
    const webhookData = payload as ConversationWebhookPayload;
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

    const webhookData = payload as ConversationWebhookPayload;
    return (
      typeof webhookData === 'object' &&
      typeof webhookData.eventType === 'string' &&
      webhookData.eventType.length > 0
    );
  }

  /**
   * Reconcile Conversation Orchestrator's participants to the types TAC
   * needs for sending.
   *
   * v1-bridge capture can leave TAC's agent participant as `UNKNOWN` (wrong
   * type at our address), or omit it entirely (customer-only conversation).
   * This pass fixes those cases; it refuses to rewrite anything else at our
   * address. Decision matrix:
   *
   *     | Agent side           | Customer side       | Action                        |
   *     |----------------------|---------------------|-------------------------------|
   *     | AGENT / AI_AGENT     | CUSTOMER            | Use as-is (no profile work).  |
   *     | AGENT / AI_AGENT     | UNKNOWN, no CUST    | Resolve profile, PUT → CUST.  |
   *     | UNKNOWN at our addr  | CUSTOMER            | PUT agent → AI_AGENT.         |
   *     | UNKNOWN at our addr  | UNKNOWN, no CUST    | PUT agent; resolve, PUT CUST. |
   *     | other at our addr    | any                 | Return null (log ERROR).      |
   *     | none at our addr     | CUSTOMER or UNKNOWN | POST AI_AGENT, then proceed.  |
   *     | any                  | no resolvable cust  | Return null (caller WARNs).   |
   *
   * TAC recognizes both `AGENT` and `AI_AGENT` at its address as itself.
   * `HUMAN_AGENT` is NOT treated as TAC (a real human is a separate
   * participant — TAC must not speak on their behalf); it falls into the
   * "other at our addr" row and causes the reconcile to bail.
   *
   * Customer-side reconciliation is gated by `reconcileCustomerType`. Chat
   * sets it to `false` because chat identifies the customer author-driven
   * (via `session.authorInfo.participantId`), so promoting some other
   * `UNKNOWN` CHAT participant could pick the wrong recipient.
   *
   * @returns `[agent, customerOrNull]` on success. `customer` is `null` when
   * `reconcileCustomerType` is `false`. `null` overall when either the agent
   * or the customer cannot be resolved — the caller treats `null` as a hard
   * stop and skips the message-ready callback.
   */
  protected async reconcileParticipants(
    conversationId: ConversationId
  ): Promise<[ConversationParticipant, ConversationParticipant | null] | null> {
    const agentAddress = this.getAgentAddress(conversationId);

    let participants: ConversationParticipant[];
    try {
      participants = await this.conversationClient.listParticipants(conversationId);
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: conversationId },
        'Failed to list participants for reconciliation'
      );
      return null;
    }

    const channel = agentAddress.channel;

    const ownsAgentAddress = (p: ConversationParticipant): boolean =>
      Array.isArray(p.addresses) &&
      p.addresses.some(a => a.channel === channel && a.address === agentAddress.address);

    const matchesChannel = (p: ConversationParticipant): boolean =>
      Array.isArray(p.addresses) && p.addresses.some(a => a.channel === channel);

    let agentCandidate = participants.find(ownsAgentAddress);
    if (!agentCandidate) {
      const created = await this.addAgentParticipant(conversationId, agentAddress);
      if (!created) return null;
      agentCandidate = created;
    } else if (agentCandidate.type === 'UNKNOWN') {
      // Only promote UNKNOWN — an already-typed participant at TAC's address
      // that isn't AGENT/AI_AGENT (e.g., CUSTOMER, HUMAN_AGENT) is someone
      // else's assignment and must not be overwritten.
      const promoted = await this.promoteParticipant(conversationId, agentCandidate, 'AI_AGENT');
      if (!promoted) return null;
      agentCandidate = promoted;
    } else if (!agentCandidate.type || !AGENT_TYPES.has(agentCandidate.type)) {
      this.logger.error(
        {
          conversation_id: conversationId,
          participant_id: agentCandidate.id,
          participant_type: agentCandidate.type,
        },
        "Participant at TAC's address has a conflicting type; refusing to overwrite. " +
          'Check Conversation Orchestrator participant state — a non-agent participant is holding ' +
          "TAC's (channel, address)."
      );
      return null;
    }

    if (!this.reconcileCustomerType) {
      return [agentCandidate, null];
    }

    const customer = participants.find(
      p => p.type === 'CUSTOMER' && matchesChannel(p) && !ownsAgentAddress(p)
    );
    if (customer) {
      return [agentCandidate, customer];
    }

    const customerUnknown = participants.find(
      p => p.type === 'UNKNOWN' && matchesChannel(p) && !ownsAgentAddress(p)
    );
    if (customerUnknown) {
      const profileId = await this.resolveCustomerProfile(customerUnknown, channel);
      const promotedCustomer = await this.promoteParticipant(
        conversationId,
        customerUnknown,
        'CUSTOMER',
        profileId
      );
      if (promotedCustomer) {
        return [agentCandidate, promotedCustomer];
      }
    }

    this.logger.warn(
      { conversation_id: conversationId, channel },
      'No customer participant resolvable; skipping webhook'
    );
    return null;
  }

  /**
   * Find or mint a Conversation Memory profile for a customer being promoted from UNKNOWN.
   *
   * Only resolves for phone-based channels (SMS, VOICE, RCS, WHATSAPP). Looks
   * up by the channel's identifier type (`phone` for SMS/VOICE, `rcs` for
   * RCS, `whatsapp` for WHATSAPP) first; on miss, creates a new profile
   * using the configured phone trait group/field. Returns undefined on any
   * failure — the caller still promotes the participant, just without a
   * `profileId` attached.
   */
  private async resolveCustomerProfile(
    customer: ConversationParticipant,
    channel: string
  ): Promise<string | undefined> {
    const identityType = CHANNEL_IDENTITY_TYPES[channel];
    if (!identityType) return undefined;

    const memoryClient = this.tac.getMemoryClient();
    if (!memoryClient || !this.tac.getMemoryStoreId()) return undefined;

    const phoneAddress = Array.isArray(customer.addresses)
      ? (customer.addresses.find(a => a.channel === channel && !!a.address)?.address ?? undefined)
      : undefined;
    if (!phoneAddress) return undefined;

    try {
      const lookup = await memoryClient.lookupProfile(identityType, phoneAddress);
      if (lookup.profiles && lookup.profiles.length > 0) {
        return lookup.profiles[0];
      }
    } catch (error) {
      this.logger.warn(
        { err: error, conversation_id: customer.conversationId },
        'Profile lookup failed during reconciliation; falling back to create'
      );
    }

    const memoryConfig = this.config.memoryConfig;
    const traitGroup = memoryConfig.phoneTraitGroup;
    const traitField = memoryConfig.phoneTraitField;

    try {
      return await memoryClient.createProfile({
        [traitGroup]: { [traitField]: phoneAddress },
      });
    } catch (error) {
      this.logger.warn(
        { err: error, conversation_id: customer.conversationId },
        'Profile creation failed during reconciliation; promoting without profile'
      );
      return undefined;
    }
  }

  /**
   * PUT a participant to `newType`.
   *
   * Conversation Orchestrator's PUT is a full-resource replacement, so we
   * pass the existing `name` and `addresses` back unchanged to avoid wiping
   * them. `profileId` defaults to the participant's current value; pass a
   * non-undefined override to attach a newly resolved profile during CUSTOMER
   * reconciliation.
   *
   * Returns undefined on any error (including 409). A 409 from Conversation
   * Orchestrator here means the promotion is structurally blocked — stop and
   * surface it; don't retry.
   */
  private async promoteParticipant(
    conversationId: ConversationId,
    participant: ConversationParticipant,
    newType: 'CUSTOMER' | 'AI_AGENT' | 'HUMAN_AGENT' | 'AGENT',
    profileId?: string
  ): Promise<ConversationParticipant | undefined> {
    const effectiveProfileId = profileId !== undefined ? profileId : participant.profileId;
    const updateOptions: { name?: string; profileId?: string } = {};
    if (participant.name !== undefined) updateOptions.name = participant.name;
    if (effectiveProfileId !== null && effectiveProfileId !== undefined) {
      updateOptions.profileId = effectiveProfileId;
    }

    try {
      const updated = await this.conversationClient.updateParticipant(
        conversationId,
        participant.id,
        newType,
        participant.addresses,
        updateOptions
      );
      this.logger.debug(
        {
          conversation_id: conversationId,
          participant_id: participant.id,
          from_type: participant.type,
          to_type: newType,
        },
        'Promoted participant'
      );
      return updated;
    } catch (error) {
      if (this.isConflictError(error)) {
        this.logger.warn(
          {
            conversation_id: conversationId,
            participant_id: participant.id,
            target_type: newType,
            conflicting_resource_id: this.extractConflictingResourceId(error),
          },
          'Conversation Orchestrator returned 409 on participant promotion; skipping — ' +
            'likely a conflicting conversation or grouping constraint. Check ' +
            'Conversation Orchestrator for duplicate active conversations.'
        );
        return undefined;
      }
      this.logger.error(
        {
          err: error,
          conversation_id: conversationId,
          participant_id: participant.id,
          target_type: newType,
        },
        'Failed to promote participant'
      );
      return undefined;
    }
  }

  /**
   * POST an `AI_AGENT` participant owning `agentAddress`.
   *
   * Returns undefined on any error (including 409). A 409 here means the
   * address is already owned or the conversation's participant set can't
   * accept a new AI_AGENT — stop and surface it; don't retry.
   */
  private async addAgentParticipant(
    conversationId: ConversationId,
    agentAddress: ConversationAddress
  ): Promise<ConversationParticipant | undefined> {
    try {
      const created = await this.conversationClient.addParticipant(
        conversationId,
        [agentAddress],
        'AI_AGENT'
      );
      this.logger.debug(
        { conversation_id: conversationId, participant_id: created.id },
        'Added AI_AGENT participant'
      );
      return created;
    } catch (error) {
      if (this.isConflictError(error)) {
        this.logger.warn(
          {
            conversation_id: conversationId,
            conflicting_resource_id: this.extractConflictingResourceId(error),
          },
          'Conversation Orchestrator returned 409 on AI_AGENT participant add; skipping — ' +
            "address is already owned or the conversation can't accept a new AI_AGENT. " +
            'Check Conversation Orchestrator participant state.'
        );
        return undefined;
      }
      this.logger.error(
        { err: error, conversation_id: conversationId },
        'Failed to add AI_AGENT participant'
      );
      return undefined;
    }
  }

  private isConflictError(error: unknown): boolean {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    return axios.isAxiosError(cause) && cause.response?.status === 409;
  }

  private extractConflictingResourceId(error: unknown): string | undefined {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    if (!axios.isAxiosError(cause)) return undefined;
    const headers = cause.response?.headers as Record<string, string> | undefined;
    const id = headers?.['x-conflicting-resource-id'];
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  }

  /**
   * Shared outbound conversation initiation for messaging channels (SMS/RCS/Chat/WhatsApp).
   *
   * Handles the full flow: create conversation → find participants → start
   * session → send initial message → error cleanup.
   */
  protected async initiateOutboundMessagingConversation(params: {
    channel: 'SMS' | 'CHAT' | 'RCS' | 'WHATSAPP';
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
          p.type !== undefined &&
          AGENT_TYPES.has(p.type) &&
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
      session.aiAgentInfo = {
        address: fromAddress,
        participantId: agentParticipant.id,
      };
      session.metadata = {
        ...session.metadata,
        ...(metadata ?? {}),
        direction: 'outbound',
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
        { conversation_id: conversationId, to: maskAddress(to) },
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
      this.logger.error(
        { err: error, to: maskAddress(to) },
        `Failed to initiate outbound ${channel}`
      );
      this.handleError(error instanceof Error ? error : new Error(String(error)), { to });
      throw error;
    }
  }
}
