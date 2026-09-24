import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RCSChannel, TAC, ConversationSession } from '@twilio/tac-core';
import MockAdapter from 'axios-mock-adapter';
import { createTestTAC } from './helpers/tac';

describe('RCS Channel', () => {
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
    rcsSenderId: 'rcs:twilio_signal_test_agent',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let channel: RCSChannel;
  let tac: TAC;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
    channel = new RCSChannel(tac);
    // Short-circuit memory retrieval so webhook processing tests don't hit
    // real Twilio APIs with fake credentials and spam the logs with 401s.
    vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as never);
    // Short-circuit reconcileParticipants so webhook processing tests don't
    // need to mock listParticipants. Tests that care about reconcile behavior
    // should override this spy.
    vi.spyOn(channel as any, 'reconcileParticipants').mockResolvedValue([
      {
        id: 'PA_AGENT',
        conversationId: 'CHtest123456789',
        accountId: 'ACtest123456789',
        type: 'AI_AGENT',
        addresses: [{ channel: 'RCS', address: 'rcs:twilio_signal_test_agent' }],
      },
      {
        id: 'PA_CUSTOMER',
        conversationId: 'CHtest123456789',
        accountId: 'ACtest123456789',
        type: 'CUSTOMER',
        addresses: [{ channel: 'RCS', address: 'rcs:+12345678901' }],
      },
    ]);
  });

  describe('initialization', () => {
    it('should create RCS channel with config', () => {
      expect(channel).toBeInstanceOf(RCSChannel);
      expect(channel.channelType).toBe('rcs');
    });

    it('should start with no active conversations', () => {
      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });

    it('should require rcsSenderId on TAC config', async () => {
      const { rcsSenderId: _omitted, ...configWithoutSender } = getTestConfig();
      const tacWithoutSender = await createTestTAC(configWithoutSender);
      expect(() => new RCSChannel(tacWithoutSender)).toThrow(/rcsSenderId\(s\) is required/);
    });

    it('should reject zero dedupCapacity', () => {
      expect(() => new RCSChannel(tac, { dedupCapacity: 0 })).toThrow(
        'dedupCapacity must be a positive integer'
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

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
    });

    it('should process communication.created event for RCS', async () => {
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
            text: 'Hello from RCS',
          },
          author: {
            address: 'rcs:+12345678901',
            channel: 'RCS',
          },
        },
      };

      await channel.processWebhook(webhookPayload);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.conversationId).toBe('CHtest123456789');
      expect(capturedMessage.message).toBe('Hello from RCS');
      expect(capturedMessage.author).toBe('rcs:+12345678901');
    });

    it('should ignore messages from the configured RCS sender', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: {
            type: 'TEXT',
            text: 'Agent message',
          },
          author: {
            address: 'rcs:twilio_signal_test_agent', // Matches rcsSenderId
            channel: 'RCS',
          },
        },
      };

      await channel.processWebhook(webhookPayload);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should filter events from other channel types', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          content: { type: 'TEXT', text: 'SMS message' },
          author: {
            address: '+15559876543',
            channel: 'SMS',
          },
        },
      };

      await channel.processWebhook(webhookPayload);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should process conversation.updated close', async () => {
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);

      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          conversationId: 'CHtest123456789',
          status: 'CLOSED',
        },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });
  });

  describe('sendResponse', () => {
    it('should throw if no session exists or has not been reconciled', async () => {
      await expect(channel.sendResponse('CHtest123456789', 'hi')).rejects.toThrow(
        /without a reconciled session/
      );
    });

    it('should send via Actions API when session is reconciled', async () => {
      // Seed a reconciled session
      const session = (channel as any).startConversation('CHtest123456789');
      session.authorInfo = {
        address: 'rcs:+12345678901',
        participantId: 'PA_CUSTOMER',
      };
      session.aiAgentInfo = {
        address: 'rcs:twilio_signal_test_agent',
        participantId: 'PA_AGENT',
      };

      const createActionSpy = vi
        .spyOn(tac.getConversationClient()!, 'createAction')
        .mockResolvedValue({
          id: 'ACT_test',
          type: 'SEND_MESSAGE',
          status: 'PENDING',
          conversationId: 'CHtest123456789',
          createdAt: '2024-01-01T00:00:00Z',
        } as any);

      await channel.sendResponse('CHtest123456789', 'Hello');

      expect(createActionSpy).toHaveBeenCalledWith(
        'CHtest123456789',
        expect.objectContaining({
          type: 'SEND_MESSAGE',
          payload: expect.objectContaining({
            from: { channel: 'RCS', participantId: 'PA_AGENT' },
            to: [{ channel: 'RCS', participantId: 'PA_CUSTOMER' }],
            content: { text: 'Hello' },
          }),
        })
      );
    });
  });

  describe('conversation ended callback', () => {
    it('should fire onConversationEnded callback with full session on close', async () => {
      const captured: ConversationSession[] = [];

      tac.onConversationEnded(({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(channel);

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789', profileId: 'test_profile_123' },
      });

      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { conversationId: 'CHtest123456789', status: 'CLOSED' },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHtest123456789');
      expect(captured[0].channel).toBe('rcs');
    });
  });

  describe('multi-sender support', () => {
    const multiConfig = () => ({
      ...getTestConfig(),
      rcsSenderIds: ['rcs:twilio_signal_test_agent', 'rcs:alt_agent'],
    });

    it('isDefaultAgentAddress matches any configured sender', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new RCSChannel(multiTac);
      expect((multiChannel as any).isDefaultAgentAddress('rcs:twilio_signal_test_agent')).toBe(true);
      expect((multiChannel as any).isDefaultAgentAddress('rcs:alt_agent')).toBe(true);
      expect((multiChannel as any).isDefaultAgentAddress('rcs:other')).toBe(false);
    });

    it('outbound from selects a configured sender', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new RCSChannel(multiTac);
      const initSpy = vi
        .spyOn(multiChannel as any, 'initiateOutboundMessagingConversation')
        .mockResolvedValue({ conversationId: 'CH1', session: {} });

      await multiChannel.initiateOutboundConversation({
        to: '+19998887777',
        message: 'hi',
        from: 'rcs:alt_agent',
      });

      expect(initSpy.mock.calls[0]![0].from).toBe('rcs:alt_agent');
    });

    it('outbound rejects a from that is not a configured sender', async () => {
      await expect(
        channel.initiateOutboundConversation({
          to: '+19998887777',
          message: 'hi',
          from: 'rcs:unconfigured',
        })
      ).rejects.toThrow(/is not a configured RCS sender/);
    });
  });
});
