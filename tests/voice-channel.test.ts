import { describe, it, expect, vi } from 'vitest';
import { VoiceChannel, TAC, TACConfig } from '@twilio/tac-core';

describe('VoiceChannel', () => {
  const getTestConfig = () => ({
    environment: 'prod' as const,
    twilioAccountSid: 'ACtest123',
    twilioAuthToken: 'test_token_123',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  describe('generateTwiML()', () => {
    it('should generate TwiML without welcomeGreeting', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.generateTwiML({
        websocketUrl: 'wss://example.com/voice',
      });

      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('<Connect>');
      expect(twiml).toContain('<ConversationRelay url="wss://example.com/voice">');
      expect(twiml).not.toContain('welcomeGreeting');
    });

    it('should generate TwiML with welcomeGreeting', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.generateTwiML({
        websocketUrl: 'wss://example.com/voice',
        welcomeGreeting: 'Hello! How can I help you today?',
      });

      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('<Connect>');
      expect(twiml).toContain(
        '<ConversationRelay url="wss://example.com/voice" welcomeGreeting="Hello! How can I help you today?">'
      );
    });

    it('should include custom parameters in TwiML', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.generateTwiML({
        websocketUrl: 'wss://example.com/voice',
        customParameters: {
          conversation_id: 'CH123',
          profile_id: 'mem_profile_123',
        },
      });

      expect(twiml).toContain('<Parameter name="conversation_id" value="CH123" />');
      expect(twiml).toContain('<Parameter name="profile_id" value="mem_profile_123" />');
    });

    it('should handle undefined welcomeGreeting', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.generateTwiML({
        websocketUrl: 'wss://example.com/voice',
        welcomeGreeting: undefined,
      });

      expect(twiml).toContain('<ConversationRelay url="wss://example.com/voice">');
      expect(twiml).not.toContain('welcomeGreeting');
    });
  });

  describe('getWebsocket()', () => {
    it('should return null for unknown conversation', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const ws = voiceChannel.getWebsocket('CA_unknown' as any);

      expect(ws).toBeNull();
    });
  });

  describe('isConversationActive()', () => {
    it('should return false for unknown conversation', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const isActive = voiceChannel.isConversationActive('CA_unknown' as any);

      expect(isActive).toBe(false);
    });
  });

  describe('stream task management', () => {
    it('should start and track a stream task', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      const controller = voiceChannel.startStreamTask(conversationId);

      expect(controller).toBeInstanceOf(AbortController);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);
    });

    it('should cancel an active stream task', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      const controller = voiceChannel.startStreamTask(conversationId);
      const cancelled = voiceChannel.cancelStreamTask(conversationId);

      expect(cancelled).toBe(true);
      expect(controller.signal.aborted).toBe(true);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });

    it('should return false when cancelling non-existent task', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const cancelled = voiceChannel.cancelStreamTask('CH_nonexistent' as any);

      expect(cancelled).toBe(false);
    });

    it('should complete a stream task (remove from tracking)', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      voiceChannel.startStreamTask(conversationId);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);

      voiceChannel.completeStreamTask(conversationId);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });

    it('should replace existing stream task when starting new one', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      const firstController = voiceChannel.startStreamTask(conversationId);
      const secondController = voiceChannel.startStreamTask(conversationId);

      expect(firstController.signal.aborted).toBe(true);
      expect(secondController.signal.aborted).toBe(false);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);
    });

    it('should report inactive for aborted task', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      voiceChannel.startStreamTask(conversationId);
      voiceChannel.cancelStreamTask(conversationId);

      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });
  });

  describe('shutdown()', () => {
    it('should clear all stream tasks on shutdown', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      voiceChannel.startStreamTask('CH_1' as any);
      voiceChannel.startStreamTask('CH_2' as any);

      expect(voiceChannel.hasActiveStreamTask('CH_1' as any)).toBe(true);
      expect(voiceChannel.hasActiveStreamTask('CH_2' as any)).toBe(true);

      voiceChannel.shutdown();

      expect(voiceChannel.hasActiveStreamTask('CH_1' as any)).toBe(false);
      expect(voiceChannel.hasActiveStreamTask('CH_2' as any)).toBe(false);
    });

    it('should clear WebSocket references on shutdown', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      // Start with no WebSocket connections
      expect(voiceChannel.getWebsocket('CH_test' as any)).toBeNull();

      // After shutdown, should still return null (cleared state)
      voiceChannel.shutdown();
      expect(voiceChannel.getWebsocket('CH_test' as any)).toBeNull();
    });
  });

  describe('handleConversationRelayCallback()', () => {
    it('should return 200 OK for completed call without conversations', async () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      // Mock the listConversations to return empty
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([]);

      const result = await voiceChannel.handleConversationRelayCallback({
        AccountSid: 'ACtest123',
        CallSid: 'CA123',
        CallStatus: 'completed',
        From: '+15551234567',
        To: '+15559876543',
      });

      expect(result.status).toBe(200);
      expect(result.content).toBe('OK');
      expect(result.contentType).toBe('text/plain');
    });

    it('should return 501 when handoff requested but no handler registered', async () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const result = await voiceChannel.handleConversationRelayCallback({
        AccountSid: 'ACtest123',
        CallSid: 'CA123',
        CallStatus: 'in-progress',
        From: '+15551234567',
        To: '+15559876543',
        HandoffData: JSON.stringify({ reason: 'User requested agent' }),
      });

      expect(result.status).toBe(501);
      expect(result.content).toBe('No handoff handler registered');
    });

    it('should call handoff handler when provided', async () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const handoffHandler = vi.fn().mockResolvedValue('<Response><Say>Transferring...</Say></Response>');

      const payload = {
        AccountSid: 'ACtest123',
        CallSid: 'CA123',
        CallStatus: 'in-progress',
        From: '+15551234567',
        To: '+15559876543',
        HandoffData: JSON.stringify({ reason: 'User requested agent' }),
      };

      const result = await voiceChannel.handleConversationRelayCallback(payload, handoffHandler);

      expect(handoffHandler).toHaveBeenCalledWith(payload);
      expect(result.status).toBe(200);
      expect(result.content).toBe('<Response><Say>Transferring...</Say></Response>');
      expect(result.contentType).toBe('application/xml');
    });

    it('should return 500 when handoff handler throws', async () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const handoffHandler = vi.fn().mockRejectedValue(new Error('Handler failed'));

      const result = await voiceChannel.handleConversationRelayCallback(
        {
          AccountSid: 'ACtest123',
          CallSid: 'CA123',
          CallStatus: 'in-progress',
          From: '+15551234567',
          To: '+15559876543',
          HandoffData: JSON.stringify({ reason: 'Transfer' }),
        },
        handoffHandler
      );

      expect(result.status).toBe(500);
      expect(result.content).toBe('Handoff handler error');
    });

    it('should close conversations on call completion', async () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });
      const voiceChannel = new VoiceChannel(tac);

      const mockConversation = { id: 'CH_test_conv' };
      const listSpy = vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([mockConversation] as any);
      const updateSpy = vi.spyOn(tac.getConversationClient(), 'updateConversation').mockResolvedValue({} as any);

      await voiceChannel.handleConversationRelayCallback({
        AccountSid: 'ACtest123',
        CallSid: 'CA123',
        CallStatus: 'completed',
        From: '+15551234567',
        To: '+15559876543',
      });

      expect(listSpy).toHaveBeenCalledWith({ channelId: 'CA123' });
      expect(updateSpy).toHaveBeenCalledWith('CH_test_conv', 'CLOSED');
    });
  });
});
