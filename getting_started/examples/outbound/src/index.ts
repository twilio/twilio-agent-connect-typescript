/**
 * Example: Outbound Conversations with SMS, RCS, and Voice
 *
 * Demonstrates agent-initiated (outbound) conversations using TAC.
 * Sends an SMS, RCS message, or places a voice call, then handles the full
 * conversation loop with OpenAI.
 *
 * Usage:
 *   npm run dev -- --to +16505551234 --channel sms --message "Hello!"
 *   npm run dev -- --to +16505551234 --channel rcs --message "Hello!"
 *   npm run dev -- --to +16505551234 --channel rcs --message "Hello!" --from rcs:my_agent
 *   npm run dev -- --to +16505551234 --channel voice
 *   npm run dev -- --to +16505551234 --channel voice --welcome-greeting "Hi there!"
 *
 * For RCS, either TWILIO_RCS_AGENT_ID must be set OR --from flag must be provided.
 */

import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import OpenAI from 'openai';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  SMSChannel,
  RCSChannel,
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
    from: { type: 'string' },
    'welcome-greeting': { type: 'string' },
  },
  strict: true,
});

const to = args.to;
const channel = args.channel as 'sms' | 'rcs' | 'voice' | undefined;
const message = args.message;
const from = args.from;
const welcomeGreeting = args['welcome-greeting'];

if (!to || !channel) {
  console.error('Usage:');
  console.error('  npm run dev -- --to <address> --channel sms --message "Hello!"');
  console.error(
    '  npm run dev -- --to <address> --channel rcs --message "Hello!" [--from rcs:agent]'
  );
  console.error('  npm run dev -- --to <address> --channel voice [--welcome-greeting "Hi!"]');
  process.exit(1);
}

if (channel !== 'sms' && channel !== 'rcs' && channel !== 'voice') {
  console.error(`Invalid channel "${channel}". Must be "sms", "rcs", or "voice".`);
  process.exit(1);
}

if ((channel === 'sms' || channel === 'rcs') && !message) {
  console.error(`--message is required for ${channel.toUpperCase()} channel.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Environment & clients
// ---------------------------------------------------------------------------

config({ path: '../.env' });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const tac = await TAC.create({ config: TACConfig.fromEnv() });
const voiceChannel = new VoiceChannel(tac);
const smsChannel = new SMSChannel(tac);

// RCS channel requires agent_address - use env var or will be validated at runtime
const rcsAgentId = process.env.TWILIO_RCS_AGENT_ID || '';
const rcsChannel = new RCSChannel(tac, {
  agentAddress: rcsAgentId || 'rcs:placeholder', // Will validate at runtime
});

// Register all channels - the server will auto-discover and route webhooks correctly
tac.registerChannel(voiceChannel);
tac.registerChannel(smsChannel);
tac.registerChannel(rcsChannel);

// ---------------------------------------------------------------------------
// Conversation state
// ---------------------------------------------------------------------------

const conversationMessages: Record<string, OpenAI.Chat.ChatCompletionMessageParam[]> = {};

const SYSTEM_MESSAGE: OpenAI.Chat.ChatCompletionSystemMessageParam = {
  role: 'system',
  content:
    'You are a friendly, helpful AI assistant. You initiated this outbound ' +
    'conversation by reaching out to the customer. When the customer first ' +
    'speaks (e.g., "hello?"), introduce yourself and explain why you are ' +
    'calling — for example: "Hi! This is an AI assistant calling on behalf ' +
    'of Acme Corp about your recent order." Be conversational and helpful. ' +
    'You do not have the ability to transfer calls or connect to human agents. ' +
    'Only offer capabilities you actually have.',
};

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
}): Promise<string> {
  const convId = params.conversationId as string;

  if (!conversationMessages[convId]) {
    conversationMessages[convId] = [];
  }

  conversationMessages[convId].push({ role: 'user', content: params.message });
  console.log(`[${convId}] Customer: ${params.message}`);

  // Build memory context using MemoryPromptBuilder
  const memoryContent = params.memory
    ? MemoryPromptBuilder.build(params.memory, params.session)
    : null;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    SYSTEM_MESSAGE,
    ...(memoryContent ? [{ role: 'system' as const, content: memoryContent }] : []),
    ...conversationMessages[convId],
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-5.4-mini',
    messages,
  });

  const llmResponse = response.choices[0]?.message?.content ?? '';

  conversationMessages[convId].push({ role: 'assistant', content: llmResponse });
  console.log(`[${convId}] Agent: ${llmResponse}`);

  return llmResponse;
}

tac.onMessageReady(handleMessageReady);

// ---------------------------------------------------------------------------
// Server startup & outbound initiation
// ---------------------------------------------------------------------------

const server = new TACServer(tac, {
  voice: { host: '0.0.0.0', port: 8000 },
  development: true,
});

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
      // Validate RCS configuration at runtime
      if (!from && !process.env.TWILIO_RCS_AGENT_ID) {
        console.error(
          'Error: RCS requires either TWILIO_RCS_AGENT_ID environment variable ' +
            'or --from flag to specify the agent address.'
        );
        process.exit(1);
      }

      const result = await rcsChannel.initiateOutboundConversation({
        to,
        from,
        message: message!,
      });
      console.log(`RCS message sent to ${to} (conversation: ${result.conversationId})`);
      console.log(`[${result.conversationId}] Agent: ${message}`);
      console.log('\nWaiting for replies... (Ctrl+C to exit)\n');
    } else if (channel === 'voice') {
      const publicDomain = process.env.VOICE_PUBLIC_DOMAIN?.replace(/^https?:\/\//, '');
      if (!publicDomain) {
        console.error('VOICE_PUBLIC_DOMAIN is required for voice calls. Set it in your .env file.');
        process.exit(1);
      }

      const result = await voiceChannel.initiateOutboundConversation({
        to,
        conversationRelayConfig: {
          url: `wss://${publicDomain}/ws`,
          ...(welcomeGreeting ? { welcomeGreeting } : {}),
        },
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
