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
import OpenAI from 'openai';
import {
  TAC,
  TACConfig,
  WhatsAppChannel,
  ConversationId,
  ProfileId,
  TACServer,
} from 'twilio-agent-connect';

// Load environment variables from parent directory
config({ path: '../../.env' });

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tac = await TAC.create({ config: TACConfig.fromEnv() });

const whatsappChannel = new WhatsAppChannel(tac);

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
}): Promise<string> {
  const { conversationId, message } = params;
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

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_INSTRUCTIONS },
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
