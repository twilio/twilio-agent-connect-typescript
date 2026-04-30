/**
 * Example: Outbound Conversations with SMS and Voice
 *
 * Demonstrates agent-initiated (outbound) conversations using TAC.
 * Sends an SMS or places a voice call, then handles the full conversation
 * loop with OpenAI.
 *
 * Usage:
 *   npm run dev -- --to +16505551234 --channel sms --message "Hello!"
 *   npm run dev -- --to +16505551234 --channel voice
 */

import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import OpenAI from 'openai';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  SMSChannel,
  ConversationId,
  ChannelType,
  ProfileId,
  TACMemoryResponse,
  ConversationSession,
  TACServer,
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
const channel = args.channel as 'sms' | 'voice' | undefined;
const message = args.message;
const welcomeGreeting = args['welcome-greeting'];

if (!to || !channel) {
  console.error('Usage:');
  console.error('  npm run dev -- --to <address> --channel sms --message "Hello!"');
  console.error('  npm run dev -- --to <address> --channel voice [--welcome-greeting "Hi!"]');
  process.exit(1);
}

if (channel !== 'sms' && channel !== 'voice') {
  console.error(`Invalid channel "${channel}". Must be "sms" or "voice".`);
  process.exit(1);
}

if (channel === 'sms' && !message) {
  console.error('--message is required for SMS channel.');
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

tac.registerChannel(voiceChannel);
tac.registerChannel(smsChannel);

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

function buildMemoryMessage(
  memoryResponse: TACMemoryResponse | null,
  context: ConversationSession
): OpenAI.Chat.ChatCompletionSystemMessageParam | null {
  const sections: string[] = [];

  if (context.profile?.traits) {
    const traitLines: string[] = [];
    for (const [key, value] of Object.entries(context.profile.traits)) {
      if (value !== null && value !== undefined) {
        traitLines.push(
          `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : (value as string | number | boolean)}`
        );
      }
    }
    if (traitLines.length > 0) {
      sections.push(
        ['## Customer Profile', 'Information about this customer:', ...traitLines].join('\n')
      );
    }
  }

  if (memoryResponse && memoryResponse.observations.length > 0) {
    const lines = ['## Key Observations'];
    for (const obs of memoryResponse.observations) {
      lines.push(`- ${obs.content}`);
    }
    sections.push(lines.join('\n'));
  }

  if (memoryResponse && memoryResponse.summaries.length > 0) {
    const lines = ['## Past Conversation Summaries'];
    for (const summary of memoryResponse.summaries) {
      lines.push(`- ${summary.content}`);
    }
    sections.push(lines.join('\n'));
  }

  if (sections.length === 0) return null;

  return {
    role: 'system',
    content: '# Customer Context\n\n' + sections.join('\n\n'),
  };
}

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

  const memoryMessage = buildMemoryMessage(params.memory ?? null, params.session);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    SYSTEM_MESSAGE,
    ...(memoryMessage ? [memoryMessage] : []),
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
