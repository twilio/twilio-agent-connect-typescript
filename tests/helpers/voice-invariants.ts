/**
 * The voice teardown invariant, as one assertion.
 *
 * However a call ends — normal hangup, abrupt disconnect, an exception during
 * setup — the process must hold nothing live for it afterwards. Voice tests
 * that open a socket assert this, so a new teardown path can't quietly start
 * leaking.
 */
import { expect } from 'vitest';
import type { VoiceChannel } from '@twilio/tac-core';

/**
 * Assert no local state survives for `conversationId` on `channel`.
 *
 * Covers the channel's session and mid-call-close bookkeeping, the
 * ConversationRelay provider's WebSocket / prompt-queue / stream-task
 * registries, and (for Media Streams providers) the call state and stashed
 * per-call session config.
 */
export function assertNoResidualState(channel: VoiceChannel, conversationId: string): void {
  const internals = channel as any;
  expect(
    internals.activeConversations.has(conversationId),
    `session for ${conversationId} was not released`
  ).toBe(false);
  expect(
    internals.closedWhileLive.has(conversationId),
    `mid-call close of ${conversationId} was kept`
  ).toBe(false);

  const provider = internals.provider;
  for (const field of ['webSocketConnections', 'promptQueues', 'streamTasks', 'calls']) {
    const registry: Map<string, unknown> | undefined = provider[field];
    if (registry !== undefined) {
      expect(registry.has(conversationId), `${field} entry for ${conversationId} was kept`).toBe(
        false
      );
    }
  }

  const sessionConfigs: { has(key: string): boolean } | undefined = provider.pendingSessionConfigs;
  if (sessionConfigs !== undefined) {
    expect(
      sessionConfigs.has(conversationId),
      `session config for ${conversationId} was not removed`
    ).toBe(false);
  }
}
