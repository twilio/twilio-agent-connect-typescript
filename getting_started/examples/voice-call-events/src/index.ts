/**
 * Feature: Voice call events (status, AMD, and recording)
 *
 * Places an outbound ConversationRelay call with answering machine detection and
 * recording enabled, then reacts to Twilio's call webhooks: hang up on
 * voicemail, log which calls went unreached. Each handler is optional.
 *
 * TACServer registers the routes and auto-wires their URLs from
 * TWILIO_VOICE_PUBLIC_DOMAIN, so there's no webhook setup here.
 *
 * Outbound only: machineDetection and record are calls.create parameters, so AMD
 * and recording have no inbound equivalent. onCallStatus does work for inbound,
 * but the URL isn't auto-wired — point the number's "Call Status Changes"
 * webhook at <TWILIO_VOICE_PUBLIC_DOMAIN>/twilio/call-events/status yourself.
 *
 * Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY,
 * TWILIO_API_SECRET, TWILIO_PHONE_NUMBER, TWILIO_VOICE_PUBLIC_DOMAIN
 *
 * Usage:
 *   npm run dev -- --to +16505551234
 */

import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { TAC, TACConfig, VoiceChannel, TACServer } from 'twilio-agent-connect';

config({ path: '../.env' });

const { values } = parseArgs({
  options: { to: { type: 'string' } },
  strict: true,
});

if (!values.to) {
  console.error('Usage: npm run dev -- --to +16505551234');
  process.exit(1);
}
const to = values.to;

const tac = await TAC.create({ config: TACConfig.fromEnv() });

tac.onMessageReady(({ message }) => `You said: ${message}`);

const voiceChannel = new VoiceChannel(tac);

// Registering is also what puts each callback URL on the outbound call below.
// Skip a handler and TAC omits its URL, so Twilio never posts that event.

voiceChannel.onCallStatus(event => {
  console.log(`[STATUS] ${event.callSid}: ${event.callStatus}`);
  // The conversation session — conversationId, profile, metadata. Set on the
  // first prompt, so an early event may not resolve one yet.
  const session = voiceChannel.getConversationSessionByCallSid(event.callSid);
  console.log(`[STATUS] session lookup -> ${session?.conversationId ?? 'none'}`);
  if (event.isUnreached) {
    console.log(`[STATUS] ${event.callSid} unreached — queue retry`);
  }
});

voiceChannel.onAmd(async event => {
  console.log(`[AMD] ${event.callSid}: answeredBy=${event.answeredBy}`);
  if (event.isMachine) {
    await voiceChannel.endCall(event.callSid); // voicemail → hang up
  }
});

voiceChannel.onRecording(event => {
  console.log(`[RECORDING] ${event.callSid}: ${event.recordingStatus} ${event.recordingUrl}`);
});

tac.registerChannel(voiceChannel);

const server = new TACServer(tac);
await server.start();

const result = await voiceChannel.initiateOutboundConversation({
  to,
  callOptions: {
    // AMD needs both. 'Enable' reports as early as possible, which is what you
    // want to hang up on voicemail.
    machineDetection: 'Enable',
    asyncAmd: true,
    record: true,
    timeout: 30,
  },
});

console.log(`Call placed to ${to} (CallSid: ${result.callSid})`);
