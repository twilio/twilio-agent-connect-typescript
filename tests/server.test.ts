import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TAC, TACConfig, SMSChannel, VoiceChannel } from '@twilio/tac-core';
import { TACServer } from '@twilio/tac-server';

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

describe('TACServer Webhook Validation', () => {
  const getTestConfig = () => ({
    environment: 'dev' as const,
    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let tac: TAC;
  let server: TACServer;
  let currentPort: number;

  beforeEach(() => {
    // Reset mock
    mockValidateRequest.mockReset();
    mockValidateRequestWithBody.mockReset();

    // Get unique port for this test
    currentPort = getNextPort();

    // Create TAC instance
    const config = new TACConfig(getTestConfig());
    tac = new TAC({ config });

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

  describe('with validation enabled (default)', () => {
    it('should reject requests with invalid signature', async () => {
      // Mock invalid signature
      mockValidateRequest.mockReturnValue(false);

      server = new TACServer(tac, {
        development: true,
        validateWebhooks: true,
        voice: { port: currentPort },
      });

      await server.start();

      // Make request to SMS endpoint
      const response = await fetch(`http://localhost:${currentPort}/sms`, {
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
      // Mock valid signature
      mockValidateRequest.mockReturnValue(true);

      server = new TACServer(tac, {
        development: true,
        validateWebhooks: true,
        voice: { port: currentPort },
      });

      await server.start();

      // Make request to SMS endpoint with valid webhook payload
      const response = await fetch(`http://localhost:${currentPort}/sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'valid-signature',
        },
        body: 'eventType=COMMUNICATION_CREATED&data=%7B%22conversationId%22%3A%22CH123%22%7D',
      });

      // Should not be 403 (may be 200 or 500 depending on further processing)
      expect(response.status).not.toBe(403);
    });

    it('should call validateRequest with correct parameters', async () => {
      mockValidateRequest.mockReturnValue(true);

      server = new TACServer(tac, {
        development: true,
        validateWebhooks: true,
        voice: { port: currentPort },
      });

      await server.start();

      await fetch(`http://localhost:${currentPort}/sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'test-signature',
        },
        body: 'From=%2B15551234567',
      });

      expect(mockValidateRequest).toHaveBeenCalledWith(
        'test_token_123', // Auth token
        'test-signature', // Signature header
        expect.stringContaining('/sms'), // URL
        expect.objectContaining({ From: '+15551234567' }) // Parsed body params
      );
    });
  });

  describe('with validation disabled', () => {
    it('should skip validation when validateWebhooks is false', async () => {
      mockValidateRequest.mockReturnValue(false); // Would fail if called

      server = new TACServer(tac, {
        development: true,
        validateWebhooks: false,
        voice: { port: currentPort },
      });

      await server.start();

      // Make request without valid signature
      const response = await fetch(`http://localhost:${currentPort}/sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'eventType=COMMUNICATION_CREATED&data=%7B%22conversationId%22%3A%22CH123%22%7D',
      });

      // Should not be 403 since validation is disabled
      expect(response.status).not.toBe(403);
      // validateRequest should not be called
      expect(mockValidateRequest).not.toHaveBeenCalled();
    });
  });

  describe('URL construction for validation', () => {
    it('should handle X-Forwarded-Proto header', async () => {
      mockValidateRequest.mockReturnValue(true);

      server = new TACServer(tac, {
        development: true,
        validateWebhooks: true,
        voice: { port: currentPort },
      });

      await server.start();

      await fetch(`http://localhost:${currentPort}/sms`, {
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

      server = new TACServer(tac, {
        development: true,
        validateWebhooks: true,
        voice: { port: currentPort },
      });

      await server.start();

      await fetch(`http://localhost:${currentPort}/sms`, {
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
  });

  describe('validation on different endpoints', () => {
    let endpointTestPort: number;

    beforeEach(async () => {
      mockValidateRequest.mockReturnValue(false);
      endpointTestPort = currentPort;

      server = new TACServer(tac, {
        development: true,
        validateWebhooks: true,
        voice: { port: endpointTestPort },
      });

      await server.start();
    });

    it('should validate /twiml endpoint', async () => {
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
});
