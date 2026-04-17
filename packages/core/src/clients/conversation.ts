import {
  Communication,
  ConversationResponse,
  ConversationResponseSchema,
  ConversationAddress,
  ConversationParticipant,
  ConversationParticipantSchema,
  SendCommunicationRequest,
  SendCommunicationResponse,
  SendCommunicationResponseSchema,
  ConversationConfiguration,
  ConversationConfigurationSchema,
  ListCommunicationsResponse,
  ListCommunicationsResponseSchema,
  ListParticipantsResponse,
  ListParticipantsResponseSchema,
  ListConversationsResponse,
  ListConversationsResponseSchema,
} from '../types';
import { TACConfig } from '../lib/config';
import { Logger } from '../lib/logger';
import { BaseClient } from './base';

/**
 * Conversation client for interacting with Twilio Conversations Service
 */
export class ConversationClient extends BaseClient {
  private readonly conversationServiceId: string;

  constructor(config: TACConfig, logger?: Logger) {
    super('https://conversations.twilio.com', config, logger);
    this.conversationServiceId = config.conversationServiceId;
  }

  /**
   * Send a communication using the Conversation Orchestrator Send API
   *
   * @param conversationId - The conversation ID
   * @param request - Send communication request
   * @returns Promise containing communication response
   */
  public async sendCommunication(
    conversationId: string,
    request: SendCommunicationRequest
  ): Promise<SendCommunicationResponse> {
    const url = `/v2/Communications`;

    const requestBody = {
      conversationId,
      ...request,
    };

    try {
      const data = await this.makeRequest<SendCommunicationResponse>(url, 'POST', requestBody);
      return SendCommunicationResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to send communication: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * List communications for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of communications
   */
  public async listCommunications(conversationId: string): Promise<Communication[]> {
    const url = `/v2/Conversations/${conversationId}/Communications`;

    try {
      const data = await this.makeRequest<ListCommunicationsResponse>(url, 'GET');
      const validated = ListCommunicationsResponseSchema.parse(data);
      return validated.communications;
    } catch (error) {
      throw new Error(
        `Failed to list communications: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Create a new conversation
   *
   * @param name - Optional conversation name
   * @returns Promise containing conversation response
   */
  public async createConversation(name?: string): Promise<ConversationResponse> {
    const url = `/v2/Conversations`;

    const requestBody: Record<string, string> = {
      configurationId: this.conversationServiceId,
    };

    if (name) {
      requestBody.name = name;
    }

    try {
      const data = await this.makeRequest<ConversationResponse>(url, 'POST', requestBody);
      return ConversationResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Add a participant to a conversation
   *
   * @param conversationId - The conversation ID
   * @param addresses - Array of participant addresses
   * @param participantType - Type of participant (CUSTOMER, AI_AGENT, HUMAN_AGENT)
   * @returns Promise containing participant response
   */
  public async addParticipant(
    conversationId: string,
    addresses: ConversationAddress[],
    participantType: 'CUSTOMER' | 'AI_AGENT' | 'HUMAN_AGENT'
  ): Promise<ConversationParticipant> {
    const url = `/v2/Conversations/${conversationId}/Participants`;

    const requestBody = {
      type: participantType,
      addresses,
    };

    try {
      const data = await this.makeRequest<ConversationParticipant>(url, 'POST', requestBody);
      return ConversationParticipantSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to add participant: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * List participants in a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of participants
   */
  public async listParticipants(conversationId: string): Promise<ConversationParticipant[]> {
    const url = `/v2/Conversations/${conversationId}/Participants`;

    try {
      const data = await this.makeRequest<ListParticipantsResponse>(url, 'GET');
      const validated = ListParticipantsResponseSchema.parse(data);
      return validated.participants;
    } catch (error) {
      throw new Error(
        `Failed to list participants: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * List conversations with optional filters
   *
   * @param filters - Optional filters (channelId, status)
   * @returns Promise containing array of conversations
   */
  public async listConversations(filters?: {
    channelId?: string;
    status?: string[];
  }): Promise<ConversationResponse[]> {
    const url = `/v2/Conversations`;

    const params: Record<string, string> = {};
    if (filters?.channelId) {
      params.channelId = filters.channelId;
    }
    if (filters?.status && filters.status.length > 0) {
      params.status = filters.status.join(',');
    }

    try {
      const data = await this.makeRequest<ListConversationsResponse>(
        url,
        'GET',
        undefined,
        Object.keys(params).length > 0 ? params : undefined
      );
      const validated = ListConversationsResponseSchema.parse(data);
      return validated.conversations;
    } catch (error) {
      throw new Error(
        `Failed to list conversations: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Update conversation status
   *
   * @param conversationId - The conversation ID
   * @param status - New status (ACTIVE, INACTIVE, CLOSED)
   * @returns Promise containing updated conversation
   */
  public async updateConversation(
    conversationId: string,
    status: 'ACTIVE' | 'INACTIVE' | 'CLOSED'
  ): Promise<ConversationResponse> {
    const url = `/v2/Conversations/${conversationId}`;

    const requestBody = { status };

    try {
      const data = await this.makeRequest<ConversationResponse>(url, 'PUT', requestBody);
      return ConversationResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to update conversation: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Retrieve the details for a single configuration
   *
   * @param configurationId - The configuration ID to retrieve
   * @returns Promise containing configuration details
   */
  public async getConfiguration(configurationId: string): Promise<ConversationConfiguration> {
    const url = `/v2/ControlPlane/Configurations/${configurationId}`;

    try {
      const data = await this.makeRequest<ConversationConfiguration>(url, 'GET');
      return ConversationConfigurationSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to get configuration: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
}
