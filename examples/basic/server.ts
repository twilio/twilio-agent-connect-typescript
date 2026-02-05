#!/usr/bin/env node

/**
 * Basic SMS Channel Example for Twilio Agent Connect
 *
 * This example demonstrates basic SMSChannel integration with Fastify for handling
 * SMS messages. This matches the Python channels/sms.py example functionality.
 *
 * Features:
 * - Basic SMS message handling with webhook processing
 * - OpenAI integration for conversational responses
 * - Memory retrieval and context management
 * - Conversation history maintenance
 */

import { config } from 'dotenv';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionAssistantMessageParam
} from 'openai/resources/chat/completions';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { TAC, SMSChannel, TACMemoryResponse } from '@twilio/tac-core';
import type {
  ConversationSession,
  ConversationId,
  ProfileId,
  ChannelType
} from '@twilio/tac-core';

// Load environment variables
config();

// Global variables
let tac: TAC; // Will be initialized in main
const systemPrompt = "You're a helpful assistant that helps users via text messages.";

// User-managed conversation history
// Key: conversation_id, Value: list of messages
const conversationMessages = new Map<string, ChatCompletionMessageParam[]>();

/**
 * Callback invoked when a message is ready to be processed.
 *
 * Processes user message with OpenAI, using retrieved memories for context
 * and maintaining conversation history for coherent multi-turn interactions.
 */
async function handleMessageReady(params: {
  conversationId: ConversationId;
  profileId: ProfileId | undefined;
  message: string;
  author: string;
  memory: TACMemoryResponse | undefined;
  session: ConversationSession;
  channel: ChannelType;
}): Promise<void> {
  const { conversationId, message: userMessage, memory: memoryResponse, channel } = params;
  console.log(`Processing message for conversation ${conversationId}`);

  if (memoryResponse) {
    console.log(
      `Retrieved memories: ${memoryResponse.observations.length} observations, ` +
      `${memoryResponse.summaries.length} summaries, ${memoryResponse.communications?.length ?? 0} communications`
    );
  }

  // Initialize conversation history with system message
  const convId = conversationId;
  if (!conversationMessages.has(convId)) {
    const systemMsg: ChatCompletionSystemMessageParam = {
      role: 'system',
      content: systemPrompt
    };
    conversationMessages.set(convId, [systemMsg]);

    // Add profile traits as context if available from memory
    if (memoryResponse && memoryResponse.observations.length > 0) {
      console.log(`Memory observations available: ${memoryResponse.observations.length}`);

      // Build context from memory observations
      const observationContext = "Previous conversation context:\n" +
        memoryResponse.observations.slice(0, 3).map(obs => `- ${obs.content}`).join('\n');

      const contextMsg: ChatCompletionSystemMessageParam = {
        role: 'system',
        content: observationContext,
      };

      const messages = conversationMessages.get(convId)!;
      messages.push(contextMsg);
      console.log(`Added memory context to conversation`);
    }
  }

  // Add user message to history
  const userMsg: ChatCompletionUserMessageParam = {
    role: 'user',
    content: userMessage
  };
  const messages = conversationMessages.get(convId)!;
  messages.push(userMsg);

  // Generate response with OpenAI
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages as any,
  });

  const response = completion.choices[0]?.message?.content;
  console.log('Response generated:', response);

  // Update conversation history and send response via channel
  const finalResponse = response ?? "I apologize, but I'm having trouble processing your request right now. Please try again.";

  const assistantMsg: ChatCompletionAssistantMessageParam = {
    role: 'assistant',
    content: finalResponse,
  };
  messages.push(assistantMsg);

  // Send response through the channel
  const activeChannel = tac.getChannel(channel);
  await activeChannel?.sendResponse(conversationId, finalResponse);
}

async function main() {
  console.log('🤖 Starting Basic SMS Channel Example...');

  try {
    // Initialize TAC
    // Memory service is optional - only include if all required environment variables are set
    const memoryStoreId = process.env.MEMORY_STORE_ID;
    const memoryApiKey = process.env.MEMORY_API_KEY;
    const memoryApiToken = process.env.MEMORY_API_TOKEN;

    tac = new TAC({
      config: {
        environment: process.env.ENVIRONMENT as any,
        conversationServiceId: process.env.CONVERSATION_SERVICE_ID!,
        twilioAccountSid: process.env.TWILIO_ACCOUNT_SID!,
        twilioAuthToken: process.env.TWILIO_AUTH_TOKEN!,
        twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER!,
        memoryStoreId,
        memoryApiKey,
        memoryApiToken,
      },
    });

    // Register SMS channel
    const smsChannel = new SMSChannel(tac);
    tac.registerChannel(smsChannel);

    // Register callback for message ready
    tac.onMessageReady(handleMessageReady);

    // Create Fastify app
    const app = Fastify({
      logger: true,
    });

    // Register form body parser
    await app.register(formbody);

    // SMS webhook endpoint
    app.post('/sms', async (request, reply) => {
      try {
        console.log('📱 Received SMS webhook');

        // Twilio sends form-encoded data, not JSON
        const webhookData = request.body as Record<string, string>;

        // Get SMS channel from TAC
        const smsChannel = tac.getChannel('sms');
        if (!smsChannel) {
          throw new Error('SMS channel not available');
        }

        // Process webhook through SMS channel
        await smsChannel.processWebhook(webhookData);

        return reply.code(200).send({ status: 'ok' });
      } catch (error) {
        console.error('Error processing SMS webhook:', error);
        return reply.code(400).send({
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Start the server
    const port = Number(process.env.PORT) || 8000;
    await app.listen({ host: '0.0.0.0', port });

    console.log(`✅ TAC Basic SMS Server running on http://0.0.0.0:${port}`);

  } catch (error) {
    console.error('❌ Failed to start Basic SMS Example:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

// Start the server
main();
