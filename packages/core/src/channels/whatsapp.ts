import {
  ChannelType,
  ConversationAddress,
  ConversationId,
  SendMessageActionRequest,
  InitiateMessagingConversationOptions,
  InitiateMessagingConversationOptionsSchema,
  InitiateConversationResult,
} from '../types/index';
import { MessagingChannel } from './messaging';
import { maskAddress } from '../util/log-redaction';

/**
 * WhatsApp Channel implementation for Twilio Conversations Service
 *
 * Handles WhatsApp conversations through webhook events from Twilio.
 * Automatically retrieves user memory and manages conversation lifecycle.
 *
 * WhatsApp uses WhatsApp sender phone numbers configured in TACConfig
 * (via TWILIO_WHATSAPP_NUMBER). Address format: whatsapp:+1234567890
 */
export class WhatsAppChannel extends MessagingChannel {
  public get channelType(): ChannelType {
    return 'whatsapp';
  }

  protected isDefaultAgentAddress(authorAddress: string): boolean {
    if (!this.config.whatsappNumber) {
      throw new Error(
        'whatsappNumber is required for WhatsApp channel. ' +
          'Please set TWILIO_WHATSAPP_NUMBER environment variable or ' +
          'provide whatsappNumber in TACConfig.'
      );
    }
    return authorAddress === this.config.whatsappNumber;
  }

  protected getAgentAddress(_conversationId: ConversationId): ConversationAddress {
    if (!this.config.whatsappNumber) {
      throw new Error(
        'whatsappNumber is required for WhatsApp channel. ' +
          'Please set TWILIO_WHATSAPP_NUMBER environment variable or ' +
          'provide whatsappNumber in TACConfig.'
      );
    }
    return { channel: 'WHATSAPP', address: this.config.whatsappNumber };
  }

  /**
   * Send WhatsApp response using the Conversation Orchestrator Actions API (SEND_MESSAGE).
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
      'Sending WhatsApp response'
    );

    try {
      const session = this.getConversationSession(conversationId);

      if (!session || !session.authorInfo || !session.aiAgentInfo) {
        throw new Error(
          `Unable to send WhatsApp: sendResponse called without a reconciled session for ` +
            `conversation ${conversationId}. Wait for an inbound webhook or call ` +
            `initiateOutboundConversation first.`
        );
      }

      const customerParticipantId = session.authorInfo.participantId;
      const agentParticipantId = session.aiAgentInfo.participantId;
      if (!customerParticipantId || !agentParticipantId) {
        throw new Error(
          `Unable to send WhatsApp: session for conversation ${conversationId} is missing ` +
            `participant ids.`
        );
      }

      const channelId =
        typeof session.metadata?.channelId === 'string' ? session.metadata.channelId : undefined;

      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_address: maskAddress(session.authorInfo.address),
          recipient_participant_id: customerParticipantId,
          agent_participant_id: agentParticipantId,
        },
        'Sending WhatsApp via Actions API'
      );

      const actionRequest: SendMessageActionRequest = {
        type: 'SEND_MESSAGE',
        payload: {
          from: {
            channel: 'WHATSAPP',
            participantId: agentParticipantId,
          },
          to: [
            {
              channel: 'WHATSAPP',
              participantId: customerParticipantId,
            },
          ],
          content: { text: message },
          ...(channelId ? { channelSettings: { channelId } } : {}),
        },
      };

      await this.conversationClient.createAction(conversationId, actionRequest);

      this.logger.info(
        {
          conversation_id: conversationId,
          recipient_address: maskAddress(session.authorInfo.address),
        },
        'WhatsApp sent successfully via Actions API'
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
   * Initiate an outbound WhatsApp conversation
   *
   * Creates a conversation via Conversation Orchestrator, adds customer and
   * agent participants, then sends the initial message via the Actions API.
   * The sender is always `config.whatsappNumber`.
   */
  public async initiateOutboundConversation(
    options: InitiateMessagingConversationOptions
  ): Promise<InitiateConversationResult> {
    const validated = InitiateMessagingConversationOptionsSchema.parse(options);

    if (!this.config.whatsappNumber) {
      throw new Error(
        'whatsappNumber is required for WhatsApp channel. ' +
          'Please set TWILIO_WHATSAPP_NUMBER environment variable or ' +
          'provide whatsappNumber in TACConfig.'
      );
    }

    this.logger.info(
      { to: maskAddress(validated.to), message_length: validated.message.length },
      'Initiating outbound WhatsApp conversation'
    );

    return this.initiateOutboundMessagingConversation({
      channel: 'WHATSAPP',
      to: validated.to,
      from: this.config.whatsappNumber,
      message: validated.message,
      ...(validated.metadata ? { metadata: validated.metadata } : {}),
    });
  }
}
