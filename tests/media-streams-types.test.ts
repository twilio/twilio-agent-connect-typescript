import { describe, it, expect } from 'vitest';
import {
  StreamStartMessageSchema,
  VoiceTwiMLOptionsMediaStreamsSchema,
  InitiateVoiceConversationOptionsSchema,
  InitiateVoiceConversationOptionsOpenAIRealtimeSchema,
} from '@twilio/tac-core';

describe('StreamStartMessageSchema', () => {
  it('parses Twilio wire casing and defaults customParameters', () => {
    const parsed = StreamStartMessageSchema.parse({
      streamSid: 'MZ123',
      callSid: 'CA123',
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
    });
    expect(parsed.streamSid).toBe('MZ123');
    expect(parsed.customParameters).toEqual({});
  });

  it('requires callSid', () => {
    expect(() => StreamStartMessageSchema.parse({ streamSid: 'MZ123' })).toThrow();
  });
});

describe('VoiceTwiMLOptionsMediaStreamsSchema', () => {
  it('accepts the <Stream> and <Connect> attributes', () => {
    const parsed = VoiceTwiMLOptionsMediaStreamsSchema.parse({
      websocketUrl: 'wss://example.test/ws',
      name: 'my-stream',
      statusCallback: 'https://example.test/stream-status',
      statusCallbackMethod: 'POST',
      actionUrl: 'https://example.test/action',
      actionMethod: 'POST',
      customParameters: { tenant: 'acme' },
    });
    expect(parsed.name).toBe('my-stream');
    expect(parsed.statusCallbackMethod).toBe('POST');
  });

  it('rejects a statusCallbackMethod outside GET/POST', () => {
    expect(() =>
      VoiceTwiMLOptionsMediaStreamsSchema.parse({ statusCallbackMethod: 'PUT' })
    ).toThrow();
  });

  it('has no track attribute — bidirectional Connect streams are inbound-only', () => {
    expect(Object.keys(VoiceTwiMLOptionsMediaStreamsSchema.shape)).not.toContain('track');
  });

  it('rejects track — .strict() turns its absence into a parse error', () => {
    expect(() =>
      VoiceTwiMLOptionsMediaStreamsSchema.parse({ track: 'inbound_track' })
    ).toThrow();
  });

  it('rejects an empty statusCallback', () => {
    expect(() => VoiceTwiMLOptionsMediaStreamsSchema.parse({ statusCallback: '' })).toThrow();
  });
});

describe('InitiateVoiceConversationOptionsOpenAIRealtimeSchema', () => {
  it('adds sessionConfig on top of the base outbound options', () => {
    const parsed = InitiateVoiceConversationOptionsOpenAIRealtimeSchema.parse({
      to: '+15550001111',
      sessionConfig: { model: 'gpt-realtime' },
    });
    expect(parsed.sessionConfig).toEqual({ model: 'gpt-realtime' });
    expect(parsed.to).toBe('+15550001111');
  });

  it('overrides twimlOptions with the Media Streams subtype', () => {
    const parsed = InitiateVoiceConversationOptionsOpenAIRealtimeSchema.parse({
      to: '+15550001111',
      twimlOptions: { name: 'my-stream', statusCallback: 'https://example.test/s' },
    });
    expect(parsed.twimlOptions?.name).toBe('my-stream');
  });

  it('rejects ConversationRelay twimlOptions — the inherited schema is replaced, not merged', () => {
    expect(() =>
      InitiateVoiceConversationOptionsOpenAIRealtimeSchema.parse({
        to: '+15550001111',
        twimlOptions: { welcomeGreeting: 'hi' },
      })
    ).toThrow();
  });

  it('mirrors on the base schema — Media Streams twimlOptions fail there', () => {
    expect(() =>
      InitiateVoiceConversationOptionsSchema.parse({
        to: '+15550001111',
        twimlOptions: { name: 'x' },
      })
    ).toThrow();
  });
});
