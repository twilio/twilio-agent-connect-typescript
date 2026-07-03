import { describe, it, expect } from 'vitest';
import { twiMLRequestFromForm, TwiMLOptionsSchema, LanguageConfigSchema } from '@twilio/tac-core';

describe('twiMLRequestFromForm', () => {
  it('parses known webhook fields', () => {
    const ctx = twiMLRequestFromForm({
      From: '+14155551234',
      To: '+15551234567',
      CallSid: 'CA' + '1'.repeat(32),
      CallerCountry: 'US',
      CallerState: 'CA',
      CallerCity: 'San Francisco',
      Direction: 'inbound',
    });
    expect(ctx.from).toBe('+14155551234');
    expect(ctx.to).toBe('+15551234567');
    expect(ctx.callSid).toBe('CA' + '1'.repeat(32));
    expect(ctx.callerCountry).toBe('US');
    expect(ctx.callerState).toBe('CA');
    expect(ctx.callerCity).toBe('San Francisco');
    expect(ctx.direction).toBe('inbound');
    expect(ctx.extra).toEqual({});
  });

  it('buckets unknown fields into extra', () => {
    const ctx = twiMLRequestFromForm({
      From: '+14155551234',
      ApiVersion: '2010-04-01',
      ForwardedFrom: '+15559999999',
    });
    expect(ctx.from).toBe('+14155551234');
    expect(ctx.extra).toEqual({
      ApiVersion: '2010-04-01',
      ForwardedFrom: '+15559999999',
    });
  });

  it('handles an empty form', () => {
    const ctx = twiMLRequestFromForm({});
    expect(ctx.from).toBeUndefined();
    expect(ctx.extra).toEqual({});
  });
});

describe('TwiMLOptions validation', () => {
  it('rejects unknown keys (strict)', () => {
    // A typo in a field name should fail loudly rather than be dropped.
    const result = TwiMLOptionsSchema.safeParse({ voicee: 'en-US-Journey-D' });
    expect(result.success).toBe(false);
  });

  it('accepts the literal "auto" speechTimeout', () => {
    const result = TwiMLOptionsSchema.safeParse({ speechTimeout: 'auto' });
    expect(result.success).toBe(true);
  });

  it('rejects other string speechTimeout values', () => {
    const result = TwiMLOptionsSchema.safeParse({ speechTimeout: 'fast' });
    expect(result.success).toBe(false);
  });

  it('accepts a numeric speechTimeout', () => {
    const result = TwiMLOptionsSchema.safeParse({ speechTimeout: 800 });
    expect(result.success).toBe(true);
  });

  it('accepts both enum and boolean interruptible', () => {
    expect(TwiMLOptionsSchema.safeParse({ interruptible: 'speech' }).success).toBe(true);
    expect(TwiMLOptionsSchema.safeParse({ interruptible: true }).success).toBe(true);
  });

  it('rejects an invalid interruptible enum value', () => {
    expect(TwiMLOptionsSchema.safeParse({ interruptible: 'loud' }).success).toBe(false);
  });

  it('rejects extra keys that shadow typed fields', () => {
    const result = TwiMLOptionsSchema.safeParse({
      voice: 'en-US-Journey-D',
      extra: { voice: 'should-not-appear' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => /shadow typed fields/.test(i.message))).toBe(true);
    }
  });

  it('rejects shadow keys even when the typed field is unset', () => {
    // The typed field must be used directly so validators / coercion run.
    const result = TwiMLOptionsSchema.safeParse({ extra: { speechTimeout: 800 } });
    expect(result.success).toBe(false);
  });

  it('allows extra with non-shadowing keys', () => {
    const result = TwiMLOptionsSchema.safeParse({ extra: { futureFeature: 'on' } });
    expect(result.success).toBe(true);
  });

  it('accepts a websocketUrl field', () => {
    const result = TwiMLOptionsSchema.safeParse({
      websocketUrl: 'wss://example.com/ws?agent_session_id=CA1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects extra.websocketUrl (shadows the typed field)', () => {
    const result = TwiMLOptionsSchema.safeParse({ extra: { websocketUrl: 'wss://x/ws' } });
    expect(result.success).toBe(false);
  });
});

describe('LanguageConfig', () => {
  it('requires code and leaves the rest optional', () => {
    const lang = LanguageConfigSchema.parse({ code: 'es-MX' });
    expect(lang.code).toBe('es-MX');
    expect(lang.voice).toBeUndefined();
    expect(lang.ttsProvider).toBeUndefined();
    expect(lang.transcriptionProvider).toBeUndefined();
  });
});
