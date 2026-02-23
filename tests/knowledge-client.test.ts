import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TACConfig } from '@twilio/tac-core';
import { KnowledgeClient } from '../packages/core/src/clients/knowledge';
import { KnowledgeBase, KnowledgeChunkResult } from '@twilio/tac-core';

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

describe('KnowledgeClient', () => {
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

  describe('getKnowledgeBase()', () => {
    it('should fetch knowledge base metadata successfully', async () => {
      const mockResponse: KnowledgeBase = {
        id: 'know_knowledgebase_01abc123def456ghi789jkl0',
        displayName: 'Product FAQ',
        description: 'Frequently asked questions about our products',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T12:00:00Z',
        version: 1,
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true }));

      const result = await knowledgeClient.getKnowledgeBase(
        'know_knowledgebase_01abc123def456ghi789jkl0'
      );

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/v2/ControlPlane/KnowledgeBases/know_knowledgebase_01abc123def456ghi789jkl0'
        ),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
          }),
        })
      );
    });

    it('should handle 404 errors', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(null, { ok: false, status: 404, statusText: 'Not Found' })
        );

      await expect(
        knowledgeClient.getKnowledgeBase('know_knowledgebase_nonexistent')
      ).rejects.toThrow('Failed to get knowledge base: 404 Not Found');
    });

    it('should handle 500 errors', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(null, { ok: false, status: 500, statusText: 'Internal Server Error' })
        );

      await expect(
        knowledgeClient.getKnowledgeBase('know_knowledgebase_01abc123def456ghi789jkl0')
      ).rejects.toThrow('Failed to get knowledge base: 500 Internal Server Error');
    });
  });

  describe('searchKnowledgeBase()', () => {
    it('should search knowledge base successfully', async () => {
      const mockChunks: KnowledgeChunkResult[] = [
        {
          content: 'Our product supports multiple languages including English and Spanish.',
          knowledgeId: 'know_01abc123',
          createdAt: '2024-01-10T00:00:00Z',
          score: 0.95,
        },
        {
          content: 'You can change the language in the settings menu.',
          knowledgeId: 'know_01def456',
          createdAt: '2024-01-11T00:00:00Z',
          score: 0.85,
        },
      ];

      global.fetch = vi
        .fn()
        .mockResolvedValue(createMockResponse({ chunks: mockChunks }, { ok: true }));

      const result = await knowledgeClient.searchKnowledgeBase(
        'know_knowledgebase_01abc123def456ghi789jkl0',
        'What languages are supported?'
      );

      expect(result).toEqual(mockChunks);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/v2/KnowledgeBases/know_knowledgebase_01abc123def456ghi789jkl0/Search'
        ),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: expect.stringContaining('Basic'),
          }),
          body: JSON.stringify({
            query: 'What languages are supported?',
            top: 5,
          }),
        })
      );
    });

    it('should respect custom topK parameter', async () => {
      const mockChunks: KnowledgeChunkResult[] = [];

      global.fetch = vi
        .fn()
        .mockResolvedValue(createMockResponse({ chunks: mockChunks }, { ok: true }));

      await knowledgeClient.searchKnowledgeBase(
        'know_knowledgebase_01abc123def456ghi789jkl0',
        'test query',
        10
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: 'test query',
            top: 10,
          }),
        })
      );
    });

    it('should clamp topK to maximum of 20', async () => {
      const mockChunks: KnowledgeChunkResult[] = [];

      global.fetch = vi
        .fn()
        .mockResolvedValue(createMockResponse({ chunks: mockChunks }, { ok: true }));

      await knowledgeClient.searchKnowledgeBase(
        'know_knowledgebase_01abc123def456ghi789jkl0',
        'test query',
        50
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: 'test query',
            top: 20,
          }),
        })
      );
    });

    it('should include knowledgeIds filter when provided', async () => {
      const mockChunks: KnowledgeChunkResult[] = [];

      global.fetch = vi
        .fn()
        .mockResolvedValue(createMockResponse({ chunks: mockChunks }, { ok: true }));

      await knowledgeClient.searchKnowledgeBase(
        'know_knowledgebase_01abc123def456ghi789jkl0',
        'test query',
        5,
        ['know_01abc', 'know_02def']
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: 'test query',
            top: 5,
            knowledgeIds: ['know_01abc', 'know_02def'],
          }),
        })
      );
    });

    it('should handle empty results', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(createMockResponse({ chunks: [] }, { ok: true }));

      const result = await knowledgeClient.searchKnowledgeBase(
        'know_knowledgebase_01abc123def456ghi789jkl0',
        'obscure query with no matches'
      );

      expect(result).toEqual([]);
    });

    it('should handle API errors', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(null, { ok: false, status: 500, statusText: 'Internal Server Error' })
        );

      await expect(
        knowledgeClient.searchKnowledgeBase(
          'know_knowledgebase_01abc123def456ghi789jkl0',
          'test query'
        )
      ).rejects.toThrow('Failed to search knowledge base: 500 Internal Server Error');
    });
  });

  describe('constructor', () => {
    it('should throw error when memory credentials are missing', () => {
      const configWithoutCredentials = {
        ...getTestConfig(),
        memoryApiKey: undefined,
        memoryApiToken: undefined,
      };

      const config = new TACConfig(configWithoutCredentials);

      expect(() => new KnowledgeClient(config)).toThrow(
        'Memory API credentials are required for Knowledge client'
      );
    });
  });
});
