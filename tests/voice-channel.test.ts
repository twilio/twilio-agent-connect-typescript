import { describe, it, expect, vi } from 'vitest';
import { createTestTAC } from './helpers/tac';
import {
  VoiceChannel,
  TAC,
  TACConfig,
  ConversationSession,
  ConversationId,
} from '@twilio/tac-core';
import { InterruptMessageSchema } from '@twilio/tac-core';

describe('VoiceChannel', () => {
  const getTestConfig = () => ({

    accountSid: 'ACtest123',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  describe('connectConversationRelay()', () => {
    it('should generate TwiML without welcomeGreeting', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
      });

      expect(twiml).toContain('url="wss://example.com/conversation-relay"');
      expect(twiml).not.toContain('welcomeGreeting');
    });

    it('should generate TwiML with welcomeGreeting', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        welcomeGreeting: 'Hello! How can I help you today?',
      });

      expect(twiml).toContain('url="wss://example.com/conversation-relay"');
      expect(twiml).toContain('welcomeGreeting="Hello! How can I help you today?"');
    });


    it('should handle undefined welcomeGreeting', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        welcomeGreeting: undefined,
      });

      expect(twiml).toContain('url="wss://example.com/conversation-relay"');
      expect(twiml).not.toContain('welcomeGreeting');
    });
  });

  describe('getWebsocket()', () => {
    it('should return null for unknown conversation', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const ws = voiceChannel.getWebsocket('CA_unknown' as ConversationId);

      expect(ws).toBeNull();
    });
  });

  describe('isConversationActive()', () => {
    it('should return false for unknown conversation', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const isActive = voiceChannel.isConversationActive('CA_unknown' as ConversationId);

      expect(isActive).toBe(false);
    });
  });

  describe('stream task management', () => {
    it('should start and track a stream task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as ConversationId;

      const task = voiceChannel.startStreamTask(conversationId);

      expect(task.controller).toBeInstanceOf(AbortController);
      expect(task.hasSentTokens).toBe(false);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);
    });

    it('should cancel an active stream task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as ConversationId;

      const task = voiceChannel.startStreamTask(conversationId);
      const cancelled = voiceChannel.cancelStreamTask(conversationId);

      expect(cancelled).toBe(true);
      expect(task.controller.signal.aborted).toBe(true);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });

    it('should return false when cancelling non-existent task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const cancelled = voiceChannel.cancelStreamTask('CH_nonexistent' as ConversationId);

      expect(cancelled).toBe(false);
    });

    it('should complete a stream task (remove from tracking)', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as ConversationId;

      voiceChannel.startStreamTask(conversationId);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);

      voiceChannel.completeStreamTask(conversationId);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });

    it('should replace existing stream task when starting new one', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as ConversationId;

      const firstTask = voiceChannel.startStreamTask(conversationId);
      const secondTask = voiceChannel.startStreamTask(conversationId);

      expect(firstTask.controller.signal.aborted).toBe(true);
      expect(secondTask.controller.signal.aborted).toBe(false);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);
    });

    it('should report inactive for aborted task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as ConversationId;

      voiceChannel.startStreamTask(conversationId);
      voiceChannel.cancelStreamTask(conversationId);

      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });
  });

  describe('shutdown()', () => {
    it('should clear all stream tasks on shutdown', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      voiceChannel.startStreamTask('CH_1' as ConversationId);
      voiceChannel.startStreamTask('CH_2' as ConversationId);

      expect(voiceChannel.hasActiveStreamTask('CH_1' as ConversationId)).toBe(true);
      expect(voiceChannel.hasActiveStreamTask('CH_2' as ConversationId)).toBe(true);

      voiceChannel.shutdown();

      expect(voiceChannel.hasActiveStreamTask('CH_1' as ConversationId)).toBe(false);
      expect(voiceChannel.hasActiveStreamTask('CH_2' as ConversationId)).toBe(false);
    });

    it('should clear WebSocket references on shutdown', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Start with no WebSocket connections
      expect(voiceChannel.getWebsocket('CH_test' as ConversationId)).toBeNull();

      // After shutdown, should still return null (cleared state)
      voiceChannel.shutdown();
      expect(voiceChannel.getWebsocket('CH_test' as ConversationId)).toBeNull();
    });
  });

  describe('ConversationRelay attributes', () => {
    it('should apply transcription configuration', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        transcriptionProvider: 'Deepgram',
        transcriptionLanguage: 'en-AU',
        speechModel: 'nova-3-general',
      });

      expect(twiml).toContain('transcriptionProvider="Deepgram"');
      expect(twiml).toContain('transcriptionLanguage="en-AU"');
      expect(twiml).toContain('speechModel="nova-3-general"');
    });

    it('should apply TTS configuration', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        ttsProvider: 'Google',
        ttsLanguage: 'en-US',
        voice: 'en-US-Journey-O',
      });

      expect(twiml).toContain('ttsProvider="Google"');
      expect(twiml).toContain('voice="en-US-Journey-O"');
    });

    it('should apply interaction configuration', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        interruptible: 'any',
        interruptSensitivity: 'high',
        dtmfDetection: true,
        hints: 'account balance, billing, payment',
      });

      expect(twiml).toContain('interruptible="any"');
      expect(twiml).toContain('dtmfDetection="true"');
      expect(twiml).toContain('hints="account balance, billing, payment"');
    });

    it('should filter out undefined attributes', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        interruptible: 'any',
        hints: undefined, // should not appear
      });

      expect(twiml).toContain('interruptible="any"');
      expect(twiml).not.toContain('hints=');
    });

    it('should support multiple language configurations', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        language: 'en-AU', // Default language
        languages: [
          {
            code: 'en-AU',
            ttsProvider: 'ElevenLabs',
            voice: 'IKne3meq5aSn9XLyUdCD',
            transcriptionProvider: 'Deepgram',
            speechModel: 'nova-3-general',
          },
          {
            code: 'en-NZ',
            ttsProvider: 'ElevenLabs',
            voice: 'VEWZvLXUrFL3O7dUnBSW',
            transcriptionProvider: 'Deepgram',
            speechModel: 'nova-3-general',
          },
        ],
      });

      expect(twiml).toContain('language="en-AU"');
      expect(twiml).toContain('<Language code="en-AU"');
      expect(twiml).toContain('ttsProvider="ElevenLabs"');
      expect(twiml).toContain('<Language code="en-NZ"');
    });

    it('should throw error for invalid configuration', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      expect(() => {
        voiceChannel.connectConversationRelay({
          url: 'invalid-url', // Not a valid URL
        });
      }).toThrow('Invalid ConversationRelay configuration');
    });

  });

  describe('handleIncomingCall with conversationRelayConfig', () => {
    it('should apply conversationRelayConfig to generated TwiML', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.handleIncomingCall({
        conversationRelayConfig: {
          url: 'wss://example.com/conversation-relay',
          transcriptionProvider: 'Deepgram',
          interruptible: 'any',
          hints: 'technical support, billing',
        },
      });

      expect(twiml).toContain('transcriptionProvider="Deepgram"');
      expect(twiml).toContain('interruptible="any"');
      expect(twiml).toContain('hints="technical support, billing"');
    });

    it('should apply multi-language config to handleIncomingCall', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.handleIncomingCall({
        conversationRelayConfig: {
          url: 'wss://example.com/conversation-relay',
          language: 'en-US',
          languages: [
            {
              code: 'en-US',
              ttsProvider: 'Google',
              voice: 'en-US-Journey-O',
            },
            {
              code: 'es-ES',
              ttsProvider: 'Google',
              voice: 'es-ES-Standard-A',
            },
          ],
        },
      });

      expect(twiml).toContain('language="en-US"');
      expect(twiml).toContain('<Language code="en-US"');
      expect(twiml).toContain('<Language code="es-ES"');
    });

    it('should include welcomeGreeting in TwiML', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.handleIncomingCall({
        conversationRelayConfig: {
          url: 'wss://example.com/conversation-relay',
          welcomeGreeting: 'Hello! How can I help you today?',
        },
      });

      // Verify the TwiML contains welcomeGreeting attribute
      expect(twiml).toContain('welcomeGreeting="Hello! How can I help you today?"');
    });
  });

  describe('conversation ended callback', () => {
    const createMockWebSocket = () => {
      const handlers: Record<string, ((...args: any[]) => void)[]> = {};
      return {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1, // WebSocket.OPEN
        _handlers: handlers,
        _emit(event: string, ...args: any[]) {
          for (const h of handlers[event] || []) {
            h(...args);
          }
        },
      };
    };

    const setupMessage = JSON.stringify({
      type: 'setup',
      sessionId: 'sess_cb_test',
      callSid: 'CA_cb_test',
      from: '+15551234567',
      to: '+15559876543',
      direction: 'inbound',
      callType: 'PSTN',
      callStatus: 'ringing',
      accountSid: 'ACtest123',
      customParameters: {
        conversation_id: 'CHcb_test12345',
        profile_id: 'mem_profile_cb_test',
      },
    });

    const promptMessage = JSON.stringify({
      type: 'prompt',
      voicePrompt: 'Hello',
      lang: 'en-US',
      last: true,
    });

    it('should NOT end conversation on WebSocket disconnect (handled by webhook)', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as ConversationId);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as ConversationId);

      const onConversationEnded = vi.fn();
      tac.onConversationEnded(onConversationEnded);
      tac.registerChannel(voiceChannel);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      mockWs._emit('close');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Conversation should still be active (not ended by WS disconnect)
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);
      expect(onConversationEnded).not.toHaveBeenCalled();
    });

    it('should clean up WebSocket state on disconnect without ending conversation', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as ConversationId);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as ConversationId);

      tac.registerChannel(voiceChannel);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);
      expect(voiceChannel.getWebsocket('CHcb_test12345' as ConversationId)).toBe(mockWs);

      mockWs._emit('close');
      await new Promise(resolve => setTimeout(resolve, 10));

      // WebSocket state should be cleaned up
      expect(voiceChannel.getWebsocket('CHcb_test12345' as ConversationId)).toBeNull();
      // But conversation should still be active
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);
    });

    it('should emit webSocketDisconnected event when WebSocket closes', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Mock conversation client methods for initialization
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as ConversationId);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as ConversationId);

      const onWebSocketDisconnected = vi.fn();
      voiceChannel.on('webSocketDisconnected', onWebSocketDisconnected);
      tac.registerChannel(voiceChannel);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));

      await new Promise(resolve => setTimeout(resolve, 10));

      mockWs._emit('close');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(onWebSocketDisconnected).toHaveBeenCalledWith({
        conversationId: 'CHcb_test12345',
      });
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);
    });

    it('should call onError when initialization fails and not close WebSocket', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const errorsCaptured: Array<{ error: Error; context?: Record<string, unknown> }> = [];

      // Mock listConversations to fail
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockRejectedValue(
        new Error('API 500 Server Error')
      );

      tac.registerChannel(voiceChannel);

      // Set onError callback AFTER registerChannel to avoid it being overwritten
      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      // Trigger setup
      mockWs._emit('message', Buffer.from(setupMessage));

      // Trigger first prompt (should fail initialization)
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async error handling
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have captured the initialization error
      expect(errorsCaptured).toHaveLength(1);
      expect(errorsCaptured[0].error.message).toContain('API 500 Server Error');
      expect(errorsCaptured[0].context).toMatchObject({
        callSid: 'CA_cb_test',
      });

      // WebSocket should NOT be closed
      expect(mockWs.close).not.toHaveBeenCalled();
    });

    it('should retry initialization on subsequent prompts after initial failure', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const errorsCaptured: Array<{ error: Error; context?: Record<string, unknown> }> = [];

      // Mock listConversations to fail first, then succeed
      let callCount = 0;
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('API 500 Server Error'));
        }
        return Promise.resolve([{ id: 'CHcb_test12345', status: 'ACTIVE' }] as ConversationId);
      });
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as ConversationId);

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      // Trigger setup
      mockWs._emit('message', Buffer.from(setupMessage));

      // Trigger first prompt (should fail initialization)
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async error handling
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(errorsCaptured).toHaveLength(1);
      expect(errorsCaptured[0].error.message).toContain('API 500 Server Error');

      // Trigger second prompt (should retry and succeed)
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have captured only the first error, second attempt succeeded
      expect(errorsCaptured).toHaveLength(1);
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      // WebSocket should NOT be closed
      expect(mockWs.close).not.toHaveBeenCalled();
    });

    it('should throw error after exhausting retry limit', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const errorsCaptured: Array<{ error: Error; context?: Record<string, unknown> }> = [];

      // Mock listConversations to always fail
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockRejectedValue(
        new Error('API 500 Server Error')
      );

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      // Trigger setup
      mockWs._emit('message', Buffer.from(setupMessage));

      // Attempt 1
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorsCaptured).toHaveLength(1);

      // Attempt 2
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorsCaptured).toHaveLength(2);

      // Attempt 3
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorsCaptured).toHaveLength(3);

      // Attempt 4 (should hit retry limit)
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Last error should mention retry limit
      expect(errorsCaptured).toHaveLength(4);
      expect(errorsCaptured[3].error.message).toContain('failed after 3 attempts');

      // WebSocket should still NOT be closed
      expect(mockWs.close).not.toHaveBeenCalled();
    });

    // TODO: This test is flaky due to timing issues with callback registration after async initialization
    // It was removed in 2d943c7 as redundant/flaky, but came back in merge. Should be refactored or removed.
    it.skip('should clear retry counter on successful initialization', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const errorsCaptured: Array<{ error: Error; context?: Record<string, unknown> }> = [];

      // Mock listConversations to fail once, then succeed
      let callCount = 0;
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve([{ id: 'CHcb_test12345', status: 'ACTIVE' }] as ConversationId);
      });
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as ConversationId);

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      // Trigger setup
      mockWs._emit('message', Buffer.from(setupMessage));

      // First prompt fails
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorsCaptured).toHaveLength(1);

      // Second prompt succeeds
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorsCaptured).toHaveLength(1); // No new errors
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      // Verify subsequent prompts work fine (retry counter was cleared)
      const capturedPrompts: string[] = [];
      voiceChannel.on('prompt', ({ transcript }) => {
        capturedPrompts.push(transcript);
      });

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'prompt',
        voicePrompt: 'Test prompt after success',
        lang: 'en-US',
        last: true,
      })));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(capturedPrompts).toContain('Test prompt after success');
      expect(errorsCaptured).toHaveLength(1); // Still only one error
    });

    it('should clear retry counter on WebSocket disconnect', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Mock listConversations to fail
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockRejectedValue(
        new Error('API Error')
      );

      tac.registerChannel(voiceChannel);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      // Trigger setup and failed prompt
      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Trigger disconnect (should clean up retry counter)
      mockWs._emit('close');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Create a new WebSocket connection with same callSid
      const mockWs2 = createMockWebSocket();

      // This time make it succeed immediately
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as ConversationId);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as ConversationId);

      voiceChannel.handleWebSocketConnection(mockWs2 as ConversationId);
      mockWs2._emit('message', Buffer.from(setupMessage));
      mockWs2._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should succeed because retry counter was cleared on disconnect
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);
    });

    it('should call onError when listParticipants fails and not close WebSocket', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const errorsCaptured: Array<{ error: Error; context?: Record<string, unknown> }> = [];

      // Mock listConversations to succeed but listParticipants to fail
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as ConversationId);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockRejectedValue(
        new Error('Failed to list participants: 500 Server Error')
      );

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      // Trigger setup and first prompt
      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async error handling
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have captured the error
      expect(errorsCaptured).toHaveLength(1);
      expect(errorsCaptured[0].error.message).toContain('Failed to list participants');
      expect(errorsCaptured[0].context).toMatchObject({
        callSid: 'CA_cb_test',
      });

      // WebSocket should NOT be closed
      expect(mockWs.close).not.toHaveBeenCalled();
    });

  });

  describe('InterruptMessage schema', () => {
    it('should parse utteranceUntilInterrupt', () => {
      const result = InterruptMessageSchema.parse({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Hello, I was say',
      });

      expect(result.utteranceUntilInterrupt).toBe('Hello, I was say');
      expect(result.durationUntilInterruptMs).toBeUndefined();
    });

    it('should parse durationUntilInterruptMs', () => {
      const result = InterruptMessageSchema.parse({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Test',
        durationUntilInterruptMs: 1500,
      });

      expect(result.durationUntilInterruptMs).toBe(1500);
    });

    it('should parse minimal interrupt (no optional fields)', () => {
      const result = InterruptMessageSchema.parse({ type: 'interrupt' });

      expect(result.utteranceUntilInterrupt).toBeUndefined();
      expect(result.durationUntilInterruptMs).toBeUndefined();
    });
  });

  describe('sendStreamingResponse()', () => {
    const createStreamingMockWebSocket = () => {
      const handlers: Record<string, ((...args: any[]) => void)[]> = {};
      return {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1, // WebSocket.OPEN
        _handlers: handlers,
        _emit(event: string, ...args: any[]) {
          for (const h of handlers[event] || []) {
            h(...args);
          }
        },
      };
    };

    const setupForStreaming = async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest123',
        authToken: 'test_token_123',
        apiKey: 'test_api_key',
        apiSecret: 'test_api_token',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });
      const voiceChannel = new VoiceChannel(tac);

      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHstream_test', status: 'ACTIVE' },
      ] as ConversationId);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        { profileId: 'mem_profile_test', addresses: [{ channel: 'VOICE', address: '+15551234567' }] },
      ] as ConversationId);
      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as ConversationId);

      tac.registerChannel(voiceChannel);

      const mockWs = createStreamingMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'setup',
        sessionId: 'sess_stream',
        callSid: 'CA_stream',
        from: '+15551234567',
        to: '+15559876543',
        direction: 'inbound',
        callType: 'PSTN',
        callStatus: 'ringing',
        accountSid: 'ACtest123',
      })));

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'prompt',
        voicePrompt: 'Hello',
        lang: 'en-US',
        last: true,
      })));

      await new Promise(resolve => setTimeout(resolve, 50));

      return { tac, voiceChannel, mockWs };
    };

    async function* makeTokenStream(tokens: string[]): AsyncGenerator<string> {
      for (const token of tokens) {
        yield token;
      }
    }

    it('should stream tokens with last: false and end with last: true', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      const result = await voiceChannel.sendStreamingResponse(
        'CHstream_test' as ConversationId,
        makeTokenStream(['Hello', ' ', 'world']),
      );

      expect(result).toBe('Hello world');

      const sendCalls = mockWs.send.mock.calls;
      const streamCalls = sendCalls.filter((call: any[]) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.type === 'text';
      });

      expect(streamCalls.length).toBeGreaterThanOrEqual(4);

      const tokens = streamCalls.map((call: any[]) => JSON.parse(call[0] as string));
      const intermediateTokens = tokens.filter((t: any) => t.last === false);
      const finalMarker = tokens.find((t: any) => t.last === true && t.token === '');

      expect(intermediateTokens).toHaveLength(3);
      expect(intermediateTokens[0].token).toBe('Hello');
      expect(intermediateTokens[1].token).toBe(' ');
      expect(intermediateTokens[2].token).toBe('world');
      expect(finalMarker).toBeDefined();
    });

    it('should stop streaming when AbortSignal is aborted', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      const controller = new AbortController();

      async function* abortableStream(): AsyncGenerator<string> {
        yield 'First';
        controller.abort();
        yield 'Second';
        yield 'Third';
      }

      const result = await voiceChannel.sendStreamingResponse(
        'CHstream_test' as ConversationId,
        abortableStream(),
        { signal: controller.signal },
      );

      expect(result).toBe('First');

      const sendCalls = mockWs.send.mock.calls;
      const textMessages = sendCalls
        .map((call: any[]) => JSON.parse(call[0] as string))
        .filter((m: any) => m.type === 'text');

      const hasSecondToken = textMessages.some((m: any) => m.token === 'Second');
      expect(hasSecondToken).toBe(false);

      const hasFinalMarker = textMessages.some(
        (m: any) => m.last === true && m.token === ''
      );
      expect(hasFinalMarker).toBe(false);
    });

    it('should stop streaming when WebSocket closes mid-stream', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      let sendCount = 0;
      mockWs.send = vi.fn(() => {
        sendCount++;
        if (sendCount >= 2) {
          (mockWs as ConversationId).readyState = 3; // WebSocket.CLOSED
        }
      });

      const result = await voiceChannel.sendStreamingResponse(
        'CHstream_test' as ConversationId,
        makeTokenStream(['One', 'Two', 'Three']),
      );

      expect(result).toBe('OneTwo');
    });

    it('should throw for missing WebSocket connection', async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest123',
        authToken: 'test_token_123',
        apiKey: 'test_api_key',
        apiSecret: 'test_api_token',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });
      const voiceChannel = new VoiceChannel(tac);

      await expect(
        voiceChannel.sendStreamingResponse(
          'CH_nonexistent' as ConversationId,
          makeTokenStream(['test']),
        )
      ).rejects.toThrow('No active WebSocket connection');
    });

    it('should clean up stream task when ws.send throws', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      voiceChannel.startStreamTask('CHstream_test' as ConversationId);
      mockWs.send = vi.fn(() => { throw new Error('socket write failed'); });

      await expect(
        voiceChannel.sendStreamingResponse(
          'CHstream_test' as ConversationId,
          makeTokenStream(['boom']),
        )
      ).rejects.toThrow('socket write failed');

      expect(voiceChannel.hasActiveStreamTask('CHstream_test' as ConversationId)).toBe(false);
    });

    it('should complete stream task on successful completion', async () => {
      const { voiceChannel } = await setupForStreaming();

      voiceChannel.startStreamTask('CHstream_test' as ConversationId);
      expect(voiceChannel.hasActiveStreamTask('CHstream_test' as ConversationId)).toBe(true);

      await voiceChannel.sendStreamingResponse(
        'CHstream_test' as ConversationId,
        makeTokenStream(['test']),
      );

      expect(voiceChannel.hasActiveStreamTask('CHstream_test' as ConversationId)).toBe(false);
    });

    it('should fall back to active stream task signal when no explicit signal passed', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      const task = voiceChannel.startStreamTask('CHstream_test' as ConversationId);

      async function* slowStream(): AsyncGenerator<string> {
        yield 'First';
        task.controller.abort();
        yield 'Second';
      }

      const result = await voiceChannel.sendStreamingResponse(
        'CHstream_test' as ConversationId,
        slowStream(),
      );

      expect(result).toBe('First');

      const textMessages = mockWs.send.mock.calls
        .map((call: any[]) => JSON.parse(call[0] as string))
        .filter((m: any) => m.type === 'text');

      const hasSecondToken = textMessages.some((m: any) => m.token === 'Second');
      expect(hasSecondToken).toBe(false);
    });

    it('should stop streaming when explicit signal is aborted via cancelStreamTask', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      const task = voiceChannel.startStreamTask('CHstream_test' as ConversationId);
      let yieldCount = 0;

      async function* slowStream(): AsyncGenerator<string> {
        yield 'First';
        yieldCount++;
        // Simulate interrupt cancelling the stream task externally
        voiceChannel.cancelStreamTask('CHstream_test' as ConversationId);
        yield 'Second';
        yieldCount++;
      }

      const result = await voiceChannel.sendStreamingResponse(
        'CHstream_test' as ConversationId,
        slowStream(),
        { signal: task.controller.signal },
      );

      expect(result).toBe('First');

      const textMessages = mockWs.send.mock.calls
        .map((call: any[]) => JSON.parse(call[0] as string))
        .filter((m: any) => m.type === 'text');

      const hasSecondToken = textMessages.some((m: any) => m.token === 'Second');
      expect(hasSecondToken).toBe(false);

      const hasFinalMarker = textMessages.some(
        (m: any) => m.last === true && m.token === ''
      );
      expect(hasFinalMarker).toBe(false);
    });
  });

  describe('interrupt handling', () => {
    const createInterruptMockWebSocket = () => {
      const handlers: Record<string, ((...args: any[]) => void)[]> = {};
      return {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1,
        _handlers: handlers,
        _emit(event: string, ...args: any[]) {
          for (const h of handlers[event] || []) {
            h(...args);
          }
        },
      };
    };

    const setupForInterrupt = async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest123',
        authToken: 'test_token_123',
        apiKey: 'test_api_key',
        apiSecret: 'test_api_token',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });
      const voiceChannel = new VoiceChannel(tac);

      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHinterrupt_test', status: 'ACTIVE' },
      ] as ConversationId);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        { profileId: 'mem_profile_test', addresses: [{ channel: 'VOICE', address: '+15551234567' }] },
      ] as ConversationId);
      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as ConversationId);

      tac.registerChannel(voiceChannel);

      const mockWs = createInterruptMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as ConversationId);

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'setup',
        sessionId: 'sess_int',
        callSid: 'CA_int',
        from: '+15551234567',
        to: '+15559876543',
        direction: 'inbound',
        callType: 'PSTN',
        callStatus: 'ringing',
        accountSid: 'ACtest123',
      })));

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'prompt',
        voicePrompt: 'Hello',
        lang: 'en-US',
        last: true,
      })));

      await new Promise(resolve => setTimeout(resolve, 50));

      return { tac, voiceChannel, mockWs };
    };

    it('should send stream finalization when interrupt cancels an active stream with tokens sent', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      expect(voiceChannel.hasActiveStreamTask('CHinterrupt_test' as ConversationId)).toBe(true);

      // Actually send a streaming token so the stream is considered active
      voiceChannel.sendStreamingResponse(
        'CHinterrupt_test' as ConversationId,
        (async function* () { yield 'Hello'; yield new Promise(() => {}) as never; })(),
      ).catch(() => {});

      await new Promise(resolve => setTimeout(resolve, 10));
      mockWs.send.mockClear();

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Hello, I was',
      })));

      await new Promise(resolve => setTimeout(resolve, 10));

      const ackCall = mockWs.send.mock.calls.find((call: any[]) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.type === 'text' && parsed.token === '' && parsed.last === true;
      });

      expect(ackCall).toBeDefined();
    });

    it('should not send stream finalization when stream task exists but no tokens sent', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      expect(voiceChannel.hasActiveStreamTask('CHinterrupt_test' as ConversationId)).toBe(true);
      mockWs.send.mockClear();

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Hello',
      })));

      await new Promise(resolve => setTimeout(resolve, 10));

      const ackCall = mockWs.send.mock.calls.find((call: any[]) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.type === 'text' && parsed.token === '' && parsed.last === true;
      });

      expect(ackCall).toBeUndefined();
    });

    it('should not send stream finalization when no stream is active', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      voiceChannel.completeStreamTask('CHinterrupt_test' as ConversationId);
      expect(voiceChannel.hasActiveStreamTask('CHinterrupt_test' as ConversationId)).toBe(false);
      mockWs.send.mockClear();

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Hello again',
      })));

      await new Promise(resolve => setTimeout(resolve, 10));

      const ackCall = mockWs.send.mock.calls.find((call: any[]) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.type === 'text' && parsed.token === '' && parsed.last === true;
      });

      expect(ackCall).toBeUndefined();
    });

    it('should pass utteranceUntilInterrupt through onInterrupt callback', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      const captured: { utteranceUntilInterrupt: string | undefined; durationUntilInterruptMs: number | undefined }[] = [];
      voiceChannel.on('interrupt', (data: any) => {
        captured.push({
          utteranceUntilInterrupt: data.utteranceUntilInterrupt,
          durationUntilInterruptMs: data.durationUntilInterruptMs,
        });
      });

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Hello, I was say',
        durationUntilInterruptMs: 2500,
      })));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(captured).toHaveLength(1);
      expect(captured[0].utteranceUntilInterrupt).toBe('Hello, I was say');
      expect(captured[0].durationUntilInterruptMs).toBe(2500);
    });

    it('should propagate utteranceUntilInterrupt through tac.onInterrupt callback', async () => {
      const { tac, mockWs } = await setupForInterrupt();

      const captured: { utteranceUntilInterrupt: string | undefined; durationUntilInterruptMs: number | undefined }[] = [];
      tac.onInterrupt(({ utteranceUntilInterrupt, durationUntilInterruptMs }) => {
        captured.push({ utteranceUntilInterrupt, durationUntilInterruptMs });
      });

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Hello, I was saying',
        durationUntilInterruptMs: 3200,
      })));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(captured).toHaveLength(1);
      expect(captured[0].utteranceUntilInterrupt).toBe('Hello, I was saying');
      expect(captured[0].durationUntilInterruptMs).toBe(3200);
    });

    it('should auto-start stream task on prompt and pass abortSignal', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      const capturedSignals: AbortSignal[] = [];
      voiceChannel.on('prompt', (data: any) => {
        capturedSignals.push(data.abortSignal);
      });

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'prompt',
        voicePrompt: 'Another prompt',
        lang: 'en-US',
        last: true,
      })));

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(capturedSignals).toHaveLength(1);
      expect(capturedSignals[0]).toBeInstanceOf(AbortSignal);
      expect(capturedSignals[0].aborted).toBe(false);
    });

    it('should abort stream task signal on interrupt', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      const capturedSignals: AbortSignal[] = [];
      voiceChannel.on('prompt', (data: any) => {
        capturedSignals.push(data.abortSignal);
      });

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'prompt',
        voicePrompt: 'Start talking',
        lang: 'en-US',
        last: true,
      })));

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(capturedSignals).toHaveLength(1);
      expect(capturedSignals[0].aborted).toBe(false);

      mockWs._emit('message', Buffer.from(JSON.stringify({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Hello',
      })));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(capturedSignals[0].aborted).toBe(true);
    });

    it('should cancel stream task on WebSocket disconnect', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      expect(voiceChannel.hasActiveStreamTask('CHinterrupt_test' as ConversationId)).toBe(true);

      mockWs._emit('close');

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(voiceChannel.hasActiveStreamTask('CHinterrupt_test' as ConversationId)).toBe(false);
    });
  });

  describe('Webhook Processing', () => {
    it('should handle CONVERSATION_UPDATED with CLOSED status and end local session', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Create a mock conversation session
      const conversationId = 'CH123' as ConversationId;
      voiceChannel['startConversation'](conversationId);

      expect(voiceChannel.isConversationActive(conversationId)).toBe(true);

      const onConversationEnded = vi.fn();
      voiceChannel.on('conversationEnded', onConversationEnded);

      // Process webhook with CONVERSATION_UPDATED and CLOSED status
      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          conversationId: 'CH123',
          status: 'CLOSED',
        },
      });

      expect(voiceChannel.isConversationActive(conversationId)).toBe(false);
      expect(onConversationEnded).toHaveBeenCalledWith({
        session: expect.objectContaining({
          conversationId,
        }),
      });
    });

    it('should ignore CONVERSATION_UPDATED with CLOSED status if no local session exists', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const conversationId = 'CH123' as ConversationId;
      const onConversationEnded = vi.fn();
      voiceChannel.on('conversationEnded', onConversationEnded);

      // Process webhook without creating a session first
      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          conversationId: 'CH123',
          status: 'CLOSED',
        },
      });

      expect(voiceChannel.isConversationActive(conversationId)).toBe(false);
      expect(onConversationEnded).not.toHaveBeenCalled();
    });

    it('should ignore CONVERSATION_UPDATED with non-CLOSED status', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const conversationId = 'CH123' as ConversationId;
      voiceChannel['startConversation'](conversationId);

      const onConversationEnded = vi.fn();
      voiceChannel.on('conversationEnded', onConversationEnded);

      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          conversationId: 'CH123',
          status: 'ACTIVE',
        },
      });

      expect(voiceChannel.isConversationActive(conversationId)).toBe(true);
      expect(onConversationEnded).not.toHaveBeenCalled();
    });

    it('should ignore unhandled event types', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const conversationId = 'CH123' as ConversationId;
      voiceChannel['startConversation'](conversationId);

      await voiceChannel.processWebhook({
        eventType: 'SOME_OTHER_EVENT',
        data: {
          conversationId: 'CH123',
        },
      });

      expect(voiceChannel.isConversationActive(conversationId)).toBe(true);
    });

    it('should deduplicate webhooks using idempotency token', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const conversationId = 'CH123' as ConversationId;
      voiceChannel['startConversation'](conversationId);

      const onConversationEnded = vi.fn();
      voiceChannel.on('conversationEnded', onConversationEnded);

      const payload = {
        eventType: 'CONVERSATION_UPDATED',
        data: {
          conversationId: 'CH123',
          status: 'CLOSED',
        },
      };

      // First call should process
      await voiceChannel.processWebhook(payload, 'token-123');
      expect(voiceChannel.isConversationActive(conversationId)).toBe(false);
      expect(onConversationEnded).toHaveBeenCalledTimes(1);

      // Recreate session for second test
      voiceChannel['startConversation'](conversationId);

      // Second call with same token should be skipped
      await voiceChannel.processWebhook(payload, 'token-123');
      expect(voiceChannel.isConversationActive(conversationId)).toBe(true);
      expect(onConversationEnded).toHaveBeenCalledTimes(1);
    });

    it('should remove idempotency token on webhook processing error', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const onError = vi.fn();
      voiceChannel.on('error', onError);

      const conversationId = 'CH123' as ConversationId;
      voiceChannel['startConversation'](conversationId);

      // Payload passes validation and dedup check, but fails during handling
      // (missing conversationId in data causes error after token is recorded)
      await voiceChannel.processWebhook(
        {
          eventType: 'CONVERSATION_UPDATED',
          data: {
            status: 'CLOSED',
            // conversationId intentionally omitted to trigger error after dedup
          },
        },
        'token-456'
      );

      expect(onError).toHaveBeenCalled();
      expect(voiceChannel.isConversationActive(conversationId)).toBe(true);

      // Token should be removed on error, so retry with same token and valid payload should work
      await voiceChannel.processWebhook(
        {
          eventType: 'CONVERSATION_UPDATED',
          data: {
            conversationId: 'CH123',
            status: 'CLOSED',
          },
        },
        'token-456'
      );

      expect(voiceChannel.isConversationActive(conversationId)).toBe(false);
    });

    it('should ignore events for different channel types (SMS)', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const conversationId = 'CH123' as ConversationId;
      voiceChannel['startConversation'](conversationId);

      // COMMUNICATION_CREATED with SMS channel should be ignored
      await voiceChannel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CH123',
          author: {
            channel: 'SMS',
            address: '+15551234567',
          },
        },
      });

      // Session should still be active (not processed)
      expect(voiceChannel.isConversationActive(conversationId)).toBe(true);
    });

    it('should process events for VOICE channel type', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const conversationId = 'CH123' as ConversationId;
      voiceChannel['startConversation'](conversationId);

      // COMMUNICATION_CREATED with VOICE channel should be processed (not throw)
      await voiceChannel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CH123',
          author: {
            channel: 'VOICE',
            address: '+15551234567',
          },
        },
      });

      // Should not throw - session still active since COMMUNICATION_CREATED isn't handled yet
      expect(voiceChannel.isConversationActive(conversationId)).toBe(true);
    });

    it('should ignore CONVERSATION_UPDATED for untracked conversations', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const onConversationEnded = vi.fn();
      voiceChannel.on('conversationEnded', onConversationEnded);

      // CONVERSATION_UPDATED for a conversation we don't track should be ignored
      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          conversationId: 'CH_untracked',
          status: 'CLOSED',
        },
      });

      expect(onConversationEnded).not.toHaveBeenCalled();
    });
  });

});
