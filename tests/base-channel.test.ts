import { describe, it, expect, beforeEach } from 'vitest';
import { BaseChannel, ConversationWebhookPayload } from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';
import type { ChannelType, ConversationId, ProfileId } from '@twilio/tac-core';

/**
 * Concrete test implementation of BaseChannel for testing
 */
class TestChannel extends BaseChannel {
  public get channelType(): ChannelType {
    return 'sms';
  }

  public async processWebhook(_payload: unknown): Promise<void> {
    // Test implementation
  }

  public async sendResponse(
    _conversationId: ConversationId,
    _message: string,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    // Test implementation
  }

  // Expose protected methods for testing
  public testIsDuplicateWebhook(token: string): boolean {
    return this.isDuplicateWebhook(token);
  }

  public testRemoveWebhookToken(token: string): void {
    return this.removeWebhookToken(token);
  }

  public testIsEventForThisChannel(webhookData: ConversationWebhookPayload): boolean {
    return this.isEventForThisChannel(webhookData);
  }
}

describe('BaseChannel', () => {
  describe('Webhook Deduplication', () => {
    it('should track idempotency tokens', async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest',
        authToken: 'test_token',
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });

      const channel = new TestChannel(tac);

      // First call should return false (not duplicate)
      expect(channel.testIsDuplicateWebhook('token1')).toBe(false);

      // Second call with same token should return true (duplicate)
      expect(channel.testIsDuplicateWebhook('token1')).toBe(true);
    });

    it('should track different tokens independently', async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest',
        authToken: 'test_token',
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });

      const channel = new TestChannel(tac);

      expect(channel.testIsDuplicateWebhook('token1')).toBe(false);
      expect(channel.testIsDuplicateWebhook('token2')).toBe(false);
      expect(channel.testIsDuplicateWebhook('token3')).toBe(false);

      // Each should now be marked as duplicate
      expect(channel.testIsDuplicateWebhook('token1')).toBe(true);
      expect(channel.testIsDuplicateWebhook('token2')).toBe(true);
      expect(channel.testIsDuplicateWebhook('token3')).toBe(true);
    });

    it('should remove token from deduplication cache', async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest',
        authToken: 'test_token',
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });

      const channel = new TestChannel(tac);

      // Add token
      expect(channel.testIsDuplicateWebhook('token1')).toBe(false);
      expect(channel.testIsDuplicateWebhook('token1')).toBe(true);

      // Remove token
      channel.testRemoveWebhookToken('token1');

      // Should be able to process again
      expect(channel.testIsDuplicateWebhook('token1')).toBe(false);
    });

    it('should respect dedupCapacity limit with FIFO eviction', async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest',
        authToken: 'test_token',
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });

      const channel = new TestChannel(tac, { dedupCapacity: 3 });

      // Add 3 tokens (at capacity)
      expect(channel.testIsDuplicateWebhook('token1')).toBe(false);
      expect(channel.testIsDuplicateWebhook('token2')).toBe(false);
      expect(channel.testIsDuplicateWebhook('token3')).toBe(false);

      // Add 4th token - should evict token1 (FIFO)
      expect(channel.testIsDuplicateWebhook('token4')).toBe(false);

      // token1 should be evicted and can be processed again
      expect(channel.testIsDuplicateWebhook('token1')).toBe(false);

      // Add 5th token - should evict token2 (next in FIFO order)
      expect(channel.testIsDuplicateWebhook('token5')).toBe(false);

      // token2 should now be evicted
      expect(channel.testIsDuplicateWebhook('token2')).toBe(false);
    });

    it('should throw error for invalid dedupCapacity', async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest',
        authToken: 'test_token',
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });

      expect(() => new TestChannel(tac, { dedupCapacity: 0 })).toThrow(
        'dedupCapacity must be a positive integer'
      );

      expect(() => new TestChannel(tac, { dedupCapacity: -1 })).toThrow(
        'dedupCapacity must be a positive integer'
      );

      expect(() => new TestChannel(tac, { dedupCapacity: 1.5 })).toThrow(
        'dedupCapacity must be a positive integer'
      );
    });
  });

  describe('Event Filtering', () => {
    let channel: TestChannel;

    beforeEach(async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest',
        authToken: 'test_token',
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });

      channel = new TestChannel(tac);
    });

    it('should accept COMMUNICATION_CREATED with matching channel', () => {
      const webhook: ConversationWebhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123',
          author: {
            address: '+15551234567',
            channel: 'SMS',
          },
          content: {
            text: 'Hello',
          },
        },
      };

      expect(channel.testIsEventForThisChannel(webhook)).toBe(true);
    });

    it('should reject COMMUNICATION_CREATED without author.channel', () => {
      const webhook: ConversationWebhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123',
          author: {
            address: '+15551234567',
          },
          content: {
            text: 'Hello',
          },
        },
      };

      expect(channel.testIsEventForThisChannel(webhook)).toBe(false);
    });

    it('should reject COMMUNICATION_CREATED with different channel', () => {
      const webhook: ConversationWebhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123',
          author: {
            address: '+15551234567',
            channel: 'VOICE',
          },
          content: {
            text: 'Hello',
          },
        },
      };

      expect(channel.testIsEventForThisChannel(webhook)).toBe(false);
    });

    it('should accept CONVERSATION_UPDATED for tracked conversation', () => {
      // Start a conversation to track it
      channel['startConversation']('CHtest123' as ConversationId);

      const webhook: ConversationWebhookPayload = {
        eventType: 'CONVERSATION_UPDATED',
        data: {
          id: 'CHtest123',
          status: 'CLOSED',
        },
      };

      expect(channel.testIsEventForThisChannel(webhook)).toBe(true);
    });

    it('should reject CONVERSATION_UPDATED for untracked conversation', () => {
      const webhook: ConversationWebhookPayload = {
        eventType: 'CONVERSATION_UPDATED',
        data: {
          id: 'CHunknown',
          status: 'CLOSED',
        },
      };

      expect(channel.testIsEventForThisChannel(webhook)).toBe(false);
    });

    it('should accept other event types', () => {
      const webhook: ConversationWebhookPayload = {
        eventType: 'CONVERSATION_CREATED',
        data: {
          id: 'CHtest123',
        },
      };

      expect(channel.testIsEventForThisChannel(webhook)).toBe(true);
    });
  });
});
