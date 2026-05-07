import {
  ActionChannelSettings,
  ChannelType,
  ConversationAddress,
  ConversationId,
  SendMessageActionRequest,
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

  protected getAgentAddress(conversationId: ConversationId): ConversationAddress {
    const session = this.getConversationSession(conversationId);
    const channelId =
      session && typeof session.metadata?.channelId === 'string'
        ? session.metadata.channelId
        : undefined;
    return {
      channel: 'CHAT',
      address: this.agentAddress,
      ...(channelId ? { channelId } : {}),
    };
  }

  /**
   * Send chat response using the Conversation Orchestrator Actions API (SEND_MESSAGE).
   *
   * Reads the agent and customer participant ids stashed on the session by
   * inbound reconciliation or outbound initiation. Missing ids are a misuse —
   * `sendResponse` is only expected to be called after an inbound webhook
   * (COMMUNICATION_CREATED → reconcile) or after `initiateOutboundConversation`,
   * both of which populate the session.
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
      'Sending chat response'
    );

    try {
      const session = this.getConversationSession(conversationId);

      if (!session || !session.authorInfo || !session.aiAgentInfo) {
        throw new Error(
          `Unable to send chat message: sendResponse called without a reconciled session ` +
            `for conversation ${conversationId}. Wait for an inbound webhook or call ` +
            `initiateOutboundConversation first.`
        );
      }

      const customerParticipantId = session.authorInfo.participantId;
      const agentParticipantId = session.aiAgentInfo.participantId;
      if (!customerParticipantId || !agentParticipantId) {
        throw new Error(
          `Unable to send chat message: session for conversation ${conversationId} is ` +
            `missing participant ids.`
        );
      }

      // channelId (Chat Channel SID) is required for CHAT delivery — the V1
      // Chat backend uses it to pick the destination thread. Inbound webhooks
      // always populate it, so a missing value here is a misuse.
      const chatChannelSid =
        typeof session.metadata?.channelId === 'string' ? session.metadata.channelId : undefined;

      if (!chatChannelSid) {
        throw new Error(
          "Missing required session.metadata['channelId'] for chat sendResponse; " +
            'this is normally populated by an inbound webhook. Ensure an inbound ' +
            'message has been processed before calling sendResponse, or set ' +
            "session.metadata['channelId'] explicitly in advanced usage."
        );
      }

      const channelSettings: ActionChannelSettings = {
        channelId: chatChannelSid,
      };

      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_participant_id: customerParticipantId,
          agent_participant_id: agentParticipantId,
          channel_id: chatChannelSid,
        },
        'Sending chat message via Actions API'
      );

      const actionRequest: SendMessageActionRequest = {
        type: 'SEND_MESSAGE',
        payload: {
          from: {
            channel: 'CHAT',
            participantId: agentParticipantId,
          },
          to: [
            {
              channel: 'CHAT',
              participantId: customerParticipantId,
            },
          ],
          content: { text: message },
          channelSettings,
        },
      };

      await this.conversationClient.createAction(conversationId, actionRequest);

      this.logger.info(
        { conversation_id: conversationId, channel_id: chatChannelSid },
        'Chat message sent successfully via Actions API'
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
