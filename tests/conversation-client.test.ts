import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TACConfig, Communication } from '@twilio/tac-core';
import { ConversationClient } from '../packages/core/src/clients/conversation';
import MockAdapter from 'axios-mock-adapter';

describe('ConversationClient', () => {
  const getTestConfig = () => ({

    accountSid: 'ACtest123',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let conversationClient: ConversationClient;
  let mockAdapter: MockAdapter;

  beforeEach(() => {
    const config = new TACConfig(getTestConfig());
    conversationClient = new ConversationClient(config);
    mockAdapter = new MockAdapter((conversationClient as any).axiosInstance);
  });

  afterEach(() => {
    mockAdapter.restore();
  });

  describe('listCommunications()', () => {
    it('should list communications successfully', async () => {
      const mockCommunications: Communication[] = [
        {
          id: 'comm_123',
          conversationId: 'CH123',
          accountId: 'AC123456',
          author: {
            address: '+12025551234',
            channel: 'SMS',
            participantId: 'part_123',
          },
          content: {
            type: 'TEXT',
            text: 'Hello',
          },
          recipients: [
            {
              address: '+12025555678',
              channel: 'SMS',
              participantId: 'part_456',
            },
          ],
          createdAt: '2019-08-24T14:15:22Z',
          updatedAt: '2019-08-24T14:15:22Z',
        },
      ];

      mockAdapter.onGet('/v2/Conversations/CH123/Communications').reply(200, { communications: mockCommunications });

      const result = await conversationClient.listCommunications('CH123');

      expect(result).toEqual(mockCommunications);
    });

    it('should handle empty response', async () => {
      mockAdapter.onGet('/v2/Conversations/CH123/Communications').reply(200, { communications: [] });

      const result = await conversationClient.listCommunications('CH123');

      expect(result).toEqual([]);
    });

    it('should handle API errors', async () => {
      mockAdapter.onGet('/v2/Conversations/CH123/Communications').reply(500);

      await expect(conversationClient.listCommunications('CH123')).rejects.toThrow(/Failed to list communications/);
    });
  });

  describe('createConversation()', () => {
    it('should create a conversation successfully', async () => {
      const mockResponse = {
        id: 'CH123',
        accountId: 'AC123456',
        configurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
        name: 'Test Conversation',
        status: 'ACTIVE',
        createdAt: '2019-08-24T14:15:22Z',
        updatedAt: '2019-08-24T14:15:22Z',
      };

      mockAdapter.onPost('/v2/Conversations').reply(200, mockResponse);

      const result = await conversationClient.createConversation('Test Conversation');

      expect(result.id).toBe('CH123');
      expect(result.name).toBe('Test Conversation');
    });

    it('should create a conversation without name', async () => {
      const mockResponse = {
        id: 'CH124',
        accountId: 'AC123456',
        configurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
        status: 'ACTIVE',
        createdAt: '2019-08-24T14:15:22Z',
        updatedAt: '2019-08-24T14:15:22Z',
      };

      mockAdapter.onPost('/v2/Conversations').reply(200, mockResponse);

      const result = await conversationClient.createConversation();

      expect(result.id).toBe('CH124');
    });
  });

  describe('addParticipant()', () => {
    it('should add a participant successfully', async () => {
      const mockResponse = {
        id: 'part_123',
        conversationId: 'CH123',
        accountId: 'AC123456',
        type: 'CUSTOMER',
        addresses: [{ channel: 'SMS', address: '+12025551234' }],
      };

      mockAdapter.onPost('/v2/Conversations/CH123/Participants').reply(200, mockResponse);

      const result = await conversationClient.addParticipant(
        'CH123',
        [{ channel: 'SMS', address: '+12025551234' }],
        'CUSTOMER'
      );

      expect(result.id).toBe('part_123');
      expect(result.type).toBe('CUSTOMER');
    });

    it('should add participant with channelId', async () => {
      const mockResponse = {
        id: 'part_124',
        conversationId: 'CH123',
        accountId: 'AC123456',
        type: 'AI_AGENT',
        addresses: [{ channel: 'CHAT', address: 'bot', channelId: 'CH123' }],
      };

      mockAdapter.onPost('/v2/Conversations/CH123/Participants').reply(200, mockResponse);

      const result = await conversationClient.addParticipant(
        'CH123',
        [{ channel: 'CHAT', address: 'bot', channelId: 'CH123' }],
        'AI_AGENT'
      );

      expect(result.id).toBe('part_124');
    });
  });

  describe('listConversations()', () => {
    it('should list conversations by channelId', async () => {
      const mockResponse = {
        conversations: [
          {
            id: 'CH123',
            accountId: 'AC123456',
            configurationId: 'config_123',
            status: 'ACTIVE',
            createdAt: '2019-08-24T14:15:22Z',
            updatedAt: '2019-08-24T14:15:22Z',
          },
        ],
      };

      mockAdapter
        .onGet('/v2/Conversations', { params: { channelId: 'CH123' } })
        .reply(200, mockResponse);

      const result = await conversationClient.listConversations({ channelId: 'CH123' });

      expect(result.length).toBe(1);
      expect(result[0]?.id).toBe('CH123');
    });

    it('should list conversations by status', async () => {
      const mockResponse = {
        conversations: [
          {
            id: 'CH124',
            accountId: 'AC123456',
            configurationId: 'config_123',
            status: 'ACTIVE',
            createdAt: '2019-08-24T14:15:22Z',
            updatedAt: '2019-08-24T14:15:22Z',
          },
        ],
      };

      mockAdapter
        .onGet('/v2/Conversations', { params: { status: 'ACTIVE' } })
        .reply(200, mockResponse);

      const result = await conversationClient.listConversations({ status: ['ACTIVE'] });

      expect(result.length).toBe(1);
    });
  });

  describe('updateConversation()', () => {
    it('should update conversation status to CLOSED', async () => {
      const mockResponse = {
        id: 'CH123',
        accountId: 'AC123456',
        configurationId: 'config_123',
        status: 'CLOSED',
        createdAt: '2019-08-24T14:15:22Z',
        updatedAt: '2019-08-24T14:15:22Z',
      };

      mockAdapter.onPut('/v2/Conversations/CH123').reply(200, mockResponse);

      const result = await conversationClient.updateConversation('CH123', 'CLOSED');

      expect(result.status).toBe('CLOSED');
    });
  });

  describe('listParticipants()', () => {
    it('should list participants for a conversation', async () => {
      const mockResponse = {
        participants: [
          {
            id: 'part_123',
            conversationId: 'CH123',
            accountId: 'AC123456',
            type: 'CUSTOMER',
            addresses: [{ channel: 'SMS', address: '+12025551234' }],
          },
        ],
      };

      mockAdapter.onGet('/v2/Conversations/CH123/Participants').reply(200, mockResponse);

      const result = await conversationClient.listParticipants('CH123');

      expect(result.length).toBe(1);
      expect(result[0]?.type).toBe('CUSTOMER');
    });

    it('should return empty array when no participants', async () => {
      mockAdapter.onGet('/v2/Conversations/CH123/Participants').reply(200, { participants: [] });

      const result = await conversationClient.listParticipants('CH123');

      expect(result).toEqual([]);
    });
  });

  describe('sendCommunication()', () => {
    it('should send communication successfully', async () => {
      const mockResponse = {
        message: 'Communication queued',
        conversationId: 'CH123',
        channelId: null,
      };

      mockAdapter.onPost('/v2/Communications').reply(202, mockResponse);

      const result = await conversationClient.sendCommunication('CH123', {
        author: { address: '+12025551234', channel: 'SMS', participantId: 'part_123' },
        content: { type: 'TEXT', text: 'Hello' },
        recipients: [{ address: '+12025555678', channel: 'SMS', participantId: 'part_456' }],
      });

      expect(result.message).toBe('Communication queued');
    });

    it('should handle API errors', async () => {
      mockAdapter.onPost('/v2/Communications').reply(500);

      await expect(
        conversationClient.sendCommunication('CH123', {
          author: { address: '+12025551234', channel: 'SMS', participantId: 'part_123' },
          content: { type: 'TEXT', text: 'Hello' },
          recipients: [{ address: '+12025555678', channel: 'SMS', participantId: 'part_456' }],
        })
      ).rejects.toThrow(/Failed to send communication/);
    });
  });

  describe('getConfiguration()', () => {
    it('should get configuration successfully', async () => {
      const mockResponse = {
        id: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
        description: 'Test Config',
        conversationGroupingType: 'GROUP_BY_PARTICIPANT_ADDRESSES',
        memoryStoreId: 'mem_store_123',
        createdAt: '2019-08-24T14:15:22Z',
        updatedAt: '2019-08-24T14:15:22Z',
      };

      mockAdapter.onGet('/v2/ControlPlane/Configurations/conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd').reply(200, mockResponse);

      const result = await conversationClient.getConfiguration('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd');

      expect(result.id).toBe('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd');
    });

    it('should get minimal configuration successfully', async () => {
      const mockResponse = {
        id: 'conv_configuration_minimal',
        description: 'Minimal Config',
        conversationGroupingType: 'GROUP_BY_PARTICIPANT_ADDRESSES',
        memoryStoreId: 'mem_store_124',
        createdAt: '2019-08-24T14:15:22Z',
        updatedAt: '2019-08-24T14:15:22Z',
      };

      mockAdapter.onGet('/v2/ControlPlane/Configurations/conv_configuration_minimal').reply(200, mockResponse);

      const result = await conversationClient.getConfiguration('conv_configuration_minimal');

      expect(result.id).toBe('conv_configuration_minimal');
    });

    it('should handle API errors', async () => {
      mockAdapter.onGet('/v2/ControlPlane/Configurations/conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd').reply(404);

      await expect(conversationClient.getConfiguration('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd')).rejects.toThrow(/Failed to get configuration/);
    });

    it('should validate response with schema', async () => {
      const invalidResponse = {
        id: 'conv_configuration_invalid',
        // Missing required fields: description, conversationGroupingType, memoryStoreId
        createdAt: '2019-08-24T14:15:22Z',
        updatedAt: '2019-08-24T14:15:22Z',
      };

      mockAdapter.onGet('/v2/ControlPlane/Configurations/conv_configuration_invalid').reply(200, invalidResponse);

      await expect(conversationClient.getConfiguration('conv_configuration_invalid')).rejects.toThrow();
    });

    it('should reject invalid URL in statusCallbacks', async () => {
      const mockResponse = {
        id: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
        description: 'Invalid Callback Test',
        conversationGroupingType: 'GROUP_BY_PARTICIPANT_ADDRESSES',
        memoryStoreId: 'mem_store_126',
        statusCallbacks: [{ url: 'not-a-valid-url' }],
        createdAt: '2019-08-24T14:15:22Z',
        updatedAt: '2019-08-24T14:15:22Z',
      };

      mockAdapter.onGet('/v2/ControlPlane/Configurations/conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd').reply(200, mockResponse);

      await expect(conversationClient.getConfiguration('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd')).rejects.toThrow();
    });
  });

  describe('region support', () => {
    it('should use region in base URL when configured', () => {
      const config = new TACConfig({ ...getTestConfig(), region: 'test-region' });
      const regionClient = new ConversationClient(config);

      expect((regionClient as any).baseUrl).toBe('https://conversations.test-region.twilio.com');
    });

    it('should use default base URL when region is not configured', () => {
      expect((conversationClient as any).baseUrl).toBe('https://conversations.twilio.com');
    });
  });
});
