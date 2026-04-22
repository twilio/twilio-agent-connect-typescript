import { ChannelType, ConversationId, SendMessageActionRequest } from '../types/index';
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
    return authorAddress === this.config.phoneNumber;
  }

  /**
   * Send SMS response using the Conversation Orchestrator Actions API (SEND_MESSAGE).
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

      // Fetch current participants from Conversation Orchestrator
      const participants = await this.conversationClient.listParticipants(conversationId);

      // Find the CUSTOMER participant on the SMS channel
      let customerParticipantId: string | undefined;
      for (const p of participants) {
        if (p.type !== 'CUSTOMER' || !Array.isArray(p.addresses)) continue;
        const smsAddress = p.addresses.find(a => a.channel === 'SMS');
        if (smsAddress) {
          customerParticipantId = p.id;
          break;
        }
      }

      const agentParticipant = await this.ensureAgentParticipant(conversationId, participants, {
        channel: 'SMS',
        address: this.config.phoneNumber,
      });
      if (!agentParticipant) {
        throw new Error(
          `Failed to resolve AI_AGENT participant for conversation ${conversationId}`
        );
      }

      if (!customerParticipantId) {
        throw new Error(
          `Customer participant not found on SMS channel for conversation ${conversationId}`
        );
      }

      const channelId =
        typeof session.metadata?.channelId === 'string' ? session.metadata.channelId : undefined;

      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_address: recipientAddress,
          recipient_participant_id: customerParticipantId,
          agent_participant_id: agentParticipant.id,
          from_number: this.config.phoneNumber,
        },
        'Sending SMS via Actions API'
      );

      const actionRequest: SendMessageActionRequest = {
        type: 'SEND_MESSAGE',
        payload: {
          from: {
            channel: 'SMS',
            participantId: agentParticipant.id,
          },
          to: [
            {
              channel: 'SMS',
              participantId: customerParticipantId,
            },
          ],
          content: { text: message },
          ...(channelId ? { channelSettings: { channelId } } : {}),
        },
      };

      await this.conversationClient.createAction(conversationId, actionRequest);

      this.logger.info(
        { conversation_id: conversationId, recipient_address: recipientAddress },
        'SMS sent successfully via Actions API'
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
