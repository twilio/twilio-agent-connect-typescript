/**
 * Feature: RCS Channel
 *
 * Demonstrates the RCS (Rich Communication Services) channel with TAC memory
 * injection, using the OpenAI Agents SDK.
 *
 * Requires `TWILIO_RCS_SENDER_ID` in addition to the usual TAC env vars —
 * see `.env.example`.
 */

import { config } from 'dotenv';
import { Agent, AgentInputItem, run, setTracingDisabled } from '@openai/agents';
import {
  TAC,
  TACConfig,
  RCSChannel,
  ConversationSession,
  ConversationId,
  ChannelType,
  ProfileId,
  TACServer,
  TACMemoryResponse,
  MemoryPromptBuilder,
} from 'twilio-agent-connect';

config({ path: '../../.env' });
setTracingDisabled(true);

const tac = await TAC.create({ config: TACConfig.fromEnv() });
const rcsChannel = new RCSChannel(tac);

tac.registerChannel(rcsChannel);

const SYSTEM_INSTRUCTIONS =
  'You are a customer service agent speaking with a user over RCS. ' +
  'Keep responses short and conversational — a sentence or two. ' +
  'Do not use markdown, asterisks, bullets, or emojis; your words will be ' +
  'sent as plain text.';

const conversationHistory: Record<string, AgentInputItem[]> = {};

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
    name: 'RCS Customer Service Agent',
    instructions,
    model: 'gpt-5.4-mini',
  });

  const history = conversationHistory[convId] ?? [];
  const agentInput: AgentInputItem[] = [...history, { role: 'user', content: message }];

  const result = await run(agent, agentInput);

  conversationHistory[convId] = result.history;
  return result.finalOutput;
}

tac.onMessageReady(handleMessageReady);

const server = new TACServer(tac, {
  voice: { host: '0.0.0.0', port: 8000 },
});

server
  .start()
  .then(() => {
    console.log('Server started successfully');
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
