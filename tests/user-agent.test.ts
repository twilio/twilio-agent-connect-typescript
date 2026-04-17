/**
 * User-Agent Header Tests
 *
 * Verifies that all API clients (Memory, Conversation, Knowledge) automatically
 * include a properly formatted User-Agent header in all HTTP requests.
 *
 * Expected format: twilio-agent-connect-typescript/{version}
 * Example: twilio-agent-connect-typescript/1.0.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TACConfig } from '../packages/core/src/lib/config';
import { KnowledgeClient } from '../packages/core/src/clients/knowledge';
import { MemoryClient } from '../packages/core/src/clients/memory';
import { ConversationClient } from '../packages/core/src/clients/conversation';
import MockAdapter from 'axios-mock-adapter';
import packageJson from '../package.json' with { type: 'json' };

describe('User-Agent Header', () => {
  let config: TACConfig;
  let mockAdapter: MockAdapter | undefined;

  beforeEach(() => {
    config = new TACConfig({
      twilioAccountSid: 'ACtest',
      twilioAuthToken: 'test_auth_token',
      twilioPhoneNumber: '+15555555555',
      twilioApiKey: 'SKtest',
      twilioApiToken: 'test_token',
      conversationServiceId: 'conv_configuration_00000000000000000000000000',
      knowledgeApiUrl: 'https://knowledge.twilio.com',
      memoryApiUrl: 'https://memory.twilio.com',
      conversationsApiUrl: 'https://conversations.twilio.com',
    });
  });

  afterEach(() => {
    if (mockAdapter) {
      mockAdapter.restore();
      mockAdapter = undefined;
    }
  });

  it('should include User-Agent header in KnowledgeClient requests', async () => {
    const client = new KnowledgeClient(config);
    mockAdapter = new MockAdapter((client as any).axiosInstance);

    let capturedHeaders: any;
    mockAdapter.onGet('/test').reply(config => {
      capturedHeaders = config.headers;
      return [200, { test: 'response' }];
    });

    await (client as any).makeRequest('/test', 'GET');

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders['User-Agent']).toBeDefined();

    const userAgent = capturedHeaders['User-Agent'] as string;
    expect(userAgent).toMatch(/^twilio-agent-connect-typescript\/\d+\.\d+\.\d+$/);
  });

  it('should include User-Agent header in MemoryClient requests', async () => {
    const client = new MemoryClient(config);
    mockAdapter = new MockAdapter((client as any).axiosInstance);

    let capturedHeaders: any;
    mockAdapter.onGet('/test').reply(config => {
      capturedHeaders = config.headers;
      return [200, { test: 'response' }];
    });

    await (client as any).makeRequest('/test', 'GET');

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders['User-Agent']).toBeDefined();

    const userAgent = capturedHeaders['User-Agent'] as string;
    expect(userAgent).toMatch(/^twilio-agent-connect-typescript\/\d+\.\d+\.\d+$/);
  });

  it('should include User-Agent header in ConversationClient requests', async () => {
    const client = new ConversationClient(config);
    mockAdapter = new MockAdapter((client as any).axiosInstance);

    let capturedHeaders: any;
    mockAdapter.onGet('/test').reply(config => {
      capturedHeaders = config.headers;
      return [200, { test: 'response' }];
    });

    await (client as any).makeRequest('/test', 'GET');

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders['User-Agent']).toBeDefined();

    const userAgent = capturedHeaders['User-Agent'] as string;
    expect(userAgent).toMatch(/^twilio-agent-connect-typescript\/\d+\.\d+\.\d+$/);
  });

  it('should format User-Agent correctly', async () => {
    const client = new KnowledgeClient(config);
    const userAgent = (client as any).axiosInstance.defaults.headers['User-Agent'] as string;

    // Format: twilio-agent-connect-typescript/{version}
    expect(userAgent).toMatch(/^twilio-agent-connect-typescript\/\d+\.\d+\.\d+$/);

    // Example: twilio-agent-connect-typescript/1.0.0
    expect(userAgent).toBe(`twilio-agent-connect-typescript/${packageJson.version}`);
  });
});
