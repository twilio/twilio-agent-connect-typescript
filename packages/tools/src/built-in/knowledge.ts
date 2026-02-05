import { KnowledgeClient, KnowledgeChunkResult } from '@twilio/tac-core';
import { TACTool, defineTool } from '../lib/builder';

/**
 * Parameters for knowledge search tool (visible to LLM)
 */
interface KnowledgeSearchParams {
  query: string;
}

/**
 * Configuration for knowledge search tool
 */
interface KnowledgeToolConfig {
  name?: string;
  description?: string;
  topK?: number;
}

/**
 * Create knowledge search tool with explicit name and description
 *
 * @param knowledgeClient - The Knowledge client instance
 * @param knowledgeBaseId - The knowledge base ID to search
 * @param config - Configuration with required name and description
 * @returns TACTool configured for knowledge search
 */
export function createKnowledgeSearchTool(
  knowledgeClient: KnowledgeClient,
  knowledgeBaseId: string,
  config: { name: string; description: string; topK?: number }
): TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]> {
  const topK = config.topK ?? 5;

  return defineTool(
    config.name,
    config.description,
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant knowledge',
        },
      },
      required: ['query'],
      description: config.description,
    },
    async (params: KnowledgeSearchParams) => {
      return knowledgeClient.searchKnowledgeBase(knowledgeBaseId, params.query, topK);
    }
  );
}

/**
 * Create knowledge search tool with auto-fetched metadata from knowledge base
 *
 * This async version fetches the knowledge base metadata to auto-generate
 * the tool name and description if not provided.
 *
 * @param knowledgeClient - The Knowledge client instance
 * @param knowledgeBaseId - The knowledge base ID to search
 * @param config - Optional configuration (name/description auto-generated if not provided)
 * @returns Promise containing TACTool configured for knowledge search
 */
export async function createKnowledgeSearchToolAsync(
  knowledgeClient: KnowledgeClient,
  knowledgeBaseId: string,
  config?: KnowledgeToolConfig
): Promise<TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>> {
  let name = config?.name;
  let description = config?.description;

  // Fetch knowledge base metadata if name or description not provided
  if (!name || !description) {
    const kb = await knowledgeClient.getKnowledgeBase(knowledgeBaseId);
    if (!name) {
      // Generate tool name from display name (normalized snake_case)
      const normalized = kb.displayName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

      name = normalized ? `search_${normalized}` : 'search_knowledge_base';
    }
    if (!description) {
      description = kb.description || `Search the ${kb.displayName} knowledge base`;
    }
  }

  const toolConfig: { name: string; description: string; topK?: number } = {
    name,
    description,
  };
  if (config?.topK !== undefined) {
    toolConfig.topK = config.topK;
  }
  return createKnowledgeSearchTool(knowledgeClient, knowledgeBaseId, toolConfig);
}

/**
 * Create factory for knowledge tools
 *
 * @param knowledgeClient - The Knowledge client instance
 * @returns Factory object with methods to create knowledge tools
 */
export function createKnowledgeTools(knowledgeClient: KnowledgeClient): {
  forKnowledgeBase: (
    knowledgeBaseId: string,
    config: { name: string; description: string; topK?: number }
  ) => TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>;
  forKnowledgeBaseAsync: (
    knowledgeBaseId: string,
    config?: KnowledgeToolConfig
  ) => Promise<TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>>;
} {
  return {
    /**
     * Create knowledge search tool with explicit config
     */
    forKnowledgeBase: (
      knowledgeBaseId: string,
      config: { name: string; description: string; topK?: number }
    ) => createKnowledgeSearchTool(knowledgeClient, knowledgeBaseId, config),

    /**
     * Create knowledge search tool with auto-fetched metadata
     */
    forKnowledgeBaseAsync: (knowledgeBaseId: string, config?: KnowledgeToolConfig) =>
      createKnowledgeSearchToolAsync(knowledgeClient, knowledgeBaseId, config),
  };
}
