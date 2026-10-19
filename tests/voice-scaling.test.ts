/**
 * Voice behaviour that horizontal scaling depends on.
 *
 * Two things have to hold for N replicas behind a load balancer:
 *
 * 1. A call's WebSocket closing frees **everything** local, on every path.
 * 2. `onConversationEnded` fires on whichever instance Conversation
 *    Orchestrator's CLOSED webhook happens to reach, even one that never saw
 *    the call.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  OpenAIRealtimeProviderConfig,
  TAC,
  VoiceChannel,
  type ConversationParticipant,
  type ConversationResponse,
  type ConversationSession,
  type TACConfigData,
} from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';
import { assertNoResidualState } from './helpers/voice-invariants';

const CONFIGURATION_ID = 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd';

function getTestConfig(overrides: Partial<TACConfigData> = {}): TACConfigData {
  return {
    accountSid: 'ACtest123',
    authToken: 'test_token_123',
    apiKey: 'SK123',
    apiSecret: 'test_api_token',
    conversationConfigurationId: CONFIGURATION_ID,
    phoneNumber: '+15551234567',
    voicePublicDomain: 'example.com',
    ...overrides,
  };
}

function relayOnlyConfig(): TACConfigData {
  const { conversationConfigurationId: _omit, ...config } = getTestConfig();
  return config;
}

/**
 * A CONVERSATION_UPDATED/CLOSED payload, as CO documents it: the Conversation
 * resource carries no channel or channelId.
 */
function closedWebhook(conversationId: string, configurationId = CONFIGURATION_ID) {
  return {
    eventType: 'CONVERSATION_UPDATED',
    data: { id: conversationId, status: 'CLOSED', configurationId },
  };
}

/**
 * A realistic post-call participant set: customer + TAC's AI_AGENT.
 *
 * `callSid` lands on the VOICE addresses' `channelId`, which is where CO
 * records the call a voice participant is on.
 */
function voiceParticipants(conversationId: string, callSid?: string): ConversationParticipant[] {
  return [
    {
      id: 'PA_customer',
      conversationId,
      accountId: 'ACtest123',
      name: 'Caller',
      type: 'CUSTOMER',
      profileId: 'profile_caller',
      addresses: [{ channel: 'VOICE', address: '+15559998888', channelId: callSid ?? null }],
    },
    {
      id: 'PA_agent',
      conversationId,
      accountId: 'ACtest123',
      name: 'TAC Agent',
      type: 'AI_AGENT',
      addresses: [{ channel: 'VOICE', address: '+15551234567', channelId: callSid ?? null }],
    },
  ] as ConversationParticipant[];
}

/**
 * A conversation grouped across channels: an SMS-only CUSTOMER listed before
 * the caller, and the agent's leg on its own CallSid.
 */
function mixedChannelParticipants(conversationId: string): ConversationParticipant[] {
  const [customer, agent] = voiceParticipants(conversationId, 'CA_customer');
  agent!.addresses[0]!.channelId = 'CA_agent_leg';
  return [
    {
      id: 'PA_sms_customer',
      conversationId,
      accountId: 'ACtest123',
      name: 'Texter',
      type: 'CUSTOMER',
      profileId: 'profile_sms',
      addresses: [{ channel: 'SMS', address: '+15550001111' }],
    } as ConversationParticipant,
    customer!,
    agent!,
  ];
}

function conversation(id: string, status: string, createdAt: string): ConversationResponse {
  return {
    id,
    accountId: 'ACtest123',
    status,
    configurationId: CONFIGURATION_ID,
    createdAt,
  } as ConversationResponse;
}

/** A TAC with a registered VoiceChannel and an `onConversationEnded` sink. */
async function setup(config: TACConfigData = getTestConfig()) {
  const tac = await createTestTAC(config);
  const channel = new VoiceChannel(tac);
  const conversationEnded: ConversationSession[] = [];
  const callEnded: ConversationSession[] = [];
  tac.onConversationEnded(({ session }) => {
    conversationEnded.push(session);
  });
  tac.registerChannel(channel);
  channel.onCallEnded(session => {
    callEnded.push(session);
  });
  return { tac, channel, conversationEnded, callEnded };
}

function startSession(channel: VoiceChannel, conversationId: string, profileId?: string) {
  return (channel as any).startConversation(conversationId, profileId) as ConversationSession;
}

/** Run the ConversationRelay provider's socket teardown for a call. */
function teardown(channel: VoiceChannel, conversationId: string): Promise<void> {
  return (channel as any).provider.handleWebSocketDisconnect(conversationId);
}

function mockParticipants(tac: TAC, participants: ConversationParticipant[] | Error) {
  const client = tac.getConversationClient();
  return vi
    .spyOn(client, 'listParticipants')
    .mockImplementation(
      participants instanceof Error
        ? () => Promise.reject(participants)
        : () => Promise.resolve(structuredClone(participants))
    );
}

function mockHangup(channel: VoiceChannel) {
  const update = vi.fn().mockResolvedValue({});
  vi.spyOn(channel as any, 'getTwilioClient').mockReturnValue({ calls: () => ({ update }) });
  return update;
}

describe('hook split', () => {
  // `onCallEnded` is the call; `onConversationEnded` is the conversation.

  it('orchestrated teardown fires onCallEnded only', async () => {
    const { channel, conversationEnded, callEnded } = await setup();

    startSession(channel, 'conv_1', 'profile_caller');
    await teardown(channel, 'conv_1');

    expect(callEnded.map(s => s.conversationId)).toEqual(['conv_1']);
    expect(conversationEnded).toEqual([]);
    assertNoResidualState(channel, 'conv_1');
  });

  it('relay-only teardown fires both', async () => {
    // No CO conversation exists, so nothing will close it later — the channel
    // must fire both hooks itself.
    const { channel, conversationEnded, callEnded } = await setup(relayOnlyConfig());

    startSession(channel, 'CA_relay');
    await teardown(channel, 'CA_relay');

    expect(callEnded.map(s => s.conversationId)).toEqual(['CA_relay']);
    expect(conversationEnded.map(s => s.conversationId)).toEqual(['CA_relay']);
    assertNoResidualState(channel, 'CA_relay');
  });

  it('onCallEnded carries state the rebuild cannot', async () => {
    const { channel, callEnded } = await setup();

    const session = startSession(channel, 'conv_2');
    session.callSid = 'CA_2';
    session.metadata.transcript = [{ role: 'user', text: 'hello' }];
    await teardown(channel, 'conv_2');

    expect(callEnded[0]!.metadata.transcript).toEqual([{ role: 'user', text: 'hello' }]);
    expect(callEnded[0]!.callSid).toBe('CA_2');
  });
});

describe('stateless conversation closed', () => {
  // CLOSED must work on an instance that never held the call.

  it('fires on an instance that never saw the call', async () => {
    const a = await setup();
    const b = await setup();

    // Instance A takes the call and tears it down when the caller hangs up.
    startSession(a.channel, 'conv_shared', 'profile_caller');
    await teardown(a.channel, 'conv_shared');

    // CO's CLOSED webhook lands on B, which has never seen this call.
    mockParticipants(b.tac, voiceParticipants('conv_shared', 'CA_shared'));
    await b.channel.processWebhook(closedWebhook('conv_shared'));

    expect(b.conversationEnded).toHaveLength(1);
    const rebuilt = b.conversationEnded[0]!;
    expect(rebuilt.conversationId).toBe('conv_shared');
    expect(rebuilt.callSid).toBe('CA_shared');
    expect(rebuilt.profileId).toBe('profile_caller');
    expect(rebuilt.authorInfo?.address).toBe('+15559998888');
    expect(rebuilt.aiAgentInfo?.participantId).toBe('PA_agent');
    expect(rebuilt.aiAgentInfo?.address).toBe('+15551234567');
    expect(rebuilt.metadata).toEqual({});
  });

  it('rebuild takes the VOICE customer, not the first customer', async () => {
    const { tac, channel, conversationEnded } = await setup();
    mockParticipants(tac, mixedChannelParticipants('conv_mixed'));

    await channel.processWebhook(closedWebhook('conv_mixed'));

    expect(conversationEnded).toHaveLength(1);
    const rebuilt = conversationEnded[0]!;
    expect(rebuilt.profileId).toBe('profile_caller');
    expect(rebuilt.callSid).toBe('CA_customer');
    expect(rebuilt.authorInfo).toEqual({ address: '+15559998888', participantId: 'PA_customer' });
  });

  it('fires once after local teardown on the same instance', async () => {
    const { tac, channel, conversationEnded } = await setup();

    startSession(channel, 'conv_3');
    await teardown(channel, 'conv_3');
    expect(conversationEnded).toEqual([]);

    mockParticipants(tac, voiceParticipants('conv_3'));
    await channel.processWebhook(closedWebhook('conv_3'));

    expect(conversationEnded).toHaveLength(1);
  });

  it('makes no API call when no callback is registered', async () => {
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(tac);
    tac.registerChannel(channel);
    const listParticipants = mockParticipants(tac, voiceParticipants('conv_4'));

    await channel.processWebhook(closedWebhook('conv_4'));

    expect(listParticipants).not.toHaveBeenCalled();
  });

  it('honours a callback registered directly on an unregistered channel', async () => {
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(tac);
    const ended: ConversationSession[] = [];
    channel.on('conversationEnded', ({ session }) => {
      ended.push(session);
    });
    mockParticipants(tac, voiceParticipants('conv_direct'));

    await channel.processWebhook(closedWebhook('conv_direct'));

    expect(ended.map(s => s.conversationId)).toEqual(['conv_direct']);
  });

  it('ignores a conversation with no VOICE participant', async () => {
    // A CHAT conversation closing must not fire the voice channel's hook.
    const { tac, channel, conversationEnded } = await setup();
    mockParticipants(tac, [
      {
        id: 'PA_chat',
        conversationId: 'conv_chat',
        accountId: 'ACtest123',
        name: 'Chat User',
        type: 'CUSTOMER',
        addresses: [{ channel: 'CHAT', address: 'user-1' }],
      } as ConversationParticipant,
    ]);

    await channel.processWebhook(closedWebhook('conv_chat'));

    expect(conversationEnded).toEqual([]);
  });

  it("ignores another configuration's conversation", async () => {
    const { tac, channel, conversationEnded } = await setup();
    const listParticipants = mockParticipants(tac, voiceParticipants('conv_other'));

    await channel.processWebhook(closedWebhook('conv_other', 'conv_configuration_someone_else'));

    expect(conversationEnded).toEqual([]);
    expect(listParticipants).not.toHaveBeenCalled();
  });

  it('survives a participant lookup failure', async () => {
    const { tac, channel, conversationEnded } = await setup();
    mockParticipants(tac, new Error('CO unreachable'));

    await expect(channel.processWebhook(closedWebhook('conv_5'))).resolves.toBeUndefined();

    expect(conversationEnded).toEqual([]);
  });

  it('leaves callSid unset without a VOICE channelId', async () => {
    const { tac, channel, conversationEnded } = await setup();
    mockParticipants(tac, voiceParticipants('conv_no_sid'));

    await channel.processWebhook(closedWebhook('conv_no_sid'));

    expect(conversationEnded).toHaveLength(1);
    expect(conversationEnded[0]!.callSid).toBeUndefined();
  });

  it("prefers the customer's callSid over the agent's", async () => {
    // The customer's VOICE channelId wins even if the agent is listed first.
    const { tac, channel, conversationEnded } = await setup();
    const [customer, agent] = voiceParticipants('conv_both');
    customer!.addresses[0]!.channelId = 'CA_customer';
    agent!.addresses[0]!.channelId = 'CA_agent';
    mockParticipants(tac, [agent!, customer!]);

    await channel.processWebhook(closedWebhook('conv_both'));

    expect(conversationEnded[0]!.callSid).toBe('CA_customer');
  });

  it("falls back to the agent's callSid when the customer has none", async () => {
    const { tac, channel, conversationEnded } = await setup();
    const [customer, agent] = voiceParticipants('conv_agent_only');
    agent!.addresses[0]!.channelId = 'CA_agent';
    mockParticipants(tac, [customer!, agent!]);

    await channel.processWebhook(closedWebhook('conv_agent_only'));

    expect(conversationEnded[0]!.callSid).toBe('CA_agent');
  });

  it('treats an empty-string channelId as no callSid', async () => {
    const { tac, channel, conversationEnded } = await setup();
    mockParticipants(tac, voiceParticipants('conv_empty', ''));

    await channel.processWebhook(closedWebhook('conv_empty'));

    expect(conversationEnded).toHaveLength(1);
    expect(conversationEnded[0]!.callSid).toBeUndefined();
  });

  it('relay-only CLOSED webhook does not double-fire', async () => {
    // Relay-only already fired at teardown; a CLOSED must not fire again.
    const { channel, conversationEnded } = await setup(relayOnlyConfig());

    startSession(channel, 'CA_relay2');
    await teardown(channel, 'CA_relay2');
    expect(conversationEnded).toHaveLength(1);

    await channel.processWebhook(closedWebhook('CA_relay2'));

    expect(conversationEnded).toHaveLength(1);
  });
});

describe('closed during a live call', () => {
  // CO can close a conversation while its call is still live (a closed timeout
  // during a long hold, or the app closing it). The call keeps running, so the
  // session must survive until teardown.

  it('fires onConversationEnded now and keeps the session', async () => {
    const { tac, channel, conversationEnded, callEnded } = await setup();
    const listParticipants = mockParticipants(tac, []);

    const live = startSession(channel, 'conv_live', 'profile_caller');
    live.callSid = 'CA_live';
    await channel.processWebhook(closedWebhook('conv_live'));

    expect(conversationEnded.map(s => s.conversationId)).toEqual(['conv_live']);
    expect(conversationEnded[0]!.callSid).toBe('CA_live');
    expect(channel.getConversationSession('conv_live' as any)).toBe(live);
    expect(callEnded).toEqual([]);
    // The live session is used as-is; no rebuild from CO.
    expect(listParticipants).not.toHaveBeenCalled();

    await teardown(channel, 'conv_live');

    expect(callEnded.map(s => s.conversationId)).toEqual(['conv_live']);
    expect(conversationEnded).toHaveLength(1);
    assertNoResidualState(channel, 'conv_live');
  });

  it('hands the callback a snapshot of the live session', async () => {
    const { channel, conversationEnded } = await setup();

    const live = startSession(channel, 'conv_snap');
    live.metadata.transcript = ['hello'];
    await channel.processWebhook(closedWebhook('conv_snap'));
    live.metadata.late_key = 'written after CLOSED';

    const snapshot = conversationEnded[0]!;
    expect(snapshot).not.toBe(live);
    expect(snapshot.metadata).toEqual({ transcript: ['hello'] });
    expect(snapshot.startedAt).not.toBe(live.startedAt);
    expect(snapshot.startedAt.getTime()).toBe(live.startedAt.getTime());
  });

  it("keeps the callback's edits to nested data off the live session", async () => {
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(tac);
    const live = startSession(channel, 'conv_nested', 'profile_caller');
    live.metadata.transcript = [{ role: 'user', text: 'hello' }];
    live.authorInfo = { address: '+15559998888', participantId: 'PA_customer' };
    live.pendingHandoffData = { handoffData: '{"reason": "agent"}' } as any;
    const held: ConversationSession[] = [];

    tac.onConversationEnded(({ session }) => {
      held.push(session);
      (session.metadata.transcript as unknown[]).length = 0;
      session.authorInfo!.address = 'changed';
      (session.pendingHandoffData as any).handoffData = 'changed';
    });
    tac.registerChannel(channel);
    await channel.processWebhook(closedWebhook('conv_nested'));

    // The callback's edits don't reach the live call...
    expect(live.metadata.transcript).toEqual([{ role: 'user', text: 'hello' }]);
    expect(live.authorInfo.address).toBe('+15559998888');
    expect((live.pendingHandoffData as any).handoffData).toBe('{"reason": "agent"}');
    // ...and the live call's later writes don't reach the snapshot it kept.
    (live.metadata.transcript as unknown[]).push({ role: 'assistant', text: 'still here' });
    expect(held[0]!.metadata.transcript).toEqual([]);
  });

  it('still fires the hook with uncloneable metadata', async () => {
    const { channel, conversationEnded } = await setup();
    const live = startSession(channel, 'conv_uncloneable');
    const appHandle = { close: () => undefined }; // structuredClone rejects functions
    live.metadata.handle = appHandle;
    live.metadata.transcript = ['hello'];

    await channel.processWebhook(closedWebhook('conv_uncloneable'));

    expect(conversationEnded).toHaveLength(1);
    expect(conversationEnded[0]!.metadata.handle).toBe(appHandle);
    expect(conversationEnded[0]!.metadata.transcript).toEqual(['hello']);
    expect(conversationEnded[0]!.metadata.transcript).not.toBe(live.metadata.transcript);
  });

  it('shares class instances rather than stripping their methods', async () => {
    class Tracker {
      count = 1;
      bump(): number {
        return ++this.count;
      }
    }
    const { channel, conversationEnded } = await setup();
    const live = startSession(channel, 'conv_class');
    const tracker = new Tracker();
    live.metadata.tracker = tracker;

    await channel.processWebhook(closedWebhook('conv_class'));

    expect(conversationEnded[0]!.metadata.tracker).toBe(tracker);
  });

  it('endCall after the live close still fires onCallEnded once', async () => {
    // Hanging up after a mid-call CLOSED still releases the session normally:
    // onCallEnded fires once, and onConversationEnded isn't fired again.
    const { channel, conversationEnded, callEnded } = await setup();

    const live = startSession(channel, 'conv_end_live', 'profile_caller');
    live.callSid = 'CA_end_live';
    await channel.processWebhook(closedWebhook('conv_end_live'));
    expect(conversationEnded).toHaveLength(1);

    mockHangup(channel);
    await channel.endCall('CA_end_live');

    expect(callEnded.map(s => s.conversationId)).toEqual(['conv_end_live']);
    expect(conversationEnded).toHaveLength(1);
    assertNoResidualState(channel, 'conv_end_live');
  });

  it('a raising callback leaves the session for teardown', async () => {
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(tac);
    const callEnded: ConversationSession[] = [];
    channel.onCallEnded(session => {
      callEnded.push(session);
    });
    tac.onConversationEnded(async () => {
      throw new Error('handler exploded');
    });
    tac.registerChannel(channel);

    const live = startSession(channel, 'conv_raise');
    live.callSid = 'CA_raise';
    await channel.processWebhook(closedWebhook('conv_raise'));

    expect(channel.getConversationSession('conv_raise' as any)).toBe(live);

    await teardown(channel, 'conv_raise');

    expect(callEnded.map(s => s.conversationId)).toEqual(['conv_raise']);
    assertNoResidualState(channel, 'conv_raise');
  });
});

describe('teardown invariant', () => {
  // No failure mode may leave residue behind.

  const createMockWebSocket = () => {
    const handlers: Record<string, ((...args: any[]) => void)[]> = {};
    return {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        (handlers[event] ??= []).push(handler);
      }),
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1,
      emit(event: string, ...args: any[]) {
        for (const h of handlers[event] ?? []) h(...args);
      },
    };
  };

  const setupMessage = (callSid: string) =>
    Buffer.from(
      JSON.stringify({
        type: 'setup',
        sessionId: `sess_${callSid}`,
        callSid,
        from: '+15559998888',
        to: '+15551234567',
        direction: 'inbound',
        callType: 'PSTN',
        callStatus: 'ringing',
        accountSid: 'ACtest123',
      })
    );

  const promptMessage = Buffer.from(
    JSON.stringify({ type: 'prompt', voicePrompt: 'hi', lang: 'en-US', last: true })
  );

  const settle = () => new Promise(resolve => setTimeout(resolve, 10));

  /** Drive one call through its socket: setup, optional prompt, then `end`. */
  async function runCall(
    channel: VoiceChannel,
    callSid: string,
    options: { prompt?: boolean; end?: 'close' | 'error' } = {}
  ): Promise<void> {
    const ws = createMockWebSocket();
    channel.handleWebSocketConnection(ws as any);
    ws.emit('message', setupMessage(callSid));
    if (options.prompt ?? true) {
      ws.emit('message', promptMessage);
    }
    await settle();
    if (options.end === 'error') {
      ws.emit('error', new Error('socket blew up'));
    }
    ws.emit('close');
    await settle();
  }

  it('normal hangup', async () => {
    const { channel } = await setup(relayOnlyConfig());
    await runCall(channel, 'CA_a');
    assertNoResidualState(channel, 'CA_a');
  });

  it('disconnect before any prompt', async () => {
    const { channel } = await setup(relayOnlyConfig());
    await runCall(channel, 'CA_b', { prompt: false });
    assertNoResidualState(channel, 'CA_b');
  });

  it('abrupt error mid-stream', async () => {
    const { channel } = await setup(relayOnlyConfig());
    await runCall(channel, 'CA_c', { end: 'error' });
    assertNoResidualState(channel, 'CA_c');
  });

  it('onMessageReady raising', async () => {
    const { tac, channel } = await setup(relayOnlyConfig());
    tac.onMessageReady(async () => {
      throw new Error('LLM exploded');
    });
    await runCall(channel, 'CA_d');
    assertNoResidualState(channel, 'CA_d');
  });

  it('orchestrated call whose CO lookup fails outright', async () => {
    const { tac, channel } = await setup();
    vi.spyOn(tac.getConversationClient(), 'listConversations').mockRejectedValue(
      new Error('CO unreachable')
    );
    await runCall(channel, 'CA_e');
    expect((channel as any).activeConversations.size).toBe(0);
  });

  it('many connect/disconnect cycles leave nothing behind in aggregate', async () => {
    const { channel } = await setup(relayOnlyConfig());
    for (let i = 0; i < 25; i++) {
      await runCall(channel, `CA_loop_${i}`);
      assertNoResidualState(channel, `CA_loop_${i}`);
    }
    expect((channel as any).activeConversations.size).toBe(0);
    expect((channel as any).provider.webSocketConnections.size).toBe(0);
  });
});

describe('endCall does not double-fire', () => {
  it('orchestrated endCall leaves onConversationEnded to CLOSED', async () => {
    // endCall() releases the call like any hangup: onCallEnded gets the live
    // session now, and onConversationEnded fires once, on CLOSED.
    const { tac, channel, conversationEnded, callEnded } = await setup();

    const session = startSession(channel, 'conv_end');
    session.callSid = 'CA_end';
    session.metadata.order_id = 'ord_1';

    mockHangup(channel);
    await channel.endCall('CA_end');

    expect(callEnded).toEqual([session]);
    expect(callEnded[0]!.metadata.order_id).toBe('ord_1');
    expect(conversationEnded).toEqual([]);
    assertNoResidualState(channel, 'conv_end');

    mockParticipants(tac, voiceParticipants('conv_end', 'CA_end'));
    await channel.processWebhook(closedWebhook('conv_end'));

    expect(conversationEnded).toHaveLength(1);
    expect(conversationEnded[0]!.callSid).toBe('CA_end');
  });
});

describe('closed after teardown', () => {
  // Orchestrated ConversationRelay: nothing is kept after teardown, so CLOSED
  // gets a session rebuilt from CO on every instance, the one that held the
  // call included.

  it('CLOSED on the same instance gets a rebuilt session', async () => {
    const { tac, channel, conversationEnded } = await setup();
    mockParticipants(tac, voiceParticipants('conv_kept', 'CA_kept'));

    const session = startSession(channel, 'conv_kept', 'profile_caller');
    session.callSid = 'CA_kept';
    session.metadata.order_id = 'ord_1';
    await teardown(channel, 'conv_kept');
    expect(conversationEnded).toEqual([]);
    assertNoResidualState(channel, 'conv_kept');

    await channel.processWebhook(closedWebhook('conv_kept'));

    expect(conversationEnded).toHaveLength(1);
    expect(conversationEnded[0]).not.toBe(session);
    expect(conversationEnded[0]!.metadata).toEqual({});
    expect(conversationEnded[0]!.callSid).toBe('CA_kept');
  });

  it('a mid-call close is not re-fired at teardown', async () => {
    const { channel, conversationEnded } = await setup();

    const live = startSession(channel, 'conv_mid');
    live.callSid = 'CA_mid';
    await channel.processWebhook(closedWebhook('conv_mid'));
    expect(conversationEnded).toHaveLength(1);

    mockHangup(channel);
    await channel.endCall('CA_mid');

    expect(conversationEnded).toHaveLength(1);
    assertNoResidualState(channel, 'conv_mid');
  });
});

describe('instance affinity', () => {
  // Every URL TAC hands Twilio for a live call points at the process holding
  // that call, when the deployment can address one.

  async function affinityChannel(overrides: Partial<TACConfigData> = {}) {
    const tac = await createTestTAC(getTestConfig(overrides));
    const channel = new VoiceChannel(tac);
    // Registering the handlers is what makes TAC pass the callback URLs.
    channel.onCallStatus(async () => undefined);
    channel.onAmd(async () => undefined);
    channel.onRecording(async () => undefined);
    return { tac, channel };
  }

  it('inbound TwiML uses the instance domain', async () => {
    const { channel } = await affinityChannel({
      instancePublicDomain: 'pod-7.voice.svc.cluster.local',
    });

    const twiml = await channel.handleIncomingCall();

    expect(twiml).toContain('url="wss://pod-7.voice.svc.cluster.local/ws"');
    expect(twiml).toContain('action="https://pod-7.voice.svc.cluster.local');
    expect(twiml).not.toContain('example.com');
  });

  it('call-event URLs use the instance domain', async () => {
    const { tac } = await affinityChannel({
      instancePublicDomain: 'pod-7.voice.svc.cluster.local',
    });

    for (const kind of ['status', 'amd', 'recording'] as const) {
      expect(tac.getConfig().callEventUrl(kind)).toMatch(
        /^https:\/\/pod-7\.voice\.svc\.cluster\.local\//
      );
    }
  });

  it('an outbound call pins every callback to this instance', async () => {
    const { channel } = await affinityChannel({
      instancePublicDomain: 'pod-7.voice.svc.cluster.local',
    });
    const create = vi.fn().mockResolvedValue({ sid: 'CA_out' });
    vi.spyOn(channel, 'getTwilioClientInternal').mockReturnValue({ calls: { create } } as any);

    await channel.initiateOutboundConversation({ to: '+15559998888' });

    const params = create.mock.calls[0]![0] as Record<string, string>;
    expect(params.twiml).toContain('wss://pod-7.voice.svc.cluster.local/ws');
    for (const key of ['statusCallback', 'asyncAmdStatusCallback', 'recordingStatusCallback']) {
      expect(params[key]).toMatch(/^https:\/\/pod-7\.voice\.svc\.cluster\.local\//);
    }
  });

  it('the shared domain remains the default', async () => {
    // Deployments without per-pod addressing are unaffected.
    const { tac, channel } = await affinityChannel();

    const twiml = await channel.handleIncomingCall();

    expect(twiml).toContain('url="wss://example.com/ws"');
    expect(tac.getConfig().callEventUrl('status')).toBe(
      'https://example.com/twilio/call-events/status'
    );
  });
});

describe('resolveConversationSessionByCallSid', () => {
  // A CallSid-only event can find its session's identity on any instance.

  it('returns the live session when held locally', async () => {
    const { tac, channel } = await setup();
    const listConversations = vi.spyOn(tac.getConversationClient(), 'listConversations');
    const live = startSession(channel, 'conv_local');
    live.callSid = 'CA_local';

    expect(await channel.resolveConversationSessionByCallSid('CA_local')).toBe(live);
    expect(listConversations).not.toHaveBeenCalled();
  });

  it('returns the live session as-is after a mid-call close', async () => {
    // On the instance holding the call, a mid-call CLOSED still leaves the
    // live session reachable under the old conversation id; CO's new ACTIVE
    // conversation for the call isn't consulted.
    const { tac, channel } = await setup();
    const live = startSession(channel, 'conv_old');
    live.callSid = 'CA_hold';
    await channel.processWebhook(closedWebhook('conv_old'));

    const listConversations = vi
      .spyOn(tac.getConversationClient(), 'listConversations')
      .mockResolvedValue([conversation('conv_new', 'ACTIVE', '2026-09-30T10:20:00Z')]);

    const session = await channel.resolveConversationSessionByCallSid('CA_hold');

    expect(session).toBe(live);
    expect(session!.conversationId).toBe('conv_old');
    expect(listConversations).not.toHaveBeenCalled();
  });

  it('rebuilds from CO when held elsewhere', async () => {
    const { tac, channel } = await setup();
    const listConversations = vi
      .spyOn(tac.getConversationClient(), 'listConversations')
      .mockResolvedValue([conversation('conv_remote', 'ACTIVE', '2026-09-30T10:00:00Z')]);
    mockParticipants(tac, voiceParticipants('conv_remote'));

    const session = await channel.resolveConversationSessionByCallSid('CA_remote');

    expect(session?.conversationId).toBe('conv_remote');
    expect(session?.callSid).toBe('CA_remote');
    expect(session?.profileId).toBe('profile_caller');
    expect(listConversations).toHaveBeenCalledWith({ channelId: 'CA_remote' });
    // Identity only: nothing is tracked locally.
    expect(channel.isConversationActive('conv_remote' as any)).toBe(false);
  });

  it('rebuild takes the VOICE customer, not the first customer', async () => {
    const { tac, channel } = await setup();
    vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
      conversation('conv_mixed', 'ACTIVE', '2026-09-30T10:00:00Z'),
    ]);
    mockParticipants(tac, mixedChannelParticipants('conv_mixed'));

    const session = await channel.resolveConversationSessionByCallSid('CA_customer');

    expect(session?.profileId).toBe('profile_caller');
    expect(session?.authorInfo?.participantId).toBe('PA_customer');
  });

  it('never serves participants from the shared cache', async () => {
    // Early in a call participants still change (profileId, customer joining),
    // so each lookup must see fresh data.
    const { tac, channel } = await setup();
    vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
      conversation('conv_remote', 'ACTIVE', '2026-09-30T10:00:00Z'),
    ]);
    const withProfile = (profileId: string) =>
      voiceParticipants('conv_remote').map(p => (p.type === 'CUSTOMER' ? { ...p, profileId } : p));

    const listParticipants = mockParticipants(tac, withProfile('profile_old'));
    const first = await channel.resolveConversationSessionByCallSid('CA_remote');
    listParticipants.mockResolvedValue(withProfile('profile_new'));
    const second = await channel.resolveConversationSessionByCallSid('CA_remote');

    expect(first?.profileId).toBe('profile_old');
    expect(second?.profileId).toBe('profile_new');
    expect(listParticipants).toHaveBeenCalledTimes(2);
  });

  it('prefers the active conversation over a closed one', async () => {
    // After a mid-call CLOSED, CO starts a new conversation for the same call.
    const { tac, channel } = await setup();
    vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
      conversation('conv_old', 'CLOSED', '2026-09-30T10:00:00Z'),
      conversation('conv_new', 'ACTIVE', '2026-09-30T10:20:00Z'),
    ]);
    vi.spyOn(tac.getConversationClient(), 'listParticipants').mockImplementation(async id =>
      voiceParticipants(id)
    );

    const session = await channel.resolveConversationSessionByCallSid('CA_x');

    expect(session?.conversationId).toBe('conv_new');
  });

  it('falls back to the newest when none is active', async () => {
    const { tac, channel } = await setup();
    vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
      conversation('conv_old', 'CLOSED', '2026-09-30T10:00:00Z'),
      conversation('conv_newer', 'CLOSED', '2026-09-30T10:20:00Z'),
    ]);
    vi.spyOn(tac.getConversationClient(), 'listParticipants').mockImplementation(async id =>
      voiceParticipants(id)
    );

    const session = await channel.resolveConversationSessionByCallSid('CA_y');

    expect(session?.conversationId).toBe('conv_newer');
  });

  it('picks the later conversation by parsed time, not string order', async () => {
    // As strings, "...10:00:00Z" sorts after "...10:00:00.500Z", but before it
    // as a time.
    const { tac, channel } = await setup();
    vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
      conversation('conv_a', 'CLOSED', '2026-09-30T10:00:00Z'),
      conversation('conv_b', 'CLOSED', '2026-09-30T10:00:00.500Z'),
    ]);
    vi.spyOn(tac.getConversationClient(), 'listParticipants').mockImplementation(async id =>
      voiceParticipants(id)
    );

    const session = await channel.resolveConversationSessionByCallSid('CA_z');

    expect(session?.conversationId).toBe('conv_b');
  });

  it('returns undefined when CO knows no conversation', async () => {
    const { tac, channel } = await setup();
    vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([]);

    expect(await channel.resolveConversationSessionByCallSid('CA_none')).toBeUndefined();
  });

  it('returns undefined when the lookup fails', async () => {
    const { tac, channel } = await setup();
    vi.spyOn(tac.getConversationClient(), 'listConversations').mockRejectedValue(
      new Error('CO down')
    );

    expect(await channel.resolveConversationSessionByCallSid('CA_err')).toBeUndefined();
  });

  it('has no fallback in relay-only mode', async () => {
    const { channel } = await setup(relayOnlyConfig());

    expect(await channel.resolveConversationSessionByCallSid('CA_relay')).toBeUndefined();
  });

  it('has no fallback for a Media Streams provider', async () => {
    // Media Streams providers have no CO conversation behind the call, even in
    // orchestrated mode: don't bother asking CO.
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(
      tac,
      new OpenAIRealtimeProviderConfig({ openaiApiKey: 'sk-test' })
    );
    const listConversations = vi.spyOn(tac.getConversationClient(), 'listConversations');

    expect(await channel.resolveConversationSessionByCallSid('CA_media')).toBeUndefined();
    expect(listConversations).not.toHaveBeenCalled();
  });

  it('returns undefined when no participant is on the voice channel', async () => {
    const { tac, channel } = await setup();
    vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
      conversation('conv_other', 'ACTIVE', '2026-09-30T10:00:00Z'),
    ]);
    mockParticipants(tac, [
      {
        id: 'PA_customer',
        conversationId: 'conv_other',
        accountId: 'ACtest123',
        name: 'Caller',
        type: 'CUSTOMER',
        profileId: 'profile_caller',
        addresses: [{ channel: 'SMS', address: '+15559998888' }],
      } as ConversationParticipant,
    ]);

    expect(await channel.resolveConversationSessionByCallSid('CA_nonvoice')).toBeUndefined();
  });
});

describe('ConversationRelay customer selection', () => {
  it('initialization picks the VOICE customer from a mixed-channel conversation', async () => {
    const { tac, channel } = await setup();
    vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
      conversation('conv_mixed', 'ACTIVE', '2026-09-30T10:00:00Z'),
    ]);
    mockParticipants(tac, mixedChannelParticipants('conv_mixed'));

    await (channel as any).provider.initializeOrchestratedConversation(
      'CA_customer',
      '+15559998888',
      { send: vi.fn(), readyState: 1 }
    );

    const session = channel.getConversationSession('conv_mixed' as any);
    expect(session?.profileId).toBe('profile_caller');
    expect(session?.authorInfo?.address).toBe('+15559998888');
  });
});
