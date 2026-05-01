import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestTAC } from './helpers/tac';
import { TAC, TACConfig, SMSChannel, VoiceChannel } from '@twilio/tac-core';
import { TACServer, TACServerConfig } from '@twilio/tac-server';
import WebSocket from 'ws';

// Mock twilio module - use vi.hoisted since vi.mock is hoisted to top of file
const { mockValidateRequest, mockValidateRequestWithBody } = vi.hoisted(() => ({
  mockValidateRequest: vi.fn(),
  mockValidateRequestWithBody: vi.fn(),
}));

vi.mock('twilio', () => {
  const createClient = vi.fn(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({ sid: 'SM00000000000000000000000000000000' }),
    },
  }));
  // Add validation functions to the default export
  createClient.validateRequest = mockValidateRequest;
  createClient.validateRequestWithBody = mockValidateRequestWithBody;

  return {
    default: createClient,
  };
});

// Use different ports for parallel test execution
let testPort = 4000;
const getNextPort = () => testPort++;

// Helper to create server config for testing
const createServerConfig = (port: number, welcomeGreeting?: string, publicDomain?: string) => {
  return new TACServerConfig({
    host: '0.0.0.0',
    port,
    publicDomain: publicDomain ?? 'localhost',
    messagingWebhookPath: '/webhook',
    twimlPath: '/twiml',
    websocketPath: '/ws',
    conversationRelayCallbackPath: '/conversation-relay-callback',
    welcomeGreeting: welcomeGreeting ?? 'Hello! How can I assist you today?',
  });
};

describe('TACServer Webhook Validation', () => {
  const getTestConfig = () => ({

    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let tac: TAC;
  let server: TACServer;
  let currentPort: number;

  beforeEach(async () => {
    // Reset mock
    mockValidateRequest.mockReset();
    mockValidateRequestWithBody.mockReset();

    // Get unique port for this test
    currentPort = getNextPort();

    // Create TAC instance
    const config = new TACConfig(getTestConfig());
    tac = await createTestTAC(config);

    // Register channels (required for route handlers)
    const smsChannel = new SMSChannel(tac);
    const voiceChannel = new VoiceChannel(tac);
    tac.registerChannel(smsChannel);
    tac.registerChannel(voiceChannel);
  });

  afterEach(async () => {
    if (server) {
      await server.stop().catch(() => {});
    }
    tac.shutdown();
  });

  it('should reject requests with invalid signature', async () => {
    mockValidateRequest.mockReturnValue(false);

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    const response = await fetch(`http://localhost:${currentPort}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': 'invalid-signature',
      },
      body: 'From=%2B15551234567&Body=Hello',
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Invalid webhook signature');
  });

  it('should accept requests with valid signature', async () => {
    mockValidateRequest.mockReturnValue(true);

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    const response = await fetch(`http://localhost:${currentPort}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': 'valid-signature',
      },
      body: 'eventType=COMMUNICATION_CREATED&data=%7B%22conversationId%22%3A%22CH123%22%7D',
    });

    expect(response.status).not.toBe(403);
  });

  it('should call validateRequest with correct parameters', async () => {
    mockValidateRequest.mockReturnValue(true);

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    await fetch(`http://localhost:${currentPort}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': 'test-signature',
      },
      body: 'From=%2B15551234567',
    });

    expect(mockValidateRequest).toHaveBeenCalledWith(
      'test_token_123',
      'test-signature',
      expect.stringContaining('/webhook'),
      expect.objectContaining({ From: '+15551234567' })
    );
  });

  describe('URL construction for validation', () => {
    it('should handle X-Forwarded-Proto header', async () => {
      mockValidateRequest.mockReturnValue(true);

      server = new TACServer({ tac, config: createServerConfig(currentPort) });

      await server.start();

      await fetch(`http://localhost:${currentPort}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'sig',
          'X-Forwarded-Proto': 'https',
        },
        body: 'From=test',
      });

      // Check that URL was constructed with https
      expect(mockValidateRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.stringMatching(/^https:\/\//),
        expect.any(Object)
      );
    });

    it('should handle X-Forwarded-Host header', async () => {
      mockValidateRequest.mockReturnValue(true);

      server = new TACServer({ tac, config: createServerConfig(currentPort) });

      await server.start();

      await fetch(`http://localhost:${currentPort}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'sig',
          'X-Forwarded-Host': 'my-app.ngrok.io',
        },
        body: 'From=test',
      });

      // Check that URL was constructed with forwarded host
      expect(mockValidateRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.stringContaining('my-app.ngrok.io'),
        expect.any(Object)
      );
    });

    it('should use first value from comma-separated X-Forwarded-Proto', async () => {
      mockValidateRequest.mockReturnValue(true);

      server = new TACServer({ tac, config: createServerConfig(currentPort) });

      await server.start();

      await fetch(`http://localhost:${currentPort}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'sig',
          'X-Forwarded-Proto': 'https, http',
        },
        body: 'From=test',
      });

      expect(mockValidateRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.stringMatching(/^https:\/\//),
        expect.any(Object)
      );
    });

    it('should use first value from comma-separated X-Forwarded-Host', async () => {
      mockValidateRequest.mockReturnValue(true);

      server = new TACServer({ tac, config: createServerConfig(currentPort) });

      await server.start();

      await fetch(`http://localhost:${currentPort}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'sig',
          'X-Forwarded-Host': 'app.ngrok.io, proxy.internal',
        },
        body: 'From=test',
      });

      expect(mockValidateRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.stringContaining('app.ngrok.io'),
        expect.any(Object)
      );
      expect(mockValidateRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.not.stringContaining('proxy.internal'),
        expect.any(Object)
      );
    });

    it('should default to https:// when X-Forwarded-Proto is absent', async () => {
      mockValidateRequest.mockReturnValue(true);

      server = new TACServer({ tac, config: createServerConfig(currentPort) });

      await server.start();

      await fetch(`http://localhost:${currentPort}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'sig',
        },
        body: 'From=test',
      });

      expect(mockValidateRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.stringMatching(/^https:\/\//),
        expect.any(Object)
      );
    });
  });

  describe('validation on different endpoints', () => {
    let endpointTestPort: number;

    beforeEach(async () => {
      mockValidateRequest.mockReturnValue(false);
      endpointTestPort = currentPort;

      server = new TACServer({ tac, config: createServerConfig(endpointTestPort) });

      await server.start();
    });

    it('should validate /twiml webhook endpoint', async () => {
      const response = await fetch(`http://localhost:${endpointTestPort}/twiml`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'invalid',
        },
        body: 'From=%2B15551234567&To=%2B15559876543&CallSid=CA123',
      });

      expect(response.status).toBe(403);
    });

    it('should validate /conversation-relay-callback endpoint', async () => {
      const response = await fetch(`http://localhost:${endpointTestPort}/conversation-relay-callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'invalid',
        },
        body: 'AccountSid=AC123&CallSid=CA123&CallStatus=completed&From=%2B1234&To=%2B5678',
      });

      expect(response.status).toBe(403);
    });
  });

  it('should pass raw JSON body to validateRequestWithBody for bodySHA256 validation', async () => {
    mockValidateRequestWithBody.mockReturnValue(true);

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    const jsonBody = '{"key":"value","number":42}';

    await fetch(`http://localhost:${currentPort}/webhook?bodySHA256=abc123`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Twilio-Signature': 'test-sig',
      },
      body: jsonBody,
    });

    expect(mockValidateRequestWithBody).toHaveBeenCalledWith(
      'test_token_123',
      'test-sig',
      expect.stringContaining('/webhook?bodySHA256=abc123'),
      jsonBody
    );
  });
});

describe('TACServer idempotency token', () => {
  const getTestConfig = () => ({

    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let tac: TAC;
  let server: TACServer;
  let smsChannel: SMSChannel;
  let currentPort: number;

  beforeEach(async () => {
    mockValidateRequest.mockReset();
    mockValidateRequestWithBody.mockReset();
    mockValidateRequest.mockReturnValue(true);

    currentPort = getNextPort();

    const config = new TACConfig(getTestConfig());
    tac = await createTestTAC(config);

    smsChannel = new SMSChannel(tac);
    const voiceChannel = new VoiceChannel(tac);
    tac.registerChannel(smsChannel);
    tac.registerChannel(voiceChannel);
  });

  afterEach(async () => {
    if (server) {
      await server.stop().catch(() => {});
    }
    tac.shutdown();
  });

  it('should pass i-twilio-idempotency-token header to channels', async () => {
    const processWebhookSpy = vi.spyOn(smsChannel, 'processWebhook');

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    await fetch(`http://localhost:${currentPort}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'i-twilio-idempotency-token': 'tok-abc-123',
      },
      body: JSON.stringify({
        eventType: 'COMMUNICATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      }),
    });

    await vi.waitFor(() => {
      expect(processWebhookSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'COMMUNICATION_CREATED' }),
        'tok-abc-123'
      );
    });
  });

  it('should pass undefined when no idempotency token header is present', async () => {
    const processWebhookSpy = vi.spyOn(smsChannel, 'processWebhook');

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    await fetch(`http://localhost:${currentPort}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventType: 'COMMUNICATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      }),
    });

    await vi.waitFor(() => {
      expect(processWebhookSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'COMMUNICATION_CREATED' }),
        undefined
      );
    });
  });
});

describe('TACServer welcomeGreeting', () => {
  const getTestConfig = () => ({

    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let tac: TAC;
  let server: TACServer;
  let voiceChannel: VoiceChannel;
  let currentPort: number;

  beforeEach(async () => {
    mockValidateRequest.mockReset();
    mockValidateRequestWithBody.mockReset();
    mockValidateRequest.mockReturnValue(true);

    currentPort = getNextPort();

    const config = new TACConfig(getTestConfig());
    tac = await createTestTAC(config);

    const smsChannel = new SMSChannel(tac);
    voiceChannel = new VoiceChannel(tac);
    tac.registerChannel(smsChannel);
    tac.registerChannel(voiceChannel);
  });

  afterEach(async () => {
    if (server) {
      await server.stop().catch(() => {});
    }
    tac.shutdown();
  });

  it('should use default welcomeGreeting', async () => {
    const handleIncomingCallSpy = vi.spyOn(voiceChannel, 'handleIncomingCall');
    handleIncomingCallSpy.mockResolvedValue('<Response><Connect><ConversationRelay/></Connect></Response>');

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    await fetch(`http://localhost:${currentPort}/twiml`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'From=%2B15551234567&To=%2B15559876543&CallSid=CA123',
    });

    expect(handleIncomingCallSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationRelayConfig: expect.objectContaining({
          url: expect.stringMatching(/^wss?:\/\//),
          welcomeGreeting: 'Hello! How can I assist you today?',
        }),
      })
    );
  });

  it('should use custom welcomeGreeting from config', async () => {
    const handleIncomingCallSpy = vi.spyOn(voiceChannel, 'handleIncomingCall');
    handleIncomingCallSpy.mockResolvedValue('<Response><Connect><ConversationRelay/></Connect></Response>');

    server = new TACServer({ tac, config: createServerConfig(currentPort, 'Custom greeting!') });

    await server.start();

    await fetch(`http://localhost:${currentPort}/twiml`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'From=%2B15551234567&To=%2B15559876543&CallSid=CA123',
    });

    expect(handleIncomingCallSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationRelayConfig: expect.objectContaining({
          welcomeGreeting: 'Custom greeting!',
        }),
      })
    );
  });

  it('should always use wss:// protocol when publicDomain is set', async () => {
    const handleIncomingCallSpy = vi.spyOn(voiceChannel, 'handleIncomingCall');
    handleIncomingCallSpy.mockResolvedValue('<Response><Connect><ConversationRelay/></Connect></Response>');

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    await fetch(`http://localhost:${currentPort}/twiml`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'From=%2B15551234567&To=%2B15559876543&CallSid=CA123',
    });

    expect(handleIncomingCallSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationRelayConfig: expect.objectContaining({
          url: expect.stringMatching(/^wss:\/\//),
        }),
      })
    );
  });

  it('should warn and generate malformed URL when publicDomain is not set', async () => {
    const handleIncomingCallSpy = vi.spyOn(voiceChannel, 'handleIncomingCall');
    handleIncomingCallSpy.mockResolvedValue('<Response><Connect><ConversationRelay/></Connect></Response>');

    // Create server with empty publicDomain
    server = new TACServer({ tac, config: createServerConfig(currentPort, undefined, '') });

    await server.start();

    await fetch(`http://localhost:${currentPort}/twiml`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'From=%2B15551234567&To=%2B15559876543&CallSid=CA123',
    });

    // Should generate malformed URL (matches Python behavior)
    expect(handleIncomingCallSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationRelayConfig: expect.objectContaining({
          url: 'wss:///ws',
        }),
        actionUrl: 'https:///conversation-relay-callback',
      })
    );
  });
});

describe('TACServer customization', () => {
  const getTestConfig = () => ({
    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let tac: TAC;
  let server: TACServer;
  let currentPort: number;

  beforeEach(async () => {
    mockValidateRequest.mockReset();
    mockValidateRequestWithBody.mockReset();
    mockValidateRequest.mockReturnValue(true);
    mockValidateRequestWithBody.mockReturnValue(true);

    currentPort = getNextPort();

    const config = new TACConfig(getTestConfig());
    tac = await createTestTAC(config);

    const smsChannel = new SMSChannel(tac);
    const voiceChannel = new VoiceChannel(tac);
    tac.registerChannel(smsChannel);
    tac.registerChannel(voiceChannel);
  });

  afterEach(async () => {
    if (server) {
      await server.stop().catch(() => {});
    }
    tac.shutdown();
  });

  it('uses the provided Fastify instance', async () => {
    const Fastify = (await import('fastify')).default;
    const customApp = Fastify({ logger: false });

    server = new TACServer({ tac, config: createServerConfig(currentPort), app: customApp });

    expect(server.fastify).toBe(customApp);
  });

  it('mounts TAC endpoints and user routes on a provided Fastify instance', async () => {
    const Fastify = (await import('fastify')).default;
    const customApp = Fastify({ logger: false });

    // User registers their own route + hook before TAC start()
    customApp.get('/health', async () => ({ status: 'ok' }));
    customApp.addHook('onSend', async (_req, reply, payload) => {
      reply.header('x-user-hook', 'yes');
      return payload;
    });

    server = new TACServer({ tac, config: createServerConfig(currentPort), app: customApp });

    await server.start();

    // User route is reachable
    const health = await fetch(`http://localhost:${currentPort}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });

    // User hook also fires on TAC's own routes
    const twiml = await fetch(`http://localhost:${currentPort}/twiml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'From=%2B15551234567&To=%2B15559876543&CallSid=CA123',
    });
    expect(twiml.status).not.toBe(404); // TAC /twiml is mounted
    expect(twiml.headers.get('x-user-hook')).toBe('yes');

    // User hook also fires on the /webhook (messaging) route
    const sms = await fetch(`http://localhost:${currentPort}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'From=%2B15551234567&Body=hi',
    });
    expect(sms.status).not.toBe(404); // TAC /webhook is mounted
    expect(sms.headers.get('x-user-hook')).toBe('yes');
  });

  it('does not crash when user pre-registers plugins TAC also needs', async () => {
    const Fastify = (await import('fastify')).default;
    const formbody = (await import('@fastify/formbody')).default;
    const websocket = (await import('@fastify/websocket')).default;

    const customApp = Fastify({ logger: false });
    // Simulate a user who registers formbody + websocket themselves for their
    // own routes. start() should detect and skip duplicate registration.
    await customApp.register(formbody);
    await customApp.register(websocket);

    server = new TACServer({ tac, config: createServerConfig(currentPort), app: customApp });

    // Must not throw
    await server.start();

    // TAC's form-body-parsed routes still work
    const resp = await fetch(`http://localhost:${currentPort}/twiml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'From=%2B15551234567&To=%2B15559876543&CallSid=CA123',
    });
    expect(resp.status).not.toBe(404);
  });

  it('creates a default Fastify instance when none is provided', () => {
    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    expect(server.fastify).toBeDefined();
    expect(typeof server.fastify.listen).toBe('function');
  });

  it('exposes the same Fastify instance before and after start()', async () => {
    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    const before = server.fastify;
    await server.start();
    const after = server.fastify;

    expect(after).toBe(before);
  });

  it('allows adding a custom route to server.fastify after construction', async () => {
    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    server.fastify.get('/health', async () => ({ status: 'ok' }));

    await server.start();

    const resp = await fetch(`http://localhost:${currentPort}/health`);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ status: 'ok' });
  });

  it('allows adding a hook to server.fastify after construction', async () => {
    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    server.fastify.addHook('onSend', async (_request, reply, payload) => {
      reply.header('x-test', 'yes');
      return payload;
    });

    server.fastify.get('/ping', async () => ({ ok: true }));

    await server.start();

    const resp = await fetch(`http://localhost:${currentPort}/ping`);
    expect(resp.headers.get('x-test')).toBe('yes');
  });

  it('allows adding a custom error handler on server.fastify', async () => {
    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    class MyError extends Error {}

    server.fastify.setErrorHandler(async (error, _request, reply) => {
      if (error instanceof MyError) {
        await reply.code(418).send({ handled: true });
        return;
      }
      throw error;
    });

    server.fastify.get('/boom', async () => {
      throw new MyError('kapow');
    });

    await server.start();

    const resp = await fetch(`http://localhost:${currentPort}/boom`);
    expect(resp.status).toBe(418);
    expect(await resp.json()).toEqual({ handled: true });
  });
});

describe('TACServer WebSocket signature validation', () => {
  const getTestConfig = () => ({
    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let tac: TAC;
  let server: TACServer;
  let currentPort: number;

  beforeEach(async () => {
    mockValidateRequest.mockReset();
    mockValidateRequestWithBody.mockReset();

    currentPort = getNextPort();

    const config = new TACConfig(getTestConfig());
    tac = await createTestTAC(config);

    const smsChannel = new SMSChannel(tac);
    const voiceChannel = new VoiceChannel(tac);
    tac.registerChannel(smsChannel);
    tac.registerChannel(voiceChannel);
  });

  afterEach(async () => {
    if (server) {
      await server.stop().catch(() => {});
    }
    tac.shutdown();
  });

  it('should reject WebSocket without X-Twilio-Signature', async () => {
    mockValidateRequest.mockReturnValue(false);

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    const ws = new WebSocket(`ws://localhost:${currentPort}/ws`);

    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.on('close', (code: number) => resolve(code));
      ws.on('error', (err: Error) => reject(err));
    });

    expect(closeCode).toBe(1008);
  });

  it('should reject WebSocket with invalid Twilio signature', async () => {
    mockValidateRequest.mockReturnValue(false);

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    const ws = new WebSocket(`ws://localhost:${currentPort}/ws`, {
      headers: { 'X-Twilio-Signature': 'invalid-signature' },
    });

    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.on('close', (code: number) => resolve(code));
      ws.on('error', (err: Error) => reject(err));
    });

    expect(closeCode).toBe(1008);
  });

  it('should accept WebSocket with valid Twilio signature', async () => {
    mockValidateRequest.mockReturnValue(true);

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    const ws = new WebSocket(`ws://localhost:${currentPort}/ws`, {
      headers: { 'X-Twilio-Signature': 'valid-signature' },
    });

    const opened = await new Promise<boolean>(resolve => {
      ws.on('open', () => resolve(true));
      ws.on('close', () => resolve(false));
      ws.on('error', () => resolve(false));
    });

    expect(opened).toBe(true);
    ws.close();
  });

  it('should call validateRequest with correct params for WebSocket upgrade', async () => {
    mockValidateRequest.mockReturnValue(true);

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    const ws = new WebSocket(`ws://localhost:${currentPort}/ws`, {
      headers: { 'X-Twilio-Signature': 'test-ws-sig' },
    });

    await new Promise<void>(resolve => {
      ws.on('open', () => resolve());
      ws.on('error', () => resolve());
    });

    expect(mockValidateRequest).toHaveBeenCalledWith(
      'test_token_123',
      'test-ws-sig',
      expect.stringMatching(/^wss?:\/\/.*\/ws$/),
      {}
    );

    ws.close();
  });

  it('should extract query params from WebSocket URL for signature validation', async () => {
    mockValidateRequest.mockReturnValue(true);

    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    const ws = new WebSocket(
      `ws://localhost:${currentPort}/ws?AccountSid=AC123&CallSid=CA456`,
      {
        headers: { 'X-Twilio-Signature': 'test-ws-sig' },
      }
    );

    await new Promise<void>(resolve => {
      ws.on('open', () => resolve());
      ws.on('error', () => resolve());
    });

    expect(mockValidateRequest).toHaveBeenCalledWith(
      'test_token_123',
      'test-ws-sig',
      expect.stringMatching(/^wss?:\/\/.*\/ws$/),
      { AccountSid: 'AC123', CallSid: 'CA456' }
    );

    ws.close();
  });

  it('should reject WebSocket when host header is missing', async () => {
    server = new TACServer({ tac, config: createServerConfig(currentPort) });

    await server.start();

    const ws = new WebSocket(`ws://localhost:${currentPort}/ws`, {
      headers: {
        'X-Twilio-Signature': 'test-sig',
        Host: '',
      },
    });

    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.on('close', (code: number) => resolve(code));
      ws.on('error', (err: Error) => reject(err));
    });

    expect(closeCode).toBe(1008);
  });
});
