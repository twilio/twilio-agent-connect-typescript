import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SMSChannel, TAC } from '@twilio/tac-core';
import type { ConversationParticipant } from '@twilio/tac-core';
import MockAdapter from 'axios-mock-adapter';
import axios, { AxiosError } from 'axios';
import { createTestTAC } from './helpers/tac';

/**
 * Tests for `reconcileParticipants` in MessagingChannel.
 *
 * Covers the matrix of participant states that v1-bridge capture can leave us
 * with. The resolution rules were agreed with the Conversation Orchestrator team.
 */
describe('Reconcile participants', () => {
  const getTestConfig = () => ({
    accountSid: 'ACtest',
    authToken: 't',
    apiKey: 'SK',
    apiSecret: 's',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  const AGENT_ADDR = '+15551234567';
  const CUSTOMER_ADDR = '+12345678901';
  const CONV_ID = 'CHtest123456789';

  const participant = (
    id: string,
    type: string,
    address: string,
    channel: 'SMS' | 'CHAT' = 'SMS'
  ): ConversationParticipant => ({
    id,
    accountId: 'ACtest',
    conversationId: CONV_ID,
    name: address,
    type: type as ConversationParticipant['type'],
    addresses: [{ channel, address }],
  });

  let tac: TAC;
  let channel: SMSChannel;
  let mockAdapter: MockAdapter;
  // Stub memory profile calls by default — reconciliation tests should not hit
  // Conversation Memory. Individual tests can override.
  let stubLookupProfile: ReturnType<typeof vi.fn>;
  let stubCreateProfile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
    channel = new SMSChannel(tac);
    mockAdapter = new MockAdapter(
      (tac.getConversationClient() as unknown as { axiosInstance: typeof axios })
        .axiosInstance
    );

    const memoryClient = tac.getMemoryClient() as unknown as {
      lookupProfile: unknown;
      createProfile: unknown;
    };
    stubLookupProfile = vi.fn().mockRejectedValue(new Error('lookup_profile not stubbed'));
    stubCreateProfile = vi.fn().mockRejectedValue(new Error('create_profile not stubbed'));
    memoryClient.lookupProfile = stubLookupProfile;
    memoryClient.createProfile = stubCreateProfile;
  });

  afterEach(() => {
    mockAdapter?.restore();
    vi.restoreAllMocks();
  });

  const callReconcile = async (): Promise<
    [ConversationParticipant, ConversationParticipant | null] | null
  > =>
    await (
      channel as unknown as {
        reconcileParticipants: (
          id: string
        ) => Promise<[ConversationParticipant, ConversationParticipant | null] | null>;
      }
    ).reconcileParticipants(CONV_ID);

  const mockListParticipants = (participants: ConversationParticipant[]) =>
    mockAdapter
      .onGet(`/v2/Conversations/${CONV_ID}/Participants`)
      .reply(200, { participants });

  it('happy path: both sides correctly typed → no PUTs', async () => {
    const agent = participant('PA_A', 'AI_AGENT', AGENT_ADDR);
    const customer = participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR);
    mockListParticipants([agent, customer]);

    const result = await callReconcile();

    expect(result).not.toBeNull();
    expect(result![0].id).toBe('PA_A');
    expect(result![1]).not.toBeNull();
    expect(result![1]!.id).toBe('PA_C');
    // No PUTs or POSTs issued.
    expect(mockAdapter.history.put.length).toBe(0);
    expect(mockAdapter.history.post.length).toBe(0);
  });

  it('agent good, customer UNKNOWN → promotes customer to CUSTOMER', async () => {
    const agent = participant('PA_A', 'AI_AGENT', AGENT_ADDR);
    const customerUnknown = participant('PA_C', 'UNKNOWN', CUSTOMER_ADDR);
    const promoted = participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR);

    mockListParticipants([agent, customerUnknown]);
    mockAdapter
      .onPut(`/v2/Conversations/${CONV_ID}/Participants/PA_C`)
      .reply(200, promoted);
    // Stub lookup to miss, create to return an id.
    stubLookupProfile.mockResolvedValue({ normalizedValue: CUSTOMER_ADDR, profiles: [] });
    stubCreateProfile.mockResolvedValue('mem_profile_01new');

    const result = await callReconcile();

    expect(result).not.toBeNull();
    expect(result![0].id).toBe('PA_A');
    expect(result![1]).not.toBeNull();
    expect(result![1]!.id).toBe('PA_C');
    expect(result![1]!.type).toBe('CUSTOMER');
    expect(mockAdapter.history.put.length).toBe(1);
    const putBody = JSON.parse(mockAdapter.history.put[0]!.data);
    expect(putBody.type).toBe('CUSTOMER');
    expect(putBody.profileId).toBe('mem_profile_01new');
  });

  it('agent UNKNOWN, customer CUSTOMER → promotes agent to AI_AGENT', async () => {
    const agentUnknown = participant('PA_A', 'UNKNOWN', AGENT_ADDR);
    const customer = participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR);
    const promoted = participant('PA_A', 'AI_AGENT', AGENT_ADDR);

    mockListParticipants([agentUnknown, customer]);
    mockAdapter
      .onPut(`/v2/Conversations/${CONV_ID}/Participants/PA_A`)
      .reply(200, promoted);

    const result = await callReconcile();

    expect(result).not.toBeNull();
    expect(result![0].id).toBe('PA_A');
    expect(result![0].type).toBe('AI_AGENT');
    expect(result![1]!.id).toBe('PA_C');
    expect(mockAdapter.history.put.length).toBe(1);
    const putBody = JSON.parse(mockAdapter.history.put[0]!.data);
    expect(putBody.type).toBe('AI_AGENT');
  });

  it('both sides UNKNOWN → two PUTs', async () => {
    const agentUnknown = participant('PA_A', 'UNKNOWN', AGENT_ADDR);
    const customerUnknown = participant('PA_C', 'UNKNOWN', CUSTOMER_ADDR);
    const promotedAgent = participant('PA_A', 'AI_AGENT', AGENT_ADDR);
    const promotedCustomer = participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR);

    mockListParticipants([agentUnknown, customerUnknown]);
    mockAdapter
      .onPut(`/v2/Conversations/${CONV_ID}/Participants/PA_A`)
      .reply(200, promotedAgent);
    mockAdapter
      .onPut(`/v2/Conversations/${CONV_ID}/Participants/PA_C`)
      .reply(200, promotedCustomer);
    stubLookupProfile.mockResolvedValue({ normalizedValue: CUSTOMER_ADDR, profiles: [] });
    stubCreateProfile.mockResolvedValue('mem_profile_01new');

    const result = await callReconcile();

    expect(result).not.toBeNull();
    expect(result![0].type).toBe('AI_AGENT');
    expect(result![1]!.type).toBe('CUSTOMER');
    expect(mockAdapter.history.put.length).toBe(2);
  });

  it.each(['HUMAN_AGENT', 'CUSTOMER'])(
    "non-agent type '%s' at our address refuses to overwrite",
    async conflictingType => {
      // HUMAN_AGENT / CUSTOMER owning TAC's (channel, address) is someone
      // else's assignment — refuse and bail.
      const conflicting = participant('PA_A', conflictingType, AGENT_ADDR);
      const customer = participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR);
      mockListParticipants([conflicting, customer]);

      const result = await callReconcile();

      expect(result).toBeNull();
      expect(mockAdapter.history.put.length).toBe(0);
      expect(mockAdapter.history.post.length).toBe(0);
    }
  );

  it('solo customer → POST AI_AGENT, then use', async () => {
    const customer = participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR);
    const createdAgent = participant('PA_A', 'AI_AGENT', AGENT_ADDR);
    mockListParticipants([customer]);
    mockAdapter
      .onPost(`/v2/Conversations/${CONV_ID}/Participants`)
      .reply(201, createdAgent);

    const result = await callReconcile();

    expect(result).not.toBeNull();
    expect(result![0].id).toBe('PA_A');
    expect(result![0].type).toBe('AI_AGENT');
    expect(result![1]!.id).toBe('PA_C');
    expect(mockAdapter.history.post.length).toBe(1);
    const postBody = JSON.parse(mockAdapter.history.post[0]!.data);
    expect(postBody.type).toBe('AI_AGENT');
    expect(postBody.addresses[0].address).toBe(AGENT_ADDR);
  });

  it('POST AI_AGENT returns 409 → null (Conversation Orchestrator structural conflict)', async () => {
    // A 409 here signals something structural (duplicate conversation,
    // address already owned, grouping constraint) that TAC can't safely
    // paper over by retrying.
    const customer = participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR);
    mockListParticipants([customer]);
    mockAdapter
      .onPost(`/v2/Conversations/${CONV_ID}/Participants`)
      .reply(409, { message: 'already owned' });

    const result = await callReconcile();

    expect(result).toBeNull();
  });

  it('PUT promotion returns 409 → null', async () => {
    const agentUnknown = participant('PA_A', 'UNKNOWN', AGENT_ADDR);
    const customer = participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR);
    mockListParticipants([agentUnknown, customer]);
    mockAdapter
      .onPut(`/v2/Conversations/${CONV_ID}/Participants/PA_A`)
      .reply(409, { message: 'conflict' });

    const result = await callReconcile();

    expect(result).toBeNull();
  });

  it('listParticipants failure → null (skips the webhook)', async () => {
    mockAdapter
      .onGet(`/v2/Conversations/${CONV_ID}/Participants`)
      .networkError();

    const result = await callReconcile();

    expect(result).toBeNull();
    expect(mockAdapter.history.put.length).toBe(0);
  });

  it('customer promotion: lookup miss creates a profile with configured trait group/field', async () => {
    const agent = participant('PA_A', 'AI_AGENT', AGENT_ADDR);
    const customerUnknown = participant('PA_C', 'UNKNOWN', CUSTOMER_ADDR);
    const promoted = participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR);

    mockListParticipants([agent, customerUnknown]);
    mockAdapter
      .onPut(`/v2/Conversations/${CONV_ID}/Participants/PA_C`)
      .reply(200, promoted);

    stubLookupProfile.mockResolvedValue({ normalizedValue: CUSTOMER_ADDR, profiles: [] });
    stubCreateProfile.mockResolvedValue('mem_profile_01new');

    const result = await callReconcile();

    expect(result).not.toBeNull();
    expect(stubLookupProfile).toHaveBeenCalledTimes(1);
    expect(stubCreateProfile).toHaveBeenCalledTimes(1);
    expect(stubCreateProfile).toHaveBeenCalledWith({
      Contact: { phone: CUSTOMER_ADDR },
    });
    const putBody = JSON.parse(mockAdapter.history.put[0]!.data);
    expect(putBody.profileId).toBe('mem_profile_01new');
  });

  it('customer promotion proceeds without profile when lookup and create both fail', async () => {
    const agent = participant('PA_A', 'AI_AGENT', AGENT_ADDR);
    const customerUnknown = participant('PA_C', 'UNKNOWN', CUSTOMER_ADDR);
    const promoted = participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR);

    mockListParticipants([agent, customerUnknown]);
    mockAdapter
      .onPut(`/v2/Conversations/${CONV_ID}/Participants/PA_C`)
      .reply(200, promoted);

    // Both lookup and create fail — reconciliation still promotes, just
    // without a profileId attached.
    const networkErr = new AxiosError('conversation memory down');
    stubLookupProfile.mockRejectedValue(networkErr);
    stubCreateProfile.mockRejectedValue(networkErr);

    const result = await callReconcile();

    expect(result).not.toBeNull();
    const putBody = JSON.parse(mockAdapter.history.put[0]!.data);
    expect(putBody.type).toBe('CUSTOMER');
    expect(putBody.profileId).toBeUndefined();
  });

  it('surfaces reconcile failure via onError instead of silently dropping the inbound', async () => {
    // Reconcile fails (listParticipants unreachable) so the inbound can't be
    // matched to sendable participants. The message is intentionally not
    // delivered to the LLM (any reply would fail too), but the drop must be
    // observable by the app via the error callback — not swallowed.
    mockAdapter.onGet(`/v2/Conversations/${CONV_ID}/Participants`).networkError();

    const errors: { error: Error; context?: Record<string, unknown> }[] = [];
    channel.on('error', data => errors.push(data));

    const messageCallback = vi.fn();
    channel.on('messageReceived', messageCallback);

    await channel.processWebhook({
      eventType: 'COMMUNICATION_CREATED',
      data: {
        id: 'comms_communication_01test',
        conversationId: CONV_ID,
        content: { type: 'TEXT', text: 'hello' },
        author: { address: CUSTOMER_ADDR, channel: 'SMS', participantId: 'PA_C' },
      },
    });

    expect(messageCallback).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.context?.conversation_id).toBe(CONV_ID);
  });

  it('reconciliation lifts customer profileId onto session.profileId', async () => {
    // When reconcile resolves a CUSTOMER that already has a profileId
    // (set by a prior reconciliation / Conversation Memory identity-resolution), the
    // handler should copy it onto session.profileId so retrieveMemory's
    // fallback path doesn't redo the lookup.
    const agent = participant('PA_A', 'AI_AGENT', AGENT_ADDR);
    const customerWithProfile: ConversationParticipant = {
      ...participant('PA_C', 'CUSTOMER', CUSTOMER_ADDR),
      profileId: 'mem_profile_01abc',
    };
    mockListParticipants([agent, customerWithProfile]);

    const webhookEvent = {
      eventType: 'COMMUNICATION_CREATED',
      data: {
        id: 'comms_communication_01test',
        conversationId: CONV_ID,
        content: { type: 'TEXT', text: 'hi' },
        author: {
          address: CUSTOMER_ADDR,
          channel: 'SMS',
          participantId: 'PA_C',
        },
      },
    };

    // Short-circuit memory retrieval so we focus on the profileId lift.
    vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as never);

    await channel.processWebhook(webhookEvent);

    const session = (
      channel as unknown as { activeConversations: Map<string, { profileId?: string }> }
    ).activeConversations.get(CONV_ID);
    expect(session).toBeDefined();
    expect(session!.profileId).toBe('mem_profile_01abc');
  });
});
