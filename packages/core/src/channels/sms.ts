import { ChannelType, ConversationId } from '../types/index';
import { MessagingChannel } from './messaging';

/**
 * SMS Channel implementation for Twilio Conversations Service
 *
 * Handles SMS conversations through webhook events from Twilio.
 * Automatically retrieves user memory and manages conversation lifecycle.
 */
export class SMSChannel extends MessagingChannel {
  public get channelType(): ChannelType {
    return 'sms';
  }

  /**
   * Check if a message is from the bot itself (by phone number)
   */
  protected isOwnMessage(authorAddress: string): boolean {
    return authorAddress === this.config.twilioPhoneNumber;
  }

  /**
   * Send SMS response using Conversation Orchestrator Send API
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

      if (!session.authorInfo) {
        throw new Error(
          `No author info found for conversation ${conversationId} - no inbound message received yet`
        );
      }

      const recipientAddress = session.authorInfo.address;

      // Fetch current agent participant from Conversation Orchestrator
      const participants = await this.conversationClient.listParticipants(conversationId);

      // First, find all participants that have the configured SMS address
      const smsParticipants = participants.filter(
        p =>
          Array.isArray(p.addresses) &&
          p.addresses.some(
            addr => addr.channel === 'SMS' && addr.address === this.config.twilioPhoneNumber
          )
      );

      // Prefer AI/HUMAN agent participants when available, but fall back to any SMS participant
      const agentParticipant =
        smsParticipants.find(
          p => p.type === 'AI_AGENT' || p.type === 'HUMAN_AGENT' || p.type === 'AGENT'
        ) ?? smsParticipants[0];

      if (!agentParticipant) {
        throw new Error(
          `Agent participant not found for conversation ${conversationId} with phone ${this.config.twilioPhoneNumber}`
        );
      }

      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_address: recipientAddress,
          recipient_participant_id: session.authorInfo.participantId,
          agent_participant_id: agentParticipant.id,
          from_number: this.config.twilioPhoneNumber,
        },
        'Sending SMS via Send API'
      );

      await this.conversationClient.sendCommunication(conversationId, {
        author: {
          address: this.config.twilioPhoneNumber,
          channel: 'SMS',
          participantId: agentParticipant.id,
        },
        recipients: [
          {
            address: recipientAddress,
            channel: 'SMS',
            participantId: session.authorInfo.participantId,
          },
        ],
        content: {
          type: 'TEXT',
          text: message,
        },
      });

      this.logger.info(
        { conversation_id: conversationId, recipient_address: recipientAddress },
        'SMS sent successfully via Send API'
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
