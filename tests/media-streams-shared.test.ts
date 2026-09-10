import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MediaStreamsOpenAIProviderConfig,
  MediaStreamsProviderConfig,
  OpenAIRealtimeProviderConfig,
} from '@twilio/tac-core';

describe('MediaStreamsOpenAIProviderConfig', () => {
  const original = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-from-env';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });

  it('sits between the transport config and the Realtime config', () => {
    const config = new OpenAIRealtimeProviderConfig({});
    expect(config).toBeInstanceOf(MediaStreamsOpenAIProviderConfig);
    expect(config).toBeInstanceOf(MediaStreamsProviderConfig);
  });

  it('owns the API key default and validation for every subclass', () => {
    expect(new MediaStreamsOpenAIProviderConfig({}).openaiApiKey).toBe('sk-from-env');
    delete process.env.OPENAI_API_KEY;
    expect(() => new MediaStreamsOpenAIProviderConfig({})).toThrow(/openaiApiKey is required/);
  });

  it('names the actual subclass in the missing-key error, not the base', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIRealtimeProviderConfig({})).toThrow(/OpenAIRealtimeProviderConfig/);
  });

  it('carries the OpenAI-generic members', () => {
    const config = new MediaStreamsOpenAIProviderConfig({
      defaultSessionConfig: { model: 'some-model' },
    });
    expect(config.tools).toEqual([]);
    expect(config.defaultSessionConfig).toEqual({ model: 'some-model' });
    expect(config.onInboundCallSessionConfig).toBeUndefined();
  });
});
