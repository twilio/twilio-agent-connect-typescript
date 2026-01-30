import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TACConfig } from '@twilio/tac-core';
import { MemoryClient } from '../packages/core/src/clients/memory';
import { ProfileLookupResponse, ProfileResponse } from '@twilio/tac-core';

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

describe('MemoryClient', () => {
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

  let memoryClient: MemoryClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    const config = new TACConfig(getTestConfig());
    memoryClient = new MemoryClient(config);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('lookupProfile()', () => {
    it('should lookup profile successfully', async () => {
      const mockResponse: ProfileLookupResponse = {
        normalizedValue: '+13175556789',
        profiles: ['mem_profile_00000000000000000000000001'],
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true }));

      const result = await memoryClient.lookupProfile(
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        'phone',
        '+1 (317) 555-6789'
      );

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/Lookup'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: expect.stringContaining('Basic'),
          }),
          body: JSON.stringify({
            idType: 'phone',
            value: '+1 (317) 555-6789',
          }),
        })
      );
    });

    it('should handle API errors', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(createMockResponse(null, { ok: false, status: 404, statusText: 'Not Found' }));

      await expect(
        memoryClient.lookupProfile(
          'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
          'phone',
          '+13175556789'
        )
      ).rejects.toThrow('Failed to lookup profile: 404 Not Found');
    });
  });

  describe('getProfile()', () => {
    it('should fetch profile successfully', async () => {
      const mockResponse: ProfileResponse = {
        id: 'profile_123',
        createdAt: '2024-01-01T00:00:00Z',
        traits: {
          name: 'John Doe',
          email: 'john@example.com',
        },
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true }));

      const result = await memoryClient.getProfile(
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        'profile_123'
      );

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/Stores/mem_service_01kbjqhhdpft0tbp21jt4ktbxg/Profiles/profile_123'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
          }),
        })
      );
    });

    it('should work with traitGroups', async () => {
      const mockResponse: ProfileResponse = {
        id: 'profile_123',
        createdAt: '2024-01-01T00:00:00Z',
        traits: {
          name: 'John Doe',
        },
      };

      global.fetch = vi.fn().mockResolvedValue(createMockResponse(mockResponse, { ok: true }));

      const result = await memoryClient.getProfile(
        'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        'profile_123',
        ['basic_info', 'preferences']
      );

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('?traitGroups=basic_info,preferences'),
        expect.any(Object)
      );
    });

    it('should handle API errors', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(null, { ok: false, status: 500, statusText: 'Internal Server Error' })
        );

      await expect(
        memoryClient.getProfile('mem_service_01kbjqhhdpft0tbp21jt4ktbxg', 'profile_123')
      ).rejects.toThrow('Failed to get profile: 500 Internal Server Error');
    });
  });
});
