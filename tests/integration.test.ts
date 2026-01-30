import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpyInstance } from 'vitest';
import { TAC, SMSChannel } from '@twilio/tac-core';

vi.mock('twilio', () => {
  const createClient = vi.fn(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({ sid: 'SM00000000000000000000000000000000' }),
    },
  }));

  return {
    default: createClient,
  };
});

describe('Integration Tests', () => {
  const getTestConfig = () => ({
    environment: 'dev' as const,
    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd'
  });

  let tac: TAC;
  let channel: SMSChannel;
  let fetchSpy: SpyInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const participantResponse = {
        participants: [
          {
            id: 'PA00000000000000000000000000000000',
            type: 'CUSTOMER',
            addresses: [
              {
                channel: 'SMS',
                address: '+15559876543',
                channel_id: null,
              },
            ],
            conversation_id: 'CHtest123456789',
            account_id: 'ACtest123456789',
            service_id: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
            name: null,
            profile_id: null,
            attributes: null,
            created_at: null,
            updated_at: null,
          },
        ],
      };

      return new Response(JSON.stringify(participantResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    tac = new TAC({ config: getTestConfig() });
    channel = new SMSChannel(tac);
    tac.registerChannel(channel);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
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
            address: '+15559876543'
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
      expect(capturedContext.session.conversation_id).toBe('CHtest123456789');
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
              address: '+15559876543'
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
            address: '+15559876543'
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
            address: '+15559876543'
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
            address: '+15559876543'
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
            address: '+15559876543'
          }
        }
      })).resolves.not.toThrow();
    });

    it('should handle handoff workflow', async () => {
      let handoffCalled = false;
      let handoffReason: string | null = null;

      tac.onHandoff(({ reason }) => {
        handoffCalled = true;
        handoffReason = reason;
      });

      // Start a conversation first
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          conversationId: 'CHtest123456789'
        }
      });

      // Trigger handoff
      await tac.triggerHandoff('CHtest123456789', 'User requested human agent');

      expect(handoffCalled).toBe(true);
      expect(handoffReason).toBe('User requested human agent');
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
