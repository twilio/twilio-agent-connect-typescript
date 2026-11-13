import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SMSChannel,
  TAC,
  ConversationClient,
  ConversationParticipant,
  ConversationSession,
} from '@twilio/tac-core';
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

  const CONFIG_ID = 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd';

  /** The agent + customer pair Conversation Orchestrator holds for a healthy conversation. */
  const smsParticipants = (
    conversationId = 'CHtest123456789',
    profileId?: string
  ): ConversationParticipant[] => [
    {
      id: 'PA111',
      conversationId,
      accountId: 'ACtest123456789',
      type: 'AI_AGENT',
      addresses: [{ channel: 'SMS', address: '+15551234567' }],
    },
    {
      id: 'PA222',
      conversationId,
      accountId: 'ACtest123456789',
      type: 'CUSTOMER',
      ...(profileId ? { profileId } : {}),
      addresses: [{ channel: 'SMS', address: '+15559876543' }],
    },
  ];

  /** A session shaped the way an inbound webhook leaves it. */
  const reconciledSession = (
    conversationId = 'CHtest123456789',
    overrides: Partial<ConversationSession> = {}
  ): ConversationSession => ({
    conversationId,
    channel: 'sms',
    startedAt: new Date(),
    authorInfo: { address: '+15559876543', participantId: 'PA123' },
    aiAgentInfo: { address: '+15551234567', participantId: 'PA111' },
    metadata: {},
    ...overrides,
  });

  const closedWebhook = (conversationId: string, configurationId: string = CONFIG_ID) => ({
    eventType: 'CONVERSATION_UPDATED',
    data: {
      id: conversationId,
      conversationId,
      configurationId,
      status: 'CLOSED',
      createdAt: '2025-11-18T00:00:00.000Z',
      updatedAt: '2025-11-18T00:10:00.000Z',
    },
  });

  let channel: SMSChannel;
  let tac: TAC;
  let listParticipantsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
    channel = new SMSChannel(tac);
    // Every inbound message reads the conversation's participants once.
    listParticipantsSpy = vi
      .spyOn(ConversationClient.prototype, 'listParticipants')
      .mockImplementation(async (conversationId: string) => smsParticipants(conversationId));
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

    it('keeps no sessions: deprecated lookups return undefined/false even after a message', async () => {
      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Hello' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
      expect(channel.getConversationSession('CHtest123456789')).toBeUndefined();
    });

    it("on('conversationStarted') is a deprecated no-op", async () => {
      const started = vi.fn();
      expect(() => channel.on('conversationStarted', started)).not.toThrow();

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });
      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Hello' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      expect(started).not.toHaveBeenCalled();
    });

    it('should require phoneNumber on TAC config', async () => {
      const { phoneNumber: _omitted, ...configWithoutPhone } = getTestConfig();
      const tacWithoutPhone = await createTestTAC(configWithoutPhone);
      expect(() => new SMSChannel(tacWithoutPhone)).toThrow(/phoneNumber\(s\) is required/);
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
        'Invalid memoryMode: "invalid". Must be "always", "once", or "never".'
      );
    });
  });

  describe('webhook processing', () => {
    it('should ignore conversation.created event (no session to start)', async () => {
      const webhookPayload = {
        eventType: 'CONVERSATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          profileId: 'test_profile_123',
        },
      };

      await expect(channel.processWebhook(webhookPayload)).resolves.not.toThrow();

      expect(listParticipantsSpy).not.toHaveBeenCalled();
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
      // This turn's session travels with the event
      expect(capturedMessage.session.conversationId).toBe('CHtest123456789');
      expect(capturedMessage.session.authorInfo).toMatchObject({
        address: '+15559876543',
        participantId: 'PA222',
      });
      expect(capturedMessage.session.aiAgentInfo).toMatchObject({
        address: '+15551234567',
        participantId: 'PA111',
      });
      expect(listParticipantsSpy).toHaveBeenCalledTimes(1);
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
      const ended = vi.fn();
      channel.on('conversationEnded', ended);

      await channel.processWebhook(closedWebhook('CHtest123456789'));

      expect(ended).toHaveBeenCalledTimes(1);
      expect(ended.mock.calls[0]![0].session.conversationId).toBe('CHtest123456789');
    });

    it('should ignore CLOSED for a different conversation configuration', async () => {
      const ended = vi.fn();
      channel.on('conversationEnded', ended);

      await channel.processWebhook(closedWebhook('CHtest123456789', 'conv_configuration_other'));

      expect(ended).not.toHaveBeenCalled();
      expect(listParticipantsSpy).not.toHaveBeenCalled();
    });

    it('should ignore non-CLOSED conversation.updated events', async () => {
      const ended = vi.fn();
      channel.on('conversationEnded', ended);

      const webhook = closedWebhook('CHtest123456789');
      await channel.processWebhook({ ...webhook, data: { ...webhook.data, status: 'INACTIVE' } });

      expect(ended).not.toHaveBeenCalled();
      expect(listParticipantsSpy).not.toHaveBeenCalled();
    });

    it('should not fire for a conversation with no participant on this channel', async () => {
      const ended = vi.fn();
      channel.on('conversationEnded', ended);
      listParticipantsSpy.mockResolvedValue([
        {
          id: 'PA_chat',
          conversationId: 'CHchat',
          accountId: 'ACtest123456789',
          type: 'CUSTOMER',
          addresses: [{ channel: 'CHAT', address: 'user-1' }],
        },
      ]);

      await channel.processWebhook(closedWebhook('CHchat'));

      expect(ended).not.toHaveBeenCalled();
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

    it('should build a fresh session per message, listing participants each time', async () => {
      const captured: any[] = [];

      channel.on('messageReceived', data => {
        captured.push(data);
      });

      const webhookPayload = (text: string) => ({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      await channel.processWebhook(webhookPayload('First message'));
      await channel.processWebhook(webhookPayload('Second message'));

      expect(captured).toHaveLength(2);
      expect(captured[0].message).toBe('First message');
      expect(captured[1].message).toBe('Second message');
      // Nothing carries over between turns
      expect(captured[0].session).not.toBe(captured[1].session);
      expect(listParticipantsSpy).toHaveBeenCalledTimes(2);
    });

    it('should drop the message and surface onError when participants cannot be read', async () => {
      const received = vi.fn();
      const errors: { error: Error; context?: Record<string, unknown> }[] = [];
      channel.on('messageReceived', received);
      channel.on('error', data => errors.push(data));
      listParticipantsSpy.mockRejectedValue(new Error('CO down'));

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'Hello' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      expect(received).not.toHaveBeenCalled();
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.name).toBe('ParticipantLookupError');
      expect(errors[0]!.context?.dropped_inbound).toBe(true);
      expect(errors[0]!.context?.error_code).toBe('participant_lookup_failed');
    });

    it("should ignore TAC's own message identified by the author participant type", async () => {
      const received = vi.fn();
      channel.on('messageReceived', received);
      listParticipantsSpy.mockResolvedValue([
        ...smsParticipants(),
        {
          id: 'PA_other_agent',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          type: 'AI_AGENT',
          addresses: [{ channel: 'SMS', address: '+15550000000' }],
        },
      ]);

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'echo' },
          author: { address: '+15550000000', channel: 'SMS', participantId: 'PA_other_agent' },
        },
      });

      expect(received).not.toHaveBeenCalled();
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
    it('closing one conversation does not affect another (nothing is stored)', async () => {
      const ended: string[] = [];
      tac.onConversationEnded(({ session }) => {
        ended.push(session.conversationId);
      });
      tac.registerChannel(channel);

      await channel.processWebhook(closedWebhook('CHtest111'));

      expect(ended).toEqual(['CHtest111']);
    });
  });

  describe('conversation ended callback', () => {
    it('should fire onConversationEnded callback with a session rebuilt from participants', async () => {
      const captured: ConversationSession[] = [];
      listParticipantsSpy.mockResolvedValue(smsParticipants('CHtest123456789', 'prof_cb1'));

      tac.onConversationEnded(({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(channel);

      await channel.processWebhook(closedWebhook('CHtest123456789'));

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHtest123456789');
      expect(captured[0].channel).toBe('sms');
      expect(captured[0].profileId).toBe('prof_cb1');
      expect(captured[0].authorInfo).toMatchObject({
        address: '+15559876543',
        participantId: 'PA222',
      });
      expect(captured[0].aiAgentInfo).toMatchObject({
        address: '+15551234567',
        participantId: 'PA111',
      });
    });

    it('should not fail the webhook if the callback throws', async () => {
      tac.onConversationEnded(() => {
        throw new Error('boom');
      });
      tac.registerChannel(channel);

      await expect(channel.processWebhook(closedWebhook('CHtest123456789'))).resolves.not.toThrow();
    });

    it('should support async callback', async () => {
      const captured: ConversationSession[] = [];

      tac.onConversationEnded(async ({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(channel);

      await channel.processWebhook(closedWebhook('CHtest123456789'));

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHtest123456789');
    });

    it('should exit fast with no API call when no callback is registered', async () => {
      tac.registerChannel(channel);

      await expect(channel.processWebhook(closedWebhook('CHtest123456789'))).resolves.not.toThrow();

      expect(listParticipantsSpy).not.toHaveBeenCalled();
    });

    it('should not fire when the participant lookup fails', async () => {
      const ended = vi.fn();
      channel.on('conversationEnded', ended);
      listParticipantsSpy.mockRejectedValue(new Error('CO down'));

      await expect(channel.processWebhook(closedWebhook('CHtest123456789'))).resolves.not.toThrow();

      expect(ended).not.toHaveBeenCalled();
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
    beforeEach(() => {
      // Access the conversation client's axios instance through TAC
      const conversationClient = (tac as any).conversationClient;
      mockAdapter = new MockAdapter(conversationClient.axiosInstance);
      // Reset history to clear the getConfiguration call from TAC initialization
      mockAdapter.resetHistory();

      // Mock createAction call (returns 202 Accepted).
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
        createdAt: '2025-01-15T10:30:00Z',
      });
    });

    it('should send SMS via Actions API with a session (no participant lookup)', async () => {
      await channel.sendResponse(reconciledSession(), 'Hello back!');

      // A session already carries both participants — only createAction
      expect(listParticipantsSpy).not.toHaveBeenCalled();
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
      await channel.sendResponse(
        reconciledSession('CHtest123456789', { metadata: { channelId: 'SMabcdef' } }),
        'Reply'
      );

      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body.payload.channelSettings.channelId).toBe('SMabcdef');
    });

    it('should rebuild the session from participants when given a bare id', async () => {
      await channel.sendResponse('CHtest123456789', 'Reply');

      expect(listParticipantsSpy).toHaveBeenCalledTimes(1);
      expect(listParticipantsSpy).toHaveBeenCalledWith('CHtest123456789');
      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body.payload.from).toEqual({ channel: 'SMS', participantId: 'PA111' });
      expect(body.payload.to).toEqual([{ channel: 'SMS', participantId: 'PA222' }]);
    });

    it('should fall back to addresses when the session has no participant ids', async () => {
      await channel.sendResponse(
        reconciledSession('CHtest123456789', {
          authorInfo: { address: '+15559876543' },
          aiAgentInfo: { address: '+15551234567' },
        }),
        'Reply'
      );

      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body.payload.from).toEqual({ channel: 'SMS', address: '+15551234567' });
      expect(body.payload.to).toEqual([{ channel: 'SMS', address: '+15559876543' }]);
    });

    it('should throw when the bare id has no participants on SMS', async () => {
      listParticipantsSpy.mockResolvedValue([]);

      await expect(channel.sendResponse('CHnonexistent', 'Test')).rejects.toThrow(
        'no recipient resolved'
      );
    });

    it('should throw when participants cannot be read for a bare id', async () => {
      listParticipantsSpy.mockRejectedValue(new Error('CO down'));

      await expect(channel.sendResponse('CHtest123456789', 'Test')).rejects.toThrow(
        'could not read participants'
      );
    });

    it('should throw when session is missing authorInfo', async () => {
      const session = reconciledSession();
      delete session.authorInfo;

      await expect(channel.sendResponse(session, 'Test')).rejects.toThrow('no recipient resolved');
      expect(mockAdapter.history.post.length).toBe(0);
    });

    it('should send from the channel default when session is missing aiAgentInfo', async () => {
      const session = reconciledSession();
      delete session.aiAgentInfo;

      await channel.sendResponse(session, 'Reply');

      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body.payload.from).toEqual({ channel: 'SMS', address: '+15551234567' });
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
        expect(sendResponseSpy).toHaveBeenCalledWith(
          expect.objectContaining({ conversationId: 'CHtest123456789' }),
          'Auto-sent response'
        );
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
        expect(sendResponseSpy).toHaveBeenCalledWith(
          expect.objectContaining({ conversationId: 'CHtest123456789' }),
          'Async auto-sent response'
        );
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

  describe('multi-sender support', () => {
    const AGENT_A = '+15551234567';
    const AGENT_B = '+14440000000';
    const CUSTOMER = '+12345678901';

    const multiConfig = () => ({ ...getTestConfig(), phoneNumbers: [AGENT_A, AGENT_B] });

    const agentParticipant = (address = AGENT_A, id = 'PA_agent') => ({
      id,
      conversationId: 'conv_x',
      accountId: 'ACtest123456789',
      type: 'AI_AGENT' as const,
      addresses: [{ channel: 'SMS' as const, address }],
    });
    const customerParticipant = () => ({
      id: 'PA_cust',
      conversationId: 'conv_x',
      accountId: 'ACtest123456789',
      type: 'CUSTOMER' as const,
      addresses: [{ channel: 'SMS' as const, address: CUSTOMER }],
    });

    const inboundWebhook = (conversationId: string, recipientAddress: string | undefined) => ({
      eventType: 'COMMUNICATION_CREATED',
      data: {
        id: `comms_${conversationId}`,
        conversationId,
        content: { type: 'TEXT', text: 'hello' },
        author: { address: CUSTOMER, channel: 'SMS' },
        ...(recipientAddress !== undefined
          ? { recipients: [{ channel: 'SMS', address: recipientAddress, participantId: 'PA_agent' }] }
          : { recipients: [] }),
      },
    });

    it('resolveOutboundFrom validates membership', () => {
      const c = channel as any;
      expect(
        c.resolveOutboundFrom(AGENT_A, { allowlist: tac.config.phoneNumbers, default: tac.config.phoneNumber })
      ).toBe(AGENT_A);
      // omitted → default
      expect(
        c.resolveOutboundFrom(undefined, {
          allowlist: tac.config.phoneNumbers,
          default: tac.config.phoneNumber,
        })
      ).toBe(AGENT_A);
      // explicit, not in set → throws
      expect(() =>
        c.resolveOutboundFrom('+19998887777', {
          allowlist: tac.config.phoneNumbers,
          default: tac.config.phoneNumber,
        })
      ).toThrow(/is not a configured sms sender/);
    });

    it('isDefaultAgentAddress matches any configured number', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new SMSChannel(multiTac);
      expect((multiChannel as any).isDefaultAgentAddress(AGENT_A)).toBe(true);
      expect((multiChannel as any).isDefaultAgentAddress(AGENT_B)).toBe(true);
      expect((multiChannel as any).isDefaultAgentAddress('+19999999999')).toBe(false);
    });

    it('outbound from selects a configured number', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new SMSChannel(multiTac);
      const initSpy = vi
        .spyOn(multiChannel as any, 'initiateOutboundMessagingConversation')
        .mockResolvedValue({ conversationId: 'CH1', session: {} });

      await multiChannel.initiateOutboundConversation({
        to: '+19998887777',
        message: 'hi',
        from: AGENT_B,
      });

      expect(initSpy.mock.calls[0]![0].from).toBe(AGENT_B);
    });

    it('outbound from defaults to phoneNumber', async () => {
      const initSpy = vi
        .spyOn(channel as any, 'initiateOutboundMessagingConversation')
        .mockResolvedValue({ conversationId: 'CH1', session: {} });

      await channel.initiateOutboundConversation({ to: '+19998887777', message: 'hi' });

      expect(initSpy.mock.calls[0]![0].from).toBe(AGENT_A);
    });

    it('inbound agent address is derived from the webhook recipient', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new SMSChannel(multiTac);
      listParticipantsSpy.mockResolvedValue([agentParticipant(), customerParticipant()]);
      const reconcileSpy = vi
        .spyOn(multiChannel as any, 'reconcileParticipants')
        .mockResolvedValue([agentParticipant(), customerParticipant()]);

      await multiChannel.processWebhook(inboundWebhook('conv1', AGENT_A));

      expect(reconcileSpy).toHaveBeenCalled();
      const sessionArg = reconcileSpy.mock.calls[0]![0] as ConversationSession;
      expect(sessionArg.aiAgentInfo?.address).toBe(AGENT_A);
      // The participant list fetched once is handed to reconcile
      expect(reconcileSpy.mock.calls[0]![1]).toEqual([agentParticipant(), customerParticipant()]);
    });

    it('drops an inbound message addressed to an unconfigured number', async () => {
      const reconcileSpy = vi.spyOn(channel as any, 'reconcileParticipants');
      const errors: { error: Error; context?: Record<string, unknown> }[] = [];
      channel.on('error', data => errors.push(data));

      await channel.processWebhook(inboundWebhook('conv2', '+19998887777'));

      expect(reconcileSpy).not.toHaveBeenCalled();
      expect(errors).toHaveLength(1);
      expect(errors[0]!.context?.dropped_inbound).toBe(true);
      expect(errors[0]!.context?.channel).toBe('SMS');
      expect(listParticipantsSpy).not.toHaveBeenCalled();
    });

    it('inbound to the second number sets aiAgentInfo to that number end-to-end', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new SMSChannel(multiTac);
      listParticipantsSpy.mockResolvedValue([
        agentParticipant(AGENT_B, 'PA_agent2'),
        customerParticipant(),
      ]);
      vi.spyOn(multiChannel as any, 'reconcileParticipants').mockResolvedValue([
        agentParticipant(AGENT_B, 'PA_agent2'),
        customerParticipant(),
      ]);
      const seen: ConversationSession[] = [];
      multiChannel.on('messageReceived', data => seen.push(data.session));

      await multiChannel.processWebhook(inboundWebhook('conv_second', AGENT_B));

      const session = seen[0];
      expect(session?.aiAgentInfo?.address).toBe(AGENT_B);
      expect(session?.aiAgentInfo?.participantId).toBe('PA_agent2');
    });

    it('keeps the webhook-matched recipient when the agent participant lists several same-channel addresses', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new SMSChannel(multiTac);
      // Agent participant carries BOTH numbers, the default (AGENT_A) listed first.
      const participants = [
        {
          id: 'PA_agent_multi',
          conversationId: 'conv_x',
          accountId: 'ACtest123456789',
          type: 'AI_AGENT' as const,
          addresses: [
            { channel: 'SMS' as const, address: AGENT_A },
            { channel: 'SMS' as const, address: AGENT_B },
          ],
        },
        customerParticipant(),
      ];
      listParticipantsSpy.mockResolvedValue(participants);
      vi.spyOn(multiChannel as any, 'reconcileParticipants').mockResolvedValue(participants);
      const seen: ConversationSession[] = [];
      multiChannel.on('messageReceived', data => seen.push(data.session));

      await multiChannel.processWebhook(inboundWebhook('conv_multi_addr', AGENT_B));

      const session = seen[0];
      // The number the customer contacted, not the participant's first-listed address.
      expect(session?.aiAgentInfo?.address).toBe(AGENT_B);
      expect(session?.aiAgentInfo?.participantId).toBe('PA_agent_multi');
    });

    it('falls back to the configured number the participants hold when the webhook has no channel recipient', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new SMSChannel(multiTac);
      listParticipantsSpy.mockResolvedValue([agentParticipant(AGENT_B), customerParticipant()]);
      const reconcileSpy = vi
        .spyOn(multiChannel as any, 'reconcileParticipants')
        .mockResolvedValue([agentParticipant(AGENT_B), customerParticipant()]);

      await multiChannel.processWebhook(inboundWebhook('conv3', undefined));

      expect(reconcileSpy).toHaveBeenCalled();
      const sessionArg = reconcileSpy.mock.calls[0]![0] as ConversationSession;
      expect(sessionArg.aiAgentInfo?.address).toBe(AGENT_B);
    });
  });
});
