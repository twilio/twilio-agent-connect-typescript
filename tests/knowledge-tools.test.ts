import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TACConfig, KnowledgeClient, KnowledgeBase, KnowledgeChunkResult } from '@twilio/tac-core';
import {
  createKnowledgeSearchTool,
  createKnowledgeSearchToolAsync,
  createKnowledgeTools,
} from '@twilio/tac-tools';

/**
 * Create a mock Response object with proper clone() support
 */
function createMockResponse(
  data: unknown,
  options: { ok: boolean; status?: number; statusText?: string }
) {
  const body = JSON.stringify(data);
  return {
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 500),
    statusText: options.statusText ?? (options.ok ? 'OK' : 'Error'),
    json: async () => data,
    text: async () => body,
    clone: function () {
      return this;
    },
  };
}

describe('Knowledge Tools', () => {
  const getTestConfig = () => ({
    environment: 'dev' as const,
    twilioAccountSid: 'ACtest123',
    twilioAuthToken: 'test_token_123',
    twilioPhoneNumber: '+15551234567',
    memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
    memoryApiKey: 'test_api_key',
    memoryApiToken: 'test_api_token',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let knowledgeClient: KnowledgeClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    const config = new TACConfig(getTestConfig());
    knowledgeClient = new KnowledgeClient(config);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('createKnowledgeSearchTool()', () => {
    it('should create tool with explicit name and description', () => {
      const tool = createKnowledgeSearchTool(
        knowledgeClient,
        'know_knowledgebase_01abc123def456ghi789jkl0',
        {
          name: 'search_product_faq',
          description: 'Search the product FAQ for answers',
        }
      );

      expect(tool.name).toBe('search_product_faq');
      expect(tool.description).toBe('Search the product FAQ for answers');
    });

    it('should only have query parameter in schema', () => {
      const tool = createKnowledgeSearchTool(
        knowledgeClient,
        'know_knowledgebase_01abc123def456ghi789jkl0',
        {
          name: 'search_kb',
          description: 'Search knowledge base',
        }
      );

      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties).toHaveProperty('query');
      expect(tool.parameters.required).toContain('query');
      expect(Object.keys(tool.parameters.properties!)).toEqual(['query']);
    });

    it('should execute search when tool is called', async () => {
      const mockChunks: KnowledgeChunkResult[] = [
        {
          content: 'Test content',
          knowledgeId: 'know_01abc',
          createdAt: '2024-01-01T00:00:00Z',
          score: 0.9,
        },
      ];

      global.fetch = vi
        .fn()
        .mockResolvedValue(createMockResponse({ chunks: mockChunks }, { ok: true }));

      const tool = createKnowledgeSearchTool(
        knowledgeClient,
        'know_knowledgebase_01abc123def456ghi789jkl0',
        {
          name: 'search_kb',
          description: 'Search',
        }
      );

      const result = await tool.implementation({ query: 'test query' });

      expect(result).toEqual(mockChunks);
    });

    it('should use custom topK when provided', async () => {
      const mockChunks: KnowledgeChunkResult[] = [];

      global.fetch = vi
        .fn()
        .mockResolvedValue(createMockResponse({ chunks: mockChunks }, { ok: true }));

      const tool = createKnowledgeSearchTool(
        knowledgeClient,
        'know_knowledgebase_01abc123def456ghi789jkl0',
        {
          name: 'search_kb',
          description: 'Search',
          topK: 10,
        }
      );

      await tool.implementation({ query: 'test' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"top":10'),
        })
      );
    });

    it('should convert to OpenAI format correctly', () => {
      const tool = createKnowledgeSearchTool(
        knowledgeClient,
        'know_knowledgebase_01abc123def456ghi789jkl0',
        {
          name: 'search_product_faq',
          description: 'Search the product FAQ',
        }
      );

      const openaiFormat = tool.toOpenAIFormat();

      expect(openaiFormat.type).toBe('function');
      expect(openaiFormat.function.name).toBe('search_product_faq');
      expect(openaiFormat.function.description).toBe('Search the product FAQ');
      expect(openaiFormat.function.parameters).toBeDefined();
    });

    it('should convert to Anthropic format correctly', () => {
      const tool = createKnowledgeSearchTool(
        knowledgeClient,
        'know_knowledgebase_01abc123def456ghi789jkl0',
        {
          name: 'search_product_faq',
          description: 'Search the product FAQ',
        }
      );

      const anthropicFormat = tool.toAnthropicFormat();

      expect(anthropicFormat.name).toBe('search_product_faq');
      expect(anthropicFormat.description).toBe('Search the product FAQ');
      expect(anthropicFormat.input_schema).toBeDefined();
    });
  });

  describe('createKnowledgeSearchToolAsync()', () => {
    it('should auto-generate name and description from KB metadata', async () => {
      const mockKB: KnowledgeBase = {
        id: 'know_knowledgebase_01abc123def456ghi789jkl0',
        displayName: 'Product FAQ',
        description: 'Frequently asked questions about products',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T00:00:00Z',
        version: 1,
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockKB, { ok: true }));

      const tool = await createKnowledgeSearchToolAsync(
        knowledgeClient,
        'know_knowledgebase_01abc123def456ghi789jkl0'
      );

      expect(tool.name).toBe('search_product_faq');
      expect(tool.description).toBe('Frequently asked questions about products');
    });

    it('should use provided name/description over auto-generated', async () => {
      global.fetch = vi.fn();

      const tool = await createKnowledgeSearchToolAsync(
        knowledgeClient,
        'know_knowledgebase_01abc123def456ghi789jkl0',
        {
          name: 'custom_name',
          description: 'Custom description',
        }
      );

      expect(tool.name).toBe('custom_name');
      expect(tool.description).toBe('Custom description');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should generate fallback description when KB has empty description', async () => {
      const mockKB: KnowledgeBase = {
        id: 'know_knowledgebase_01abc123def456ghi789jkl0',
        displayName: 'Support Docs',
        description: '',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T00:00:00Z',
        version: 1,
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockKB, { ok: true }));

      const tool = await createKnowledgeSearchToolAsync(
        knowledgeClient,
        'know_knowledgebase_01abc123def456ghi789jkl0'
      );

      expect(tool.description).toBe('Search the Support Docs knowledge base');
    });
  });

  describe('createKnowledgeTools()', () => {
    it('should create factory with forKnowledgeBase method', () => {
      const factory = createKnowledgeTools(knowledgeClient);

      const tool = factory.forKnowledgeBase('know_knowledgebase_01abc123def456ghi789jkl0', {
        name: 'test_tool',
        description: 'Test description',
      });

      expect(tool.name).toBe('test_tool');
      expect(tool.description).toBe('Test description');
    });

    it('should create factory with forKnowledgeBaseAsync method', async () => {
      const mockKB: KnowledgeBase = {
        id: 'know_knowledgebase_01abc123def456ghi789jkl0',
        displayName: 'My KB',
        description: 'My knowledge base',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T00:00:00Z',
        version: 1,
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockKB, { ok: true }));

      const factory = createKnowledgeTools(knowledgeClient);
      const tool = await factory.forKnowledgeBaseAsync(
        'know_knowledgebase_01abc123def456ghi789jkl0'
      );

      expect(tool.name).toBe('search_my_kb');
      expect(tool.description).toBe('My knowledge base');
    });
  });
});
