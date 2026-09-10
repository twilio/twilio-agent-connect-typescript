import { describe, it, expect, vi } from 'vitest';
import { CallState } from '../packages/core/src/channels/voice/media-streams/gpt-live/state';
import { InitiateVoiceConversationOptionsGPTLiveSchema } from '@twilio/tac-core';
import { GPTLiveProviderConfig } from '../packages/core/src/channels/voice/media-streams/gpt-live/config';
import {
  GPTLiveProvider,
  TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE,
} from '../packages/core/src/channels/voice/media-streams/gpt-live/provider';

const validSessionConfig = {
  model: 'gpt-live-1',
  audio: { format: TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE },
};

function makeTacConfigStub() {
  return { voicePublicDomain: 'example.ngrok.io', voiceWebsocketPath: '/voice-stream' } as never;
}

function makeChannelStub() {
  const createCall = vi.fn().mockResolvedValue({ sid: 'CA999' });
  const sessions = new Map<string, Record<string, unknown>>();
  // One logger object for the whole stub, not a fresh one per call: the base
  // provider captures `getLoggerInternal()` once in its constructor, and Task 5
  // asserts on `logger.info` calls.
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const channel = {
    tac: { config: { phoneNumber: '+15550009999', callEventUrl: () => null } },
    getInboundCallTwimlHandler: () => undefined,
    getCallEventHandlers: () => ({ status: undefined, amd: undefined, recording: undefined }),
    getTwilioClientInternal: () => ({ calls: { create: createCall } }),
    startConversationInternal: (id: string) => {
      const session = { callSid: null as string | null, metadata: {} as Record<string, unknown> };
      sessions.set(id, session);
      return session;
    },
    endConversationInternal: async (id: string) => {
      sessions.delete(id);
    },
    // The inherited `handleModelMessage` looks the session up through this
    // before it calls `dispatchModelEvent`; without it every model event is
    // silently dropped.
    getConversationSession: (id: string) => sessions.get(id),
    getActiveConversations: () => sessions,
    getLoggerInternal: () => logger,
  };
  return Object.assign(channel, { createCall, logger });
}

function makeProvider(overrides: Record<string, unknown> = {}) {
  const channel = makeChannelStub();
  const config = new GPTLiveProviderConfig({
    openaiApiKey: 'sk-test',
    defaultSessionConfig: { ...validSessionConfig },
    ...overrides,
  });
  const provider = new GPTLiveProvider(channel as never, makeTacConfigStub(), config);
  return { provider, channel, createCall: channel.createCall };
}

function tokenFromTwiml(twiml: string): string {
  const match = /_tac_session_config_token" value="([^"]+)"/.exec(twiml);
  expect(match).not.toBeNull();
  return match![1];
}

describe('GPT-Live call state', () => {
  it('resolves its closed promise only once markClosed is called', async () => {
    const state = new CallState();
    let settled = false;
    void state.closed.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    state.markClosed();
    await state.closed;
    expect(settled).toBe(true);
  });

  it('inherits the shared socket handles', () => {
    const state = new CallState();
    expect(state.twilioWs).toBeNull();
    expect(state.modelWs).toBeNull();
  });
});

describe('InitiateVoiceConversationOptionsGPTLive', () => {
  it('carries a per-call sessionConfig alongside the base outbound fields', () => {
    const parsed = InitiateVoiceConversationOptionsGPTLiveSchema.parse({
      to: '+15551234567',
      sessionConfig: { model: 'gpt-live-1' },
    });
    expect(parsed.sessionConfig).toEqual({ model: 'gpt-live-1' });
  });

  it('leaves sessionConfig absent when it is not supplied', () => {
    const parsed = InitiateVoiceConversationOptionsGPTLiveSchema.parse({ to: '+15551234567' });
    expect(parsed.sessionConfig).toBeUndefined();
  });
});

describe('GPTLiveProviderConfig', () => {
  it('names itself, not the base class, when no API key is available', () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => new GPTLiveProviderConfig({})).toThrow(
        /openaiApiKey is required.*GPTLiveProviderConfig/
      );
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }
  });

  it('accepts a key with no session config — outbound calls can supply their own', () => {
    expect(() => new GPTLiveProviderConfig({ openaiApiKey: 'sk-test' })).not.toThrow();
  });

  it('accepts an inbound customizer as the only session-config source', () => {
    const config = new GPTLiveProviderConfig({
      openaiApiKey: 'sk-test',
      onInboundCallSessionConfig: async () => ({ ...validSessionConfig }),
    });
    expect(config.onInboundCallSessionConfig).toBeDefined();
  });

  it('builds a GPTLiveProvider from createProvider', () => {
    const config = new GPTLiveProviderConfig({ openaiApiKey: 'sk-test' });
    const provider = config.createProvider(makeChannelStub(), makeTacConfigStub());
    expect(provider.channelName).toBe('VOICE_MEDIA_STREAM_OPENAI_GPT_LIVE');
  });
});

describe('GPTLiveProvider outbound', () => {
  it('identifies itself distinctly from the Realtime provider', () => {
    expect(makeProvider().provider.channelName).toBe('VOICE_MEDIA_STREAM_OPENAI_GPT_LIVE');
  });

  it('places a call with inline Stream TwiML and returns the sid', async () => {
    const { provider, createCall } = makeProvider();
    const result = await provider.initiateOutboundConversation({ to: '+15551112222' } as never);

    expect(result.callSid).toBe('CA999');
    expect(createCall.mock.calls[0][0].twiml).toContain('<Stream');
  });

  it('stashes a per-call sessionConfig under a token, never under the call sid', async () => {
    const { provider, createCall } = makeProvider();
    await provider.initiateOutboundConversation({
      to: '+15551112222',
      sessionConfig: { ...validSessionConfig, instructions: 'outbound override' },
    } as never);

    const token = tokenFromTwiml(createCall.mock.calls[0][0].twiml);
    expect(provider.peekPendingSessionConfig(token)).toMatchObject({
      instructions: 'outbound override',
    });
    expect(provider.peekPendingSessionConfig('CA999')).toBeUndefined();
  });

  it('ignores a sessionConfig-less options object and stashes nothing', async () => {
    const { provider } = makeProvider();
    await provider.initiateOutboundConversation({ to: '+15551112222' } as never);
    expect(provider.pendingSessionConfigCount()).toBe(0);
  });

  it('does not leak a stashed sessionConfig when the call fails to place', async () => {
    const { provider, createCall } = makeProvider();
    createCall.mockRejectedValueOnce(new Error('twilio down'));

    await expect(
      provider.initiateOutboundConversation({
        to: '+15551112222',
        sessionConfig: { ...validSessionConfig },
      } as never)
    ).rejects.toThrow('twilio down');
    expect(provider.pendingSessionConfigCount()).toBe(0);
  });

  it('does not stash anything when TwiML construction fails before the call is placed', async () => {
    const channel = makeChannelStub();
    const config = new GPTLiveProviderConfig({
      openaiApiKey: 'sk-test',
      defaultSessionConfig: { ...validSessionConfig },
    });
    const provider = new GPTLiveProvider(
      channel as never,
      { voicePublicDomain: null, voiceWebsocketPath: '/voice-stream' } as never,
      config
    );

    await expect(
      provider.initiateOutboundConversation({
        to: '+15551112222',
        sessionConfig: { ...validSessionConfig },
      } as never)
    ).rejects.toThrow();
    expect(provider.pendingSessionConfigCount()).toBe(0);
    expect(channel.createCall).not.toHaveBeenCalled();
  });

  it('rejects twimlOptions that are not Media Streams options', async () => {
    const { provider } = makeProvider();
    await expect(
      provider.initiateOutboundConversation({
        to: '+15551112222',
        twimlOptions: { welcomeGreeting: 'hi' },
      } as never)
    ).rejects.toThrow(/VoiceTwiMLOptionsMediaStreams/);
  });

  it('purges an unclaimed token once its TTL elapses', async () => {
    vi.useFakeTimers();
    try {
      const { provider, createCall } = makeProvider();
      await provider.initiateOutboundConversation({
        to: '+15551112222',
        sessionConfig: { ...validSessionConfig },
      } as never);

      const token = tokenFromTwiml(createCall.mock.calls[0][0].twiml);
      expect(provider.peekPendingSessionConfig(token)).toBeDefined();

      vi.advanceTimersByTime(120_000);
      expect(provider.peekPendingSessionConfig(token)).toBeUndefined();
      expect(provider.pendingSessionConfigCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
