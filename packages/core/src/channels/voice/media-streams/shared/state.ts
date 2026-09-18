import type { WebSocket } from 'ws';

/**
 * Both legs of one call's audio bridge — the Twilio-facing socket and the
 * model-facing socket — live here together, rather than in two parallel maps
 * keyed by conversation id that could drift out of sync.
 *
 * `streamSid` and `transcript` live on `ConversationSession.metadata` instead,
 * not here: this map is deleted before `onConversationEnded` fires, so anything
 * a handler needs to read after the call ends must survive on the session.
 *
 * @internal
 */
export class MediaStreamsOpenAICallState {
  twilioWs: WebSocket | null = null;
  modelWs: WebSocket | null = null;

  /**
   * Resolves `true` once this call's model socket is open and its session
   * config has been sent, or `false` if that handshake failed. `null` until the
   * handshake has been started.
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
}
