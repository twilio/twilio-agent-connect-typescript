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

      const result = await conversationClient.createConversation({ name: 'Test Conversation' });

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

  describe('updateParticipant()', () => {
    it('should PUT participant with type and addresses', async () => {
      const mockResponse = {
        id: 'part_123',
        conversationId: 'CH123',
        accountId: 'AC123456',
        type: 'AI_AGENT',
        addresses: [{ channel: 'SMS', address: '+12025551234' }],
      };

      mockAdapter
        .onPut('/v2/Conversations/CH123/Participants/part_123')
        .reply(200, mockResponse);

      const result = await conversationClient.updateParticipant(
        'CH123',
        'part_123',
        'AI_AGENT',
        [{ channel: 'SMS', address: '+12025551234' }]
      );

      expect(result.id).toBe('part_123');
      expect(result.type).toBe('AI_AGENT');

      const body = JSON.parse(mockAdapter.history.put[0]!.data);
      expect(body).toMatchObject({
        type: 'AI_AGENT',
        addresses: [{ channel: 'SMS', address: '+12025551234' }],
      });
      expect(body).not.toHaveProperty('name');
      expect(body).not.toHaveProperty('profileId');
    });

    it('should include optional name and profileId when provided', async () => {
      const mockResponse = {
        id: 'part_123',
        conversationId: 'CH123',
        accountId: 'AC123456',
        type: 'CUSTOMER',
        addresses: [{ channel: 'SMS', address: '+12025551234' }],
        name: 'Jane Customer',
        profileId: 'mem_profile_00000000000000000000000001',
      };

      mockAdapter
        .onPut('/v2/Conversations/CH123/Participants/part_123')
        .reply(200, mockResponse);

      await conversationClient.updateParticipant(
        'CH123',
        'part_123',
        'CUSTOMER',
        [{ channel: 'SMS', address: '+12025551234' }],
        { name: 'Jane Customer', profileId: 'mem_profile_00000000000000000000000001' }
      );

      const body = JSON.parse(mockAdapter.history.put[0]!.data);
      expect(body).toMatchObject({
        type: 'CUSTOMER',
        addresses: [{ channel: 'SMS', address: '+12025551234' }],
        name: 'Jane Customer',
        profileId: 'mem_profile_00000000000000000000000001',
      });
    });

    it('should include participantId in URL path', async () => {
      mockAdapter
        .onPut('/v2/Conversations/CH123/Participants/part_xyz789')
        .reply(200, {
          id: 'part_xyz789',
          conversationId: 'CH123',
          accountId: 'AC123456',
          type: 'AI_AGENT',
          addresses: [{ channel: 'SMS', address: '+12025551234' }],
        });

      await conversationClient.updateParticipant(
        'CH123',
        'part_xyz789',
        'AI_AGENT',
        [{ channel: 'SMS', address: '+12025551234' }]
      );

      expect(mockAdapter.history.put[0]!.url).toBe(
        '/v2/Conversations/CH123/Participants/part_xyz789'
      );
    });

    it('should surface HTTP errors', async () => {
      mockAdapter
        .onPut('/v2/Conversations/CH123/Participants/part_123')
        .reply(500);

      await expect(
        conversationClient.updateParticipant(
          'CH123',
          'part_123',
          'AI_AGENT',
          [{ channel: 'SMS', address: '+12025551234' }]
        )
      ).rejects.toThrow(/Failed to update participant/);
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

  describe('createAction()', () => {
    it('should create a SEND_MESSAGE action successfully', async () => {
      const mockResponse = {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CH123',
        createdAt: '2025-01-15T10:30:00Z',
      };

      mockAdapter.onPost('/v2/Conversations/CH123/Actions').reply(202, mockResponse);

      const result = await conversationClient.createAction('CH123', {
        type: 'SEND_MESSAGE',
        payload: {
          from: { address: '+12025551234', channel: 'SMS', participantId: 'part_123' },
          to: [{ address: '+12025555678', channel: 'SMS', participantId: 'part_456' }],
          content: { text: 'Hello' },
          channelSettings: { channelId: 'SM999' },
        },
      });

      // Body uses the {type, payload} shape and does not include conversationId
      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body).not.toHaveProperty('conversationId');
      expect(body.type).toBe('SEND_MESSAGE');
      expect(body.payload.from.participantId).toBe('part_123');
      expect(body.payload.to).toHaveLength(1);
      expect(body.payload.content.text).toBe('Hello');
      expect(body.payload.content).not.toHaveProperty('type');
      expect(body.payload.channelSettings.channelId).toBe('SM999');

      expect(result.id).toBe('conv_action_01abcdef');
      expect(result.type).toBe('SEND_MESSAGE');
      expect(result.status).toBe('PENDING');
      expect(result.conversationId).toBe('CH123');
      expect(result.createdAt).toBe('2025-01-15T10:30:00Z');
    });

    it('should omit channelSettings when not provided', async () => {
      mockAdapter.onPost('/v2/Conversations/CH123/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CH123',
      });

      await conversationClient.createAction('CH123', {
        type: 'SEND_MESSAGE',
        payload: {
          from: { address: '+12025551234', channel: 'SMS', participantId: 'part_123' },
          to: [{ address: '+12025555678', channel: 'SMS', participantId: 'part_456' }],
          content: { text: 'Hello' },
        },
      });

      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body.payload).not.toHaveProperty('channelSettings');
    });

    it('should handle API errors', async () => {
      mockAdapter.onPost('/v2/Conversations/CH123/Actions').reply(500);

      await expect(
        conversationClient.createAction('CH123', {
          type: 'SEND_MESSAGE',
          payload: {
            from: { address: '+12025551234', channel: 'SMS', participantId: 'part_123' },
            to: [{ address: '+12025555678', channel: 'SMS', participantId: 'part_456' }],
            content: { text: 'Hello' },
          },
        })
      ).rejects.toThrow(/Failed to create action/);
    });
  });

  describe('getConfiguration()', () => {
    it('should get configuration successfully', async () => {
      const mockResponse = {
        id: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
        description: 'Test Config',
        conversationGroupingType: 'GROUP_BY_PARTICIPANT_ADDRESSES',
        memoryStoreId: 'mem_store_01kbjqhhdpft0tbp21jt4ktbxg',
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
        memoryStoreId: 'mem_store_01kbjqhhdpft0tbp21jt4ktbxh',
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
        memoryStoreId: 'mem_store_01kbjqhhdpft0tbp21jt4ktbxi',
        statusCallbacks: [{ url: 'not-a-valid-url' }],
        createdAt: '2019-08-24T14:15:22Z',
        updatedAt: '2019-08-24T14:15:22Z',
      };

      mockAdapter.onGet('/v2/ControlPlane/Configurations/conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd').reply(200, mockResponse);

      await expect(conversationClient.getConfiguration('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd')).rejects.toThrow();
    });

    it('should accept GROUP_BY_PROFILE grouping type', async () => {
      const mockResponse = {
        id: 'conv_configuration_profile',
        description: 'Profile-Based Configuration',
        conversationGroupingType: 'GROUP_BY_PROFILE',
        memoryStoreId: 'mem_store_01kbjqhhdpft0tbp21jt4ktbxj',
        createdAt: '2019-08-24T14:15:22Z',
        updatedAt: '2019-08-24T14:15:22Z',
      };

      mockAdapter.onGet('/v2/ControlPlane/Configurations/conv_configuration_profile').reply(200, mockResponse);

      const result = await conversationClient.getConfiguration('conv_configuration_profile');

      expect(result.id).toBe('conv_configuration_profile');
      expect(result.conversationGroupingType).toBe('GROUP_BY_PROFILE');
    });

    it('should accept all valid grouping types', async () => {
      const groupingTypes = [
        'GROUP_BY_PROFILE',
        'GROUP_BY_PARTICIPANT_ADDRESSES',
        'GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE',
      ];

      for (const groupingType of groupingTypes) {
        const mockResponse = {
          id: `conv_configuration_${groupingType}`,
          description: `Test config with ${groupingType}`,
          conversationGroupingType: groupingType,
          memoryStoreId: 'mem_store_01kbjqhhdpft0tbp21jt4ktbxk',
          createdAt: '2019-08-24T14:15:22Z',
          updatedAt: '2019-08-24T14:15:22Z',
        };

        mockAdapter.onGet(`/v2/ControlPlane/Configurations/conv_configuration_${groupingType}`).reply(200, mockResponse);

        const result = await conversationClient.getConfiguration(`conv_configuration_${groupingType}`);

        expect(result.conversationGroupingType).toBe(groupingType);
      }
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
