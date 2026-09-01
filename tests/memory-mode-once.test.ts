import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SMSChannel, TAC } from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';

/**
 * Tests for "once" memory mode: fetch once with an empty query, cache it on the
 * session, and invalidate the cache when the conversation becomes INACTIVE.
 * Mirrors the Python SDK's test_memory_mode_once.py.
 */
describe('Memory mode "once"', () => {
  const getTestConfig = () => ({
    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let tac: TAC;
  let channel: SMSChannel;

  const conversationId = 'CHtest123456789';

  const communicationWebhook = (text: string, commId: string) => ({
    eventType: 'COMMUNICATION_CREATED',
    data: {
      id: commId,
      conversationId,
      content: { type: 'TEXT', text },
      author: { address: '+15559876543', channel: 'SMS' },
    },
  });

  beforeEach(async () => {
    tac = await createTestTAC(getTestConfig());
    channel = new SMSChannel(tac, { memoryMode: 'once' });

    // Short-circuit reconcileParticipants so webhook processing doesn't need to
    // mock listParticipants. Spy on the prototype so it applies to any instance.
    vi.spyOn(SMSChannel.prototype as any, 'reconcileParticipants').mockResolvedValue([
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
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches memory once and reuses the cache on subsequent messages', async () => {
    const memory = { fake: 'memory' };
    const spy = vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(memory as never);

    await channel.processWebhook(communicationWebhook('First', 'comm1'));
    await channel.processWebhook(communicationWebhook('Second', 'comm2'));
    await channel.processWebhook(communicationWebhook('Third', 'comm3'));

    // Only the first message triggers a retrieval; the rest use the cache.
    expect(spy).toHaveBeenCalledTimes(1);

    const session = channel.getConversationSession(conversationId as never);
    expect(session?.cachedMemory).toBe(memory);
  });

  it('retrieves with an empty query (no message passed as query)', async () => {
    const spy = vi.spyOn(tac, 'retrieveMemory').mockResolvedValue({} as never);

    await channel.processWebhook(communicationWebhook('Hello there', 'comm1'));

    expect(spy).toHaveBeenCalledTimes(1);
    // "once" mode must not forward the inbound message as the query.
    expect(spy.mock.calls[0]?.[1]).toBeUndefined();
    // ...nor the conversation id, which would trigger query expansion.
    expect(spy.mock.calls[0]?.[2]).toBeUndefined();
  });

  it('invalidates the cache on INACTIVE, then re-fetches on the next message', async () => {
    const spy = vi.spyOn(tac, 'retrieveMemory').mockResolvedValue({ v: 1 } as never);

    await channel.processWebhook(communicationWebhook('First', 'comm1'));
    expect(spy).toHaveBeenCalledTimes(1);

    const session = channel.getConversationSession(conversationId as never);
    expect(session?.cachedMemory).toBeDefined();

    // Conversation goes INACTIVE -> cache cleared.
    await channel.processWebhook({
      eventType: 'CONVERSATION_UPDATED',
      data: { conversationId, status: 'INACTIVE' },
    });
    expect(session?.cachedMemory).toBeUndefined();

    // Next message re-fetches.
    await channel.processWebhook(communicationWebhook('Second', 'comm2'));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not invalidate the cache on non-INACTIVE status updates', async () => {
    vi.spyOn(tac, 'retrieveMemory').mockResolvedValue({ v: 1 } as never);

    await channel.processWebhook(communicationWebhook('First', 'comm1'));
    const session = channel.getConversationSession(conversationId as never);
    const cachedBefore = session?.cachedMemory;
    expect(cachedBefore).toBeDefined();

    await channel.processWebhook({
      eventType: 'CONVERSATION_UPDATED',
      data: { conversationId, status: 'ACTIVE' },
    });

    expect(session?.cachedMemory).toBe(cachedBefore);
  });

});
