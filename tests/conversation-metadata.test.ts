import { describe, it, expect, vi } from 'vitest';
import type { ConversationSession } from '@twilio/tac-core';
import {
  CONVERSATION_METADATA_MAX_KEYS,
  fitConversationMetadata,
} from '../packages/core/src/util/conversation-metadata';
import {
  attachConversationMetadata,
  conversationMetadata,
} from '../packages/core/src/lib/conversation-session-helpers';

/**
 * Tests for fitting app metadata into Conversation Orchestrator's limits, and
 * for reading a session's CO metadata. Mirrors the Python SDK's
 * test_conversation_metadata.py and test_conversation_session.py.
 */
describe('fitConversationMetadata', () => {
  it('keeps valid entries', () => {
    expect(
      fitConversationMetadata({ appointment_id: 'apt_42', 'campaign.v2': 'spring-1' })
    ).toEqual({
      persisted: { appointment_id: 'apt_42', 'campaign.v2': 'spring-1' },
      skippedKeys: [],
    });
  });

  it.each([undefined, null])('gives nothing for %j', metadata => {
    expect(fitConversationMetadata(metadata)).toEqual({ persisted: {}, skippedKeys: [] });
  });

  it('treats direction as an ordinary app key', () => {
    expect(fitConversationMetadata({ direction: 'inbound' })).toEqual({
      persisted: { direction: 'inbound' },
      skippedKeys: [],
    });
  });

  it('skips entries CO would reject', () => {
    const longKey = 'k'.repeat(129);
    const { persisted, skippedKeys } = fitConversationMetadata({
      count: 3,
      'has space': 'x',
      [longKey]: 'x',
      long_value: 'v'.repeat(513),
      ok: 'fine',
    });

    expect(persisted).toEqual({ ok: 'fine' });
    expect([...skippedKeys].sort()).toEqual(['count', 'has space', longKey, 'long_value'].sort());
  });

  it('accepts a key and value at the length limits', () => {
    const key = 'k'.repeat(128);
    expect(fitConversationMetadata({ [key]: 'v'.repeat(512) }).skippedKeys).toEqual([]);
  });

  it('rejects a key with a trailing newline', () => {
    expect(fitConversationMetadata({ 'key\n': 'x' }).skippedKeys).toEqual(['key\n']);
  });

  it('caps at eight keys', () => {
    const app = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 'v']));

    const { persisted, skippedKeys } = fitConversationMetadata(app);

    expect(CONVERSATION_METADATA_MAX_KEYS).toBe(8);
    expect(Object.keys(persisted)).toEqual(Array.from({ length: 8 }, (_, i) => `k${i}`));
    expect(skippedKeys).toEqual(['k8']);
  });
});

describe('conversationMetadata', () => {
  const makeSession = (): ConversationSession => ({
    conversationId: 'CH1',
    channel: 'sms',
    startedAt: new Date(),
    metadata: {},
  });

  it('answers known metadata with no lookup', async () => {
    const session = makeSession();
    const loader = vi.fn().mockResolvedValue({ x: '1' });
    attachConversationMetadata(session, { known: { appointment_id: 'apt_42' }, loader });

    expect(await conversationMetadata(session)).toEqual({ appointment_id: 'apt_42' });
    expect(loader).not.toHaveBeenCalled();
  });

  it('loads once and keeps the result', async () => {
    const session = makeSession();
    const loader = vi.fn().mockResolvedValue({ appointment_id: 'apt_42' });
    attachConversationMetadata(session, { loader });

    expect(await conversationMetadata(session)).toEqual({ appointment_id: 'apt_42' });
    expect(await conversationMetadata(session)).toEqual({ appointment_id: 'apt_42' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns empty after a failed load, and retries', async () => {
    const session = makeSession();
    const loader = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ appointment_id: 'apt_42' });
    attachConversationMetadata(session, { loader });

    expect(await conversationMetadata(session)).toEqual({});
    expect(await conversationMetadata(session)).toEqual({ appointment_id: 'apt_42' });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('is empty for a session no channel produced', async () => {
    expect(await conversationMetadata(makeSession())).toEqual({});
  });

  it('returns a copy', async () => {
    const session = makeSession();
    attachConversationMetadata(session, { known: { appointment_id: 'apt_42' } });

    (await conversationMetadata(session)).appointment_id = 'changed';

    expect(await conversationMetadata(session)).toEqual({ appointment_id: 'apt_42' });
  });

  it('keeps its state off the session object', () => {
    const session = makeSession();
    attachConversationMetadata(session, { known: { appointment_id: 'apt_42' } });

    expect(JSON.stringify(session)).not.toContain('apt_42');
    expect(session.metadata).toEqual({});
  });
});
