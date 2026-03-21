import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TAC } from '../packages/core/src/lib/tac';
import { VoiceChannel } from '../packages/core/src/channels/voice';
import type { PromptMessage } from '../packages/core/src/types/index';
import { WebSocket } from 'ws';

describe('VoiceChannel - Active Voice Memory Enrichment', () => {
  let tac: TAC;
  let voiceChannel: VoiceChannel;

  const getTestConfig = () => ({
    environment: 'dev' as const,
    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    apiKey: 'SKtest_api_key',
    apiToken: 'test_api_token',
    twilioPhoneNumber: '+15555555555',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
    memoryStoreId: 'mem_store_01234567890123456789abcdef', // Enable memory
  });

  const getTestConfigWithoutMemory = () => ({
    environment: 'dev' as const,
    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    apiKey: 'SKtest_api_key',
    apiToken: 'test_api_token',
    twilioPhoneNumber: '+15555555555',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
    // No memoryStoreId - memory disabled
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    voiceChannel?.shutdown();
  });

  describe('Memory Retrieval in handlePromptMessage', () => {
    it('should retrieve memory when Memory API enabled', async () => {
      tac = new TAC({ config: getTestConfig() });
      voiceChannel = new VoiceChannel(tac);
      tac.registerChannel(voiceChannel);

      // Mock retrieveMemory to return test data
      const mockMemory = {
        observations: [
          {
            id: 'obs1',
            content: 'User prefers email communication',
            createdAt: '2024-01-01T00:00:00Z',
            occurredAt: '2024-01-01T00:00:00Z',
            source: 'test',
          },
        ],
        summaries: [],
        communications: [],
      };

      const retrieveMemorySpy = vi
        .spyOn(tac, 'retrieveMemory')
        .mockResolvedValue(mockMemory as any);

      // Set up WebSocket and session
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        on: vi.fn(),
      } as unknown as WebSocket;

      // Simulate setup message to create session
      const setupMessage = {
        type: 'setup' as const,
        callSid: 'CA123',
        from: '+15551234567',
        to: '+15555555555',
        customParameters: {
          conversation_id: 'conv123',
          profile_id: 'prof123',
        },
      };

      // Access private method for testing
      (voiceChannel as any).handleSetupMessage(mockWs, setupMessage);

      // Set up prompt callback spy
      const promptCallbackSpy = vi.fn();
      voiceChannel.on('prompt', promptCallbackSpy);

      // Simulate prompt message
      const promptMessage: PromptMessage = {
        type: 'prompt',
        voicePrompt: 'Hello, I need help',
      };

      await (voiceChannel as any).handlePromptMessage('conv123', promptMessage);

      // Verify memory was retrieved
      expect(retrieveMemorySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv123',
          profileId: 'prof123',
        }),
        'Hello, I need help'
      );

      // Verify callback received memory
      expect(promptCallbackSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv123',
          transcript: 'Hello, I need help',
          userMemory: mockMemory,
          session: expect.objectContaining({
            conversationId: 'conv123',
            profileId: 'prof123',
          }),
        })
      );
    });

    it('should not retrieve memory when Memory API disabled', async () => {
      tac = new TAC({ config: getTestConfigWithoutMemory() });
      voiceChannel = new VoiceChannel(tac);
      tac.registerChannel(voiceChannel);

      const retrieveMemorySpy = vi.spyOn(tac, 'retrieveMemory');

      // Set up WebSocket and session
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        on: vi.fn(),
      } as unknown as WebSocket;

      const setupMessage = {
        type: 'setup' as const,
        callSid: 'CA123',
        from: '+15551234567',
        to: '+15555555555',
        customParameters: {
          conversation_id: 'conv123',
        },
      };

      (voiceChannel as any).handleSetupMessage(mockWs, setupMessage);

      const promptCallbackSpy = vi.fn();
      voiceChannel.on('prompt', promptCallbackSpy);

      const promptMessage: PromptMessage = {
        type: 'prompt',
        voicePrompt: 'Hello',
      };

      await (voiceChannel as any).handlePromptMessage('conv123', promptMessage);

      // Memory retrieval should NOT be called
      expect(retrieveMemorySpy).not.toHaveBeenCalled();

      // Callback should still be invoked (without memory)
      expect(promptCallbackSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv123',
          transcript: 'Hello',
        })
      );

      // Should not have userMemory property since memory is disabled
      expect(promptCallbackSpy.mock.calls[0][0]).not.toHaveProperty('userMemory');
    });

    it('should handle memory retrieval errors gracefully', async () => {
      tac = new TAC({ config: getTestConfig() });
      voiceChannel = new VoiceChannel(tac);
      tac.registerChannel(voiceChannel);

      // Mock retrieveMemory to throw error
      const retrieveMemorySpy = vi
        .spyOn(tac, 'retrieveMemory')
        .mockRejectedValue(new Error('Memory API unavailable'));

      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        on: vi.fn(),
      } as unknown as WebSocket;

      const setupMessage = {
        type: 'setup' as const,
        callSid: 'CA123',
        from: '+15551234567',
        to: '+15555555555',
        customParameters: {
          conversation_id: 'conv123',
        },
      };

      (voiceChannel as any).handleSetupMessage(mockWs, setupMessage);

      const promptCallbackSpy = vi.fn();
      voiceChannel.on('prompt', promptCallbackSpy);

      const promptMessage: PromptMessage = {
        type: 'prompt',
        voicePrompt: 'Test message',
      };

      // Should not throw - graceful degradation
      await expect(
        (voiceChannel as any).handlePromptMessage('conv123', promptMessage)
      ).resolves.not.toThrow();

      // Callback should still be invoked (without memory)
      expect(promptCallbackSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv123',
          transcript: 'Test message',
        })
      );
    });
  });

  describe('Integration with TAC onMessageReady', () => {
    it('should pass enriched memory to TAC.onMessageReady callback', async () => {
      tac = new TAC({ config: getTestConfig() });
      voiceChannel = new VoiceChannel(tac);
      tac.registerChannel(voiceChannel);

      const mockMemory = {
        observations: [{ id: 'obs1', content: 'Test observation' }],
        summaries: [],
        communications: [],
      };

      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(mockMemory as any);

      const messageReadySpy = vi.fn();
      tac.onMessageReady(messageReadySpy);

      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        on: vi.fn(),
      } as unknown as WebSocket;

      const setupMessage = {
        type: 'setup' as const,
        callSid: 'CA123',
        from: '+15551234567',
        to: '+15555555555',
        customParameters: {
          conversation_id: 'conv123',
          profile_id: 'prof123',
        },
      };

      (voiceChannel as any).handleSetupMessage(mockWs, setupMessage);

      const promptMessage: PromptMessage = {
        type: 'prompt',
        voicePrompt: 'Integration test message',
      };

      await (voiceChannel as any).handlePromptMessage('conv123', promptMessage);

      // TAC's onMessageReady should receive enriched memory
      expect(messageReadySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv123',
          message: 'Integration test message',
          memory: mockMemory,
          channel: 'voice',
        })
      );
    });

    it('should work without memory when disabled', async () => {
      tac = new TAC({ config: getTestConfigWithoutMemory() });
      voiceChannel = new VoiceChannel(tac);
      tac.registerChannel(voiceChannel);

      const messageReadySpy = vi.fn();
      tac.onMessageReady(messageReadySpy);

      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        on: vi.fn(),
      } as unknown as WebSocket;

      const setupMessage = {
        type: 'setup' as const,
        callSid: 'CA123',
        from: '+15551234567',
        to: '+15555555555',
        customParameters: {
          conversation_id: 'conv123',
        },
      };

      (voiceChannel as any).handleSetupMessage(mockWs, setupMessage);

      const promptMessage: PromptMessage = {
        type: 'prompt',
        voicePrompt: 'No memory test',
      };

      await (voiceChannel as any).handlePromptMessage('conv123', promptMessage);

      // Should still invoke callback without memory
      expect(messageReadySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv123',
          message: 'No memory test',
          channel: 'voice',
        })
      );
    });
  });

  describe('Backward Compatibility', () => {
    it('should work with callbacks that only use conversationId and transcript', async () => {
      tac = new TAC({ config: getTestConfig() });
      voiceChannel = new VoiceChannel(tac);
      tac.registerChannel(voiceChannel);

      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue({
        observations: [],
        summaries: [],
        communications: [],
      } as any);

      // Old-style callback that only destructures conversationId and transcript
      const oldStyleCallback = vi.fn(
        ({ conversationId, transcript }: { conversationId: string; transcript: string }) => {
          // Callback only uses these two fields
          expect(conversationId).toBeDefined();
          expect(transcript).toBeDefined();
        }
      );

      voiceChannel.on('prompt', oldStyleCallback);

      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        on: vi.fn(),
      } as unknown as WebSocket;

      const setupMessage = {
        type: 'setup' as const,
        callSid: 'CA123',
        from: '+15551234567',
        to: '+15555555555',
        customParameters: {
          conversation_id: 'conv123',
        },
      };

      (voiceChannel as any).handleSetupMessage(mockWs, setupMessage);

      const promptMessage: PromptMessage = {
        type: 'prompt',
        voicePrompt: 'Backward compat test',
      };

      // Should not throw - old callbacks still work
      await expect(
        (voiceChannel as any).handlePromptMessage('conv123', promptMessage)
      ).resolves.not.toThrow();

      expect(oldStyleCallback).toHaveBeenCalled();
    });
  });
});
