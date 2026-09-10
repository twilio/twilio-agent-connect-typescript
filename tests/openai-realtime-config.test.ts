import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenAIRealtimeProviderConfig } from '@twilio/tac-core';

describe('OpenAIRealtimeProviderConfig', () => {
  const original = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-from-env';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });

  it('defaults openaiApiKey to the environment variable', () => {
    expect(new OpenAIRealtimeProviderConfig({}).openaiApiKey).toBe('sk-from-env');
  });

  it('prefers an explicitly passed key', () => {
    expect(new OpenAIRealtimeProviderConfig({ openaiApiKey: 'sk-explicit' }).openaiApiKey).toBe(
      'sk-explicit'
    );
  });

  it('throws when no key is available from either source', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIRealtimeProviderConfig({})).toThrow(/openaiApiKey is required/);
  });

  it('defaults tools to an empty list and memoryMode to never', () => {
    const config = new OpenAIRealtimeProviderConfig({});
    expect(config.tools).toEqual([]);
    expect(config.memoryMode).toBe('never');
  });

  it('resolves the key from the environment when constructed with no options', () => {
    expect(new OpenAIRealtimeProviderConfig().openaiApiKey).toBe('sk-from-env');
  });

  // The `if (options?.x !== undefined)` guards in the constructor satisfy
  // `exactOptionalPropertyTypes` at the type level; they do not keep the
  // property off the instance. `target: ES2022` implies
  // `useDefineForClassFields`, so every declared field — initializer or not —
  // is defined as an own property before the constructor body runs. Omitted
  // optionals therefore read back as present-and-undefined.
  it('reads omitted optionals back as undefined', () => {
    const config = new OpenAIRealtimeProviderConfig({});
    expect(config.welcomeGreetingResponse).toBeUndefined();
    expect(config.defaultSessionConfig).toBeUndefined();
    expect(config.defaultTwimlOptions).toBeUndefined();
    expect(config.onInboundCallSessionConfig).toBeUndefined();
  });

  it('stores provided session config options on the instance', async () => {
    const defaultSessionConfig = { instructions: 'default' };
    const onInboundCallSessionConfig = async () => ({ instructions: 'per-call' });
    const config = new OpenAIRealtimeProviderConfig({
      defaultSessionConfig,
      onInboundCallSessionConfig,
    });

    expect(config.defaultSessionConfig).toBe(defaultSessionConfig);
    expect(config.onInboundCallSessionConfig).toBe(onInboundCallSessionConfig);
  });

  it('throws on an explicit empty-string key even when the environment has one', () => {
    expect(() => new OpenAIRealtimeProviderConfig({ openaiApiKey: '' })).toThrow(
      /openaiApiKey is required/
    );
  });
});
