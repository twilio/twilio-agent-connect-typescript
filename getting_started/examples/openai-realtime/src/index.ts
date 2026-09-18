/**
 * Example: OpenAI Realtime API voice calls via Twilio Media Streams.
 *
 * Twilio streams call audio to our own WebSocket, and this provider relays it
 * to/from the OpenAI Realtime WebSocket. `defaultSessionConfig` applies to
 * every call unless overridden — per inbound call via
 * `onInboundCallSessionConfig`, or per outbound call via
 * `InitiateVoiceConversationOptionsOpenAIRealtime`.
 *
 * Unlike the ConversationRelay examples, this runs in relay-only mode
 * regardless of TAC's Conversation Orchestrator configuration — there's no
 * profile lookup or CO conversation for a Media Streams call.
 *
 * One-time account setup:
 *
 * 1. Twilio Console:
 *    - Buy (or use an existing) Voice-capable phone number.
 *    - Point its Voice webhook at your public tunnel + TACServerConfig's
 *      `webhookPaths.twiml` (default /twiml). No SIP Trunk needed — just a
 *      normal Voice URL.
 *
 * 2. Run this example behind a public tunnel (e.g. `ngrok http 8000`) so
 *    Twilio can reach both the TwiML endpoint and the Media Stream WebSocket.
 *
 * Env vars required:
 * - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY, TWILIO_API_SECRET
 * - TWILIO_PHONE_NUMBER
 * - TWILIO_VOICE_PUBLIC_DOMAIN (your ngrok domain or similar)
 * - OPENAI_API_KEY
 *
 * Setup:
 *     npm install
 *
 * Usage:
 *     npm run dev                          # inbound only
 *     # also place an outbound call — make sure you have permission to call
 *     # this number; unsolicited calls risk the number being flagged as spam
 *     npm run dev -- --to +16505551234
 */

import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import {
  TAC,
  TACConfig,
  TACServer,
  VoiceChannel,
  OpenAIRealtimeProviderConfig,
  TWILIO_AUDIO_FORMAT_FOR_REALTIME,
  defineTool,
} from 'twilio-agent-connect';
import type { TwiMLRequest } from 'twilio-agent-connect';

config({ path: '../.env' });

const { values: args } = parseArgs({
  options: {
    to: { type: 'string' },
  },
  strict: true,
});

const tac = await TAC.create({ config: TACConfig.fromEnv() });

const getWeather = defineTool(
  'get_weather',
  'Get the current weather for a city.',
  {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City to get the weather for' },
    },
    required: ['city'],
  },
  ({ city }: { city: string }) => `It's sunny and 72F in ${city}.`
);

// Sent to OpenAI verbatim, so these keys stay snake_case (TAC's own API is
// camelCase).
const DEFAULT_SESSION_CONFIG: Record<string, unknown> = {
  type: 'realtime',
  model: 'gpt-realtime-2.1',
  output_modalities: ['audio'],
  instructions:
    'You are a warm, friendly voice assistant speaking with a caller over the phone. ' +
    'Keep responses short — a sentence or two per turn. No markdown, emojis, or bullet ' +
    'lists; your words will be spoken aloud.',
  audio: {
    input: {
      format: TWILIO_AUDIO_FORMAT_FOR_REALTIME,
      turn_detection: { type: 'semantic_vad', eagerness: 'high' },
      transcription: { model: 'gpt-live-transcribe' },
    },
    output: { format: TWILIO_AUDIO_FORMAT_FOR_REALTIME, voice: 'marin' },
  },
  // Declares the tool to the model. Registering it on `tools` below is what
  // makes it *executable* — both are required, and neither implies the other.
  tools: [getWeather.toRealtimeFormat()],
  tool_choice: 'auto',
};

/** Per-call override for inbound calls. `null` falls back to DEFAULT_SESSION_CONFIG. */
async function customizeSessionConfig(req: TwiMLRequest): Promise<Record<string, unknown> | null> {
  if (req.callerCountry === 'US') {
    return {
      ...DEFAULT_SESSION_CONFIG,
      instructions: '你是一个友好的语音助手。请用中文回答。',
    };
  }
  return null;
}

const voiceChannel = new VoiceChannel(
  tac,
  new OpenAIRealtimeProviderConfig({
    // Makes the tool executable when the model calls it. The model only knows
    // the tool exists because DEFAULT_SESSION_CONFIG.tools declares its schema.
    tools: [getWeather],
    welcomeGreetingResponse: { instructions: 'Hello! How can I help you today?' },
    defaultSessionConfig: DEFAULT_SESSION_CONFIG,
    onInboundCallSessionConfig: customizeSessionConfig,
  })
);

tac.registerChannel(voiceChannel);

// Print the full transcript once the Media Stream WebSocket closes. Read it
// from the session handed to this callback: the session is dropped as soon as
// this callback completes, so it is the last point the transcript is reachable.
tac.onConversationEnded(({ session }) => {
  const transcript = session.metadata.transcript;
  console.log(`Call ${session.conversationId} ended. Transcript:`);
  if (Array.isArray(transcript)) {
    for (const turn of transcript as { role: string; text: string }[]) {
      console.log(`  ${turn.role}: ${turn.text}`);
    }
  }
});

const server = new TACServer(tac);

await server.start();

if (args.to) {
  // Per-outbound-call sessionConfig override — a direct value, since outbound
  // has no webhook to hang a customizer off of.
  const result = await voiceChannel.initiateOutboundConversation({
    to: args.to,
    sessionConfig: {
      ...DEFAULT_SESSION_CONFIG,
      instructions: 'Tu es un assistant vocal amical. Réponds en français.',
    },
  });
  console.log(`Call placed to ${args.to} (SID: ${result.callSid})`);
}
