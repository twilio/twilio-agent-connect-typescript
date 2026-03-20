import { Communication } from '../types/conversation';
import { MemoryCommunication } from '../types/memory';
import { MemoryRetrievalResponse, ObservationInfo, SummaryInfo } from '../types/memory';
import { TACCommunication, TACCommunicationSchema } from '../types/tac';

/**
 * Type guard to check if data is MemoryRetrievalResponse.
 */
function isMemoryRetrievalResponse(
  data: MemoryRetrievalResponse | Communication[]
): data is MemoryRetrievalResponse {
  return !Array.isArray(data);
}

/**
 * Normalize a Memory API communication (snake_case) to the unified camelCase format
 * expected by TACCommunicationSchema.
 */
function normalizeMemoryCommunication(comm: MemoryCommunication): Record<string, unknown> {
  return {
    ...comm,
    channelId: comm.channel_id,
    createdAt: comm.created_at,
    updatedAt: comm.updated_at,
    author: {
      ...comm.author,
      profileId: comm.author.profile_id,
      deliveryStatus: comm.author.delivery_status,
    },
    recipients: comm.recipients.map(r => ({
      ...r,
      profileId: r.profile_id,
      deliveryStatus: r.delivery_status,
    })),
  };
}

/**
 * Unified response wrapper for TAC.retrieveMemory().
 *
 * Provides a consistent interface for accessing memory data regardless of whether
 * Memory API is configured or falling back to Maestro Communications API.
 *
 * Memory configured:
 * - observations, summaries, communications all populated
 * - communications include Memory-specific fields (author id, name, type, profileId)
 *
 * Maestro fallback:
 * - observations and summaries are empty arrays
 * - communications include Maestro-specific fields (conversationId, accountId, etc.)
 */
export class TACMemoryResponse {
  private readonly _data: MemoryRetrievalResponse | Communication[];
  private readonly _communications: TACCommunication[];

  /**
   * Initialize wrapper with either Memory or Maestro data.
   *
   * @param data - Either MemoryRetrievalResponse (Memory) or Communication[] (Maestro)
   */
  constructor(data: MemoryRetrievalResponse | Communication[]) {
    this._data = data;

    // Parse communications through Zod schema to create proper TACCommunication objects.
    // Memory API returns snake_case fields; normalize to camelCase before parsing.
    if (isMemoryRetrievalResponse(data)) {
      this._communications = (data.communications ?? []).map(comm =>
        TACCommunicationSchema.parse(normalizeMemoryCommunication(comm))
      );
    } else {
      this._communications = data.map(comm => TACCommunicationSchema.parse(comm));
    }
  }

  /**
   * Get observation memories.
   *
   * @returns List of observations if Memory is configured, empty array for Maestro fallback
   */
  get observations(): ObservationInfo[] {
    if (isMemoryRetrievalResponse(this._data)) {
      return this._data.observations;
    }
    return [];
  }

  /**
   * Get summary memories.
   *
   * @returns List of summaries if Memory is configured, empty array for Maestro fallback
   */
  get summaries(): SummaryInfo[] {
    if (isMemoryRetrievalResponse(this._data)) {
      return this._data.summaries;
    }
    return [];
  }

  /**
   * Get communications in unified format with all available fields.
   *
   * Communications are converted to a common format during initialization that includes
   * all fields from both Memory and Maestro APIs. Fields not available from a particular
   * API will be undefined.
   *
   * @returns List of unified communications with all available fields
   */
  get communications(): TACCommunication[] {
    return this._communications;
  }

  /**
   * Check if Memory API is configured and providing full features.
   *
   * @returns true if Memory is configured (observations/summaries available),
   *          false if using Maestro fallback (only communications available)
   */
  get hasMemoryFeatures(): boolean {
    return isMemoryRetrievalResponse(this._data);
  }

  /**
   * Access raw underlying data for advanced use cases.
   *
   * Use this when you need access to all fields from the original API responses,
   * not just the unified common fields.
   *
   * @returns Either MemoryRetrievalResponse or Communication[] depending on configuration
   */
  get rawData(): MemoryRetrievalResponse | Communication[] {
    return this._data;
  }
}
