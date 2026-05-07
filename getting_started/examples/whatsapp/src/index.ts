/**
 * Example: WhatsApp Channel with OpenAI Integration
 *
 * Demonstrates WhatsApp text messaging with TAC memory injection.
 * This example sends and receives text messages only.
 *
 * Requires OPENAI_API_KEY and TWILIO_WHATSAPP_NUMBER in addition to standard TAC env vars.
 *
 * Usage:
 *   npm run dev
 *
 * Then send messages to your Twilio WhatsApp number from your phone.
 */

import { config } from 'dotenv';
import { Agent, AgentInputItem, run, setTracingDisabled } from '@openai/agents';
import {
  TAC,
  TACConfig,
  WhatsAppChannel,
  ConversationId,
  ProfileId,
  TACServer,
  TACMemoryResponse,
  ConversationSession,
  ChannelType,
  MemoryPromptBuilder,
} from 'twilio-agent-connect';

// Load environment variables from parent directory
config({ path: '../.env' });
setTracingDisabled(true);

const tac = await TAC.create({ config: TACConfig.fromEnv() });

const whatsappChannel = new WhatsAppChannel(tac);

// Register channel
tac.registerChannel(whatsappChannel);

const conversationHistory: Record<string, AgentInputItem[]> = {};

const SYSTEM_INSTRUCTIONS =
  'You are a friendly, helpful AI customer service agent. ' +
  'Keep responses conversational and concise. ' +
  'Do not use markdown formatting.';

async function handleMessageReady(params: {
  conversationId: ConversationId;
  profileId: ProfileId | undefined;
  message: string;
  author: string;
  memory: TACMemoryResponse | undefined;
  session: ConversationSession;
  channel: ChannelType;
}): Promise<string | undefined> {
  const { conversationId, message, memory, session } = params;
  const convId = conversationId as string;

  const instructions = MemoryPromptBuilder.compose(SYSTEM_INSTRUCTIONS, memory, session);

  const agent = new Agent({
    name: 'WhatsApp Customer Service Agent',
    instructions,
    model: 'gpt-5.4-mini',
  });

  const history = conversationHistory[convId] ?? [];
  const agentInput: AgentInputItem[] = [...history, { role: 'user', content: message }];

  const result = await run(agent, agentInput);

  conversationHistory[convId] = result.history;

  console.log(`[${convId}] Customer: ${message}`);
  console.log(`[${convId}] Agent: ${result.finalOutput ?? ''}`);

  return result.finalOutput;
}

// Register message handler
tac.onMessageReady(handleMessageReady);

// Create and start server (auto-discovers WhatsApp channel)
const server = new TACServer(tac);

server
  .start()
  .then(() => {
    console.log('WhatsApp server started successfully');
    console.log('Send a WhatsApp message to your configured number to test');
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
