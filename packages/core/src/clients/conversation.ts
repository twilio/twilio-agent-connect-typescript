import {
  ActionResponse,
  ActionResponseSchema,
  Communication,
  ConversationResponse,
  ConversationResponseSchema,
  ConversationAddress,
  ConversationParticipant,
  ConversationParticipantSchema,
  SendMessageActionRequest,
  ConversationConfiguration,
  ConversationConfigurationSchema,
  ListCommunicationsResponse,
  ListCommunicationsResponseSchema,
  ListParticipantsResponse,
  ListParticipantsResponseSchema,
  ListConversationsResponse,
  ListConversationsResponseSchema,
} from '../types';
import axios from 'axios';
import { TACConfig } from '../lib/config';
import { Logger } from '../lib/logger';
import { BaseClient } from './base';

/**
 * Conversation client for interacting with Twilio Conversations Service
 */
export class ConversationClient extends BaseClient {
  private readonly conversationConfigurationId: string;

  constructor(config: TACConfig, logger?: Logger) {
    const baseUrl = config.region
      ? `https://conversations.${config.region}.twilio.com`
      : 'https://conversations.twilio.com';
    super(baseUrl, config, logger);
    this.conversationConfigurationId = config.conversationConfigurationId;
  }

  /**
   * Create an action on a conversation via the Conversation Orchestrator Actions API.
   *
   * Currently supports SEND_MESSAGE actions. Returns 202 Accepted; the action is
   * processed asynchronously and delivered via COMMUNICATION_CREATED webhook.
   *
   * @param conversationId - The conversation ID
   * @param request - The action request ({type, payload})
   * @returns Promise containing the ActionResponse
   */
  public async createAction(
    conversationId: string,
    request: SendMessageActionRequest
  ): Promise<ActionResponse> {
    const url = `/v2/Conversations/${conversationId}/Actions`;

    try {
      const data = await this.makeRequest<ActionResponse>(url, 'POST', request);
      return ActionResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to create action: ${error instanceof Error ? error.message : String(error)}`,
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
   * Create a new conversation, optionally with inline participants.
   *
   * When participants are provided, CO creates them atomically with the
   * conversation. If an active conversation with the same participant
   * addresses already exists (respecting the configuration's group-by
   * rules), CO returns 409 with a pointer to the existing conversation.
   */
  public async createConversation(options?: {
    name?: string;
    participants?: Array<{
      type: 'CUSTOMER' | 'AI_AGENT' | 'HUMAN_AGENT';
      addresses: ConversationAddress[];
    }>;
  }): Promise<ConversationResponse> {
    const url = `/v2/Conversations`;

    const requestBody: Record<string, unknown> = {
      configurationId: this.conversationConfigurationId,
    };

    if (options?.name) {
      requestBody.name = options.name;
    }

    if (options?.participants) {
      requestBody.participants = options.participants;
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
   * Create a conversation with inline participants, reusing an existing active
   * conversation if CO returns 409 (group-by dedup).
   *
   * On 409 CO returns the existing conversation ID in the
   * X-Conflicting-Resource-Id response header.
   */
  public async createOrReuseConversation(
    participants: Array<{
      type: 'CUSTOMER' | 'AI_AGENT' | 'HUMAN_AGENT';
      addresses: ConversationAddress[];
    }>
  ): Promise<{ conversation: { id: string }; reused: boolean }> {
    try {
      const conversation = await this.createConversation({ participants });
      return { conversation, reused: false };
    } catch (error) {
      const existingId = this.extractConversationIdFrom409(error);
      if (existingId) {
        this.logger.info(
          { conversation_id: existingId },
          'Reusing existing active conversation (409 dedup)'
        );
        return { conversation: { id: existingId }, reused: true };
      }
      throw error;
    }
  }

  /**
   * Extract conversation ID from a 409 response's X-Conflicting-Resource-Id header.
   */
  private extractConversationIdFrom409(error: unknown): string | null {
    // Unwrap: createConversation wraps the axios error in a generic Error
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    if (!axios.isAxiosError(cause) || cause.response?.status !== 409) {
      return null;
    }

    const headers = cause.response.headers as Record<string, string> | undefined;
    const conflictId = headers?.['x-conflicting-resource-id'];
    return typeof conflictId === 'string' && conflictId.length > 0 ? conflictId : null;
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
   * Clear statusCallbacks on a conversation's instance configuration.
   *
   * This stops the conversation from sending webhook events to TAC,
   * which is needed during handoff so the receiving system can take over.
   *
   * @param conversationId - The conversation ID to update
   */
  public async clearStatusCallbacks(conversationId: string): Promise<void> {
    const url = `/v2/Conversations/${conversationId}`;

    try {
      await this.makeRequest<unknown>(url, 'PATCH', {
        configuration: { statusCallbacks: [] },
      });
    } catch (error) {
      throw new Error(
        `Failed to clear status callbacks: ${error instanceof Error ? error.message : String(error)}`,
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
