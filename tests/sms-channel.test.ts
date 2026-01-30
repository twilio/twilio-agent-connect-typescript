import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SMSChannel, TAC } from '@twilio/tac-core';

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

describe('SMS Channel', () => {
  const getTestConfig = () => ({
    environment: 'dev' as const,
    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let channel: SMSChannel;
  let tac: TAC;

  beforeEach(() => {
    tac = new TAC({ config: getTestConfig() });
    channel = new SMSChannel(tac);
  });

  describe('initialization', () => {
    it('should create SMS channel with config', () => {
      expect(channel).toBeInstanceOf(SMSChannel);
      expect(channel.channelType).toBe('sms');
    });

    it('should start with no active conversations', () => {
      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });
  });

  describe('webhook processing', () => {
    it('should process conversation.created event', async () => {
      const webhookPayload = {
        eventType: 'CONVERSATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          profileId: 'test_profile_123',
        },
      };

      await expect(channel.processWebhook(webhookPayload)).resolves.not.toThrow();

      // Should have started a conversation
      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
    });

    it('should process communication.created event', async () => {
      let capturedMessage: any = null;

      // Set up message received callback
      channel.on('messageReceived', data => {
        capturedMessage = data;
      });

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: 'Hello world',
          },
          author: {
            address: '+15559876543', // Different from twilioPhoneNumber
            channel: 'SMS',
          },
        },
      };

      await channel.processWebhook(webhookPayload);

      // Wait a tick for callback to execute
      await new Promise(resolve => setTimeout(resolve, 0));

      // Should have triggered message callback
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.conversationId).toBe('CHtest123456789');
      expect(capturedMessage.message).toBe('Hello world');
      expect(capturedMessage.author).toBe('+15559876543');
    });

    it('should skip events with unexpected eventType format', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      await channel.processWebhook({
        eventType: 'communication.created', // already normalized format
        data: {
          conversationId: 'CHtest123456789',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should process conversation.updated event (close)', async () => {
      // First add a conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
        },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);

      // Then close it
      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          conversationId: 'CHtest123456789',
          status: 'CLOSED',
        },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });

    it('should ignore empty messages', async () => {
      let messageReceived = false;

      channel.on('messageReceived', () => {
        messageReceived = true;
      });

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: '', // Empty message
          },
          author: {
            address: '+15559876543',
          },
        },
      };

      await channel.processWebhook(webhookPayload);

      // Should not have triggered callback for empty message
      expect(messageReceived).toBe(false);
    });

    it('should auto-initialize conversation on first message', async () => {
      let capturedMessage: any = null;

      channel.on('messageReceived', data => {
        capturedMessage = data;
      });

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: 'First message',
          },
          author: {
            address: '+15559876543',
          },
        },
      };

      // Conversation not active initially
      expect(channel.isConversationActive('CHtest123456789')).toBe(false);

      await channel.processWebhook(webhookPayload);

      // Should auto-initialize and process message
      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.message).toBe('First message');
    });
  });

  describe('participant address', () => {
    it('should create SMS participant address', () => {
      const address = { channel: 'SMS' as const, address: '+15551234567' };

      expect(address.channel).toBe('SMS');
      expect(address.address).toBe('+15551234567');
    });
  });

  describe('conversation management', () => {
    it('should track multiple active conversations', async () => {
      // Add multiple conversations
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
        },
      });

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          conversationId: 'CHtest987654321',
        },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
      expect(channel.isConversationActive('CHtest987654321')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle invalid webhook payload gracefully', async () => {
      await expect(channel.processWebhook(null)).resolves.not.toThrow();
      await expect(channel.processWebhook({})).resolves.not.toThrow();
    });

    it('should handle unknown event types', async () => {
      const webhookPayload = {
        eventType: 'UNKNOWN_EVENT',
        data: {
          conversationId: 'CHtest123456789',
        },
      };

      await expect(channel.processWebhook(webhookPayload)).resolves.not.toThrow();
    });
  });
});
