import {
  ChannelType,
  ConversationAddress,
  ConversationId,
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
