import {
  ActionChannelSettings,
  ActionParticipantRef,
  AuthorInfo,
  ConversationAddress,
  ConversationId,
  ConversationParticipant,
  ConversationResponseSchema,
  ConversationSession,
  ConversationWebhookPayload,
  InitiateConversationResult,
  ParticipantAddressType,
  ProfileId,
  SendMessageActionRequest,
  isConversationId,
} from '../types/index';
import axios from 'axios';
import { BaseChannel, BaseChannelEvents, BaseChannelOptions } from './base';
import { ConversationClient } from '../clients/conversation';
import type { TAC } from '../lib/tac';
import { analyticsEnabled, trackEvent } from '../lib/analytics';
import { attachConversationMetadata } from '../lib/conversation-session-helpers';
import { warnDeprecated } from '../lib/deprecation';
import { maskAddress } from '../util/log-redaction';
import { fitConversationMetadata } from '../util/conversation-metadata';
import { elapsedMs } from '../util/timestamps';

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
 *
 * `memoryMode: "once"` is **deprecated** on messaging channels and removed in
 * 3.0. It caches a recall on a session that outlives one request, which
 * messaging channels don't keep, so it logs a warning and runs as `"always"`.
 * It's still supported on the Voice channel.
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
    /** This turn's session, derived from the webhook. */
    session: ConversationSession;
  }) => void;
}

/**
 * Abstract Messaging Channel base class for SMS and Chat channels
 *
 * Provides shared webhook processing logic for messaging channels
 * (SMS and Chat) that use the Conversations Service webhooks.
 *
 * **Stateless by construction.** No conversation session is kept between
 * webhooks: each request derives its own `ConversationSession` from the
 * payload, config, and one `listParticipants` call it needs anyway. So any
 * replica can serve any webhook — no sticky sessions, no shared datastore. A
 * session lasts one turn, so `session.metadata` doesn't carry over to the next
 * message; keep state across turns in your own store, keyed by
 * `conversationId`. `conversationMetadata(session)` reads the metadata stored
 * on Conversation Orchestrator from any instance.
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
 * - `deriveInboundAgentFromRecipients`: if `true` (default), the inbound agent
 *   address is derived from the webhook's recipient (which of TAC's configured
 *   numbers was messaged), validated against the channel's allowlist. `true` for
 *   phone-like channels (SMS, RCS, WhatsApp). Set `false` for channels where the
 *   agent is a single identity rather than a number set (e.g. chat), which keeps
 *   the default-address path instead.
 */
export abstract class MessagingChannel extends BaseChannel {
  protected override readonly conversationClient: ConversationClient;
  protected readonly messagingCallbacks: MessagingChannelEvents;

  /**
   * Controls whether reconciliation promotes an UNKNOWN customer-side
   * participant to CUSTOMER. Subclasses override to opt out (e.g. chat).
   */
  protected reconcileCustomerType: boolean = true;

  /**
   * Phone-like channels derive the agent address from the inbound webhook's
   * recipient (which of TAC's numbers was messaged). Chat uses a single identity
   * and opts out, keeping the default-address path.
   */
  protected deriveInboundAgentFromRecipients: boolean = true;

  /**
   * The uppercase Conversation Orchestrator channel name for this channel (e.g.
   * `"SMS"`, `"RCS"`), used to filter webhook recipients and participant
   * addresses. Derived from {@link channelType}.
   */
  protected getChannelName(): ParticipantAddressType {
    return this.channelType.toUpperCase() as ParticipantAddressType;
  }

  constructor(tac: TAC, config?: MessagingChannelConfig) {
    // Accepted before messaging went stateless, so rejecting "once" would break
    // existing apps at startup. "always" keeps memory on, with the turn's
    // query, at one recall per message.
    const onceDeprecated = config?.memoryMode === 'once';
    super(tac, onceDeprecated ? { ...config, memoryMode: 'always' } : config);
    if (!tac.isOrchestratorEnabled()) {
      throw new Error(
        'Messaging channels require conversationConfigurationId to be configured. ' +
          'Voice-only mode does not support SMS or Chat channels.'
      );
    }
    if (onceDeprecated) {
      const name = new.target.name;
      warnDeprecated(
        `memoryMode "once" on ${name}`,
        'memoryMode "always" (it runs as "always" until then; "once" is still supported on VoiceChannel)'
      );
      this.logger.warn(
        { channel: name },
        `memoryMode "once" is deprecated on ${name} and will be removed in 3.0; running as ` +
          '"always". It caches a recall on a session that outlives one request, which ' +
          'messaging channels don\'t keep. ("once" is still supported on VoiceChannel.)'
      );
    }
    // Safe: orchestrator is enabled so conversationClient is guaranteed non-null
    this.conversationClient = tac.getConversationClient() as ConversationClient;
    this.messagingCallbacks = {};
  }

  /**
   * Fast-path check: is the author address one of this channel's configured agent addresses?
   *
   * Checks the channel's full sender allowlist, not just the default sender:
   * `config.phoneNumbers` for SMS, `config.rcsSenderIds` for RCS,
   * `config.whatsappNumbers` for WhatsApp, and `agentAddress` for Chat.
   */
  protected abstract isDefaultAgentAddress(authorAddress: string): boolean;

  /**
   * Return the agent-side ConversationAddress for this conversation.
   *
   * Identifies which participant represents the agent, and supplies the
   * `from` address for outbound sends.
   */
  protected abstract getAgentAddress(conversationId: ConversationId): ConversationAddress;

  /**
   * The agent-side address for `session`; what TAC's own paths call.
   *
   * Defaults to `getAgentAddress(session.conversationId)`, so a subclass
   * overriding only that keeps working. Channels whose address depends on
   * per-conversation data (chat's `channelId`) override this to read the
   * session directly.
   */
  protected agentAddressFor(session: ConversationSession): ConversationAddress {
    return this.getAgentAddress(session.conversationId as ConversationId);
  }

  protected override isOwnCoAddress(address: string): boolean {
    return this.isDefaultAgentAddress(address);
  }

  /**
   * Messaging channels keep no sessions between webhooks, so there is nothing
   * to look up: always `undefined`.
   *
   * @deprecated Use the session `onMessageReady` (or
   * `initiateOutboundConversation`) hands you. Removed in 3.0.
   */
  public override getConversationSession(_conversationId: ConversationId): undefined {
    warnDeprecated(
      `${this.constructor.name}.getConversationSession()`,
      'the session passed to onMessageReady (messaging channels keep no sessions)'
    );
    return undefined;
  }

  /**
   * Messaging channels keep no sessions between webhooks: always `false`.
   *
   * @deprecated Messaging channels are stateless; track conversations in your
   * own store, keyed by `conversationId`. Removed in 3.0.
   */
  public override isConversationActive(_conversationId: ConversationId): false {
    warnDeprecated(
      `${this.constructor.name}.isConversationActive()`,
      'your own store keyed by conversationId (messaging channels keep no sessions)'
    );
    return false;
  }

  /**
   * Report a delivered response.
   *
   * Each channel calls this from its own `sendResponse` rather than the base
   * wrapping the call: `sendResponse` is the public extension point, so making
   * it a template method would break subclasses defined outside this package.
   */
  protected trackResponseSent(conversationId: ConversationId): void {
    trackEvent('Response Sent', {
      account_sid: this.config.accountSid,
      channel: this.channelType,
      conversation_id: conversationId,
      response_type: 'full',
    });
  }

  /**
   * Whether the author is TAC, judged from an already-fetched participant list.
   *
   * The caller does the free check (author address is a configured agent
   * address) first; this catches TAC speaking from some other address.
   */
  private isOwnMessage(
    authorParticipantId: string | undefined,
    participants: ConversationParticipant[],
    conversationId: ConversationId
  ): boolean {
    if (!authorParticipantId) return false;

    const author = participants.find(p => p.id === authorParticipantId);
    if (!author) return false;
    if (author.type === undefined) {
      this.logger.warn(
        { conversation_id: conversationId, participant_id: authorParticipantId },
        'Participant type is undefined — cannot determine if this is an agent message'
      );
    }
    return author.type !== undefined && AGENT_TYPES.has(author.type);
  }

  /**
   * Fetch a conversation's participants, returning `null` on failure.
   *
   * One call per inbound message, shared by the self-message check,
   * reconciliation, and profile resolution. None of them can proceed without
   * it, so a failure is a hard stop for the caller.
   */
  protected async listParticipantsOrNull(
    conversationId: ConversationId
  ): Promise<ConversationParticipant[] | null> {
    try {
      return await this.conversationClient.listParticipants(conversationId);
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: conversationId },
        'Failed to list participants'
      );
      return null;
    }
  }

  /**
   * Build an Actions API participant reference.
   *
   * Conversation Orchestrator resolves by participant id or by explicit
   * `(channel, address)`. Prefer the id — reconciliation has already
   * established it — and fall back to the address when there isn't one.
   */
  protected participantRef(
    address: string | undefined,
    participantId: string | undefined
  ): ActionParticipantRef {
    const channel = this.getChannelName();
    if (participantId) {
      return { channel, participantId };
    }
    return { channel, ...(address ? { address } : {}) };
  }

  /** A fresh, empty session for one turn of `conversationId` on this channel. */
  protected newSession(conversationId: string): ConversationSession {
    return {
      conversationId,
      channel: this.channelType,
      startedAt: new Date(),
      metadata: {},
    };
  }

  /** Whether `p` holds `address` on `channel`. */
  private ownsAddress(p: ConversationParticipant, channel: string, address: string): boolean {
    return (
      Array.isArray(p.addresses) &&
      p.addresses.some(a => a.channel === channel && a.address === address)
    );
  }

  /**
   * Build a session for a conversation from its participants.
   *
   * Used where no inbound webhook is in hand: a CLOSED webhook, or
   * `sendResponse` given a bare id. Returns `null` when no participant is on
   * this channel, which is how another channel's conversation is filtered out.
   */
  protected sessionFromParticipants(
    conversationId: string,
    participants: ConversationParticipant[]
  ): ConversationSession | null {
    const channel = this.getChannelName();
    const matchesChannel = (p: ConversationParticipant): boolean =>
      Array.isArray(p.addresses) && p.addresses.some(a => a.channel === channel);
    if (!participants.some(matchesChannel)) {
      return null;
    }

    const session = this.newSession(conversationId);
    // With several configured senders, use the one this conversation's
    // participants hold; otherwise (or with none found) the channel default.
    const owned = this.deriveInboundAgentFromRecipients
      ? this.ownedAgentAddress(participants, channel)
      : undefined;
    const agentAddress = owned ?? this.agentAddressFor(session).address;

    const agent = participants.find(
      p =>
        p.type !== undefined &&
        AGENT_TYPES.has(p.type) &&
        this.ownsAddress(p, channel, agentAddress)
    );
    session.aiAgentInfo = {
      address: agentAddress,
      ...(agent ? { participantId: agent.id } : {}),
    };

    const customer = participants.find(
      p => p.type === 'CUSTOMER' && matchesChannel(p) && !this.ownsAddress(p, channel, agentAddress)
    );
    if (customer) {
      if (customer.profileId) {
        session.profileId = customer.profileId;
      }
      const customerAddress = customer.addresses.find(a => a.channel === channel)?.address;
      if (customerAddress) {
        session.authorInfo = { address: customerAddress, participantId: customer.id };
      }
    }
    return session;
  }

  /**
   * Resolve the session a `sendResponse` call replies within.
   *
   * A session is used as-is — it already carries both participants. A bare id
   * costs a `listParticipants` call to rebuild one, since the channel keeps no
   * session to look up.
   *
   * @throws If the participants can't be read, or no recipient resolves.
   */
  protected async resolveSendSession(
    target: ConversationId | ConversationSession
  ): Promise<ConversationSession & { authorInfo: AuthorInfo }> {
    const label = this.getChannelName();
    let session: ConversationSession | null;
    if (typeof target === 'string') {
      const participants = await this.listParticipantsOrNull(target);
      if (participants === null) {
        throw new Error(
          `Unable to send ${label} message: could not read participants for conversation ` +
            `${target}. Pass the ConversationSession from onMessageReady or ` +
            'initiateOutboundConversation to avoid this lookup.'
        );
      }
      session = this.sessionFromParticipants(target, participants);
    } else {
      session = target;
    }

    if (!session?.authorInfo) {
      const conversationId = typeof target === 'string' ? target : target.conversationId;
      throw new Error(
        `Unable to send ${label} message: no recipient resolved for conversation ` +
          `${conversationId}. Pass the ConversationSession you were handed by ` +
          'onMessageReady or initiateOutboundConversation.'
      );
    }
    return session as ConversationSession & { authorInfo: AuthorInfo };
  }

  /**
   * The `channelSettings` for a reply within `session`, if any.
   *
   * Default (SMS, RCS, WhatsApp): `channelId` is optional and passed through
   * when the session carries one. Chat overrides this, since `channelId` is
   * required for delivery there.
   */
  protected buildChannelSettings(session: ConversationSession): ActionChannelSettings | undefined {
    const channelId = session.metadata?.channelId;
    return typeof channelId === 'string' && channelId ? { channelId } : undefined;
  }

  /**
   * Send a text response using the Conversation Orchestrator Actions API
   * (SEND_MESSAGE).
   *
   * **Pass the session, not the id.** Hand back the one `onMessageReady` gave
   * you (or that `initiateOutboundConversation` returned) and the send costs no
   * extra API call — it already carries both participants. A bare id still
   * works, but the channel keeps no session to look up, so it spends a
   * `listParticipants` call rebuilding one.
   *
   * @param conversationIdOrSession - The `ConversationSession` to reply within
   * (preferred), or the conversation id.
   * @param message - Message content.
   * @param metadata - Optional metadata, passed to `onError` on failure.
   * @throws If no recipient can be resolved for the conversation, or the send
   * fails.
   */
  public async sendResponse(
    conversationIdOrSession: ConversationId | ConversationSession,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const conversationId = (
      typeof conversationIdOrSession === 'string'
        ? conversationIdOrSession
        : conversationIdOrSession.conversationId
    ) as ConversationId;
    const label = this.getChannelName();
    this.logger.debug(
      {
        conversation_id: conversationId,
        message_length: message.length,
        operation: 'send_response',
      },
      `Sending ${label} response`
    );

    try {
      const session = await this.resolveSendSession(conversationIdOrSession);
      const channelSettings = this.buildChannelSettings(session);
      const agentAddress = session.aiAgentInfo?.address ?? this.agentAddressFor(session).address;

      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_address: maskAddress(session.authorInfo.address),
          recipient_participant_id: session.authorInfo.participantId,
          agent_participant_id: session.aiAgentInfo?.participantId,
        },
        `Sending ${label} via Actions API`
      );

      const actionRequest: SendMessageActionRequest = {
        type: 'SEND_MESSAGE',
        payload: {
          from: this.participantRef(agentAddress, session.aiAgentInfo?.participantId),
          to: [this.participantRef(session.authorInfo.address, session.authorInfo.participantId)],
          content: { text: message },
          ...(channelSettings ? { channelSettings } : {}),
        },
      };

      await this.conversationClient.createAction(conversationId, actionRequest);

      this.logger.info(
        {
          conversation_id: conversationId,
          recipient_address: maskAddress(session.authorInfo.address),
        },
        `${label} message sent successfully via Actions API`
      );
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, 'Send response error');
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message,
        metadata,
      });
      throw error;
    }

    this.trackResponseSent(conversationId);
  }

  /**
   * Register event callbacks (override for messaging-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  public override on(event: string, callback: (...args: any[]) => void): void {
    if (event === 'messageReceived') {
      this.messagingCallbacks.onMessageReceived = callback;
    } else if (event === 'conversationStarted') {
      // Fired when a session was created; messaging channels no longer create
      // one, so nothing would ever call it.
      warnDeprecated(
        `${this.constructor.name}.on('conversationStarted')`,
        "tac.onMessageReady (messaging channels keep no sessions, so 'conversationStarted' never fires)"
      );
    } else {
      // Delegate to parent for base events
      super.on(event, callback);
    }
  }

  /**
   * Process messaging channel webhook from Conversation Orchestrator.
   *
   * Handles:
   *
   * - `COMMUNICATION_CREATED`: process an incoming message from the customer
   * - `CONVERSATION_UPDATED`: fire `onConversationEnded` and report
   *   "Conversation Ended" when the conversation closes
   * - `PARTICIPANT_ADDED`: report "Conversation Started" when the customer
   *   joins on this channel
   *
   * Any replica can handle any webhook. The idempotency cache is per-process,
   * though, so a Twilio retry landing on a different replica is processed
   * again, and `onMessageReady` can run twice for the same message. Retries
   * are rare when the webhook is acknowledged before processing, as
   * `TACServer` does.
   */
  public async processWebhook(payload: unknown, idempotencyToken?: string): Promise<void> {
    try {
      const result = this.preprocessWebhook(payload, idempotencyToken);
      if (!result) {
        return;
      }

      const { webhookData, eventType, conversationId } = result;

      switch (eventType) {
        case 'CONVERSATION_CREATED':
          // Nothing to do: messaging keeps no session to start, and the
          // customer joining (PARTICIPANT_ADDED) reports the start.
          this.logger.debug({ conversation_id: conversationId }, 'Ignoring CONVERSATION_CREATED');
          break;

        case 'PARTICIPANT_ADDED':
          this.trackConversationStarted(webhookData.data);
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
      this.handleError(error instanceof Error ? error : new Error(String(error)), { payload });
    }
  }

  /**
   * A loader that fetches a conversation's CO metadata, for
   * `conversationMetadata(session)`. The session keeps the result, so for its
   * turn only.
   */
  private coMetadataLoader(
    conversationId: string
  ): () => Promise<Record<string, string> | undefined> {
    return async () => {
      try {
        const conversation = await this.conversationClient.getConversation(conversationId);
        return { ...(conversation.metadata ?? {}) };
      } catch (error) {
        this.logger.warn(
          { err: error, conversation_id: conversationId },
          'Failed to fetch conversation metadata'
        );
        return undefined;
      }
    };
  }

  /**
   * Build this request's session from the webhook payload and config.
   *
   * Network-free — the author, the agent address and `channelId` are all in
   * hand already. Reconciliation layers the participant ids on after.
   * `inboundAgentAddress` is the sender the customer messaged, when the webhook
   * names it; otherwise the channel default stands in until the caller
   * resolves it.
   */
  private resolveSession(
    conversationId: ConversationId,
    payload: ConversationWebhookPayload,
    inboundAgentAddress: string | undefined
  ): ConversationSession {
    const session = this.newSession(conversationId);
    const profileId = this.extractProfileId(payload);
    if (profileId) {
      session.profileId = profileId;
    }
    if (payload.data?.serviceId) {
      session.serviceId = payload.data.serviceId;
    }
    session.authorInfo = {
      address: payload.data?.author?.address || 'unknown',
      ...(payload.data?.author?.participantId
        ? { participantId: payload.data.author.participantId }
        : {}),
    };
    // Set before agentAddress(): chat's agent address carries channelId.
    if (payload.data?.channelId) {
      session.metadata.channelId = payload.data.channelId;
    }
    session.aiAgentInfo = {
      address: inboundAgentAddress ?? this.agentAddressFor(session).address,
    };
    attachConversationMetadata(session, { loader: this.coMetadataLoader(conversationId) });
    return session;
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

    // TAC's own echo costs zero API calls — the address is right there.
    if (this.isDefaultAgentAddress(author)) {
      this.logger.info(
        { conversation_id: conversationId, author_address: maskAddress(author) },
        'Ignoring message from AI agent'
      );
      return;
    }

    // Derive which of TAC's configured numbers this message was addressed to,
    // from the webhook's recipients, and validate it against this channel's
    // allowlist. Drop messages sent to a number we don't serve.
    const channelName = this.getChannelName();
    let inboundAgentAddress: string | undefined;
    if (this.deriveInboundAgentFromRecipients) {
      const channelRecipients = (payload.data?.recipients ?? []).filter(
        r => r.channel === channelName
      );
      if (channelRecipients.length > 0) {
        const matched = channelRecipients.find(
          r => r.address !== undefined && this.isDefaultAgentAddress(r.address)
        )?.address;
        if (matched === undefined) {
          const maskedRecipients = channelRecipients.map(r => maskAddress(r.address ?? ''));
          const error = new Error('Inbound message to an unconfigured agent address; dropped');
          error.name = 'UnconfiguredAgentAddressError';
          this.logger.error(
            {
              conversation_id: conversationId,
              channel: channelName,
              recipients: maskedRecipients,
            },
            "Inbound message addressed to a number not in this channel's configured set; dropping"
          );
          this.handleError(error, {
            conversation_id: conversationId,
            channel: channelName,
            dropped_inbound: true,
            recipients: maskedRecipients,
          });
          return;
        }
        inboundAgentAddress = matched;
      }
    }

    const session = this.resolveSession(conversationId, payload, inboundAgentAddress);

    // One participant fetch per message, shared by the self-message check,
    // reconciliation, and profile resolution. All three need it, so without it
    // the message can't be answered.
    const participants = await this.listParticipantsOrNull(conversationId);
    if (participants === null) {
      const error = new Error(
        `Could not read participants for conversation ${conversationId}; inbound message dropped.`
      );
      error.name = 'ParticipantLookupError';
      this.handleError(error, {
        conversation_id: conversationId,
        channel: this.channelType,
        dropped_inbound: true,
        error_code: 'participant_lookup_failed',
      });
      return;
    }

    if (!(await this.resolveParticipants(session, payload, participants, inboundAgentAddress))) {
      return;
    }

    // Retrieve user memory if enabled via memoryMode
    const userMemory = await this.retrieveMemoryIfEnabled(session, message);

    // Invoke message received callback with memory context
    if (this.messagingCallbacks.onMessageReceived) {
      this.logger.debug({ conversation_id: conversationId }, 'Invoking message received callback');
      this.messagingCallbacks.onMessageReceived({
        conversationId,
        profileId: session.profileId as ProfileId | undefined,
        message,
        author,
        userMemory,
        session,
      });
    }

    trackEvent('Message Received', {
      account_sid: this.config.accountSid,
      channel: this.channelType,
      conversation_id: conversationId,
    });
  }

  /**
   * Resolve both sides of this turn from the participant list.
   *
   * Returns `false` when the message must not be answered: it's TAC's own, or
   * reconciliation failed (dropped, surfaced through `onError`).
   */
  private async resolveParticipants(
    session: ConversationSession,
    payload: ConversationWebhookPayload,
    participants: ConversationParticipant[],
    inboundAgentAddress: string | undefined
  ): Promise<boolean> {
    const conversationId = session.conversationId as ConversationId;
    const channel = this.getChannelName();

    if (this.isOwnMessage(payload.data?.author?.participantId, participants, conversationId)) {
      this.logger.info(
        {
          conversation_id: conversationId,
          author_address: maskAddress(session.authorInfo?.address ?? ''),
        },
        'Ignoring message from AI agent'
      );
      return false;
    }

    if (inboundAgentAddress === undefined && this.deriveInboundAgentFromRecipients) {
      // The webhook didn't say which of TAC's senders was messaged: find one
      // the conversation's participants own, else the default.
      session.aiAgentInfo = {
        address: this.fallbackAgentAddress(session, participants, channel).address,
      };
    }

    // Reconcile participant types pre-LLM so v1-bridge's UNKNOWN gets promoted
    // to CUSTOMER (with a Conversation Memory profile attached when possible)
    // and to resolve both participant ids for the reply. If it can't identify
    // both sides, any eventual reply would fail too — skip the callback rather
    // than waste an LLM turn on an un-replyable conversation. Running it every
    // message is free: it reuses the list above, and the happy-path row issues
    // no writes.
    const resolved = await this.reconcileParticipants(session, participants);
    if (!resolved) {
      // Surface via handleError (logs at error level AND fires the app's
      // onError callback) rather than a bare warn — otherwise the dropped
      // inbound is invisible to the app and can't be observed or retried.
      // Set a stable error.name and error_code so consumers can classify this
      // condition programmatically without string-matching the message.
      const error = new Error(
        `Participant reconciliation failed for conversation ${conversationId}; ` +
          'inbound message dropped because no sendable participants could be resolved.'
      );
      error.name = 'ParticipantReconciliationError';
      this.handleError(error, {
        conversation_id: conversationId,
        channel: this.channelType,
        dropped_inbound: true,
        error_code: 'participant_reconciliation_failed',
      });
      return false;
    }

    const [agentParticipant, customerParticipant] = resolved;
    session.aiAgentInfo = {
      address: session.aiAgentInfo?.address ?? this.agentAddressFor(session).address,
      participantId: agentParticipant.id,
    };
    // When reconcile resolved a customer (chat disables customer
    // reconciliation and keeps the webhook author), its participant id is the
    // authoritative reply recipient — the author of an inbound message is not
    // necessarily the customer.
    if (customerParticipant && session.authorInfo) {
      session.authorInfo.participantId = customerParticipant.id;
      if (customerParticipant.profileId) {
        session.profileId = customerParticipant.profileId;
      }
    }

    if (session.profileId === undefined && this.memoryMode !== 'never') {
      // Free, and more reliable than Memory's address-based lookup, which
      // infers the identifier type and misses on CHAT and RCS.
      const authorParticipantId = session.authorInfo?.participantId;
      const authorProfileId = authorParticipantId
        ? participants.find(p => p.id === authorParticipantId)?.profileId
        : undefined;
      if (authorProfileId) {
        session.profileId = authorProfileId;
      }
    }

    return true;
  }

  /**
   * Handle conversation updated event.
   *
   * Only CLOSED is acted on: it fires `onConversationEnded` and reports
   * "Conversation Ended". With neither a handler registered nor analytics on,
   * it costs nothing. Otherwise one participant lookup — shared with the other
   * channels handling the same webhook — confirms the conversation is on this
   * channel (a CHAT close must not fire on SMS) and lets this work on whichever
   * replica Twilio picked.
   *
   * The session is rebuilt the same way on every replica. The conversation's
   * CO metadata is read through `conversationMetadata(session)`: answered from
   * the payload when it carries metadata, otherwise fetched on demand.
   */
  private async handleConversationUpdated(payload: ConversationWebhookPayload): Promise<void> {
    const conversationId = this.extractConversationId(payload);

    if (!conversationId) {
      throw new Error('Missing conversation ID in conversation.updated event');
    }

    const data = payload.data ?? {};
    if (data.configurationId !== this.config.conversationConfigurationId) {
      return;
    }
    if (data.status !== 'CLOSED') {
      return;
    }
    const notify = this.hasConversationEndedHandler();
    const report = analyticsEnabled();
    if (!notify && !report) {
      return;
    }

    let participants: ConversationParticipant[];
    try {
      participants = await this.tac.listParticipantsShared(conversationId);
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: conversationId },
        'Failed to list participants for a closed conversation'
      );
      return;
    }
    const session = this.sessionFromParticipants(conversationId, participants);
    if (session === null) {
      return;
    }

    const parsed = ConversationResponseSchema.shape.metadata.safeParse(data.metadata);
    if (parsed.success && parsed.data !== undefined) {
      attachConversationMetadata(session, { known: parsed.data });
    } else {
      attachConversationMetadata(session, { loader: this.coMetadataLoader(conversationId) });
    }

    this.logger.debug({ conversation_id: conversationId }, 'Conversation closed');
    if (report) {
      this.trackConversationEnded(
        conversationId,
        elapsedMs(
          typeof data.createdAt === 'string' ? data.createdAt : undefined,
          typeof data.updatedAt === 'string' ? data.updatedAt : undefined
        )
      );
    }
    if (notify) {
      await this.triggerConversationEnded(session);
    }
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
   * @param session - Supplies the conversation id and the agent address to
   * match on — the sender the customer messaged, already resolved on
   * `session.aiAgentInfo`.
   * @param participants - Already fetched by the caller; reusing that response
   * is what makes running this on every message free.
   * @returns `[agent, customerOrNull]` on success. `customer` is `null` when
   * `reconcileCustomerType` is `false`. `null` overall when either the agent
   * or the customer cannot be resolved — the caller treats `null` as a hard
   * stop and skips the message-ready callback.
   */
  protected async reconcileParticipants(
    session: ConversationSession,
    participants: ConversationParticipant[]
  ): Promise<[ConversationParticipant, ConversationParticipant | null] | null> {
    const conversationId = session.conversationId as ConversationId;
    const channel = this.getChannelName();
    // Keep agentAddress()'s channelId (required for CHAT); the session only
    // overrides which sender.
    const baseAgentAddress = this.agentAddressFor(session);
    const agentAddress: ConversationAddress = session.aiAgentInfo
      ? { ...baseAgentAddress, address: session.aiAgentInfo.address }
      : baseAgentAddress;

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
   * Resolve the agent address when the inbound webhook carried no recipient.
   *
   * Scans the conversation's participants for any of TAC's configured addresses
   * on this channel; falls back to the channel default when none is present.
   * Defensive path — the primary source is the webhook.
   */
  protected fallbackAgentAddress(
    session: ConversationSession,
    participants: ConversationParticipant[],
    channel: ParticipantAddressType
  ): ConversationAddress {
    const conversationId = session.conversationId;
    const owned = this.ownedAgentAddress(participants, channel);
    if (owned !== undefined) {
      this.logger.warn(
        { conversation_id: conversationId, channel },
        'Inbound webhook had no channel recipient; using owned participant address from participant scan'
      );
      return { channel, address: owned };
    }

    this.logger.warn(
      { conversation_id: conversationId, channel },
      'Inbound webhook had no channel recipient and no owned participant; using default agent address'
    );
    return this.agentAddressFor(session);
  }

  /**
   * The first of TAC's configured addresses on this channel that a participant
   * holds, if any.
   */
  protected ownedAgentAddress(
    participants: ConversationParticipant[],
    channel: ParticipantAddressType
  ): string | undefined {
    return participants
      .flatMap(p => (Array.isArray(p.addresses) ? p.addresses : []))
      .find(a => a.channel === channel && this.isDefaultAgentAddress(a.address))?.address;
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
   * Handles the full flow: create conversation → find participants → build
   * session → send initial message → error cleanup. The session isn't kept by
   * the channel; it is returned to the caller.
   *
   * `metadata` entries with string values that fit Conversation Orchestrator's
   * limits are stored on the conversation (at creation; merged with a `PATCH`
   * when an existing conversation is reused), so `conversationMetadata()` can
   * read them on any replica. The rest stay on the returned session only.
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

    const { persisted: coMetadata, skippedKeys } = fitConversationMetadata(metadata);
    const hasCoMetadata = Object.keys(coMetadata).length > 0;
    if (skippedKeys.length > 0) {
      this.logger.warn(
        { skipped_keys: skippedKeys },
        'Outbound metadata not stored on the conversation: Conversation Orchestrator allows ' +
          "at most 8 keys of letters, digits, '.', '_' or '-', with string values up to 512 " +
          'characters'
      );
    }

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

      const result = await this.conversationClient.createOrReuseConversation(
        [
          { type: 'CUSTOMER', addresses: [customerAddress] },
          { type: 'AI_AGENT', addresses: [agentAddress] },
        ],
        // Omitted, not {}, so a send without metadata creates the conversation
        // exactly as before.
        hasCoMetadata ? coMetadata : undefined
      );
      conversationId = result.conversation.id;
      conversationReused = result.reused;

      if (!isConversationId(conversationId)) {
        throw new Error(`Invalid conversation ID returned: ${conversationId}`);
      }

      let knownCoMetadata: Record<string, string> | undefined = coMetadata;
      if (conversationReused && !hasCoMetadata) {
        // Nothing to merge; what the reused conversation already holds is
        // unknown until conversationMetadata() fetches it.
        knownCoMetadata = undefined;
      } else if (conversationReused) {
        // Existing conversation: merge ours in; CO keeps keys set earlier.
        try {
          const patched = await this.conversationClient.patchConversationMetadata(
            conversationId,
            coMetadata
          );
          knownCoMetadata = { ...(patched.metadata ?? {}) };
        } catch (patchError) {
          this.logger.warn(
            { err: patchError, conversation_id: conversationId },
            'Failed to store outbound metadata on the reused conversation'
          );
          knownCoMetadata = undefined;
        }
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

      const session = this.newSession(conversationId);
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
      attachConversationMetadata(session, {
        ...(knownCoMetadata !== undefined && { known: knownCoMetadata }),
        loader: this.coMetadataLoader(conversationId),
      });

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
      const cause = error instanceof Error ? (error.cause ?? error) : error;
      const status = axios.isAxiosError(cause) ? cause.response?.status : undefined;
      if (
        conversationId === undefined &&
        hasCoMetadata &&
        status !== undefined &&
        status >= 400 &&
        status < 500
      ) {
        // TAC sends metadata at creation, and the client logs no body: name
        // it as a possible cause.
        this.logger.warn(
          { status, metadata_keys: Object.keys(coMetadata).sort() },
          'Conversation Orchestrator rejected creating the conversation; the request ' +
            'included conversation metadata, which may be the cause'
        );
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
