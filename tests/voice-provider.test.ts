import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ConversationRelayProvider,
  ConversationRelayProviderConfig,
  VoiceChannel,
  VoiceProvider,
  VoiceProviderConfig,
} from '@twilio/tac-core';
import type { CallEventKind, ConversationId, MemoryMode, TAC } from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';

type CallEventHandlers = ReturnType<VoiceChannel['getCallEventHandlers']>;

/**
 * Minimal subclass that re-exposes the protected surface under test. Mirrors
 * how the real providers reach this helper when building call params.
 */
class TestProvider extends VoiceProvider {
  public applyCallbacks(callParams: Record<string, unknown>): Record<string, unknown> {
    return this.applyCallEventCallbacks(callParams);
  }
}

/**
 * Partial `VoiceChannel` exposing only what `applyCallEventCallbacks` reads.
 */
function makeProvider(options: {
  handlers?: Partial<CallEventHandlers>;
  publicDomain?: string | undefined;
}): TestProvider {
  const channel = {
    getCallEventHandlers: (): CallEventHandlers => ({
      status: undefined,
      amd: undefined,
      recording: undefined,
      ...options.handlers,
    }),
    getTacConfig: () => ({
      callEventUrl: (kind: CallEventKind): string | undefined =>
        options.publicDomain === undefined
          ? undefined
          : `https://${options.publicDomain}/voice/call-event/${kind}`,
    }),
  } as unknown as VoiceChannel;
  return new TestProvider(channel);
}

const noopHandler = (): void => {};

describe('VoiceProvider', () => {
  it('defaults channelName to VOICE', () => {
    const provider = new VoiceProvider({} as never);
    expect(provider.channelName).toBe('VOICE');
  });

  it('rejects unsupported inbound calls by naming the subclass', async () => {
    class Bare extends VoiceProvider {}
    await expect(new Bare({} as never).handleIncomingCall()).rejects.toThrow(
      /Bare does not support inbound calls/
    );
  });

  it('acknowledges handleTwilioProviderCallback with an empty 200 by default', async () => {
    await expect(new VoiceProvider({} as never).handleTwilioProviderCallback({})).resolves.toEqual({
      status: 200,
      content: '',
      contentType: 'text/plain',
    });
  });

  it('returns null from getWebSocket by default', () => {
    expect(new VoiceProvider({} as never).getWebSocket('CH123')).toBeNull();
  });

  it('rejects unsupported streaming responses by naming the subclass', async () => {
    class Bare extends VoiceProvider {}
    await expect(
      new Bare({} as never).sendStreamingResponse(
        'CH123',
        (async function* () {
          yield 'hi';
        })()
      )
    ).rejects.toThrow(/Bare does not support sendStreamingResponse/);
  });
});

describe('VoiceProvider.applyCallEventCallbacks', () => {
  it('leaves the key absent when the handler is unregistered', () => {
    const provider = makeProvider({ publicDomain: 'example.ngrok.io' });
    const params = provider.applyCallbacks({});
    expect(params).not.toHaveProperty('statusCallback');
    expect(params).not.toHaveProperty('asyncAmdStatusCallback');
    expect(params).not.toHaveProperty('recordingStatusCallback');
  });

  it('derives each URL from callEventUrl for registered handlers', () => {
    const provider = makeProvider({
      handlers: { status: noopHandler, amd: noopHandler, recording: noopHandler },
      publicDomain: 'example.ngrok.io',
    });
    expect(provider.applyCallbacks({})).toEqual({
      statusCallback: 'https://example.ngrok.io/voice/call-event/status',
      asyncAmdStatusCallback: 'https://example.ngrok.io/voice/call-event/amd',
      recordingStatusCallback: 'https://example.ngrok.io/voice/call-event/recording',
    });
  });

  it('only wires the kinds whose handlers are registered', () => {
    const provider = makeProvider({
      handlers: { amd: noopHandler },
      publicDomain: 'example.ngrok.io',
    });
    expect(provider.applyCallbacks({})).toEqual({
      asyncAmdStatusCallback: 'https://example.ngrok.io/voice/call-event/amd',
    });
  });

  it('never overwrites an explicitly provided URL', () => {
    const provider = makeProvider({
      handlers: { status: noopHandler },
      publicDomain: 'example.ngrok.io',
    });
    expect(provider.applyCallbacks({ statusCallback: 'https://explicit.example/status' })).toEqual({
      statusCallback: 'https://explicit.example/status',
    });
  });

  it('preserves an explicit null rather than replacing it with a derived URL', () => {
    const provider = makeProvider({
      handlers: { status: noopHandler },
      publicDomain: 'example.ngrok.io',
    });
    expect(provider.applyCallbacks({ statusCallback: null })).toEqual({ statusCallback: null });
  });

  it('adds nothing when callEventUrl returns undefined', () => {
    const provider = makeProvider({
      handlers: { status: noopHandler },
      publicDomain: undefined,
    });
    expect(provider.applyCallbacks({})).toEqual({});
  });

  it('returns the same callParams object it was given', () => {
    const provider = makeProvider({
      handlers: { status: noopHandler },
      publicDomain: 'example.ngrok.io',
    });
    const params: Record<string, unknown> = { to: '+15551234567' };
    const result = provider.applyCallbacks(params);
    expect(result).toBe(params);
    expect(result).toEqual({
      to: '+15551234567',
      statusCallback: 'https://example.ngrok.io/voice/call-event/status',
    });
  });
});

describe('VoiceProviderConfig', () => {
  it('defaults memoryMode to never', () => {
    expect(new VoiceProviderConfig().memoryMode).toBe('never');
  });

  it('requires subclasses to implement createProvider', () => {
    expect(() => new VoiceProviderConfig().createProvider({} as never, {} as never)).toThrow(
      /must implement createProvider/
    );
  });

  it('retains the full BaseChannelOptions it was constructed with', () => {
    const config = new VoiceProviderConfig({ memoryMode: 'always', dedupCapacity: 500 });
    expect(config.channelOptions).toEqual({ memoryMode: 'always', dedupCapacity: 500 });
  });

  it('retains an empty options object when constructed with nothing', () => {
    expect(new VoiceProviderConfig().channelOptions).toEqual({});
  });
});

// ===========================================================================
// VoiceChannel <-> VoiceProvider seam
// ===========================================================================

const getTestConfig = () => ({
  accountSid: 'ACtest123',
  authToken: 'test_token_123',
  apiKey: 'test_api_key',
  apiSecret: 'test_api_token',
  phoneNumber: '+15551234567',
  conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
});

/** Reach the channel's `private provider` without changing its visibility. */
function getProvider(channel: VoiceChannel): VoiceProvider {
  return (channel as unknown as { provider: VoiceProvider }).provider;
}

/** Re-exposes the `protected` channel state the seam is supposed to thread. */
class ProbeVoiceChannel extends VoiceChannel {
  public get probedMemoryMode(): MemoryMode {
    return this.memoryMode;
  }

  public probeDuplicate(token: string): boolean {
    return this.isDuplicateWebhook(token);
  }
}

/** A provider that is not ConversationRelay-based, and counts its shutdowns. */
class StubVoiceProvider extends VoiceProvider {
  public shutdownCalls = 0;

  public override shutdown(): void {
    this.shutdownCalls++;
  }
}

class StubVoiceProviderConfig extends VoiceProviderConfig {
  public override createProvider(channel: VoiceChannel): VoiceProvider {
    return new StubVoiceProvider(channel);
  }
}

/** Stands in for a provider that awaits an upstream handshake and fails it. */
class RejectingWebSocketProvider extends VoiceProvider {
  public override handleWebSocket(): Promise<void> {
    return Promise.reject(new Error('upstream handshake failed'));
  }
}

class RejectingWebSocketProviderConfig extends VoiceProviderConfig {
  public override createProvider(channel: VoiceChannel): VoiceProvider {
    return new RejectingWebSocketProvider(channel);
  }
}

describe('VoiceChannel provider selection', () => {
  let tac: TAC;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
  });

  it('builds a ConversationRelayProvider when no config is given', () => {
    expect(getProvider(new VoiceChannel(tac))).toBeInstanceOf(ConversationRelayProvider);
  });

  it('builds a ConversationRelayProvider from a plain options object', () => {
    expect(getProvider(new VoiceChannel(tac, { memoryMode: 'always' }))).toBeInstanceOf(
      ConversationRelayProvider
    );
  });

  it('builds a ConversationRelayProvider from an explicit config instance', () => {
    const config = new ConversationRelayProviderConfig({ memoryMode: 'once' });
    expect(getProvider(new VoiceChannel(tac, config))).toBeInstanceOf(ConversationRelayProvider);
  });

  it('builds whatever provider a custom config returns', () => {
    expect(getProvider(new VoiceChannel(tac, new StubVoiceProviderConfig()))).toBeInstanceOf(
      StubVoiceProvider
    );
  });
});

describe('VoiceChannel channel-option threading', () => {
  let tac: TAC;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
  });

  it('threads memoryMode from a config instance', () => {
    const channel = new ProbeVoiceChannel(
      tac,
      new ConversationRelayProviderConfig({ memoryMode: 'always' })
    );
    expect(channel.probedMemoryMode).toBe('always');
  });

  it('defaults memoryMode to never on both configuration paths', () => {
    expect(new ProbeVoiceChannel(tac).probedMemoryMode).toBe('never');
    expect(new ProbeVoiceChannel(tac, {}).probedMemoryMode).toBe('never');
    expect(new ProbeVoiceChannel(tac, new ConversationRelayProviderConfig()).probedMemoryMode).toBe(
      'never'
    );
  });

  it('honours a memoryMode assigned after the config was constructed', () => {
    const config = new ConversationRelayProviderConfig();
    config.memoryMode = 'once';
    expect(new ProbeVoiceChannel(tac, config).probedMemoryMode).toBe('once');
  });

  it('threads dedupCapacity from a config instance through to BaseChannel', () => {
    const channel = new ProbeVoiceChannel(
      tac,
      new ConversationRelayProviderConfig({ dedupCapacity: 2 })
    );

    // At capacity 2, the third token evicts the first (FIFO).
    expect(channel.probeDuplicate('token1')).toBe(false);
    expect(channel.probeDuplicate('token2')).toBe(false);
    expect(channel.probeDuplicate('token2')).toBe(true);
    expect(channel.probeDuplicate('token3')).toBe(false);
    expect(channel.probeDuplicate('token1')).toBe(false);
  });

  it('applies BaseChannel dedupCapacity validation on the config path', () => {
    expect(
      () => new VoiceChannel(tac, new ConversationRelayProviderConfig({ dedupCapacity: 0 }))
    ).toThrow('dedupCapacity must be a positive integer');
    expect(
      () => new VoiceChannel(tac, new ConversationRelayProviderConfig({ dedupCapacity: 1.5 }))
    ).toThrow('dedupCapacity must be a positive integer');
  });

  it('applies BaseChannel dedupCapacity validation on the plain-object path', () => {
    expect(() => new VoiceChannel(tac, { dedupCapacity: 0 })).toThrow(
      'dedupCapacity must be a positive integer'
    );
  });

  it('threads channel options from a non-ConversationRelay config too', () => {
    const channel = new ProbeVoiceChannel(
      tac,
      new StubVoiceProviderConfig({ memoryMode: 'always', dedupCapacity: 1 })
    );
    expect(channel.probedMemoryMode).toBe('always');
    expect(channel.probeDuplicate('token1')).toBe(false);
    expect(channel.probeDuplicate('token2')).toBe(false);
    expect(channel.probeDuplicate('token1')).toBe(false);
  });
});

describe('VoiceChannel ConversationRelay-only forwarders', () => {
  let channel: VoiceChannel;

  beforeEach(async () => {
    const tac = await createTestTAC(getTestConfig());
    channel = new VoiceChannel(tac, new StubVoiceProviderConfig());
  });

  it('refuses stream tasks by naming the provider and the capability', () => {
    expect(() => channel.startStreamTask('CH123' as ConversationId)).toThrow(
      'StubVoiceProvider does not support stream tasks.'
    );
    expect(() => channel.cancelStreamTask('CH123' as ConversationId)).toThrow(
      'StubVoiceProvider does not support stream tasks.'
    );
    expect(() => channel.completeStreamTask('CH123' as ConversationId)).toThrow(
      'StubVoiceProvider does not support stream tasks.'
    );
    expect(() => channel.hasActiveStreamTask('CH123' as ConversationId)).toThrow(
      'StubVoiceProvider does not support stream tasks.'
    );
  });

  it('refuses ConversationRelay TwiML generation', () => {
    expect(() => channel.connectConversationRelay({ url: 'wss://example.com/relay' })).toThrow(
      'StubVoiceProvider does not support ConversationRelay TwiML generation.'
    );
  });

  it('falls back to the base acknowledgement for provider callbacks', async () => {
    await expect(
      channel.handleTwilioProviderCallback({
        CallSid: 'CA123',
        AccountSid: 'ACtest123',
        CallStatus: 'completed',
      })
    ).resolves.toEqual({ status: 200, content: '', contentType: 'text/plain' });
  });

  it('still generates ConversationRelay TwiML on the default provider', async () => {
    const tac = await createTestTAC(getTestConfig());
    const relayChannel = new VoiceChannel(tac);
    expect(relayChannel.connectConversationRelay({ url: 'wss://example.com/relay' })).toContain(
      'url="wss://example.com/relay"'
    );
  });
});

describe('VoiceChannel.shutdown', () => {
  it('cascades to the provider before clearing its own state', async () => {
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(tac, new StubVoiceProviderConfig());
    const provider = getProvider(channel) as StubVoiceProvider;

    expect(provider.shutdownCalls).toBe(0);
    channel.shutdown();
    expect(provider.shutdownCalls).toBe(1);
  });

  it('cascades to the default ConversationRelayProvider', async () => {
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(tac);
    const shutdownSpy = vi.spyOn(getProvider(channel), 'shutdown');

    channel.shutdown();

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceChannel.handleWebSocketConnection', () => {
  it('catches and logs a provider handshake rejection instead of leaking it', async () => {
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(tac, new RejectingWebSocketProviderConfig());
    const errorSpy = vi.spyOn(channel.getLoggerInternal(), 'error').mockImplementation(() => {});

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      expect(() => channel.handleWebSocketConnection({} as never)).not.toThrow();

      // Let the rejection settle, then let Node's unhandled-rejection check run.
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(unhandled).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'upstream handshake failed' }) },
      'WebSocket handler error'
    );
  });

  it('leaves a synchronous provider alone', async () => {
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(tac, new StubVoiceProviderConfig());
    const errorSpy = vi.spyOn(channel.getLoggerInternal(), 'error').mockImplementation(() => {});

    // `VoiceProvider.handleWebSocket` refuses synchronously — the shell must not
    // swallow that into the promise path.
    expect(() => channel.handleWebSocketConnection({} as never)).toThrow(
      'StubVoiceProvider does not support WebSocket connections.'
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
