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

  /**
   * Resolves `true` once this call's OpenAI Realtime socket is open and its
   * session config has been sent, or `false` if that handshake failed. `null`
   * until the handshake has been started.
   *
   * Twilio begins streaming caller audio as soon as the media stream opens,
   * which is well before the OpenAI handshake completes. Caller audio waits on
   * this promise rather than being written to a socket that does not exist
   * yet, so a caller who speaks the instant the call connects is not clipped.
   * Every frame awaits this same promise, so the frames resume in the order
   * they arrived.
   *
   * It resolves rather than rejects: a failed handshake is reported once, by
   * the code that opened the socket, not once per waiting frame.
   */
  modelReady: Promise<boolean> | null = null;

  /**
   * Tail of this call's model-event chain: each incoming OpenAI Realtime event
   * is appended to it rather than dispatched on arrival.
   *
   * The Python SDK reads model events in a sequential loop, so event N is fully
   * handled before N+1 is even read. `ws` delivers each event on its own
   * `'message'` emission with nothing serializing them, so without this chain a
   * `response.output_audio.delta` could advance the barge-in bookkeeping in the
   * middle of an awaited barge-in that already read it, producing a truncate
   * that overruns the item it names.
   */
  modelEvents: Promise<void> = Promise.resolve();

  readonly bargeIn = new BargeInState();
}
