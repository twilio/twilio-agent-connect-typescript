import {
  ActionChannelSettings,
  ChannelType,
  ConversationAddress,
  ConversationId,
  ConversationParticipant,
  ConversationSession,
  InitiateConversationResult,
} from '../types/index';
import { z } from 'zod';
import { MessagingChannel, MessagingChannelConfig } from './messaging';
import type { TAC } from '../lib/tac';
import { maskAddress } from '../util/log-redaction';

/**
 * Options for initiating an outbound chat conversation.
 *
 * The sender is always the channel's configured `agentAddress`. Multi-sender
 * deployments should run one TAC instance per sender.
 */
export const InitiateChatConversationOptionsSchema = z.object({
  to: z.string().min(1, 'Recipient identity is required'),
  channelId: z.string().min(1, 'Chat Channel SID is required'),
  message: z.string().min(1, 'Initial message is required'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InitiateChatConversationOptions = z.infer<typeof InitiateChatConversationOptionsSchema>;

/**
 * Chat channel configuration options
 */
export interface ChatChannelConfig extends MessagingChannelConfig {
  /** Chat agent identity string (defaults to 'ai-assistant') */
  agentAddress?: string;
}

/**
 * Chat Channel implementation for Twilio Conversations Service
 *
 * Handles web chat conversations through webhook events from Twilio.
 * Uses identity-based addressing instead of phone numbers.
 * Automatically creates AI_AGENT participant if needed and manages conversation lifecycle.
 */
export class ChatChannel extends MessagingChannel {
  private readonly agentAddress: string;

  // Chat identifies the customer author-driven from the webhook's
  // `author.participantId`; promoting some other channel-matching UNKNOWN
  // CHAT participant could pick the wrong recipient.
  protected override reconcileCustomerType: boolean = false;

  // Chat's agent is a single identity, not a set of numbers, so it keeps the
  // default-address path rather than deriving the agent from webhook recipients.
  protected override deriveInboundAgentFromRecipients: boolean = false;

  constructor(tac: TAC, config?: ChatChannelConfig) {
    super(tac, config);
    this.agentAddress = config?.agentAddress ?? 'ai-assistant';
  }

  public get channelType(): ChannelType {
    return 'chat';
  }

  protected isDefaultAgentAddress(authorAddress: string): boolean {
    return authorAddress === this.agentAddress;
  }

  protected getAgentAddress(_conversationId: ConversationId): ConversationAddress {
    // channelId is per-conversation and arrives on each turn's session, so a
    // lookup by id alone can't supply it.
    return this.chatAddress(undefined);
  }

  protected override agentAddressFor(session: ConversationSession): ConversationAddress {
    // channelId comes off the session; the inbound webhook puts it there.
    return this.chatAddress(session.metadata?.channelId);
  }

  private chatAddress(channelId: unknown): ConversationAddress {
    return {
      channel: 'CHAT',
      address: this.agentAddress,
      ...(typeof channelId === 'string' && channelId ? { channelId } : {}),
    };
  }

  /**
   * Rebuild the session, recovering `channelId` from the participants.
   *
   * A session rebuilt from a bare conversation id has no webhook to take
   * `channelId` from, so it's read off the customer's or agent's CHAT address
   * instead, where Conversation Orchestrator records it.
   */
  protected override sessionFromParticipants(
    conversationId: string,
    participants: ConversationParticipant[]
  ): ConversationSession | null {
    const session = super.sessionFromParticipants(conversationId, participants);
    if (session === null || session.metadata.channelId) {
      return session;
    }
    const ownIds = new Set(
      [session.authorInfo?.participantId, session.aiAgentInfo?.participantId].filter(
        (id): id is string => Boolean(id)
      )
    );
    const channelId = participants
      .filter(p => ownIds.has(p.id))
      .flatMap(p => p.addresses)
      .find(a => a.channel === 'CHAT' && a.channelId)?.channelId;
    if (channelId) {
      session.metadata.channelId = channelId;
    }
    return session;
  }

  protected override buildChannelSettings(session: ConversationSession): ActionChannelSettings {
    // channelId (Chat Channel SID) is required for CHAT delivery — the V1
    // Chat backend uses it to pick the destination thread. Inbound webhooks
    // always populate it; a session rebuilt from a bare id has it only when
    // the conversation's participants carry it.
    const channelId = session.metadata?.channelId;
    if (typeof channelId !== 'string' || !channelId) {
      throw new Error(
        "Missing required session.metadata['channelId'] for chat sendResponse. Pass the " +
          'ConversationSession from onMessageReady or initiateOutboundConversation: a bare ' +
          "conversation id works only when the conversation's CHAT participants carry a " +
          'channelId.'
      );
    }
    return { channelId };
  }

  /**
   * Initiate an outbound chat conversation
   *
   * Creates a conversation via Conversation Orchestrator, adds customer and
   * agent participants, then sends the initial message via the Actions API.
   * The sender is always this channel's configured `agentAddress`.
   */
  public async initiateOutboundConversation(
    options: InitiateChatConversationOptions
  ): Promise<InitiateConversationResult> {
    const validated = InitiateChatConversationOptionsSchema.parse(options);

    this.logger.info(
      { to: maskAddress(validated.to), channel_id: validated.channelId },
      'Initiating outbound chat conversation'
    );

    return this.initiateOutboundMessagingConversation({
      channel: 'CHAT',
      to: validated.to,
      from: this.agentAddress,
      message: validated.message,
      ...(validated.metadata ? { metadata: validated.metadata } : {}),
      channelId: validated.channelId,
      channelSettings: {
        channelId: validated.channelId,
      },
    });
  }
}
