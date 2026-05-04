import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatChannel, TAC, ConversationSession } from '@twilio/tac-core';
import MockAdapter from 'axios-mock-adapter';
import { createTestTAC } from './helpers/tac';

describe('Chat Channel', () => {
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

  let channel: ChatChannel;
  let tac: TAC;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
    channel = new ChatChannel(tac);
    // Short-circuit memory retrieval so webhook processing tests don't hit
    // real Twilio APIs with fake credentials and spam the logs with 401s.
    vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as never);
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

    it('should default memoryMode to "never"', () => {
      const defaultChannel = new ChatChannel(tac);
      expect((defaultChannel as any).memoryMode).toBe('never');
    });

    it('should accept memoryMode "always"', () => {
      const alwaysChannel = new ChatChannel(tac, { memoryMode: 'always' });
      expect((alwaysChannel as any).memoryMode).toBe('always');
    });

    it('should accept memoryMode with agentAddress', () => {
      const channel = new ChatChannel(tac, { agentAddress: 'custom', memoryMode: 'always' });
      expect((channel as any).memoryMode).toBe('always');
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
      // Reset history to clear the getConfiguration call from TAC initialization
      mockAdapter.resetHistory();
    });

    it('should send response via Actions API with existing AI_AGENT', async () => {
      // Start conversation, then receive message to populate session
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });

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

      // Mock createAction
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
      });

      await channel.sendResponse('CHtest123456789', 'Hello from bot');

      // Verify requests (listParticipants + createAction)
      const history = mockAdapter.history;
      expect(history.get.length).toBe(1); // listParticipants
      expect(history.post.length).toBe(1);
      expect(history.post[0]!.url).toBe('/v2/Conversations/CHtest123456789/Actions');
      const body = JSON.parse(history.post[0]!.data);
      expect(body).not.toHaveProperty('conversationId');
      expect(body.type).toBe('SEND_MESSAGE');
      // from/to send participantId + channel only (no address) for Mode 1 resolution
      expect(body.payload.from.participantId).toBe('PA_agent_123');
      expect(body.payload.from.channel).toBe('CHAT');
      expect(body.payload.from).not.toHaveProperty('address');
      expect(body.payload.to).toHaveLength(1);
      expect(body.payload.to[0].participantId).toBe('PA_customer_123');
      expect(body.payload.to[0].channel).toBe('CHAT');
      expect(body.payload.to[0]).not.toHaveProperty('address');
      expect(body.payload.content.text).toBe('Hello from bot');
      expect(body.payload.channelSettings.channelId).toBe(
        'CH00000000000000000000000000000000'
      );
    });

    it('should forward chatService from TAC.conversationsV1ServiceSid when set', async () => {
      // TODO(conv-orch): Drop this test when the chatService workaround is removed.
      tac.conversationsV1ServiceSid = 'ISabcdef1234567890abcdef1234567890';

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

      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
      });

      await channel.sendResponse('CHtest123456789', 'Hello');

      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body.payload.channelSettings.chatService).toBe(
        'ISabcdef1234567890abcdef1234567890'
      );
      expect(body.payload.channelSettings.channelId).toBe(
        'CH00000000000000000000000000000000'
      );
    });

    it('should throw when channelId missing from session metadata', async () => {
      // Seed a session with inbound but no channelId
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
          // no channelId
        },
      });

      await expect(channel.sendResponse('CHtest123456789', 'Hello')).rejects.toThrow(
        /session\.metadata\['channelId'\]/
      );
    });

    it('should create AI_AGENT participant if not exists', async () => {
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });

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

      // Mock createAction
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
      });

      await channel.sendResponse('CHtest123456789', 'Hello from bot');

      // Verify requests (listParticipants + addParticipant + createAction)
      const history = mockAdapter.history;
      expect(history.get.length).toBe(1); // listParticipants
      expect(history.post.length).toBe(2); // addParticipant + createAction

      // Verify addParticipant call
      const addCall = history.post.find(p => p.url?.endsWith('/Participants'));
      expect(addCall).toBeDefined();
      const addBody = JSON.parse(addCall!.data);
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
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { conversationId: 'CHtest123456789' },
      });

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

      // Mock createAction
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
      });

      await channel.sendResponse('CHtest123456789', 'Hello from bot');

      // Verify requests: 2x listParticipants + addParticipant + createAction
      const history = mockAdapter.history;
      expect(history.get.length).toBe(2); // 2x listParticipants (retry after 409)
      expect(history.post.length).toBe(2); // addParticipant + createAction
    });

    it('should throw when ensureAgentParticipant fails (addParticipant fails and retry finds none)', async () => {
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

      // Both list calls return no AI_AGENT; addParticipant also fails
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
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Participants').reply(500);

      await expect(channel.sendResponse('CHtest123456789', 'Hello')).rejects.toThrow(
        'Failed to resolve AI_AGENT participant'
      );
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
