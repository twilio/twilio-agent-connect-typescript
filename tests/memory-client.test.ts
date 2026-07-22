import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TACConfig } from '@twilio/tac-core';
import { MemoryClient } from '../packages/core/src/clients/memory';
import { ProfileLookupResponse, ProfileResponse } from '@twilio/tac-core';
import MockAdapter from 'axios-mock-adapter';

describe('MemoryClient', () => {
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
    mockAdapter.restore();
  });

  describe('lookupProfile()', () => {
    it('should lookup profile successfully', async () => {
      const mockResponse: ProfileLookupResponse = {
        normalizedValue: '+13175556789',
        profiles: ['mem_profile_00000000000000000000000001'],
      };

      mockAdapter
        .onPost('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/Lookup')
        .reply(200, mockResponse);

      const result = await memoryClient.lookupProfile(
        'phone',
        '+1 (317) 555-6789'
      );

      expect(result).toEqual(mockResponse);
    });

    it('should handle API errors', async () => {
      mockAdapter
        .onPost('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/Lookup')
        .reply(500);

      await expect(
        memoryClient.lookupProfile('phone', '+1234567890')
      ).rejects.toThrow(/Failed to lookup profile/);
    });
  });

  describe('getProfile()', () => {
    it('should fetch profile successfully', async () => {
      const mockResponse: ProfileResponse = {
        id: 'mem_profile_00000000000000000000000001',
        createdAt: '2024-01-01T00:00:00Z',
        traits: {},
      };

      mockAdapter
        .onGet('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/mem_profile_00000000000000000000000001')
        .reply(200, mockResponse);

      const result = await memoryClient.getProfile(
        'mem_profile_00000000000000000000000001'
      );

      expect(result).toEqual(mockResponse);
    });

    it('should work with traitGroups', async () => {
      const mockResponse: ProfileResponse = {
        id: 'mem_profile_00000000000000000000000001',
        createdAt: '2024-01-01T00:00:00Z',
        traits: { group1: { key: 'value' } },
      };

      mockAdapter
        .onGet(
          '/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/mem_profile_00000000000000000000000001',
          { params: { traitGroups: 'group1' } }
        )
        .reply(200, mockResponse);

      const result = await memoryClient.getProfile(
        'mem_profile_00000000000000000000000001',
        ['group1']
      );

      expect(result).toEqual(mockResponse);
    });

    it('should handle API errors', async () => {
      mockAdapter
        .onGet('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/mem_profile_00000000000000000000000001')
        .reply(404);

      await expect(
        memoryClient.getProfile('mem_profile_00000000000000000000000001')
      ).rejects.toThrow(/Failed to get profile/);
    });
  });

  describe('createProfile()', () => {
    it('should POST traits to /Profiles and return the id', async () => {
      mockAdapter
        .onPost('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles')
        .reply(202, { id: 'mem_profile_00000000000000000000000001' });

      const result = await memoryClient.createProfile({
        Contact: { phone: '+13175551234' },
      });

      expect(result).toBe('mem_profile_00000000000000000000000001');

      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body).toEqual({
        traits: { Contact: { phone: '+13175551234' } },
      });
    });

    it('should throw when response body has no id field', async () => {
      mockAdapter
        .onPost('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles')
        .reply(202, { foo: 'bar' });

      await expect(
        memoryClient.createProfile({ Contact: { phone: '+13175551234' } })
      ).rejects.toThrow(/CreateProfile response missing 'id' field/);
    });

    it('should surface HTTP errors', async () => {
      mockAdapter
        .onPost('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles')
        .reply(500);

      await expect(
        memoryClient.createProfile({ Contact: { phone: '+13175551234' } })
      ).rejects.toThrow(/Failed to create profile/);
    });
  });

  describe('retrieveMemories()', () => {
    const recallUrl =
      '/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/mem_profile_00000000000000000000000001/Recall';

    const makeCommunication = (id: string, authorType: string) => ({
      id,
      author: {
        id: `participant_${id}`,
        name: 'Participant',
        address: 'someone@example.com',
        channel: 'EMAIL',
        type: authorType,
      },
      content: { text: `content ${id}` },
      recipients: [],
      createdAt: '2024-01-01T00:00:00Z',
    });

    it('should parse a communication whose participant type is UNKNOWN', async () => {
      const mockResponse = {
        observations: [],
        summaries: [],
        communications: [makeCommunication('comm_1', 'UNKNOWN')],
      };

      mockAdapter.onPost(recallUrl).reply(200, mockResponse);

      const result = await memoryClient.retrieveMemories(
        'mem_profile_00000000000000000000000001'
      );

      expect(result.communications).toHaveLength(1);
      expect(result.communications[0]!.author.type).toBe('UNKNOWN');
    });

    it('should return valid items when some items fail validation', async () => {
      const mockResponse = {
        observations: [
          {
            id: 'obs_valid',
            content: 'valid observation',
            createdAt: '2024-01-01T00:00:00Z',
          },
          { id: 'obs_invalid', createdAt: 'not-a-date' },
        ],
        summaries: [],
        communications: [
          makeCommunication('comm_valid', 'CUSTOMER'),
          { id: 'comm_invalid', author: null },
        ],
      };

      mockAdapter.onPost(recallUrl).reply(200, mockResponse);

      const result = await memoryClient.retrieveMemories(
        'mem_profile_00000000000000000000000001'
      );

      expect(result.observations).toHaveLength(1);
      expect(result.observations[0]!.id).toBe('obs_valid');
      expect(result.communications).toHaveLength(1);
      expect(result.communications[0]!.id).toBe('comm_valid');
    });

    it('should warn when a present field is not an array', async () => {
      const warnSpy = vi.spyOn((memoryClient as any).logger, 'warn');
      const mockResponse = {
        observations: { unexpected: 'shape' },
        summaries: [],
        communications: [],
      };

      mockAdapter.onPost(recallUrl).reply(200, mockResponse);

      const result = await memoryClient.retrieveMemories(
        'mem_profile_00000000000000000000000001'
      );

      expect(result.observations).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          item_type: 'observation',
          received_type: 'object',
        }),
        expect.stringContaining('non-array value')
      );
    });

    it('should cap per-item warnings and emit an invalid_count summary', async () => {
      const warnSpy = vi.spyOn((memoryClient as any).logger, 'warn');
      const invalidObservations = Array.from({ length: 15 }, (_, i) => ({
        id: `obs_${i}`,
        createdAt: 'not-a-date',
      }));
      const mockResponse = {
        observations: invalidObservations,
        summaries: [],
        communications: [],
      };

      mockAdapter.onPost(recallUrl).reply(200, mockResponse);

      const result = await memoryClient.retrieveMemories(
        'mem_profile_00000000000000000000000001'
      );

      expect(result.observations).toHaveLength(0);

      const perItemWarnings = warnSpy.mock.calls.filter(
        ([, msg]) => msg === 'Dropping invalid memory item'
      );
      expect(perItemWarnings).toHaveLength(10);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          item_type: 'observation',
          invalid_count: 15,
          total_count: 15,
        }),
        'Dropped invalid memory items'
      );
    });
  });

  describe('region support', () => {
    it('should use region in base URL when configured', () => {
      const config = new TACConfig({ ...getTestConfig(), region: 'test-region' });
      const regionClient = new MemoryClient(config, 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg');

      expect((regionClient as any).baseUrl).toBe('https://memory.test-region.twilio.com');
    });

    it('should use default base URL when region is not configured', () => {
      expect((memoryClient as any).baseUrl).toBe('https://memory.twilio.com');
    });
  });
});
