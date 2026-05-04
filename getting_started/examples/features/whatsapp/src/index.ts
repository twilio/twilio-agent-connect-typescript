/**
 * Example: WhatsApp Channel with OpenAI Integration
 *
 * Demonstrates WhatsApp channel with TAC memory injection.
 * WhatsApp supports rich media and interactive messaging.
 *
 * Requires OPENAI_API_KEY and TWILIO_WHATSAPP_NUMBER in addition to standard TAC env vars.
 *
 * Usage:
 *   npm run dev
 *
 * Then send messages to your Twilio WhatsApp number from your phone.
 */

import { config } from 'dotenv';
import OpenAI from 'openai';
import {
  TAC,
  TACConfig,
  WhatsAppChannel,
  ConversationSession,
  TACMemoryResponse,
  ConversationId,
  ProfileId,
  TACServer,
  MemoryPromptBuilder,
} from 'twilio-agent-connect';

// Load environment variables from parent directory
config({ path: '../../.env' });

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tac = await TAC.create({ config: TACConfig.fromEnv() });

// Memory mode: "always" fetches memory with query on every message for semantic search
// Alternative: "never" (no automatic retrieval, use manual tac.retrieveMemory() in callback)
const whatsappChannel = new WhatsAppChannel(tac, {
  memoryMode: 'always',
});

// Register channel
tac.registerChannel(whatsappChannel);

// Store conversation history per conversation
const conversationMessages: Record<string, OpenAI.Chat.ChatCompletionMessageParam[]> = {};

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
}): Promise<string> {
  const { conversationId, message, memory: memoryResponse, session: context } = params;
  const convId = conversationId as string;

  try {
    // Initialize conversation history if needed
    if (!conversationMessages[convId]) {
      conversationMessages[convId] = [];
    }

    // Add user message to history
    conversationMessages[convId].push({
      role: 'user',
      content: message,
    });

    // Build system prompt with memory context
    const memoryContext = MemoryPromptBuilder.build(memoryResponse, context);
    const systemContent = SYSTEM_INSTRUCTIONS + (memoryContext ? `\n\n${memoryContext}` : '');

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemContent },
      ...conversationMessages[convId],
    ];

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages,
    });

    const llmResponse = response.choices[0]?.message?.content ?? '';

    // Add assistant response to history
    conversationMessages[convId].push({
      role: 'assistant',
      content: llmResponse,
    });

    console.log(`[${convId}] Customer: ${message}`);
    console.log(`[${convId}] Agent: ${llmResponse}`);

    return llmResponse;
  } catch (error) {
    console.error(`Error processing WhatsApp message for conversation ${convId}:`, error);
    return 'Sorry, I encountered an error processing your message.';
  }
}

// Register message handler
tac.onMessageReady(handleMessageReady);

// Create and start server (auto-discovers WhatsApp channel)
const server = new TACServer(tac, {
  voice: {
    host: '0.0.0.0',
    port: 8000,
  },
});

server
  .start()
  .then(() => {
    console.log('WhatsApp server started successfully on port 8000');
    console.log('Send a WhatsApp message to your configured number to test');
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
