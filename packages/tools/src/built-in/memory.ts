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
 * @param memoryClient - Memory client instance (must be initialized with storeId)
 * @param profileId - Optional profile ID for memory retrieval
 * @param conversationId - Optional conversation ID for memory retrieval
 * @param options - Optional overrides for tool metadata.
 * @param options.name - Tool name exposed to the LLM. Defaults to `retrieve_profile_memory`.
 * @param options.description - Tool description exposed to the LLM. Defaults to a
 *   generic "retrieve memories" prompt.
 */
export function createMemoryRetrievalTool(
  memoryClient: MemoryClient,
  profileId?: string,
  conversationId?: string,
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
          default: 20,
          description: 'Maximum number of observations to retrieve. Set to 0 to skip observations.',
        },
        summariesLimit: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          default: 5,
          description: 'Maximum number of summaries to retrieve. Set to 0 to skip summaries.',
        },
        communicationsLimit: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          default: 0,
          description:
            'Maximum number of communications to retrieve. Set to 0 to skip communications.',
        },
        relevanceThreshold: {
          type: 'number',
          minimum: 0.0,
          maximum: 1.0,
          default: 0.0,
          description: 'Minimum relevance score threshold for observations and summaries.',
        },
      },
      required: [], // No required parameters
      description: 'Retrieve memories for the current user',
    },
    async (params: MemoryRetrievalParams) => {
      if (!profileId) {
        throw new Error('No profile ID available for memory retrieval');
      }

      const request = Object.fromEntries(
        Object.entries({
          conversationId,
          query: params.query,
          beginDate: params.beginDate,
          endDate: params.endDate,
          observationsLimit: params.observationsLimit,
          summariesLimit: params.summariesLimit,
          communicationsLimit: params.communicationsLimit,
          relevanceThreshold: params.relevanceThreshold,
        }).filter(([_, value]) => value !== undefined)
      ) as Partial<MemoryRetrievalRequest>;

      return memoryClient.retrieveMemories(profileId, request);
    }
  );
}

/**
 * Create factory function for memory tools
 *
 * @param memoryClient - Memory client instance (must be initialized with storeId)
 */
export function createMemoryTools(memoryClient: MemoryClient): {
  forProfile: (
    profileId: string,
    conversationId?: string
  ) => TACTool<MemoryRetrievalParams, MemoryRetrievalResponse>;
  forSession: (
    profileId?: string,
    conversationId?: string
  ) => TACTool<MemoryRetrievalParams, MemoryRetrievalResponse>;
} {
  return {
    forProfile: (profileId: string, conversationId?: string) =>
      createMemoryRetrievalTool(memoryClient, profileId, conversationId),

    forSession: (profileId?: string, conversationId?: string) =>
      createMemoryRetrievalTool(memoryClient, profileId, conversationId),
  };
}
