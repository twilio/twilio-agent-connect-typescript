import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SMSChannel, ChatChannel, VoiceChannel, TAC } from '@twilio/tac-core';
import MockAdapter from 'axios-mock-adapter';
import { createTestTAC } from './helpers/tac';

const mockCallCreate = vi.fn();

vi.mock('twilio', () => ({
  default: () => ({
    calls: { create: mockCallCreate },
  }),
}));

describe('Outbound Conversations', () => {
  const getTestConfig = () => ({
    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_secret',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  /** Mock createConversation (with inline participants) + listParticipants + createAction */
  const mockSmsOutbound = (
    adapter: MockAdapter,
    convId: string,
    opts?: {
      toAddress?: string;
      fromAddress?: string;
      customerParticipantId?: string;
      agentParticipantId?: string;
    }
  ) => {
    const to = opts?.toAddress ?? '+15559876543';
    const from = opts?.fromAddress ?? '+15551234567';
    const custId = opts?.customerParticipantId ?? 'PAcust';
    const agentId = opts?.agentParticipantId ?? 'PAagent';

    adapter.onPost(/\/v2\/Conversations$/).reply(200, {
      id: convId,
      accountId: 'ACtest123456789',
      status: 'ACTIVE',
    });

    adapter.onGet(/\/Participants$/).reply(200, {
      participants: [
        {
          id: custId,
          conversationId: convId,
          accountId: 'ACtest123456789',
          type: 'CUSTOMER',
          addresses: [{ channel: 'SMS', address: to }],
        },
        {
          id: agentId,
          conversationId: convId,
          accountId: 'ACtest123456789',
          type: 'AI_AGENT',
          addresses: [{ channel: 'SMS', address: from }],
        },
      ],
    });

    adapter.onPost(/\/Actions$/).reply(202, {
      id: `ACT_${convId}`,
      type: 'SEND_MESSAGE',
      status: 'PENDING',
      conversationId: convId,
      createdAt: '2024-01-01T00:00:00Z',
    });
  };

  beforeEach(() => {
    mockCallCreate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SMSChannel.initiateOutboundConversation', () => {
    let tac: TAC;
    let channel: SMSChannel;
    let mockAdapter: MockAdapter;

    beforeEach(async () => {
      tac = await createTestTAC(getTestConfig());
      channel = new SMSChannel(tac);
      mockAdapter = new MockAdapter(
        (tac.getConversationClient() as any).axiosInstance
      );
    });

    afterEach(() => {
      mockAdapter?.restore();
    });

    it('should create conversation with inline participants and send via Actions API', async () => {
      mockSmsOutbound(mockAdapter, 'CHoutbound123');

      const result = await channel.initiateOutboundConversation({
        to: '+15559876543',
        message: 'Hello from the agent!',
      });

      expect(result.conversationId).toBe('CHoutbound123');
      expect(result.session.channel).toBe('sms');
      expect(result.session.metadata?.direction).toBe('outbound');
      expect(result.session.authorInfo?.address).toBe('+15559876543');
    });

    it('should create a local session that tracks the conversation', async () => {
      mockSmsOutbound(mockAdapter, 'CHoutbound456');

      const result = await channel.initiateOutboundConversation({
        to: '+15559876543',
        message: 'Hi there',
      });

      expect(channel.isConversationActive('CHoutbound456')).toBe(true);
      expect(channel.getConversationSession('CHoutbound456')).toBe(result.session);
    });

    it('should include custom metadata in session', async () => {
      mockSmsOutbound(mockAdapter, 'CHoutbound789');

      const result = await channel.initiateOutboundConversation({
        to: '+15559876543',
        message: 'Hi',
        metadata: { campaign: 'welcome', source: 'crm' },
      });

      expect(result.session.metadata?.campaign).toBe('welcome');
      expect(result.session.metadata?.source).toBe('crm');
      expect(result.session.metadata?.direction).toBe('outbound');
    });

    it('should throw on createConversation failure', async () => {
      mockAdapter.onPost(/\/v2\/Conversations$/).reply(400, { error: 'Bad Request' });

      await expect(
        channel.initiateOutboundConversation({
          to: '+15559876543',
          message: 'Hello',
        })
      ).rejects.toThrow();
    });

    it('should use custom from number when provided', async () => {
      mockSmsOutbound(mockAdapter, 'CHfrom123', { fromAddress: '+15550009999' });

      const result = await channel.initiateOutboundConversation({
        to: '+15559876543',
        from: '+15550009999',
        message: 'Hello from a different number',
      });

      expect(result.session.metadata?.fromAddress).toBe('+15550009999');
    });

    it('should store default fromAddress in session metadata', async () => {
      mockSmsOutbound(mockAdapter, 'CHdefault123');

      const result = await channel.initiateOutboundConversation({
        to: '+15559876543',
        message: 'Hello',
      });

      expect(result.session.metadata?.fromAddress).toBe('+15551234567');
    });

    it('should validate options', async () => {
      await expect(
        channel.initiateOutboundConversation({ to: '', message: 'Hello' })
      ).rejects.toThrow();

      await expect(
        channel.initiateOutboundConversation({ to: '+15559876543', message: '' })
      ).rejects.toThrow();
    });

    it('should pass participants in createConversation request body', async () => {
      let capturedBody: unknown;
      mockAdapter.onPost(/\/v2\/Conversations$/).reply(config => {
        capturedBody = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
        return [200, {
          id: 'CHinline1',
          accountId: 'ACtest123456789',
          status: 'ACTIVE',
        }];
      });

      mockAdapter.onGet(/\/Participants$/).reply(200, {
        participants: [
          {
            id: 'PAcust_inline',
            conversationId: 'CHinline1',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'SMS', address: '+15559876543' }],
          },
          {
            id: 'PAagent_inline',
            conversationId: 'CHinline1',
            accountId: 'ACtest123456789',
            type: 'AI_AGENT',
            addresses: [{ channel: 'SMS', address: '+15551234567' }],
          },
        ],
      });

      mockAdapter.onPost(/\/Actions$/).reply(202, {
        id: 'ACTinline',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHinline1',
        createdAt: '2024-01-01T00:00:00Z',
      });

      await channel.initiateOutboundConversation({
        to: '+15559876543',
        message: 'Test inline participants',
      });

      expect(capturedBody).toMatchObject({
        participants: [
          { type: 'CUSTOMER', addresses: [{ channel: 'SMS', address: '+15559876543' }] },
          { type: 'AI_AGENT', addresses: [{ channel: 'SMS', address: '+15551234567' }] },
        ],
      });
    });

    it('should reuse existing conversation on 409 (group-by dedup)', async () => {
      // createConversation returns 409 with X-Conflicting-Resource-Id header
      mockAdapter.onPost(/\/v2\/Conversations$/).replyOnce(
        409,
        {
          code: 400,
          message: 'Address mapping already exists on conversation conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf.',
          more_info: 'https://www.twilio.com/docs/errors/400',
          status: 409,
        },
        { 'x-conflicting-resource-id': 'conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf' }
      );

      // listParticipants on the reused conversation
      mockAdapter
        .onGet(/\/conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf\/Participants$/)
        .replyOnce(200, {
          participants: [
            {
              id: 'PAcust_reuse',
              conversationId: 'conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf',
              accountId: 'ACtest123456789',
              type: 'CUSTOMER',
              addresses: [{ channel: 'SMS', address: '+15559876543' }],
            },
            {
              id: 'PAagent_reuse',
              conversationId: 'conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf',
              accountId: 'ACtest123456789',
              type: 'AI_AGENT',
              addresses: [{ channel: 'SMS', address: '+15551234567' }],
            },
          ],
        });

      mockAdapter.onPost(/\/Actions$/).replyOnce(202, {
        id: 'ACT_reuse',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf',
        createdAt: '2024-01-01T00:00:00Z',
      });

      const result = await channel.initiateOutboundConversation({
        to: '+15559876543',
        message: 'Hello again',
      });

      expect(result.conversationId).toBe('conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf');
      expect(result.session.metadata?.direction).toBe('outbound');
    });
  });

  describe('SMSChannel.sendResponse after outbound', () => {
    let tac: TAC;
    let channel: SMSChannel;
    let mockAdapter: MockAdapter;

    beforeEach(async () => {
      tac = await createTestTAC(getTestConfig());
      channel = new SMSChannel(tac);
      mockAdapter = new MockAdapter(
        (tac.getConversationClient() as any).axiosInstance
      );
    });

    afterEach(() => {
      mockAdapter?.restore();
    });

    it('should send response using Actions API after outbound initiation', async () => {
      // Set up mocks for initiateOutboundConversation
      mockAdapter.onPost(/\/v2\/Conversations$/).reply(200, {
        id: 'CHsr001',
        accountId: 'ACtest123456789',
        status: 'ACTIVE',
      });

      // listParticipants is called by both initiateOutboundConversation and sendResponse
      mockAdapter.onGet(/\/CHsr001\/Participants$/).reply(200, {
        participants: [
          {
            id: 'PAsr_cust1',
            conversationId: 'CHsr001',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'SMS', address: '+15559876543' }],
          },
          {
            id: 'PAsr_agent1',
            conversationId: 'CHsr001',
            accountId: 'ACtest123456789',
            type: 'AI_AGENT',
            addresses: [{ channel: 'SMS', address: '+15551234567' }],
          },
        ],
      });

      // First Actions POST: initial message from initiateOutboundConversation
      mockAdapter.onPost(/\/CHsr001\/Actions$/).replyOnce(202, {
        id: 'ACTsr_init',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHsr001',
        createdAt: '2024-01-01T00:00:00Z',
      });

      await channel.initiateOutboundConversation({
        to: '+15559876543',
        message: 'First message',
      });

      // Second Actions POST: sendResponse
      let capturedBody: unknown;
      mockAdapter.onPost(/\/CHsr001\/Actions$/).reply(config => {
        capturedBody = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
        return [202, {
          id: 'ACTsr_reply',
          type: 'SEND_MESSAGE',
          status: 'PENDING',
          conversationId: 'CHsr001',
          createdAt: '2024-01-01T00:00:00Z',
        }];
      });

      await channel.sendResponse('CHsr001', 'Follow-up message');

      expect(capturedBody).toMatchObject({
        type: 'SEND_MESSAGE',
        payload: {
          from: { channel: 'SMS', participantId: 'PAsr_agent1' },
          to: [{ channel: 'SMS', participantId: 'PAsr_cust1' }],
          content: { text: 'Follow-up message' },
        },
      });
    });

    it('should use fromAddress from session metadata for agent participant lookup', async () => {
      // Set up mocks for initiateOutboundConversation with custom from
      mockAdapter.onPost(/\/v2\/Conversations$/).reply(200, {
        id: 'CHsr002',
        accountId: 'ACtest123456789',
        status: 'ACTIVE',
      });

      mockAdapter.onGet(/\/CHsr002\/Participants$/).reply(200, {
        participants: [
          {
            id: 'PAsr_cust2',
            conversationId: 'CHsr002',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'SMS', address: '+15559876543' }],
          },
          {
            id: 'PAsr_agent2',
            conversationId: 'CHsr002',
            accountId: 'ACtest123456789',
            type: 'AI_AGENT',
            addresses: [{ channel: 'SMS', address: '+15550009999' }],
          },
        ],
      });

      mockAdapter.onPost(/\/CHsr002\/Actions$/).replyOnce(202, {
        id: 'ACTsr_init2',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHsr002',
        createdAt: '2024-01-01T00:00:00Z',
      });

      await channel.initiateOutboundConversation({
        to: '+15559876543',
        from: '+15550009999',
        message: 'First message with custom from',
      });

      let capturedBody: unknown;
      mockAdapter.onPost(/\/CHsr002\/Actions$/).reply(config => {
        capturedBody = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
        return [202, {
          id: 'ACTsr_reply2',
          type: 'SEND_MESSAGE',
          status: 'PENDING',
          conversationId: 'CHsr002',
          createdAt: '2024-01-01T00:00:00Z',
        }];
      });

      await channel.sendResponse('CHsr002', 'Reply using custom from');

      // The agent participant should be resolved by the custom fromAddress (+15550009999)
      expect(capturedBody).toMatchObject({
        type: 'SEND_MESSAGE',
        payload: {
          from: { channel: 'SMS', participantId: 'PAsr_agent2' },
          to: [{ channel: 'SMS', participantId: 'PAsr_cust2' }],
          content: { text: 'Reply using custom from' },
        },
      });
    });
  });

  describe('ChatChannel.initiateOutboundConversation', () => {
    let tac: TAC;
    let channel: ChatChannel;
    let mockAdapter: MockAdapter;

    beforeEach(async () => {
      tac = await createTestTAC(getTestConfig());
      channel = new ChatChannel(tac);
      mockAdapter = new MockAdapter(
        (tac.getConversationClient() as any).axiosInstance
      );
    });

    afterEach(() => {
      mockAdapter?.restore();
    });

    it('should create conversation with inline participants and send via Actions API', async () => {
      mockAdapter.onPost(/\/v2\/Conversations$/).reply(200, {
        id: 'CHchat123',
        accountId: 'ACtest123456789',
        status: 'ACTIVE',
      });

      mockAdapter.onGet(/\/Participants$/).reply(200, {
        participants: [
          {
            id: 'PAchatcust1',
            conversationId: 'CHchat123',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'CHAT', address: 'customer@example.com', channelId: 'CHSIDabc' }],
          },
          {
            id: 'PAchatagent1',
            conversationId: 'CHchat123',
            accountId: 'ACtest123456789',
            type: 'AI_AGENT',
            addresses: [{ channel: 'CHAT', address: 'ai-assistant', channelId: 'CHSIDabc' }],
          },
        ],
      });

      mockAdapter.onPost(/\/Actions$/).reply(202, {
        id: 'ACTchat1',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHchat123',
        createdAt: '2024-01-01T00:00:00Z',
      });

      const result = await channel.initiateOutboundConversation({
        to: 'customer@example.com',
        channelId: 'CHSIDabc',
        message: 'Welcome to our chat!',
      });

      expect(result.conversationId).toBe('CHchat123');
      expect(result.session.channel).toBe('chat');
      expect(result.session.metadata?.direction).toBe('outbound');
      expect(result.session.metadata?.channelId).toBe('CHSIDabc');
    });

    it('should use custom from address when provided', async () => {
      mockAdapter.onPost(/\/v2\/Conversations$/).reply(200, {
        id: 'CHchatfrom1',
        accountId: 'ACtest123456789',
        status: 'ACTIVE',
      });

      mockAdapter.onGet(/\/Participants$/).reply(200, {
        participants: [
          {
            id: 'PAchatcust2',
            conversationId: 'CHchatfrom1',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            addresses: [{ channel: 'CHAT', address: 'customer@example.com', channelId: 'CHSIDabc' }],
          },
          {
            id: 'PAchatagent2',
            conversationId: 'CHchatfrom1',
            accountId: 'ACtest123456789',
            type: 'AI_AGENT',
            addresses: [{ channel: 'CHAT', address: 'custom-agent@example.com', channelId: 'CHSIDabc' }],
          },
        ],
      });

      mockAdapter.onPost(/\/Actions$/).reply(202, {
        id: 'ACTchat2',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'CHchatfrom1',
        createdAt: '2024-01-01T00:00:00Z',
      });

      const result = await channel.initiateOutboundConversation({
        to: 'customer@example.com',
        from: 'custom-agent@example.com',
        channelId: 'CHSIDabc',
        message: 'Hello from custom agent',
      });

      expect(result.session.metadata?.fromAddress).toBe('custom-agent@example.com');
    });

    it('should reuse existing conversation on 409 (group-by dedup)', async () => {
      mockAdapter.onPost(/\/v2\/Conversations$/).replyOnce(
        409,
        {
          code: 400,
          message: 'Address mapping already exists on conversation conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf.',
          more_info: 'https://www.twilio.com/docs/errors/400',
          status: 409,
        },
        { 'x-conflicting-resource-id': 'conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf' }
      );

      mockAdapter
        .onGet(/\/conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf\/Participants$/)
        .replyOnce(200, {
          participants: [
            {
              id: 'PAchatcust_reuse',
              conversationId: 'conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf',
              accountId: 'ACtest123456789',
              type: 'CUSTOMER',
              addresses: [
                { channel: 'CHAT', address: 'customer@example.com', channelId: 'CHSIDabc' },
              ],
            },
            {
              id: 'PAchatagent_reuse',
              conversationId: 'conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf',
              accountId: 'ACtest123456789',
              type: 'AI_AGENT',
              addresses: [
                { channel: 'CHAT', address: 'ai-assistant', channelId: 'CHSIDabc' },
              ],
            },
          ],
        });

      mockAdapter.onPost(/\/Actions$/).replyOnce(202, {
        id: 'ACT_chat_reuse',
        type: 'SEND_MESSAGE',
        status: 'PENDING',
        conversationId: 'conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf',
        createdAt: '2024-01-01T00:00:00Z',
      });

      const result = await channel.initiateOutboundConversation({
        to: 'customer@example.com',
        channelId: 'CHSIDabc',
        message: 'Hello again via chat',
      });

      expect(result.conversationId).toBe('conv_conversation_01kpzdadp0eh0a6sg7rhe8vdpf');
      expect(result.session.metadata?.direction).toBe('outbound');
      expect(result.session.metadata?.channelId).toBe('CHSIDabc');
    });

    it('should validate channelId is required', async () => {
      await expect(
        channel.initiateOutboundConversation({
          to: 'customer@example.com',
          channelId: '',
          message: 'Hello',
        })
      ).rejects.toThrow();
    });
  });

  describe('VoiceChannel lazy init customer identification', () => {
    const createMockWebSocket = () => {
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1,
        _handlers: handlers,
        _emit(event: string, ...args: unknown[]) {
          for (const h of handlers[event] || []) h(...args);
        },
      };
    };

    it('should use CUSTOMER participant address for authorInfo on outbound calls', async () => {
      const tac = await createTestTAC(getTestConfig());
      const channel = new VoiceChannel(tac);
      const mockAdapter = new MockAdapter(
        (tac.getConversationClient() as any).axiosInstance
      );

      // Mock listConversations and listParticipants for lazy init
      mockAdapter.onGet(/\/v2\/Conversations$/).reply(200, {
        conversations: [{ id: 'CHoutbound_lazy1', accountId: 'ACtest123456789', status: 'ACTIVE' }],
      });
      mockAdapter.onGet(/\/Participants/).reply(200, {
        participants: [
          {
            id: 'PAcust1',
            conversationId: 'CHoutbound_lazy1',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            profileId: 'PFcust1',
            addresses: [{ channel: 'VOICE', address: '+15559876543' }],
          },
        ],
      });

      const mockWs = createMockWebSocket();
      channel.handleWebSocketConnection(mockWs as never);

      // Send setup message (outbound call — 'from' is the Twilio number)
      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'setup',
            sessionId: 'sess_outbound',
            callSid: 'CA_outbound_lazy',
            from: '+15551234567',
            to: '+15559876543',
            direction: 'outbound-api',
            callType: 'PSTN',
            callStatus: 'ringing',
            accountSid: 'ACtest123456789',
          })
        )
      );

      // Send prompt to trigger lazy init
      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'prompt',
            voicePrompt: 'Hello',
            lang: 'en-US',
            last: true,
          })
        )
      );

      // Wait for async lazy init to complete
      await vi.waitFor(() => {
        expect(channel.isConversationActive('CHoutbound_lazy1')).toBe(true);
      });

      const session = channel.getConversationSession('CHoutbound_lazy1');
      expect(session).toBeDefined();
      expect(session!.authorInfo?.address).toBe('+15559876543');

      mockAdapter.restore();
    });

    it('should fall back to from for authorInfo on inbound calls', async () => {
      const tac = await createTestTAC(getTestConfig());
      const channel = new VoiceChannel(tac);
      const mockAdapter = new MockAdapter(
        (tac.getConversationClient() as any).axiosInstance
      );

      // Mock listConversations and listParticipants for lazy init
      mockAdapter.onGet(/\/v2\/Conversations$/).reply(200, {
        conversations: [{ id: 'CHinbound_lazy1', accountId: 'ACtest123456789', status: 'ACTIVE' }],
      });
      mockAdapter.onGet(/\/Participants/).reply(200, {
        participants: [
          {
            id: 'PAcust2',
            conversationId: 'CHinbound_lazy1',
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            profileId: 'PFcust2',
            addresses: [{ channel: 'VOICE', address: '+15559876543' }],
          },
        ],
      });

      const mockWs = createMockWebSocket();
      channel.handleWebSocketConnection(mockWs as never);

      // Send setup message (inbound call — 'from' is the customer)
      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'setup',
            sessionId: 'sess_inbound',
            callSid: 'CA_inbound_lazy',
            from: '+15559876543',
            to: '+15551234567',
            direction: 'inbound',
            callType: 'PSTN',
            callStatus: 'ringing',
            accountSid: 'ACtest123456789',
          })
        )
      );

      // Send prompt to trigger lazy init
      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'prompt',
            voicePrompt: 'Hello',
            lang: 'en-US',
            last: true,
          })
        )
      );

      // Wait for async lazy init to complete
      await vi.waitFor(() => {
        expect(channel.isConversationActive('CHinbound_lazy1')).toBe(true);
      });

      const session = channel.getConversationSession('CHinbound_lazy1');
      expect(session).toBeDefined();
      expect(session!.authorInfo?.address).toBe('+15559876543');

      mockAdapter.restore();
    });
  });

  describe('VoiceChannel.initiateOutboundConversation', () => {
    let tac: TAC;
    let channel: VoiceChannel;

    beforeEach(async () => {
      tac = await createTestTAC(getTestConfig());
      channel = new VoiceChannel(tac);
    });

    it('should place call with TwiML containing conversationConfiguration', async () => {
      mockCallCreate.mockResolvedValue({ sid: 'CA123outbound' });

      const result = await channel.initiateOutboundConversation({
        to: '+15559876543',
        conversationRelayConfig: {
          url: 'wss://example.com/ws',
          welcomeGreeting: 'Hello, this is a call from our AI assistant.',
        },
      });

      expect(result.callSid).toBe('CA123outbound');

      // Verify Twilio call was created
      expect(mockCallCreate).toHaveBeenCalledWith({
        to: '+15559876543',
        from: '+15551234567',
        twiml: expect.stringContaining('ConversationRelay'),
      });

      // Verify TwiML contains conversationConfiguration
      const twiml = mockCallCreate.mock.calls[0]![0].twiml as string;
      expect(twiml).toContain('conversationConfiguration');
    });

    it('should throw when calls.create fails', async () => {
      mockCallCreate.mockRejectedValue(new Error('Call placement failed'));

      await expect(
        channel.initiateOutboundConversation({
          to: '+15559876543',
          conversationRelayConfig: { url: 'wss://example.com/ws' },
        })
      ).rejects.toThrow('Call placement failed');
    });

    it('should use custom from number when provided', async () => {
      mockCallCreate.mockResolvedValue({ sid: 'CA456outbound' });

      await channel.initiateOutboundConversation({
        to: '+15559876543',
        from: '+15550001111',
        conversationRelayConfig: {
          url: 'wss://example.com/ws',
        },
      });

      expect(mockCallCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '+15550001111',
        })
      );
    });

    it('should validate required options', async () => {
      await expect(
        channel.initiateOutboundConversation({
          to: '',
          conversationRelayConfig: { url: 'wss://example.com/ws' },
        })
      ).rejects.toThrow();
    });
  });
});
