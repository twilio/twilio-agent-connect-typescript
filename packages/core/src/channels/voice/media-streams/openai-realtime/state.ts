import type { WebSocket } from 'ws';

/**
 * Per-call barge-in bookkeeping.
 *
 * `currentItemAudioMs` is the exact duration of audio actually sent to Twilio
 * for `lastAssistantItem`, computed from delta byte counts — not a wall-clock
 * estimate. `conversation.item.truncate` rejects an `audioEndMs` beyond the
 * item's real content, so this must never overstate it.
 *
 * `responseActive` tracks whether a response is still being generated (set on
 * `response.created`, cleared on `response.done` or once barge-in cancels it) —
 * `response.cancel` with nothing in flight is itself an error event, so this
 * gates whether to send it.
 *
 * `mutedItemId` is the assistant item truncated by the last barge-in —
 * `response.output_audio.delta` events whose `item_id` matches it are dropped
 * as stale audio for a reply the caller already talked over. It is never
 * cleared; the next barge-in overwrites it.
 *
 * @internal
 */
export class BargeInState {
  lastAssistantItem: string | null = null;
  currentItemAudioMs = 0;
  mutedItemId: string | null = null;
  responseActive = false;
}

/**
 * Per-call bookkeeping the OpenAI Realtime provider needs beyond
 * `ConversationSession`.
 *
 * Both legs of one call's audio bridge — the Twilio-facing socket and the
 * OpenAI Realtime socket — live here together, rather than in two parallel maps
 * keyed by conversation id that could drift out of sync.
 *
 * `streamSid` and `transcript` live on `ConversationSession.metadata` instead,
 * not here — this map is deleted before `onConversationEnded` fires, so
 * anything a handler needs to read after the call ends must survive on the
 * session, not in here.
 *
 * @internal
 */
export class CallState {
  twilioWs: WebSocket | null = null;
  modelWs: WebSocket | null = null;
  readonly bargeIn = new BargeInState();
}
