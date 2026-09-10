import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
// Imported from the package root on purpose: this also proves the barrel export
// chain re-exports the provider.
import { OpenAIRealtimeProvider, OpenAIRealtimeProviderConfig } from '@twilio/tac-core';
import type {
  ConversationId,
  ConversationSession,
  InboundCallTwimlHandler,
  OpenAIRealtimeProviderConfigOptions,
  ProfileId,
  VoiceChannel,
  VoiceTwiMLOptions,
} from '@twilio/tac-core';
import { TACTool } from '@twilio/tac-tools';
import { TACConfig } from '../packages/core/src/lib/config';
import type { Logger } from '../packages/core/src/lib/logger';
import type { CallState } from '../packages/core/src/channels/voice/media-streams/openai-realtime/state';

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

const minimalTacConfig = new TACConfig({
  accountSid: 'ACtest123456789',
  authToken: 'test_token_123',
  apiKey: 'SKtest123456789',
  apiSecret: 'test_api_secret_123',
  phoneNumber: '+15551234567',
  // voicePublicDomain intentionally omitted so no WebSocket URL can be
  // resolved and TwiMLBuilderMediaStreams.build() throws.
});

/**
 * What {@link makeChannel} hands back: the `VoiceChannel`-shaped stub plus the
 * bookkeeping the assertions read.
 */
interface StubChannel {
  channel: VoiceChannel;
  /** Sessions created via `startConversationInternal`, keyed by conversation id. */
  sessions: Map<string, ConversationSession>;
  /** Conversation ids passed to `endConversationInternal`, in order. */
  ended: string[];
  /** The mocked `client.calls.create`. */
  callsCreate: ReturnType<typeof vi.fn>;
  /** Errors reported through `handleErrorInternal`. */
  errors: Error[];
}

/**
 * A `VoiceChannel` stand-in exposing every internal accessor the provider
 * reaches for, so the provider under test can be driven without a real TAC.
 */
function makeChannel(options?: {
  inboundCallTwimlHandler?: InboundCallTwimlHandler;
  callsCreate?: (params: Record<string, unknown>) => Promise<{ sid: string }>;
  orchestratorEnabled?: boolean;
  /**
   * When a flag is `true`, `getCallEventHandlers()` returns a no-op async
   * handler for that kind; otherwise `undefined`. Default: all three `undefined`.
   */
  callEventHandlers?: { status?: boolean; amd?: boolean; recording?: boolean };
  /**
   * What `getTacConfig()` returns. Default: the module-level `tacConfig`.
   */
  channelTacConfig?: TACConfig;
}): StubChannel {
  const sessions = new Map<string, ConversationSession>();
  const ended: string[] = [];
  const errors: Error[] = [];
  const callsCreate = vi.fn(
    options?.callsCreate ?? (() => Promise.resolve({ sid: 'CAoutbound00000000000000000000' }))
  );
  const noopAsync = async (): Promise<void> => {};
  const handlers = options?.callEventHandlers;

  const channel = {
    getLoggerInternal: () => noopLogger,
    getTacConfig: () => options?.channelTacConfig ?? tacConfig,
    getCallEventHandlers: () => ({
      status: handlers?.status ? noopAsync : undefined,
      amd: handlers?.amd ? noopAsync : undefined,
      recording: handlers?.recording ? noopAsync : undefined,
    }),
    getInboundCallTwimlHandler: () => options?.inboundCallTwimlHandler,
    getTwilioClientInternal: () => ({ calls: { create: callsCreate } }),
    isOrchestratorEnabledInternal: () => options?.orchestratorEnabled ?? false,
    getVoiceCallbacks: () => ({}),
    getConversationSession: (conversationId: string) => sessions.get(conversationId),
    getConversationSessionByCallSid: (callSid: string) =>
      [...sessions.values()].find(session => session.callSid === callSid),
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
      ended.push(conversationId);
      sessions.delete(conversationId);
      return Promise.resolve();
    },
    handleErrorInternal: (error: Error) => {
      errors.push(error);
    },
  } as unknown as VoiceChannel;

  return { channel, sessions, ended, callsCreate, errors };
}

function makeProvider(
  channelOptions?: Parameters<typeof makeChannel>[0],
  config = new OpenAIRealtimeProviderConfig({ openaiApiKey: 'sk-test' }),
  providerTacConfig: TACConfig = tacConfig
): { provider: OpenAIRealtimeProvider; stub: StubChannel } {
  const stub = makeChannel(channelOptions);
  return { provider: new OpenAIRealtimeProvider(stub.channel, providerTacConfig, config), stub };
}

/**
 * A provider configured from `options`, with the API key filled in — the audio
 * bridge tests vary the provider config rather than the channel stub.
 */
function makeBridge(options: Omit<OpenAIRealtimeProviderConfigOptions, 'openaiApiKey'> = {}): {
  provider: OpenAIRealtimeProvider;
  stub: StubChannel;
} {
  return makeProvider(
    undefined,
    new OpenAIRealtimeProviderConfig({ openaiApiKey: 'sk-test', ...options })
  );
}

/** The only audio format a bidirectional Twilio `<Stream>` supports. */
const validSessionConfig = {
  model: 'gpt-realtime',
  audio: {
    input: { format: { type: 'audio/pcmu' } },
    output: { format: { type: 'audio/pcmu' } },
  },
};

/**
 * Stands in for either leg of the bridge: the Twilio-facing socket or the
 * OpenAI Realtime one. `close()` emits `close` synchronously, as `ws` does once
 * the peer has gone away.
 */
class FakeSocket extends EventEmitter {
  public sent: string[] = [];
  public closed = false;

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.closed = true;
    this.emit('close');
  }

  /** Everything written to this socket, parsed. */
  public json(): Record<string, unknown>[] {
    return this.sent.map(s => JSON.parse(s) as Record<string, unknown>);
  }
}

/**
 * Drive a provider through Twilio's `start` event with `modelWs` standing in
 * for the OpenAI socket, and hand back the Twilio-facing socket.
 */
function startCall(
  provider: OpenAIRealtimeProvider,
  modelWs: FakeSocket,
  options?: { customParameters?: Record<string, string>; callSid?: string }
): FakeSocket {
  // The one seam keeping these tests off the network.
  vi.spyOn(provider, 'openModelSocket').mockResolvedValue(modelWs as unknown as WebSocket);
  const twilioWs = new FakeSocket();
  provider.handleWebSocket(twilioWs as unknown as WebSocket);
  twilioWs.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MZ1',
          callSid: options?.callSid ?? 'CA1',
          customParameters: options?.customParameters ?? {},
        },
      })
    )
  );
  return twilioWs;
}

/**
 * Like {@link startCall}, but the model handshake stays pending until this
 * test settles it — so `media` frames can be emitted while the OpenAI socket
 * is still connecting, which is what Twilio really does.
 */
function startCallWithPendingHandshake(provider: OpenAIRealtimeProvider): {
  twilioWs: FakeSocket;
  openModelSocket: (modelWs: FakeSocket) => void;
  failModelSocket: (error: Error) => void;
} {
  let openModelSocket!: (modelWs: FakeSocket) => void;
  let failModelSocket!: (error: Error) => void;
  const handshake = new Promise<WebSocket>((resolve, reject) => {
    openModelSocket = modelWs => {
      resolve(modelWs as unknown as WebSocket);
    };
    failModelSocket = reject;
  });
  vi.spyOn(provider, 'openModelSocket').mockReturnValue(handshake);

  const twilioWs = new FakeSocket();
  provider.handleWebSocket(twilioWs as unknown as WebSocket);
  twilioWs.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        event: 'start',
        start: { streamSid: 'MZ1', callSid: 'CA1', customParameters: {} },
      })
    )
  );
  return { twilioWs, openModelSocket, failModelSocket };
}

/** Emit one Twilio `media` frame carrying `payload`. */
function sendMedia(twilioWs: FakeSocket, payload: string): void {
  twilioWs.emit('message', Buffer.from(JSON.stringify({ event: 'media', media: { payload } })));
}

/**
 * The provider's private per-call state — barge-in bookkeeping has no public
 * accessor, and the point of these assertions is what the dispatcher recorded.
 */
function callState(provider: OpenAIRealtimeProvider, conversationId: string): CallState {
  const call = (provider as unknown as { calls: Map<string, CallState> }).calls.get(conversationId);
  expect(call).toBeDefined();
  return call as CallState;
}

/** Let every already-queued microtask and immediate run to completion. */
function drain(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** Wait until the session config has reached the model socket. */
async function awaitSessionUpdate(modelWs: FakeSocket): Promise<void> {
  await vi.waitFor(() => expect(modelWs.json()[0]?.type).toBe('session.update'));
}

describe('OpenAIRealtimeProvider inbound', () => {
  it('identifies itself as the Media Streams OpenAI Realtime transport', () => {
    const { provider } = makeProvider();
    expect(provider.channelName).toBe('VOICE_MEDIA_STREAM_OPENAI_REALTIME');
  });

  it('builds <Connect><Stream> TwiML from the TACConfig-derived URL', async () => {
    const { provider } = makeProvider();
    const xml = await provider.handleIncomingCall();
    expect(xml).toContain('<Connect>');
    // Element-scoped and order-independent: the contract is that <Stream>
    // carries the url, not which attribute the helper emits first.
    expect(xml).toMatch(/<Stream\b[^>]*\burl="wss:\/\/example\.ngrok\.io\/voice-stream"/);
  });

  it('rejects hostTwimlOptions that are not Media Streams options', async () => {
    const { provider } = makeProvider();
    const call = () =>
      provider.handleIncomingCall(undefined, {
        // A ConversationRelay-shaped object: the Media Streams schema is
        // strict, so `welcomeGreeting` is an unknown key.
        hostTwimlOptions: { welcomeGreeting: 'hi' } as unknown as VoiceTwiMLOptions,
      });
    await expect(call()).rejects.toThrow(TypeError);
    // Pins which input was rejected, so this test can't pass for the
    // customizer-output case below.
    await expect(call()).rejects.toThrow(
      /options\.hostTwimlOptions to be a VoiceTwiMLOptionsMediaStreams/
    );
  });

  it('rejects a customizer that returns non-Media-Streams options', async () => {
    const { provider } = makeProvider({
      inboundCallTwimlHandler: () =>
        Promise.resolve({ welcomeGreeting: 'hi' } as unknown as VoiceTwiMLOptions),
    });
    const call = () => provider.handleIncomingCall({ callSid: 'CA123', extra: {} });
    await expect(call()).rejects.toThrow(TypeError);
    await expect(call()).rejects.toThrow(
      /the onInboundCallTwiml customizer output to be a VoiceTwiMLOptionsMediaStreams/
    );
  });

  it('stashes the inbound session config keyed by call SID', async () => {
    const sessionConfig = { instructions: 'per-call' };
    const config = new OpenAIRealtimeProviderConfig({
      openaiApiKey: 'sk-test',
      onInboundCallSessionConfig: () => Promise.resolve(sessionConfig),
    });
    const { provider } = makeProvider(undefined, config);

    await provider.handleIncomingCall({ callSid: 'CA123', extra: {} });

    expect(provider.peekPendingSessionConfig('CA123')).toEqual(sessionConfig);
  });

  it('stashes nothing when the inbound hook returns null', async () => {
    // A spy, not a bare arrow: asserting only the count would pass identically
    // if the hook were never invoked at all.
    const onInboundCallSessionConfig = vi.fn(() => Promise.resolve(null));
    const config = new OpenAIRealtimeProviderConfig({
      openaiApiKey: 'sk-test',
      onInboundCallSessionConfig,
    });
    const { provider } = makeProvider(undefined, config);
    const twimlRequest = { callSid: 'CA123', extra: {} };

    await provider.handleIncomingCall(twimlRequest);

    expect(onInboundCallSessionConfig).toHaveBeenCalledTimes(1);
    expect(onInboundCallSessionConfig).toHaveBeenCalledWith(twimlRequest);
    expect(provider.pendingSessionConfigCount()).toBe(0);
  });

  it('stashes nothing when the TwiML build fails', async () => {
    // The hook returns a config, but no WebSocket URL can be resolved so
    // build() throws. The webhook 500s and the call never connects to drain
    // the entry, so it must never have been stashed in the first place.
    const config = new OpenAIRealtimeProviderConfig({
      openaiApiKey: 'sk-test',
      onInboundCallSessionConfig: () => Promise.resolve({ instructions: 'never used' }),
    });
    const { provider } = makeProvider(undefined, config, minimalTacConfig);

    await expect(provider.handleIncomingCall({ callSid: 'CA123', extra: {} })).rejects.toThrow(
      /handleIncomingCall needs a WebSocket URL/
    );

    expect(provider.pendingSessionConfigCount()).toBe(0);
  });
});

describe('OpenAIRealtimeProvider outbound', () => {
  it('places a call with inline <Stream> TwiML and returns the call SID', async () => {
    const { provider, stub } = makeProvider();

    const result = await provider.initiateOutboundConversation({ to: '+15559998888' });

    expect(result.callSid).toBe('CAoutbound00000000000000000000');
    expect(stub.callsCreate).toHaveBeenCalledTimes(1);
    const params = stub.callsCreate.mock.calls[0]?.[0] as Record<string, string>;
    expect(params.to).toBe('+15559998888');
    expect(params.from).toBe('+15551234567');
    // Element-scoped and order-independent — see the inbound counterpart.
    expect(params.twiml).toMatch(/<Stream\b[^>]*\burl="wss:\/\/example\.ngrok\.io\/voice-stream"/);
  });

  it('correlates a per-call sessionConfig by the token embedded in the TwiML', async () => {
    const { provider, stub } = makeProvider();
    const sessionConfig = { instructions: 'outbound-only' };

    await provider.initiateOutboundConversation({ to: '+15559998888', sessionConfig });

    const params = stub.callsCreate.mock.calls[0]?.[0] as Record<string, string>;
    const token = /<Parameter name="_tac_session_config_token" value="([^"]+)"/.exec(
      params.twiml ?? ''
    )?.[1];
    expect(token).toBeDefined();
    expect(provider.peekPendingSessionConfig(token as string)).toEqual(sessionConfig);
    // Keyed by the token, never by the call SID — calls.create() returning the
    // SID doesn't happen-before Twilio connecting the stream.
    expect(provider.peekPendingSessionConfig('CAoutbound00000000000000000000')).toBeUndefined();
    expect(provider.pendingSessionConfigCount()).toBe(1);
  });

  it('drops the stashed session config when the call fails to place', async () => {
    const { provider } = makeProvider({
      callsCreate: () => Promise.reject(new Error('Twilio rejected the call')),
    });

    await expect(
      provider.initiateOutboundConversation({
        to: '+15559998888',
        sessionConfig: { instructions: 'never used' },
      })
    ).rejects.toThrow(/Twilio rejected the call/);

    expect(provider.pendingSessionConfigCount()).toBe(0);
  });

  it('rejects outbound twimlOptions that are not Media Streams options', async () => {
    const { provider } = makeProvider();
    const call = () =>
      provider.initiateOutboundConversation({
        to: '+15559998888',
        // A ConversationRelay-shaped object: the Media Streams schema is
        // strict, so `welcomeGreeting` is an unknown key.
        twimlOptions: { welcomeGreeting: 'hi' } as unknown as VoiceTwiMLOptions,
      });
    await expect(call()).rejects.toThrow(TypeError);
    // The whole options object is validated now, so the message names the
    // options type; pin the field path so this still proves it was
    // `twimlOptions` that was rejected.
    await expect(call()).rejects.toThrow(
      /InitiateVoiceConversationOptionsOpenAIRealtime: twimlOptions: .*welcomeGreeting/
    );
  });

  it('rejects an unknown top-level option key', async () => {
    const { provider, stub } = makeProvider();
    const call = () =>
      provider.initiateOutboundConversation({
        to: '+15559998888',
        // Typo'd key: the schema is `.strict()`, so it must not be silently
        // dropped on the way to calls.create().
        sesionConfig: { instructions: 'typo' },
      } as unknown as Parameters<typeof provider.initiateOutboundConversation>[0]);
    await expect(call()).rejects.toThrow(TypeError);
    await expect(call()).rejects.toThrow(
      /InitiateVoiceConversationOptionsOpenAIRealtime: .*sesionConfig/
    );
    expect(stub.callsCreate).not.toHaveBeenCalled();
  });

  it('rejects an empty recipient before placing a call', async () => {
    const { provider, stub } = makeProvider();
    const call = () => provider.initiateOutboundConversation({ to: '' });
    await expect(call()).rejects.toThrow(TypeError);
    await expect(call()).rejects.toThrow(/InitiateVoiceConversationOptionsOpenAIRealtime: to: /);
    expect(stub.callsCreate).not.toHaveBeenCalled();
  });

  it('copies the caller twimlOptions rather than mutating them', async () => {
    const { provider, stub } = makeProvider();
    // The kind of object a host would build once and reuse across calls.
    const twimlOptions = { customParameters: { tenant: 'acme' } };

    await provider.initiateOutboundConversation({
      to: '+15559998888',
      twimlOptions,
      sessionConfig: { instructions: 'outbound-only' },
    });

    expect(twimlOptions).toEqual({ customParameters: { tenant: 'acme' } });
    expect(twimlOptions.customParameters).not.toHaveProperty('_tac_session_config_token');
    // The token did reach the TwiML, so the assertions above aren't vacuous.
    const params = stub.callsCreate.mock.calls[0]?.[0] as Record<string, string>;
    expect(params.twiml).toContain('_tac_session_config_token');
  });
});

describe('OpenAIRealtimeProvider accessors', () => {
  it('indexes the configured tools by the name the model sends', () => {
    const tool = new TACTool(
      'lookup_order',
      'Look up an order',
      { type: 'object', properties: {} },
      () => Promise.resolve({ success: true })
    );
    const { provider } = makeProvider(
      undefined,
      new OpenAIRealtimeProviderConfig({ openaiApiKey: 'sk-test', tools: [tool] })
    );

    expect(provider.peekTool('lookup_order')).toBe(tool);
    expect(provider.peekTool('unknown_tool')).toBeUndefined();
  });

  it('returns null from getWebSocket for an unknown conversation', () => {
    const { provider } = makeProvider();
    expect(provider.getWebSocket('CH-unknown' as ConversationId)).toBeNull();
  });

  it('returns an empty transcript when no session exists', () => {
    const { provider } = makeProvider();
    expect(provider.getTranscript('CH-unknown' as ConversationId)).toEqual([]);
  });

  it('reads the transcript off the session metadata', () => {
    const { provider, stub } = makeProvider();
    const session = stub.channel.startConversationInternal('CA555' as ConversationId);
    session.metadata.transcript = [{ role: 'user', content: 'hello' }];

    const result = provider.getTranscript('CA555' as ConversationId);

    expect(result).toEqual([{ role: 'user', content: 'hello' }]);
    // Copied, not aliased: a caller must not be able to mutate the session's
    // live transcript through the returned array.
    expect(result).not.toBe(session.metadata.transcript);
  });

  it('rejects sendResponse: the model streams audio, so there is no text path', async () => {
    const { provider } = makeProvider();
    await expect(provider.sendResponse('CA1' as ConversationId, 'hello')).rejects.toThrow(
      /no text sendResponse/
    );
  });
});

describe('OpenAIRealtimeProvider session config resolution', () => {
  it('rejects a call with no session config anywhere', async () => {
    const { provider } = makeBridge();
    await expect(provider.connectModel('CA1' as ConversationId)).rejects.toThrow(
      /No sessionConfig available for call CA1/
    );
  });

  it('requires a model field on the session config', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: { audio: {} } });
    await expect(provider.connectModel('CA1' as ConversationId)).rejects.toThrow(
      /must include a 'model' field/
    );
  });

  it('rejects an input audio format Twilio cannot send', async () => {
    const { provider } = makeBridge({
      defaultSessionConfig: {
        model: 'gpt-realtime',
        audio: {
          input: { format: { type: 'audio/pcm' } },
          output: { format: { type: 'audio/pcmu' } },
        },
      },
    });
    // Names the offending direction and the value that was actually set, so a
    // developer doesn't have to guess which half of the config is wrong.
    await expect(provider.connectModel('CA1' as ConversationId)).rejects.toThrow(
      /audio\.input\.format=\{"type":"audio\/pcm"\}/
    );
    await expect(provider.connectModel('CA1' as ConversationId)).rejects.toThrow(/audio\/pcmu/);
  });

  it('rejects an output audio format Twilio cannot play', async () => {
    const { provider } = makeBridge({
      defaultSessionConfig: {
        model: 'gpt-realtime',
        audio: { input: { format: { type: 'audio/pcmu' } }, output: {} },
      },
    });
    // Pins the second loop iteration: a valid input must not mask a bad output.
    await expect(provider.connectModel('CA1' as ConversationId)).rejects.toThrow(
      /audio\.output\.format=undefined/
    );
  });

  it('sends the session config, then a welcome response when configured', async () => {
    const { provider } = makeBridge({
      defaultSessionConfig: validSessionConfig,
      welcomeGreetingResponse: { instructions: 'Greet the caller.' },
    });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);

    await vi.waitFor(() => expect(modelWs.json()).toHaveLength(2));
    expect(modelWs.json()).toEqual([
      { type: 'session.update', session: validSessionConfig },
      { type: 'response.create', response: { instructions: 'Greet the caller.' } },
    ]);
  });

  it('identifies the SDK to OpenAI alongside the bearer token', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);

    await awaitSessionUpdate(modelWs);
    const headers = vi.mocked(provider.openModelSocket).mock.calls[0]?.[1];
    expect(headers).toEqual({
      Authorization: 'Bearer sk-test',
      'User-Agent': expect.stringMatching(/^twilio-agent-connect-typescript\/\d+\.\d+\.\d+/),
    });
  });

  it('sends no welcome response when none is configured', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);

    await awaitSessionUpdate(modelWs);
    expect(modelWs.json().map(m => m.type)).toEqual(['session.update']);
  });

  it('prefers the session config stashed for this inbound call', async () => {
    const perCall = { ...validSessionConfig, instructions: 'per-call' };
    const { provider } = makeBridge({
      defaultSessionConfig: validSessionConfig,
      onInboundCallSessionConfig: () => Promise.resolve(perCall),
    });
    await provider.handleIncomingCall({ callSid: 'CA1', extra: {} });

    const modelWs = new FakeSocket();
    startCall(provider, modelWs);

    await awaitSessionUpdate(modelWs);
    expect(modelWs.json()[0]?.session).toEqual(perCall);
    // Popped, not left behind for the next call on this provider.
    expect(provider.pendingSessionConfigCount()).toBe(0);
  });

  it('re-keys an outbound session config from its token to the call SID', async () => {
    const perCall = { ...validSessionConfig, instructions: 'outbound-only' };
    const { provider, stub } = makeBridge({ defaultSessionConfig: validSessionConfig });
    await provider.initiateOutboundConversation({ to: '+15559998888', sessionConfig: perCall });
    const twiml = (stub.callsCreate.mock.calls[0]?.[0] as Record<string, string>).twiml ?? '';
    const token = /<Parameter name="_tac_session_config_token" value="([^"]+)"/.exec(twiml)?.[1];
    expect(token).toBeDefined();

    const modelWs = new FakeSocket();
    // Twilio replays the <Parameter> back as a customParameter on `start`.
    startCall(provider, modelWs, {
      customParameters: { _tac_session_config_token: token as string },
    });

    await awaitSessionUpdate(modelWs);
    expect(modelWs.json()[0]?.session).toEqual(perCall);
    expect(provider.pendingSessionConfigCount()).toBe(0);
  });
});

describe('OpenAIRealtimeProvider audio bridge', () => {
  it('tracks the call on the session when the stream starts', async () => {
    const { provider, stub } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    const session = stub.sessions.get('CA1');
    expect(session?.callSid).toBe('CA1');
    expect(session?.metadata.streamSid).toBe('MZ1');
    expect(session?.metadata.transcript).toEqual([]);
    expect(provider.getWebSocket('CA1' as ConversationId)).toBe(twilioWs);
  });

  it('forwards caller audio to the model as input_audio_buffer.append', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    twilioWs.emit(
      'message',
      Buffer.from(JSON.stringify({ event: 'media', media: { payload: 'BASE64AUDIO' } }))
    );

    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual({
        type: 'input_audio_buffer.append',
        audio: 'BASE64AUDIO',
      })
    );
  });

  it('queues caller audio that arrives while the model is still connecting', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const { twilioWs, openModelSocket } = startCallWithPendingHandshake(provider);

    // Twilio never waits for the OpenAI handshake: a caller who says "Hello?"
    // the instant the call connects is already streaming audio by now.
    sendMedia(twilioWs, 'FRAME_1');
    sendMedia(twilioWs, 'FRAME_2');
    sendMedia(twilioWs, 'FRAME_3');
    expect(modelWs.sent).toEqual([]);

    openModelSocket(modelWs);

    // None of the three were dropped, and they arrive in the order they were
    // spoken — behind the session config, which the handshake sends first.
    await vi.waitFor(() => expect(modelWs.json()).toHaveLength(4));
    expect(modelWs.json()).toEqual([
      { type: 'session.update', session: validSessionConfig },
      { type: 'input_audio_buffer.append', audio: 'FRAME_1' },
      { type: 'input_audio_buffer.append', audio: 'FRAME_2' },
      { type: 'input_audio_buffer.append', audio: 'FRAME_3' },
    ]);
  });

  it('drops queued caller audio quietly when the model handshake fails', async () => {
    const { provider, stub } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    const logError = vi.spyOn(noopLogger, 'error');

    try {
      const { twilioWs, failModelSocket } = startCallWithPendingHandshake(provider);
      sendMedia(twilioWs, 'FRAME_1');
      sendMedia(twilioWs, 'FRAME_2');

      failModelSocket(new Error('OpenAI refused the handshake'));

      // The `start` path owns this failure and ends the call.
      await vi.waitFor(() => expect(twilioWs.closed).toBe(true));
      await vi.waitFor(() => expect(stub.ended).toEqual(['CA1']));
      // An unhandledRejection is reported a macrotask later, so give it a turn
      // before asserting there wasn't one.
      await new Promise(resolve => setImmediate(resolve));

      expect(modelWs.sent).toEqual([]);
      expect(unhandled).toEqual([]);
      // The queued frames must not each re-report the one failure the `start`
      // path already handled.
      expect(logError).not.toHaveBeenCalledWith(
        expect.anything(),
        'Unhandled error in Media Stream message handler'
      );
    } finally {
      logError.mockRestore();
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('forwards model audio back to Twilio tagged with the streamSid', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const delta = Buffer.alloc(160).toString('base64');

    modelWs.emit(
      'message',
      JSON.stringify({ type: 'response.output_audio.delta', item_id: 'item_1', delta })
    );

    await vi.waitFor(() =>
      expect(twilioWs.json()).toContainEqual({
        event: 'media',
        streamSid: 'MZ1',
        media: { payload: delta },
      })
    );
  });

  it('keeps the call alive when one model event is malformed', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const delta = Buffer.alloc(160).toString('base64');

    modelWs.emit('message', 'not json at all');
    modelWs.emit(
      'message',
      JSON.stringify({ type: 'response.output_audio.delta', item_id: 'item_1', delta })
    );

    await vi.waitFor(() => expect(twilioWs.json()).toHaveLength(1));
    expect(twilioWs.closed).toBe(false);
    expect(modelWs.closed).toBe(false);
  });

  it('accumulates both sides of the conversation on the transcript', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    modelWs.emit(
      'message',
      JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: 'I need to check my order',
      })
    );
    modelWs.emit(
      'message',
      JSON.stringify({
        type: 'response.done',
        response: {
          output: [
            { role: 'assistant', content: [{ transcript: 'Sure, what is the order number?' }] },
            // Not an assistant turn: a tool call carries no spoken transcript.
            { role: 'tool', content: [{ transcript: 'ignored' }] },
          ],
        },
      })
    );

    await vi.waitFor(() =>
      expect(provider.getTranscript('CA1' as ConversationId)).toEqual([
        { role: 'user', text: 'I need to check my order' },
        { role: 'assistant', text: 'Sure, what is the order number?' },
      ])
    );
  });

  it('tears down the Twilio socket when the model socket closes first', async () => {
    const { provider, stub } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const logInfo = vi.spyOn(noopLogger, 'info');

    try {
      // The caller must not be left connected to silence.
      modelWs.close();

      await vi.waitFor(() => expect(twilioWs.closed).toBe(true));
      // Cleanup is idempotent: the Twilio close it triggers must not end the
      // conversation a second time.
      await vi.waitFor(() => expect(stub.ended).toEqual(['CA1']));
      expect(provider.getWebSocket('CA1' as ConversationId)).toBeNull();
      // The one case where the model really did go away on its own.
      expect(logInfo).toHaveBeenCalledWith(expect.anything(), 'Model connection ended');
    } finally {
      logInfo.mockRestore();
    }
  });

  it('tears down the Twilio socket when the model connection fails', async () => {
    // No defaultSessionConfig, so connectModel throws before opening anything.
    const { provider, stub } = makeBridge();
    const twilioWs = new FakeSocket();
    provider.handleWebSocket(twilioWs as unknown as WebSocket);
    twilioWs.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          event: 'start',
          start: { streamSid: 'MZ1', callSid: 'CA1', customParameters: {} },
        })
      )
    );

    await vi.waitFor(() => expect(twilioWs.closed).toBe(true));
    await vi.waitFor(() => expect(stub.ended).toEqual(['CA1']));
  });

  it('closes the model socket when Twilio sends stop', async () => {
    const { provider, stub } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const logInfo = vi.spyOn(noopLogger, 'info');

    try {
      twilioWs.emit('message', Buffer.from(JSON.stringify({ event: 'stop' })));

      await vi.waitFor(() => expect(modelWs.closed).toBe(true));
      await vi.waitFor(() => expect(stub.ended).toEqual(['CA1']));
      // An event handler has no endpoint to return from, so the caller's leg
      // only drops if `stop` closes it explicitly.
      await vi.waitFor(() => expect(twilioWs.closed).toBe(true));
      // The model socket closed because cleanup closed it, not because the
      // model went away — reporting that on an ordinary hangup is misleading.
      expect(logInfo).not.toHaveBeenCalledWith(expect.anything(), 'Model connection ended');
    } finally {
      logInfo.mockRestore();
    }
  });

  it('cleans up when the Twilio socket closes without a stop event', async () => {
    const { provider, stub } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    twilioWs.close();

    await vi.waitFor(() => expect(modelWs.closed).toBe(true));
    await vi.waitFor(() => expect(stub.ended).toEqual(['CA1']));
    expect(provider.getWebSocket('CA1' as ConversationId)).toBeNull();
  });

  it('drops caller audio once the call has been cleaned up', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    twilioWs.emit('message', Buffer.from(JSON.stringify({ event: 'stop' })));
    await vi.waitFor(() => expect(modelWs.closed).toBe(true));
    const sentBefore = modelWs.sent.length;

    twilioWs.emit(
      'message',
      Buffer.from(JSON.stringify({ event: 'media', media: { payload: 'BASE64AUDIO' } }))
    );

    // A drain, not a waitFor: waitFor passes on its first attempt, so it would
    // also pass against an implementation that sent the frame a tick later.
    await drain();
    expect(modelWs.sent).toHaveLength(sentBefore);
  });

  it('closes the model socket when the call ended during the handshake', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const { twilioWs, openModelSocket } = startCallWithPendingHandshake(provider);
    const modelWs = new FakeSocket();

    // The caller hangs up while OpenAI is still completing its handshake.
    twilioWs.close();
    await vi.waitFor(() => expect(provider.getWebSocket('CA1' as ConversationId)).toBeNull());

    openModelSocket(modelWs);

    // Nothing tracks this socket now, so it must not be left open.
    await vi.waitFor(() => expect(modelWs.closed).toBe(true));
    expect(modelWs.sent).toEqual([]);
  });

  it('tears down the Twilio socket when the model socket errors', async () => {
    const { provider, stub } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    // An error, not a close: `ws` reports a broken socket either way.
    modelWs.emit('error', new Error('model socket blew up'));

    await vi.waitFor(() => expect(twilioWs.closed).toBe(true));
    await vi.waitFor(() => expect(stub.ended).toEqual(['CA1']));
    expect(provider.getWebSocket('CA1' as ConversationId)).toBeNull();
  });

  it('reports a Twilio socket error to the host', async () => {
    const { provider, stub } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const error = new Error('Twilio socket blew up');

    twilioWs.emit('error', error);

    // Nothing rethrows here, so routing it to the host is the only way it
    // reaches the application at all.
    expect(stub.errors).toEqual([error]);
  });

  it('handles one model event to completion before starting the next', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstInFlight = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    // Stands in for the awaited work barge-in and tool calling will do: today
    // every dispatch path is synchronous, so nothing else would interleave.
    const dispatch = vi
      .spyOn(
        provider as unknown as {
          dispatchModelEvent: (
            conversationId: ConversationId,
            session: ConversationSession,
            event: Record<string, unknown>
          ) => Promise<void>;
        },
        'dispatchModelEvent'
      )
      .mockImplementation(async (_conversationId, _session, event) => {
        const type = event.type as string;
        order.push(`start:${type}`);
        if (type === 'slow') {
          await firstInFlight;
        }
        order.push(`end:${type}`);
      });

    try {
      modelWs.emit('message', JSON.stringify({ type: 'slow' }));
      modelWs.emit('message', JSON.stringify({ type: 'fast' }));
      await drain();

      // The second event must not begin while the first is still awaiting.
      expect(order).toEqual(['start:slow']);

      releaseFirst();

      await vi.waitFor(() =>
        expect(order).toEqual(['start:slow', 'end:slow', 'start:fast', 'end:fast'])
      );
    } finally {
      dispatch.mockRestore();
    }
  });

  it('marks a response active on response.created', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    expect(callState(provider, 'CA1').bargeIn.responseActive).toBe(false);

    modelWs.emit('message', JSON.stringify({ type: 'response.created' }));

    // Barge-in reads this to decide whether a `response.cancel` has anything
    // to cancel.
    await vi.waitFor(() => expect(callState(provider, 'CA1').bargeIn.responseActive).toBe(true));
  });

  it('logs a response.cancel that raced response.done at debug', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const logDebug = vi.spyOn(noopLogger, 'debug');
    const logError = vi.spyOn(noopLogger, 'error');

    try {
      modelWs.emit(
        'message',
        JSON.stringify({ type: 'error', error: { code: 'response_cancel_not_active' } })
      );

      await vi.waitFor(() =>
        expect(logDebug).toHaveBeenCalledWith(
          expect.objectContaining({ error: { code: 'response_cancel_not_active' } }),
          'response.cancel raced response.done'
        )
      );
      // A benign race must not be reported as a fault.
      expect(logError).not.toHaveBeenCalled();
    } finally {
      logDebug.mockRestore();
      logError.mockRestore();
    }
  });

  it('logs any other model error event at error', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const logError = vi.spyOn(noopLogger, 'error');

    try {
      modelWs.emit(
        'message',
        JSON.stringify({ type: 'error', error: { code: 'invalid_request_error' } })
      );

      await vi.waitFor(() =>
        expect(logError).toHaveBeenCalledWith(
          expect.objectContaining({ error: { code: 'invalid_request_error' } }),
          'OpenAI Realtime error event'
        )
      );
      // One bad event is not a hangup.
      expect(provider.getWebSocket('CA1' as ConversationId)).not.toBeNull();
    } finally {
      logError.mockRestore();
    }
  });

  it('clears tracked calls and pending session configs on shutdown', async () => {
    const { provider } = makeBridge({
      defaultSessionConfig: validSessionConfig,
      onInboundCallSessionConfig: () => Promise.resolve({ instructions: 'never connects' }),
    });
    // A call Twilio never connects — its stashed override has nothing left to
    // drain it.
    await provider.handleIncomingCall({ callSid: 'CA-unanswered', extra: {} });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    expect(provider.getWebSocket('CA1' as ConversationId)).not.toBeNull();
    expect(provider.pendingSessionConfigCount()).toBe(1);

    provider.shutdown();

    expect(provider.getWebSocket('CA1' as ConversationId)).toBeNull();
    expect(provider.pendingSessionConfigCount()).toBe(0);
  });
});

describe('OpenAIRealtimeProvider barge-in', () => {
  /**
   * A connected call with a response in flight and `deltaBytes` of assistant
   * audio already delivered to Twilio for `item_1`.
   */
  async function callWithAudioSent(deltaBytes: number): Promise<{
    provider: OpenAIRealtimeProvider;
    modelWs: FakeSocket;
    twilioWs: FakeSocket;
  }> {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    modelWs.emit('message', JSON.stringify({ type: 'response.created' }));
    sendAudioDelta(modelWs, 'item_1', deltaBytes);
    await vi.waitFor(() => expect(mediaSent(twilioWs)).toHaveLength(1));

    return { provider, modelWs, twilioWs };
  }

  /** Emit the VAD event that signals the caller has started talking. */
  function sendSpeechStarted(modelWs: FakeSocket): void {
    modelWs.emit('message', JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
  }

  /** Emit `bytes` of assistant audio for `itemId` — 8 bytes is one millisecond. */
  function sendAudioDelta(modelWs: FakeSocket, itemId: string, bytes: number): void {
    modelWs.emit(
      'message',
      JSON.stringify({
        type: 'response.output_audio.delta',
        item_id: itemId,
        delta: Buffer.alloc(bytes).toString('base64'),
      })
    );
  }

  /**
   * Only the audio frames written to Twilio — counting every message instead
   * would fold in the `clear` a barge-in sends on the same socket.
   */
  function mediaSent(twilioWs: FakeSocket): Record<string, unknown>[] {
    return twilioWs.json().filter(message => message.event === 'media');
  }

  it('truncates at the duration derived from bytes sent', async () => {
    const { modelWs } = await callWithAudioSent(1600);

    sendSpeechStarted(modelWs);

    // 1600 bytes of 8kHz u-law is exactly 200ms. A wall-clock estimate would
    // land somewhere else entirely, and anything over the item's real content
    // is rejected outright.
    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual({
        type: 'conversation.item.truncate',
        item_id: 'item_1',
        content_index: 0,
        audio_end_ms: 200,
      })
    );
  });

  it('cancels the in-flight response and clears Twilio playback', async () => {
    const { provider, modelWs, twilioWs } = await callWithAudioSent(1600);

    sendSpeechStarted(modelWs);

    await vi.waitFor(() => expect(modelWs.json()).toContainEqual({ type: 'response.cancel' }));
    await vi.waitFor(() =>
      expect(twilioWs.json()).toContainEqual({ event: 'clear', streamSid: 'MZ1' })
    );
    expect(callState(provider, 'CA1').bargeIn.responseActive).toBe(false);
  });

  it('sends no response.cancel when no response is in flight', async () => {
    const { modelWs } = await callWithAudioSent(1600);
    modelWs.emit('message', JSON.stringify({ type: 'response.done', response: { output: [] } }));

    sendSpeechStarted(modelWs);

    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual({
        type: 'conversation.item.truncate',
        item_id: 'item_1',
        content_index: 0,
        audio_end_ms: 200,
      })
    );
    // A cancel with nothing to cancel is itself an error event.
    await drain();
    expect(modelWs.json()).not.toContainEqual({ type: 'response.cancel' });
  });

  it('does nothing when no assistant audio has been sent', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    const twilioWs = startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    modelWs.emit('message', JSON.stringify({ type: 'response.created' }));

    sendSpeechStarted(modelWs);

    // Nothing is queued at Twilio, so there is nothing to truncate or clear —
    // and no item id to name in a truncate.
    await drain();
    expect(modelWs.json()).toEqual([{ type: 'session.update', session: validSessionConfig }]);
    expect(twilioWs.sent).toEqual([]);
  });

  it('drops further audio for an item already truncated', async () => {
    const { modelWs, twilioWs } = await callWithAudioSent(1600);
    sendSpeechStarted(modelWs);
    await vi.waitFor(() =>
      expect(twilioWs.json()).toContainEqual(expect.objectContaining({ event: 'clear' }))
    );

    sendAudioDelta(modelWs, 'item_1', 160);

    // Playing more of a reply the caller already talked over would undo the
    // clear that just stopped it.
    await drain();
    expect(mediaSent(twilioWs)).toHaveLength(1);
  });

  it('resumes audio for a new item after a barge-in', async () => {
    const { modelWs, twilioWs } = await callWithAudioSent(1600);
    sendSpeechStarted(modelWs);
    await vi.waitFor(() =>
      expect(twilioWs.json()).toContainEqual(expect.objectContaining({ event: 'clear' }))
    );

    modelWs.emit('message', JSON.stringify({ type: 'response.created' }));
    sendAudioDelta(modelWs, 'item_2', 800);

    // Only the item the barge-in truncated is muted: muting on "a barge-in
    // happened at all" would leave the call silent for the rest of its life.
    await vi.waitFor(() => expect(mediaSent(twilioWs)).toHaveLength(2));
  });

  it('is a no-op on a second barge-in with nothing newly sent', async () => {
    const { modelWs } = await callWithAudioSent(1600);
    sendSpeechStarted(modelWs);
    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual(
        expect.objectContaining({ type: 'conversation.item.truncate' })
      )
    );

    sendSpeechStarted(modelWs);

    // The count was reset by the first barge-in, so a second truncate would
    // land at audio_end_ms 0 and wipe the model's memory of the whole reply —
    // including the part the caller actually heard.
    await drain();
    expect(modelWs.json().filter(m => m.type === 'conversation.item.truncate')).toHaveLength(1);
  });

  it('accumulates the audio duration across deltas for one item', async () => {
    const { modelWs, twilioWs } = await callWithAudioSent(800);
    sendAudioDelta(modelWs, 'item_1', 800);
    await vi.waitFor(() => expect(mediaSent(twilioWs)).toHaveLength(2));

    sendSpeechStarted(modelWs);

    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual({
        type: 'conversation.item.truncate',
        item_id: 'item_1',
        content_index: 0,
        audio_end_ms: 200,
      })
    );
  });

  it('floors each delta separately rather than the running total', async () => {
    const { modelWs, twilioWs } = await callWithAudioSent(100);
    sendAudioDelta(modelWs, 'item_1', 100);
    await vi.waitFor(() => expect(mediaSent(twilioWs)).toHaveLength(2));

    sendSpeechStarted(modelWs);

    // 100 bytes is 12.5ms, so 24 is the only value that fits flooring each
    // delta on its own: ceil or round would give 26, and flooring the 200-byte
    // total instead would give 25. Understating is the safe direction —
    // `conversation.item.truncate` rejects an `audio_end_ms` past the item's
    // real content, so a truncate at 25 or 26 would be rejected outright.
    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual({
        type: 'conversation.item.truncate',
        item_id: 'item_1',
        content_index: 0,
        audio_end_ms: 24,
      })
    );
  });

  it('restarts the audio duration count on a new item', async () => {
    const { modelWs, twilioWs } = await callWithAudioSent(1600);
    sendAudioDelta(modelWs, 'item_2', 800);
    await vi.waitFor(() => expect(mediaSent(twilioWs)).toHaveLength(2));

    sendSpeechStarted(modelWs);

    // 100ms, not the 300ms the two items sum to: item_2 has only 800 bytes of
    // content, so a carried-over count would overrun it.
    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual({
        type: 'conversation.item.truncate',
        item_id: 'item_2',
        content_index: 0,
        audio_end_ms: 100,
      })
    );
  });
});

describe('OpenAIRealtimeProvider openModelSocket', () => {
  it('resolves an open socket carrying the supplied headers', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>(resolve => server.once('listening', resolve));
    let receivedAuth: string | undefined;
    server.on('connection', (_socket, request) => {
      receivedAuth = request.headers.authorization;
    });
    const { port } = server.address() as AddressInfo;
    const { provider } = makeBridge();

    const socket = await provider.openModelSocket(`ws://127.0.0.1:${port}`, {
      Authorization: 'Bearer sk-test',
    });

    try {
      expect(socket.readyState).toBe(socket.OPEN);
      expect(receivedAuth).toBe('Bearer sk-test');
      // Node throws on a listener-less 'error' emission and `ws` emits one for
      // any frame its receiver rejects, so a socket handed back bare could take
      // the process down before its caller wires anything up.
      expect(socket.listenerCount('error')).toBeGreaterThan(0);
    } finally {
      socket.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('rejects when the handshake is refused', async () => {
    // A refused upgrade rather than a closed port: the server stays bound for
    // the whole test, so there is no window in which another process can take
    // the port and turn the expected rejection into a connection.
    const server = new WebSocketServer({ port: 0, verifyClient: (_info, cb) => cb(false, 401) });
    await new Promise<void>(resolve => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const { provider } = makeBridge();

    try {
      await expect(provider.openModelSocket(`ws://127.0.0.1:${port}`, {})).rejects.toThrow(/401/);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe('OpenAIRealtimeProvider tool calling', () => {
  /** Emit a completed `function_call` output item from the model. */
  function sendFunctionCall(modelWs: FakeSocket, item: Record<string, unknown>): void {
    modelWs.emit(
      'message',
      JSON.stringify({
        type: 'response.output_item.done',
        item: { type: 'function_call', status: 'completed', ...item },
      })
    );
  }

  /** The `function_call_output` item the provider sent back, if any. */
  function functionCallOutput(modelWs: FakeSocket): Record<string, unknown> | undefined {
    const event = modelWs.json().find(sent => sent.type === 'conversation.item.create') as
      | Record<string, unknown>
      | undefined;
    return event?.item as Record<string, unknown> | undefined;
  }

  it('runs the tool and returns its result, then asks for a response', async () => {
    const tool = new TACTool(
      'get_weather',
      'Get the weather',
      { type: 'object', properties: { city: { type: 'string' } } },
      () => Promise.resolve('sunny')
    );
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig, tools: [tool] });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    sendFunctionCall(modelWs, {
      call_id: 'call_1',
      name: 'get_weather',
      arguments: '{"city":"Denver"}',
    });

    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '"sunny"',
        },
      })
    );
    // The result alone is inert: the model only speaks once asked to respond.
    expect(modelWs.json()).toContainEqual({ type: 'response.create' });
    // And the result has to land first — asked to respond before the output is
    // in its context, the model answers from nothing and the result arrives
    // orphaned.
    const types = modelWs.json().map(sent => sent.type);
    expect(types.indexOf('conversation.item.create')).toBeLessThan(
      types.indexOf('response.create')
    );
  });

  it('passes the parsed arguments to the tool as one object', async () => {
    let received: unknown;
    const tool = new TACTool(
      'get_weather',
      'Get the weather',
      { type: 'object', properties: { city: { type: 'string' } } },
      (params: unknown) => {
        received = params;
        return Promise.resolve('sunny');
      }
    );
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig, tools: [tool] });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    sendFunctionCall(modelWs, {
      call_id: 'call_1',
      name: 'get_weather',
      arguments: '{"city":"Denver"}',
    });

    // A single params object, not spread keyword arguments: TS tools take one
    // argument, so spreading would call the tool with the wrong shape.
    await vi.waitFor(() => expect(received).toEqual({ city: 'Denver' }));
  });

  it('reports an unknown tool as output rather than throwing', async () => {
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    sendFunctionCall(modelWs, { call_id: 'call_2', name: 'no_such_tool', arguments: '{}' });

    await vi.waitFor(() => expect(functionCallOutput(modelWs)).toBeDefined());
    const item = functionCallOutput(modelWs) as Record<string, unknown>;
    expect(item.call_id).toBe('call_2');
    expect(JSON.parse(item.output as string)).toEqual({ error: "Unknown tool 'no_such_tool'" });
  });

  it('reports a throwing tool as output rather than killing the call', async () => {
    const tool = new TACTool(
      'get_weather',
      'Get the weather',
      { type: 'object', properties: {} },
      () => {
        throw new Error('upstream 500');
      }
    );
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig, tools: [tool] });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    sendFunctionCall(modelWs, { call_id: 'call_1', name: 'get_weather', arguments: '{}' });

    await vi.waitFor(() => expect(functionCallOutput(modelWs)).toBeDefined());
    const item = functionCallOutput(modelWs) as Record<string, unknown>;
    const output = JSON.parse(item.output as string) as { error: string };
    expect(output.error).toMatch(/failed to execute/);
    // The model may read its input aloud, so upstream detail must not reach it.
    expect(output.error).not.toContain('upstream 500');
    expect(provider.getWebSocket('CA1' as ConversationId)).not.toBeNull();
  });

  it('still answers the call_id when the tool result is not serializable', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const tool = new TACTool(
      'get_weather',
      'Get the weather',
      { type: 'object', properties: {} },
      () => Promise.resolve(circular)
    );
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig, tools: [tool] });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    sendFunctionCall(modelWs, { call_id: 'call_1', name: 'get_weather', arguments: '{}' });

    await vi.waitFor(() => expect(functionCallOutput(modelWs)).toBeDefined());
    const item = functionCallOutput(modelWs) as Record<string, unknown>;
    expect(item.call_id).toBe('call_1');
    expect((JSON.parse(item.output as string) as { error: string }).error).toMatch(
      /non-serializable/
    );
  });

  it('answers the call_id with null when the tool returns nothing', async () => {
    const tool = new TACTool(
      'log_complaint',
      'Log a complaint',
      { type: 'object', properties: {} },
      async () => {}
    );
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig, tools: [tool] });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    sendFunctionCall(modelWs, { call_id: 'call_1', name: 'log_complaint', arguments: '{}' });

    // `JSON.stringify(undefined)` is `undefined`, not `"null"`, and would drop
    // the required `output` field — leaving the model waiting on `call_1`.
    await vi.waitFor(() =>
      expect(modelWs.json()).toContainEqual({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: 'call_1', output: 'null' },
      })
    );
  });

  it('ignores an incomplete function call so a truncated arguments fragment never runs', async () => {
    let ran = false;
    const tool = new TACTool(
      'get_weather',
      'Get the weather',
      { type: 'object', properties: { city: { type: 'string' } } },
      () => {
        ran = true;
        return Promise.resolve('sunny');
      }
    );
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig, tools: [tool] });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const before = modelWs.sent.length;

    // A call cut short by an interruption: `arguments` is a partial fragment,
    // so running the tool would mean running it on garbage.
    modelWs.emit(
      'message',
      JSON.stringify({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          status: 'incomplete',
          call_id: 'call_1',
          name: 'get_weather',
          arguments: '{"cit',
        },
      })
    );

    await drain();
    expect(modelWs.sent.length).toBe(before);
    expect(ran).toBe(false);
  });

  it('ignores a completed message item so an ordinary assistant turn never reaches the tool handler', async () => {
    const tool = new TACTool(
      'get_weather',
      'Get the weather',
      { type: 'object', properties: {} },
      () => Promise.resolve('sunny')
    );
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig, tools: [tool] });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const before = modelWs.sent.length;
    const logError = vi.spyOn(noopLogger, 'error');

    try {
      // Every spoken assistant turn ends in one of these. Handled as a function
      // call it is a malformed one, so each turn would error-log.
      modelWs.emit(
        'message',
        JSON.stringify({
          type: 'response.output_item.done',
          item: {
            id: 'item_1',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'audio', transcript: 'The weather is sunny.' }],
          },
        })
      );

      await drain();
      expect(modelWs.sent.length).toBe(before);
      expect(logError).not.toHaveBeenCalled();
    } finally {
      logError.mockRestore();
    }
  });

  it('drops a function call with an empty call_id instead of sending an unaddressed output', async () => {
    const tool = new TACTool(
      'get_weather',
      'Get the weather',
      { type: 'object', properties: {} },
      () => Promise.resolve('sunny')
    );
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig, tools: [tool] });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const before = modelWs.sent.length;

    sendFunctionCall(modelWs, { call_id: '', name: 'get_weather', arguments: '{}' });

    await drain();
    expect(modelWs.sent.length).toBe(before);
  });

  it('drops a function call with no call_id instead of sending an unaddressed output', async () => {
    const tool = new TACTool(
      'get_weather',
      'Get the weather',
      { type: 'object', properties: {} },
      () => Promise.resolve('sunny')
    );
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig, tools: [tool] });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);
    const before = modelWs.sent.length;

    sendFunctionCall(modelWs, { name: 'get_weather', arguments: '{}' });

    await drain();
    expect(modelWs.sent.length).toBe(before);
  });

  it('answers a function call with no name without running any tool', async () => {
    let ran = false;
    const tool = new TACTool(
      'get_weather',
      'Get the weather',
      { type: 'object', properties: {} },
      () => {
        ran = true;
        return Promise.resolve('sunny');
      }
    );
    const { provider } = makeBridge({ defaultSessionConfig: validSessionConfig, tools: [tool] });
    const modelWs = new FakeSocket();
    startCall(provider, modelWs);
    await awaitSessionUpdate(modelWs);

    sendFunctionCall(modelWs, { call_id: 'call_3', arguments: '{}' });

    await vi.waitFor(() => expect(functionCallOutput(modelWs)).toBeDefined());
    const item = functionCallOutput(modelWs) as Record<string, unknown>;
    expect(item.call_id).toBe('call_3');
    expect(JSON.parse(item.output as string)).toEqual({
      error: 'Malformed function call: missing tool name.',
    });
    // No name means no tool can be selected, so none runs.
    expect(ran).toBe(false);
  });
});

describe('OpenAIRealtimeProvider call-event callback wiring', () => {
  /**
   * Places an outbound call with the given handler flags and optional
   * channel-level TACConfig, then returns the params passed to calls.create().
   */
  async function placeCall(
    callEventHandlers: { status?: boolean; amd?: boolean; recording?: boolean },
    channelTacConfig?: TACConfig
  ): Promise<Record<string, unknown>> {
    const { provider, stub } = makeProvider({ callEventHandlers, channelTacConfig });
    await provider.initiateOutboundConversation({ to: '+15559876543' });
    return stub.callsCreate.mock.calls[0][0] as Record<string, unknown>;
  }

  it('wires no callback URL when no handler is registered', async () => {
    const params = await placeCall({});
    expect(params.statusCallback).toBeUndefined();
    expect(params.asyncAmdStatusCallback).toBeUndefined();
    expect(params.recordingStatusCallback).toBeUndefined();
  });

  it('wires each callback only for its own registered handler', async () => {
    const params = await placeCall({ amd: true });
    expect(params.asyncAmdStatusCallback).toBe('https://example.ngrok.io/twilio/call-events/amd');
    expect(params.statusCallback).toBeUndefined();
    expect(params.recordingStatusCallback).toBeUndefined();
  });

  it('wires all three when all three handlers are registered', async () => {
    const params = await placeCall({ status: true, amd: true, recording: true });
    expect(params.statusCallback).toBe('https://example.ngrok.io/twilio/call-events/status');
    expect(params.asyncAmdStatusCallback).toBe('https://example.ngrok.io/twilio/call-events/amd');
    expect(params.recordingStatusCallback).toBe(
      'https://example.ngrok.io/twilio/call-events/recording'
    );
  });

  it('wires nothing when the config cannot derive a callback URL', async () => {
    // The channel's config has no voicePublicDomain, so callEventUrl() returns
    // undefined. The provider-level tacConfig still has the domain so TwiML
    // generation succeeds — only callback wiring is suppressed.
    const params = await placeCall({ status: true, amd: true, recording: true }, minimalTacConfig);
    expect(params.statusCallback).toBeUndefined();
    expect(params.asyncAmdStatusCallback).toBeUndefined();
    expect(params.recordingStatusCallback).toBeUndefined();
  });
});
