import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  maskPhone,
  maskEmail,
  maskAddress,
  scrubPii,
  scrubObject,
  SMSChannel,
  TAC,
  ConversationClient,
} from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';
import { Writable } from 'node:stream';
import pino from 'pino';

describe('PII masking', () => {
  describe('maskPhone', () => {
    it('should mask a US phone number', () => {
      expect(maskPhone('+15551234567')).toBe('+1***4567');
    });

    it('should mask an international phone number', () => {
      expect(maskPhone('+442071234567')).toBe('+4***4567');
    });

    it('should return *** for empty string', () => {
      expect(maskPhone('')).toBe('***');
    });

    it('should return *** for too-short number', () => {
      expect(maskPhone('+1234')).toBe('***');
    });

    it('should return *** for non-phone string', () => {
      expect(maskPhone('hello')).toBe('***');
    });

    it('should handle boundary lengths', () => {
      expect(maskPhone('+12345')).toBe('***');
      expect(maskPhone('+123456')).toBe('***');
      expect(maskPhone('+1234567')).toBe('+1***4567');
      expect(maskPhone('+12345678')).toBe('+1***5678');
    });
  });

  describe('maskEmail', () => {
    it('should mask a standard email', () => {
      expect(maskEmail('user@example.com')).toBe('u***@example.com');
    });

    it('should mask a short email', () => {
      expect(maskEmail('a@b.co')).toBe('a***@b.co');
    });

    it('should return *** for empty string', () => {
      expect(maskEmail('')).toBe('***');
    });

    it('should return *** for string without @', () => {
      expect(maskEmail('not-an-email')).toBe('***');
    });

    it('should return *** for string starting with @', () => {
      expect(maskEmail('@domain.com')).toBe('***');
    });
  });

  describe('maskAddress', () => {
    it('should auto-detect phone number', () => {
      expect(maskAddress('+15551234567')).toBe('+1***4567');
    });

    it('should auto-detect email', () => {
      expect(maskAddress('user@example.com')).toBe('u***@example.com');
    });

    it('should mask unknown format', () => {
      expect(maskAddress('some-identity')).toBe('s***');
    });

    it('should return *** for empty string', () => {
      expect(maskAddress('')).toBe('***');
    });

    it('should return *** for single char', () => {
      expect(maskAddress('x')).toBe('***');
    });
  });

  describe('scrubPii', () => {
    it('should scrub a phone number from a string', () => {
      expect(scrubPii('Call me at +15551234567 please')).toBe('Call me at +1***4567 please');
    });

    it('should scrub an email from a string', () => {
      expect(scrubPii('Send to user@example.com now')).toBe('Send to u***@example.com now');
    });

    it('should scrub both phone and email in the same string', () => {
      const input = 'Contact +15551234567 or user@example.com';
      const result = scrubPii(input);
      expect(result).not.toContain('+15551234567');
      expect(result).not.toContain('user@example.com');
      expect(result).toContain('+1***4567');
      expect(result).toContain('u***@example.com');
    });

    it('should handle formatted phone numbers', () => {
      expect(scrubPii('Call +1 (555) 123-4567')).not.toContain('555');
    });

    it('should leave non-PII strings unchanged', () => {
      expect(scrubPii('Hello world')).toBe('Hello world');
    });

    it('should leave short numbers unchanged', () => {
      expect(scrubPii('Code is +123')).toBe('Code is +123');
    });
  });

  describe('scrubObject', () => {
    it('should scrub phone numbers in nested objects', () => {
      const obj = { user: { phone: '+15551234567', name: 'Alice' } };
      const result = scrubObject(obj);
      expect(result.user.phone).toBe('+1***4567');
      expect(result.user.name).toBe('Alice');
    });

    it('should scrub emails in arrays', () => {
      const obj = { addresses: ['user@example.com', 'admin@test.org'] };
      const result = scrubObject(obj);
      expect(result.addresses[0]).toBe('u***@example.com');
      expect(result.addresses[1]).toBe('a***@test.org');
    });

    it('should pass through non-string primitives', () => {
      expect(scrubObject(42)).toBe(42);
      expect(scrubObject(true)).toBe(true);
      expect(scrubObject(null)).toBe(null);
    });

    it('should scrub string values directly', () => {
      expect(scrubObject('Call +15551234567')).toBe('Call +1***4567');
    });

    it('should handle circular references without stack overflow', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj: any = { phone: '+15551234567' };
      obj.self = obj;
      const result = scrubObject(obj);
      expect(result.phone).toBe('+1***4567');
      expect(result.self).toBe('[Circular]');
    });

    it('should preserve Error instances and scrub their messages', () => {
      const err = new Error('Failed for +15551234567');
      err.name = 'LookupError';
      const result = scrubObject(err);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('Failed for +1***4567');
      expect(result.name).toBe('LookupError');
      expect(result.stack).toBeDefined();
      expect(result.stack).not.toContain('+15551234567');
    });
  });

  describe('PII safety filter (Pino hook)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function piiLogMethod(this: any, args: any[], method: pino.LogFn) {
      const scrubbed = args.map(arg =>
        typeof arg === 'string'
          ? scrubObject(arg)
          : typeof arg === 'object' && arg !== null
            ? scrubObject(arg)
            : arg
      );
      return method.apply(this, scrubbed as Parameters<pino.LogFn>);
    }

    function collectLogs(callback: (logger: pino.Logger) => void): string[] {
      const lines: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, cb) {
          lines.push(chunk.toString());
          cb();
        },
      });
      const logger = pino({ level: 'debug', hooks: { logMethod: piiLogMethod } }, stream);
      callback(logger);
      return lines;
    }

    it('should scrub phone numbers from log object fields', () => {
      const lines = collectLogs(logger => {
        logger.info({ phone: '+15551234567' }, 'test message');
      });
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.phone).toBe('+1***4567');
      expect(lines[0]).not.toContain('+15551234567');
    });

    it('should scrub emails from log message strings', () => {
      const lines = collectLogs(logger => {
        logger.info('Contact user@example.com for help');
      });
      expect(lines.length).toBe(1);
      expect(lines[0]).not.toContain('user@example.com');
      expect(lines[0]).toContain('u***@example.com');
    });

    it('should scrub PII from nested objects', () => {
      const lines = collectLogs(logger => {
        logger.info({ data: { recipient: '+442071234567', email: 'alice@corp.co' } }, 'send');
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.data.recipient).toBe('+4***4567');
      expect(parsed.data.email).toBe('a***@corp.co');
    });

    it('should not alter non-PII data', () => {
      const lines = collectLogs(logger => {
        logger.info({ conversation_id: 'CH123', count: 42 }, 'clean log');
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.conversation_id).toBe('CH123');
      expect(parsed.count).toBe(42);
      expect(parsed.msg).toBe('clean log');
    });

    it('should scrub Error messages while preserving stack', () => {
      const lines = collectLogs(logger => {
        logger.error({ err: new Error('No profile for +15551234567') }, 'lookup failed');
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.err.message).toBe('No profile for +1***4567');
      expect(parsed.err.stack).toBeDefined();
      expect(parsed.err.stack).not.toContain('+15551234567');
    });
  });

  describe('log output masking', () => {
    let tac: TAC;
    let channel: SMSChannel;

    const getTestConfig = () => ({
      accountSid: 'ACtest123456789',
      authToken: 'test_token_123',
      apiKey: 'test_api_key',
      apiSecret: 'test_api_token',
      phoneNumber: '+15551234567',
      conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
    });

    beforeEach(async () => {
      tac = await createTestTAC(getTestConfig());
      channel = new SMSChannel(tac);
      tac.registerChannel(channel);
      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as never);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should mask author address in communication.created logs', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loggerInfoSpy = vi.spyOn((channel as any).logger, 'info');

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest_pii' },
      });

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest_pii',
          content: { type: 'TEXT', text: 'Hello, my SSN is 123-45-6789' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      const communicationCreatedCall = loggerInfoSpy.mock.calls.find(
        call => call[1] === 'Handling communication.created'
      );
      expect(communicationCreatedCall).toBeDefined();

      const logContext = communicationCreatedCall![0] as Record<string, unknown>;

      // Author address must be masked
      expect(logContext.author).toBe('+1***6543');
      // Raw phone number must NOT appear
      expect(logContext.author).not.toBe('+15559876543');
      // Message content must NOT be logged
      expect(logContext).not.toHaveProperty('message');
    });

    it('should not include payload in webhook processing error context', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loggerErrorSpy = vi.spyOn((channel as any).logger, 'error');

      // Send a webhook that will fail (missing conversation ID for COMMUNICATION_CREATED)
      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          content: { type: 'TEXT', text: 'secret message' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      const errorCalls = loggerErrorSpy.mock.calls;
      for (const call of errorCalls) {
        const context = call[0] as Record<string, unknown>;
        expect(context).not.toHaveProperty('payload');
        // Ensure message body is not in the error context
        if (typeof context === 'object') {
          expect(JSON.stringify(context)).not.toContain('secret message');
        }
      }
    });

    it('should mask author address in profile lookup logs', async () => {
      const tacWithMemory = await createTestTAC(getTestConfig());
      const memoryClient = tacWithMemory.getMemoryClient();
      vi.spyOn(memoryClient, 'lookupProfile').mockResolvedValue({ profiles: [] });

      const conversationClient = tacWithMemory.getConversationClient();
      vi.spyOn(conversationClient, 'listCommunications').mockResolvedValue([]);

      const warnSpy = vi.spyOn(tacWithMemory.logger, 'warn');

      await tacWithMemory.retrieveMemory({
        conversationId: 'conv_test_123',
        profileId: undefined,
        channel: 'sms',
        startedAt: new Date(),
        authorInfo: { address: '+13175556789' },
      });

      // The "no profile found" error is caught and logged as a warning.
      // Verify the logged error message contains the masked address.
      const failedLookupCall = warnSpy.mock.calls.find(
        call => typeof call[1] === 'string' && call[1].includes('falling back')
      );
      expect(failedLookupCall).toBeDefined();

      const loggedError = (failedLookupCall![0] as Record<string, unknown>).err as Error;
      expect(loggedError.message).toContain('+1***6789');
      expect(loggedError.message).not.toContain('+13175556789');
    });

    it('should mask author in handle_message_ready logs', async () => {
      const loggerDebugSpy = vi.spyOn(tac.logger, 'debug');

      tac.onMessageReady(async () => {});

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest_hmr' },
      });

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest_hmr',
          content: { type: 'TEXT', text: 'test message' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      await vi.waitFor(() => {
        const messageReadyCall = loggerDebugSpy.mock.calls.find(
          call => call[1] === 'Handling message ready'
        );
        expect(messageReadyCall).toBeDefined();

        const logContext = messageReadyCall![0] as Record<string, unknown>;
        expect(logContext.author).toBe('+1***6543');
        expect(logContext.author).not.toBe('+15559876543');
      });
    });
  });
});
