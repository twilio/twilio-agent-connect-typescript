/**
 * Example: RCS Channel with OpenAI Chat Completions
 *
 * Demonstrates RCS (Rich Communication Services) channel with TAC memory injection.
 * RCS supports rich media like images and location sharing from Android devices.
 *
 * Usage:
 *   npm run dev:rcs
 *
 * Then send messages to your Twilio RCS agent from an Android phone with Google Messages.
 */

import { config } from 'dotenv';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import {
  TAC,
  TACConfig,
  RCSChannel,
  TACServer,
  MessageReadyCallback,
  MemoryPromptBuilder,
} from 'twilio-agent-connect';

// Load environment variables from parent .env file
config({ path: '../../.env' });

const TWILIO_RCS_AGENT_ID = process.env.TWILIO_RCS_AGENT_ID;

if (!TWILIO_RCS_AGENT_ID) {
  throw new Error('TWILIO_RCS_AGENT_ID environment variable is required');
}

// Initialize TAC with configuration from environment variables
const tac = await TAC.create({ config: TACConfig.fromEnv() });

// Create RCS channel
const rcsChannel = new RCSChannel(tac, {
  agentAddress: TWILIO_RCS_AGENT_ID,
});

// Initialize OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store conversation history per conversation
const conversationHistory: Map<string, ChatCompletionMessageParam[]> = new Map();

const SYSTEM_MESSAGE: ChatCompletionMessageParam = {
  role: 'system',
  content:
    'You are a customer service agent speaking with a user over RCS. ' +
    'Keep responses short and conversational — a sentence or two. ' +
    'Do not use markdown, asterisks, bullets, or emojis; your words will be ' +
    'sent as plain text.',
};

/**
 * Callback invoked when a message is ready to be processed.
 *
 * This example uses the Chat Completions API with automatic memory injection.
 */
const handleMessageReady: MessageReadyCallback = async (params): Promise<string> => {
  const { message: userMessage, session, memory: memoryResponse, conversationId: convId } = params;

  try {
    // Initialize conversation history for new conversations
    if (!conversationHistory.has(convId)) {
      conversationHistory.set(convId, []);
    }

    const history = conversationHistory.get(convId)!;

    // Add user message to conversation history
    history.push({ role: 'user', content: userMessage });

    // Build messages array with memory context
    const memoryContext = memoryResponse
      ? MemoryPromptBuilder.build(memoryResponse, session)
      : null;

    const messages: ChatCompletionMessageParam[] = [
      SYSTEM_MESSAGE,
      ...(memoryContext ? [{ role: 'system' as const, content: memoryContext }] : []),
      ...history,
    ];

    // Call OpenAI Chat Completions API
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    });

    const llmResponse = response.choices[0]?.message?.content || '';

    // Save assistant response to conversation history
    history.push({ role: 'assistant', content: llmResponse });

    return llmResponse;
  } catch (error) {
    console.error('Error processing RCS message:', error);
    return 'Sorry, I encountered an error processing your message.';
  }
};

// Register channel with TAC
tac.registerChannel(rcsChannel);

// Register message handler
tac.onMessageReady(handleMessageReady);

// Create and start server
const server = new TACServer(tac, {
  messagingChannels: [rcsChannel],
  voice: {
    host: '0.0.0.0',
    port: 8000,
  },
  development: true,
});

server
  .start()
  .then(() => {
    console.log('RCS channel server started');
    console.log(`Webhook URL: http://localhost:8000/webhook`);
    console.log(`Configure this URL in your Twilio RCS agent webhook settings`);
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
