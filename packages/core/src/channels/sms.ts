import {
  ChannelType,
  ConversationAddress,
  ConversationId,
  InitiateMessagingConversationOptions,
  InitiateMessagingConversationOptionsSchema,
  InitiateConversationResult,
} from '../types/index';
import { MessagingChannel } from './messaging';
import { maskAddress } from '../util/log-redaction';

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

  protected isDefaultAgentAddress(authorAddress: string): boolean {
    return this.config.phoneNumbers.includes(authorAddress);
  }

  protected getAgentAddress(_conversationId: ConversationId): ConversationAddress {
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
