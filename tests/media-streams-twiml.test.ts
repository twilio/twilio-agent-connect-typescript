import { describe, it, expect } from 'vitest';
// Imported from the package root on purpose: this also proves the barrel export
// chain re-exports the Media Streams TwiML surface.
import { generateStreamTwiml, TwiMLBuilderMediaStreams } from '@twilio/tac-core';
import { TACConfig } from '../packages/core/src/lib/config';
import type { Logger } from '../packages/core/src/lib/logger';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
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
  // voicePublicDomain intentionally omitted so defaultWebsocketUrl() → undefined
});

describe('generateStreamTwiml', () => {
  it('nests <Stream> inside <Connect> with the resolved url', () => {
    const xml = generateStreamTwiml('wss://example.test/ws');
    expect(xml).toContain('<Connect>');
    expect(xml).toContain('<Stream url="wss://example.test/ws"');
  });

  it('takes the url from options when not passed positionally', () => {
    const xml = generateStreamTwiml(undefined, { websocketUrl: 'wss://opts.test/ws' });
    expect(xml).toContain('wss://opts.test/ws');
  });

  it('prefers the positional url over options.websocketUrl', () => {
    const xml = generateStreamTwiml('wss://positional.test/ws', {
      websocketUrl: 'wss://opts.test/ws',
    });
    expect(xml).toContain('wss://positional.test/ws');
    expect(xml).not.toContain('opts.test');
  });

  it('throws when neither source supplies a url', () => {
    expect(() => generateStreamTwiml()).toThrow(/requires a WebSocket URL/);
  });

  it('throws when the url is only whitespace', () => {
    expect(() => generateStreamTwiml('   ')).toThrow(/requires a WebSocket URL/);
  });

  it('emits <Parameter> children, skipping null values', () => {
    const xml = generateStreamTwiml('wss://example.test/ws', {
      customParameters: { tenant: 'acme', skipped: null },
    });
    expect(xml).toContain('<Parameter name="tenant" value="acme"');
    expect(xml).not.toContain('skipped');
  });

  it('puts action/method on <Connect> and name/statusCallback on <Stream>', () => {
    const xml = generateStreamTwiml('wss://example.test/ws', {
      actionUrl: 'https://example.test/action',
      actionMethod: 'GET',
      name: 'my-stream',
      statusCallback: 'https://example.test/status',
      statusCallbackMethod: 'POST',
    });
    // Element-scoped and order-independent: the contract is which element
    // carries each attribute, not the order the helper library emits them in.
    expect(xml).toMatch(/<Connect\b[^>]*\baction="https:\/\/example\.test\/action"/);
    expect(xml).toMatch(/<Connect\b[^>]*\bmethod="GET"/);
    expect(xml).toMatch(/<Stream\b[^>]*\bname="my-stream"/);
    expect(xml).toMatch(/<Stream\b[^>]*\bstatusCallback="https:\/\/example\.test\/status"/);
  });

  it('puts statusCallbackMethod on <Stream>', () => {
    const xml = generateStreamTwiml('wss://example.test/ws', {
      statusCallback: 'https://example.test/status',
      statusCallbackMethod: 'GET',
    });
    expect(xml).toMatch(/<Stream\b[^>]*\bstatusCallbackMethod="GET"/);
  });

  it('JSON-encodes object-valued custom parameters', () => {
    const xml = generateStreamTwiml('wss://example.test/ws', {
      customParameters: { meta: { tenant: 'acme' } },
    });
    // The emitted attribute has its quotes HTML-escaped, so assert on the JSON
    // key rather than the raw JSON text.
    expect(xml).toMatch(/<Parameter\b[^>]*\bname="meta"[^>]*\bvalue="[^"]*tenant[^"]*"/);
    expect(xml).not.toContain('[object Object]');
  });
});

describe('TwiMLBuilderMediaStreams', () => {
  it('layers perCall over defaultTwimlOptions over host', () => {
    const builder = new TwiMLBuilderMediaStreams(
      tacConfig,
      { defaultTwimlOptions: { name: 'from-default', websocketUrl: 'wss://default.test/ws' } },
      noopLogger
    );

    const xml = builder.build('test', {
      host: { name: 'from-host', websocketUrl: 'wss://host.test/ws' },
      perCall: { websocketUrl: 'wss://percall.test/ws' },
    });

    expect(xml).toContain('wss://percall.test/ws');
    expect(xml).toContain('name="from-default"');
  });

  it('falls back to the TACConfig-derived url when no layer sets one', () => {
    const builder = new TwiMLBuilderMediaStreams(tacConfig, {}, noopLogger);
    expect(builder.build('test')).toContain('wss://example.ngrok.io/voice-stream');
  });

  it('lets an explicit websocketUrl argument beat every option layer', () => {
    const builder = new TwiMLBuilderMediaStreams(
      tacConfig,
      { defaultTwimlOptions: { websocketUrl: 'wss://default.test/ws' } },
      noopLogger
    );
    const xml = builder.build('test', {
      perCall: { websocketUrl: 'wss://percall.test/ws' },
      websocketUrl: 'wss://explicit.test/ws',
    });
    expect(xml).toContain('wss://explicit.test/ws');
  });

  it('names the caller in the missing-url error', () => {
    const builder = new TwiMLBuilderMediaStreams(minimalTacConfig, {}, noopLogger);
    expect(() => builder.build('initiateOutboundConversation')).toThrow(
      /initiateOutboundConversation needs a WebSocket URL/
    );
  });

  it('throws when defaultTwimlOptions.websocketUrl is an empty string', () => {
    // Regression guard for the falsy (`||`) rather than nullish check in
    // build(): an empty-string websocketUrl from any layer must fall through to
    // the missing-URL error instead of emitting <Stream url="">.
    const builder = new TwiMLBuilderMediaStreams(
      minimalTacConfig,
      { defaultTwimlOptions: { websocketUrl: '' } },
      noopLogger
    );
    expect(() => builder.build('onInboundCall')).toThrow(/TWILIO_VOICE_PUBLIC_DOMAIN/);
  });
});
