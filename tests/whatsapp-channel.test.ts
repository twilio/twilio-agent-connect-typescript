import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhatsAppChannel, TAC } from '@twilio/tac-core';
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

  let channel: WhatsAppChannel;
  let tac: TAC;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
    channel = new WhatsAppChannel(tac);
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

    it('should start with no active conversations', () => {
      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
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
      const whatsappChannel = new WhatsAppChannel(tacWithoutWhatsApp);

      expect(() => (whatsappChannel as any).isDefaultAgentAddress('whatsapp:+15551234567')).toThrow(
        'whatsappNumber is required for WhatsApp channel'
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
        'Invalid memoryMode: "invalid". Must be "always" or "never".'
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
      });
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
    it('should throw error without reconciled session', async () => {
      await expect(
        channel.sendResponse('CHtest123456789', 'Hello')
      ).rejects.toThrow(
        'Unable to send WhatsApp: sendResponse called without a reconciled session'
      );
    });

    it('should send WhatsApp message with reconciled session', async () => {
      // Setup session with reconciled participants
      const session = (channel as any).startConversation('CHtest123456789');
      session.authorInfo = {
        address: 'whatsapp:+15559876543',
        participantId: 'PA222',
      };
      session.aiAgentInfo = {
        address: 'whatsapp:+15551234567',
        participantId: 'PA111',
      };

      const conversationClient = tac.getConversationClient();
      const createActionSpy = vi.spyOn(conversationClient!, 'createAction').mockResolvedValue(undefined as never);

      await channel.sendResponse('CHtest123456789', 'Hello from WhatsApp');

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
      const whatsappChannel = new WhatsAppChannel(tacWithoutWhatsApp);

      await expect(
        whatsappChannel.initiateOutboundConversation({
          to: 'whatsapp:+15559876543',
          message: 'Hello',
        })
      ).rejects.toThrow('whatsappNumber is required for WhatsApp channel');
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
});
