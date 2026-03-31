import {
  Communication,
  CommunicationSchema,
  ConversationResponse,
  ConversationResponseSchema,
  ConversationAddress,
  ConversationParticipant,
  ConversationParticipantSchema,
  SendCommunicationRequest,
  SendCommunicationResponse,
  SendCommunicationResponseSchema,
} from '../types/index';
import { TACConfig } from '../lib/config';
import { Logger, createLogger } from '../lib/logger';

/**
 * HTTP client options
 */
interface RequestOptions {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Conversation client for interacting with Twilio Conversations Service
 *
 * Provides functionality to create conversations, add participants,
 * and manage conversation lifecycle.
 */
export class ConversationClient {
  private readonly baseUrl: string;
  private readonly credentials: { username: string; password: string };
  private readonly conversationServiceId: string;
  private readonly logger: Logger;

  constructor(config: TACConfig, logger?: Logger) {
    this.baseUrl = config.conversationsApiUrl;
    this.credentials = {
      username: config.twilioApiKey,
      password: config.twilioApiToken,
    };
    this.conversationServiceId = config.conversationServiceId;
    const baseLogger = logger || createLogger({ name: 'tac-conversations' });
    this.logger = baseLogger.child({ client: 'conversations' });
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
    const url = `${this.baseUrl}/v2/Communications`;

    const requestBody = {
      conversationId,
      ...request,
    };

    const options: RequestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getBasicAuthHeader(),
      },
      body: JSON.stringify(requestBody),
    };

    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);

    if (!response.ok) {
      const errorBody = await response.clone().text();
      this.logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          errorBody,
          requestBody: options.body,
        },
        'Send communication failed'
      );
      throw new Error(`Failed to send communication: ${response.status} ${response.statusText}`);
    }

    // Log if we get an unexpected 2xx status (expected 202 Accepted)
    if (response.status !== 202) {
      this.logger.warn(
        { status: response.status, expected: 202 },
        'Send API returned unexpected success status (expected 202 Accepted)'
      );
    }

    const data = await response.json();
    return SendCommunicationResponseSchema.parse(data);
  }

  /**
   * List communications for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of communications
   */
  public async listCommunications(conversationId: string): Promise<Communication[]> {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Communications`;

    const options: RequestOptions = {
      method: 'GET',
      headers: {
        Authorization: this.getBasicAuthHeader(),
      },
    };

    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);

    if (!response.ok) {
      throw new Error(`Failed to list communications: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();

    // API returns { communications: [...] }
    if (
      typeof data === 'object' &&
      data !== null &&
      'communications' in data &&
      Array.isArray((data as { communications: unknown }).communications)
    ) {
      return (data as { communications: unknown[] }).communications.map((comm: unknown) =>
        CommunicationSchema.parse(comm)
      );
    }

    return [];
  }

  /**
   * Create a new conversation
   *
   * @param name - Optional conversation name
   * @returns Promise containing conversation response
   */
  public async createConversation(name?: string): Promise<ConversationResponse> {
    const url = `${this.baseUrl}/v2/Conversations`;

    const requestBody: Record<string, string> = {
      configurationId: this.conversationServiceId,
    };

    if (name) {
      requestBody.name = name;
    }

    const options: RequestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getBasicAuthHeader(),
      },
      body: JSON.stringify(requestBody),
    };

    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);

    if (!response.ok) {
      throw new Error(`Failed to create conversation: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return ConversationResponseSchema.parse(data);
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
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Participants`;

    const requestBody = {
      type: participantType,
      addresses,
    };

    const options: RequestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getBasicAuthHeader(),
      },
      body: JSON.stringify(requestBody),
    };

    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);

    if (!response.ok) {
      throw new Error(`Failed to add participant: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return ConversationParticipantSchema.parse(data);
  }

  /**
   * List participants in a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of participants
   */
  public async listParticipants(conversationId: string): Promise<ConversationParticipant[]> {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Participants`;

    const options: RequestOptions = {
      method: 'GET',
      headers: {
        Authorization: this.getBasicAuthHeader(),
      },
    };

    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);

    if (!response.ok) {
      throw new Error(`Failed to list participants: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();

    if (
      typeof data === 'object' &&
      data !== null &&
      'participants' in data &&
      Array.isArray((data as { participants: unknown }).participants)
    ) {
      return (data as { participants: unknown[] }).participants.map((participant: unknown) =>
        ConversationParticipantSchema.parse(participant)
      );
    }

    return [];
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
    const urlObj = new URL(`${this.baseUrl}/v2/Conversations`);

    if (filters?.channelId) {
      urlObj.searchParams.set('channelId', filters.channelId);
    }
    if (filters?.status && filters.status.length > 0) {
      urlObj.searchParams.set('status', filters.status.join(','));
    }

    const options: RequestOptions = {
      method: 'GET',
      headers: {
        Authorization: this.getBasicAuthHeader(),
      },
    };

    this.logRequest(options.method, urlObj.toString());
    const response = await fetch(urlObj.toString(), options);
    await this.logResponse(response);

    if (!response.ok) {
      throw new Error(`Failed to list conversations: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();

    if (
      typeof data === 'object' &&
      data !== null &&
      'conversations' in data &&
      Array.isArray((data as { conversations: unknown }).conversations)
    ) {
      return (data as { conversations: unknown[] }).conversations.map((c: unknown) =>
        ConversationResponseSchema.parse(c)
      );
    }

    return [];
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
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}`;

    const requestBody = { status };

    const options: RequestOptions = {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getBasicAuthHeader(),
      },
      body: JSON.stringify(requestBody),
    };

    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);

    if (!response.ok) {
      throw new Error(`Failed to update conversation: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return ConversationResponseSchema.parse(data);
  }

  /**
   * Get Basic Auth header for HTTP requests
   */
  private getBasicAuthHeader(): string {
    const credentials = `${this.credentials.username}:${this.credentials.password}`;
    const encoded = Buffer.from(credentials).toString('base64');
    return `Basic ${encoded}`;
  }

  /**
   * Log HTTP request details
   */
  private logRequest(method: string, url: string, body?: string): void {
    this.logger.debug(
      {
        http_method: method,
        http_url: url,
        http_body: body ? JSON.parse(body) : undefined,
      },
      'Conversations Service HTTP request'
    );
  }

  /**
   * Log HTTP response details
   */
  private async logResponse(response: Response): Promise<void> {
    const bodyText = await response.clone().text();
    let bodyJson: unknown;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      bodyJson = bodyText;
    }

    this.logger.debug(
      {
        http_status: response.status,
        http_status_text: response.statusText,
        http_body: bodyJson,
      },
      'HTTP response'
    );
  }
}
