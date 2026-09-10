import { describe, it, expect } from 'vitest';
import { VoiceProvider, VoiceProviderConfig } from '@twilio/tac-core';
import type { CallEventKind, VoiceChannel } from '@twilio/tac-core';

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

  it('treats handleTwilioProviderCallback as an opt-in no-op', async () => {
    await expect(
      new VoiceProvider({} as never).handleTwilioProviderCallback({})
    ).resolves.toBeUndefined();
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
});
