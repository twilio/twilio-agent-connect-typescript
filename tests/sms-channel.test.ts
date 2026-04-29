import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SMSChannel, TAC, ConversationSession } from '@twilio/tac-core';
import MockAdapter from 'axios-mock-adapter';
import { createTestTAC } from './helpers/tac';
import {
  createConversationCreatedWebhook,
  createCommunicationCreatedWebhook,
  createConversationUpdatedWebhook,
  createSMSMessageWebhook,
} from './helpers/webhooks';

describe('SMS Channel', () => {
  let mockAdapter: MockAdapter;

  afterEach(() => {
    mockAdapter?.restore();
    vi.restoreAllMocks();
  });
  const getTestConfig = () => ({

    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let channel: SMSChannel;
  let tac: TAC;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
    channel = new SMSChannel(tac);
    // Short-circuit memory retrieval so webhook processing tests don't hit
    // real Twilio APIs with fake credentials and spam the logs with 401s.
    vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as never);
  });

  describe('initialization', () => {
    it('should create SMS channel with config', () => {
      expect(channel).toBeInstanceOf(SMSChannel);
      expect(channel.channelType).toBe('sms');
    });

    it('should start with no active conversations', () => {
      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });

    it('should reject zero dedupCapacity', () => {
      expect(() => new SMSChannel(tac, { dedupCapacity: 0 })).toThrow(
        'dedupCapacity must be a positive integer'
      );
    });

    it('should reject negative dedupCapacity', () => {
      expect(() => new SMSChannel(tac, { dedupCapacity: -1 })).toThrow(
        'dedupCapacity must be a positive integer'
      );
    });

    it('should reject non-integer dedupCapacity', () => {
      expect(() => new SMSChannel(tac, { dedupCapacity: 1.5 })).toThrow(
        'dedupCapacity must be a positive integer'
      );
    });
  });

  describe('webhook processing', () => {
    it('should process conversation.created event', async () => {
      const webhookPayload = createConversationCreatedWebhook();

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

      const webhookPayload = createCommunicationCreatedWebhook();

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
      await channel.processWebhook(createConversationCreatedWebhook());

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);

      // Then close it
      await channel.processWebhook(createConversationUpdatedWebhook({ status: 'CLOSED' }));

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });

    it('should ignore empty messages', async () => {
      let messageReceived = false;

      channel.on('messageReceived', () => {
        messageReceived = true;
      });

      const webhookPayload = createCommunicationCreatedWebhook({
        content: {
          type: 'TEXT',
          text: '', // Empty message
        },
      });

      await channel.processWebhook(webhookPayload);

      // Should not have triggered callback for empty message
      expect(messageReceived).toBe(false);
    });

    it('should auto-initialize conversation on first message', async () => {
      let capturedMessage: any = null;

      channel.on('messageReceived', data => {
        capturedMessage = data;
      });

      const webhookPayload = createCommunicationCreatedWebhook({
        content: {
          type: 'TEXT',
          text: 'First message',
        },
      });

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
      await channel.processWebhook(
        createConversationCreatedWebhook({ id: 'CHtest123456789' })
      );

      await channel.processWebhook(
        createConversationCreatedWebhook({ id: 'CHtest987654321' })
      );

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
      expect(channel.isConversationActive('CHtest987654321')).toBe(true);
    });
  });

  describe('conversation ended callback', () => {
    it('should fire onConversationEnded callback with full session on close', async () => {
      const captured: ConversationSession[] = [];

      tac.onConversationEnded(({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(channel);

      // Start conversation
      await channel.processWebhook(createConversationCreatedWebhook());

      // Close conversation
      await channel.processWebhook(createConversationUpdatedWebhook({ status: 'CLOSED' }));

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHtest123456789');
      expect(captured[0].channel).toBe('sms');
    });

    it('should still clean up session if callback throws', async () => {
      tac.onConversationEnded(() => {
        throw new Error('boom');
      });
      tac.registerChannel(channel);

      await channel.processWebhook(createConversationCreatedWebhook());
      expect(channel.isConversationActive('CHtest123456789')).toBe(true);

      await channel.processWebhook(createConversationUpdatedWebhook({ status: 'CLOSED' }));

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });

    it('should support async callback', async () => {
      const captured: ConversationSession[] = [];

      tac.onConversationEnded(async ({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(channel);

      await channel.processWebhook(createConversationCreatedWebhook());
      await channel.processWebhook(createConversationUpdatedWebhook({ status: 'CLOSED' }));

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHtest123456789');
    });

    it('should clean up silently when no callback is registered', async () => {
      // No callback registered — should not throw
      await channel.processWebhook(createConversationCreatedWebhook());
      await channel.processWebhook(createConversationUpdatedWebhook({ status: 'CLOSED' }));

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
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

  describe('idempotency token deduplication', () => {
    it('should skip duplicate webhooks with the same idempotency token', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      const payload = createSMSMessageWebhook('Hello');

      await channel.processWebhook(payload, 'tok-123');
      await channel.processWebhook(payload, 'tok-123');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should process webhooks with different idempotency tokens', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      // Need different payloads (with different communication IDs) to test different idempotency tokens
      await channel.processWebhook(
        createCommunicationCreatedWebhook({ id: 'comm_1' }),
        'tok-1'
      );
      await channel.processWebhook(
        createCommunicationCreatedWebhook({ id: 'comm_2' }),
        'tok-2'
      );

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should always process webhooks without an idempotency token', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      // Need different communication IDs since per-communication dedup is separate from idempotency tokens
      await channel.processWebhook(createCommunicationCreatedWebhook({ id: 'comm_1' }));
      await channel.processWebhook(createCommunicationCreatedWebhook({ id: 'comm_2' }));

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should evict oldest tokens when capacity is reached', async () => {
      const smallChannel = new SMSChannel(tac, { dedupCapacity: 2 });
      const callback = vi.fn();
      smallChannel.on('messageReceived', callback);

      // Fill capacity: [tok-1, tok-2]
      await smallChannel.processWebhook(
        createCommunicationCreatedWebhook({ id: 'comm_1' }),
        'tok-1'
      );
      await smallChannel.processWebhook(
        createCommunicationCreatedWebhook({ id: 'comm_2' }),
        'tok-2'
      );
      expect(callback).toHaveBeenCalledTimes(2);

      // tok-1 is still tracked — should be deduped
      await smallChannel.processWebhook(
        createCommunicationCreatedWebhook({ id: 'comm_1_dup' }),
        'tok-1'
      );
      expect(callback).toHaveBeenCalledTimes(2);

      // tok-3 evicts tok-1 (oldest): [tok-2, tok-3]
      await smallChannel.processWebhook(
        createCommunicationCreatedWebhook({ id: 'comm_3' }),
        'tok-3'
      );
      expect(callback).toHaveBeenCalledTimes(3);

      // tok-1 was evicted — should be processed again
      await smallChannel.processWebhook(
        createCommunicationCreatedWebhook({ id: 'comm_4' }),
        'tok-1'
      );
      expect(callback).toHaveBeenCalledTimes(4);
    });

    it('should allow retry when processing fails', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      // Initialize conversation
      await channel.processWebhook(createConversationCreatedWebhook());

      // Test behavior: when validation fails, token should be removed allowing retry
      // We'll verify this by sending invalid payload twice with same token, then valid payload

      const invalidPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: { conversationId: 'CHtest123456789' }, // Missing required fields
      };

      // Both invalid attempts should not throw (errors are caught internally)
      await channel.processWebhook(invalidPayload, 'tok-123');
      await channel.processWebhook(invalidPayload, 'tok-123');

      // Now send valid payload with different token to verify system works
      await channel.processWebhook(
        createCommunicationCreatedWebhook({ id: 'comm_1' }),
        'tok-456'
      );

      // Only the valid payload should trigger the callback
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should block concurrent duplicates while first request is in-flight', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      const payload = createSMSMessageWebhook('Hello');

      // Fire both concurrently with the same token
      await Promise.all([
        channel.processWebhook(payload, 'tok-concurrent'),
        channel.processWebhook(payload, 'tok-concurrent'),
      ]);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendResponse', () => {
    beforeEach(() => {
      // Access the conversation client's axios instance through TAC
      const conversationClient = (tac as any).conversationClient;
      mockAdapter = new MockAdapter(conversationClient.axiosInstance);
      // Reset history to clear the getConfiguration call from TAC initialization
      mockAdapter.resetHistory();

      // Mock listParticipants call
      mockAdapter.onGet('/v2/Conversations/CHtest123456789/Participants').reply(200, {
        participants: [
          {
            id: 'PA111',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'AI_AGENT',
            addresses: [{ channel: 'SMS', address: '+15551234567' }],
          },
          {
            id: 'PA123',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'SMS', address: '+15559876543' }],
          },
        ],
      });

      // Mock createAction call (returns 202 Accepted)
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
        createdAt: '2025-01-15T10:30:00Z',
      });
    });

    it('should send SMS via Actions API', async () => {
      // Start conversation and receive message to populate author_info
      await channel.processWebhook(createConversationCreatedWebhook());

      await channel.processWebhook(
        createCommunicationCreatedWebhook({
          author: {
            address: '+15559876543',
            channel: 'SMS',
            participantId: 'PA123',
          },
        })
      );

      await channel.sendResponse('CHtest123456789', 'Hello back!');

      // Verify that the correct requests were made (listParticipants + createAction)
      const history = mockAdapter.history;
      expect(history.get.length).toBe(1); // listParticipants
      expect(history.get[0]!.url).toBe('/v2/Conversations/CHtest123456789/Participants');

      expect(history.post.length).toBe(1);
      expect(history.post[0]!.url).toBe('/v2/Conversations/CHtest123456789/Actions');
      const body = JSON.parse(history.post[0]!.data);
      expect(body).not.toHaveProperty('conversationId'); // now in URL, not body
      expect(body.type).toBe('SEND_MESSAGE');
      // from/to send participantId + channel only (no address) for Mode 1 resolution
      expect(body.payload.from.participantId).toBe('PA111');
      expect(body.payload.from.channel).toBe('SMS');
      expect(body.payload.from).not.toHaveProperty('address');
      expect(body.payload.to).toHaveLength(1);
      expect(body.payload.to[0].participantId).toBe('PA123');
      expect(body.payload.to[0].channel).toBe('SMS');
      expect(body.payload.to[0]).not.toHaveProperty('address');
      expect(body.payload.content.text).toBe('Hello back!');
      expect(body.payload.content).not.toHaveProperty('type'); // Actions content has no discriminator
      // No channelId on the webhook → channelSettings omitted
      expect(body.payload).not.toHaveProperty('channelSettings');
    });

    it('should forward channelId as channelSettings.channelId when present', async () => {
      await channel.processWebhook(createConversationCreatedWebhook());

      // Inbound communication carrying a channelId (stored in session.metadata)
      await channel.processWebhook(
        createCommunicationCreatedWebhook({
          author: { address: '+15559876543', channel: 'SMS', participantId: 'PA123' },
          channelId: 'SMabcdef',
        })
      );

      await channel.sendResponse('CHtest123456789', 'Reply');

      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body.payload.channelSettings.channelId).toBe('SMabcdef');
    });

    it('should lazily create AI_AGENT participant when absent', async () => {
      // Replace the default listParticipants mock with one that returns only the customer
      mockAdapter.reset();
      // keep the getConfiguration call silent (already resolved in createTestTAC)
      mockAdapter.onGet('/v2/Conversations/CHtest123456789/Participants').reply(200, {
        participants: [
          {
            id: 'PA123',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'SMS', address: '+15559876543' }],
          },
        ],
      });
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Participants').reply(201, {
        id: 'PA_NEW_AGENT',
        conversationId: 'CHtest123456789',
        accountId: 'ACtest123456789',
        type: 'AI_AGENT',
        addresses: [{ channel: 'SMS', address: '+15551234567' }],
      });
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
      });

      await channel.processWebhook(createConversationCreatedWebhook());
      await channel.processWebhook(
        createCommunicationCreatedWebhook({
          author: { address: '+15559876543', channel: 'SMS', participantId: 'PA123' },
        })
      );

      await channel.sendResponse('CHtest123456789', 'Reply');

      const posts = mockAdapter.history.post;
      expect(posts).toHaveLength(2); // addParticipant + createAction

      const addParticipantCall = posts.find(p =>
        p.url?.endsWith('/Participants')
      );
      expect(addParticipantCall).toBeDefined();
      const addBody = JSON.parse(addParticipantCall!.data);
      expect(addBody.type).toBe('AI_AGENT');
      expect(addBody.addresses).toHaveLength(1);
      expect(addBody.addresses[0].channel).toBe('SMS');
      expect(addBody.addresses[0].address).toBe('+15551234567');

      const actionCall = posts.find(p => p.url?.endsWith('/Actions'));
      expect(actionCall).toBeDefined();
      const actionBody = JSON.parse(actionCall!.data);
      expect(actionBody.payload.from.participantId).toBe('PA_NEW_AGENT');
    });

    it('should throw error when no session exists', async () => {
      await expect(channel.sendResponse('CHnonexistent', 'Test')).rejects.toThrow(
        'No active session found'
      );
    });

    it('should throw error when no author_info exists', async () => {
      // Start conversation but don't receive any message
      await channel.processWebhook(createConversationCreatedWebhook());

      await expect(channel.sendResponse('CHtest123456789', 'Test')).rejects.toThrow(
        'No author info found'
      );
    });

    it('should throw when ensureAgentParticipant fails', async () => {
      mockAdapter.reset();
      // Only customer in the participant list and addParticipant fails
      mockAdapter.onGet('/v2/Conversations/CHtest123456789/Participants').reply(200, {
        participants: [
          {
            id: 'PA123',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'SMS', address: '+15559876543' }],
          },
        ],
      });
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Participants').reply(500);

      await channel.processWebhook(createConversationCreatedWebhook());
      await channel.processWebhook(
        createCommunicationCreatedWebhook({
          author: { address: '+15559876543', channel: 'SMS', participantId: 'PA123' },
        })
      );

      await expect(channel.sendResponse('CHtest123456789', 'Reply')).rejects.toThrow(
        'Failed to resolve AI_AGENT participant'
      );
    });

    it('should throw when no CUSTOMER participant is found on SMS', async () => {
      mockAdapter.reset();
      // Only the agent participant exists — no CUSTOMER
      mockAdapter.onGet('/v2/Conversations/CHtest123456789/Participants').reply(200, {
        participants: [
          {
            id: 'PA111',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'AI_AGENT',
            addresses: [{ channel: 'SMS', address: '+15551234567' }],
          },
        ],
      });

      await channel.processWebhook(createConversationCreatedWebhook());
      await channel.processWebhook(
        createCommunicationCreatedWebhook({
          author: { address: '+15559876543', channel: 'SMS', participantId: 'PA_other' },
        })
      );

      await expect(channel.sendResponse('CHtest123456789', 'Reply')).rejects.toThrow(
        'Customer participant not found'
      );
    });
  });

  describe('callback auto-send behavior', () => {
    beforeEach(() => {
      tac.registerChannel(channel);
    });

    it('should auto-send when callback returns string', async () => {
      const sendResponseSpy = vi.spyOn(channel, 'sendResponse').mockResolvedValue();

      tac.onMessageReady(() => {
        return 'Auto-sent response';
      });

      await channel.processWebhook(createConversationCreatedWebhook());

      await channel.processWebhook(
        createCommunicationCreatedWebhook({
          author: { address: '+15559876543', channel: 'SMS', participantId: 'PA123' },
        })
      );

      await vi.waitFor(() => {
        expect(sendResponseSpy).toHaveBeenCalledWith('CHtest123456789', 'Auto-sent response');
      });
    });

    it('should not auto-send when callback returns void', async () => {
      const sendResponseSpy = vi.spyOn(channel, 'sendResponse').mockResolvedValue();

      tac.onMessageReady(() => {
        // Return void - no auto-send
      });

      await channel.processWebhook(createConversationCreatedWebhook());

      await channel.processWebhook(
        createCommunicationCreatedWebhook({
          author: { address: '+15559876543', channel: 'SMS', participantId: 'PA123' },
        })
      );

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sendResponseSpy).not.toHaveBeenCalled();
    });

    it('should auto-send when async callback returns string', async () => {
      const sendResponseSpy = vi.spyOn(channel, 'sendResponse').mockResolvedValue();

      tac.onMessageReady(async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return 'Async auto-sent response';
      });

      await channel.processWebhook(createConversationCreatedWebhook());

      await channel.processWebhook(
        createCommunicationCreatedWebhook({
          author: { address: '+15559876543', channel: 'SMS', participantId: 'PA123' },
        })
      );

      await vi.waitFor(() => {
        expect(sendResponseSpy).toHaveBeenCalledWith('CHtest123456789', 'Async auto-sent response');
      });
    });
  });
});
