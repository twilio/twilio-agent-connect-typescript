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
 * SMS Channel implementation for Twilio Conversations Service
 *
 * Handles SMS conversations through webhook events from Twilio.
 * Automatically retrieves user memory and manages conversation lifecycle.
 */
export class SMSChannel extends MessagingChannel {
  constructor(tac: TAC, config?: MessagingChannelConfig) {
    super(tac, config);
    if (this.config.phoneNumbers.length === 0) {
      throw new Error(
        'phoneNumber(s) is required for SMS channel. ' +
          'Set TWILIO_PHONE_NUMBER / TWILIO_PHONE_NUMBERS or provide ' +
          'phoneNumber / phoneNumbers in TACConfig.'
      );
    }
  }

  public get channelType(): ChannelType {
    return 'sms';
  }

  protected isDefaultAgentAddress(authorAddress: string): boolean {
    return this.config.phoneNumbers.includes(authorAddress);
  }

  protected getAgentAddress(_conversationId: ConversationId): ConversationAddress {
    if (!this.config.phoneNumber) {
      throw new Error('phoneNumber is required for SMS channel.');
    }
    return { channel: 'SMS', address: this.config.phoneNumber };
  }

  /**
   * Initiate an outbound SMS conversation
   *
   * Creates a conversation via Conversation Orchestrator, adds customer and
   * agent participants, then sends the initial message via the Actions API.
   * Uses `options.from` when provided (must be one of the configured phone
   * numbers), otherwise falls back to the default `config.phoneNumber`.
   */
  public async initiateOutboundConversation(
    options: InitiateMessagingConversationOptions
  ): Promise<InitiateConversationResult> {
    const validated = InitiateMessagingConversationOptionsSchema.parse(options);

    this.logger.info(
      { to: maskAddress(validated.to), message_length: validated.message.length },
      'Initiating outbound SMS conversation'
    );

    return this.initiateOutboundMessagingConversation({
      channel: 'SMS',
      to: validated.to,
      from: this.resolveOutboundFrom(validated.from, {
        allowlist: this.config.phoneNumbers,
        default: this.config.phoneNumber,
      }),
      message: validated.message,
      ...(validated.metadata ? { metadata: validated.metadata } : {}),
    });
  }
}
