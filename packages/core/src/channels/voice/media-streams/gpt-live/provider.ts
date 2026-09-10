import { MediaStreamsOpenAIProvider } from '../shared';
import type { ConversationId, ConversationSession } from '../../../../types/index';
import type { CallState } from './state';

/**
 * The audio format both directions of a GPT-Live call must use.
 *
 * Twilio Media Streams always sends and expects 8kHz G.711 u-law — see
 * https://www.twilio.com/docs/voice/media-streams/websocket-messages. Not
 * configurable. The `rate` key is included because GPT-Live's `session.start`
 * `audio.format` schema accepts it (unlike Realtime's `session.update`, which
 * rejects unknown keys).
 */
export const TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE = { type: 'audio/pcmu', rate: 8000 } as const;

/**
 * A {@link VoiceProvider} bridging Twilio Media Streams to OpenAI's GPT-Live
 * API.
 */
export class GPTLiveProvider extends MediaStreamsOpenAIProvider<CallState> {
  public override get channelName(): string {
    return 'VOICE_MEDIA_STREAM_OPENAI_GPT_LIVE';
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Stub throws synchronously; Task 5 replaces with the real async dispatch.
  protected override async dispatchModelEvent(
    _convId: ConversationId,
    _session: ConversationSession,
    _event: Record<string, unknown>
  ): Promise<void> {
    throw new Error('not implemented');
  }
}
