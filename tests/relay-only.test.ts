import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TAC, TACConfig, VoiceChannel, SMSChannel, ChatChannel } from '@twilio/tac-core';

const getRelayOnlyConfigData = () => ({
  accountSid: 'ACtest123456789',
  authToken: 'test_token_123',
  apiKey: 'SKtest123456789',
  apiSecret: 'test_api_secret_123',
  phoneNumber: '+15551234567',
  voicePublicDomain: 'example.com',
});

const getOrchestratedConfigData = () => ({
  ...getRelayOnlyConfigData(),
  conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
});

describe('Relay-Only Mode', () => {
  describe('TACConfig', () => {
    it('should create config without conversationConfigurationId', () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      expect(config.conversationConfigurationId).toBeUndefined();
      expect(config.apiKey).toBe('SKtest123456789');
      expect(config.apiSecret).toBe('test_api_secret_123');
    });

    it('isOrchestratorEnabled() returns false in relay-only mode', () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      expect(config.isOrchestratorEnabled()).toBe(false);
    });

    it('isOrchestratorEnabled() returns true when conversationConfigurationId is set', () => {
      const config = new TACConfig(getOrchestratedConfigData());
      expect(config.isOrchestratorEnabled()).toBe(true);
    });

    it('should throw when apiKey is missing', () => {
      const { apiKey: _, ...withoutApiKey } = getRelayOnlyConfigData();
      expect(() => {
        new TACConfig(withoutApiKey as any);
      }).toThrow();
    });

    it('should throw when apiSecret is missing', () => {
      const { apiSecret: _, ...withoutApiSecret } = getRelayOnlyConfigData();
      expect(() => {
        new TACConfig(withoutApiSecret as any);
      }).toThrow();
    });
  });

  describe('TAC initialization', () => {
    it('should initialize without conversationConfigurationId', async () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      const tac = await TAC.create({ config });

      expect(tac.isOrchestratorEnabled()).toBe(false);
    });

    it('getConversationClient() returns null in relay-only mode', async () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      const tac = await TAC.create({ config });

      expect(tac.getConversationClient()).toBeNull();
    });

    it('getMemoryClient() returns null in relay-only mode', async () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      const tac = await TAC.create({ config });

      expect(tac.getMemoryClient()).toBeNull();
    });

    it('getKnowledgeClient() returns null in relay-only mode', async () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      const tac = await TAC.create({ config });

      expect(tac.getKnowledgeClient()).toBeNull();
    });

    it('getMemoryStoreId() returns undefined in relay-only mode', async () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      const tac = await TAC.create({ config });

      expect(tac.getMemoryStoreId()).toBeUndefined();
    });

    it('retrieveMemory() returns empty response in relay-only mode', async () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      const tac = await TAC.create({ config });

      const memory = await tac.retrieveMemory({
        conversationId: 'CA123',
        channel: 'voice',
        startedAt: new Date(),
        metadata: {},
      });

      expect(memory).toBeDefined();
      expect(memory.hasMemoryFeatures).toBe(false);
    });
  });

  describe('Channel registration', () => {
    it('VoiceChannel can be constructed in relay-only mode', async () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      const tac = await TAC.create({ config });

      const voiceChannel = new VoiceChannel(tac);
      expect(voiceChannel.channelType).toBe('voice');
    });

    it('SMSChannel throws in voice-only mode', async () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      const tac = await TAC.create({ config });

      expect(() => new SMSChannel(tac)).toThrow(
        'Messaging channels require conversationConfigurationId'
      );
    });

    it('ChatChannel throws in voice-only mode', async () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      const tac = await TAC.create({ config });

      expect(() => new ChatChannel(tac)).toThrow(
        'Messaging channels require conversationConfigurationId'
      );
    });
  });

  describe('Voice channel relay-only behavior', () => {
    let tac: TAC;
    let voiceChannel: VoiceChannel;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createMockWebSocket = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handlers: Record<string, ((...args: any[]) => void)[]> = {};
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1,
        _handlers: handlers,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _emit(event: string, ...args: any[]) {
          for (const h of handlers[event] || []) {
            h(...args);
          }
        },
      };
    };

    const setupMessage = (callSid: string) =>
      JSON.stringify({
        type: 'setup',
        sessionId: `sess_${callSid}`,
        callSid,
        from: '+15551112222',
        to: '+15553334444',
        direction: 'inbound',
        callType: 'call',
        callStatus: 'ringing',
        accountSid: 'ACtest123456789',
      });

    const promptMessage = JSON.stringify({ type: 'prompt', voicePrompt: 'Hello' });

    beforeEach(async () => {
      const config = new TACConfig(getRelayOnlyConfigData());
      tac = await TAC.create({ config });
      voiceChannel = new VoiceChannel(tac);
      tac.registerChannel(voiceChannel);
    });

    it('uses callSid as conversationId on first prompt', async () => {
      const connected = new Promise<void>(resolve => {
        voiceChannel.on('webSocketConnected', () => resolve());
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockWs = createMockWebSocket() as any;
      voiceChannel.handleWebSocketConnection(mockWs);

      mockWs._emit('message', Buffer.from(setupMessage('CA_relay_test_123')));
      mockWs._emit('message', Buffer.from(promptMessage));

      await connected;

      const session = voiceChannel.getConversationSession('CA_relay_test_123');
      expect(session).toBeDefined();
      expect(session?.conversationId).toBe('CA_relay_test_123');
      expect(session?.authorInfo?.address).toBe('+15551112222');
    });

    it('TwiML omits conversationConfiguration in relay-only mode', async () => {
      const channel = new VoiceChannel(tac, {
        defaultTwimlOptions: { welcomeGreeting: 'Hello!' },
      });

      const twiml = await channel.handleIncomingCall();

      expect(twiml).not.toContain('conversationConfiguration');
      expect(twiml).toContain('wss://example.com/ws');
      expect(twiml).toContain('Hello!');
    });

    it('handleConversationRelayCallback ends session on completed status', async () => {
      const connected = new Promise<void>(resolve => {
        voiceChannel.on('webSocketConnected', () => resolve());
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockWs = createMockWebSocket() as any;
      voiceChannel.handleWebSocketConnection(mockWs);

      mockWs._emit('message', Buffer.from(setupMessage('CA_cb_relay')));
      mockWs._emit('message', Buffer.from(promptMessage));
      await connected;

      expect(voiceChannel.getConversationSession('CA_cb_relay')).toBeDefined();

      await voiceChannel.handleConversationRelayCallback({
        CallSid: 'CA_cb_relay',
        CallStatus: 'completed',
        AccountSid: 'ACtest123456789',
        From: '+15551112222',
        To: '+15553334444',
        Direction: 'inbound',
      });

      expect(voiceChannel.getConversationSession('CA_cb_relay')).toBeUndefined();
    });

    it('handleConversationRelayCallback rejects mismatched AccountSid', async () => {
      const connected = new Promise<void>(resolve => {
        voiceChannel.on('webSocketConnected', () => resolve());
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockWs = createMockWebSocket() as any;
      voiceChannel.handleWebSocketConnection(mockWs);

      mockWs._emit('message', Buffer.from(setupMessage('CA_bad_acct')));
      mockWs._emit('message', Buffer.from(promptMessage));
      await connected;

      const result = await voiceChannel.handleConversationRelayCallback({
        CallSid: 'CA_bad_acct',
        CallStatus: 'completed',
        AccountSid: 'AC_wrong_account',
        From: '+15551112222',
        To: '+15553334444',
        Direction: 'inbound',
      });

      expect(result.status).toBe(403);
      expect(voiceChannel.getConversationSession('CA_bad_acct')).toBeDefined();
    });

    it('handleConversationRelayCallback ignores non-completed status', async () => {
      const connected = new Promise<void>(resolve => {
        voiceChannel.on('webSocketConnected', () => resolve());
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockWs = createMockWebSocket() as any;
      voiceChannel.handleWebSocketConnection(mockWs);

      mockWs._emit('message', Buffer.from(setupMessage('CA_inprog')));
      mockWs._emit('message', Buffer.from(promptMessage));
      await connected;

      await voiceChannel.handleConversationRelayCallback({
        CallSid: 'CA_inprog',
        CallStatus: 'in-progress',
        AccountSid: 'ACtest123456789',
        From: '+15551112222',
        To: '+15553334444',
        Direction: 'inbound',
      });

      expect(voiceChannel.getConversationSession('CA_inprog')).toBeDefined();
    });

    it('onConversationEnded callback fires on relay callback cleanup', async () => {
      const ended = new Promise<void>(resolve => {
        tac.onConversationEnded(() => resolve());
      });

      const connected = new Promise<void>(resolve => {
        voiceChannel.on('webSocketConnected', () => resolve());
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockWs = createMockWebSocket() as any;
      voiceChannel.handleWebSocketConnection(mockWs);

      mockWs._emit('message', Buffer.from(setupMessage('CA_ended')));
      mockWs._emit('message', Buffer.from(promptMessage));
      await connected;

      await voiceChannel.handleConversationRelayCallback({
        CallSid: 'CA_ended',
        CallStatus: 'completed',
        AccountSid: 'ACtest123456789',
        From: '+15551112222',
        To: '+15553334444',
        Direction: 'inbound',
      });

      await ended;
    });
  });
});
