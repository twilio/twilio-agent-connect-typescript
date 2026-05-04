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
    // Short-circuit reconcileParticipants so webhook processing tests don't
    // need to mock listParticipants. Chat disables customer reconcile so the
    // second element is null. Tests that care about reconcile behavior should
    // override this spy.
    vi.spyOn(channel as any, 'reconcileParticipants').mockResolvedValue([
      {
        id: 'PA_agent_123',
        conversationId: 'CHtest123456789',
        accountId: 'ACtest123456789',
        type: 'AI_AGENT',
        addresses: [{ channel: 'CHAT', address: 'ai-assistant' }],
      },
      null,
    ]);
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
    /**
     * Pre-populate a fully-reconciled chat session. `sendResponse` now reads
     * ids directly from `session.authorInfo` and `session.aiAgentInfo`; it no
     * longer calls `listParticipants`/`addParticipant` at send time.
     */
    const seedReconciledSession = (conversationId: string, opts?: {
      channelId?: string;
      agentParticipantId?: string;
      customerParticipantId?: string;
    }) => {
      (channel as any).activeConversations.set(conversationId, {
        conversationId,
        channel: 'chat',
        startedAt: new Date(),
        authorInfo: {
          address: 'customer@example.com',
          participantId: opts?.customerParticipantId ?? 'PA_customer_123',
        },
        aiAgentInfo: {
          address: 'ai-assistant',
          participantId: opts?.agentParticipantId ?? 'PA_agent_123',
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

      // Mock createAction. sendResponse no longer lists participants.
      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
      });
    });

    it('should send response via Actions API', async () => {
      seedReconciledSession('CHtest123456789', {
        channelId: 'CH00000000000000000000000000000000',
      });

      await channel.sendResponse('CHtest123456789', 'Hello from bot');

      // sendResponse no longer calls listParticipants — only createAction
      const history = mockAdapter.history;
      expect(history.get.length).toBe(0);
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

      seedReconciledSession('CHtest123456789', {
        channelId: 'CH00000000000000000000000000000000',
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
      // Seed a reconciled session but without channelId
      seedReconciledSession('CHtest123456789');

      await expect(channel.sendResponse('CHtest123456789', 'Hello')).rejects.toThrow(
        /session\.metadata\['channelId'\]/
      );
    });

    it('should throw when no session exists', async () => {
      await expect(channel.sendResponse('CHtest123456789', 'Hello')).rejects.toThrow(
        'without a reconciled session'
      );
    });

    it('should throw when session is missing authorInfo', async () => {
      (channel as any).activeConversations.set('CHtest123456789', {
        conversationId: 'CHtest123456789',
        channel: 'chat',
        startedAt: new Date(),
        metadata: {},
      });

      await expect(channel.sendResponse('CHtest123456789', 'Hello')).rejects.toThrow(
        'without a reconciled session'
      );
    });

    it('should throw when session is missing aiAgentInfo', async () => {
      (channel as any).activeConversations.set('CHtest123456789', {
        conversationId: 'CHtest123456789',
        channel: 'chat',
        startedAt: new Date(),
        authorInfo: { address: 'customer@example.com', participantId: 'PA_customer_123' },
        metadata: {},
      });

      await expect(channel.sendResponse('CHtest123456789', 'Hello')).rejects.toThrow(
        'without a reconciled session'
      );
    });
  });
});
