import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  OpenAIRealtimeProvider,
  OpenAIRealtimeProviderConfig,
  MediaStreamsProviderConfig,
  VoiceProviderConfig,
} from '@twilio/tac-core';
import type { VoiceChannel } from '@twilio/tac-core';
import { TACConfig } from '../packages/core/src/lib/config';
import type { Logger } from '../packages/core/src/lib/logger';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
} as unknown as Logger;

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

  // `createProvider` is the only path `new VoiceChannel(tac, config)` takes to
  // reach the provider, so without this override the config inherits
  // `VoiceProviderConfig.createProvider`, which throws. `createProvider` itself
  // touches the channel only through the provider constructor's
  // `getLoggerInternal()`, so a cast-based stub is enough here.
  it('creates an OpenAIRealtimeProvider wired to the channel and config it is handed', () => {
    const channel = { getLoggerInternal: () => noopLogger } as unknown as VoiceChannel;
    const tacConfig = new TACConfig({
      accountSid: 'ACtest123456789',
      authToken: 'test_token_123',
      apiKey: 'SKtest123456789',
      apiSecret: 'test_api_secret_123',
      phoneNumber: '+15551234567',
      voicePublicDomain: 'example.ngrok.io',
      voiceWebsocketPath: '/voice-stream',
    });
    const config = new OpenAIRealtimeProviderConfig({});

    const provider = config.createProvider(channel, tacConfig);

    expect(provider).toBeInstanceOf(OpenAIRealtimeProvider);
    expect(provider.channelName).toBe('VOICE_MEDIA_STREAM_OPENAI_REALTIME');
    expect(provider.channel).toBe(channel);
    expect((provider as unknown as { config: OpenAIRealtimeProviderConfig }).config).toBe(config);
    expect((provider as unknown as { tacConfig: TACConfig }).tacConfig).toBe(tacConfig);
  });
});

describe('MediaStreamsProviderConfig', () => {
  it('is the layer OpenAIRealtimeProviderConfig inherits transport settings from', () => {
    const config = new OpenAIRealtimeProviderConfig({ openaiApiKey: 'sk-test' });
    expect(config).toBeInstanceOf(MediaStreamsProviderConfig);
    expect(config).toBeInstanceOf(VoiceProviderConfig);
  });

  it('carries defaultTwimlOptions with no OpenAI dependency of its own', () => {
    const config = new MediaStreamsProviderConfig({
      defaultTwimlOptions: { name: 'my-stream' },
    });
    expect(config.defaultTwimlOptions).toEqual({ name: 'my-stream' });
    expect(config.memoryMode).toBe('never');
  });

  it('still throws from createProvider, which only subclasses implement', () => {
    expect(() =>
      new MediaStreamsProviderConfig({}).createProvider({} as never, {} as never)
    ).toThrow(/must implement createProvider/);
  });
});
