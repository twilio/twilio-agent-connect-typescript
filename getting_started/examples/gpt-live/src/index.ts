/**
 * Example: OpenAI GPT-Live voice calls via Twilio Media Streams.
 *
 * Twilio streams call audio to our own WebSocket, and this provider relays it
 * to/from the GPT-Live WebSocket:
 *
 * - GPT-Live is full-duplex — there's no barge-in/truncate to configure, the
 *   model handles interruption itself.
 * - Tool calls go through Responses delegation (`sessionConfig.delegation`) —
 *   `web_search` below is a hosted tool OpenAI runs server-side, no code
 *   needed here for it to work.
 * - The greeting is sent via `welcomeInstruction` (a `session.commentary.append`
 *   once `session.started` arrives). The caller supplies the full instruction
 *   verbatim — GPT-Live won't speak first from a bare greeting string, so word
 *   it as an instruction, e.g. "Greet the caller using: ...".
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
 *      `webhookPaths.twiml` (default /twiml).
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
  GPTLiveProviderConfig,
  TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE,
  GPT_LIVE_SESSION_ID_METADATA_KEY,
  defineTool,
} from 'twilio-agent-connect';

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
  model: 'gpt-live-1',
  instructions:
    'You are a warm, friendly voice assistant speaking with a caller over the phone. ' +
    'Keep responses short — a sentence or two per turn. No markdown, emojis, or bullet ' +
    'lists; your words will be spoken aloud.',
  audio: {
    // Required. Twilio Media Streams is always 8kHz G.711 u-law, and the
    // provider rejects the call if this is anything else.
    format: TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE,
    output: { voice: 'marin' },
  },
  // GPT-Live doesn't run tools itself — it delegates each turn that needs one
  // to the Responses API, which is where the tool schemas have to live.
  delegation: {
    type: 'responses',
    responses: {
      model: 'gpt-5.6-sol',
      // `web_search` is a hosted tool OpenAI runs server-side; `getWeather` is
      // ours. The two coexist in the same list.
      //
      // Declaring `getWeather` here is what tells the model the tool exists.
      // Registering the same tool on `tools` below is what makes it
      // *executable*. Both are required, and neither implies the other.
      tools: [{ type: 'web_search' }, getWeather.toRealtimeFormat()],
      tool_choice: 'auto',
    },
  },
};

const voiceChannel = new VoiceChannel(
  tac,
  new GPTLiveProviderConfig({
    // Makes the tool executable when the model calls it. The model only knows
    // the tool exists because DEFAULT_SESSION_CONFIG's delegation declares its
    // schema.
    tools: [getWeather],
    // Worded as an instruction, not a bare greeting: GPT-Live will not speak
    // first if you hand it only the greeting text.
    welcomeInstruction:
      'Greet the caller immediately using the exact text below. Do not wait for the ' +
      'caller to speak first. After the greeting, pause and listen.' +
      '\n\nHello! How can I help you today?',
    defaultSessionConfig: DEFAULT_SESSION_CONFIG,
  })
);

tac.registerChannel(voiceChannel);

// Print the full transcript once the Media Stream WebSocket closes. Read it
// from the session handed to this callback: the session is dropped as soon as
// this callback completes, so it is the last point the transcript is reachable.
// The GPT-Live session id goes with it — that's the identifier OpenAI support
// asks for when you report a bad call.
tac.onConversationEnded(async ({ session }) => {
  const transcript = (session.metadata.transcript ?? []) as { role: string; text: string }[];
  const sessionId = session.metadata[GPT_LIVE_SESSION_ID_METADATA_KEY];
  console.log(`Call ${session.conversationId} ended (GPT-Live session ${sessionId}). Transcript:`);
  for (const turn of transcript) {
    console.log(`  ${turn.role}: ${turn.text}`);
  }
});

const server = new TACServer(tac);

await server.start();

if (args.to) {
  const result = await voiceChannel.initiateOutboundConversation({ to: args.to });
  console.log(`Call placed to ${args.to} (SID: ${result.callSid})`);
}
