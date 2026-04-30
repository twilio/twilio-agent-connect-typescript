import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import {
  ConversationSession,
  HandoffPayload,
  TAC,
  TACConfig,
  TACConfigData,
  studioExecutionsUrl,
  studioVoiceHandoffUrl,
} from '@twilio/tac-core';
import {
  buildHandoffPayload,
  createStudioHandoffTool,
  postStudioHandoff,
  TACTool,
} from '@twilio/tac-tools';
import { createTestTAC } from './helpers/tac';

const FLOW_SID = 'FW' + 'a'.repeat(32);
const ACCOUNT_SID = 'ACtest123456789';

function getTestConfig(overrides: Partial<TACConfigData> = {}): TACConfigData {
  return {
    accountSid: ACCOUNT_SID,
    authToken: 'test_token_123',
    apiKey: 'SK123',
    apiSecret: 'test_api_secret',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
    studioHandoffFlowSid: FLOW_SID,
    ...overrides,
  };
}

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    conversationId: 'conv_123',
    channel: 'voice',
    startedAt: new Date(),
    metadata: {},
    ...overrides,
  };
}

describe('Studio URL helpers', () => {
  it('studioExecutionsUrl builds the correct URL', () => {
    expect(studioExecutionsUrl(FLOW_SID)).toBe(
      `https://studio.twilio.com/v2/Flows/${FLOW_SID}/Executions`
    );
  });

  it('studioVoiceHandoffUrl builds the correct URL', () => {
    expect(studioVoiceHandoffUrl(ACCOUNT_SID, FLOW_SID)).toBe(
      `https://webhooks.twilio.com/v1/Accounts/${ACCOUNT_SID}/Flows/${FLOW_SID}?Trigger=incomingCall`
    );
  });
});

describe('buildHandoffPayload', () => {
  it('includes all session context and attributes', () => {
    const session = makeSession({ profileId: 'prof_456' });
    const payload = buildHandoffPayload(session, 'mem_service_xyz', { reason: 'test' });

    expect(payload.conversationId).toBe('conv_123');
    expect(payload.storeId).toBe('mem_service_xyz');
    expect(payload.profileId).toBe('prof_456');
    expect(payload.attributes).toEqual({ reason: 'test' });
  });

  it('emits empty profileId when session has none', () => {
    const session = makeSession();
    const payload = buildHandoffPayload(session, '', {});
    expect(payload.profileId).toBe('');
  });
});

describe('createStudioHandoffTool factory', () => {
  it('returns a TACTool named "handoff"', async () => {
    const tac = await createTestTAC(getTestConfig());
    const tool = createStudioHandoffTool(tac, makeSession());
    expect(tool).toBeInstanceOf(TACTool);
    expect(tool.name).toBe('handoff');
  });

  it('honours custom name and description', async () => {
    const tac = await createTestTAC(getTestConfig());
    const tool = createStudioHandoffTool(tac, makeSession(), {
      name: 'escalate_to_agent',
      description: 'Escalate only for billing disputes.',
    });
    expect(tool.name).toBe('escalate_to_agent');
    expect(tool.description).toBe('Escalate only for billing disputes.');
  });

  it('LLM schema only exposes the "reason" parameter', async () => {
    const tac = await createTestTAC(getTestConfig());
    const tool = createStudioHandoffTool(tac, makeSession());
    expect(tool.parameters.properties).toHaveProperty('reason');
    expect(tool.parameters.required).toContain('reason');
  });

  it('throws when studioHandoffFlowSid is not configured', async () => {
    const tac = await createTestTAC(getTestConfig({ studioHandoffFlowSid: undefined }));
    expect(() => createStudioHandoffTool(tac, makeSession())).toThrowError(
      /studioHandoffFlowSid/
    );
  });

  it('throws in voice-only mode (no Conversation Orchestrator)', async () => {
    const config = new TACConfig({
      accountSid: ACCOUNT_SID,
      authToken: 'test_token_123',
      apiKey: 'SK123',
      apiSecret: 'test_api_secret',
      phoneNumber: '+15551234567',
      studioHandoffFlowSid: FLOW_SID,
    });
    const tac = await TAC.create({ config });

    expect(() => createStudioHandoffTool(tac, makeSession())).toThrowError(
      /Conversation Orchestrator/
    );
  });
});

describe('handoff tool execution — voice channel', () => {
  it('stores pending handoff payload on session for deferred delivery', async () => {
    const tac = await createTestTAC(getTestConfig());
    vi.spyOn(tac.getConversationClient(), 'updateConversation').mockResolvedValue({} as never);
    vi.spyOn(tac.getConversationClient(), 'clearStatusCallbacks').mockResolvedValue();

    const session = makeSession({ profileId: 'prof_456', channel: 'voice' });
    const tool = createStudioHandoffTool(tac, session);

    const result = await tool.implementation({ reason: 'Customer wants human agent' });

    expect(session.pendingHandoffData).toBeDefined();
    expect(session.pendingHandoffData?.type).toBe('end');

    const parsed = JSON.parse(session.pendingHandoffData!.handoffData) as HandoffPayload;
    expect(parsed.conversationId).toBe('conv_123');
    expect(parsed.profileId).toBe('prof_456');
    expect(parsed.attributes['reason']).toBe('Customer wants human agent');

    expect(result).toEqual({ status: 'handoff_initiated', channel: 'voice' });
  });

  it('sets conversation status to INACTIVE and clears status callbacks', async () => {
    const tac = await createTestTAC(getTestConfig());
    const updateSpy = vi
      .spyOn(tac.getConversationClient(), 'updateConversation')
      .mockResolvedValue({} as never);
    const clearSpy = vi
      .spyOn(tac.getConversationClient(), 'clearStatusCallbacks')
      .mockResolvedValue();

    const session = makeSession({ channel: 'voice' });
    const tool = createStudioHandoffTool(tac, session);
    await tool.implementation({ reason: 'Escalation needed' });

    expect(updateSpy).toHaveBeenCalledWith('conv_123', 'INACTIVE');
    expect(clearSpy).toHaveBeenCalledWith('conv_123');
  });

  it('succeeds even if updateConversation fails', async () => {
    const tac = await createTestTAC(getTestConfig());
    vi.spyOn(tac.getConversationClient(), 'updateConversation').mockRejectedValue(
      new Error('API error')
    );
    vi.spyOn(tac.getConversationClient(), 'clearStatusCallbacks').mockResolvedValue();

    const session = makeSession({ channel: 'voice' });
    const tool = createStudioHandoffTool(tac, session);
    const result = await tool.implementation({ reason: 'test' });

    expect(result).toEqual({ status: 'handoff_initiated', channel: 'voice' });
    expect(session.pendingHandoffData).toBeDefined();
  });

  it('succeeds even if clearStatusCallbacks fails', async () => {
    const tac = await createTestTAC(getTestConfig());
    vi.spyOn(tac.getConversationClient(), 'updateConversation').mockResolvedValue({} as never);
    vi.spyOn(tac.getConversationClient(), 'clearStatusCallbacks').mockRejectedValue(
      new Error('API error')
    );

    const session = makeSession({ channel: 'voice' });
    const tool = createStudioHandoffTool(tac, session);
    const result = await tool.implementation({ reason: 'test' });

    expect(result).toEqual({ status: 'handoff_initiated', channel: 'voice' });
    expect(session.pendingHandoffData).toBeDefined();
  });
});

describe('handoff tool execution — digital channels', () => {
  beforeEach(() => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to the Studio Flow Executions URL with form-encoded body + Basic auth', async () => {
    const tac = await createTestTAC(
      getTestConfig({
        phoneNumber: '+15551234567',
        apiKey: 'SK_key',
        apiSecret: 'tok',
      })
    );
    vi.spyOn(tac.getConversationClient(), 'updateConversation').mockResolvedValue({} as never);
    vi.spyOn(tac.getConversationClient(), 'clearStatusCallbacks').mockResolvedValue();

    const session = makeSession({ channel: 'sms' });
    const tool = createStudioHandoffTool(tac, session);
    const result = await tool.implementation({ reason: 'Customer wants human' });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = (axios.post as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0] as [string, string, { auth: { username: string; password: string } }];
    expect(url).toBe(`https://studio.twilio.com/v2/Flows/${FLOW_SID}/Executions`);
    expect(options.auth).toEqual({ username: 'SK_key', password: 'tok' });

    // Body is URL-encoded, including top-level HandoffData key under Parameters
    const parsed = new URLSearchParams(body);
    expect(parsed.get('From')).toBe('+15551234567');
    const params = JSON.parse(parsed.get('Parameters') ?? '{}') as {
      HandoffData: HandoffPayload;
    };
    expect(params.HandoffData.conversationId).toBe('conv_123');
    expect(params.HandoffData.attributes['reason']).toBe('Customer wants human');

    // Digital channels should not store pending handoff data.
    expect(session.pendingHandoffData).toBeUndefined();
    expect(result).toEqual({ status: 'handoff_initiated', channel: 'sms' });
  });

  it('returns handoff_failed when Studio POST raises (not a silent success)', async () => {
    (axios.post as unknown as { mockReset: () => void }).mockReset();
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('boom'));

    const tac = await createTestTAC(getTestConfig());
    vi.spyOn(tac.getConversationClient(), 'updateConversation').mockResolvedValue({} as never);
    vi.spyOn(tac.getConversationClient(), 'clearStatusCallbacks').mockResolvedValue();

    const session = makeSession({ channel: 'sms' });
    const tool = createStudioHandoffTool(tac, session);
    const result = await tool.implementation({ reason: 'Customer wants human' });

    expect(result.status).toBe('handoff_failed');
    expect(result.channel).toBe('sms');
    expect(result.error).toContain('boom');
  });
});

describe('handoff tool attributes', () => {
  it('merges static attributes into the payload with LLM reason winning', async () => {
    const tac = await createTestTAC(getTestConfig());
    vi.spyOn(tac.getConversationClient(), 'updateConversation').mockResolvedValue({} as never);
    vi.spyOn(tac.getConversationClient(), 'clearStatusCallbacks').mockResolvedValue();

    const session = makeSession({ channel: 'voice' });
    const tool = createStudioHandoffTool(tac, session, {
      attributes: { reason: 'static reason', department: 'billing' },
    });
    await tool.implementation({ reason: 'LLM reason' });

    const parsed = JSON.parse(session.pendingHandoffData!.handoffData) as HandoffPayload;
    expect(parsed.attributes['reason']).toBe('LLM reason');
    expect(parsed.attributes['department']).toBe('billing');
  });
});

describe('postStudioHandoff', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends form-encoded To/From/Parameters and Basic auth', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });

    const payload: HandoffPayload = {
      conversationId: 'conv_123',
      storeId: 'mem_abc',
      profileId: 'prof_456',
      attributes: { reason: 'test', team: 'billing' },
    };
    const session = makeSession({
      channel: 'sms',
      authorInfo: { address: '+15559998888' },
    });

    await postStudioHandoff(payload, session, {
      handoffUrl: 'https://studio.twilio.com/v2/Flows/FWxxx/Executions',
      fromAddress: '+15551234567',
      apiKey: 'SK_test_key',
      apiSecret: 'secret_token',
    });

    const [url, body, options] = postSpy.mock.calls[0] as [
      string,
      string,
      { auth: { username: string; password: string }; headers: Record<string, string> },
    ];
    expect(url).toBe('https://studio.twilio.com/v2/Flows/FWxxx/Executions');
    expect(options.auth).toEqual({ username: 'SK_test_key', password: 'secret_token' });
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const parsed = new URLSearchParams(body);
    expect(parsed.get('To')).toBe('+15559998888');
    expect(parsed.get('From')).toBe('+15551234567');
    const params = JSON.parse(parsed.get('Parameters') ?? '{}') as {
      HandoffData: HandoffPayload;
    };
    expect(params.HandoffData.conversationId).toBe('conv_123');
    expect(params.HandoffData.storeId).toBe('mem_abc');
    expect(params.HandoffData.profileId).toBe('prof_456');
  });

  it('sends empty To when session has no authorInfo', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });

    const payload: HandoffPayload = {
      conversationId: 'conv_123',
      storeId: 'mem_abc',
      profileId: '',
      attributes: {},
    };
    const session = makeSession({ channel: 'sms' });

    await postStudioHandoff(payload, session, {
      handoffUrl: 'https://studio.twilio.com/v2/Flows/FWxxx/Executions',
      fromAddress: '+15551234567',
      apiKey: 'SK',
      apiSecret: 'tok',
    });

    const [, body] = postSpy.mock.calls[0] as [string, string];
    const parsed = new URLSearchParams(body);
    expect(parsed.get('To')).toBe('');
    expect(parsed.get('From')).toBe('+15551234567');
  });
});
