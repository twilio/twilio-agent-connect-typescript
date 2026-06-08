/**
 * Example: Outbound Conversations with SMS, RCS, WhatsApp, and Voice
 *
 * Demonstrates agent-initiated (outbound) conversations using TAC.
 * Sends an SMS, RCS, or WhatsApp message, or places a voice call, then
 * handles the full conversation loop with OpenAI.
 *
 * Usage:
 *   npm run dev -- --to +16505551234 --channel sms --message "Hello!"
 *   npm run dev -- --to rcs:+16505551234 --channel rcs --message "Hello!"
 *   npm run dev -- --to whatsapp:+16505551234 --channel whatsapp --message "Hello!"
 *   npm run dev -- --to +16505551234 --channel voice
 */

import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Agent, AgentInputItem, run, setTracingDisabled } from '@openai/agents';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  SMSChannel,
  RCSChannel,
  WhatsAppChannel,
  ConversationId,
  ChannelType,
  ProfileId,
  TACMemoryResponse,
  ConversationSession,
  TACServer,
  MemoryPromptBuilder,
} from 'twilio-agent-connect';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    to: { type: 'string' },
    channel: { type: 'string' },
    message: { type: 'string' },
    'welcome-greeting': { type: 'string' },
  },
  strict: true,
});

const to = args.to;
const channel = args.channel as 'sms' | 'rcs' | 'whatsapp' | 'voice' | undefined;
const message = args.message;
const welcomeGreeting = args['welcome-greeting'];

if (!to || !channel) {
  console.error('Usage:');
  console.error('  npm run dev -- --to <address> --channel sms --message "Hello!"');
  console.error('  npm run dev -- --to <address> --channel rcs --message "Hello!"');
  console.error('  npm run dev -- --to <address> --channel whatsapp --message "Hello!"');
  console.error('  npm run dev -- --to <address> --channel voice [--welcome-greeting "Hi!"]');
  process.exit(1);
}

if (channel !== 'sms' && channel !== 'rcs' && channel !== 'whatsapp' && channel !== 'voice') {
  console.error(`Invalid channel "${channel}". Must be "sms", "rcs", "whatsapp", or "voice".`);
  process.exit(1);
}

if (channel === 'whatsapp' && !to.startsWith('whatsapp:')) {
  console.error(
    'Invalid WhatsApp destination. --to must include the "whatsapp:" prefix, e.g. "whatsapp:+16505551234".'
  );
  process.exit(1);
}

if (channel === 'rcs' && !to.startsWith('rcs:')) {
  console.error(
    'Invalid RCS destination. --to must include the "rcs:" prefix, e.g. "rcs:+16505551234".'
  );
  process.exit(1);
}

if ((channel === 'sms' || channel === 'rcs' || channel === 'whatsapp') && !message) {
  console.error(`--message is required for ${channel.toUpperCase()} channel.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Environment & clients
// ---------------------------------------------------------------------------

config({ path: '../.env' });
setTracingDisabled(true);

const tac = await TAC.create({ config: TACConfig.fromEnv() });
const voiceChannel = new VoiceChannel(tac);
const smsChannel = new SMSChannel(tac);

// Only construct RCS channel if rcsSenderId is configured
const rcsChannel = tac.getConfig().rcsSenderId ? new RCSChannel(tac) : undefined;
// Only construct WhatsApp channel if whatsappNumber is configured
const whatsappChannel = tac.getConfig().whatsappNumber ? new WhatsAppChannel(tac) : undefined;

tac.registerChannel(voiceChannel);
tac.registerChannel(smsChannel);
if (rcsChannel) {
  tac.registerChannel(rcsChannel);
}
if (whatsappChannel) {
  tac.registerChannel(whatsappChannel);
}

// ---------------------------------------------------------------------------
// Conversation state
// ---------------------------------------------------------------------------

const conversationHistory: Record<string, AgentInputItem[]> = {};

const SYSTEM_INSTRUCTIONS =
  'You are a friendly, helpful AI assistant. You initiated this outbound ' +
  'conversation by reaching out to the customer. When the customer first ' +
  "speaks (e.g., 'hello?'), introduce yourself and explain why you are " +
  "calling -- for example: 'Hi! This is an AI assistant calling on behalf " +
  "of Acme Corp about your recent order.' Be conversational and helpful. " +
  'You do not have the ability to transfer calls or connect to human agents. ' +
  'Only offer capabilities you actually have.';

// ---------------------------------------------------------------------------
// Message handler — called when the customer replies
// ---------------------------------------------------------------------------

async function handleMessageReady(params: {
  conversationId: ConversationId;
  profileId: ProfileId | undefined;
  message: string;
  author: string;
  memory: TACMemoryResponse | undefined;
  session: ConversationSession;
  channel: ChannelType;
}): Promise<string | undefined> {
  const convId = params.conversationId as string;
  console.log(`[${convId}] Customer: ${params.message}`);

  const instructions = MemoryPromptBuilder.compose(
    SYSTEM_INSTRUCTIONS,
    params.memory,
    params.session
  );

  const agent = new Agent({
    name: 'Outbound Agent',
    instructions,
    model: 'gpt-5.4-mini',
  });

  const history = conversationHistory[convId] ?? [];
  const agentInput: AgentInputItem[] = [...history, { role: 'user', content: params.message }];

  const result = await run(agent, agentInput);

  conversationHistory[convId] = result.history;
  console.log(`[${convId}] Agent: ${result.finalOutput ?? ''}`);

  return result.finalOutput;
}

tac.onMessageReady(handleMessageReady);

// ---------------------------------------------------------------------------
// Server startup & outbound initiation
// ---------------------------------------------------------------------------

const server = new TACServer(tac);

server
  .start()
  .then(async () => {
    console.log('\n========================================');
    console.log(`  Outbound ${channel.toUpperCase()} conversation`);
    console.log('========================================\n');

    if (channel === 'sms') {
      const result = await smsChannel.initiateOutboundConversation({
        to,
        message: message!,
      });
      console.log(`SMS sent to ${to} (conversation: ${result.conversationId})`);
      console.log(`[${result.conversationId}] Agent: ${message}`);
      console.log('\nWaiting for replies... (Ctrl+C to exit)\n');
    } else if (channel === 'rcs') {
      if (!rcsChannel) {
        console.error('RCS requires TWILIO_RCS_SENDER_ID environment variable to be set.');
        process.exit(1);
      }
      const result = await rcsChannel.initiateOutboundConversation({
        to,
        message: message!,
      });
      console.log(`RCS sent to ${to} (conversation: ${result.conversationId})`);
      console.log(`[${result.conversationId}] Agent: ${message}`);
      console.log('\nWaiting for replies... (Ctrl+C to exit)\n');
    } else if (channel === 'whatsapp') {
      if (!whatsappChannel) {
        console.error(
          'TWILIO_WHATSAPP_NUMBER is required for WhatsApp channel. Set it in your .env file (e.g., whatsapp:+15551234567)'
        );
        process.exit(1);
      }
      const result = await whatsappChannel.initiateOutboundConversation({
        to,
        message: message!,
      });
      console.log(`WhatsApp message sent to ${to} (conversation: ${result.conversationId})`);
      console.log(`[${result.conversationId}] Agent: ${message}`);
      console.log('\nWaiting for replies... (Ctrl+C to exit)\n');
    } else if (channel === 'voice') {
      // The WebSocket URL is derived from TACConfig.voicePublicDomain
      // (TWILIO_VOICE_PUBLIC_DOMAIN) + voiceWebsocketPath. Per-call TwiML
      // overrides go on twimlOptions; they merge over
      // VoiceChannelConfig.defaultTwimlOptions and TAC defaults.
      const result = await voiceChannel.initiateOutboundConversation({
        to,
        ...(welcomeGreeting ? { twimlOptions: { welcomeGreeting } } : {}),
      });
      console.log(`Call placed to ${to}`);
      console.log(`Call SID: ${result.callSid}`);
      console.log('\nConversation in progress... (Ctrl+C to exit)\n');
    }
  })
  .catch(error => {
    console.error('Failed to start:', error);
    process.exit(1);
  });
