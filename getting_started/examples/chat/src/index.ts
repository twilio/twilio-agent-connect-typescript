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
import OpenAI from 'openai';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import Twilio from 'twilio';
import {
  TAC,
  TACConfig,
  ChatChannel,
  ConversationSession,
  TACMemoryResponse,
  ConversationId,
  ChannelType,
  ProfileId,
} from 'twilio-agent-connect';

// Load environment variables from parent directory
config({ path: '../.env' });

const CHAT_IDENTITY = 'ai-agent';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tac = await TAC.create({ config: TACConfig.fromEnv() });
const chatChannel = new ChatChannel(tac, { agentAddress: CHAT_IDENTITY });

// Register channel
tac.registerChannel(chatChannel);

// Store conversation history per conversation
const conversationMessages: Record<string, OpenAI.Chat.ChatCompletionMessageParam[]> = {};

const SYSTEM_MESSAGE: OpenAI.Chat.ChatCompletionSystemMessageParam = {
  role: 'system',
  content: "You're a helpful assistant chatting with a user through a web chat interface.",
};

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
}): Promise<string> {
  const { conversationId, message, memory } = params;
  const convId = conversationId as string;

  console.log(`Processing chat message for conversation ${convId}`);

  try {
    // Initialize conversation history if needed
    if (!conversationMessages[convId]) {
      conversationMessages[convId] = [SYSTEM_MESSAGE];
    }

    // Build user message with memory context
    let userMessage = message;

    // Add memory context if available
    if (memory) {
      const memoryContext: string[] = [];

      // Add observations
      if (memory.observations && memory.observations.length > 0) {
        memoryContext.push('Context about the user:');
        memory.observations.forEach(obs => {
          memoryContext.push(`- ${obs.content}`);
        });
      }

      // Add summaries
      if (memory.summaries && memory.summaries.length > 0) {
        memoryContext.push('Previous conversation summaries:');
        memory.summaries.forEach(summary => {
          memoryContext.push(`- ${summary.content}`);
        });
      }

      // Prepend memory context to user message
      if (memoryContext.length > 0) {
        userMessage = `${memoryContext.join('\n')}\n\nUser message: ${message}`;
      }
    }

    // Add user message to history
    conversationMessages[convId].push({
      role: 'user',
      content: userMessage,
    });

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages: conversationMessages[convId],
    });

    const llmResponse = response.choices[0]?.message?.content ?? '';

    // Add assistant response to history
    conversationMessages[convId].push({
      role: 'assistant',
      content: llmResponse,
    });

    return llmResponse;
  } catch (error) {
    console.error(`Error processing message for conversation ${convId}:`, error);
    return 'Sorry, I encountered an error processing your message.';
  }
}

// Register message handler
tac.onMessageReady(handleMessageReady);

// Register conversation ended handler
tac.onConversationEnded(({ session }) => {
  console.log(`Chat conversation ${session.conversationId} ended`);
  delete conversationMessages[session.conversationId];
});

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Fastify server
const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  },
});

// Serve static files
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
});

// Token endpoint for Conversations SDK
app.post('/token', async (request, reply) => {
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
    app.log.error('Missing required credentials for token generation');
    await reply.code(500).send({ error: 'Missing Twilio credentials' });
    return;
  }

  const AccessToken = Twilio.jwt.AccessToken;
  const ChatGrant = AccessToken.ChatGrant;

  const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 3600 });
  const chatGrant = new ChatGrant({ serviceSid });
  token.addGrant(chatGrant);

  await reply.send({ token: token.toJwt() });
});

// Conversation Orchestrator webhook handler
app.post('/webhook', async (request, reply) => {
  try {
    const payload = request.body as Record<string, unknown> | undefined;
    const data = payload?.data as Record<string, unknown> | undefined;
    app.log.info(
      {
        eventType: payload?.eventType,
        conversationId: data?.conversationId,
        author: data?.author,
      },
      '/webhook received'
    );
    // Fire-and-forget webhook processing
    chatChannel.processWebhook(request.body).catch((err: unknown) => {
      app.log.error({ err }, 'Error processing chat webhook');
    });
    await reply.send({ status: 'ok' });
  } catch (error) {
    app.log.error({ error }, 'Error handling chat webhook');
    await reply.code(400).send({ status: 'error', message: String(error) });
  }
});

// Start the server
app
  .listen({ host: '0.0.0.0', port: 8000 })
  .then(() => {
    console.log('TAC Chat Server started on http://0.0.0.0:8000');
    console.log('Open http://localhost:8000 in your browser to test chat');
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
