import { MediaStreamsOpenAICallState } from '../shared/state';

/**
 * Per-call barge-in bookkeeping.
 *
 * For every delta that carries an `item_id`, `currentItemAudioMs` is never
 * more than the duration of audio actually sent to Twilio for
 * `lastAssistantItem`: it comes from delta byte counts rather than a
 * wall-clock estimate, floored per delta, so it can understate by up to a
 * millisecond per delta. `conversation.item.truncate` rejects an `audioEndMs`
 * beyond the item's real content, so understating is the safe direction.
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
 * `ConversationSession` and the sockets its base class holds.
 *
 * @internal
 */
export class CallState extends MediaStreamsOpenAICallState {
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
   * `response.output_audio.delta` could advance the barge-in bookkeeping while
   * dispatch is suspended on the `handleFunctionCall` await, producing a
   * truncate that overruns the item it names.
   */
  modelEvents: Promise<void> = Promise.resolve();

  readonly bargeIn = new BargeInState();
}
