import {
  ChannelType,
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
 * Configuration for RCS channel
 *
 * Extends MessagingChannelConfig to inherit dedupCapacity.
 */
export interface RCSChannelConfig extends MessagingChannelConfig {
  /** RCS agent address (e.g., 'rcs:my_rcs_agent') */
  agentAddress: string;
}

/**
 * RCS Channel implementation for Twilio Conversations Service
 *
 * Handles RCS conversations through webhook events from Twilio.
 * Automatically retrieves user memory and manages conversation lifecycle.
 *
 * RCS uses agent addresses (e.g., 'rcs:my_agent') which must be configured
 * explicitly via RCSChannelConfig.
 */
export class RCSChannel extends MessagingChannel {
  /** RCS agent address from configuration */
  public readonly agentAddress: string;

  constructor(tac: TAC, config: RCSChannelConfig) {
    super(tac, config);

    if (!config.agentAddress) {
      throw new Error('RCS channel requires agentAddress in config');
    }

    this.agentAddress = config.agentAddress;
  }

  public get channelType(): ChannelType {
    return 'rcs';
  }

  protected isDefaultAgentAddress(authorAddress: string): boolean {
    return authorAddress === this.agentAddress;
  }

  /**
   * Send RCS response using the Conversation Orchestrator Actions API (SEND_MESSAGE).
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

      // Find the CUSTOMER participant by address on the RCS channel
      let customerParticipantId: string | undefined;
      for (const p of participants) {
        if (p.type !== 'CUSTOMER' || !Array.isArray(p.addresses)) continue;
        const rcsAddress = p.addresses.find(
          a => a.channel === 'RCS' && a.address === recipientAddress
        );
        if (rcsAddress) {
          customerParticipantId = p.id;
          break;
        }
      }

      // Use fromAddress from session metadata (set during outbound initiation),
      // falling back to the configured agent address for inbound conversations
      const agentAddress =
        typeof session.metadata?.fromAddress === 'string'
          ? session.metadata.fromAddress
          : this.agentAddress;

      const agentParticipant = await this.ensureAgentParticipant(conversationId, participants, {
        channel: 'RCS',
        address: agentAddress,
      });
      if (!agentParticipant) {
        throw new Error(
          `Failed to resolve AI_AGENT participant for conversation ${conversationId}`
        );
      }

      if (!customerParticipantId) {
        throw new Error(
          `Customer participant not found on RCS channel for conversation ${conversationId}`
        );
      }

      const channelId =
        typeof session.metadata?.channelId === 'string' ? session.metadata.channelId : undefined;

      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_address: maskAddress(recipientAddress),
          recipient_participant_id: customerParticipantId,
          agent_participant_id: agentParticipant.id,
          from_address: maskAddress(agentAddress),
        },
        'Sending RCS via Actions API'
      );

      const actionRequest: SendMessageActionRequest = {
        type: 'SEND_MESSAGE',
        payload: {
          from: {
            channel: 'RCS',
            participantId: agentParticipant.id,
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
        { conversation_id: conversationId, recipient_address: maskAddress(recipientAddress) },
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
  }

  /**
   * Initiate an outbound RCS conversation
   *
   * Creates a conversation via Conversation Orchestrator with inline
   * participants, then sends the initial message via the Actions API.
   * If an active conversation with the same addresses already exists
   * (group-by dedup), CO returns 409 and the existing conversation is reused.
   */
  public async initiateOutboundConversation(
    options: InitiateMessagingConversationOptions
  ): Promise<InitiateConversationResult> {
    const validated = InitiateMessagingConversationOptionsSchema.parse(options);

    this.logger.info(
      { to: maskAddress(validated.to), message_length: validated.message.length },
      'Initiating outbound RCS conversation'
    );

    const fromAddress = validated.from ?? this.agentAddress;

    return this.initiateOutboundMessagingConversation({
      channel: 'RCS',
      to: validated.to,
      from: fromAddress,
      message: validated.message,
      ...(validated.metadata ? { metadata: validated.metadata } : {}),
    });
  }
}
