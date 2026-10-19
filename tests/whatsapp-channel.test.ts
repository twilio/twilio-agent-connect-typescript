import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WhatsAppChannel,
  TAC,
  ConversationClient,
  ConversationParticipant,
  ConversationSession,
} from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';

describe('WhatsApp Channel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getTestConfig = () => ({
    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    whatsappNumber: 'whatsapp:+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  const agentParticipant = (
    address = 'whatsapp:+15551234567',
    id = 'PA111'
  ): ConversationParticipant => ({
    id,
    conversationId: 'CHtest123456789',
    accountId: 'ACtest123456789',
    type: 'AI_AGENT',
    addresses: [{ channel: 'WHATSAPP', address }],
  });
  const customerParticipant = (profileId?: string): ConversationParticipant => ({
    id: 'PA222',
    conversationId: 'CHtest123456789',
    accountId: 'ACtest123456789',
    type: 'CUSTOMER',
    ...(profileId ? { profileId } : {}),
    addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15559876543' }],
  });

  const inboundWebhook = (recipientAddress?: string) => ({
    eventType: 'COMMUNICATION_CREATED',
    data: {
      conversationId: 'CHtest123456789',
      content: { type: 'TEXT', text: 'hello' },
      author: { address: 'whatsapp:+15559876543', channel: 'WHATSAPP' },
      recipients:
        recipientAddress !== undefined
          ? [{ channel: 'WHATSAPP', address: recipientAddress }]
          : [],
    },
  });

  let channel: WhatsAppChannel;
  let tac: TAC;
  let listParticipantsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
    channel = new WhatsAppChannel(tac);
    // Every inbound message reads the conversation's participants once.
    listParticipantsSpy = vi
      .spyOn(ConversationClient.prototype, 'listParticipants')
      .mockResolvedValue([agentParticipant(), customerParticipant()]);
    // Short-circuit memory retrieval
    vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as never);
    // Short-circuit reconcileParticipants
    vi.spyOn(channel as any, 'reconcileParticipants').mockResolvedValue([
      {
        id: 'PA111',
        conversationId: 'CHtest123456789',
        accountId: 'ACtest123456789',
        type: 'AI_AGENT',
        addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15551234567' }],
      },
      {
        id: 'PA222',
        conversationId: 'CHtest123456789',
        accountId: 'ACtest123456789',
        type: 'CUSTOMER',
        addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15559876543' }],
      },
    ]);
  });

  describe('initialization', () => {
    it('should create WhatsApp channel with config', () => {
      expect(channel).toBeInstanceOf(WhatsAppChannel);
      expect(channel.channelType).toBe('whatsapp');
    });

    it('keeps no sessions (deprecated lookups return undefined/false)', () => {
      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
      expect(channel.getConversationSession('CHtest123456789')).toBeUndefined();
    });

    it('should throw error if whatsappNumber is not configured', async () => {
      const configWithoutWhatsApp = {
        accountSid: 'ACtest123456789',
        authToken: 'test_token_123',
        apiKey: 'test_api_key',
        apiSecret: 'test_api_token',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      };
      const tacWithoutWhatsApp = await createTestTAC(configWithoutWhatsApp);

      // Construction itself throws — WhatsApp requires at least one number.
      expect(() => new WhatsAppChannel(tacWithoutWhatsApp)).toThrow(
        /whatsappNumber\(s\) is required for WhatsApp channel/
      );
    });

    it('should default memoryMode to "never"', () => {
      const defaultChannel = new WhatsAppChannel(tac);
      expect((defaultChannel as any).memoryMode).toBe('never');
    });

    it('should accept memoryMode "always"', () => {
      const alwaysChannel = new WhatsAppChannel(tac, { memoryMode: 'always' });
      expect((alwaysChannel as any).memoryMode).toBe('always');
    });

    it('should accept memoryMode "never"', () => {
      const neverChannel = new WhatsAppChannel(tac, { memoryMode: 'never' });
      expect((neverChannel as any).memoryMode).toBe('never');
    });

    it('should reject invalid memoryMode', () => {
      expect(() => new WhatsAppChannel(tac, { memoryMode: 'invalid' as any })).toThrow(
        'Invalid memoryMode: "invalid". Must be "always", "once", or "never".'
      );
    });
  });

  describe('webhook processing', () => {
    it('should process COMMUNICATION_CREATED event', async () => {
      const messageReceivedCallback = vi.fn();
      channel.on('messageReceived', messageReceivedCallback);

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          profileId: 'profile_id_123',
          id: 'comm_id_123',
          author: {
            address: 'whatsapp:+15559876543',
            channel: 'WHATSAPP',
            participantId: 'PA222',
          },
          content: {
            type: 'text',
            text: 'Hello via WhatsApp',
          },
        },
      };

      await channel.processWebhook(webhookPayload);

      expect(messageReceivedCallback).toHaveBeenCalledWith({
        conversationId: 'CHtest123456789',
        profileId: 'profile_id_123',
        message: 'Hello via WhatsApp',
        author: 'whatsapp:+15559876543',
        userMemory: undefined,
        session: expect.objectContaining({
          conversationId: 'CHtest123456789',
          channel: 'whatsapp',
          authorInfo: expect.objectContaining({ participantId: 'PA222' }),
          aiAgentInfo: expect.objectContaining({ participantId: 'PA111' }),
        }),
      });
      expect(listParticipantsSpy).toHaveBeenCalledTimes(1);
    });

    it('should ignore CONVERSATION_CREATED (nothing to start)', async () => {
      await expect(
        channel.processWebhook({
          eventType: 'CONVERSATION_CREATED',
          data: { conversationId: 'CHtest123456789' },
        })
      ).resolves.not.toThrow();
      expect(listParticipantsSpy).not.toHaveBeenCalled();
    });

    it('should fire onConversationEnded on CLOSED with a session rebuilt from participants', async () => {
      const captured: ConversationSession[] = [];
      listParticipantsSpy.mockResolvedValue([agentParticipant(), customerParticipant('prof_wa')]);
      tac.onConversationEnded(({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(channel);

      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          conversationId: 'CHtest123456789',
          configurationId: getTestConfig().conversationConfigurationId,
          status: 'CLOSED',
        },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHtest123456789');
      expect(captured[0].channel).toBe('whatsapp');
      expect(captured[0].profileId).toBe('prof_wa');
    });

    it('should ignore messages from agent itself', async () => {
      const messageReceivedCallback = vi.fn();
      channel.on('messageReceived', messageReceivedCallback);

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: {
            address: 'whatsapp:+15551234567',
            channel: 'WHATSAPP',
          },
          content: {
            type: 'text',
            text: 'Message from bot',
          },
        },
      };

      await channel.processWebhook(webhookPayload);

      expect(messageReceivedCallback).not.toHaveBeenCalled();
    });

    it('should filter events not for WHATSAPP channel', async () => {
      const messageReceivedCallback = vi.fn();
      channel.on('messageReceived', messageReceivedCallback);

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: {
            address: '+15559876543',
            channel: 'SMS',
          },
          content: {
            type: 'text',
            text: 'SMS message',
          },
        },
      };

      await channel.processWebhook(webhookPayload);

      expect(messageReceivedCallback).not.toHaveBeenCalled();
    });
  });

  describe('sendResponse', () => {
    it('should throw when no recipient resolves for a bare id', async () => {
      listParticipantsSpy.mockResolvedValue([]);
      await expect(channel.sendResponse('CHtest123456789', 'Hello')).rejects.toThrow(
        'Unable to send WHATSAPP message: no recipient resolved'
      );
    });

    it('should rebuild the session from participants for a bare id', async () => {
      const createActionSpy = vi
        .spyOn(tac.getConversationClient()!, 'createAction')
        .mockResolvedValue(undefined as never);

      await channel.sendResponse('CHtest123456789', 'Hi');

      expect(listParticipantsSpy).toHaveBeenCalledTimes(1);
      expect(createActionSpy).toHaveBeenCalledWith('CHtest123456789', {
        type: 'SEND_MESSAGE',
        payload: {
          from: { channel: 'WHATSAPP', participantId: 'PA111' },
          to: [{ channel: 'WHATSAPP', participantId: 'PA222' }],
          content: { text: 'Hi' },
        },
      });
    });

    it('should send WhatsApp message with reconciled session', async () => {
      const session: ConversationSession = {
        conversationId: 'CHtest123456789',
        channel: 'whatsapp',
        startedAt: new Date(),
        metadata: {},
        authorInfo: { address: 'whatsapp:+15559876543', participantId: 'PA222' },
        aiAgentInfo: { address: 'whatsapp:+15551234567', participantId: 'PA111' },
      };

      const conversationClient = tac.getConversationClient();
      const createActionSpy = vi.spyOn(conversationClient!, 'createAction').mockResolvedValue(undefined as never);

      await channel.sendResponse(session, 'Hello from WhatsApp');

      expect(listParticipantsSpy).not.toHaveBeenCalled();
      expect(createActionSpy).toHaveBeenCalledWith('CHtest123456789', {
        type: 'SEND_MESSAGE',
        payload: {
          from: {
            channel: 'WHATSAPP',
            participantId: 'PA111',
          },
          to: [
            {
              channel: 'WHATSAPP',
              participantId: 'PA222',
            },
          ],
          content: { text: 'Hello from WhatsApp' },
        },
      });
    });
  });

  describe('initiateOutboundConversation', () => {
    it('should reject an outbound from that is not a configured WhatsApp sender', async () => {
      await expect(
        channel.initiateOutboundConversation({
          to: 'whatsapp:+15559876543',
          message: 'Hello',
          from: 'whatsapp:+19998887777',
        })
      ).rejects.toThrow(/from 'whatsapp:\+19998887777' is not a configured whatsapp sender/);
    });

    it('should initiate outbound WhatsApp conversation', async () => {
      const conversationClient = tac.getConversationClient();

      vi.spyOn(conversationClient!, 'createOrReuseConversation').mockResolvedValue({
        conversation: { id: 'CHoutbound123' },
        reused: false,
      } as any);

      vi.spyOn(conversationClient!, 'listParticipants').mockResolvedValue([
        {
          id: 'PA111',
          conversationId: 'CHoutbound123',
          type: 'AI_AGENT',
          addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15551234567' }],
        },
        {
          id: 'PA222',
          conversationId: 'CHoutbound123',
          type: 'CUSTOMER',
          addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15559876543' }],
        },
      ] as any);

      const createActionSpy = vi.spyOn(conversationClient!, 'createAction').mockResolvedValue(undefined as never);

      const result = await channel.initiateOutboundConversation({
        to: 'whatsapp:+15559876543',
        message: 'Hello from outbound WhatsApp',
      });

      expect(result.conversationId).toBe('CHoutbound123');
      expect(result.session).toBeDefined();
      expect(createActionSpy).toHaveBeenCalledWith('CHoutbound123', {
        type: 'SEND_MESSAGE',
        payload: {
          from: { channel: 'WHATSAPP', participantId: 'PA111' },
          to: [{ channel: 'WHATSAPP', participantId: 'PA222' }],
          content: { text: 'Hello from outbound WhatsApp' },
        },
      });
    });
  });

  describe('memory retrieval', () => {
    it('should not retrieve memory when memoryMode is "never"', async () => {
      const channelNever = new WhatsAppChannel(tac, { memoryMode: 'never' });
      const retrieveMemorySpy = vi.spyOn(tac, 'retrieveMemory');

      // Mock reconcileParticipants
      vi.spyOn(channelNever as any, 'reconcileParticipants').mockResolvedValue([
        {
          id: 'PA111',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          type: 'AI_AGENT',
          addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15551234567' }],
        },
        {
          id: 'PA222',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          type: 'CUSTOMER',
          addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15559876543' }],
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
            address: 'whatsapp:+15559876543',
            channel: 'WHATSAPP',
          },
        },
      };

      await channelNever.processWebhook(webhookPayload);

      // Memory should NOT be retrieved
      expect(retrieveMemorySpy).not.toHaveBeenCalled();
    });

    it('should retrieve memory when memoryMode is "always"', async () => {
      const channelAlways = new WhatsAppChannel(tac, { memoryMode: 'always' });
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
          addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15551234567' }],
        },
        {
          id: 'PA222',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          type: 'CUSTOMER',
          addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15559876543' }],
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
            address: 'whatsapp:+15559876543',
            channel: 'WHATSAPP',
          },
        },
      };

      await channelAlways.processWebhook(webhookPayload);

      // Memory should be retrieved
      expect(retrieveMemorySpy).toHaveBeenCalled();
    });

    it('should handle memory retrieval errors gracefully when memoryMode is "always"', async () => {
      const channelAlways = new WhatsAppChannel(tac, { memoryMode: 'always' });
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
          addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15551234567' }],
        },
        {
          id: 'PA222',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          type: 'CUSTOMER',
          addresses: [{ channel: 'WHATSAPP', address: 'whatsapp:+15559876543' }],
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
            address: 'whatsapp:+15559876543',
            channel: 'WHATSAPP',
          },
        },
      };

      // Should not throw - error is handled gracefully
      await expect(channelAlways.processWebhook(webhookPayload)).resolves.not.toThrow();

      expect(retrieveMemorySpy).toHaveBeenCalled();
    });
  });

  describe('multi-sender support', () => {
    const multiConfig = () => ({
      ...getTestConfig(),
      whatsappNumbers: ['whatsapp:+15551234567', 'whatsapp:+14440000000'],
    });

    it('isDefaultAgentAddress matches any configured number', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new WhatsAppChannel(multiTac);
      expect((multiChannel as any).isDefaultAgentAddress('whatsapp:+15551234567')).toBe(true);
      expect((multiChannel as any).isDefaultAgentAddress('whatsapp:+14440000000')).toBe(true);
      expect((multiChannel as any).isDefaultAgentAddress('whatsapp:+19999999999')).toBe(false);
    });

    it('outbound from selects a configured number', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new WhatsAppChannel(multiTac);
      const initSpy = vi
        .spyOn(multiChannel as any, 'initiateOutboundMessagingConversation')
        .mockResolvedValue({ conversationId: 'CH1', session: {} });

      await multiChannel.initiateOutboundConversation({
        to: 'whatsapp:+19998887777',
        message: 'hi',
        from: 'whatsapp:+14440000000',
      });

      expect(initSpy.mock.calls[0]![0].from).toBe('whatsapp:+14440000000');
    });

    it('inbound agent address is derived from the webhook recipient', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new WhatsAppChannel(multiTac);
      listParticipantsSpy.mockResolvedValue([
        agentParticipant('whatsapp:+14440000000', 'PA_AGENT2'),
        customerParticipant(),
      ]);
      const reconcileSpy = vi
        .spyOn(multiChannel as any, 'reconcileParticipants')
        .mockResolvedValue([
          agentParticipant('whatsapp:+14440000000', 'PA_AGENT2'),
          customerParticipant(),
        ]);

      await multiChannel.processWebhook(inboundWebhook('whatsapp:+14440000000'));

      const sessionArg = reconcileSpy.mock.calls[0]![0] as ConversationSession;
      expect(sessionArg.aiAgentInfo?.address).toBe('whatsapp:+14440000000');
    });

    it('drops an inbound message addressed to an unconfigured number without a lookup', async () => {
      const reconcileSpy = vi.spyOn(channel as any, 'reconcileParticipants');
      const errors: { error: Error; context?: Record<string, unknown> }[] = [];
      channel.on('error', data => errors.push(data));

      await channel.processWebhook(inboundWebhook('whatsapp:+19998887777'));

      expect(reconcileSpy).not.toHaveBeenCalled();
      expect(errors).toHaveLength(1);
      expect(errors[0]!.context?.dropped_inbound).toBe(true);
      expect(listParticipantsSpy).not.toHaveBeenCalled();
    });

    it('falls back to the configured number the participants hold when the webhook has no recipient', async () => {
      const multiTac = await createTestTAC(multiConfig());
      const multiChannel = new WhatsAppChannel(multiTac);
      listParticipantsSpy.mockResolvedValue([
        agentParticipant('whatsapp:+14440000000'),
        customerParticipant(),
      ]);
      const reconcileSpy = vi
        .spyOn(multiChannel as any, 'reconcileParticipants')
        .mockResolvedValue([agentParticipant('whatsapp:+14440000000'), customerParticipant()]);

      await multiChannel.processWebhook(inboundWebhook(undefined));

      const sessionArg = reconcileSpy.mock.calls[0]![0] as ConversationSession;
      expect(sessionArg.aiAgentInfo?.address).toBe('whatsapp:+14440000000');
    });
  });
});
