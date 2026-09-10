import { describe, it, expect, vi } from 'vitest';
// Imported from the package root on purpose: this also proves the barrel export
// chain re-exports the provider.
import { OpenAIRealtimeProvider, OpenAIRealtimeProviderConfig } from '@twilio/tac-core';
import type {
  ConversationId,
  ConversationSession,
  InboundCallTwimlHandler,
  ProfileId,
  VoiceChannel,
  VoiceTwiMLOptions,
} from '@twilio/tac-core';
import { TACTool } from '@twilio/tac-tools';
import { TACConfig } from '../packages/core/src/lib/config';
import type { Logger } from '../packages/core/src/lib/logger';

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
}): StubChannel {
  const sessions = new Map<string, ConversationSession>();
  const ended: string[] = [];
  const errors: Error[] = [];
  const callsCreate = vi.fn(
    options?.callsCreate ?? (() => Promise.resolve({ sid: 'CAoutbound00000000000000000000' }))
  );

  const channel = {
    getLoggerInternal: () => noopLogger,
    getTacConfig: () => tacConfig,
    getCallEventHandlers: () => ({ status: undefined, amd: undefined, recording: undefined }),
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
});
