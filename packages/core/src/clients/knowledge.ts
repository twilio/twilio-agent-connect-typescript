import {
  KnowledgeBase,
  KnowledgeBaseSchema,
  KnowledgeChunkResult,
  KnowledgeSearchResponse,
  KnowledgeSearchResponseSchema,
} from '../types';
import { TACConfig } from '../lib/config';
import { Logger } from '../lib/logger';
import { BaseClient } from './base';

/**
 * Knowledge client for interacting with Twilio Knowledge Service
 */
export class KnowledgeClient extends BaseClient {
  constructor(config: TACConfig, logger?: Logger) {
    super('https://knowledge.twilio.com', config, logger);
  }

  /**
   * Get knowledge base metadata
   *
   * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
   * @returns Promise containing knowledge base metadata
   */
  public async getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBase> {
    const url = `/v2/ControlPlane/KnowledgeBases/${knowledgeBaseId}`;

    try {
      const data = await this.makeRequest<KnowledgeBase>(url, 'GET');
      return KnowledgeBaseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to get knowledge base: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Search knowledge base for relevant content
   *
   * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
   * @param query - Search query (max 2048 characters)
   * @param topK - Maximum number of results to return (default: 5, max: 20)
   * @param knowledgeIds - Optional list of knowledge IDs to filter results
   * @returns Promise containing array of search result chunks
   */
  public async searchKnowledgeBase(
    knowledgeBaseId: string,
    query: string,
    topK: number = 5,
    knowledgeIds?: string[]
  ): Promise<KnowledgeChunkResult[]> {
    const url = `/v2/KnowledgeBases/${knowledgeBaseId}/Search`;

    const requestBody: Record<string, unknown> = {
      query,
      top: Math.min(Math.max(topK, 1), 20), // Clamp to 1-20
    };

    if (knowledgeIds && knowledgeIds.length > 0) {
      requestBody.knowledgeIds = knowledgeIds;
    }

    try {
      const data = await this.makeRequest<KnowledgeSearchResponse>(url, 'POST', requestBody);
      const validated = KnowledgeSearchResponseSchema.parse(data);
      return validated.chunks;
    } catch (error) {
      throw new Error(
        `Failed to search knowledge base: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
}
