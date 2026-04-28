import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpyInstance } from 'vitest';
import { TAC, SMSChannel } from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';

describe('Integration Tests', () => {
  const getTestConfig = () => ({

    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd'
  });

  let tac: TAC;
  let channel: SMSChannel;
  let fetchSpy: SpyInstance;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL) => {
      const urlString = url.toString();

      // Mock listParticipants call
      if (urlString.includes('/Participants')) {
        const participantResponse = {
          participants: [
            {
              id: 'PA111',
              conversationId: 'CHtest123456789',
              accountId: 'ACtest123456789',
              type: 'AI_AGENT',
              addresses: [{ channel: 'SMS', address: '+15551234567' }],
            },
            {
              id: 'PA222',
              conversationId: 'CHtest123456789',
              accountId: 'ACtest123456789',
              type: 'CUSTOMER',
              addresses: [{ channel: 'SMS', address: '+15559876543' }],
            },
          ],
        };

        return new Response(JSON.stringify(participantResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Mock createAction call (returns 202 Accepted)
      const actionResponse = {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
        createdAt: '2025-01-15T10:30:00Z',
      };

      return new Response(JSON.stringify(actionResponse), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    tac = await createTestTAC(getTestConfig());
    channel = new SMSChannel(tac);
    tac.registerChannel(channel);
    // BaseClient uses axios, which the fetch spy above doesn't intercept — so
    // memory retrieval still reaches Twilio and returns 401 on fake creds. Stub
    // at the HTTP boundary (not tac.retrieveMemory) so the real handleMessageReady
    // flow still runs end-to-end — callbacks depend on its async timing.
    const memoryClient = tac.getMemoryClient();
    vi.spyOn(memoryClient, 'lookupProfile').mockResolvedValue({
      normalizedValue: '',
      profiles: [],
    } as never);
    vi.spyOn(memoryClient, 'retrieveMemories').mockResolvedValue({
      observations: [],
      summaries: [],
      communications: [],
    } as never);
    vi.spyOn(tac.getConversationClient(), 'listCommunications').mockResolvedValue([]);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('SMS end-to-end workflow', () => {
    it('should handle complete SMS conversation flow', async () => {
      let capturedContext: any = null;

      // Register message callback
      tac.onMessageReady(({ conversationId, profileId, message, author, session }) => {
        capturedContext = { conversationId, profileId, message, author, session };
        return 'Hello back!';
      });

      // Simulate conversation start
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          profileId: 'profile_123',
        }
      });

      // Simulate message received
      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: 'Hello TAC',
          },
          author: {
            address: '+15559876543',
            channel: 'SMS'
          }
        }
      });

      // Wait a tick for async callbacks
      await new Promise(resolve => setTimeout(resolve, 0));

      // Verify callback was invoked with correct context
      expect(capturedContext).not.toBeNull();
      expect(capturedContext.conversationId).toBe('CHtest123456789');
      expect(capturedContext.message).toBe('Hello TAC');
      expect(capturedContext.author).toBe('+15559876543');
      expect(capturedContext.session).toBeDefined();
      expect(capturedContext.session.conversationId).toBe('CHtest123456789');
    });

    it('should handle multiple concurrent conversations', async () => {
      const capturedMessages: any[] = [];

      tac.onMessageReady((context) => {
        capturedMessages.push(context);
        return `Response to ${context.conversationId}`;
      });

      // Start multiple conversations
      const conversations = ['CHtest1', 'CHtest2', 'CHtest3'];

      for (const convId of conversations) {
        await channel.processWebhook({
          eventType: 'CONVERSATION_CREATED',
          data: {
            conversationId: convId,
          }
        });

        await channel.processWebhook({
          eventType: 'COMMUNICATION_CREATED',
          data: {
            conversationId: convId,
            content: {
              type: 'TEXT',
              text: `Message from ${convId}`
            },
            author: {
              address: '+15559876543',
              channel: 'SMS'
            }
          }
        });
      }

      // Verify all conversations were processed
      expect(capturedMessages).toHaveLength(3);
      expect(capturedMessages.map(m => m.conversationId)).toContain('CHtest1');
      expect(capturedMessages.map(m => m.conversationId)).toContain('CHtest2');
      expect(capturedMessages.map(m => m.conversationId)).toContain('CHtest3');
    });

    it('should filter out empty messages', async () => {
      const capturedMessages: any[] = [];

      tac.onMessageReady((context) => {
        capturedMessages.push(context);
        return 'Response';
      });

      // Send valid message
      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: 'Valid message'
          },
          author: {
            address: '+15559876543',
            channel: 'SMS'
          }
        }
      });

      // Send empty messages (should be filtered)
      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: ''
          },
          author: {
            address: '+15559876543',
            channel: 'SMS'
          }
        }
      });

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: '   '  // Whitespace only
          },
          author: {
            address: '+15559876543',
            channel: 'SMS'
          }
        }
      });

      // Only valid message should be processed
      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0].message).toBe('Valid message');
    });

    it('should handle conversation cleanup', async () => {
      // Start conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
        }
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);

      // End conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          conversationId: 'CHtest123456789',
          status: 'CLOSED'
        }
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });
  });

  describe('callback registration and execution', () => {
    it('should handle message callback errors gracefully', async () => {
      // Register callback that throws error
      tac.onMessageReady(() => {
        throw new Error('Callback error');
      });

      // Should not throw when callback errors
      await expect(channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: 'Test message'
          },
          author: {
            address: '+15559876543',
            channel: 'SMS'
          }
        }
      })).resolves.not.toThrow();
    });

  });

  describe('channel management', () => {
    it('should register and retrieve channels', () => {
      const smsChannel = tac.getChannel('sms');
      expect(smsChannel).toBe(channel);

      const voiceChannel = tac.getChannel('voice');
      expect(voiceChannel).toBeUndefined();
    });

    it('should replace existing channel of same type', () => {
      const newChannel = new SMSChannel(tac);

      // Register new channel of same type
      tac.registerChannel(newChannel);

      const smsChannel = tac.getChannel('sms');
      expect(smsChannel).toBe(newChannel);
      expect(smsChannel).not.toBe(channel);
    });
  });

  describe('framework lifecycle', () => {
    it('should shutdown cleanly', () => {
      tac.shutdown();

      expect(tac.getChannel('sms')).toBeUndefined();
      expect(tac.getChannel('voice')).toBeUndefined();
    });
  });
});
