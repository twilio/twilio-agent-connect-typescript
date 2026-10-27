import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockTrack = vi.fn();
const mockCloseAndFlush = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();

vi.mock('@segment/analytics-node', () => ({
  Analytics: class MockAnalytics {
    track = mockTrack;
    closeAndFlush = mockCloseAndFlush;
    on = mockOn;
  },
}));

import { trackEvent, shutdownAnalytics, _resetAnalytics } from '../packages/core/src/lib/analytics';
import { SMSChannel, VoiceChannel, WhatsAppChannel } from '@twilio/tac-core';
import type { ConversationParticipant, ConversationSession, TAC } from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';

describe('analytics', () => {
  beforeEach(() => {
    _resetAnalytics();
    mockTrack.mockClear();
    mockCloseAndFlush.mockClear();
    mockOn.mockClear();
    delete process.env.TAC_ANALYTICS_DISABLED;
  });

  afterEach(() => {
    delete process.env.TAC_ANALYTICS_DISABLED;
  });

  it('tracks an event with correct shape', () => {
    trackEvent('Websocket Connected', {
      account_sid: 'AC123',
      channel: 'voice',
      conversation_id: 'conv-1',
    });

    expect(mockTrack).toHaveBeenCalledWith({
      anonymousId: 'AC123',
      event: 'Websocket Connected',
      properties: {
        account_sid: 'AC123',
        channel: 'voice',
        conversation_id: 'conv-1',
        sdk_version: expect.any(String),
        sdk_package: 'twilio-agent-connect-typescript',
      },
    });
  });

  it('omits properties the caller does not supply', () => {
    trackEvent('Websocket Connected', {
      account_sid: 'AC123',
      channel: 'voice',
    });

    expect(mockTrack).toHaveBeenCalledWith({
      anonymousId: 'AC123',
      event: 'Websocket Connected',
      properties: {
        account_sid: 'AC123',
        channel: 'voice',
        sdk_version: expect.any(String),
        sdk_package: 'twilio-agent-connect-typescript',
      },
    });
  });

  it('uses account_sid as anonymousId', () => {
    trackEvent('Conversation Started', {
      account_sid: 'AC456',
      channel: 'sms',
      conversation_id: 'conv-2',
    });

    expect(mockTrack).toHaveBeenCalledWith(expect.objectContaining({ anonymousId: 'AC456' }));
  });

  it('does not track when TAC_ANALYTICS_DISABLED=true', () => {
    process.env.TAC_ANALYTICS_DISABLED = 'true';
    _resetAnalytics();

    trackEvent('Websocket Connected', {
      account_sid: 'AC123',
      channel: 'voice',
      conversation_id: 'conv-1',
    });

    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('shutdownAnalytics calls closeAndFlush', async () => {
    trackEvent('Websocket Connected', {
      account_sid: 'AC123',
      channel: 'voice',
      conversation_id: 'conv-1',
    });

    await shutdownAnalytics();

    expect(mockCloseAndFlush).toHaveBeenCalledWith({ timeout: 5000 });
  });

  it('shutdownAnalytics is a no-op when no client exists', async () => {
    await shutdownAnalytics();
    expect(mockCloseAndFlush).not.toHaveBeenCalled();
  });

  it('does not throw when track throws', () => {
    mockTrack.mockImplementationOnce(() => {
      throw new Error('network error');
    });

    expect(() =>
      trackEvent('Websocket Connected', {
        account_sid: 'AC123',
        channel: 'voice',
        conversation_id: 'conv-1',
      })
    ).not.toThrow();
  });

  it('requires account_sid in properties at compile time', () => {
    trackEvent('Conversation Started', {
      account_sid: 'AC789',
      channel: 'sms',
      conversation_id: 'conv-3',
    });

    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ account_sid: 'AC789' }),
      })
    );
  });
});

const CONFIGURATION_ID = 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd';

const tacConfig = {
  accountSid: 'ACtest123',
  authToken: 'test_token',
  apiKey: 'test_key',
  apiSecret: 'test_secret',
  phoneNumber: '+15551234567',
  whatsappNumber: 'whatsapp:+15551234567',
  conversationConfigurationId: CONFIGURATION_ID,
};

/** A CO PARTICIPANT_ADDED webhook, shaped like CO's documented example. */
const participantAdded = (
  conversationId: string,
  type: string,
  channel: string,
  address: string,
  profileId?: string
) => ({
  eventType: 'PARTICIPANT_ADDED',
  data: {
    id: `PA_${type}_${channel}`,
    conversationId,
    accountId: 'ACtest123',
    name: address,
    type,
    ...(profileId ? { profileId } : {}),
    addresses: [{ channel, address, channelId: null }],
  },
});

/** A CO CONVERSATION_UPDATED/CLOSED webhook (no channel info, as documented). */
const conversationClosed = (
  conversationId: string,
  createdAt: string | null = '2026-09-30T10:00:00Z',
  updatedAt: string | null = '2026-09-30T10:05:00Z'
) => ({
  eventType: 'CONVERSATION_UPDATED',
  data: {
    id: conversationId,
    accountId: 'ACtest123',
    configurationId: CONFIGURATION_ID,
    status: 'CLOSED',
    ...(createdAt !== null ? { createdAt } : {}),
    ...(updatedAt !== null ? { updatedAt } : {}),
  },
});

const coParticipant = (
  type: string,
  channel: string,
  address: string,
  conversationId = 'conv-1'
): ConversationParticipant => ({
  id: `PA_${type}_${channel}`,
  conversationId,
  accountId: 'ACtest123',
  name: address,
  type: type as ConversationParticipant['type'],
  addresses: [{ channel: channel as 'SMS', address }],
});

type TrackCall = { event: string; properties: Record<string, unknown> };
const tracked = (): TrackCall[] => mockTrack.mock.calls.map(call => call[0] as TrackCall);
const only = (event: string): TrackCall => {
  const matching = tracked().filter(c => c.event === event);
  expect(matching).toHaveLength(1);
  return matching[0]!;
};

describe('messaging analytics', () => {
  let tac: TAC;

  beforeEach(async () => {
    _resetAnalytics();
    mockTrack.mockClear();
    delete process.env.TAC_ANALYTICS_DISABLED;
    tac = await createTestTAC(tacConfig);
  });

  afterEach(() => {
    process.env.TAC_ANALYTICS_DISABLED = 'true';
    _resetAnalytics();
    vi.restoreAllMocks();
  });

  const stubListParticipants = (participants: ConversationParticipant[]) =>
    vi.spyOn(tac.getConversationClient()!, 'listParticipants').mockResolvedValue(participants);

  describe('Response Sent', () => {
    const session = (): ConversationSession => ({
      conversationId: 'conv-1',
      channel: 'sms',
      startedAt: new Date(),
      metadata: {},
      authorInfo: { address: '+15551112222', participantId: 'p-customer' },
      aiAgentInfo: { address: '+15551234567', participantId: 'p-agent' },
    });

    it('is reported on a successful send', async () => {
      const channel = new SMSChannel(tac);
      vi.spyOn(tac.getConversationClient()!, 'createAction').mockResolvedValue(undefined as never);
      const lookup = stubListParticipants([]);

      await channel.sendResponse(session(), 'hello');

      expect(only('Response Sent').properties.channel).toBe('sms');
      // The session already carries both participants: no lookup.
      expect(lookup).not.toHaveBeenCalled();
    });

    it('is not reported when the send fails', async () => {
      const channel = new SMSChannel(tac);
      vi.spyOn(tac.getConversationClient()!, 'createAction').mockRejectedValue(
        new Error('Orchestrator down')
      );

      await expect(channel.sendResponse(session(), 'hello')).rejects.toThrow('Orchestrator down');

      expect(tracked().filter(c => c.event === 'Response Sent')).toHaveLength(0);
    });
  });

  describe('lifecycle from Conversation Orchestrator', () => {
    it('reports Conversation Started when the customer is added', async () => {
      const channel = new SMSChannel(tac);

      await channel.processWebhook(
        participantAdded('conv-1', 'CUSTOMER', 'SMS', '+15551112222', 'mem_profile_1')
      );

      const { properties } = only('Conversation Started');
      expect(properties.channel).toBe('sms');
      expect(properties.conversation_id).toBe('conv-1');
      expect(properties.has_profile_id).toBe(true);
    });

    it('reports Conversation Started for an untyped customer', async () => {
      // Capture can add the customer as UNKNOWN before reconciliation.
      const channel = new SMSChannel(tac);

      await channel.processWebhook(participantAdded('conv-1', 'UNKNOWN', 'SMS', '+15551112222'));

      expect(only('Conversation Started').properties.has_profile_id).toBe(false);
    });

    it.each([
      ['UNKNOWN', '+15551234567'],
      ['AI_AGENT', '+15551234567'],
      ['HUMAN_AGENT', '+1555'],
    ])('does not count a %s participant (%s) as a start', async (type, address) => {
      // +15551234567 is TAC's own number (phoneNumber in the test config).
      const channel = new SMSChannel(tac);

      await channel.processWebhook(participantAdded('conv-1', type, 'SMS', address));

      expect(tracked().filter(c => c.event === 'Conversation Started')).toHaveLength(0);
    });

    it("ignores another channel's participant", async () => {
      const channel = new SMSChannel(tac);

      await channel.processWebhook(
        participantAdded('conv-1', 'CUSTOMER', 'WHATSAPP', '+15551112222')
      );

      expect(tracked()).toHaveLength(0);
    });

    it("reports Conversation Ended on CLOSED with CO's duration, without a lookup", async () => {
      const channel = new SMSChannel(tac);
      const lookup = stubListParticipants([]);

      await channel.processWebhook(conversationClosed('conv-1'));

      const { properties } = only('Conversation Ended');
      // The payload doesn't say which channel; no call is made to find out.
      expect(properties).not.toHaveProperty('channel');
      expect(properties.conversation_id).toBe('conv-1');
      expect(properties.duration_ms).toBe(300_000);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('looks up participants on CLOSED only for an onConversationEnded handler', async () => {
      const channel = new SMSChannel(tac);
      tac.registerChannel(channel);
      const ended: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        ended.push(session);
      });
      const lookup = stubListParticipants([
        coParticipant('CUSTOMER', 'SMS', '+15551112222'),
        coParticipant('AI_AGENT', 'SMS', '+15551234567'),
      ]);

      await channel.processWebhook(conversationClosed('conv-1'));

      expect(ended.map(s => s.conversationId)).toEqual(['conv-1']);
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(only('Conversation Ended').properties).not.toHaveProperty('channel');
    });

    it('ignores a CLOSED for another conversation configuration', async () => {
      const channel = new SMSChannel(tac);
      const lookup = stubListParticipants([coParticipant('CUSTOMER', 'SMS', '+15551112222')]);
      const webhook = conversationClosed('conv-1');
      webhook.data.configurationId = 'conv_configuration_other';

      await channel.processWebhook(webhook);

      expect(lookup).not.toHaveBeenCalled();
      expect(tracked()).toHaveLength(0);
    });

    it('reports a CLOSED once across the channels it is handed to', async () => {
      const sms = new SMSChannel(tac);
      const whatsapp = new WhatsAppChannel(tac);
      const voice = new VoiceChannel(tac);
      const lookup = stubListParticipants([]);
      const webhook = conversationClosed('conv-1');

      await Promise.all([
        sms.processWebhook(webhook),
        whatsapp.processWebhook(webhook),
        voice.processWebhook(webhook),
      ]);

      expect(only('Conversation Ended').properties.conversation_id).toBe('conv-1');
      expect(lookup).not.toHaveBeenCalled();
    });

    it('reports a CLOSED for a live voice call once, without a lookup', async () => {
      const voice = new VoiceChannel(tac);
      const sms = new SMSChannel(tac);
      const lookup = stubListParticipants([]);
      const webhook = conversationClosed('conv-1');
      // A call this instance still holds: CO closed its conversation mid-call.
      (
        voice as unknown as { startConversation(id: string): ConversationSession }
      ).startConversation('conv-1');

      await Promise.all([voice.processWebhook(webhook), sms.processWebhook(webhook)]);

      expect(only('Conversation Ended').properties).not.toHaveProperty('channel');
      expect(lookup).not.toHaveBeenCalled();
    });

    it('leaves duration_ms out when a timestamp is missing', async () => {
      const channel = new SMSChannel(tac);

      await channel.processWebhook(conversationClosed('conv-1', null));

      expect(only('Conversation Ended').properties).not.toHaveProperty('duration_ms');
    });

    it('costs nothing on CLOSED with analytics off and no handler', async () => {
      process.env.TAC_ANALYTICS_DISABLED = 'true';
      _resetAnalytics();
      const channel = new SMSChannel(tac);
      const lookup = stubListParticipants([]);

      await channel.processWebhook(conversationClosed('conv-1'));

      expect(lookup).not.toHaveBeenCalled();
    });
  });
});
