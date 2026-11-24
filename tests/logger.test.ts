import { describe, it, expect, afterEach, vi } from 'vitest';
import { TACServer } from '@twilio/tac-server';
import { createLogger } from '../packages/core/src/lib/logger';
import { createTestTAC } from './helpers/tac';

describe('TWILIO_LOG_LEVEL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['WARNING', 'warn'],
    ['warning', 'warn'],
    ['CRITICAL', 'fatal'],
    ['Critical', 'fatal'],
    ['WARN', 'warn'],
    ['FATAL', 'fatal'],
    ['DEBUG', 'debug'],
    ['INFO', 'info'],
    ['ERROR', 'error'],
    ['trace', 'trace'],
    ['silent', 'silent'],
    [' error ', 'error'],
  ])('maps %j to the pino level %j', (value, expected) => {
    vi.stubEnv('TWILIO_LOG_LEVEL', value);
    expect(createLogger().level).toBe(expected);
  });

  it('falls back to info for an unrecognized level, as the Python SDK does', () => {
    vi.stubEnv('TWILIO_LOG_LEVEL', 'verbose');
    expect(createLogger().level).toBe('info');
  });

  it('normalizes an explicit level option', () => {
    expect(createLogger({ level: 'WARNING' }).level).toBe('warn');
  });

  it('lets TAC and TACServer start with Python-style level names', async () => {
    vi.stubEnv('TWILIO_LOG_LEVEL', 'WARNING');

    const tac = await createTestTAC({
      accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      authToken: 'test_token',
      apiKey: 'SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      apiSecret: 'test_secret',
      phoneNumber: '+15555550100',
      conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
    });

    try {
      expect(() => new TACServer(tac)).not.toThrow();
    } finally {
      await tac.shutdown();
    }
  });
});
