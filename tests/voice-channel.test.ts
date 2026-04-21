import { describe, it, expect, vi } from 'vitest';
import { createTestTAC } from './helpers/tac';
import { VoiceChannel, TAC, TACConfig, ConversationSession } from '@twilio/tac-core';

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

      const ws = voiceChannel.getWebsocket('CA_unknown' as any);

      expect(ws).toBeNull();
    });
  });

  describe('isConversationActive()', () => {
    it('should return false for unknown conversation', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const isActive = voiceChannel.isConversationActive('CA_unknown' as any);

      expect(isActive).toBe(false);
    });
  });

  describe('stream task management', () => {
    it('should start and track a stream task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      const controller = voiceChannel.startStreamTask(conversationId);

      expect(controller).toBeInstanceOf(AbortController);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);
    });

    it('should cancel an active stream task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      const controller = voiceChannel.startStreamTask(conversationId);
      const cancelled = voiceChannel.cancelStreamTask(conversationId);

      expect(cancelled).toBe(true);
      expect(controller.signal.aborted).toBe(true);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });

    it('should return false when cancelling non-existent task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const cancelled = voiceChannel.cancelStreamTask('CH_nonexistent' as any);

      expect(cancelled).toBe(false);
    });

    it('should complete a stream task (remove from tracking)', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      voiceChannel.startStreamTask(conversationId);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);

      voiceChannel.completeStreamTask(conversationId);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });

    it('should replace existing stream task when starting new one', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      const firstController = voiceChannel.startStreamTask(conversationId);
      const secondController = voiceChannel.startStreamTask(conversationId);

      expect(firstController.signal.aborted).toBe(true);
      expect(secondController.signal.aborted).toBe(false);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);
    });

    it('should report inactive for aborted task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      voiceChannel.startStreamTask(conversationId);
      voiceChannel.cancelStreamTask(conversationId);

      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });
  });

  describe('shutdown()', () => {
    it('should clear all stream tasks on shutdown', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      voiceChannel.startStreamTask('CH_1' as any);
      voiceChannel.startStreamTask('CH_2' as any);

      expect(voiceChannel.hasActiveStreamTask('CH_1' as any)).toBe(true);
      expect(voiceChannel.hasActiveStreamTask('CH_2' as any)).toBe(true);

      voiceChannel.shutdown();

      expect(voiceChannel.hasActiveStreamTask('CH_1' as any)).toBe(false);
      expect(voiceChannel.hasActiveStreamTask('CH_2' as any)).toBe(false);
    });

    it('should clear WebSocket references on shutdown', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Start with no WebSocket connections
      expect(voiceChannel.getWebsocket('CH_test' as any)).toBeNull();

      // After shutdown, should still return null (cleared state)
      voiceChannel.shutdown();
      expect(voiceChannel.getWebsocket('CH_test' as any)).toBeNull();
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

    it('should fire onConversationEnded on WebSocket disconnect', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const captured: ConversationSession[] = [];

      // Mock conversation client methods for initialization
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      const ended = new Promise<void>(resolve => {
        tac.onConversationEnded(({ session }) => {
          captured.push(session);
          resolve();
        });
      });
      tac.registerChannel(voiceChannel);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      // Trigger setup
      mockWs._emit('message', Buffer.from(setupMessage));

      // Trigger first prompt (initializes conversation)
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      // Trigger close and wait for callback
      mockWs._emit('close');
      await ended;

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHcb_test12345');
      expect(captured[0].channel).toBe('voice');
    });

    it('should still clean up session if callback throws', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Mock conversation client methods for initialization
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      const ended = new Promise<void>(resolve => {
        tac.onConversationEnded(() => {
          resolve();
          throw new Error('boom');
        });
      });
      tac.registerChannel(voiceChannel);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      // Trigger setup and first prompt
      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      mockWs._emit('close');
      await ended;
      // Allow microtasks to finish cleanup after the thrown error
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(false);
    });

    it('should support async callback', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const captured: ConversationSession[] = [];

      // Mock conversation client methods for initialization
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      const ended = new Promise<void>(resolve => {
        tac.onConversationEnded(async ({ session }) => {
          captured.push(session);
          resolve();
        });
      });
      tac.registerChannel(voiceChannel);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      // Trigger setup and first prompt
      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 10));

      mockWs._emit('close');
      await ended;

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHcb_test12345');
    });

    it('should clean up silently when no callback is registered', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Mock conversation client methods for initialization
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      // Trigger setup and first prompt
      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      mockWs._emit('close');
      // Flush microtask-based async chain (no callback to hook into)
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(false);
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
      voiceChannel.handleWebSocketConnection(mockWs as any);

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
        return Promise.resolve([{ id: 'CHcb_test12345', status: 'ACTIVE' }] as any);
      });
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

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
      voiceChannel.handleWebSocketConnection(mockWs as any);

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
        return Promise.resolve([{ id: 'CHcb_test12345', status: 'ACTIVE' }] as any);
      });
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

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
      voiceChannel.handleWebSocketConnection(mockWs as any);

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
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      voiceChannel.handleWebSocketConnection(mockWs2 as any);
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
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockRejectedValue(
        new Error('Failed to list participants: 500 Server Error')
      );

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

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

  describe('handleConversationRelayCallback()', () => {
    it('should return 200 OK for completed call without conversations', async () => {
      const tac = await createTestTAC(getTestConfig());
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
      const tac = await createTestTAC(getTestConfig());
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
      const tac = await createTestTAC(getTestConfig());
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
      const tac = await createTestTAC(getTestConfig());
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
      const tac = await createTestTAC(getTestConfig());
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
