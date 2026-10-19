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
 * WhatsApp Channel implementation for Twilio Conversations Service
 *
 * Handles WhatsApp conversations through webhook events from Twilio.
 * Automatically retrieves user memory and manages conversation lifecycle.
 *
 * WhatsApp uses WhatsApp sender phone numbers configured in TACConfig
 * (via TWILIO_WHATSAPP_NUMBER). Address format: whatsapp:+1234567890
 */
export class WhatsAppChannel extends MessagingChannel {
  constructor(tac: TAC, config?: MessagingChannelConfig) {
    super(tac, config);

    if (this.config.whatsappNumbers.length === 0) {
      throw new Error(
        'whatsappNumber(s) is required for WhatsApp channel. ' +
          'Set TWILIO_WHATSAPP_NUMBER / TWILIO_WHATSAPP_NUMBERS or provide ' +
          'whatsappNumber / whatsappNumbers in TACConfig.'
      );
    }
  }

  public get channelType(): ChannelType {
    return 'whatsapp';
  }

  protected isDefaultAgentAddress(authorAddress: string): boolean {
    return this.config.whatsappNumbers.includes(authorAddress);
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
   * Initiate an outbound WhatsApp conversation
   *
   * Creates a conversation via Conversation Orchestrator, adds customer and
   * agent participants, then sends the initial message via the Actions API.
   * Uses `options.from` when provided (must be one of the configured WhatsApp
   * numbers), otherwise falls back to the default `config.whatsappNumber`.
   */
  public async initiateOutboundConversation(
    options: InitiateMessagingConversationOptions
  ): Promise<InitiateConversationResult> {
    const validated = InitiateMessagingConversationOptionsSchema.parse(options);

    this.logger.info(
      { to: maskAddress(validated.to), message_length: validated.message.length },
      'Initiating outbound WhatsApp conversation'
    );

    return this.initiateOutboundMessagingConversation({
      channel: 'WHATSAPP',
      to: validated.to,
      from: this.resolveOutboundFrom(validated.from, {
        allowlist: this.config.whatsappNumbers,
        default: this.config.whatsappNumber,
      }),
      message: validated.message,
      ...(validated.metadata ? { metadata: validated.metadata } : {}),
    });
  }
}
