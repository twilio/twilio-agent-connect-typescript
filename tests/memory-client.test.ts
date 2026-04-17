import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TACConfig } from '@twilio/tac-core';
import { MemoryClient } from '../packages/core/src/clients/memory';
import { ProfileLookupResponse, ProfileResponse } from '@twilio/tac-core';
import MockAdapter from 'axios-mock-adapter';

describe('MemoryClient', () => {
  const getTestConfig = () => ({

    twilioAccountSid: 'ACtest123',
    twilioAuthToken: 'test_token_123',
    twilioApiKey: 'test_api_key',
    twilioApiToken: 'test_api_token',
    twilioPhoneNumber: '+15551234567',
    memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
    conversationServiceId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let memoryClient: MemoryClient;
  let mockAdapter: MockAdapter;

  beforeEach(() => {
    const config = new TACConfig(getTestConfig());
    memoryClient = new MemoryClient(config);
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
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
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
        memoryClient.lookupProfile('mem_service_01kbjqhhdpft0tbp21jt4ktbxg', 'phone', '+1234567890')
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
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
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
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
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
        memoryClient.getProfile('mem_service_01kbjqhhdpft0tbp21jt4ktbxg', 'mem_profile_00000000000000000000000001')
      ).rejects.toThrow(/Failed to get profile/);
    });
  });
});
