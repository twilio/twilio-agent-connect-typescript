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
}
