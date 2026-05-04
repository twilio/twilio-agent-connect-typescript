import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SMSChannel, TAC, ConversationSession } from '@twilio/tac-core';
import MockAdapter from 'axios-mock-adapter';
import { createTestTAC } from './helpers/tac';

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
    // Short-circuit reconcileParticipants so webhook processing tests don't
    // need to mock listParticipants. Tests that care about reconcile behavior
    // should override this spy. Spy on the prototype so the stub applies to
    // any SMSChannel instance created in a test (e.g. memoryMode tests that
    // construct their own channel).
    vi.spyOn(SMSChannel.prototype as any, 'reconcileParticipants').mockResolvedValue([
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
    ]);
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

    it('should default memoryMode to "never"', () => {
      const defaultChannel = new SMSChannel(tac);
      expect((defaultChannel as any).memoryMode).toBe('never');
    });

    it('should accept memoryMode "always"', () => {
      const alwaysChannel = new SMSChannel(tac, { memoryMode: 'always' });
      expect((alwaysChannel as any).memoryMode).toBe('always');
    });

    it('should accept memoryMode "never"', () => {
      const neverChannel = new SMSChannel(tac, { memoryMode: 'never' });
      expect((neverChannel as any).memoryMode).toBe('never');
    });

    it('should reject invalid memoryMode', () => {
      expect(() => new SMSChannel(tac, { memoryMode: 'invalid' as any })).toThrow(
        'Invalid memoryMode: "invalid". Must be "always" or "never".'
      );
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
            address: '+15559876543', // Different from config.phoneNumber
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
            channel: 'SMS',
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
            channel: 'SMS',
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

  describe('conversation ended callback', () => {
    it('should fire onConversationEnded callback with full session on close', async () => {
      const captured: ConversationSession[] = [];

      tac.onConversationEnded(({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(channel);

      // Start conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789', profileId: 'test_profile_123' },
      });

      // Close conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { conversationId: 'CHtest123456789', status: 'CLOSED' },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHtest123456789');
      expect(captured[0].channel).toBe('sms');
    });

    it('should still clean up session if callback throws', async () => {
      tac.onConversationEnded(() => {
        throw new Error('boom');
      });
      tac.registerChannel(channel);

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });
      expect(channel.isConversationActive('CHtest123456789')).toBe(true);

      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { conversationId: 'CHtest123456789', status: 'CLOSED' },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });

    it('should support async callback', async () => {
      const captured: ConversationSession[] = [];

      tac.onConversationEnded(async ({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(channel);

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });
      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { conversationId: 'CHtest123456789', status: 'CLOSED' },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHtest123456789');
    });

    it('should clean up silently when no callback is registered', async () => {
      // No callback registered — should not throw
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });
      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { conversationId: 'CHtest123456789', status: 'CLOSED' },
      });

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

      const payload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Hello' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      };

      await channel.processWebhook(payload, 'tok-123');
      await channel.processWebhook(payload, 'tok-123');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should process webhooks with different idempotency tokens', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      const payload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Hello' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      };

      await channel.processWebhook(payload, 'tok-1');
      await channel.processWebhook(payload, 'tok-2');

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should always process webhooks without an idempotency token', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      const payload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Hello' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      };

      await channel.processWebhook(payload);
      await channel.processWebhook(payload);

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should evict oldest tokens when capacity is reached', async () => {
      const smallChannel = new SMSChannel(tac, { dedupCapacity: 2 });
      // Short-circuit reconcile on the extra channel so the callback fires.
      vi.spyOn(smallChannel as any, 'reconcileParticipants').mockResolvedValue([
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
      ]);
      const callback = vi.fn();
      smallChannel.on('messageReceived', callback);

      const makePayload = (text: string) => ({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      // Fill capacity: [tok-1, tok-2]
      await smallChannel.processWebhook(makePayload('msg1'), 'tok-1');
      await smallChannel.processWebhook(makePayload('msg2'), 'tok-2');
      expect(callback).toHaveBeenCalledTimes(2);

      // tok-1 is still tracked — should be deduped
      await smallChannel.processWebhook(makePayload('msg1-dup'), 'tok-1');
      expect(callback).toHaveBeenCalledTimes(2);

      // tok-3 evicts tok-1 (oldest): [tok-2, tok-3]
      await smallChannel.processWebhook(makePayload('msg3'), 'tok-3');
      expect(callback).toHaveBeenCalledTimes(3);

      // tok-1 was evicted — should be processed again
      await smallChannel.processWebhook(makePayload('msg1-again'), 'tok-1');
      expect(callback).toHaveBeenCalledTimes(4);
    });

    it('should allow retry when processing fails', async () => {
      let callCount = 0;
      channel.on('messageReceived', () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('transient failure');
        }
      });

      const payload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Hello' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      };

      // First attempt — callback throws
      await channel.processWebhook(payload, 'tok-retry');

      // Retry with same token — should NOT be deduped since first attempt failed
      await channel.processWebhook(payload, 'tok-retry');

      expect(callCount).toBe(2);
    });

    it('should block concurrent duplicates while first request is in-flight', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      const payload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Hello' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      };

      // Fire both concurrently with the same token
      await Promise.all([
        channel.processWebhook(payload, 'tok-concurrent'),
        channel.processWebhook(payload, 'tok-concurrent'),
      ]);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendResponse', () => {
    /**
     * Pre-populate a fully-reconciled session. `sendResponse` now reads ids
     * directly from `session.authorInfo` and `session.aiAgentInfo`; it no
     * longer calls `listParticipants`/`addParticipant` at send time.
     */
    const seedReconciledSession = (conversationId: string, opts?: {
      channelId?: string;
      agentParticipantId?: string;
      customerParticipantId?: string;
    }) => {
      (channel as any).activeConversations.set(conversationId, {
        conversationId,
        channel: 'sms',
        startedAt: new Date(),
        authorInfo: {
          address: '+15559876543',
          participantId: opts?.customerParticipantId ?? 'PA123',
        },
        aiAgentInfo: {
          address: '+15551234567',
          participantId: opts?.agentParticipantId ?? 'PA111',
        },
        metadata: opts?.channelId ? { channelId: opts.channelId } : {},
      });
    };

    beforeEach(() => {
      // Access the conversation client's axios instance through TAC
      const conversationClient = (tac as any).conversationClient;
      mockAdapter = new MockAdapter(conversationClient.axiosInstance);
      // Reset history to clear the getConfiguration call from TAC initialization
      mockAdapter.resetHistory();

      // Mock createAction call (returns 202 Accepted). sendResponse no longer
      // calls listParticipants — the session is pre-reconciled.
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
        createdAt: '2025-01-15T10:30:00Z',
      });
    });

    it('should send SMS via Actions API', async () => {
      seedReconciledSession('CHtest123456789');

      await channel.sendResponse('CHtest123456789', 'Hello back!');

      // sendResponse no longer calls listParticipants — only createAction
      const history = mockAdapter.history;
      expect(history.get.length).toBe(0);

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
      // No channelId in session → channelSettings omitted
      expect(body.payload).not.toHaveProperty('channelSettings');
    });

    it('should forward channelId as channelSettings.channelId when present', async () => {
      seedReconciledSession('CHtest123456789', { channelId: 'SMabcdef' });

      await channel.sendResponse('CHtest123456789', 'Reply');

      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body.payload.channelSettings.channelId).toBe('SMabcdef');
    });

    it('should throw when no session exists', async () => {
      await expect(channel.sendResponse('CHnonexistent', 'Test')).rejects.toThrow(
        'without a reconciled session'
      );
    });

    it('should throw when session is missing authorInfo', async () => {
      // Start conversation but don't populate authorInfo or aiAgentInfo
      (channel as any).activeConversations.set('CHtest123456789', {
        conversationId: 'CHtest123456789',
        channel: 'sms',
        startedAt: new Date(),
        metadata: {},
      });

      await expect(channel.sendResponse('CHtest123456789', 'Test')).rejects.toThrow(
        'without a reconciled session'
      );
    });

    it('should throw when session is missing aiAgentInfo', async () => {
      (channel as any).activeConversations.set('CHtest123456789', {
        conversationId: 'CHtest123456789',
        channel: 'sms',
        startedAt: new Date(),
        authorInfo: { address: '+15559876543', participantId: 'PA123' },
        metadata: {},
      });

      await expect(channel.sendResponse('CHtest123456789', 'Reply')).rejects.toThrow(
        'without a reconciled session'
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

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Test message' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      await vi.waitFor(() => {
        expect(sendResponseSpy).toHaveBeenCalledWith('CHtest123456789', 'Auto-sent response');
      });
    });

    it('should not auto-send when callback returns void', async () => {
      const sendResponseSpy = vi.spyOn(channel, 'sendResponse').mockResolvedValue();

      tac.onMessageReady(() => {
        // Return void - no auto-send
      });

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Test message' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sendResponseSpy).not.toHaveBeenCalled();
    });

    it('should auto-send when async callback returns string', async () => {
      const sendResponseSpy = vi.spyOn(channel, 'sendResponse').mockResolvedValue();

      tac.onMessageReady(async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return 'Async auto-sent response';
      });

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Test message' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      await vi.waitFor(() => {
        expect(sendResponseSpy).toHaveBeenCalledWith('CHtest123456789', 'Async auto-sent response');
      });
    });
  });

  describe('memory retrieval', () => {
    it('should NOT retrieve memory when memoryMode is "never" (default)', async () => {
      const channelNever = new SMSChannel(tac);
      const retrieveMemorySpy = vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as never);

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: 'Hello',
          },
          author: {
            address: '+15559876543',
            channel: 'SMS',
          },
        },
      };

      await channelNever.processWebhook(webhookPayload);

      // Memory should NOT be retrieved
      expect(retrieveMemorySpy).not.toHaveBeenCalled();
    });

    it('should retrieve memory when memoryMode is "always"', async () => {
      const channelAlways = new SMSChannel(tac, { memoryMode: 'always' });
      const mockMemory = {
        observations: [{ id: 'obs1', content: 'Test observation' }],
        summaries: [],
        communications: [],
      };
      const retrieveMemorySpy = vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(mockMemory as any);

      // Mock reconcileParticipants for the new channel instance
      vi.spyOn(channelAlways as any, 'reconcileParticipants').mockResolvedValue([
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
      ]);

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: 'Hello',
          },
          author: {
            address: '+15559876543',
            channel: 'SMS',
          },
        },
      };

      await channelAlways.processWebhook(webhookPayload);

      // Memory should be retrieved
      expect(retrieveMemorySpy).toHaveBeenCalled();
    });

    it('should handle memory retrieval errors gracefully when memoryMode is "always"', async () => {
      const channelAlways = new SMSChannel(tac, { memoryMode: 'always' });
      const retrieveMemorySpy = vi
        .spyOn(tac, 'retrieveMemory')
        .mockRejectedValue(new Error('Memory API error'));

      // Mock reconcileParticipants for the new channel instance
      vi.spyOn(channelAlways as any, 'reconcileParticipants').mockResolvedValue([
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
      ]);

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: 'Hello',
          },
          author: {
            address: '+15559876543',
            channel: 'SMS',
          },
        },
      };

      // Should not throw - error is handled gracefully
      await expect(channelAlways.processWebhook(webhookPayload)).resolves.not.toThrow();

      expect(retrieveMemorySpy).toHaveBeenCalled();
    });
  });
});
