import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TAC, RCSChannel, ConversationSession } from '@twilio/tac-core';
import type { MessagingWebhookPayload } from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';

const getTestConfig = () => ({
  accountSid: 'ACtest123',
  authToken: 'test_token_123',
  apiKey: 'SK123',
  apiSecret: 'test_api_token',
  conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  phoneNumber: '+15551234567',
});

function createParticipantAddedWebhook(
  conversationId: string,
  participantId: string,
  profileId: string,
  timestamp: string,
  address = 'rcs:+12345678901'
): MessagingWebhookPayload {
  return {
    eventType: 'PARTICIPANT_ADDED',
    timestamp,
    data: {
      id: participantId,
      conversationId,
      accountId: 'ACtest123',
      serviceId: 'IStest123',
      participantType: 'CUSTOMER',
      profileId,
      author: {
        address,
        channel: 'RCS',
        participantId,
      },
    },
  };
}

function createCommunicationCreatedWebhook(
  conversationId: string,
  participantId: string,
  messageText: string,
  timestamp: string,
  authorAddress = 'rcs:+12345678901'
): MessagingWebhookPayload {
  const commId = `comms_communication_${timestamp.replace(/[:.-]/g, '')}`;
  return {
    eventType: 'COMMUNICATION_CREATED',
    timestamp,
    data: {
      id: commId,
      conversationId,
      accountId: 'ACtest123',
      serviceId: 'IStest123',
      author: {
        address: authorAddress,
        channel: 'RCS',
        participantId,
      },
      content: {
        type: 'TEXT',
        text: messageText,
      },
      recipients: [
        {
          address: 'rcs:twilio_signal_test_agent',
          channel: 'RCS',
          participantId: 'comms_participant_agent',
          deliveryStatus: 'DELIVERED',
        },
      ],
    },
  };
}

function createConversationUpdatedWebhook(
  conversationId: string,
  status: string,
  timestamp: string,
  configurationId = 'default_config'
): MessagingWebhookPayload {
  return {
    eventType: 'CONVERSATION_UPDATED',
    timestamp,
    data: {
      id: conversationId,
      conversationId,
      accountId: 'ACtest123',
      serviceId: 'IStest123',
      status,
    },
  };
}

describe('RCSChannel', () => {
  let tac: TAC;
  let rcsChannel: RCSChannel;

  beforeEach(async () => {
    vi.clearAllMocks();
    tac = await createTestTAC(getTestConfig());
    // Mock memory retrieval to avoid API calls
    vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should require agentAddress in config', async () => {
      expect(() => {
        // @ts-expect-error Testing missing config
        new RCSChannel(tac, {});
      }).toThrow('RCS channel requires agentAddress in config');
    });

    it('should initialize with valid config', async () => {
      const channel = new RCSChannel(tac, { agentAddress: 'rcs:twilio_signal_test_agent' });
      expect(channel.channelType).toBe('rcs');
      expect(channel.agentAddress).toBe('rcs:twilio_signal_test_agent');
    });
  });

  describe('isDefaultAgentAddress', () => {
    beforeEach(async () => {
      rcsChannel = new RCSChannel(tac, { agentAddress: 'rcs:twilio_signal_test_agent' });
    });

    it('should return true for configured agent address', () => {
      // Access protected method via type assertion
      const result = (rcsChannel as any).isDefaultAgentAddress('rcs:twilio_signal_test_agent');
      expect(result).toBe(true);
    });

    it('should return false for other addresses', () => {
      const result = (rcsChannel as any).isDefaultAgentAddress('rcs:+12345678901');
      expect(result).toBe(false);
    });
  });

  describe('webhook processing', () => {
    beforeEach(async () => {
      rcsChannel = new RCSChannel(tac, { agentAddress: 'rcs:twilio_signal_test_agent' });
    });

    it('should process PARTICIPANT_ADDED webhook', async () => {
      const webhook = createParticipantAddedWebhook(
        'conv_123',
        'part_customer',
        'prof_123',
        '2025-01-15T10:15:30Z',
        'rcs:+12345678901'
      );

      await rcsChannel.processWebhook(webhook);

      // Verify conversation was started
      expect(rcsChannel.isConversationActive('conv_123')).toBe(true);
      const session = rcsChannel.getConversationSession('conv_123');
      expect(session?.conversationId).toBe('conv_123');
      expect(session?.profileId).toBe('prof_123');
      expect(session?.channel).toBe('rcs');
    });

    it('should process COMMUNICATION_CREATED webhook', async () => {
      const conversationId = 'conv_123';
      const messageText = 'Hello from RCS!';

      let callbackInvoked = false;
      let receivedMessage = '';
      let receivedContext: any;

      // Register channel with TAC
      tac.registerChannel(rcsChannel);

      // Register message callback
      tac.onMessageReady(({ message, session }) => {
        callbackInvoked = true;
        receivedMessage = message;
        receivedContext = session;
        return 'RCS response';
      });

      // Mock sendResponse
      const sendResponseSpy = vi.spyOn(rcsChannel, 'sendResponse').mockResolvedValue();

      const webhook = createCommunicationCreatedWebhook(
        conversationId,
        'part_customer',
        messageText,
        '2025-01-15T10:15:30Z',
        'rcs:+12345678901'
      );

      await rcsChannel.processWebhook(webhook);

      // Wait for callback to execute
      await vi.waitFor(() => {
        expect(callbackInvoked).toBe(true);
        expect(receivedMessage).toBe(messageText);
        expect(receivedContext.conversationId).toBe(conversationId);
      });

      // Verify sendResponse was called
      await vi.waitFor(() => {
        expect(sendResponseSpy).toHaveBeenCalledWith(conversationId, 'RCS response');
      });
    });

    it('should ignore messages from agent', async () => {
      const conversationId = 'conv_123';

      // First, process PARTICIPANT_ADDED for agent to cache agent address
      const agentWebhook = {
        eventType: 'PARTICIPANT_ADDED',
        timestamp: '2025-01-15T10:15:29Z',
        data: {
          id: 'part_agent',
          conversationId,
          accountId: 'ACtest123',
          serviceId: 'IStest123',
          participantType: 'AI_AGENT',
          profileId: undefined,
          author: {
            address: 'rcs:twilio_signal_test_agent',
            channel: 'RCS',
            participantId: 'part_agent',
          },
        },
      };
      await rcsChannel.processWebhook(agentWebhook);

      let callbackInvoked = false;
      tac.onMessageReady(() => {
        callbackInvoked = true;
        return 'Should not be called';
      });

      // Message from agent
      const webhook = createCommunicationCreatedWebhook(
        conversationId,
        'part_agent',
        'Agent message',
        '2025-01-15T10:15:30Z',
        'rcs:twilio_signal_test_agent'
      );

      await rcsChannel.processWebhook(webhook);

      // Verify callback was NOT invoked
      expect(callbackInvoked).toBe(false);
    });

    it('should handle CONVERSATION_UPDATED with CLOSED status', async () => {
      const conversationId = 'conv_123';

      // Register channel with TAC
      tac.registerChannel(rcsChannel);

      // Start conversation first
      rcsChannel['startConversation'](conversationId, 'prof_123');
      expect(rcsChannel.isConversationActive(conversationId)).toBe(true);

      let endCallbackInvoked = false;
      let endedContext: any;

      tac.onConversationEnded(({ session }) => {
        endCallbackInvoked = true;
        endedContext = session;
      });

      const webhook = createConversationUpdatedWebhook(
        conversationId,
        'CLOSED',
        '2025-01-15T10:20:30Z'
      );

      await rcsChannel.processWebhook(webhook);

      // Wait for callback to execute
      await vi.waitFor(() => {
        expect(endCallbackInvoked).toBe(true);
        expect(endedContext).toBeDefined();
        expect(endedContext.conversationId).toBe(conversationId);
      });

      // Verify conversation was ended
      expect(rcsChannel.isConversationActive(conversationId)).toBe(false);
    });

    it('should deduplicate webhooks with idempotency tokens', async () => {
      const webhook = createCommunicationCreatedWebhook(
        'conv_123',
        'part_customer',
        'Test message',
        '2025-01-15T10:15:30Z'
      );

      // Register channel with TAC
      tac.registerChannel(rcsChannel);

      let callbackCount = 0;
      tac.onMessageReady(() => {
        callbackCount++;
        return 'Response';
      });

      vi.spyOn(rcsChannel, 'sendResponse').mockResolvedValue();

      // Process webhook with idempotency token
      const idempotencyToken = 'test_token_123';
      await rcsChannel.processWebhook(webhook, idempotencyToken);

      await vi.waitFor(() => {
        expect(callbackCount).toBe(1);
      });

      // Process same webhook again with same token - should be deduplicated
      await rcsChannel.processWebhook(webhook, idempotencyToken);

      // Wait a bit to ensure no additional callback
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(callbackCount).toBe(1); // Should not increment
    });
  });

  describe('sendResponse', () => {
    beforeEach(async () => {
      rcsChannel = new RCSChannel(tac, { agentAddress: 'rcs:twilio_signal_test_agent' });
    });

    it('should send RCS response via Actions API', async () => {
      const conversationId = 'conv_123';
      const recipientAddress = 'rcs:+12345678901';

      // Start conversation and set up session
      const session = rcsChannel['startConversation'](conversationId, 'prof_123');
      session.authorInfo = {
        address: recipientAddress,
        participantId: 'part_customer',
      };

      // Mock conversation client methods
      const mockParticipants = [
        {
          id: 'part_customer',
          type: 'CUSTOMER',
          conversationId,
          accountId: 'ACtest123',
          addresses: [{ channel: 'RCS', address: recipientAddress }],
        },
        {
          id: 'part_agent',
          type: 'AI_AGENT',
          conversationId,
          accountId: 'ACtest123',
          addresses: [{ channel: 'RCS', address: 'rcs:twilio_signal_test_agent' }],
        },
      ];

      vi.spyOn(tac['conversationClient'], 'listParticipants').mockResolvedValue(
        mockParticipants as any
      );
      const createActionSpy = vi
        .spyOn(tac['conversationClient'], 'createAction')
        .mockResolvedValue(undefined as any);

      await rcsChannel.sendResponse(conversationId, 'Test response');

      expect(createActionSpy).toHaveBeenCalledWith(conversationId, {
        type: 'SEND_MESSAGE',
        payload: {
          from: {
            channel: 'RCS',
            participantId: 'part_agent',
          },
          to: [
            {
              channel: 'RCS',
              participantId: 'part_customer',
            },
          ],
          content: { text: 'Test response' },
        },
      });
    });

    it('should throw error when no active session', async () => {
      await expect(rcsChannel.sendResponse('conv_999', 'Test')).rejects.toThrow(
        'No active session found'
      );
    });

    it('should throw error when no author info', async () => {
      rcsChannel['startConversation']('conv_123', 'prof_123');

      await expect(rcsChannel.sendResponse('conv_123', 'Test')).rejects.toThrow(
        'No author info found'
      );
    });
  });

  describe('initiateOutboundConversation', () => {
    beforeEach(async () => {
      rcsChannel = new RCSChannel(tac, { agentAddress: 'rcs:test_agent' });
    });

    it('should initiate outbound RCS conversation', async () => {
      const mockConversation = {
        id: 'conv_123',
        accountId: 'ACtest123',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      };

      const mockParticipants = [
        {
          id: 'part_customer',
          type: 'CUSTOMER',
          conversationId: 'conv_123',
          accountId: 'ACtest123',
          addresses: [{ channel: 'RCS', address: 'rcs:+16505551234' }],
        },
        {
          id: 'part_agent',
          type: 'AI_AGENT',
          conversationId: 'conv_123',
          accountId: 'ACtest123',
          addresses: [{ channel: 'RCS', address: 'rcs:test_agent' }],
        },
      ];

      vi.spyOn(tac['conversationClient'], 'createOrReuseConversation').mockResolvedValue({
        conversation: mockConversation as any,
        reused: false,
      });
      vi.spyOn(tac['conversationClient'], 'listParticipants').mockResolvedValue(
        mockParticipants as any
      );
      const createActionSpy = vi
        .spyOn(tac['conversationClient'], 'createAction')
        .mockResolvedValue(undefined as any);

      const result = await rcsChannel.initiateOutboundConversation({
        to: 'rcs:+16505551234',
        message: 'Hello from RCS!',
      });

      expect(result.conversationId).toBe('conv_123');
      expect(result.session.conversationId).toBe('conv_123');
      expect(createActionSpy).toHaveBeenCalledWith('conv_123', {
        type: 'SEND_MESSAGE',
        payload: {
          from: { channel: 'RCS', participantId: 'part_agent' },
          to: [{ channel: 'RCS', participantId: 'part_customer' }],
          content: { text: 'Hello from RCS!' },
        },
      });
    });

    it('should use custom from address when provided', async () => {
      const customFrom = 'rcs:custom_agent';
      const mockConversation = {
        id: 'conv_123',
        accountId: 'ACtest123',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      };

      const mockParticipants = [
        {
          id: 'part_customer',
          type: 'CUSTOMER',
          conversationId: 'conv_123',
          accountId: 'ACtest123',
          addresses: [{ channel: 'RCS', address: 'rcs:+16505551234' }],
        },
        {
          id: 'part_agent',
          type: 'AI_AGENT',
          conversationId: 'conv_123',
          accountId: 'ACtest123',
          addresses: [{ channel: 'RCS', address: customFrom }],
        },
      ];

      vi.spyOn(tac['conversationClient'], 'createOrReuseConversation').mockResolvedValue({
        conversation: mockConversation as any,
        reused: false,
      });
      vi.spyOn(tac['conversationClient'], 'listParticipants').mockResolvedValue(
        mockParticipants as any
      );
      vi.spyOn(tac['conversationClient'], 'createAction').mockResolvedValue(undefined as any);

      const result = await rcsChannel.initiateOutboundConversation({
        to: 'rcs:+16505551234',
        from: customFrom,
        message: 'Hello!',
      });

      expect(result.session.metadata?.fromAddress).toBe(customFrom);
    });
  });
});
