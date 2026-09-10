import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import { CallState } from '../packages/core/src/channels/voice/media-streams/gpt-live/state';
import { InitiateVoiceConversationOptionsGPTLiveSchema } from '@twilio/tac-core';
import type { ConversationId } from '@twilio/tac-core';
import { GPTLiveProviderConfig } from '../packages/core/src/channels/voice/media-streams/gpt-live/config';
import {
  GPTLiveProvider,
  GPT_LIVE_SESSION_ID_METADATA_KEY,
  TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE,
} from '../packages/core/src/channels/voice/media-streams/gpt-live/provider';

const validSessionConfig = {
  model: 'gpt-live-1',
  audio: { format: TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE },
};

/** Spelled out here because the provider keeps the constant module-private. */
const SESSION_CONFIG_TOKEN_PARAM_LITERAL = '_tac_session_config_token';

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
  const handleErrorInternal = vi.fn();
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
    handleErrorInternal,
  };
  return Object.assign(channel, { createCall, logger, handleErrorInternal });
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

/**
 * Stands in for either leg of the bridge: the Twilio-facing socket or the
 * GPT-Live one. `close()` emits `close` synchronously, as `ws` does once the
 * peer has gone away.
 */
class FakeSocket extends EventEmitter {
  sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit('close');
  }

  /** Everything written to this socket, parsed. */
  json(): Record<string, unknown>[] {
    return this.sent.map(s => JSON.parse(s) as Record<string, unknown>);
  }
}

/**
 * Drive a provider through Twilio's `start` event with `modelWs` standing in
 * for the GPT-Live socket, and hand back the Twilio-facing socket.
 */
function startCall(
  provider: GPTLiveProvider,
  modelWs: FakeSocket,
  customParameters: Record<string, string> = {}
): FakeSocket {
  // The one seam keeping these tests off the network.
  vi.spyOn(provider, 'openModelSocket' as never).mockResolvedValue(modelWs as never);
  const twilioWs = new FakeSocket();
  provider.handleWebSocket(twilioWs as never);
  twilioWs.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        event: 'start',
        start: { streamSid: 'MZ1', callSid: 'CA1', customParameters },
      })
    )
  );
  return twilioWs;
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
    const call = () =>
      // A ConversationRelay-shaped object: the Media Streams schema is strict,
      // so `welcomeGreeting` is an unknown key.
      provider.initiateOutboundConversation({
        to: '+15551112222',
        twimlOptions: { welcomeGreeting: 'hi' },
      } as never);
    await expect(call()).rejects.toThrow(TypeError);
    // The whole options object is validated, so the message names the options
    // type; pin the field path so this still proves `twimlOptions` was what
    // was rejected.
    await expect(call()).rejects.toThrow(
      /InitiateVoiceConversationOptionsGPTLive: twimlOptions: .*welcomeGreeting/
    );
  });

  it('rejects an unknown top-level option key', async () => {
    const { provider, createCall } = makeProvider();
    const call = () =>
      // Typo'd key: the schema is `.strict()`, so it must not be silently
      // dropped on the way to calls.create().
      provider.initiateOutboundConversation({
        to: '+15551112222',
        sesionConfig: { instructions: 'typo' },
      } as never);
    await expect(call()).rejects.toThrow(TypeError);
    await expect(call()).rejects.toThrow(/InitiateVoiceConversationOptionsGPTLive: .*sesionConfig/);
    expect(createCall).not.toHaveBeenCalled();
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

describe('GPTLiveProvider WebSocket bridge', () => {
  it('opens the GPT-Live socket with auth headers and sends session.start', async () => {
    const { provider } = makeProvider();
    const modelWs = new FakeSocket();
    const open = vi.spyOn(provider, 'openModelSocket' as never).mockResolvedValue(modelWs as never);

    const twilioWs = new FakeSocket();
    provider.handleWebSocket(twilioWs as never);
    twilioWs.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          event: 'start',
          start: { streamSid: 'MZ1', callSid: 'CA1', customParameters: {} },
        })
      )
    );

    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));
    const [url, headers] = open.mock.calls[0] as [string, Record<string, string>];
    expect(url).toBe('wss://api.openai.com/v1/live/sessions');
    expect(headers['Authorization']).toBe('Bearer sk-test');
    expect(headers['User-Agent']).toMatch(/^twilio-agent-connect\/TypeScript \d+\.\d+\.\d+/);
    // Exactly two headers: Python #125 deleted the `OpenAI-Alpha:
    // quicksilver=v3` header the pre-review draft sent, and nothing replaced it.
    expect(Object.keys(headers).sort()).toEqual(['Authorization', 'User-Agent']);

    const start = modelWs.json().find(m => m.type === 'session.start');
    expect((start!.session as Record<string, string>).model).toBe('gpt-live-1');
  });

  it('rejects a session config whose audio.format is not the Twilio wire format', async () => {
    const { provider } = makeProvider({
      defaultSessionConfig: { model: 'gpt-live-1', audio: { format: { type: 'audio/pcm' } } },
    });
    await expect(provider.connectModel('CA_BAD' as ConversationId)).rejects.toThrow(
      /audio\.format/
    );
  });

  it('requires a model field on the session config', async () => {
    const { provider } = makeProvider({
      defaultSessionConfig: { audio: { format: TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE } },
    });
    await expect(provider.connectModel('CA_MODEL' as ConversationId)).rejects.toThrow(
      /must include 'model'/
    );
  });

  it('fails the call when neither the call nor the config supplies a session config', async () => {
    const { provider } = makeProvider({ defaultSessionConfig: undefined });
    await expect(provider.connectModel('CA_NONE' as ConversationId)).rejects.toThrow(
      /No sessionConfig available/
    );
  });

  it('rekeys a token-stashed session config onto the conversation id on start', async () => {
    const { provider, createCall } = makeProvider();
    await provider.initiateOutboundConversation({
      to: '+15551112222',
      sessionConfig: { ...validSessionConfig, instructions: 'outbound override' },
    } as never);
    const token = tokenFromTwiml(createCall.mock.calls[0][0].twiml);

    const modelWs = new FakeSocket();
    startCall(provider, modelWs, { [SESSION_CONFIG_TOKEN_PARAM_LITERAL]: token });

    await vi.waitFor(() => {
      const start = modelWs.json().find(m => m.type === 'session.start');
      expect((start!.session as Record<string, string>).instructions).toBe('outbound override');
    });
    expect(provider.pendingSessionConfigCount()).toBe(0);
  });

  it('forwards caller audio to the model as session.input_audio.append', async () => {
    const { provider } = makeProvider();
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    twilioWs.emit(
      'message',
      Buffer.from(JSON.stringify({ event: 'media', media: { payload: 'BASE64AUDIO' } }))
    );
    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual({
        type: 'session.input_audio.append',
        audio: 'BASE64AUDIO',
      })
    );
  });

  it('tears down the Twilio socket when the model socket closes first', async () => {
    const { provider } = makeProvider();
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    modelWs.close();
    await vi.waitFor(() => expect(twilioWs.closed).toBe(true));
  });

  it('closes the model socket when Twilio sends stop', async () => {
    const { provider } = makeProvider();
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    twilioWs.emit('message', Buffer.from(JSON.stringify({ event: 'stop' })));
    await vi.waitFor(() => expect(modelWs.closed).toBe(true));
  });

  it('reports a Twilio socket error to the host', async () => {
    const { provider, channel } = makeProvider();
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));
    const error = new Error('Twilio socket blew up');

    twilioWs.emit('error', error);

    // Nothing rethrows here, so routing it to the host is the only way it
    // reaches the application at all.
    expect(channel.handleErrorInternal).toHaveBeenCalledWith(error, { conversationId: 'CA1' });
  });
});

describe('GPTLiveProvider model events', () => {
  it('sends the welcome instruction only once session.started arrives', async () => {
    const { provider } = makeProvider({ welcomeInstruction: 'Greet the caller warmly.' });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    expect(modelWs.json().some(m => m.type === 'session.commentary.append')).toBe(false);

    modelWs.emit('message', JSON.stringify({ type: 'session.started' }));
    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual({
        type: 'session.commentary.append',
        delegation_id: null,
        content: 'Greet the caller warmly.',
      })
    );
  });

  it('sends nothing on session.started when no welcome instruction is configured', async () => {
    const { provider } = makeProvider();
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));
    const before = modelWs.sent.length;

    modelWs.emit('message', JSON.stringify({ type: 'session.started' }));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(modelWs.sent.length).toBe(before);
  });

  it('relays model audio back to Twilio tagged with the streamSid', async () => {
    const { provider } = makeProvider();
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    modelWs.emit('message', JSON.stringify({ type: 'session.output_audio.delta', delta: 'xyz' }));
    await vi.waitFor(() =>
      expect(twilioWs.json()).toContainEqual({
        event: 'media',
        streamSid: 'MZ1',
        media: { payload: 'xyz' },
      })
    );
  });

  it('records an input transcript delta as a user turn', async () => {
    const { provider, channel } = makeProvider();
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    modelWs.emit(
      'message',
      JSON.stringify({ type: 'session.input_transcript.delta', delta: 'hi' })
    );
    await vi.waitFor(() =>
      expect(channel.getActiveConversations().get('CA1')!.metadata).toMatchObject({
        transcript: [{ role: 'user', text: 'hi' }],
      })
    );
  });

  it('merges consecutive same-role deltas into one turn', async () => {
    const { provider, channel } = makeProvider();
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    for (const delta of ['he', 'llo']) {
      modelWs.emit('message', JSON.stringify({ type: 'session.output_transcript.delta', delta }));
    }
    await vi.waitFor(() =>
      expect(channel.getActiveConversations().get('CA1')!.metadata).toMatchObject({
        transcript: [{ role: 'assistant', text: 'hello' }],
      })
    );
  });

  it('starts a new turn when the role changes', async () => {
    const { provider, channel } = makeProvider();
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    modelWs.emit(
      'message',
      JSON.stringify({ type: 'session.input_transcript.delta', delta: 'hi' })
    );
    modelWs.emit(
      'message',
      JSON.stringify({ type: 'session.output_transcript.delta', delta: 'hello' })
    );
    await vi.waitFor(() =>
      expect(channel.getActiveConversations().get('CA1')!.metadata).toMatchObject({
        transcript: [
          { role: 'user', text: 'hi' },
          { role: 'assistant', text: 'hello' },
        ],
      })
    );
  });

  it('survives a malformed event without ending the call', async () => {
    const { provider } = makeProvider();
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    modelWs.emit('message', 'not json at all');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(twilioWs.closed).toBe(false);
  });
});

describe('GPTLiveProvider session id', () => {
  /** The session created for `CA1` by `startCall`. */
  function sessionFor(channel: ReturnType<typeof makeChannelStub>) {
    return channel.getActiveConversations().get('CA1')!;
  }

  it('records the session id from session.started onto the session metadata', async () => {
    const { provider, channel } = makeProvider();
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    modelWs.emit(
      'message',
      JSON.stringify({ type: 'session.started', session: { id: 'rtc_123', status: 'active' } })
    );

    await vi.waitFor(() =>
      expect(sessionFor(channel).metadata).toMatchObject({
        [GPT_LIVE_SESSION_ID_METADATA_KEY]: 'rtc_123',
      })
    );
  });

  it('records the session id from session.closed when session.started was missed', async () => {
    const { provider, channel } = makeProvider();
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    modelWs.emit(
      'message',
      JSON.stringify({
        type: 'session.closed',
        reason: 'client_request',
        session: { id: 'live_456' },
      })
    );

    await vi.waitFor(() =>
      expect(sessionFor(channel).metadata).toMatchObject({
        [GPT_LIVE_SESSION_ID_METADATA_KEY]: 'live_456',
      })
    );
  });

  it('leaves metadata untouched when the snapshot carries no usable id', async () => {
    const { provider, channel } = makeProvider();
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    modelWs.emit('message', JSON.stringify({ type: 'session.started' }));
    modelWs.emit('message', JSON.stringify({ type: 'session.started', session: {} }));
    modelWs.emit('message', JSON.stringify({ type: 'session.started', session: { id: '' } }));
    modelWs.emit('message', JSON.stringify({ type: 'session.started', session: { id: 42 } }));

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(sessionFor(channel).metadata).not.toHaveProperty(GPT_LIVE_SESSION_ID_METADATA_KEY);
  });

  it('logs the session id once per call even when both snapshots carry it', async () => {
    const { provider, channel } = makeProvider();
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await vi.waitFor(() => expect(modelWs.sent.length).toBeGreaterThan(0));

    modelWs.emit(
      'message',
      JSON.stringify({ type: 'session.started', session: { id: 'live_789' } })
    );
    modelWs.emit(
      'message',
      JSON.stringify({ type: 'session.closed', session: { id: 'live_789' } })
    );

    await vi.waitFor(() =>
      expect(sessionFor(channel).metadata).toMatchObject({
        [GPT_LIVE_SESSION_ID_METADATA_KEY]: 'live_789',
      })
    );
    const idLogs = channel.logger.info.mock.calls.filter(
      ([, message]) => message === 'GPT-Live session id'
    );
    expect(idLogs).toHaveLength(1);
    expect(idLogs[0][0]).toEqual({ conversation_id: 'CA1', gpt_live_session_id: 'live_789' });
  });
});
