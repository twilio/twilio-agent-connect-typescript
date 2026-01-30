import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TACConfig, Communication } from '@twilio/tac-core';
import { ConversationClient } from '../packages/core/src/clients/conversation';

/**
 * Create a mock Response object with proper clone() support
 */
function createMockResponse(data: unknown, options: { ok: boolean; status?: number; statusText?: string }) {
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

describe('ConversationClient', () => {
  const getTestConfig = () => ({
    environment: 'dev' as const,
    twilioAccountSid: 'ACtest123',
    twilioAuthToken: 'test_token_123',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let conversationClient: ConversationClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    const config = new TACConfig(getTestConfig());
    conversationClient = new ConversationClient(config);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('listCommunications()', () => {
    it('should list communications successfully', async () => {
      const mockCommunications: Communication[] = [
        {
          id: 'comm_123',
          conversation_id: 'CH123',
          account_id: 'AC123456',
          author: {
            address: '+12025551234',
            channel: 'SMS',
            participant_id: 'part_123',
          },
          content: {
            type: 'TEXT',
            text: 'Hello',
          },
          recipients: [
            {
              address: '+12025555678',
              channel: 'SMS',
              participant_id: 'part_456',
            },
          ],
          created_at: '2019-08-24T14:15:22Z',
          updated_at: '2019-08-24T14:15:22Z',
        },
      ];

      global.fetch = vi
        .fn()
        .mockResolvedValue(createMockResponse({ communications: mockCommunications }, { ok: true }));

      const result = await conversationClient.listCommunications('CH123');

      expect(result).toEqual(mockCommunications);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/Conversations/CH123/Communications'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
          }),
        })
      );
    });

    it('should handle empty response', async () => {
      global.fetch = vi.fn().mockResolvedValue(createMockResponse({ communications: [] }, { ok: true }));

      const result = await conversationClient.listCommunications('CH123');

      expect(result).toEqual([]);
    });

    it('should handle API errors', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(createMockResponse(null, { ok: false, status: 404, statusText: 'Not Found' }));

      await expect(conversationClient.listCommunications('CH123')).rejects.toThrow(
        'Failed to list communications: 404 Not Found'
      );
    });
  });

  describe('createConversation()', () => {
    it('should create a conversation successfully', async () => {
      const mockResponse = {
        id: 'CH123456',
        name: 'tac-voice-test',
        status: 'ACTIVE',
        accountId: 'ACtest123',
        configurationId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true, status: 201 }));

      const result = await conversationClient.createConversation('tac-voice-test');

      expect(result.id).toBe('CH123456');
      expect(result.name).toBe('tac-voice-test');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/Conversations'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should create a conversation without name', async () => {
      const mockResponse = {
        id: 'CH123456',
        accountId: 'ACtest123',
        status: 'ACTIVE',
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true, status: 201 }));

      const result = await conversationClient.createConversation();

      expect(result.id).toBe('CH123456');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/Conversations'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('addParticipant()', () => {
    it('should add a participant successfully', async () => {
      const mockResponse = {
        id: 'PA123456',
        conversationId: 'CH123456',
        accountId: 'ACtest123',
        type: 'CUSTOMER',
        addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        profileId: 'profile_123',
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true, status: 201 }));

      const result = await conversationClient.addParticipant(
        'CH123456',
        [{ channel: 'VOICE', address: '+15551234567' }],
        'CUSTOMER'
      );

      expect(result.id).toBe('PA123456');
      expect(result.type).toBe('CUSTOMER');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/Conversations/CH123456/Participants'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should add participant with channelId', async () => {
      const mockResponse = {
        id: 'PA123456',
        conversationId: 'CH123456',
        accountId: 'ACtest123',
        type: 'AI_AGENT',
        addresses: [{ channel: 'VOICE', address: '+15559876543', channelId: 'CA12345' }],
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true, status: 201 }));

      const result = await conversationClient.addParticipant(
        'CH123456',
        [{ channel: 'VOICE', address: '+15559876543', channelId: 'CA12345' }],
        'AI_AGENT'
      );

      expect(result.type).toBe('AI_AGENT');
    });
  });

  describe('listConversations()', () => {
    it('should list conversations by channelId', async () => {
      const mockResponse = {
        conversations: [
          { id: 'CH111', accountId: 'ACtest123', status: 'ACTIVE' },
          { id: 'CH222', accountId: 'ACtest123', status: 'ACTIVE' },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true }));

      const result = await conversationClient.listConversations({ channelId: 'CA12345' });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('CH111');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('channelId=CA12345'),
        expect.any(Object)
      );
    });

    it('should list conversations by status', async () => {
      const mockResponse = {
        conversations: [{ id: 'CH111', accountId: 'ACtest123', status: 'ACTIVE' }],
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true }));

      const result = await conversationClient.listConversations({ status: ['ACTIVE', 'INACTIVE'] });

      expect(result).toHaveLength(1);
      // Status is sent as comma-separated: status=ACTIVE,INACTIVE (URL-encoded as ACTIVE%2CINACTIVE)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/status=ACTIVE/),
        expect.any(Object)
      );
    });
  });

  describe('updateConversation()', () => {
    it('should update conversation status to CLOSED', async () => {
      const mockResponse = {
        id: 'CH123456',
        accountId: 'ACtest123',
        status: 'CLOSED',
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true }));

      const result = await conversationClient.updateConversation('CH123456', 'CLOSED');

      expect(result.status).toBe('CLOSED');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/Conversations/CH123456'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ status: 'CLOSED' }),
        })
      );
    });
  });

  describe('listParticipants()', () => {
    it('should list participants for a conversation', async () => {
      const mockResponse = {
        participants: [
          { id: 'PA111', conversationId: 'CH123456', accountId: 'ACtest123', type: 'CUSTOMER', addresses: [] },
          { id: 'PA222', conversationId: 'CH123456', accountId: 'ACtest123', type: 'AI_AGENT', addresses: [] },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true }));

      const result = await conversationClient.listParticipants('CH123456');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('PA111');
      expect(result[1].type).toBe('AI_AGENT');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/Conversations/CH123456/Participants'),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should return empty array when no participants', async () => {
      global.fetch = vi.fn().mockResolvedValue(createMockResponse({ participants: [] }, { ok: true }));

      const result = await conversationClient.listParticipants('CH123456');

      expect(result).toEqual([]);
    });
  });
});
