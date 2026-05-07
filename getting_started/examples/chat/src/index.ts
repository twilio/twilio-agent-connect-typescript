/**
 * Chat Server for Twilio Agent Connect
 *
 * Example demonstrating ChatChannel with the Twilio Conversations JS SDK.
 * Messages flow through Twilio Conversations and Conversation Orchestrator:
 *
 *     Browser (Conversations JS SDK) -> Twilio Conversations -> Conversation Orchestrator -> webhook -> server -> AI -> Actions API -> SDK
 *
 * Usage:
 *     npm start
 *     Then open http://localhost:8000 in a browser.
 *
 * Required env vars (in addition to standard TAC vars):
 *     TWILIO_CONVERSATIONS_SERVICE_SID - Conversations v1 Service SID (starts with IS)
 *     OPENAI_API_KEY                  - OpenAI API key
 */

import { config } from 'dotenv';
import { Agent, AgentInputItem, run, setTracingDisabled } from '@openai/agents';
import fastifyStatic from '@fastify/static';
import type { FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import { fileURLToPath } from 'url';
import Twilio from 'twilio';
import {
  TAC,
  TACConfig,
  TACServer,
  ChatChannel,
  ConversationSession,
  TACMemoryResponse,
  ConversationId,
  ChannelType,
  ProfileId,
  MemoryPromptBuilder,
} from 'twilio-agent-connect';

// Load environment variables from parent directory
config({ path: '../.env' });
setTracingDisabled(true);

const CHAT_IDENTITY = 'ai-agent';

// Example-level setup check (not required by the SDK): the V1 Chat backend behind
// this example needs a classic Conversations service — with Chat enabled on it —
// attached to the CO configuration.
const configurationId = process.env.TWILIO_CONVERSATION_CONFIGURATION_ID!;
const auth = Buffer.from(`${process.env.TWILIO_API_KEY}:${process.env.TWILIO_API_SECRET}`).toString(
  'base64'
);
const coConfig = (await (
  await fetch(
    `https://conversations.twilio.com/v2/ControlPlane/Configurations/${configurationId}`,
    {
      headers: { Authorization: `Basic ${auth}` },
    }
  )
).json()) as { conversationsV1Bridge?: { serviceId?: string } | null };
if (!coConfig.conversationsV1Bridge?.serviceId) {
  console.error(
    `Configuration '${configurationId}' has no classic Conversations service attached. ` +
      'Attach one (with Chat enabled) via Console → Conversation Orchestrator → ' +
      'Conversation Configuration → Channel traffic → "+ Add messaging & chat traffic".'
  );
  process.exit(1);
}

const tac = await TAC.create({ config: TACConfig.fromEnv() });
const chatChannel = new ChatChannel(tac, { agentAddress: CHAT_IDENTITY });

// Register channel
tac.registerChannel(chatChannel);

const conversationHistory: Record<string, AgentInputItem[]> = {};

const BASE_SYSTEM_PROMPT =
  "You're an assistant chatting with a user through a web chat interface. " +
  'Keep responses short and conversational. Do not use markdown, asterisks, ' +
  'bullets, or emojis — the chat UI renders messages as plain text, so markdown ' +
  'syntax will appear as literal punctuation.';

/**
 * Handle incoming messages from chat
 */
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

  console.log(`Processing chat message for conversation ${convId}`);

  const instructions = MemoryPromptBuilder.compose(BASE_SYSTEM_PROMPT, memory, session);

  const agent = new Agent({
    name: 'Chat Assistant',
    instructions,
    model: 'gpt-5.4-mini',
  });

  const history = conversationHistory[convId] ?? [];
  const agentInput: AgentInputItem[] = [...history, { role: 'user', content: message }];

  const result = await run(agent, agentInput);

  conversationHistory[convId] = result.history;
  return result.finalOutput;
}

// Register message handler
tac.onMessageReady(handleMessageReady);

// Register conversation ended handler
tac.onConversationEnded(({ session }) => {
  console.log(`Chat conversation ${session.conversationId} ended`);
  delete conversationHistory[session.conversationId];
});

const server = new TACServer(tac);

// Layer the chat UI routes onto the same Fastify instance TAC provides.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
await server.fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
});

server.fastify.post('/token', async (request: FastifyRequest, reply: FastifyReply) => {
  const { identity } = request.body as { identity: string };
  if (!identity) {
    await reply.code(400).send({ error: 'Identity is required' });
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const serviceSid = process.env.TWILIO_CONVERSATIONS_SERVICE_SID;
  if (!accountSid || !apiKey || !apiSecret || !serviceSid) {
    await reply.code(500).send({ error: 'Missing Twilio credentials' });
    return;
  }

  const token = new Twilio.jwt.AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 3600 });
  token.addGrant(new Twilio.jwt.AccessToken.ChatGrant({ serviceSid }));
  await reply.send({ token: token.toJwt() });
});

await server.start();
