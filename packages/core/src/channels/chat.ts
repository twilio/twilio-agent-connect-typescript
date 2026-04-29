import {
  ActionChannelSettings,
  ChannelType,
  ConversationId,
  SendMessageActionRequest,
  InitiateConversationResult,
} from '../types/index';
import { z } from 'zod';
import { MessagingChannel, MessagingChannelConfig } from './messaging';
import type { TAC } from '../lib/tac';
import { maskAddress } from '../util/log-redaction';

/**
 * Options for initiating an outbound chat conversation
 */
export const InitiateChatConversationOptionsSchema = z.object({
  to: z.string().min(1, 'Recipient identity is required'),
  /**
   * Custom sender address. Defaults to agentAddress.
   * Own-message filtering considers outbound sender values, including
   * agentAddress and session metadata such as fromAddress.
   */
  from: z.string().optional(),
  channelId: z.string().min(1, 'Chat Channel SID is required'),
  message: z.string().min(1, 'Initial message is required'),
  metadata: z.record(z.unknown()).optional(),
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

  /**
   * Send chat response using the Conversation Orchestrator Actions API (SEND_MESSAGE).
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

      if (!session) {
        throw new Error(`No active session found for conversation ${conversationId}`);
      }

      if (!session.authorInfo) {
        throw new Error(
          `No author info found for conversation ${conversationId} - no inbound message received yet`
        );
      }

      const recipientParticipantId = session.authorInfo.participantId;
      if (!recipientParticipantId) {
        throw new Error(`No recipient participant ID found for conversation ${conversationId}`);
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

      // Fetch current participants from Conversation Orchestrator
      const participants = await this.conversationClient.listParticipants(conversationId);

      // Use fromAddress from session metadata (set during outbound initiation),
      // falling back to the default agent address for inbound conversations
      const effectiveAgentAddress =
        typeof session.metadata?.fromAddress === 'string'
          ? session.metadata.fromAddress
          : this.agentAddress;

      const agentParticipant = await this.ensureAgentParticipant(conversationId, participants, {
        channel: 'CHAT',
        address: effectiveAgentAddress,
        channelId: chatChannelSid,
      });
      if (!agentParticipant) {
        throw new Error(
          `Failed to resolve AI_AGENT participant for conversation ${conversationId}`
        );
      }

      // TODO(conv-orch): Drop `chatService` here once the Actions API resolves
      // the V1 Chat service SID server-side. Confirmed this should not be
      // required client-side; keep the workaround until the server-side fix
      // ships. `channelId` stays — it's a permanent per-conversation requirement.
      const chatServiceSid = this.tac.conversationsV1ServiceSid;
      const channelSettings: ActionChannelSettings = {
        channelId: chatChannelSid,
        ...(chatServiceSid ? { chatService: chatServiceSid } : {}),
      };

      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_participant_id: session.authorInfo.participantId,
          agent_participant_id: agentParticipant.id,
          agent_address: effectiveAgentAddress,
          channel_id: chatChannelSid,
        },
        'Sending chat message via Actions API'
      );

      const actionRequest: SendMessageActionRequest = {
        type: 'SEND_MESSAGE',
        payload: {
          from: {
            channel: 'CHAT',
            participantId: agentParticipant.id,
          },
          to: [
            {
              channel: 'CHAT',
              participantId: recipientParticipantId,
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
   */
  public async initiateOutboundConversation(
    options: InitiateChatConversationOptions
  ): Promise<InitiateConversationResult> {
    const validated = InitiateChatConversationOptionsSchema.parse(options);

    this.logger.info(
      { to: maskAddress(validated.to), channel_id: validated.channelId },
      'Initiating outbound chat conversation'
    );

    const chatServiceSid = this.tac.conversationsV1ServiceSid;

    return this.initiateOutboundMessagingConversation({
      channel: 'CHAT',
      to: validated.to,
      from: validated.from ?? this.agentAddress,
      message: validated.message,
      ...(validated.metadata ? { metadata: validated.metadata } : {}),
      channelId: validated.channelId,
      channelSettings: {
        channelId: validated.channelId,
        ...(chatServiceSid ? { chatService: chatServiceSid } : {}),
      },
    });
  }
}
