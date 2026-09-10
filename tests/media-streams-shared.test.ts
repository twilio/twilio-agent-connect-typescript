import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MediaStreamsOpenAICallState,
  MediaStreamsOpenAIProvider,
  MediaStreamsOpenAIProviderConfig,
  MediaStreamsProviderConfig,
  OpenAIRealtimeProviderConfig,
} from '@twilio/tac-core';
import type {
  ConversationId,
  ConversationSession,
  ProfileId,
  VoiceChannel,
} from '@twilio/tac-core';
import { TACTool } from '@twilio/tac-tools';
import { TACConfig } from '../packages/core/src/lib/config';
import type { Logger } from '../packages/core/src/lib/logger';

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

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
} as unknown as Logger;

const tacConfig = new TACConfig({
  accountSid: 'ACtest123456789',
  authToken: 'test_token_123',
  apiKey: 'SKtest123456789',
  apiSecret: 'test_api_secret_123',
  phoneNumber: '+15551234567',
  voicePublicDomain: 'example.ngrok.io',
  voiceWebsocketPath: '/voice-stream',
});

/**
 * A provider that adds nothing but a dispatcher, standing in for the next
 * OpenAI-backed Media Streams provider: whatever it can do here, it inherits
 * whole from {@link MediaStreamsOpenAIProvider} rather than from
 * `OpenAIRealtimeProvider`.
 */
class ProbeProvider extends MediaStreamsOpenAIProvider<MediaStreamsOpenAICallState> {
  /** Every event the base handed down, in order. */
  public readonly dispatched: Record<string, unknown>[] = [];

  public override get channelName(): string {
    return 'VOICE_MEDIA_STREAM_PROBE';
  }

  protected override dispatchModelEvent(
    _conversationId: ConversationId,
    _session: ConversationSession,
    event: Record<string, unknown>
  ): Promise<void> {
    this.dispatched.push(event);
    return Promise.resolve();
  }
}

/**
 * A `VoiceChannel` stand-in exposing the internal accessors the shared base
 * reaches for. Modeled on the one in `openai-realtime-provider.test.ts`.
 */
function makeChannel(): {
  channel: VoiceChannel;
  sessions: Map<string, ConversationSession>;
} {
  const sessions = new Map<string, ConversationSession>();
  const channel = {
    getLoggerInternal: () => noopLogger,
    getTacConfig: () => tacConfig,
    getCallEventHandlers: () => ({}),
    getInboundCallTwimlHandler: () => undefined,
    getVoiceCallbacks: () => ({}),
    getConversationSession: (conversationId: string) => sessions.get(conversationId),
    startConversationInternal: (conversationId: ConversationId, profileId?: ProfileId) => {
      const session = {
        conversationId,
        callSid: conversationId,
        profileId,
        channel: 'VOICE',
        startedAt: new Date(),
        metadata: {},
      } as unknown as ConversationSession;
      sessions.set(conversationId, session);
      return session;
    },
    endConversationInternal: (conversationId: string) => {
      sessions.delete(conversationId);
      return Promise.resolve();
    },
    handleErrorInternal: () => {},
  } as unknown as VoiceChannel;

  return { channel, sessions };
}

function makeProbe(options?: { tools?: TACTool<never, unknown>[] }): {
  provider: ProbeProvider;
  channel: VoiceChannel;
  sessions: Map<string, ConversationSession>;
} {
  const { channel, sessions } = makeChannel();
  const config = new MediaStreamsOpenAIProviderConfig({
    openaiApiKey: 'sk-test',
    ...(options?.tools ? { tools: options.tools } : {}),
  });
  return { provider: new ProbeProvider(channel, tacConfig, config), channel, sessions };
}

describe('MediaStreamsOpenAIProvider', () => {
  it('builds Media Streams TwiML with no Realtime-specific code', async () => {
    const { provider } = makeProbe();

    const twiml = await provider.handleIncomingCall();

    expect(twiml).toContain('<Stream url="wss://example.ngrok.io/voice-stream"');
  });

  it('routes a parsed model frame to the subclass dispatcher', async () => {
    const { provider, channel } = makeProbe();
    channel.startConversationInternal('CA1' as ConversationId);

    await provider.handleModelMessage(
      'CA1' as ConversationId,
      JSON.stringify({ type: 'response.created' })
    );

    expect(provider.dispatched).toEqual([{ type: 'response.created' }]);
  });

  it('swallows one malformed frame instead of ending the call', async () => {
    const { provider, channel } = makeProbe();
    channel.startConversationInternal('CA1' as ConversationId);

    await expect(provider.handleModelMessage('CA1' as ConversationId, 'not json')).resolves.toBe(
      undefined
    );
    expect(provider.dispatched).toEqual([]);
  });

  it('runs a shared tool lookup', async () => {
    const tool = new TACTool('ping', 'Ping', { type: 'object', properties: {} }, () =>
      Promise.resolve('pong')
    );
    const { provider } = makeProbe({ tools: [tool] });

    await expect(provider.runToolCall('CA1' as ConversationId, 'ping', '{}')).resolves.toBe('pong');
    await expect(provider.runToolCall('CA1' as ConversationId, 'nope', '{}')).resolves.toEqual({
      error: "Unknown tool 'nope'",
    });
  });

  it('names the concrete subclass when refusing to send text', async () => {
    const { provider } = makeProbe();

    await expect(provider.sendResponse('CA1' as ConversationId, 'hi')).rejects.toThrow(
      /ProbeProvider/
    );
  });
});
