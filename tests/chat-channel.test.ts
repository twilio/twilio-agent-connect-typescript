import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatChannel, TAC, ConversationSession } from '@twilio/tac-core';

describe('Chat Channel', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const getTestConfig = () => ({

    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    twilioApiKey: 'test_api_key',
    twilioApiToken: 'test_api_token',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let channel: ChatChannel;
  let tac: TAC;

  beforeEach(() => {
    tac = new TAC({ config: getTestConfig() });
    channel = new ChatChannel(tac);
  });

  describe('initialization', () => {
    it('should create chat channel with default config', () => {
      expect(channel).toBeInstanceOf(ChatChannel);
      expect(channel.channelType).toBe('chat');
    });

    it('should create chat channel with custom agent address', () => {
      const customChannel = new ChatChannel(tac, { agentAddress: 'custom-bot' });
      expect(customChannel).toBeInstanceOf(ChatChannel);
      expect(customChannel.channelType).toBe('chat');
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

      const startedCallback = vi.fn();
      channel.on('conversationStarted', startedCallback);

      await channel.processWebhook(webhookPayload);

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
      expect(startedCallback).toHaveBeenCalledWith({
        session: expect.objectContaining({
          conversationId: 'CHtest123456789',
          profileId: 'test_profile_123',
          channel: 'chat',
        }),
      });
    });

    it('should process communication.created event', async () => {
      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: {
            address: 'customer@example.com',
            channel: 'CHAT',
          },
          content: {
            type: 'TEXT',
            text: 'Hello from chat',
          },
          channelId: 'CH00000000000000000000000000000000',
        },
      };

      const messageCallback = vi.fn();
      channel.on('messageReceived', messageCallback);

      await channel.processWebhook(webhookPayload);

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
      expect(messageCallback).toHaveBeenCalledWith({
        conversationId: 'CHtest123456789',
        profileId: undefined,
        message: 'Hello from chat',
        author: 'customer@example.com',
        userMemory: undefined,
      });
    });

    it('should ignore messages from bot itself (default agent address)', async () => {
      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: {
            address: 'ai-assistant',
            channel: 'CHAT',
          },
          content: {
            type: 'TEXT',
            text: 'Bot response',
          },
        },
      };

      const messageCallback = vi.fn();
      channel.on('messageReceived', messageCallback);

      await channel.processWebhook(webhookPayload);

      expect(messageCallback).not.toHaveBeenCalled();
    });

    it('should ignore messages from bot with custom agent address', async () => {
      const customChannel = new ChatChannel(tac, { agentAddress: 'custom-bot' });

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: {
            address: 'custom-bot',
            channel: 'CHAT',
          },
          content: {
            type: 'TEXT',
            text: 'Bot response',
          },
        },
      };

      const messageCallback = vi.fn();
      customChannel.on('messageReceived', messageCallback);

      await customChannel.processWebhook(webhookPayload);

      expect(messageCallback).not.toHaveBeenCalled();
    });

    it('should store channelId in session metadata', async () => {
      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: {
            address: 'customer@example.com',
            channel: 'CHAT',
          },
          content: {
            type: 'TEXT',
            text: 'Hello',
          },
          channelId: 'CH00000000000000000000000000000000',
        },
      };

      await channel.processWebhook(webhookPayload);

      const session = channel.getConversationSession('CHtest123456789');
      expect(session?.metadata?.channelId).toBe('CH00000000000000000000000000000000');
    });

    it('should process conversation.updated (closed) event', async () => {
      // First create a conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });

      const endedCallback = vi.fn();
      channel.on('conversationEnded', endedCallback);

      // Then close it
      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          conversationId: 'CHtest123456789',
          status: 'CLOSED',
        },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
      expect(endedCallback).toHaveBeenCalledWith({
        session: expect.objectContaining({
          conversationId: 'CHtest123456789',
          channel: 'chat',
        }),
      });
    });

    it('should ignore empty messages', async () => {
      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: {
            address: 'customer@example.com',
            channel: 'CHAT',
          },
          content: {
            type: 'TEXT',
            text: '   ',
          },
        },
      };

      const messageCallback = vi.fn();
      channel.on('messageReceived', messageCallback);

      await channel.processWebhook(webhookPayload);

      expect(messageCallback).not.toHaveBeenCalled();
    });
  });

  describe('send response', () => {
    beforeEach(() => {
      // Mock fetch globally
      global.fetch = vi.fn();
    });

    it('should send response via Send API with existing AI_AGENT', async () => {
      // Setup conversation
      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: {
            address: 'customer@example.com',
            participantId: 'PA_customer_123',
            channel: 'CHAT',
          },
          content: { type: 'TEXT', text: 'Hello' },
          channelId: 'CH00000000000000000000000000000000',
        },
      });

      // Mock listParticipants (AI_AGENT exists)
      const listParticipantsResponse = {
        participants: [
          {
            id: 'PA_agent_123',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'AI_AGENT',
            addresses: [{ channel: 'CHAT', address: 'ai-assistant' }],
          },
          {
            id: 'PA_customer_123',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'CHAT', address: 'customer@example.com' }],
          },
        ],
      };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => listParticipantsResponse,
        clone: () => ({
          text: async () => JSON.stringify(listParticipantsResponse),
        }),
      });

      // Mock sendCommunication
      const sendResponse = {
        message: 'Communication queued',
        conversationId: 'CHtest123456789',
        channelId: 'CH00000000000000000000000000000000',
      };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => sendResponse,
        clone: () => ({
          text: async () => JSON.stringify(sendResponse),
        }),
      });

      await channel.sendResponse('CHtest123456789', 'Hello from bot');

      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Verify sendCommunication call
      const sendCall = (global.fetch as any).mock.calls[1];
      expect(sendCall[0]).toContain('/v2/Communications');
      const sendBody = JSON.parse(sendCall[1].body);
      expect(sendBody).toMatchObject({
        conversationId: 'CHtest123456789',
        author: {
          address: 'ai-assistant',
          channel: 'CHAT',
          participantId: 'PA_agent_123',
        },
        recipients: [
          {
            address: 'customer@example.com',
            channel: 'CHAT',
            participantId: 'PA_customer_123',
          },
        ],
        content: {
          type: 'TEXT',
          text: 'Hello from bot',
        },
        channelId: 'CH00000000000000000000000000000000',
      });
    });

    it('should create AI_AGENT participant if not exists', async () => {
      // Setup conversation
      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: {
            address: 'customer@example.com',
            participantId: 'PA_customer_123',
            channel: 'CHAT',
          },
          content: { type: 'TEXT', text: 'Hello' },
          channelId: 'CH00000000000000000000000000000000',
        },
      });

      // Mock listParticipants (no AI_AGENT)
      const listResponse = {
        participants: [
          {
            id: 'PA_customer_123',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'CHAT', address: 'customer@example.com' }],
          },
        ],
      };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => listResponse,
        clone: () => ({
          text: async () => JSON.stringify(listResponse),
        }),
      });

      // Mock addParticipant
      const addResponse = {
        id: 'PA_agent_123',
        conversationId: 'CHtest123456789',
        accountId: 'ACtest123456789',
        type: 'AI_AGENT',
        addresses: [{ channel: 'CHAT', address: 'ai-assistant' }],
      };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => addResponse,
        clone: () => ({
          text: async () => JSON.stringify(addResponse),
        }),
      });

      // Mock sendCommunication
      const sendResp = {
        message: 'Communication queued',
        conversationId: 'CHtest123456789',
        channelId: null,
      };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => sendResp,
        clone: () => ({
          text: async () => JSON.stringify(sendResp),
        }),
      });

      await channel.sendResponse('CHtest123456789', 'Hello from bot');

      expect(global.fetch).toHaveBeenCalledTimes(3);

      // Verify addParticipant call
      const addCall = (global.fetch as any).mock.calls[1];
      expect(addCall[0]).toContain('/Participants');
      const addBody = JSON.parse(addCall[1].body);
      expect(addBody).toMatchObject({
        type: 'AI_AGENT',
        addresses: [
          {
            channel: 'CHAT',
            address: 'ai-assistant',
            channelId: 'CH00000000000000000000000000000000',
          },
        ],
      });
    });

    it('should handle race condition when creating AI_AGENT', async () => {
      // Setup conversation
      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: {
            address: 'customer@example.com',
            participantId: 'PA_customer_123',
            channel: 'CHAT',
          },
          content: { type: 'TEXT', text: 'Hello' },
          channelId: 'CH00000000000000000000000000000000',
        },
      });

      // Mock listParticipants (no AI_AGENT initially)
      const initialList = {
        participants: [
          {
            id: 'PA_customer_123',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'CHAT', address: 'customer@example.com' }],
          },
        ],
      };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => initialList,
        clone: () => ({
          text: async () => JSON.stringify(initialList),
        }),
      });

      // Mock addParticipant failure (already exists)
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ error: 'Participant already exists' }),
        clone: () => ({
          text: async () => '{"error":"Participant already exists"}',
        }),
      });

      // Mock retry listParticipants (AI_AGENT now exists)
      const retryList = {
        participants: [
          {
            id: 'PA_agent_123',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'AI_AGENT',
            addresses: [{ channel: 'CHAT', address: 'ai-assistant' }],
          },
          {
            id: 'PA_customer_123',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'CHAT', address: 'customer@example.com' }],
          },
        ],
      };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => retryList,
        clone: () => ({
          text: async () => JSON.stringify(retryList),
        }),
      });

      // Mock sendCommunication
      const finalSend = {
        message: 'Communication queued',
        conversationId: 'CHtest123456789',
        channelId: null,
      };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => finalSend,
        clone: () => ({
          text: async () => JSON.stringify(finalSend),
        }),
      });

      await channel.sendResponse('CHtest123456789', 'Hello from bot');

      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it('should throw error if no active session', async () => {
      await expect(channel.sendResponse('CHtest123456789', 'Hello')).rejects.toThrow(
        'No active session found'
      );
    });

    it('should throw error if no author info', async () => {
      // Create conversation without author info
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });

      await expect(channel.sendResponse('CHtest123456789', 'Hello')).rejects.toThrow(
        'No author info found'
      );
    });
  });
});
