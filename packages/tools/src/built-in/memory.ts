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
  start_date?: string;
  end_date?: string;
  observation_limit?: number;
  summary_limit?: number;
  session_limit?: number;
}

/**
 * Create memory retrieval tool
 */
export function createMemoryRetrievalTool(
  memoryClient: MemoryClient,
  serviceSid: string,
  profileId?: string
): TACTool<MemoryRetrievalParams, MemoryRetrievalResponse> {
  return defineTool(
    BuiltInTools.RETRIEVE_MEMORY,
    'Retrieve user memories including observations, summaries, and conversation history',
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional semantic search query to filter memories',
        },
        start_date: {
          type: 'string',
          description: 'Optional start date for filtering memories (ISO 8601 format)',
        },
        end_date: {
          type: 'string',
          description: 'Optional end date for filtering memories (ISO 8601 format)',
        },
        observation_limit: {
          type: 'number',
          description: 'Maximum number of observations to retrieve (default: 10)',
        },
        summary_limit: {
          type: 'number',
          description: 'Maximum number of summaries to retrieve (default: 5)',
        },
        session_limit: {
          type: 'number',
          description: 'Maximum number of sessions to retrieve (default: 3)',
        },
      },
      required: [], // No required parameters
      description: 'Retrieve memories for the current user',
    },
    async (params: MemoryRetrievalParams) => {
      if (!profileId) {
        throw new Error('No profile ID available for memory retrieval');
      }

      const request: Partial<MemoryRetrievalRequest> = {
        query: params.query,
        start_date: params.start_date,
        end_date: params.end_date,
        observation_limit: params.observation_limit ?? 10,
        summary_limit: params.summary_limit ?? 5,
        session_limit: params.session_limit ?? 3,
      };

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
