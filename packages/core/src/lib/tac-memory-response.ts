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
 * Memory API is configured or falling back to Conversation Orchestrator Communications API.
 *
 * Memory configured:
 * - observations, summaries, communications all populated
 * - communications include Memory-specific fields (author id, name, type, profileId)
 *
 * Conversation Orchestrator fallback:
 * - observations and summaries are empty arrays
 * - communications include Conversation Orchestrator-specific fields (conversationId, accountId, etc.)
 */
export class TACMemoryResponse {
  private readonly _data: MemoryRetrievalResponse | Communication[];
  private readonly _communications: TACCommunication[];

  /**
   * Initialize wrapper with either Memory or Conversation Orchestrator data.
   *
   * @param data - Either MemoryRetrievalResponse (Memory) or Communication[] (Conversation Orchestrator)
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
   * @returns List of observations if Memory is configured, empty array for Conversation Orchestrator fallback
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
   * @returns List of summaries if Memory is configured, empty array for Conversation Orchestrator fallback
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
   * all fields from both Memory and Conversation Orchestrator APIs. Fields not available from a particular
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
   *          false if using Conversation Orchestrator fallback (only communications available)
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

  /**
   * Build formatted prompt sections from available memory data.
   *
   * Generates markdown-formatted sections for observations, summaries, and communications
   * that can be injected into LLM prompts. Each section includes a heading and formatted content.
   * Sections with no data are omitted from the result.
   *
   * @returns Array of formatted prompt sections, empty array if no memory data available
   */
  buildMemoryPrompts(): string[] {
    const sections: string[] = [];

    const observationsSection = this.buildObservationsPrompt();
    if (observationsSection) {
      sections.push(observationsSection);
    }

    const summariesSection = this.buildSummariesPrompt();
    if (summariesSection) {
      sections.push(summariesSection);
    }

    const communicationsSection = this.buildCommunicationsPrompt();
    if (communicationsSection) {
      sections.push(communicationsSection);
    }

    return sections;
  }

  private buildObservationsPrompt(): string | null {
    if (this.observations.length === 0) {
      return null;
    }

    const lines = [
      '## Key Observations',
      'Important notes about the customer from previous interactions:',
    ];

    for (const obs of this.observations) {
      lines.push(`- ${obs.content}`);
    }

    return lines.join('\n');
  }

  private buildSummariesPrompt(): string | null {
    if (this.summaries.length === 0) {
      return null;
    }

    const lines = [
      '## Past Conversation Summaries',
      'Summaries of previous conversations with this customer:',
    ];

    for (const summary of this.summaries) {
      lines.push(`- ${summary.content}`);
    }

    return lines.join('\n');
  }

  private buildCommunicationsPrompt(): string | null {
    if (this.communications.length === 0) {
      return null;
    }

    const lines = ['## Recent Message History', 'Recent messages exchanged with this customer:'];

    for (const comm of this.communications) {
      const content = comm.content?.text;
      if (typeof content !== 'string' || content.trim().length === 0) {
        continue;
      }
      // Determine role - defaults to "Assistant" for undefined or non-CUSTOMER authors
      const role = comm.author?.type === 'CUSTOMER' ? 'User' : 'Assistant';
      lines.push(`${role}: ${content}`);
    }

    return lines.length > 2 ? lines.join('\n') : null;
  }
}
