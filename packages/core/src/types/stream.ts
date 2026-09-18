import { z } from 'zod';

/**
 * The `start` field of Twilio's Media Stream `start` event.
 *
 * This is an inbound, read-only message Twilio pushes over the
 * `<Connect><Stream>` WebSocket, so unlike the outbound TwiML options it
 * carries no snake_case alias layer — the wire names are parsed directly.
 *
 * Mirrors the Python SDK's `StreamStartMessage`. Python exposes a
 * `conversation_id` property aliasing `call_sid`; here callers read `callSid`
 * directly.
 *
 * @see https://www.twilio.com/docs/voice/media-streams/websocket-messages
 */
export const StreamStartMessageSchema = z.object({
  /** SID of the Media Stream itself (`MZ...`), used to address media back to Twilio. */
  streamSid: z.string(),
  /** SID of the call the stream is attached to — TAC's conversation identifier. */
  callSid: z.string(),
  /**
   * Negotiated audio format (encoding, sample rate, channels). Left untyped
   * because Twilio may add fields here, and the provider only reads it for
   * diagnostics.
   */
  mediaFormat: z.record(z.string(), z.unknown()).nullable().optional(),
  /**
   * Values of the `<Parameter>` children emitted on `<Stream>`. Defaults to an
   * empty object so callers never have to null-check it.
   */
  customParameters: z.record(z.string(), z.string()).default({}),
});

export type StreamStartMessage = z.infer<typeof StreamStartMessageSchema>;
