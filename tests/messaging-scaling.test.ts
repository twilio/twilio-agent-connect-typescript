import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import {
  ChatChannel,
  ConversationAddress,
  ConversationClient,
  RCSChannel,
  SMSChannel,
  TAC,
  WhatsAppChannel,
  conversationMetadata,
} from '@twilio/tac-core';
import type {
  ConversationId,
  ConversationParticipant,
  ConversationSession,
  ConversationResponse,
  SendMessageActionRequest,
} from '@twilio/tac-core';
import { createSendMessageTool } from '@twilio/tac-tools';
import { createTestTAC } from './helpers/tac';
import { _resetAnalytics } from '../packages/core/src/lib/analytics';

const mockTrack = vi.fn();

vi.mock('@segment/analytics-node', () => ({
  Analytics: class MockAnalytics {
    track = mockTrack;
    closeAndFlush = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
  },
}));

/**
 * Messaging behaviour that horizontal scaling depends on.
 *
 * Messaging is request/response: any replica can serve any webhook, because a
 * channel derives its session per request and stores nothing. These tests pin
 * the three things that make that true — no residual state, cross-instance
 * `onConversationEnded`, and an API-call budget that doesn't quietly grow to
 * compensate.
 */

const CONFIGURATION_ID = 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd';
const AGENT_NUMBER = '+15551234567';
const CUSTOMER_NUMBER = '+12345678901';
const CONV_ID = 'CH123' as ConversationId;

const getTestConfig = (overrides: Record<string, unknown> = {}) => ({
  accountSid: 'ACtest123',
  authToken: 'test_token_123',
  apiKey: 'SK123',
  apiSecret: 'test_api_token',
  conversationConfigurationId: CONFIGURATION_ID,
  phoneNumber: AGENT_NUMBER,
  ...overrides,
});

type Channel = 'SMS' | 'CHAT' | 'RCS' | 'WHATSAPP';

const participant = (
  id: string,
  type: string,
  address: string,
  opts: { convId?: string; channel?: Channel; profileId?: string; channelId?: string } = {}
): ConversationParticipant => ({
  id,
  conversationId: opts.convId ?? CONV_ID,
  accountId: 'ACtest123',
  name: address,
  type: type as ConversationParticipant['type'],
  ...(opts.profileId ? { profileId: opts.profileId } : {}),
  addresses: [
    {
      channel: opts.channel ?? 'SMS',
      address,
      ...(opts.channelId ? { channelId: opts.channelId } : {}),
    },
  ],
});

/** Both sides correctly typed — reconciliation's happy-path row. */
const healthyParticipants = (convId: string = CONV_ID, profileId?: string) => [
  participant('PA_AGENT', 'AI_AGENT', AGENT_NUMBER, { convId }),
  participant('PA_CUSTOMER', 'CUSTOMER', CUSTOMER_NUMBER, {
    convId,
    ...(profileId ? { profileId } : {}),
  }),
];

const inbound = (
  opts: {
    convId?: string;
    text?: string;
    authorAddress?: string;
    authorParticipantId?: string;
    commId?: string;
    channel?: Channel;
    channelId?: string;
  } = {}
) => ({
  eventType: 'COMMUNICATION_CREATED',
  data: {
    id: opts.commId ?? 'comms_communication_01',
    conversationId: opts.convId ?? CONV_ID,
    accountId: 'ACtest123',
    author: {
      address: opts.authorAddress ?? CUSTOMER_NUMBER,
      channel: opts.channel ?? 'SMS',
      participantId: opts.authorParticipantId ?? 'PA_CUSTOMER',
    },
    content: { type: 'TEXT', text: opts.text ?? 'hello' },
    recipients: [],
    createdAt: '2026-04-27T00:00:00Z',
    ...(opts.channelId ? { channelId: opts.channelId } : {}),
  },
});

const closed = (
  opts: {
    convId?: string;
    metadata?: Record<string, unknown>;
    extra?: Record<string, unknown>;
  } = {}
) => ({
  eventType: 'CONVERSATION_UPDATED',
  data: {
    id: opts.convId ?? CONV_ID,
    accountId: 'ACtest123',
    configurationId: CONFIGURATION_ID,
    status: 'CLOSED',
    ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
    ...(opts.extra ?? {}),
  },
});

/** Let fire-and-forget handlers (messageReceived → onMessageReady → send) finish. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

/** Process a webhook and wait for its async callbacks. */
const deliver = async (
  channel: { processWebhook: (p: unknown) => Promise<void> },
  payload: unknown
): Promise<void> => {
  await channel.processWebhook(payload);
  await settle();
};

const sendOutbound = (channel: SMSChannel, metadata?: Record<string, unknown>) =>
  channel.initiateOutboundConversation({
    to: CUSTOMER_NUMBER,
    message: 'Reminder',
    ...(metadata !== undefined ? { metadata } : {}),
  });

type Impl = (...args: never[]) => unknown;

/** Counts every Conversation Orchestrator / Memory call a webhook makes. */
class CallCounter {
  public readonly calls: string[] = [];
  public coMetadata: Record<string, string> = {};
  public readonly mocks: Record<string, ReturnType<typeof vi.fn>> = {};

  constructor(tac: TAC, profileId?: string) {
    const co = tac.getConversationClient() as ConversationClient;
    this.install(co, 'listParticipants', (convId: string) =>
      healthyParticipants(convId, profileId)
    );
    this.install(co, 'createAction', () => ({}));
    this.install(co, 'updateParticipant', () => ({}));
    this.install(co, 'addParticipant', () => ({}));
    this.install(co, 'listCommunications', () => []);
    this.install(co, 'updateConversation', () => ({}));
    this.install(co, 'createOrReuseConversation', () => ({
      conversation: { id: CONV_ID },
      reused: false,
    }));
    this.install(
      co,
      'getConversation',
      (convId: string): ConversationResponse => ({
        id: convId,
        accountId: 'ACtest123',
        metadata: { ...this.coMetadata },
      })
    );
    this.install(
      co,
      'patchConversationMetadata',
      (convId: string, metadata: Record<string, string>): ConversationResponse => ({
        id: convId,
        accountId: 'ACtest123',
        metadata: { ...this.coMetadata, ...metadata },
      })
    );

    const memory = tac.getMemoryClient();
    if (memory) {
      this.install(memory, 'retrieveMemories', () => ({
        observations: [],
        summaries: [],
        communications: [],
        meta: { queryTime: 0 },
      }));
      this.install(memory, 'getProfile', () => ({ id: 'profile_1' }));
      this.install(memory, 'lookupProfile', () => ({
        normalizedValue: CUSTOMER_NUMBER,
        profiles: ['profile_1'],
      }));
    }
  }

  public install(client: object, name: string, impl: Impl): void {
    const fn = vi.fn(async (...args: never[]) => {
      this.calls.push(name);
      return impl(...args);
    });
    (client as Record<string, unknown>)[name] = fn;
    this.mocks[name] = fn;
  }

  /** Replace a method with one that counts and then rejects. */
  public fail(client: object, name: string, error: unknown): void {
    this.install(client, name, () => {
      throw error;
    });
  }

  public count(name: string): number {
    return this.calls.filter(c => c === name).length;
  }

  public clear(): void {
    this.calls.length = 0;
  }
}

const coOf = (tac: TAC): ConversationClient => tac.getConversationClient() as ConversationClient;

const makeSmsChannel = async (
  opts: { mode?: 'never' | 'always' | 'once'; profileId?: string } = {}
): Promise<{ tac: TAC; channel: SMSChannel; counter: CallCounter }> => {
  const tac = await createTestTAC(getTestConfig());
  const channel = new SMSChannel(tac, { memoryMode: opts.mode ?? 'never' });
  tac.registerChannel(channel);
  return { tac, channel, counter: new CallCounter(tac, opts.profileId) };
};

const loggerOf = (channel: object) =>
  (channel as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger;

const lastActionRequest = (counter: CallCounter): SendMessageActionRequest => {
  const calls = counter.mocks.createAction!.mock.calls;
  return calls[calls.length - 1]![1] as unknown as SendMessageActionRequest;
};

describe('Messaging horizontal scaling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('nothing is stored', () => {
    it('channel has no session store at all', async () => {
      const tac = await createTestTAC(getTestConfig());
      const channel = new SMSChannel(tac);

      // The regression guard: if this field comes back, so does the leak.
      expect('activeConversations' in channel).toBe(false);
    });

    it('inbound leaves no residue', async () => {
      const { tac, channel } = await makeSmsChannel();
      const sessions: ConversationSession[] = [];
      tac.onMessageReady(({ session }) => {
        sessions.push(session);
      });

      await deliver(channel, inbound());

      expect(sessions).toHaveLength(1);
      expect('activeConversations' in channel).toBe(false);
    });
  });

  describe('two instances', () => {
    // A and B share nothing but configuration — which is the point.

    it('CLOSED fires on the instance that never saw the message', async () => {
      const tacA = await createTestTAC(getTestConfig());
      const tacB = await createTestTAC(getTestConfig());
      const instanceA = new SMSChannel(tacA);
      const instanceB = new SMSChannel(tacB);
      tacA.registerChannel(instanceA);
      tacB.registerChannel(instanceB);
      new CallCounter(tacA);
      new CallCounter(tacB);

      const ended: ConversationSession[] = [];
      tacB.onConversationEnded(({ session }) => {
        ended.push(session);
      });

      // The message is handled by A.
      tacA.onMessageReady(() => undefined);
      await deliver(instanceA, inbound());

      // CLOSED is delivered to B.
      await deliver(instanceB, closed());

      expect(ended).toHaveLength(1);
      expect(ended[0]!.conversationId).toBe(CONV_ID);
      expect(ended[0]!.channel).toBe('sms');
      expect(ended[0]!.authorInfo?.address).toBe(CUSTOMER_NUMBER);
      expect(ended[0]!.aiAgentInfo?.participantId).toBe('PA_AGENT');
    });

    it('CLOSED fires a handler set on the channel after registering it', async () => {
      const { channel } = await makeSmsChannel();
      const ended: ConversationSession[] = [];
      channel.on('conversationEnded', ({ session }: { session: ConversationSession }) => {
        ended.push(session);
      });

      await deliver(channel, closed());

      expect(ended.map(s => s.conversationId)).toEqual([CONV_ID]);
    });

    it('a CHAT close does not fire on the SMS channel', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.install(coOf(tac), 'listParticipants', () => [
        participant('PA_U', 'CUSTOMER', 'user-1', { channel: 'CHAT' }),
      ]);
      const ended: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        ended.push(session);
      });

      await deliver(channel, closed());

      expect(ended).toEqual([]);
    });

    it('a CLOSED for another configuration is ignored without any call', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      const ended: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        ended.push(session);
      });

      await deliver(
        channel,
        closed({ extra: { configurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nzzz' } })
      );

      expect(ended).toEqual([]);
      expect(counter.calls).toEqual([]);
    });

    it('reply works from a session alone', async () => {
      // The session onMessageReady receives is enough to reply with — no
      // channel state, so a reply from any replica behaves identically.
      const { tac, channel, counter } = await makeSmsChannel();
      const sessions: ConversationSession[] = [];
      tac.onMessageReady(({ session }) => {
        sessions.push(session);
      });

      await deliver(channel, inbound());
      counter.clear();

      await channel.sendResponse(sessions[0]!, 'hi back');

      expect(counter.calls).toEqual(['createAction']);
    });

    it('sendResponse accepts a bare id (one lookup) or a session (none)', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      const sessions: ConversationSession[] = [];
      tac.onMessageReady(({ session }) => {
        sessions.push(session);
      });
      await deliver(channel, inbound());
      counter.clear();

      await channel.sendResponse(CONV_ID, 'by id');
      await channel.sendResponse(sessions[0]!, 'by session');

      expect(counter.calls).toEqual(['listParticipants', 'createAction', 'createAction']);
      // The id-rebuilt session addresses the same participants.
      const byId = counter.mocks.createAction!.mock
        .calls[0]![1] as unknown as SendMessageActionRequest;
      expect(byId.payload.from.participantId).toBe('PA_AGENT');
      expect(byId.payload.to[0]!.participantId).toBe('PA_CUSTOMER');
    });

    it('sendResponse by id throws when no participant is on this channel', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.install(coOf(tac), 'listParticipants', () => [
        participant('PA_U', 'CUSTOMER', 'user-1', { channel: 'CHAT' }),
      ]);

      await expect(channel.sendResponse(CONV_ID, 'hi')).rejects.toThrow(/no recipient resolved/);
      expect(counter.count('createAction')).toBe(0);
    });

    it('sendResponse by id throws when participants cannot be read', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.fail(coOf(tac), 'listParticipants', new Error('CO unavailable'));

      await expect(channel.sendResponse(CONV_ID, 'hi')).rejects.toThrow(
        /could not read participants/
      );
    });
  });

  describe('getAgentAddress compatibility', () => {
    // getAgentAddress(conversationId) keeps its signature, for both callers
    // and subclasses that override it.

    class RecordingSMSChannel extends SMSChannel {
      public readonly requested: string[] = [];

      protected override getAgentAddress(conversationId: ConversationId): ConversationAddress {
        this.requested.push(conversationId);
        return { channel: 'SMS', address: AGENT_NUMBER };
      }
    }

    const agentAddressOf = (channel: object, id: string): ConversationAddress =>
      (
        channel as unknown as { getAgentAddress: (id: string) => ConversationAddress }
      ).getAgentAddress(id);

    it('an override of the old signature gets conversation ids', async () => {
      const tac = await createTestTAC(getTestConfig());
      const channel = new RecordingSMSChannel(tac);
      tac.registerChannel(channel);
      tac.onMessageReady(() => 'reply');
      const counter = new CallCounter(tac);
      // Customer-only: reconciliation needs the agent address to add TAC.
      counter.install(coOf(tac), 'listParticipants', () => [
        participant('PA_CUSTOMER', 'CUSTOMER', CUSTOMER_NUMBER),
      ]);
      counter.install(coOf(tac), 'addParticipant', () =>
        participant('PA_AGENT', 'AI_AGENT', AGENT_NUMBER)
      );

      await deliver(channel, inbound());

      expect(channel.requested.length).toBeGreaterThan(0);
      expect(channel.requested.every(r => r === CONV_ID)).toBe(true);
      expect(counter.count('createAction')).toBe(1);
    });

    it.each([
      ['SMSChannel', SMSChannel, { channel: 'SMS', address: AGENT_NUMBER }],
      ['RCSChannel', RCSChannel, { channel: 'RCS', address: 'rcs:rcs_sender' }],
      [
        'WhatsAppChannel',
        WhatsAppChannel,
        { channel: 'WHATSAPP', address: 'whatsapp:+15559876543' },
      ],
      ['ChatChannel', ChatChannel, { channel: 'CHAT', address: 'ai-assistant' }],
    ] as const)('%s answers by conversation id', async (_name, ChannelType, expected) => {
      const tac = await createTestTAC(
        getTestConfig({ rcsSenderId: 'rcs:rcs_sender', whatsappNumber: 'whatsapp:+15559876543' })
      );

      expect(agentAddressOf(new ChannelType(tac), CONV_ID)).toEqual(expected);
    });

    it('chat by id keeps no channelId between turns', async () => {
      const tac = await createTestTAC(getTestConfig());
      const channel = new ChatChannel(tac);
      tac.registerChannel(channel);
      tac.onMessageReady(() => undefined);
      const counter = new CallCounter(tac);
      counter.install(coOf(tac), 'listParticipants', () => [
        participant('PA_AGENT', 'AI_AGENT', 'ai-assistant', { channel: 'CHAT' }),
        participant('PA_USER', 'CUSTOMER', 'user@example.com', { channel: 'CHAT' }),
      ]);

      await deliver(
        channel,
        inbound({
          authorAddress: 'user@example.com',
          authorParticipantId: 'PA_USER',
          channel: 'CHAT',
          channelId: 'CH_CHAT_SID',
        })
      );

      expect(agentAddressOf(channel, CONV_ID).channelId).toBeUndefined();
    });

    it('chat by bare id recovers channelId from its participants', async () => {
      const tac = await createTestTAC(getTestConfig());
      const channel = new ChatChannel(tac);
      tac.registerChannel(channel);
      const counter = new CallCounter(tac);
      counter.install(coOf(tac), 'listParticipants', () => [
        participant('PA_AGENT', 'AI_AGENT', 'ai-assistant', {
          channel: 'CHAT',
          channelId: 'CH_CHAT_SID',
        }),
        participant('PA_USER', 'CUSTOMER', 'user@example.com', {
          channel: 'CHAT',
          channelId: 'CH_CHAT_SID',
        }),
      ]);

      await channel.sendResponse(CONV_ID, 'hi');

      const request = lastActionRequest(counter);
      expect(request.payload.to[0]!.participantId).toBe('PA_USER');
      expect(request.payload.channelSettings?.channelId).toBe('CH_CHAT_SID');
    });

    it('chat by bare id without a recorded channelId throws', async () => {
      const tac = await createTestTAC(getTestConfig());
      const channel = new ChatChannel(tac);
      tac.registerChannel(channel);
      const counter = new CallCounter(tac);
      counter.install(coOf(tac), 'listParticipants', () => [
        participant('PA_AGENT', 'AI_AGENT', 'ai-assistant', { channel: 'CHAT' }),
        participant('PA_USER', 'CUSTOMER', 'user@example.com', { channel: 'CHAT' }),
      ]);

      await expect(channel.sendResponse(CONV_ID, 'hi')).rejects.toThrow(/channelId/);
      expect(counter.count('createAction')).toBe(0);
    });
  });

  describe('participant lookup failure', () => {
    // A failed participant lookup drops the turn, on every instance alike:
    // nothing from an earlier turn stands in for the participants.

    it('the turn is dropped with an error', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      const handled: string[] = [];
      const errors: Array<Record<string, unknown> | undefined> = [];
      tac.onMessageReady(({ message }) => {
        handled.push(message);
      });
      channel.on('error', ({ context }: { context?: Record<string, unknown> }) => {
        errors.push(context);
      });
      counter.fail(coOf(tac), 'listParticipants', new Error('CO unavailable'));

      await deliver(channel, inbound());

      expect(handled).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.dropped_inbound).toBe(true);
    });

    it('a later turn on the same instance is dropped too', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      const handled: string[] = [];
      const errors: Array<Record<string, unknown> | undefined> = [];
      tac.onMessageReady(({ message }) => {
        handled.push(message);
        return 'reply';
      });
      channel.on('error', ({ context }: { context?: Record<string, unknown> }) => {
        errors.push(context);
      });
      await deliver(channel, inbound({ commId: 'comms_1' }));

      counter.fail(coOf(tac), 'listParticipants', new Error('CO unavailable'));
      counter.clear();
      await deliver(channel, inbound({ commId: 'comms_2' }));

      expect(handled).toEqual(['hello']);
      expect(counter.calls).toEqual(['listParticipants']);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.dropped_inbound).toBe(true);
    });
  });

  describe('reply recipient', () => {
    it('reply goes to the reconciled customer, not the author', async () => {
      // A non-customer can author an inbound message. The reply still goes to
      // the customer — the author's participant id is not the recipient.
      const { tac, channel, counter } = await makeSmsChannel();
      tac.onMessageReady(() => 'reply');
      counter.install(coOf(tac), 'listParticipants', () => [
        participant('PA_AGENT', 'AI_AGENT', AGENT_NUMBER),
        participant('PA_CUSTOMER', 'CUSTOMER', CUSTOMER_NUMBER),
        participant('PA_HUMAN', 'HUMAN_AGENT', '+15557778888'),
      ]);

      await deliver(
        channel,
        inbound({ authorAddress: '+15557778888', authorParticipantId: 'PA_HUMAN' })
      );

      expect(lastActionRequest(counter).payload.to[0]!.participantId).toBe('PA_CUSTOMER');
    });

    it('chat replies to the author', async () => {
      // Chat disables customer reconciliation deliberately — its identities
      // are opaque, so promoting some other UNKNOWN could pick the wrong thread.
      const tac = await createTestTAC(getTestConfig());
      const channel = new ChatChannel(tac);
      tac.registerChannel(channel);
      tac.onMessageReady(() => 'reply');
      const counter = new CallCounter(tac);
      counter.install(coOf(tac), 'listParticipants', () => [
        participant('PA_AGENT', 'AI_AGENT', 'ai-assistant', { channel: 'CHAT' }),
        participant('PA_USER', 'CUSTOMER', 'user@example.com', { channel: 'CHAT' }),
        participant('PA_OTHER', 'UNKNOWN', 'someone-else', { channel: 'CHAT' }),
      ]);

      await deliver(
        channel,
        inbound({
          authorAddress: 'user@example.com',
          authorParticipantId: 'PA_USER',
          channel: 'CHAT',
          channelId: 'CH_CHAT_SID',
        })
      );

      const request = lastActionRequest(counter);
      expect(request.payload.to[0]!.participantId).toBe('PA_USER');
      expect(request.payload.channelSettings?.channelId).toBe('CH_CHAT_SID');
    });
  });

  describe('send-message tool', () => {
    // The tool sends with whatever it was built from, like Python's auto-send:
    // a session goes straight through, an id is rebuilt from participants.

    /** A chat the customer started: CO leaves the customer UNKNOWN on chat. */
    const unknownCustomerChat = async () => {
      const tac = await createTestTAC(getTestConfig());
      const channel = new ChatChannel(tac);
      tac.registerChannel(channel);
      const counter = new CallCounter(tac);
      counter.install(coOf(tac), 'listParticipants', () => [
        participant('PA_AGENT', 'AI_AGENT', 'ai-assistant', {
          channel: 'CHAT',
          channelId: 'CH_CHAT_SID',
        }),
        participant('PA_USER', 'UNKNOWN', 'user@example.com', {
          channel: 'CHAT',
          channelId: 'CH_CHAT_SID',
        }),
      ]);
      const sessions: ConversationSession[] = [];
      tac.onMessageReady(({ session }) => {
        sessions.push(session);
      });
      await deliver(
        channel,
        inbound({
          authorAddress: 'user@example.com',
          authorParticipantId: 'PA_USER',
          channel: 'CHAT',
          channelId: 'CH_CHAT_SID',
        })
      );
      expect(sessions).toHaveLength(1);
      counter.clear();
      return { channel, counter, session: sessions[0]! };
    };

    it('built from the session, it replies to an UNKNOWN chat customer without a lookup', async () => {
      const { channel, counter, session } = await unknownCustomerChat();

      const result = await createSendMessageTool(channel, session).implementation({
        message: 'hi',
      });

      expect(result.success).toBe(true);
      expect(counter.calls).toEqual(['createAction']);
      const request = lastActionRequest(counter);
      expect(request.payload.to[0]!.participantId).toBe('PA_USER');
      expect(request.payload.channelSettings?.channelId).toBe('CH_CHAT_SID');
    });

    it('built from a bare id, it resolves no UNKNOWN chat customer', async () => {
      const { channel, counter } = await unknownCustomerChat();

      const result = await createSendMessageTool(channel, CONV_ID).implementation({
        message: 'hi',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no recipient/i);
      expect(counter.count('createAction')).toBe(0);
    });

    it('built from the session it costs no lookup; from an id, one', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      const sessions: ConversationSession[] = [];
      tac.onMessageReady(({ session }) => {
        sessions.push(session);
      });
      await deliver(channel, inbound());
      counter.clear();

      await createSendMessageTool(channel, sessions[0]!).implementation({ message: 'a' });
      expect(counter.calls).toEqual(['createAction']);

      counter.clear();
      await createSendMessageTool(channel, CONV_ID).implementation({ message: 'b' });
      expect(counter.calls).toEqual(['listParticipants', 'createAction']);
    });
  });

  describe('API call budget', () => {
    // Statelessness must not be paid for with extra API calls. These counts
    // are the contract. If one moves, either the budget genuinely changed and
    // this test should be updated deliberately, or something started
    // re-fetching what it already had.

    it('memory "never" costs two calls', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      tac.onMessageReady(() => 'reply');

      await deliver(channel, inbound());

      expect(counter.calls).toEqual(['listParticipants', 'createAction']);
    });

    it("TAC's own echo costs nothing", async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      tac.onMessageReady(() => 'reply');

      await deliver(channel, inbound({ authorAddress: AGENT_NUMBER }));

      expect(counter.calls).toEqual([]);
    });

    it('an agent-authored message from another address is ignored after one lookup', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      const handled: string[] = [];
      tac.onMessageReady(({ message }) => {
        handled.push(message);
        return 'reply';
      });

      await deliver(
        channel,
        inbound({ authorAddress: '+15550000000', authorParticipantId: 'PA_AGENT' })
      );

      expect(handled).toEqual([]);
      expect(counter.calls).toEqual(['listParticipants']);
    });

    it('reconcile writes nothing when both sides are typed', async () => {
      // Reconciliation runs on every message; on the happy path it writes
      // nothing, which is what makes running it every time free.
      const { tac, channel, counter } = await makeSmsChannel();
      tac.onMessageReady(() => 'reply');

      for (let i = 0; i < 3; i++) {
        await deliver(channel, inbound({ commId: `comm_${i}` }));
      }

      expect(counter.count('updateParticipant')).toBe(0);
      expect(counter.count('addParticipant')).toBe(0);
      expect(counter.count('listParticipants')).toBe(3);
    });

    it('memory "always" costs three calls', async () => {
      // Python adds a get_profile trait fetch here; TS has no profile-trait
      // fetch, so the budget is one call lower.
      const { tac, channel, counter } = await makeSmsChannel({
        mode: 'always',
        profileId: 'profile_1',
      });
      tac.onMessageReady(() => 'reply');

      await deliver(channel, inbound());

      expect(counter.calls).toEqual(['listParticipants', 'retrieveMemories', 'createAction']);
    });

    it('profile id comes off the participant list', async () => {
      // No lookupProfile — the id is already in the response we fetched.
      const { tac, channel, counter } = await makeSmsChannel({
        mode: 'always',
        profileId: 'profile_1',
      });
      const sessions: ConversationSession[] = [];
      tac.onMessageReady(({ session }) => {
        sessions.push(session);
      });

      await deliver(channel, inbound());

      expect(counter.count('lookupProfile')).toBe(0);
      expect(counter.mocks.retrieveMemories!.mock.calls[0]![0]).toBe('profile_1');
      expect(sessions[0]!.profileId).toBe('profile_1');
    });

    it('CLOSED with no handler costs nothing', async () => {
      const { channel, counter } = await makeSmsChannel();

      await deliver(channel, closed());

      expect(counter.calls).toEqual([]);
    });

    it('CLOSED with a handler costs one call', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      tac.onConversationEnded(() => undefined);

      await deliver(channel, closed());

      expect(counter.calls).toEqual(['listParticipants']);
    });

    it('a non-CLOSED update costs nothing', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      const ended: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        ended.push(session);
      });

      await deliver(channel, closed({ extra: { status: 'INACTIVE' } }));

      expect(counter.calls).toEqual([]);
      expect(ended).toEqual([]);
    });

    it('CLOSED handed to several channels shares one participant lookup', async () => {
      const tac = await createTestTAC(getTestConfig({ whatsappNumber: 'whatsapp:+15559876543' }));
      const sms = new SMSChannel(tac);
      const whatsapp = new WhatsAppChannel(tac);
      tac.registerChannel(sms);
      tac.registerChannel(whatsapp);
      const counter = new CallCounter(tac);
      const ended: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        ended.push(session);
      });

      await Promise.all([sms.processWebhook(closed()), whatsapp.processWebhook(closed())]);
      await settle();

      expect(counter.count('listParticipants')).toBe(1);
      // Only the SMS channel owns this conversation.
      expect(ended).toHaveLength(1);
      expect(ended[0]!.channel).toBe('sms');
    });

    it('outbound create costs the creation calls only', async () => {
      const { channel, counter } = await makeSmsChannel();

      await sendOutbound(channel, { appointment_id: 'apt_42' });

      expect(counter.calls).toEqual([
        'createOrReuseConversation',
        'listParticipants',
        'createAction',
      ]);
    });

    it('outbound reuse adds one metadata patch', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.install(coOf(tac), 'createOrReuseConversation', () => ({
        conversation: { id: CONV_ID },
        reused: true,
      }));

      await sendOutbound(channel, { appointment_id: 'apt_42' });

      expect(counter.calls).toEqual([
        'createOrReuseConversation',
        'patchConversationMetadata',
        'listParticipants',
        'createAction',
      ]);
    });

    it('reading conversation metadata on another instance adds one fetch', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      tac.onMessageReady(async ({ session }) => {
        await conversationMetadata(session);
        return 'reply';
      });

      await deliver(channel, inbound());

      expect(counter.calls).toEqual(['listParticipants', 'getConversation', 'createAction']);
    });
  });

  describe('conversation metadata', () => {
    // Outbound metadata survives to later turns through
    // conversationMetadata(session), on any instance. session.metadata lasts
    // one turn: nothing carries over to the next webhook.

    it('outbound writes fitting metadata to CO at creation', async () => {
      const { channel, counter } = await makeSmsChannel();

      await sendOutbound(channel, { appointment_id: 'apt_42' });

      expect(counter.mocks.createOrReuseConversation!.mock.calls[0]![1]).toEqual({
        appointment_id: 'apt_42',
      });
      expect(counter.count('patchConversationMetadata')).toBe(0);
    });

    it('without metadata, creation sends none and nothing is patched', async () => {
      const { channel, counter } = await makeSmsChannel();

      const result = await sendOutbound(channel);

      expect(counter.mocks.createOrReuseConversation!.mock.calls[0]![1]).toBeUndefined();
      expect(result.session.metadata.direction).toBe('outbound');
      expect(await conversationMetadata(result.session)).toEqual({});
      expect(counter.count('patchConversationMetadata')).toBe(0);
      expect(counter.count('getConversation')).toBe(0);
    });

    it('without metadata, a reused conversation is not patched', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.coMetadata = { earlier: 'kept' };
      counter.install(coOf(tac), 'createOrReuseConversation', () => ({
        conversation: { id: CONV_ID },
        reused: true,
      }));

      const result = await sendOutbound(channel);

      expect(counter.count('patchConversationMetadata')).toBe(0);
      // What the reused conversation holds is unknown, so the accessor fetches.
      expect(await conversationMetadata(result.session)).toEqual({ earlier: 'kept' });
      expect(counter.count('getConversation')).toBe(1);
    });

    it('unfit entries are skipped with a warning but kept on the session', async () => {
      const { channel, counter } = await makeSmsChannel();
      const warn = vi.spyOn(loggerOf(channel), 'warn');

      const result = await sendOutbound(channel, { count: 3, ok: 'yes' });

      expect(counter.mocks.createOrReuseConversation!.mock.calls[0]![1]).toEqual({ ok: 'yes' });
      expect(result.session.metadata.count).toBe(3);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    const rejection = (): AxiosError =>
      new AxiosError(
        'Request failed with status code 400',
        'ERR_BAD_REQUEST',
        undefined,
        undefined,
        {
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          config: { headers: new AxiosHeaders() },
          data: {},
        }
      );

    it('a rejected creation names the metadata as a possible cause', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.fail(
        coOf(tac),
        'createOrReuseConversation',
        new Error('Failed to create conversation', { cause: rejection() })
      );
      const warn = vi.spyOn(loggerOf(channel), 'warn');

      await expect(sendOutbound(channel, { appointment_id: 'apt_secret' })).rejects.toThrow();

      expect(warn).toHaveBeenCalledTimes(1);
      const [fields, message] = warn.mock.calls[0]! as [Record<string, unknown>, string];
      expect(message).toContain('metadata');
      expect(fields.metadata_keys).toEqual(['appointment_id']);
      expect(JSON.stringify(warn.mock.calls[0])).not.toContain('apt_secret');
    });

    it('a rejected creation without metadata does not blame it', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.fail(
        coOf(tac),
        'createOrReuseConversation',
        new Error('Failed to create conversation', { cause: rejection() })
      );
      const warn = vi.spyOn(loggerOf(channel), 'warn');

      await expect(sendOutbound(channel)).rejects.toThrow();

      expect(warn).not.toHaveBeenCalled();
    });

    it('a reused conversation gets the metadata patched in', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.coMetadata = { earlier: 'kept' };
      counter.install(coOf(tac), 'createOrReuseConversation', () => ({
        conversation: { id: CONV_ID },
        reused: true,
      }));

      const result = await sendOutbound(channel, { appointment_id: 'apt_42' });

      expect(counter.count('patchConversationMetadata')).toBe(1);
      expect(await conversationMetadata(result.session)).toEqual({
        earlier: 'kept',
        appointment_id: 'apt_42',
      });
      expect(counter.count('getConversation')).toBe(0);
    });

    it('a failed patch on reuse does not fail the send', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.install(coOf(tac), 'createOrReuseConversation', () => ({
        conversation: { id: CONV_ID },
        reused: true,
      }));
      counter.fail(coOf(tac), 'patchConversationMetadata', new Error('CO down'));

      const result = await sendOutbound(channel, { appointment_id: 'apt_42' });

      expect(result.conversationId).toBe(CONV_ID);
      expect(result.session.metadata.appointment_id).toBe('apt_42');
      expect(counter.count('patchConversationMetadata')).toBe(1);
      // The failed PATCH left the CO metadata unknown, so the accessor fetches.
      counter.coMetadata = { earlier: 'kept' };
      expect(await conversationMetadata(result.session)).toEqual({ earlier: 'kept' });
      expect(counter.count('getConversation')).toBe(1);
    });

    it('a reply on the initiating instance reads metadata from CO', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.coMetadata = { appointment_id: 'apt_42' };
      const seen: ConversationSession[] = [];
      tac.onMessageReady(({ session }) => {
        seen.push(session);
      });

      await sendOutbound(channel, { appointment_id: 'apt_42' });
      await deliver(channel, inbound({ text: 'R' }));

      expect(seen[0]!.metadata.appointment_id).toBeUndefined();
      expect(seen[0]!.metadata.direction).toBeUndefined();
      expect(await conversationMetadata(seen[0]!)).toEqual({ appointment_id: 'apt_42' });
      expect(counter.count('getConversation')).toBe(1);
    });

    it('writes in one turn are not seen in the next', async () => {
      const { tac, channel } = await makeSmsChannel();
      const seen: Array<Record<string, unknown>> = [];
      tac.onMessageReady(({ session }) => {
        seen.push({ ...session.metadata });
        session.metadata.step = String(seen.length);
      });

      await deliver(channel, inbound({ text: 'one', commId: 'c1' }));
      await deliver(channel, inbound({ text: 'two', commId: 'c2' }));

      expect(seen).toHaveLength(2);
      expect(seen[0]!.step).toBeUndefined();
      expect(seen[1]!.step).toBeUndefined();
    });

    it('another instance reads metadata through the accessor, once per turn', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.coMetadata = { appointment_id: 'apt_42' };
      const seen: ConversationSession[] = [];
      tac.onMessageReady(({ session }) => {
        seen.push(session);
      });

      await deliver(channel, inbound({ text: 'R' }));

      expect(seen[0]!.metadata.appointment_id).toBeUndefined();
      const metadata = await conversationMetadata(seen[0]!);
      expect(metadata.appointment_id).toBe('apt_42');
      await conversationMetadata(seen[0]!);
      expect(counter.count('getConversation')).toBe(1);
    });

    it('a failed fetch returns empty without failing the turn, and is retried', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.fail(coOf(tac), 'getConversation', new Error('CO down'));
      const results: Array<Record<string, string>> = [];
      const counts: number[] = [];
      tac.onMessageReady(async ({ session }) => {
        results.push(await conversationMetadata(session));
        counts.push(counter.count('getConversation'));
        results.push(await conversationMetadata(session));
        counts.push(counter.count('getConversation'));
      });

      await deliver(channel, inbound());

      expect(results).toEqual([{}, {}]);
      // A failed lookup is retried on the next call.
      expect(counts).toEqual([1, 2]);
    });

    it('a fetched result is kept for the turn only', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.coMetadata = { appointment_id: 'apt_42' };
      const results: Array<Record<string, string>> = [];
      tac.onMessageReady(async ({ session }) => {
        results.push(await conversationMetadata(session));
      });

      await deliver(channel, inbound({ text: 'one', commId: 'c1' }));
      counter.coMetadata = { appointment_id: 'apt_43' };
      await deliver(channel, inbound({ text: 'two', commId: 'c2' }));

      expect(counter.count('getConversation')).toBe(2);
      expect(results).toEqual([{ appointment_id: 'apt_42' }, { appointment_id: 'apt_43' }]);
    });

    it('CLOSED without payload metadata fetches it', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      counter.coMetadata = { appointment_id: 'apt_42' };
      const results: Array<Record<string, string>> = [];
      tac.onConversationEnded(async ({ session }) => {
        results.push(await conversationMetadata(session));
      });

      await deliver(channel, closed());

      expect(results).toEqual([{ appointment_id: 'apt_42' }]);
      expect(counter.count('getConversation')).toBe(1);
    });

    it('CLOSED answers the accessor from the payload metadata', async () => {
      const { tac, channel, counter } = await makeSmsChannel();
      const ended: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        ended.push(session);
      });

      await deliver(channel, closed({ metadata: { appointment_id: 'apt_42' } }));

      expect(ended[0]!.metadata.appointment_id).toBeUndefined();
      expect(await conversationMetadata(ended[0]!)).toEqual({ appointment_id: 'apt_42' });
      expect(counter.count('getConversation')).toBe(0);
    });

    it('CLOSED session metadata has nothing from earlier turns', async () => {
      const { tac, channel } = await makeSmsChannel();
      const ended: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        ended.push(session);
      });
      tac.onMessageReady(({ session }) => {
        session.metadata.note = 'this turn only';
      });
      await deliver(channel, inbound());

      await deliver(channel, closed());

      expect(ended).toHaveLength(1);
      expect(ended[0]!.metadata.note).toBeUndefined();
    });

    it('CLOSED without handler or analytics costs nothing', async () => {
      const { channel, counter } = await makeSmsChannel();
      await deliver(channel, inbound());
      const callsBefore = counter.calls.length;

      await deliver(channel, closed());

      expect(counter.calls.length).toBe(callsBefore);
    });

    it('CLOSED with non-string metadata values still ends the conversation', async () => {
      const { tac, channel } = await makeSmsChannel();
      const results: Array<Record<string, string>> = [];
      tac.onConversationEnded(async ({ session }) => {
        results.push(await conversationMetadata(session));
      });

      await deliver(channel, closed({ metadata: { n: 1, x: null, ok: 'yes' } }));

      expect(results).toEqual([{ ok: 'yes' }]);
    });

    it('a session from an unknown source reads as empty metadata', async () => {
      const session: ConversationSession = {
        conversationId: CONV_ID,
        channel: 'sms',
        startedAt: new Date(),
        metadata: {},
      };

      expect(await conversationMetadata(session)).toEqual({});
    });
  });

  describe('lifecycle analytics', () => {
    beforeEach(() => {
      delete process.env.TAC_ANALYTICS_DISABLED;
      _resetAnalytics();
      mockTrack.mockClear();
    });

    afterEach(() => {
      process.env.TAC_ANALYTICS_DISABLED = 'true';
      _resetAnalytics();
    });

    const tracked = (event: string) =>
      mockTrack.mock.calls
        .map(c => c[0] as { event: string; properties: Record<string, unknown> })
        .filter(c => c.event === event);

    it('CLOSED with analytics on fires a handler set on the channel after registering it', async () => {
      const { channel } = await makeSmsChannel();
      const ended: ConversationSession[] = [];
      channel.on('conversationEnded', ({ session }: { session: ConversationSession }) => {
        ended.push(session);
      });

      await deliver(channel, closed());

      expect(ended.map(s => s.conversationId)).toEqual([CONV_ID]);
      expect(tracked('Conversation Ended')).toHaveLength(1);
    });

    it('CLOSED with analytics on but no handler reports the end without any call', async () => {
      const { channel, counter } = await makeSmsChannel();

      await deliver(
        channel,
        closed({
          extra: { createdAt: '2026-04-27T00:00:00Z', updatedAt: '2026-04-27T00:00:05Z' },
        })
      );

      expect(counter.calls).toEqual([]);
      const ended = tracked('Conversation Ended');
      expect(ended).toHaveLength(1);
      expect(ended[0]!.properties.conversation_id).toBe(CONV_ID);
      expect('channel' in ended[0]!.properties).toBe(false);
      expect(ended[0]!.properties.duration_ms).toBe(5000);
    });

    it('CLOSED without timestamps omits duration_ms', async () => {
      const { channel } = await makeSmsChannel();

      await deliver(channel, closed());

      const ended = tracked('Conversation Ended');
      expect(ended).toHaveLength(1);
      expect('duration_ms' in ended[0]!.properties).toBe(false);
    });

    it('a CLOSED for another channel is reported but fires no handler', async () => {
      // The payload doesn't say which channel; only the handler's lookup does.
      const { tac, channel, counter } = await makeSmsChannel();
      counter.install(coOf(tac), 'listParticipants', () => [
        participant('PA_U', 'CUSTOMER', 'user-1', { channel: 'CHAT' }),
      ]);
      const ended: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        ended.push(session);
      });

      await deliver(channel, closed());

      expect(ended).toEqual([]);
      expect(tracked('Conversation Ended')).toHaveLength(1);
    });

    it('PARTICIPANT_ADDED for the customer reports the start, without any call', async () => {
      const { channel, counter } = await makeSmsChannel();

      await deliver(channel, {
        eventType: 'PARTICIPANT_ADDED',
        data: participant('PA_CUSTOMER', 'CUSTOMER', CUSTOMER_NUMBER),
      });

      expect(counter.calls).toEqual([]);
      const started = tracked('Conversation Started');
      expect(started).toHaveLength(1);
      expect(started[0]!.properties.conversation_id).toBe(CONV_ID);
    });

    it("PARTICIPANT_ADDED for TAC's own participant is not reported", async () => {
      const { channel } = await makeSmsChannel();

      await deliver(channel, {
        eventType: 'PARTICIPANT_ADDED',
        data: participant('PA_AGENT', 'AI_AGENT', AGENT_NUMBER),
      });
      await deliver(channel, {
        eventType: 'PARTICIPANT_ADDED',
        data: participant('PA_SELF', 'UNKNOWN', AGENT_NUMBER),
      });

      expect(tracked('Conversation Started')).toHaveLength(0);
    });
  });

  describe('deprecated APIs', () => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('getConversationSession and isConversationActive find nothing, even mid-turn', async () => {
      const { tac, channel } = await makeSmsChannel();
      const during: Array<[unknown, unknown]> = [];
      tac.onMessageReady(({ conversationId }) => {
        during.push([
          channel.getConversationSession(conversationId),
          channel.isConversationActive(conversationId),
        ]);
      });

      await deliver(channel, inbound());

      expect(during).toEqual([[undefined, false]]);
    });

    it("on('conversationStarted') registers a handler that never fires", async () => {
      const { tac, channel } = await makeSmsChannel();
      const started = vi.fn();
      channel.on('conversationStarted', started);
      tac.onMessageReady(() => 'reply');

      await deliver(channel, inbound());

      expect(started).not.toHaveBeenCalled();
    });

    it('memoryMode "once" runs as "always": one recall per message, with the query', async () => {
      const { tac, channel, counter } = await makeSmsChannel({
        mode: 'once',
        profileId: 'profile_1',
      });
      tac.onMessageReady(() => undefined);

      await deliver(channel, inbound({ text: 'first', commId: 'c1' }));
      await deliver(channel, inbound({ text: 'second', commId: 'c2' }));

      const recalls = counter.mocks.retrieveMemories!.mock.calls;
      expect(recalls).toHaveLength(2);
      expect((recalls[0]![1] as { query?: string }).query).toBe('first');
      expect((recalls[1]![1] as { query?: string }).query).toBe('second');
    });
  });
});
