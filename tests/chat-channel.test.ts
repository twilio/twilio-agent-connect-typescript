import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatChannel, TAC, ConversationSession } from '@twilio/tac-core';
import MockAdapter from 'axios-mock-adapter';

describe('Chat Channel', () => {
  let mockAdapter: MockAdapter;

  afterEach(() => {
    mockAdapter?.restore();
    vi.restoreAllMocks();
  });

  const getTestConfig = () => ({

    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    twilioApiKey: 'test_api_key',
    twilioApiToken: 'test_api_token',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
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
      // Access the conversation client's axios instance through TAC
      const conversationClient = (tac as any).conversationClient;
      mockAdapter = new MockAdapter(conversationClient.axiosInstance);
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
      mockAdapter.onGet('/v2/Conversations/CHtest123456789/Participants').reply(200, {
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
      });

      // Mock sendCommunication
      mockAdapter.onPost('/v2/Communications').reply(202, {
        message: 'Communication queued',
        conversationId: 'CHtest123456789',
        channelId: 'CH00000000000000000000000000000000',
      });

      await channel.sendResponse('CHtest123456789', 'Hello from bot');

      // Verify requests
      const history = mockAdapter.history;
      expect(history.get.length).toBe(1);
      expect(history.post.length).toBe(1);
      expect(history.post[0].url).toBe('/v2/Communications');
      const sendBody = JSON.parse(history.post[0].data);
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
      mockAdapter.onGet('/v2/Conversations/CHtest123456789/Participants').reply(200, {
        participants: [
          {
            id: 'PA_customer_123',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'CHAT', address: 'customer@example.com' }],
          },
        ],
      });

      // Mock addParticipant
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Participants').reply(201, {
        id: 'PA_agent_123',
        conversationId: 'CHtest123456789',
        accountId: 'ACtest123456789',
        type: 'AI_AGENT',
        addresses: [{ channel: 'CHAT', address: 'ai-assistant' }],
      });

      // Mock sendCommunication
      mockAdapter.onPost('/v2/Communications').reply(202, {
        message: 'Communication queued',
        conversationId: 'CHtest123456789',
        channelId: null,
      });

      await channel.sendResponse('CHtest123456789', 'Hello from bot');

      // Verify requests
      const history = mockAdapter.history;
      expect(history.get.length).toBe(1);
      expect(history.post.length).toBe(2); // addParticipant + sendCommunication

      // Verify addParticipant call
      const addCall = history.post[0];
      expect(addCall.url).toBe('/v2/Conversations/CHtest123456789/Participants');
      const addBody = JSON.parse(addCall.data);
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

      // Mock listParticipants - first call returns no AI_AGENT, second call returns AI_AGENT
      mockAdapter
        .onGet('/v2/Conversations/CHtest123456789/Participants')
        .replyOnce(200, {
          participants: [
            {
              id: 'PA_customer_123',
              conversationId: 'CHtest123456789',
              accountId: 'ACtest123456789',
              type: 'CUSTOMER',
              addresses: [{ channel: 'CHAT', address: 'customer@example.com' }],
            },
          ],
        })
        .onGet('/v2/Conversations/CHtest123456789/Participants')
        .replyOnce(200, {
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
        });

      // Mock addParticipant failure (already exists)
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Participants').reply(409, {
        error: 'Participant already exists',
      });

      // Mock sendCommunication
      mockAdapter.onPost('/v2/Communications').reply(202, {
        message: 'Communication queued',
        conversationId: 'CHtest123456789',
        channelId: null,
      });

      await channel.sendResponse('CHtest123456789', 'Hello from bot');

      // Verify requests: 2 GET (list participants), 1 POST (add participant), 1 POST (send)
      const history = mockAdapter.history;
      expect(history.get.length).toBe(2);
      expect(history.post.length).toBe(2);
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
