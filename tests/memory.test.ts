import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TAC,
  TACConfig,
  ConversationSession,
  MemoryRetrievalResponse,
  ProfileResponse,
  Communication,
  TACMemoryResponse,
  MemoryCommunication,
} from '@twilio/tac-core';

describe('Memory Functionality', () => {
  const getTestConfigWithoutMemory = () => ({
    environment: 'prod' as const,
    twilioAccountSid: 'ACtest123',
    twilioAuthToken: 'test_token_123',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  const getTestConfigWithMemory = () => ({
    ...getTestConfigWithoutMemory(),
    memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
    memoryApiKey: 'test_api_key',
    memoryApiToken: 'test_api_token',
  });

  describe('isMemoryEnabled()', () => {
    it('should return true when memory configured', () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      expect(tac.isMemoryEnabled()).toBe(true);
    });

    it('should return false when memory not configured', () => {
      const config = new TACConfig(getTestConfigWithoutMemory());
      const tac = new TAC({ config });

      expect(tac.isMemoryEnabled()).toBe(false);
    });
  });

  describe('retrieveMemory() with Memory Service', () => {
    it('should retrieve memory with profile_id provided', async () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      const mockMemoryResponse: MemoryRetrievalResponse = {
        observations: [],
        summaries: [],
        sessions: [],
        communications: [],
        metadata: {
          total_observations: 0,
          total_summaries: 0,
          total_sessions: 0,
          query_timestamp: new Date().toISOString(),
        },
      };

      // Mock the memory client method
      const memoryClient = tac.getMemoryClient();
      expect(memoryClient).toBeDefined();
      vi.spyOn(memoryClient!, 'retrieveMemories').mockResolvedValue(mockMemoryResponse);

      const session: ConversationSession = {
        conversation_id: 'conv_test_123',
        profile_id: 'mem_profile_existing',
        channel: 'sms',
        started_at: new Date(),
      };

      const result = await tac.retrieveMemory(session, 'test query');

      // Result is wrapped in TACMemoryResponse
      expect(result).toBeInstanceOf(TACMemoryResponse);
      expect(result.hasMemoryFeatures).toBe(true);
      expect(result.rawData).toEqual(mockMemoryResponse);
      expect(memoryClient!.retrieveMemories).toHaveBeenCalledWith(
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        'mem_profile_existing',
        { query: 'test query' }
      );
    });

    it('should auto-lookup profile when missing', async () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      const mockLookupResponse = {
        normalized_value: '+13175556789',
        profiles: ['mem_profile_00000000000000000000000001'],
      };

      const mockMemoryResponse: MemoryRetrievalResponse = {
        observations: [],
        summaries: [],
        sessions: [],
        communications: [],
        metadata: {
          total_observations: 0,
          total_summaries: 0,
          total_sessions: 0,
          query_timestamp: new Date().toISOString(),
        },
      };

      const memoryClient = tac.getMemoryClient();
      expect(memoryClient).toBeDefined();
      vi.spyOn(memoryClient!, 'lookupProfile').mockResolvedValue(mockLookupResponse);
      vi.spyOn(memoryClient!, 'retrieveMemories').mockResolvedValue(mockMemoryResponse);

      const session: ConversationSession = {
        conversation_id: 'conv_test_123',
        profile_id: undefined,
        channel: 'sms',
        started_at: new Date(),
        author_info: {
          address: '+1 (317) 555-6789',
          participant_id: 'participant_123',
        },
      };

      const result = await tac.retrieveMemory(session, 'test query');

      // Verify profile was looked up
      expect(memoryClient!.lookupProfile).toHaveBeenCalledWith(
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        'phone',
        '+1 (317) 555-6789'
      );

      // Verify profile_id was assigned
      expect(session.profile_id).toBe('mem_profile_00000000000000000000000001');

      // Verify memory was retrieved with the looked up profile_id
      expect(memoryClient!.retrieveMemories).toHaveBeenCalledWith(
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        'mem_profile_00000000000000000000000001',
        { query: 'test query' }
      );

      // Result is wrapped in TACMemoryResponse
      expect(result).toBeInstanceOf(TACMemoryResponse);
      expect(result.rawData).toEqual(mockMemoryResponse);
    });

    it('should use first profile when multiple found', async () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      const mockLookupResponse = {
        normalized_value: '+13175556789',
        profiles: [
          'mem_profile_00000000000000000000000001',
          'mem_profile_00000000000000000000000002',
          'mem_profile_00000000000000000000000003',
        ],
      };

      const mockMemoryResponse: MemoryRetrievalResponse = {
        observations: [],
        summaries: [],
        sessions: [],
        communications: [],
        metadata: {
          total_observations: 0,
          total_summaries: 0,
          total_sessions: 0,
          query_timestamp: new Date().toISOString(),
        },
      };

      const memoryClient = tac.getMemoryClient();
      vi.spyOn(memoryClient!, 'lookupProfile').mockResolvedValue(mockLookupResponse);
      vi.spyOn(memoryClient!, 'retrieveMemories').mockResolvedValue(mockMemoryResponse);

      const session: ConversationSession = {
        conversation_id: 'conv_test_123',
        profile_id: undefined,
        channel: 'sms',
        started_at: new Date(),
        author_info: { address: '+13175556789' },
      };

      await tac.retrieveMemory(session);

      // Verify first profile was used
      expect(session.profile_id).toBe('mem_profile_00000000000000000000000001');
      expect(memoryClient!.retrieveMemories).toHaveBeenCalledWith(
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        'mem_profile_00000000000000000000000001',
        { query: undefined }
      );
    });

    it('should throw error when profile_id and author_info both missing', async () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      const session: ConversationSession = {
        conversation_id: 'conv_test_123',
        profile_id: undefined,
        channel: 'sms',
        started_at: new Date(),
        author_info: undefined,
      };

      await expect(tac.retrieveMemory(session)).rejects.toThrow(
        'profile_id is required for memory retrieval'
      );
    });

    it('should throw error when author_info exists but address is empty', async () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      const session: ConversationSession = {
        conversation_id: 'conv_test_123',
        profile_id: undefined,
        channel: 'sms',
        started_at: new Date(),
        author_info: {
          address: '',
          participant_id: 'participant_123',
        },
      };

      await expect(tac.retrieveMemory(session)).rejects.toThrow(
        'profile_id is required for memory retrieval'
      );
    });

    it('should throw error when profile lookup returns no profiles', async () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      const mockLookupResponse = {
        normalized_value: '+13175556789',
        profiles: [],
      };

      const memoryClient = tac.getMemoryClient();
      vi.spyOn(memoryClient!, 'lookupProfile').mockResolvedValue(mockLookupResponse);

      const session: ConversationSession = {
        conversation_id: 'conv_test_123',
        profile_id: undefined,
        channel: 'sms',
        started_at: new Date(),
        author_info: { address: '+13175556789' },
      };

      await expect(tac.retrieveMemory(session)).rejects.toThrow(
        'No profile found for phone number +13175556789'
      );
    });

    it('should handle profile lookup API errors', async () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      const memoryClient = tac.getMemoryClient();
      vi.spyOn(memoryClient!, 'lookupProfile').mockRejectedValue(
        new Error('Profile lookup API error')
      );

      const session: ConversationSession = {
        conversation_id: 'conv_test_123',
        profile_id: undefined,
        channel: 'sms',
        started_at: new Date(),
        author_info: { address: '+13175556789' },
      };

      await expect(tac.retrieveMemory(session)).rejects.toThrow('Profile lookup API error');
    });
  });

  describe('retrieveMemory() fallback to Conversations Service', () => {
    it('should fallback when memory not configured', async () => {
      const config = new TACConfig(getTestConfigWithoutMemory());
      const tac = new TAC({ config });

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

      const conversationClient = tac.getConversationClient();
      vi.spyOn(conversationClient, 'listCommunications').mockResolvedValue(mockCommunications);

      const session: ConversationSession = {
        conversation_id: 'CH123',
        profile_id: undefined,
        channel: 'sms',
        started_at: new Date(),
      };

      const result = await tac.retrieveMemory(session);

      // Verify fallback was called
      expect(conversationClient.listCommunications).toHaveBeenCalledWith('CH123');

      // Result is wrapped in TACMemoryResponse
      expect(result).toBeInstanceOf(TACMemoryResponse);
      expect(result.hasMemoryFeatures).toBe(false); // Maestro fallback

      // Check response structure - observations and summaries are empty for fallback
      expect(result.observations).toEqual([]);
      expect(result.summaries).toEqual([]);

      // Communications are converted to unified TACCommunication format
      expect(result.communications).toHaveLength(1);
      expect(result.communications[0].id).toBe('comm_123');
    });

    it('should handle empty communications list', async () => {
      const config = new TACConfig(getTestConfigWithoutMemory());
      const tac = new TAC({ config });

      const conversationClient = tac.getConversationClient();
      vi.spyOn(conversationClient, 'listCommunications').mockResolvedValue([]);

      const session: ConversationSession = {
        conversation_id: 'CH123',
        profile_id: undefined,
        channel: 'sms',
        started_at: new Date(),
      };

      const result = await tac.retrieveMemory(session);

      // Result is wrapped in TACMemoryResponse
      expect(result).toBeInstanceOf(TACMemoryResponse);
      expect(result.hasMemoryFeatures).toBe(false);
      expect(result.communications).toEqual([]);
      expect(result.observations).toEqual([]);
      expect(result.summaries).toEqual([]);
    });

    it('should propagate Conversations Service API errors', async () => {
      const config = new TACConfig(getTestConfigWithoutMemory());
      const tac = new TAC({ config });

      const conversationClient = tac.getConversationClient();
      vi.spyOn(conversationClient, 'listCommunications').mockRejectedValue(
        new Error('Conversations Service API Error')
      );

      const session: ConversationSession = {
        conversation_id: 'CH123',
        profile_id: undefined,
        channel: 'sms',
        started_at: new Date(),
      };

      await expect(tac.retrieveMemory(session)).rejects.toThrow('Conversations Service API Error');
    });

    it('should work with multiple communications', async () => {
      const config = new TACConfig(getTestConfigWithoutMemory());
      const tac = new TAC({ config });

      const mockCommunications: Communication[] = Array.from({ length: 5 }, (_, i) => ({
        id: `comm_${i}`,
        conversation_id: 'CH123',
        account_id: 'AC123456',
        author: {
          address: '+12025551234',
          channel: 'SMS' as const,
          participant_id: 'part_123',
        },
        content: {
          type: 'TEXT' as const,
          text: `Message ${i}`,
        },
        recipients: [
          {
            address: '+12025555678',
            channel: 'SMS' as const,
            participant_id: 'part_456',
          },
        ],
        created_at: '2019-08-24T14:15:22Z',
        updated_at: '2019-08-24T14:15:22Z',
      }));

      const conversationClient = tac.getConversationClient();
      vi.spyOn(conversationClient, 'listCommunications').mockResolvedValue(mockCommunications);

      const session: ConversationSession = {
        conversation_id: 'CH123',
        profile_id: undefined,
        channel: 'sms',
        started_at: new Date(),
      };

      const result = await tac.retrieveMemory(session);

      // Result is wrapped in TACMemoryResponse
      expect(result).toBeInstanceOf(TACMemoryResponse);
      expect(result.communications).toHaveLength(5);
      result.communications.forEach((comm, i) => {
        expect(comm.id).toBe(`comm_${i}`);
        expect(comm.content.text).toBe(`Message ${i}`);
      });
    });
  });

  describe('fetchProfile()', () => {
    it('should fetch profile successfully', async () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      const mockProfileResponse: ProfileResponse = {
        id: 'profile_123',
        createdAt: '2024-01-01T00:00:00Z',
        traits: {
          name: 'John Doe',
          email: 'john@example.com',
        },
      };

      const memoryClient = tac.getMemoryClient();
      vi.spyOn(memoryClient!, 'getProfile').mockResolvedValue(mockProfileResponse);

      const result = await tac.fetchProfile('profile_123');

      expect(result).toEqual(mockProfileResponse);
      expect(memoryClient!.getProfile).toHaveBeenCalledWith(
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        'profile_123',
        undefined
      );
    });

    it('should return undefined when memory not configured', async () => {
      const config = new TACConfig(getTestConfigWithoutMemory());
      const tac = new TAC({ config });

      const result = await tac.fetchProfile('profile_123');

      expect(result).toBeUndefined();
    });

    it('should return undefined when profileId is empty', async () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      const result = await tac.fetchProfile('');

      expect(result).toBeUndefined();
    });

    it('should handle API errors gracefully', async () => {
      const config = new TACConfig(getTestConfigWithMemory());
      const tac = new TAC({ config });

      const memoryClient = tac.getMemoryClient();
      vi.spyOn(memoryClient!, 'getProfile').mockRejectedValue(new Error('API error'));

      const result = await tac.fetchProfile('profile_123');

      expect(result).toBeUndefined();
    });
  });

  describe('TACCommunication conversion', () => {
    it('should populate Memory-only fields from Memory communication', () => {
      const memoryCommunications: MemoryCommunication[] = [
        {
          id: 'mem_comm_123',
          author: {
            id: 'author_123',
            name: 'John Doe',
            type: 'CUSTOMER',
            address: '+15551234567',
            channel: 'SMS',
            profile_id: 'profile_456',
          },
          content: { text: 'Hello from Memory' },
          recipients: [
            {
              id: 'recipient_789',
              name: 'AI Agent',
              type: 'AI_AGENT',
              address: '+15559876543',
              channel: 'SMS',
            },
          ],
          channel_id: 'SM123',
          created_at: '2025-01-15T10:15:30Z',
        },
      ];

      const response = new TACMemoryResponse({
        observations: [],
        summaries: [],
        communications: memoryCommunications,
      });

      const comm = response.communications[0];

      // Memory-only fields populated
      expect(comm.author.id).toBe('author_123');
      expect(comm.author.name).toBe('John Doe');
      expect(comm.author.type).toBe('CUSTOMER');
      expect(comm.author.profile_id).toBe('profile_456');

      // Maestro-only fields are undefined
      expect(comm.author.participant_id).toBeUndefined();
      expect(comm.conversation_id).toBeUndefined();
      expect(comm.account_id).toBeUndefined();
      expect(comm.content.type).toBeUndefined();
    });

    it('should populate Maestro-only fields from Maestro communication', () => {
      const response = new TACMemoryResponse([
        {
          id: 'comm_789',
          conversation_id: 'CONV123',
          account_id: 'AC456',
          author: { address: '+15551234567', channel: 'SMS', participant_id: 'part_customer' },
          content: { type: 'TEXT', text: 'Hello from Maestro' },
          recipients: [
            {
              address: '+15559876543',
              channel: 'SMS',
              participant_id: 'part_agent',
              delivery_status: 'DELIVERED',
            },
          ],
          channel_id: 'SM456',
        },
      ]);

      const comm = response.communications[0];

      // Maestro-only fields populated
      expect(comm.conversation_id).toBe('CONV123');
      expect(comm.account_id).toBe('AC456');
      expect(comm.author.participant_id).toBe('part_customer');
      expect(comm.content.type).toBe('TEXT');
      expect(comm.recipients[0].delivery_status).toBe('DELIVERED');

      // Memory-only fields are undefined
      expect(comm.author.id).toBeUndefined();
      expect(comm.author.name).toBeUndefined();
      expect(comm.author.type).toBeUndefined();
      expect(comm.author.profile_id).toBeUndefined();
    });

    it('should parse TRANSCRIPTION content with nested transcription', () => {
      const response = new TACMemoryResponse([
        {
          id: 'comm_voice',
          conversation_id: 'CONV_VOICE',
          account_id: 'AC_VOICE',
          author: { address: '+15551234567', channel: 'VOICE', participant_id: 'part_voice' },
          content: {
            type: 'TRANSCRIPTION',
            text: 'Hello, I need help',
            transcription: {
              channel: 0,
              confidence: 0.95,
              engine: 'google',
              words: [
                {
                  text: 'Hello',
                  startTime: '2025-01-15T12:00:00.100Z',
                  endTime: '2025-01-15T12:00:00.300Z',
                },
                { text: 'I', startTime: '2025-01-15T12:00:00.400Z' },
              ],
            },
          },
          recipients: [{ address: '+15559876543', channel: 'VOICE', participant_id: 'part_agent' }],
        },
      ]);

      const comm = response.communications[0];

      expect(comm.content.type).toBe('TRANSCRIPTION');
      expect(comm.content.transcription?.channel).toBe(0);
      expect(comm.content.transcription?.confidence).toBe(0.95);
      expect(comm.content.transcription?.engine).toBe('google');
      expect(comm.content.transcription?.words).toHaveLength(2);
      expect(comm.content.transcription?.words?.[0].text).toBe('Hello');
      expect(comm.content.transcription?.words?.[0].startTime).toBe('2025-01-15T12:00:00.100Z');
    });
  });
});
