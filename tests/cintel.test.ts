import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TACConfig } from '@twilio/tac-core';
import { OperatorResultProcessor } from '../packages/core/src/lib/operator-result-processor';
import { MemoryClient } from '../packages/core/src/clients/memory';
import {
  OperatorResultEventSchema,
  OperatorProcessingResultSchema,
  ConversationIntelligenceConfigSchema,
} from '../packages/core/src/types/cintel';
import MockAdapter from 'axios-mock-adapter';

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

describe('Conversation Intelligence Types', () => {
  describe('OperatorResultEventSchema', () => {
    it('should validate a valid operator result event', () => {
      const validEvent = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: {
          id: 'LY123',
          friendlyName: 'Test Config',
        },
        operatorResults: [
          {
            id: 'result_123',
            operator: {
              id: 'LY456',
              name: 'Observation Operator',
            },
            outputFormat: 'JSON',
            result: { observations: ['User prefers email communication'] },
            dateCreated: '2024-01-15T10:00:00Z',
            referenceIds: ['ref_1'],
            executionDetails: {
              participants: [
                {
                  type: 'CUSTOMER',
                  profileId: 'profile_123',
                },
              ],
            },
          },
        ],
      };

      const result = OperatorResultEventSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });

    it('should reject invalid operator result event', () => {
      const invalidEvent = {
        accountId: 'AC123',
        // Missing required fields
      };

      const result = OperatorResultEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should handle optional fields', () => {
      const minimalEvent = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        intelligenceConfiguration: {
          id: 'LY123',
        },
        operatorResults: [
          {
            id: 'result_123',
            operator: {
              id: 'LY456',
            },
            outputFormat: 'JSON',
            result: null,
            dateCreated: '2024-01-15T10:00:00Z',
          },
        ],
      };

      const result = OperatorResultEventSchema.safeParse(minimalEvent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.operatorResults[0].referenceIds).toEqual([]);
      }
    });
  });

  describe('OperatorProcessingResultSchema', () => {
    it('should validate a success result', () => {
      const successResult = {
        success: true,
        eventType: 'observation',
        skipped: false,
        createdCount: 3,
      };

      const result = OperatorProcessingResultSchema.safeParse(successResult);
      expect(result.success).toBe(true);
    });

    it('should validate a skipped result', () => {
      const skippedResult = {
        success: true,
        skipped: true,
        skipReason: 'Operator not configured',
        createdCount: 0,
      };

      const result = OperatorProcessingResultSchema.safeParse(skippedResult);
      expect(result.success).toBe(true);
    });

    it('should validate an error result', () => {
      const errorResult = {
        success: false,
        skipped: false,
        error: 'Failed to create observation',
        createdCount: 0,
      };

      const result = OperatorProcessingResultSchema.safeParse(errorResult);
      expect(result.success).toBe(true);
    });
  });

  describe('ConversationIntelligenceConfigSchema', () => {
    it('should validate full config', () => {
      const config = {
        configurationId: 'LY123',
        summaryOperatorSid: 'LY789',
      };

      const result = ConversationIntelligenceConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate minimal config', () => {
      const config = {
        configurationId: 'LY123',
      };

      const result = ConversationIntelligenceConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });
});

describe('OperatorResultProcessor', () => {
  const getTestConfig = () => ({

    accountSid: 'ACtest123',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let memoryClient: MemoryClient;
  let processor: OperatorResultProcessor;
  let mockAdapter: MockAdapter;

  const cintelConfig = {
    configurationId: 'LY_CONFIG_123',
    summaryOperatorSid: 'LY_SUM_789',
  };

  beforeEach(() => {
    const config = new TACConfig(getTestConfig());
    memoryClient = new MemoryClient(config, 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg');
    processor = new OperatorResultProcessor(memoryClient, cintelConfig);
    mockAdapter = new MockAdapter((memoryClient as any).axiosInstance);
  });

  afterEach(() => {
    mockAdapter?.restore();
    vi.restoreAllMocks();
  });

  describe('processEvent()', () => {
    it('should reject invalid payload', async () => {
      const result = await processor.processEvent({ invalid: 'payload' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid payload');
    });

    it('should skip events from different CI configuration', async () => {
      const event = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: {
          id: 'DIFFERENT_CONFIG',
        },
        operatorResults: [],
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain('different CI configuration');
    });

    it('should skip unconfigured operators', async () => {
      const event = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: {
          id: 'LY_CONFIG_123',
        },
        operatorResults: [
          {
            id: 'result_123',
            operator: {
              id: 'UNCONFIGURED_OPERATOR',
            },
            outputFormat: 'JSON',
            result: { observations: ['test'] },
            dateCreated: '2024-01-15T10:00:00Z',
            executionDetails: {
              participants: [{ type: 'CUSTOMER', profileId: 'profile_123' }],
            },
          },
        ],
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('All operator results were skipped');
    });

    it('should skip operator results with empty content', async () => {
      const event = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: {
          id: 'LY_CONFIG_123',
        },
        operatorResults: [
          {
            id: 'result_123',
            operator: {
              id: 'LY_SUM_789',
            },
            outputFormat: 'JSON',
            result: null,
            dateCreated: '2024-01-15T10:00:00Z',
            executionDetails: {
              participants: [{ type: 'CUSTOMER', profileId: 'profile_123' }],
            },
          },
        ],
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('should skip operator results with no profile IDs', async () => {
      const event = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: {
          id: 'LY_CONFIG_123',
        },
        operatorResults: [
          {
            id: 'result_123',
            operator: {
              id: 'LY_SUM_789',
            },
            outputFormat: 'JSON',
            result: { summaries: ['test summary'] },
            dateCreated: '2024-01-15T10:00:00Z',
            executionDetails: {
              participants: [{ type: 'CUSTOMER' }], // No profileId
            },
          },
        ],
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('should skip observation operator results (auto-creation removed)', async () => {
      mockAdapter.onPost(/\/Observations$/).reply(200, {
        message: 'Observations created',
      });

      const event = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: {
          id: 'LY_CONFIG_123',
        },
        operatorResults: [
          {
            id: 'result_123',
            operator: {
              id: 'LY_OBS_456',
            },
            outputFormat: 'JSON',
            result: { observations: ['User prefers email', 'User is a premium customer'] },
            dateCreated: '2024-01-15T10:00:00Z',
            executionDetails: {
              participants: [{ type: 'CUSTOMER', profileId: 'profile_123' }],
            },
          },
        ],
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.createdCount).toBe(0);
      expect(mockAdapter.history.post.length).toBe(0);
    });

    it('should process summary operator results successfully', async () => {
      mockAdapter.onPost(/\/ConversationSummaries$/).reply(200, {
        message: 'Summaries created successfully',
      });

      const event = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: {
          id: 'LY_CONFIG_123',
        },
        operatorResults: [
          {
            id: 'result_123',
            operator: {
              id: 'LY_SUM_789',
            },
            outputFormat: 'JSON',
            result: { summaries: ['Customer requested a refund for order #12345'] },
            dateCreated: '2024-01-15T10:00:00Z',
            executionDetails: {
              participants: [{ type: 'CUSTOMER', profileId: 'profile_123' }],
            },
          },
        ],
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.eventType).toBe('summary');
      expect(result.createdCount).toBe(1);
    });

    it('should handle API errors gracefully', async () => {
      mockAdapter.onPost(/\/ConversationSummaries$/).reply(500, {
        error: 'Internal Server Error',
      });

      const event = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: {
          id: 'LY_CONFIG_123',
        },
        operatorResults: [
          {
            id: 'result_123',
            operator: {
              id: 'LY_SUM_789',
            },
            outputFormat: 'JSON',
            result: { summaries: ['test summary'] },
            dateCreated: '2024-01-15T10:00:00Z',
            executionDetails: {
              participants: [{ type: 'CUSTOMER', profileId: 'profile_123' }],
            },
          },
        ],
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create summaries');
    });

    it('should process multiple profiles', async () => {
      mockAdapter.onPost(/\/ConversationSummaries$/).reply(200, {
        message: 'Summaries created',
      });

      const event = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: {
          id: 'LY_CONFIG_123',
        },
        operatorResults: [
          {
            id: 'result_123',
            operator: {
              id: 'LY_SUM_789',
            },
            outputFormat: 'JSON',
            result: { summaries: ['Customer requested a refund'] },
            dateCreated: '2024-01-15T10:00:00Z',
            executionDetails: {
              participants: [
                { type: 'CUSTOMER', profileId: 'profile_123' },
                { type: 'CUSTOMER', profileId: 'profile_456' },
              ],
            },
          },
        ],
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.createdCount).toBe(2); // 1 summary x 2 customer profiles
    });

    describe('summary result formats', () => {
      const summaryEvent = (outputFormat: string, result: unknown) => ({
        accountId: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: { id: 'LY_CONFIG_123' },
        operatorResults: [
          {
            id: 'result_123',
            operator: { id: 'LY_SUM_789' },
            outputFormat,
            result,
            dateCreated: '2024-01-15T10:00:00Z',
            executionDetails: {
              participants: [{ type: 'CUSTOMER', profileId: 'profile_123' }],
            },
          },
        ],
      });

      const postedContents = (): string[] =>
        mockAdapter.history.post.flatMap(
          req =>
            (JSON.parse(req.data as string) as { summaries: Array<{ content: string }> }).summaries
        ).map(s => s.content);

      beforeEach(() => {
        mockAdapter.onPost(/\/ConversationSummaries$/).reply(200, { message: 'ok' });
      });

      it.each([
        [
          'payload with summary objects',
          'JSON',
          { payload: { summaries: [{ summary: 'First' }, { summary: 'Second' }] } },
          ['First', 'Second'],
        ],
        [
          'payload as a JSON string',
          'JSON',
          { payload: '{"summaries":[{"summary":"From string"}]}' },
          ['From string'],
        ],
        [
          'nested JSONResult union payload',
          'JSON',
          { 'com.twilio.cai.intelligence.JSONResult': { payload: { summary: 'Nested' } } },
          ['Nested'],
        ],
        ['a single summary object', 'JSON', { summary: 'Only one' }, ['Only one']],
        ['a list of summary strings', 'JSON', { summaries: ['Plain', 'List'] }, ['Plain', 'List']],
        ['plain text', 'TEXT', 'Customer asked about billing', ['Customer asked about billing']],
        [
          'a generation result wrapper',
          'GENERATION',
          { result: 'Generated summary' },
          ['Generated summary'],
        ],
        [
          'unrecognized JSON as raw text',
          'JSON',
          { payload: { notes: 'Something else' } },
          ['{"notes":"Something else"}'],
        ],
      ])('should create summaries from %s', async (_name, outputFormat, result, expected) => {
        const processed = await processor.processEvent(summaryEvent(outputFormat, result));

        expect(processed.success).toBe(true);
        expect(processed.skipped).toBe(false);
        expect(processed.createdCount).toBe(expected.length);
        expect(postedContents()).toEqual(expected);
      });
    });

    it('should write summaries only to customer profiles', async () => {
      mockAdapter.onPost(/\/ConversationSummaries$/).reply(200, { message: 'Summaries created' });

      const event = {
        accountId: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        conversationId: 'conv_123',
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        intelligenceConfiguration: { id: 'LY_CONFIG_123' },
        operatorResults: [
          {
            id: 'result_123',
            operator: { id: 'LY_SUM_789' },
            outputFormat: 'JSON',
            result: { summaries: ['Customer requested a refund'] },
            dateCreated: '2024-01-15T10:00:00Z',
            executionDetails: {
              participants: [
                { type: 'CUSTOMER', profileId: 'profile_customer' },
                { type: 'AI_AGENT', profileId: 'profile_ai_agent' },
                { type: 'HUMAN_AGENT', profileId: 'profile_human_agent' },
              ],
            },
          },
        ],
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.createdCount).toBe(1);
      expect(mockAdapter.history.post.map(req => req.url)).toEqual([
        '/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/profile_customer/ConversationSummaries',
      ]);
    });

    it('should handle missing memory store ID', async () => {
      const event = {
        accountId: 'AC123',
        conversationId: 'conv_123',
        // No memoryStoreId
        intelligenceConfiguration: {
          id: 'LY_CONFIG_123',
        },
        operatorResults: [
          {
            id: 'result_123',
            operator: {
              id: 'LY_OBS_456',
            },
            outputFormat: 'JSON',
            result: { observations: ['test observation'] },
            dateCreated: '2024-01-15T10:00:00Z',
            executionDetails: {
              participants: [{ type: 'CUSTOMER', profileId: 'profile_123' }],
            },
          },
        ],
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No memory store ID');
    });
  });
});

describe('Memory Client Write Methods', () => {
  const getTestConfig = () => ({

    accountSid: 'ACtest123',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let memoryClient: MemoryClient;
  let mockAdapter: MockAdapter;

  beforeEach(() => {
    const config = new TACConfig(getTestConfig());
    memoryClient = new MemoryClient(config, 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg');
    mockAdapter = new MockAdapter((memoryClient as any).axiosInstance);
  });

  afterEach(() => {
    mockAdapter?.restore();
    vi.restoreAllMocks();
  });

  describe('createObservation()', () => {
    it('should create observation successfully with a wrapped body', async () => {
      const mockResponse = { message: 'Observations created' };
      mockAdapter
        .onPost('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/profile_123/Observations')
        .reply(200, mockResponse);

      const result = await memoryClient.createObservation(
        'profile_123',
        'Test observation',
        'conversation-intelligence',
        ['conv_123'],
        '2024-01-15T10:00:00Z'
      );

      expect(result).toEqual(mockResponse);
      expect(mockAdapter.history.post.length).toBe(1);
      expect(mockAdapter.history.post[0].url).toBe(
        '/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/profile_123/Observations'
      );
      const body = JSON.parse(mockAdapter.history.post[0].data);
      expect(body).toEqual({
        observations: [
          {
            content: 'Test observation',
            source: 'conversation-intelligence',
            occurredAt: '2024-01-15T10:00:00Z',
            conversationIds: ['conv_123'],
          },
        ],
      });
    });

    it('should handle API errors', async () => {
      mockAdapter
        .onPost('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/profile_123/Observations')
        .reply(500, { error: 'Internal Server Error' });

      await expect(
        memoryClient.createObservation(
          'profile_123',
          'Test observation'
        )
      ).rejects.toThrow('Failed to create observation');
    });
  });

  describe('createConversationSummaries()', () => {
    it('should create summaries successfully', async () => {
      const mockResponse = { message: 'Summaries created successfully' };
      mockAdapter
        .onPost(
          '/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/profile_123/ConversationSummaries'
        )
        .reply(200, mockResponse);

      const result = await memoryClient.createConversationSummaries(
        'profile_123',
        [
          {
            content: 'Customer requested a refund',
            conversationId: 'conv_123',
            occurredAt: '2024-01-15T10:00:00Z',
            source: 'conversation-intelligence',
          },
        ]
      );

      expect(result).toEqual(mockResponse);
      expect(mockAdapter.history.post.length).toBe(1);
      expect(mockAdapter.history.post[0].url).toBe(
        '/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/profile_123/ConversationSummaries'
      );
    });

    it('should handle API errors', async () => {
      mockAdapter
        .onPost(
          '/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/profile_123/ConversationSummaries'
        )
        .reply(500, { error: 'Internal Server Error' });

      await expect(
        memoryClient.createConversationSummaries(
          'profile_123',
          [
            {
              content: 'Test summary',
              conversationId: 'conv_123',
              occurredAt: '2024-01-15T10:00:00Z',
            },
          ]
        )
      ).rejects.toThrow('Failed to create conversation summaries');
    });
  });
});
