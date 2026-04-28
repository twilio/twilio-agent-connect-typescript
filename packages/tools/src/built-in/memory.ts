import {
  MemoryRetrievalRequest,
  MemoryRetrievalResponse,
  BuiltInTools,
  MemoryClient,
} from '@twilio/tac-core';
import { TACTool, defineTool } from '../lib/builder';

/**
 * Parameters for memory retrieval tool
 */
interface MemoryRetrievalParams {
  query?: string;
  beginDate?: string;
  endDate?: string;
  observationsLimit?: number;
  summariesLimit?: number;
  communicationsLimit?: number;
  relevanceThreshold?: number;
}

/**
 * Create memory retrieval tool.
 *
 * @param options - Optional overrides for tool metadata.
 * @param options.name - Tool name exposed to the LLM. Defaults to `retrieve_profile_memory`.
 * @param options.description - Tool description exposed to the LLM. Defaults to a
 *   generic "retrieve memories" prompt.
 */
export function createMemoryRetrievalTool(
  memoryClient: MemoryClient,
  serviceSid: string,
  profileId?: string,
  options: { name?: string; description?: string } = {}
): TACTool<MemoryRetrievalParams, MemoryRetrievalResponse> {
  return defineTool(
    options.name ?? BuiltInTools.RETRIEVE_MEMORY,
    options.description ??
      'Retrieve user memories including observations, summaries, and conversation history',
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional semantic search query to filter memories',
        },
        beginDate: {
          type: 'string',
          description: 'Optional start date for filtering memories (ISO 8601 format)',
        },
        endDate: {
          type: 'string',
          description: 'Optional end date for filtering memories (ISO 8601 format)',
        },
        observationsLimit: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: 'Maximum number of observations to retrieve (0-100, default: 20)',
        },
        summariesLimit: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: 'Maximum number of summaries to retrieve (0-100, default: 5)',
        },
        communicationsLimit: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: 'Maximum number of communications to retrieve (0-100, default: 0)',
        },
        relevanceThreshold: {
          type: 'number',
          minimum: 0.0,
          maximum: 1.0,
          description:
            'Minimum relevance score threshold for observations and summaries (0.0-1.0, default: 0.0)',
        },
      },
      required: [], // No required parameters
      description: 'Retrieve memories for the current user',
    },
    async (params: MemoryRetrievalParams) => {
      if (!profileId) {
        throw new Error('No profile ID available for memory retrieval');
      }

      // Filter out undefined values to satisfy exactOptionalPropertyTypes
      const request = Object.fromEntries(
        Object.entries({
          query: params.query,
          beginDate: params.beginDate,
          endDate: params.endDate,
          observationsLimit: params.observationsLimit,
          summariesLimit: params.summariesLimit,
          communicationsLimit: params.communicationsLimit,
          relevanceThreshold: params.relevanceThreshold,
        }).filter(([_, value]) => value !== undefined)
      ) as Partial<MemoryRetrievalRequest>;

      return memoryClient.retrieveMemories(serviceSid, profileId, request);
    }
  );
}

/**
 * Create factory function for memory tools
 */
export function createMemoryTools(
  memoryClient: MemoryClient,
  serviceSid: string
): {
  forProfile: (profileId: string) => TACTool<MemoryRetrievalParams, MemoryRetrievalResponse>;
  forSession: (profileId?: string) => TACTool<MemoryRetrievalParams, MemoryRetrievalResponse>;
} {
  return {
    /**
     * Create memory tool for specific profile
     */
    forProfile: (profileId: string) =>
      createMemoryRetrievalTool(memoryClient, serviceSid, profileId),

    /**
     * Create memory tool for current session
     */
    forSession: (profileId?: string) =>
      createMemoryRetrievalTool(memoryClient, serviceSid, profileId),
  };
}
