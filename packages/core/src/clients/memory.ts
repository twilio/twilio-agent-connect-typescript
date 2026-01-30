import {
  MemoryRetrievalRequest,
  MemoryRetrievalResponse,
  MemoryRetrievalResponseSchema,
  EMPTY_MEMORY_RESPONSE,
  ProfileLookupResponse,
  ProfileLookupResponseSchema,
  ProfileResponse,
  ProfileResponseSchema,
  CreateObservationResponse,
  CreateObservationResponseSchema,
  CreateConversationSummariesResponse,
  CreateConversationSummariesResponseSchema,
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
 * Memory client for interacting with Twilio Memory Service
 *
 * Provides functionality to retrieve user memories including observations,
 * summaries, and conversation sessions.
 */
export class MemoryClient {
  private readonly baseUrl: string;
  private readonly credentials: { username: string; password: string };
  private readonly logger: Logger;

  constructor(config: TACConfig, logger?: Logger) {
    this.baseUrl = config.memoryApiUrl;

    // Use Memory API credentials (api_key/api_token), not Twilio account credentials
    if (!config.memoryApiKey || !config.memoryApiToken) {
      throw new Error(
        'Memory API credentials are required. ' +
          'Please set MEMORY_API_KEY and MEMORY_API_TOKEN environment variables.'
      );
    }

    this.credentials = {
      username: config.memoryApiKey,
      password: config.memoryApiToken,
    };
    const baseLogger = logger || createLogger({ name: 'tac-memory' });
    this.logger = baseLogger.child({ client: 'memory' });
  }

  /**
   * Retrieve memories for a specific profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to retrieve memories for
   * @param request - Optional request parameters for filtering results
   * @returns Promise containing memory retrieval response
   */
  public async retrieveMemories(
    serviceSid: string,
    profileId: string,
    request: Partial<MemoryRetrievalRequest> = {}
  ): Promise<MemoryRetrievalResponse> {
    try {
      const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/Recall`;

      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId,
          request,
        },
        'Retrieving memories'
      );

      const requestBody = {
        query: request.query,
        start_date: request.start_date,
        end_date: request.end_date,
        observation_limit: request.observation_limit ?? 10,
        summary_limit: request.summary_limit ?? 5,
        session_limit: request.session_limit ?? 3,
      };

      // Remove undefined values
      const cleanedBody = Object.fromEntries(
        Object.entries(requestBody).filter(([_, value]) => value !== undefined)
      );

      const options: RequestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getBasicAuthHeader(),
        },
        body: JSON.stringify(cleanedBody),
      };

      this.logRequest(options.method, url, options.body);
      const response = await fetch(url, options);
      await this.logResponse(response);

      if (!response.ok) {
        this.logger.warn(
          {
            http_status: response.status,
            status_text: response.statusText,
            profile_id: profileId,
            memory_store_id: serviceSid,
          },
          'Memory retrieval failed'
        );
        return EMPTY_MEMORY_RESPONSE;
      }

      const data = await response.json();

      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId,
        },
        'Raw memory response received'
      );

      // Validate and parse the response
      const validatedResponse = MemoryRetrievalResponseSchema.safeParse(data);

      if (!validatedResponse.success) {
        this.logger.warn(
          {
            profile_id: profileId,
            memory_store_id: serviceSid,
            validation_errors: validatedResponse.error.errors,
          },
          'Invalid memory response format'
        );
        return EMPTY_MEMORY_RESPONSE;
      }

      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId,
          observation_count: validatedResponse.data.observations.length,
          summary_count: validatedResponse.data.summaries.length,
        },
        'Memory retrieval succeeded'
      );

      return validatedResponse.data;
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          profile_id: profileId,
          memory_store_id: serviceSid,
        },
        'Memory retrieval error'
      );
      return EMPTY_MEMORY_RESPONSE;
    }
  }

  /**
   * Find profiles that contain a specific identifier value
   *
   * @param serviceSid - The memory service SID
   * @param idType - Identifier type (e.g., 'phone', 'email')
   * @param value - Raw value captured for the identifier
   * @returns Promise containing profile lookup response with normalized value and matching profile IDs
   */
  public async lookupProfile(
    serviceSid: string,
    idType: string,
    value: string
  ): Promise<ProfileLookupResponse> {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/Lookup`;

    const requestBody = {
      idType,
      value,
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
      throw new Error(`Failed to lookup profile: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return ProfileLookupResponseSchema.parse(data);
  }

  /**
   * Fetch profile information with traits
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to fetch
   * @param traitGroups - Optional list of trait group names to include
   * @returns Promise containing profile response with ID, created timestamp, and traits
   */
  public async getProfile(
    serviceSid: string,
    profileId: string,
    traitGroups?: string[]
  ): Promise<ProfileResponse> {
    let url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}`;

    if (traitGroups && traitGroups.length > 0) {
      url += `?traitGroups=${traitGroups.join(',')}`;
    }

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
      throw new Error(`Failed to get profile: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return ProfileResponseSchema.parse(data);
  }

  /**
   * Create an observation for a profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to create the observation for
   * @param content - The observation content
   * @param source - Source of the observation (default: 'conversation-intelligence')
   * @param conversationIds - Optional array of conversation IDs associated with this observation
   * @param occurredAt - Optional timestamp when the observation occurred
   * @returns Promise containing the created observation
   */
  public async createObservation(
    serviceSid: string,
    profileId: string,
    content: string,
    source: string = 'conversation-intelligence',
    conversationIds?: string[],
    occurredAt?: string
  ): Promise<CreateObservationResponse> {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/Observations`;

    const requestBody: Record<string, unknown> = {
      content,
      source,
    };

    if (conversationIds && conversationIds.length > 0) {
      requestBody.conversationIds = conversationIds;
    }

    if (occurredAt) {
      requestBody.occurredAt = occurredAt;
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
      throw new Error(`Failed to create observation: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return CreateObservationResponseSchema.parse(data);
  }

  /**
   * Create conversation summaries for a profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to create summaries for
   * @param summaries - Array of summary items to create
   * @returns Promise containing a success message for the created conversation summaries
   */
  public async createConversationSummaries(
    serviceSid: string,
    profileId: string,
    summaries: Array<{
      content: string;
      conversationId: string;
      occurredAt: string;
      source?: string;
    }>
  ): Promise<CreateConversationSummariesResponse> {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/ConversationSummaries`;

    const requestBody = {
      summaries: summaries.map(s => ({
        content: s.content,
        conversationId: s.conversationId,
        occurredAt: s.occurredAt,
        source: s.source ?? 'conversation-intelligence',
      })),
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
      throw new Error(
        `Failed to create conversation summaries: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    return CreateConversationSummariesResponseSchema.parse(data);
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
      'Memory HTTP request'
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
