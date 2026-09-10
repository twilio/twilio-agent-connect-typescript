export { generateStreamTwiml, TwiMLBuilderMediaStreams } from './twiml';
export type { BuildStreamTwiMLInputs, MediaStreamsTwiMLBuilderConfig } from './twiml';

export { MediaStreamsProviderConfig } from './config';
export type { MediaStreamsProviderConfigOptions } from './config';

// `MediaStreamsOpenAICallState` is exported despite being `@internal`: a
// provider living outside this package reaches it only through
// `@twilio/tac-core`, and its own call state must extend it. `@internal` keeps
// it off the docs site.
export {
  MediaStreamsOpenAIProvider,
  MediaStreamsOpenAIProviderConfig,
  MediaStreamsOpenAICallState,
  OPENAI_USER_AGENT,
} from './shared';
export type { MediaStreamsOpenAIProviderConfigOptions } from './shared';

export {
  OpenAIRealtimeProvider,
  OpenAIRealtimeProviderConfig,
  TWILIO_AUDIO_FORMAT_FOR_REALTIME,
} from './openai-realtime';
export type { OpenAIRealtimeProviderConfigOptions } from './openai-realtime';
