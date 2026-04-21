/**
 * BaseClient Tests
 *
 * Tests core HTTP client functionality including timeout and error handling.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TACConfig } from '../packages/core/src/lib/config';
import { KnowledgeClient } from '../packages/core/src/clients/knowledge';
import MockAdapter from 'axios-mock-adapter';

describe('BaseClient', () => {
  let mockAdapter: MockAdapter;
  let client: KnowledgeClient;

  beforeEach(() => {
    const config = new TACConfig({
      accountSid: 'ACtest',
      authToken: 'test_auth_token',
      phoneNumber: '+15555555555',
      apiKey: 'SKtest',
      apiSecret: 'test_token',
      conversationConfigurationId: 'conv_configuration_00000000000000000000000000',
      knowledgeApiUrl: 'https://knowledge.twilio.com',
      memoryApiUrl: 'https://memory.twilio.com',
      conversationsApiUrl: 'https://conversations.twilio.com',
    });

    client = new KnowledgeClient(config);
    mockAdapter = new MockAdapter((client as any).axiosInstance);
  });

  afterEach(() => {
    mockAdapter.restore();
  });

  it('should configure 30 second timeout', () => {
    expect((client as any).axiosInstance.defaults.timeout).toBe(30000);
  });

  it('should make successful requests', async () => {
    mockAdapter.onGet('/test').reply(200, { test: 'response' });

    const response = await (client as any).makeRequest('/test', 'GET');
    expect(response).toEqual({ test: 'response' });
  });

  describe('retry logic', () => {
    it('should retry on 500 errors for GET', async () => {
      let attemptCount = 0;
      mockAdapter.onGet('/retry-500').reply(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return [500, { error: 'Server Error' }];
        }
        return [200, { success: true }];
      });

      const response = await (client as any).makeRequest('/retry-500', 'GET');
      expect(response).toEqual({ success: true });
      expect(attemptCount).toBe(3);
    });

    it('should retry on 503 errors for GET', async () => {
      let attemptCount = 0;
      mockAdapter.onGet('/retry-503').reply(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return [503, { error: 'Service Unavailable' }];
        }
        return [200, { success: true }];
      });

      const response = await (client as any).makeRequest('/retry-503', 'GET');
      expect(response).toEqual({ success: true });
      expect(attemptCount).toBe(3);
    });

    it('should NOT retry on 4xx errors', async () => {
      let attemptCount = 0;
      mockAdapter.onGet('/no-retry-404').reply(() => {
        attemptCount++;
        return [404, { error: 'Not Found' }];
      });

      await expect((client as any).makeRequest('/no-retry-404', 'GET')).rejects.toThrow();
      expect(attemptCount).toBe(1); // Should only try once
    });

    it('should fail after max retries on GET with 500', async () => {
      let attemptCount = 0;
      mockAdapter.onGet('/retry-fail').reply(() => {
        attemptCount++;
        return [500, { error: 'Server Error' }];
      });

      await expect((client as any).makeRequest('/retry-fail', 'GET')).rejects.toThrow();
      expect(attemptCount).toBe(4); // Initial attempt + 3 retries
    });

    it('should NOT retry POST on 5xx errors to prevent duplicate side effects', async () => {
      let attemptCount = 0;
      mockAdapter.onPost('/no-retry-post').reply(() => {
        attemptCount++;
        return [500, { error: 'Server Error' }];
      });

      await expect((client as any).makeRequest('/no-retry-post', 'POST', { data: 'test' })).rejects.toThrow();
      expect(attemptCount).toBe(1); // Should only try once for POST with 5xx
    });
  });
});
