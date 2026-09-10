import { describe, it, expect, vi } from 'vitest';
import * as tac from '../src/index';
import { VoiceChannel } from '../src/index';
import { createTestTAC } from './helpers/tac';

describe('package exports', () => {
  it('exports core classes', () => {
    expect(tac.TAC).toBeDefined();
    expect(tac.TACConfig).toBeDefined();
    expect(tac.TACMemoryResponse).toBeDefined();
  });

  it('exports channel classes', () => {
    expect(tac.VoiceChannel).toBeDefined();
    expect(tac.SMSChannel).toBeDefined();
    expect(tac.RCSChannel).toBeDefined();
    expect(tac.ChatChannel).toBeDefined();
    expect(tac.MessagingChannel).toBeDefined();
    expect(tac.BaseChannel).toBeDefined();
  });

  it('exports client classes', () => {
    expect(tac.MemoryClient).toBeDefined();
    expect(tac.ConversationClient).toBeDefined();
    expect(tac.KnowledgeClient).toBeDefined();
  });

  it('exports tool classes and helpers', () => {
    expect(tac.TACTool).toBeDefined();
    expect(tac.defineTool).toBeDefined();
    expect(tac.createMemoryRetrievalTool).toBeDefined();
    expect(tac.createSendMessageTool).toBeDefined();
    expect(tac.createStudioHandoffTool).toBeDefined();
    expect(tac.buildHandoffPayload).toBeDefined();
    expect(tac.postStudioHandoff).toBeDefined();
    expect(tac.createKnowledgeSearchTool).toBeDefined();
  });

  it('exports server class', () => {
    expect(tac.TACServer).toBeDefined();
  });

  it('exports the Media Streams provider surface', () => {
    expect(tac.MediaStreamsProviderConfig).toBeDefined();
    expect(tac.MediaStreamsOpenAIProvider).toBeDefined();
    expect(tac.MediaStreamsOpenAIProviderConfig).toBeDefined();
    expect(tac.MediaStreamsOpenAICallState).toBeDefined();
    expect(tac.OPENAI_USER_AGENT).toMatch(/^twilio-agent-connect\/TypeScript \d+\.\d+\.\d+/);
    expect(tac.OpenAIRealtimeProvider).toBeDefined();
    expect(tac.OpenAIRealtimeProviderConfig).toBeDefined();
    expect(tac.TwiMLBuilderMediaStreams).toBeDefined();
    expect(tac.generateStreamTwiml).toBeDefined();
    expect(tac.TWILIO_AUDIO_FORMAT_FOR_REALTIME).toEqual({ type: 'audio/pcmu' });
  });
});

describe('deprecated voice aliases', () => {
  const getVoiceConfig = () => ({
    accountSid: 'ACtest123',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  it('still exports TwiMLOptionsSchema as the ConversationRelay schema', () => {
    expect(tac.TwiMLOptionsSchema).toBe(tac.VoiceTwiMLOptionsConversationRelaySchema);
  });

  it('warns once when handleConversationRelayCallback is called', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const voiceChannel = new VoiceChannel(await createTestTAC(getVoiceConfig()));
      const payload = {
        AccountSid: 'ACtest123',
        CallSid: 'CA_deprecated_alias',
        CallStatus: 'completed' as const,
        From: '+15551112222',
        To: '+15553334444',
        Direction: 'inbound' as const,
      };

      await voiceChannel.handleConversationRelayCallback(payload);
      await voiceChannel.handleConversationRelayCallback(payload);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('handleConversationRelayCallback is deprecated');
    } finally {
      warn.mockRestore();
    }
  });
});
