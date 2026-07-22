import { z } from 'zod';
import {
  MemoryRetrievalRequest,
  MemoryRetrievalRequestSchema,
  MemoryRetrievalResponse,
  EMPTY_MEMORY_RESPONSE,
  ObservationInfoSchema,
  SummaryInfoSchema,
  MemoryCommunicationSchema,
  ProfileLookupResponse,
  ProfileLookupResponseSchema,
  ProfileResponse,
  ProfileResponseSchema,
  CreateObservationResponse,
  CreateObservationResponseSchema,
  CreateConversationSummariesResponse,
  CreateConversationSummariesResponseSchema,
} from '../types';
import { TACConfig } from '../lib/config';
import { Logger } from '../lib/logger';
import { BaseClient } from './base';

/**
 * Memory client for interacting with Twilio Memory Service
 */
export class MemoryClient extends BaseClient {
  private readonly storeId: string;

  constructor(config: TACConfig, storeId: string, logger?: Logger) {
    const baseUrl = config.region
      ? `https://memory.${config.region}.twilio.com`
      : 'https://memory.twilio.com';
    super(baseUrl, config, logger);
    this.storeId = storeId;
  }

  /**
   * Get the store ID this client is configured for
   */
  public getStoreId(): string {
    return this.storeId;
  }

  /**
   * Retrieve memories for a specific profile
   *
   * @param profileId - The profile ID to retrieve memories for
   * @param request - Optional request parameters for filtering results
   * @returns Promise containing memory retrieval response
   */
  public async retrieveMemories(
    profileId: string,
    request: Partial<MemoryRetrievalRequest> = {}
  ): Promise<MemoryRetrievalResponse> {
    try {
      const url = `/v1/Stores/${this.storeId}/Profiles/${profileId}/Recall`;

      this.logger.debug(
        {
          memory_store_id: this.storeId,
          profile_id: profileId,
          request,
        },
        'Retrieving memories'
      );

      // Validate and apply defaults through schema
      const validatedRequest = MemoryRetrievalRequestSchema.parse(request);

      // Serialize request to Memory API wire format (camelCase)
      const requestBody = {
        conversationId: validatedRequest.conversationId,
        query: validatedRequest.query,
        beginDate: validatedRequest.beginDate,
        endDate: validatedRequest.endDate,
        observationsLimit: validatedRequest.observationsLimit,
        summariesLimit: validatedRequest.summariesLimit,
        communicationsLimit: validatedRequest.communicationsLimit,
        relevanceThreshold: validatedRequest.relevanceThreshold,
      };

      // Remove undefined values
      const cleanedBody = Object.fromEntries(
        Object.entries(requestBody).filter(([_, value]) => value !== undefined)
      );

      const data = await this.makeRequest<MemoryRetrievalResponse>(url, 'POST', cleanedBody);

      this.logger.debug(
        {
          memory_store_id: this.storeId,
          profile_id: profileId,
        },
        'Raw memory response received'
      );

      if (data === null || typeof data !== 'object') {
        this.logger.warn(
          {
            profile_id: profileId,
            memory_store_id: this.storeId,
          },
          'Invalid memory response format'
        );
        return EMPTY_MEMORY_RESPONSE;
      }

      // Parse each item independently so a single malformed entry (e.g. an
      // unrecognized enum value) doesn't discard the entire response.
      const response = data as Record<string, unknown>;
      const observations = this.parseItems(
        response.observations,
        ObservationInfoSchema,
        'observation',
        profileId
      );
      const summaries = this.parseItems(
        response.summaries,
        SummaryInfoSchema,
        'summary',
        profileId
      );
      const communications = this.parseItems(
        response.communications,
        MemoryCommunicationSchema,
        'communication',
        profileId
      );

      this.logger.debug(
        {
          memory_store_id: this.storeId,
          profile_id: profileId,
          observation_count: observations.length,
          summary_count: summaries.length,
          communication_count: communications.length,
        },
        'Memory retrieval succeeded'
      );

      return { observations, summaries, communications };
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          profile_id: profileId,
          memory_store_id: this.storeId,
        },
        'Memory retrieval error'
      );
      return EMPTY_MEMORY_RESPONSE;
    }
  }

  /** Cap on per-item validation warnings logged per response, to avoid flooding logs. */
  private static readonly MAX_INVALID_ITEM_LOGS = 10;

  /**
   * Validate an array of memory items one at a time, dropping (and logging)
   * any that fail validation while keeping the rest.
   *
   * Per-item warnings are capped at {@link MemoryClient.MAX_INVALID_ITEM_LOGS}
   * and followed by a single summary warning with the total `invalid_count`.
   */
  private parseItems<T>(
    value: unknown,
    schema: z.ZodType<T, unknown>,
    itemType: string,
    profileId: string
  ): T[] {
    if (value === undefined) {
      return [];
    }

    if (!Array.isArray(value)) {
      this.logger.warn(
        {
          profile_id: profileId,
          memory_store_id: this.storeId,
          item_type: itemType,
          received_type: typeof value,
        },
        'Expected an array of memory items but received a non-array value'
      );
      return [];
    }

    const parsed: T[] = [];
    let invalidCount = 0;
    for (const [index, item] of value.entries()) {
      const result = schema.safeParse(item);
      if (result.success) {
        parsed.push(result.data);
        continue;
      }

      invalidCount += 1;
      if (invalidCount <= MemoryClient.MAX_INVALID_ITEM_LOGS) {
        this.logger.warn(
          {
            profile_id: profileId,
            memory_store_id: this.storeId,
            item_type: itemType,
            item_index: index,
            validation_errors: result.error.issues,
          },
          'Dropping invalid memory item'
        );
      }
    }

    if (invalidCount > 0) {
      this.logger.warn(
        {
          profile_id: profileId,
          memory_store_id: this.storeId,
          item_type: itemType,
          invalid_count: invalidCount,
          total_count: value.length,
        },
        'Dropped invalid memory items'
      );
    }

    return parsed;
  }

  /**
   * Find profiles that contain a specific identifier value
   *
   * @param idType - Identifier type (e.g., 'phone', 'email')
   * @param value - Raw value captured for the identifier
   * @returns Promise containing profile lookup response with normalized value and matching profile IDs
   */
  public async lookupProfile(idType: string, value: string): Promise<ProfileLookupResponse> {
    const url = `/v1/Stores/${this.storeId}/Profiles/Lookup`;

    const requestBody = {
      idType,
      value,
    };

    try {
      const data = await this.makeRequest<ProfileLookupResponse>(url, 'POST', requestBody);
      return ProfileLookupResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to lookup profile: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Create a profile via identity resolution (upsert).
   *
   * Conversation Memory runs identity resolution on the submitted traits: if an identifier
   * match is found, the existing canonical profile ID is returned; otherwise a
   * new profile is minted. The body must contain at least one
   * trait-promoted-to-identifier per the store's identity resolution settings,
   * else resolution fails with 400.
   *
   * The write is queued (202 Accepted) — the canonical profile ID is returned
   * synchronously in the response body, but downstream traits may not be fully
   * persisted immediately.
   *
   * @param traits - Trait-group → field → value mapping (e.g. `{"Contact": {"phone": "+13175551234"}}`)
   * @returns Canonical profile ID (`mem_profile_…`)
   * @throws Error if the API request fails or the response is missing an `id` field
   */
  public async createProfile(traits: Record<string, Record<string, unknown>>): Promise<string> {
    const url = `/v1/Stores/${this.storeId}/Profiles`;
    const requestBody = { traits };

    let data: unknown;
    try {
      data = await this.makeRequest<unknown>(url, 'POST', requestBody);
    } catch (error) {
      throw new Error(
        `Failed to create profile: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }

    const profileId =
      data && typeof data === 'object' && 'id' in data ? (data as { id: unknown }).id : undefined;
    if (typeof profileId !== 'string') {
      throw new Error(`CreateProfile response missing 'id' field: ${JSON.stringify(data)}`);
    }
    return profileId;
  }

  /**
   * Fetch profile information with traits
   *
   * @param profileId - The profile ID to fetch
   * @param traitGroups - Optional list of trait group names to include
   * @returns Promise containing profile response with ID, created timestamp, and traits
   */
  public async getProfile(profileId: string, traitGroups?: string[]): Promise<ProfileResponse> {
    const url = `/v1/Stores/${this.storeId}/Profiles/${profileId}`;

    const params: Record<string, string> = {};
    if (traitGroups && traitGroups.length > 0) {
      params.traitGroups = traitGroups.join(',');
    }

    try {
      const data = await this.makeRequest<ProfileResponse>(
        url,
        'GET',
        undefined,
        Object.keys(params).length > 0 ? params : undefined
      );
      return ProfileResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to get profile: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Create an observation for a profile
   *
   * @param profileId - The profile ID to create the observation for
   * @param content - The observation content
   * @param source - Source of the observation (default: 'conversation-intelligence')
   * @param conversationIds - Optional array of conversation IDs associated with this observation
   * @param occurredAt - Optional timestamp when the observation occurred
   * @returns Promise containing the created observation
   */
  public async createObservation(
    profileId: string,
    content: string,
    source: string = 'conversation-intelligence',
    conversationIds?: string[],
    occurredAt?: string
  ): Promise<CreateObservationResponse> {
    const url = `/v1/Stores/${this.storeId}/Profiles/${profileId}/Observations`;

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

    try {
      const data = await this.makeRequest<CreateObservationResponse>(url, 'POST', requestBody);
      return CreateObservationResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to create observation: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Create conversation summaries for a profile
   *
   * @param profileId - The profile ID to create summaries for
   * @param summaries - Array of summary items to create
   * @returns Promise containing a success message for the created conversation summaries
   */
  public async createConversationSummaries(
    profileId: string,
    summaries: Array<{
      content: string;
      conversationId: string;
      occurredAt: string;
      source?: string;
    }>
  ): Promise<CreateConversationSummariesResponse> {
    const url = `/v1/Stores/${this.storeId}/Profiles/${profileId}/ConversationSummaries`;

    const requestBody = {
      summaries: summaries.map(s => ({
        content: s.content,
        conversationId: s.conversationId,
        occurredAt: s.occurredAt,
        source: s.source ?? 'conversation-intelligence',
      })),
    };

    try {
      const data = await this.makeRequest<CreateConversationSummariesResponse>(
        url,
        'POST',
        requestBody
      );
      return CreateConversationSummariesResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to create conversation summaries: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
}
