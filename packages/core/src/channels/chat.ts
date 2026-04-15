import { ChannelType, ConversationId } from '../types/index';
import { MessagingChannel, MessagingChannelConfig } from './messaging';
import type { TAC } from '../lib/tac';

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

  /**
   * Check if a message is from the bot itself (by agent address)
   */
  protected isOwnMessage(authorAddress: string): boolean {
    return authorAddress === this.agentAddress;
  }

  /**
   * Send chat response using Conversation Orchestrator Send API
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

      // Get channelId (Chat Channel SID) from session metadata - REQUIRED for CHAT participants
      const chatChannelSid =
        typeof session.metadata?.channelId === 'string' ? session.metadata.channelId : undefined;

      if (!chatChannelSid) {
        throw new Error(
          `No channelId found in session metadata for conversation ${conversationId}`
        );
      }

      const recipientAddress = session.authorInfo.address;

      // Fetch current participants from Conversation Orchestrator
      const participants = await this.conversationClient.listParticipants(conversationId);

      // Find AI_AGENT participant (may not exist yet for chat)
      let agentParticipant = participants.find(p => p.type === 'AI_AGENT' || p.type === 'AGENT');

      // If no AI_AGENT participant exists, create one (lazy creation)
      if (!agentParticipant) {
        this.logger.debug(
          {
            conversation_id: conversationId,
            agent_address: this.agentAddress,
            channel_id: chatChannelSid,
          },
          'No AI_AGENT participant found, creating one'
        );

        try {
          // IMPORTANT: channelId is REQUIRED when adding CHAT participants
          agentParticipant = await this.conversationClient.addParticipant(
            conversationId,
            [{ channel: 'CHAT' as const, address: this.agentAddress, channelId: chatChannelSid }],
            'AI_AGENT'
          );

          this.logger.info(
            {
              conversation_id: conversationId,
              participant_id: agentParticipant.id,
              agent_address: this.agentAddress,
              channel_id: chatChannelSid,
            },
            'Created AI_AGENT participant'
          );
        } catch (error) {
          // Handle race condition: another process might have created it
          this.logger.warn(
            { err: error, conversation_id: conversationId },
            'Failed to create AI_AGENT participant, attempting to list participants again'
          );

          // Retry listing to see if it was created by another process
          const retriedParticipants =
            await this.conversationClient.listParticipants(conversationId);
          agentParticipant = retriedParticipants.find(
            p => p.type === 'AI_AGENT' || p.type === 'AGENT'
          );

          if (!agentParticipant) {
            throw new Error(
              `Failed to create or find AI_AGENT participant for conversation ${conversationId}`
            );
          }
        }
      }

      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_address: recipientAddress,
          recipient_participant_id: session.authorInfo.participantId,
          agent_participant_id: agentParticipant.id,
          agent_address: this.agentAddress,
        },
        'Sending chat message via Send API'
      );

      // Build Send API request with author (AI_AGENT) and recipient (HUMAN_AGENT)
      const sendRequest = {
        author: {
          address: this.agentAddress,
          channel: 'CHAT' as const,
          participantId: agentParticipant.id,
        },
        recipients: [
          {
            address: recipientAddress,
            channel: 'CHAT' as const,
            participantId: session.authorInfo.participantId,
          },
        ],
        content: {
          type: 'TEXT' as const,
          text: message,
        },
        channelId: chatChannelSid,
      };

      // Send via Conversation Orchestrator Send API
      await this.conversationClient.sendCommunication(conversationId, sendRequest);

      this.logger.info(
        { conversation_id: conversationId, channel_id: chatChannelSid },
        'Chat message sent successfully via Send API'
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
}
