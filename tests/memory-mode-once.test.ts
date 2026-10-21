import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import type axios from 'axios';
import {
  ChatChannel,
  RCSChannel,
  SMSChannel,
  TAC,
  VoiceChannel,
  WhatsAppChannel,
} from '@twilio/tac-core';
import type { ConversationSession } from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';

/**
 * Tests for `memoryMode: "once"`.
 *
 * On voice, "once" primes a recall with no query and caches it on the session
 * for the rest of the call. It needs a session that outlives a single request,
 * which only voice has: a call is pinned to the instance holding its
 * WebSocket. The messaging channels hold nothing between webhooks, so on
 * messaging the mode is deprecated: it warns and runs as "always" rather than
 * degrading to a cacheless, query-less recall.
 *
 * Mirrors the Python SDK's test_memory_mode_once.py.
 */
describe('Memory mode "once"', () => {
  const getTestConfig = () => ({
    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    rcsSenderId: 'rcs:test_sender',
    whatsappNumber: 'whatsapp:+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  const conversationId = 'CHtest123456789';

  let tac: TAC;

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const memoryModeOf = (channel: unknown): string => (channel as { memoryMode: string }).memoryMode;

  describe('messaging channels deprecate "once"', () => {
    it.each([
      ['SMSChannel', SMSChannel],
      ['RCSChannel', RCSChannel],
      ['WhatsAppChannel', WhatsAppChannel],
      ['ChatChannel', ChatChannel],
    ] as const)('%s warns and runs as "always"', (name, ChannelClass) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const channel = new ChannelClass(tac, { memoryMode: 'once' });

      expect(memoryModeOf(channel)).toBe('always');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`memoryMode "once" on ${name} is deprecated`)
      );
    });

    it('leaves other modes untouched', () => {
      expect(memoryModeOf(new SMSChannel(tac, { memoryMode: 'never' }))).toBe('never');
      expect(memoryModeOf(new SMSChannel(tac, { memoryMode: 'always' }))).toBe('always');
      expect(memoryModeOf(new SMSChannel(tac))).toBe('never');
    });

    it('recalls on every message with the message as the query', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const channel = new SMSChannel(tac, { memoryMode: 'once' });
      const mockAdapter = new MockAdapter(
        (tac.getConversationClient() as unknown as { axiosInstance: typeof axios }).axiosInstance
      );
      mockAdapter.onGet(`/v2/Conversations/${conversationId}/Participants`).reply(200, {
        participants: [
          {
            id: 'PA111',
            conversationId,
            accountId: 'ACtest123456789',
            type: 'AI_AGENT',
            addresses: [{ channel: 'SMS', address: '+15551234567' }],
          },
          {
            id: 'PA222',
            conversationId,
            accountId: 'ACtest123456789',
            type: 'CUSTOMER',
            profileId: 'mem_profile_00000000000000000000000000',
            addresses: [{ channel: 'SMS', address: '+15559876543' }],
          },
        ],
      });
      const recall = vi.spyOn(tac, 'retrieveMemory').mockResolvedValue({} as never);

      for (const [text, id] of [
        ['First', 'comm1'],
        ['Second', 'comm2'],
      ] as const) {
        await channel.processWebhook({
          eventType: 'COMMUNICATION_CREATED',
          data: {
            id,
            conversationId,
            content: { type: 'TEXT', text },
            author: { address: '+15559876543', channel: 'SMS', participantId: 'PA222' },
          },
        });
      }

      // No cache: every message recalls, with its own query.
      expect(recall).toHaveBeenCalledTimes(2);
      expect(recall.mock.calls[0]?.[1]).toBe('First');
      expect(recall.mock.calls[0]?.[2]).toBe(conversationId);
      expect(recall.mock.calls[1]?.[1]).toBe('Second');
      mockAdapter.restore();
    });
  });

  describe('voice keeps "once"', () => {
    const newSession = (): ConversationSession => ({
      conversationId,
      channel: 'voice',
      startedAt: new Date(),
      metadata: {},
    });

    const retrieve = (
      channel: VoiceChannel,
      session: ConversationSession,
      query: string
    ): Promise<unknown> =>
      (
        channel as unknown as {
          retrieveMemoryIfEnabled: (s: ConversationSession, q?: string) => Promise<unknown>;
        }
      ).retrieveMemoryIfEnabled(session, query);

    it('does not warn or change the mode', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const channel = new VoiceChannel(tac, { memoryMode: 'once' });

      expect(memoryModeOf(channel)).toBe('once');
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('memoryMode "once"'));
    });

    it('fetches once with an empty query and reuses the cache', async () => {
      const channel = new VoiceChannel(tac, { memoryMode: 'once' });
      const memory = { fake: 'memory' };
      const recall = vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(memory as never);
      const session = newSession();

      expect(await retrieve(channel, session, 'first')).toBe(memory);
      expect(await retrieve(channel, session, 'second')).toBe(memory);

      expect(recall).toHaveBeenCalledTimes(1);
      // "once" must not forward the utterance as the query...
      expect(recall.mock.calls[0]?.[1]).toBeUndefined();
      // ...nor the conversation id, which would trigger query expansion.
      expect(recall.mock.calls[0]?.[2]).toBeUndefined();
      expect(session.cachedMemory).toBe(memory);
    });

    it('re-fetches once the cache is cleared', async () => {
      const channel = new VoiceChannel(tac, { memoryMode: 'once' });
      const recall = vi.spyOn(tac, 'retrieveMemory').mockResolvedValue({ v: 1 } as never);
      const session = newSession();

      await retrieve(channel, session, 'first');
      session.cachedMemory = undefined;
      await retrieve(channel, session, 'second');

      expect(recall).toHaveBeenCalledTimes(2);
    });
  });
});
