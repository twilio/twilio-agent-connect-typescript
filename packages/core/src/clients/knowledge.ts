import {
  KnowledgeBase,
  KnowledgeBaseSchema,
  KnowledgeChunkResult,
  KnowledgeSearchResponseSchema,
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
 * Knowledge client for interacting with Twilio Knowledge Service
 *
 * Provides functionality to retrieve knowledge base metadata and search
 * knowledge bases for relevant content.
 */
export class KnowledgeClient {
  private readonly baseUrl: string;
  private readonly credentials: { username: string; password: string };
  private readonly logger: Logger;

  constructor(config: TACConfig, logger?: Logger) {
    this.baseUrl = config.knowledgeApiUrl;

    // Reuse Memory API credentials (same as Python)
    if (!config.memoryApiKey || !config.memoryApiToken) {
      throw new Error(
        'Memory API credentials are required for Knowledge client. ' +
          'Please set MEMORY_API_KEY and MEMORY_API_TOKEN environment variables.'
      );
    }

    this.credentials = {
      username: config.memoryApiKey,
      password: config.memoryApiToken,
    };
    const baseLogger = logger || createLogger({ name: 'tac-knowledge' });
    this.logger = baseLogger.child({ client: 'knowledge' });
  }

  /**
   * Get knowledge base metadata
   *
   * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
   * @returns Promise containing knowledge base metadata
   */
  public async getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBase> {
    const url = `${this.baseUrl}/v2/ControlPlane/KnowledgeBases/${knowledgeBaseId}`;

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
      throw new Error(`Failed to get knowledge base: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return KnowledgeBaseSchema.parse(data);
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
    const url = `${this.baseUrl}/v2/KnowledgeBases/${knowledgeBaseId}/Search`;

    const requestBody: Record<string, unknown> = {
      query,
      top: Math.min(Math.max(topK, 1), 20), // Clamp to 1-20
    };

    if (knowledgeIds && knowledgeIds.length > 0) {
      requestBody.knowledgeIds = knowledgeIds;
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
      throw new Error(`Failed to search knowledge base: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const validated = KnowledgeSearchResponseSchema.parse(data);
    return validated.chunks;
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
      'Knowledge HTTP request'
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
