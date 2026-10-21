import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ChatChannel,
  TAC,
  ConversationClient,
  ConversationParticipant,
  ConversationSession,
} from '@twilio/tac-core';
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

  const CHAT_SID = 'CH00000000000000000000000000000000';

  const chatParticipant = (
    id: string,
    type: ConversationParticipant['type'],
    address: string,
    channelId?: string,
    profileId?: string
  ): ConversationParticipant => ({
    id,
    conversationId: 'CHtest123456789',
    accountId: 'ACtest123456789',
    type,
    ...(profileId ? { profileId } : {}),
    addresses: [{ channel: 'CHAT', address, ...(channelId ? { channelId } : {}) }],
  });

  const closedWebhook = (conversationId: string) => ({
    eventType: 'CONVERSATION_UPDATED',
    data: {
      conversationId,
      configurationId: getTestConfig().conversationConfigurationId,
      status: 'CLOSED',
    },
  });

  let channel: ChatChannel;
  let tac: TAC;
  let listParticipantsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
    channel = new ChatChannel(tac);
    // Every inbound message reads the conversation's participants once.
    listParticipantsSpy = vi
      .spyOn(ConversationClient.prototype, 'listParticipants')
      .mockResolvedValue([
        chatParticipant('PA_agent_123', 'AI_AGENT', 'ai-assistant', CHAT_SID),
        chatParticipant('PA_customer_123', 'CUSTOMER', 'customer@example.com', CHAT_SID),
      ]);
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

    it('keeps no sessions (deprecated lookups return undefined/false)', () => {
      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
      expect(channel.getConversationSession('CHtest123456789')).toBeUndefined();
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
    it('should ignore conversation.created; conversationStarted is a deprecated no-op', async () => {
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

      expect(startedCallback).not.toHaveBeenCalled();
      expect(listParticipantsSpy).not.toHaveBeenCalled();
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

      expect(messageCallback).toHaveBeenCalledWith({
        conversationId: 'CHtest123456789',
        profileId: undefined,
        message: 'Hello from chat',
        author: 'customer@example.com',
        userMemory: undefined,
        session: expect.objectContaining({
          conversationId: 'CHtest123456789',
          channel: 'chat',
          aiAgentInfo: expect.objectContaining({ participantId: 'PA_agent_123' }),
        }),
      });
      expect(listParticipantsSpy).toHaveBeenCalledTimes(1);
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

      const captured: ConversationSession[] = [];
      channel.on('messageReceived', data => captured.push(data.session));

      await channel.processWebhook(webhookPayload);

      expect(captured).toHaveLength(1);
      expect(captured[0].metadata?.channelId).toBe('CH00000000000000000000000000000000');
    });

    it('should add a lazily-created agent with the channelId on its CHAT address', async () => {
      // Use real reconciliation for this test.
      (channel as any).reconcileParticipants.mockRestore();
      listParticipantsSpy.mockResolvedValue([
        chatParticipant('PA_USER', 'CUSTOMER', 'user@example.com', CHAT_SID),
      ]);
      const addSpy = vi
        .spyOn(ConversationClient.prototype, 'addParticipant')
        .mockResolvedValue(chatParticipant('PA_AGENT', 'AI_AGENT', 'ai-assistant', CHAT_SID));
      const captured: string[] = [];
      channel.on('messageReceived', data => captured.push(data.message));

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest123456789',
          author: { address: 'user@example.com', channel: 'CHAT', participantId: 'PA_USER' },
          content: { type: 'TEXT', text: 'Test' },
          channelId: CHAT_SID,
        },
      });

      expect(addSpy).toHaveBeenCalledTimes(1);
      // Conversation Orchestrator requires channelId on a CHAT participant address.
      expect(addSpy.mock.calls[0]![1]).toEqual([
        { channel: 'CHAT', address: 'ai-assistant', channelId: CHAT_SID },
      ]);
      expect(captured).toEqual(['Test']);
    });

    it('should process conversation.updated (closed) event', async () => {
      listParticipantsSpy.mockResolvedValue([
        chatParticipant('PA_USER', 'CUSTOMER', 'user@example.com', undefined, 'profile_123'),
      ]);
      const endedCallback = vi.fn();
      channel.on('conversationEnded', endedCallback);

      await channel.processWebhook(closedWebhook('CHtest123456789'));

      expect(endedCallback).toHaveBeenCalledWith({
        session: expect.objectContaining({
          conversationId: 'CHtest123456789',
          channel: 'chat',
          profileId: 'profile_123',
        }),
      });
    });

    it('should exit fast on CLOSED with no handler registered', async () => {
      tac.registerChannel(channel);

      await channel.processWebhook(closedWebhook('CHtest123456789'));

      expect(listParticipantsSpy).not.toHaveBeenCalled();
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
    /** A chat session shaped the way an inbound webhook (or outbound initiation) leaves it. */
    const reconciledSession = (overrides: Partial<ConversationSession> = {}): ConversationSession => ({
      conversationId: 'CHtest123456789',
      channel: 'chat',
      startedAt: new Date(),
      authorInfo: { address: 'customer@example.com', participantId: 'PA_customer_123' },
      aiAgentInfo: { address: 'ai-assistant', participantId: 'PA_agent_123' },
      metadata: { channelId: CHAT_SID },
      ...overrides,
    });

    beforeEach(() => {
      // Access the conversation client's axios instance through TAC
      const conversationClient = (tac as any).conversationClient;
      mockAdapter = new MockAdapter(conversationClient.axiosInstance);
      // Reset history to clear the getConfiguration call from TAC initialization
      mockAdapter.resetHistory();

      mockAdapter.onPost('/v2/Conversations/CHtest123456789/Actions').reply(202, {
        id: 'conv_action_01abcdef',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHtest123456789',
      });
    });

    it('should send response via Actions API', async () => {
      await channel.sendResponse(reconciledSession(), 'Hello from bot');

      // A session already carries both participants — only createAction
      expect(listParticipantsSpy).not.toHaveBeenCalled();
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
      expect(body.payload.channelSettings.channelId).toBe(CHAT_SID);
    });

    it('should throw when channelId missing from session metadata', async () => {
      await expect(
        channel.sendResponse(reconciledSession({ metadata: {} }), 'Hello')
      ).rejects.toThrow(/session\.metadata\['channelId'\]/);
      expect(mockAdapter.history.post.length).toBe(0);
    });

    it('by bare id, takes the channelId from the participants', async () => {
      listParticipantsSpy.mockResolvedValue([
        chatParticipant('PA_AGENT', 'AI_AGENT', 'ai-assistant', 'CH_CHAT_SID'),
        chatParticipant('PA_USER', 'CUSTOMER', 'user@example.com', 'CH_CHAT_SID'),
      ]);

      await channel.sendResponse('CHtest123456789', 'Hello!');

      expect(listParticipantsSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body.payload.from.participantId).toBe('PA_AGENT');
      expect(body.payload.to[0].participantId).toBe('PA_USER');
      expect(body.payload.channelSettings.channelId).toBe('CH_CHAT_SID');
    });

    it("by bare id, ignores other participants' channelIds", async () => {
      listParticipantsSpy.mockResolvedValue([
        chatParticipant('PA_USER', 'CUSTOMER', 'user@example.com'),
        chatParticipant('PA_OTHER', 'HUMAN_AGENT', 'someone', 'CH_OTHER'),
      ]);

      await expect(channel.sendResponse('CHtest123456789', 'Hello!')).rejects.toThrow(
        'Pass the ConversationSession'
      );
      expect(mockAdapter.history.post.length).toBe(0);
    });

    it('by bare id without any channelId, says to pass the session', async () => {
      listParticipantsSpy.mockResolvedValue([
        chatParticipant('PA_USER', 'CUSTOMER', 'user@example.com'),
      ]);

      await expect(channel.sendResponse('CHtest123456789', 'Hello!')).rejects.toThrow(
        /session\.metadata\['channelId'\].*Pass the ConversationSession/
      );
      expect(mockAdapter.history.post.length).toBe(0);
    });

    it('should throw when no recipient resolves', async () => {
      listParticipantsSpy.mockResolvedValue([]);

      await expect(channel.sendResponse('CHtest123456789', 'Hello')).rejects.toThrow(
        'no recipient resolved'
      );
    });

    it('should throw when session is missing authorInfo', async () => {
      const session = reconciledSession();
      delete session.authorInfo;

      await expect(channel.sendResponse(session, 'Hello')).rejects.toThrow('no recipient resolved');
    });

    it('falls back to the configured agent address when session is missing aiAgentInfo', async () => {
      const session = reconciledSession();
      delete session.aiAgentInfo;

      await channel.sendResponse(session, 'Hello');

      const body = JSON.parse(mockAdapter.history.post[0]!.data);
      expect(body.payload.from).toEqual({ channel: 'CHAT', address: 'ai-assistant' });
    });
  });
});
