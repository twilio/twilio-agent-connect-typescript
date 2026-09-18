import { describe, it, expect } from 'vitest';
import { TwiMLBuilderBase } from '../packages/core/src/channels/voice/twiml';
import { TwiMLBuilderConversationRelay } from '../packages/core/src/channels/voice/conversation-relay/twiml';
import { TACConfig } from '../packages/core/src/lib/config';
import type { Logger } from '../packages/core/src/lib/logger';
import type { VoiceChannelConfig } from '../packages/core/src/channels/voice';

/**
 * Minimal subclass that re-exposes the protected surface under test. Mirrors
 * how the real provider builders reach these helpers.
 */
class TestBuilder extends TwiMLBuilderBase {
  public overlay(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    skip: readonly string[] = []
  ): void {
    this.overlayFields(target, source, skip);
  }

  public missingUrlError(caller: string): Error {
    return this.missingWebsocketUrlError(caller);
  }

  public websocketUrl(): string | undefined {
    return this.defaultWebsocketUrl();
  }

  public actionUrl(): string | undefined {
    return this.defaultActionUrl();
  }
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function makeBuilder(config: Partial<TACConfig>): TestBuilder {
  return new TestBuilder(config as TACConfig, undefined, noopLogger);
}

describe('TwiMLBuilderBase', () => {
  it('derives a default websocket URL from voicePublicDomain', () => {
    const builder = makeBuilder({
      voicePublicDomain: 'example.ngrok.io',
      voiceWebsocketPath: '/ws',
    });
    expect(builder.websocketUrl()).toBe('wss://example.ngrok.io/ws');
  });

  it('returns undefined when voicePublicDomain is unset', () => {
    const builder = makeBuilder({ voicePublicDomain: undefined, voiceWebsocketPath: '/ws' });
    expect(builder.websocketUrl()).toBeUndefined();
  });

  it('derives a default action URL from voicePublicDomain', () => {
    const builder = makeBuilder({
      voicePublicDomain: 'example.ngrok.io',
      voiceActionPath: '/voice/action',
    });
    expect(builder.actionUrl()).toBe('https://example.ngrok.io/voice/action');
  });

  it('returns undefined for the action URL when voicePublicDomain is unset', () => {
    const builder = makeBuilder({ voicePublicDomain: undefined, voiceActionPath: '/voice/action' });
    expect(builder.actionUrl()).toBeUndefined();
  });

  it('overlays only explicitly-set source fields, honouring skip', () => {
    const builder = makeBuilder({});
    const target = { a: 1, b: 2, c: 3 };
    const source = { b: 20, c: 30 };
    builder.overlay(target, source, ['c']);
    expect(target).toEqual({ a: 1, b: 20, c: 3 });
  });

  it('treats key presence — not defined-ness — as "explicitly set"', () => {
    // Mirrors Pydantic's `model_fields_set`: a key explicitly set to undefined
    // is still "present" and must overwrite the lower layer, while a key that
    // is simply absent must leave the lower layer untouched.
    const builder = makeBuilder({});
    const target: Record<string, unknown> = { present: 'keep', cleared: 'overwrite-me' };
    const source: Record<string, unknown> = { cleared: undefined };

    builder.overlay(target, source);

    expect('cleared' in target).toBe(true);
    expect(target.cleared).toBeUndefined();
    expect(target.present).toBe('keep');
  });

  it('names the caller in the missing-websocket-URL error', () => {
    const builder = makeBuilder({});
    const error = builder.missingUrlError('initiateVoiceConversation');
    expect(error.message).toContain('initiateVoiceConversation');
    expect(error.message).toContain('TWILIO_VOICE_PUBLIC_DOMAIN');
  });
});

const minimalTacConfig = new TACConfig({
  accountSid: 'ACtest123456789',
  authToken: 'test_token_123',
  apiKey: 'SKtest123456789',
  apiSecret: 'test_api_secret_123',
  phoneNumber: '+15551234567',
  // voicePublicDomain intentionally omitted so defaultWebsocketUrl() → undefined
});

describe('TwiMLBuilderConversationRelay — empty-string websocketUrl', () => {
  it('throws when defaultTwimlOptions.websocketUrl is an empty string', () => {
    // Regression: pre-refactor code used `||` (falsy check), so '' caused a
    // throw. Post-refactor the check was `=== undefined`, so '' slipped through
    // and produced <ConversationRelay url="">. This asserts the falsy guard is
    // restored.
    const channelConfig: VoiceChannelConfig = {
      defaultTwimlOptions: { websocketUrl: '' },
    };
    const builder = new TwiMLBuilderConversationRelay(minimalTacConfig, channelConfig, noopLogger);
    expect(() => builder.build('onInboundCall')).toThrow(/TWILIO_VOICE_PUBLIC_DOMAIN/);
  });
});
