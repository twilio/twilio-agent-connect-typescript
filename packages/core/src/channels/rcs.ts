import {
  ChannelType,
  ConversationAddress,
  ConversationId,
  SendMessageActionRequest,
  InitiateMessagingConversationOptions,
  InitiateMessagingConversationOptionsSchema,
  InitiateConversationResult,
} from '../types/index';
import { MessagingChannel, MessagingChannelConfig } from './messaging';
import { maskAddress } from '../util/log-redaction';
import type { TAC } from '../lib/tac';

/**
 * RCS Channel implementation for Twilio Conversations Service
 *
 * Handles RCS (Rich Communication Services) conversations through webhook
 * events from Twilio. The RCS Sender ID is configured on `TACConfig` via
 * `TWILIO_RCS_SENDER_ID`. Follows the same pattern as SMS (sender from
 * TAC config) for consistency with other messaging channels.
 */
export class RCSChannel extends MessagingChannel {
  constructor(tac: TAC, config?: MessagingChannelConfig) {
    super(tac, config);

    if (this.config.rcsSenderIds.length === 0) {
      throw new Error(
        'rcsSenderId(s) is required for RCS channel. ' +
          'Set TWILIO_RCS_SENDER_ID / TWILIO_RCS_SENDER_IDS or provide ' +
          'rcsSenderId / rcsSenderIds in TACConfig.'
      );
    }
  }

  public get channelType(): ChannelType {
    return 'rcs';
  }

  protected isDefaultAgentAddress(authorAddress: string): boolean {
    return this.config.rcsSenderIds.includes(authorAddress);
  }

  protected getAgentAddress(_conversationId: ConversationId): ConversationAddress {
    if (!this.config.rcsSenderId) {
      throw new Error('rcsSenderId is required for RCS channel.');
    }
    return { channel: 'RCS', address: this.config.rcsSenderId };
  }

  /**
   * Send RCS response using the Conversation Orchestrator Actions API (SEND_MESSAGE).
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
      'Sending RCS response'
    );

    try {
      const session = this.getConversationSession(conversationId);

      if (!session || !session.authorInfo || !session.aiAgentInfo) {
        throw new Error(
          `Unable to send RCS: sendResponse called without a reconciled session for ` +
            `conversation ${conversationId}. Wait for an inbound webhook or call ` +
            `initiateOutboundConversation first.`
        );
      }

      const customerParticipantId = session.authorInfo.participantId;
      const agentParticipantId = session.aiAgentInfo.participantId;
      if (!customerParticipantId || !agentParticipantId) {
        throw new Error(
          `Unable to send RCS: session for conversation ${conversationId} is missing ` +
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
        'Sending RCS via Actions API'
      );

      const actionRequest: SendMessageActionRequest = {
        type: 'SEND_MESSAGE',
        payload: {
          from: {
            channel: 'RCS',
            participantId: agentParticipantId,
          },
          to: [
            {
              channel: 'RCS',
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
        'RCS sent successfully via Actions API'
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
   * Initiate an outbound RCS conversation
   *
   * Creates a conversation via Conversation Orchestrator, adds customer and
   * agent participants, then sends the initial message via the Actions API.
   * Uses `options.from` when provided (must be one of the configured RCS
   * senders), otherwise falls back to the default `config.rcsSenderId`.
   */
  public async initiateOutboundConversation(
    options: InitiateMessagingConversationOptions
  ): Promise<InitiateConversationResult> {
    const validated = InitiateMessagingConversationOptionsSchema.parse(options);

    this.logger.info(
      { to: maskAddress(validated.to), message_length: validated.message.length },
      'Initiating outbound RCS conversation'
    );

    return this.initiateOutboundMessagingConversation({
      channel: 'RCS',
      to: validated.to,
      from: this.resolveOutboundFrom(validated.from, {
        allowlist: this.config.rcsSenderIds,
        default: this.config.rcsSenderId,
      }),
      message: validated.message,
      ...(validated.metadata ? { metadata: validated.metadata } : {}),
    });
  }
}
