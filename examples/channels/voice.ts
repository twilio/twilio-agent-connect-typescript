#!/usr/bin/env node

/**
 * Simple Voice Channel Example for Twilio Agent Connect
 *
 * This example demonstrates basic VoiceChannel integration with Fastify for handling
 * voice calls without escalation features. For an example with Flex escalation support,
 * see voice_escalation.ts.
 *
 * Features:
 * - Basic voice call handling with TwiML generation
 * - WebSocket connection for real-time voice streaming
 * - OpenAI integration for conversational responses
 * - Memory retrieval and context management
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
import websocket from '@fastify/websocket';
import { TAC, VoiceChannel } from '@twilio/tac-core';
import type {
  ConversationSession,
  MemoryRetrievalResponse,
  ConversationId,
  ProfileId,
  ChannelType,
  TwiMLOptions
} from '@twilio/tac-core';

// Load environment variables
config();

// Global variables
let tac: TAC; // Will be initialized in main
const systemPrompt = "You're a helpful assistant that helps users over the phone.";

// User-managed conversation history
// Key: conversation_id, Value: list of messages
const conversationMessages = new Map<string, ChatCompletionMessageParam[]>();

/**
 * Callback invoked when a message is ready to be processed.
 *
 * Processes user message with OpenAI, using retrieved memories for context
 * (if available) and maintaining conversation history for coherent multi-turn interactions.
 * For voice channel, memory_response will be None, but profile is fetched once
 * at conversation start and available throughout.
 */
async function handleMessageReady(params: {
  conversationId: ConversationId;
  profileId: ProfileId | undefined;
  message: string;
  author: string;
  memory: MemoryRetrievalResponse | undefined;
  session: ConversationSession;
  channel: ChannelType;
}): Promise<string> {
  const { conversationId, message: userMessage, memory: memoryResponse, session } = params;
  console.log(`Processing message for conversation ${conversationId}`);

  if (memoryResponse) {
    console.log(
      `Retrieved memories: ${memoryResponse.observations.length} observations, ` +
      `${memoryResponse.summaries.length} summaries, ${memoryResponse.sessions.length} sessions`
    );
  } else {
    console.log('No memory response (voice channel)');
  }

  // Initialize conversation history with system message
  const convId = conversationId;
  if (!conversationMessages.has(convId)) {
    const systemMsg: ChatCompletionSystemMessageParam = {
      role: 'system',
      content: systemPrompt
    };
    conversationMessages.set(convId, [systemMsg]);

    // Add profile traits as context if available from memory (fetched once at conversation start)
    if (memoryResponse && memoryResponse.observations.length > 0) {
      console.log(`Memory observations available: ${memoryResponse.observations.length}`);

      // Build context from memory observations with voice-specific context
      const observationContext = "Caller's previous conversation context:\n" +
        memoryResponse.observations.slice(0, 3).map(obs => `- ${obs.observation}`).join('\n');

      const contextMsg: ChatCompletionSystemMessageParam = {
        role: 'system',
        content: observationContext,
      };

      const messages = conversationMessages.get(convId)!;
      messages.push(contextMsg);
      console.log(`Added caller memory context to conversation`);
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
  console.log('Voice response generated:', response);

  // Update conversation history and return response
  if (response) {
    const assistantMsg: ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: response,
    };
    messages.push(assistantMsg);

    return response;
  }

  return "I apologize, but I'm having trouble processing your request right now. Please try again.";
}

async function main() {
  console.log('📞 Starting Voice Channel Example...');

  try {
    // Initialize TAC
    // Memory service is optional - only include if all required environment variables are set
    const memoryStoreSid = process.env.MEMORY_STORE_ID;
    const apiKey = process.env.TWILIO_API_KEY;
    const apiToken = process.env.TWILIO_API_TOKEN;

    // Trait groups are optional - specify which trait groups to retrieve
    // Example: TRAIT_GROUPS="Contact,Preferences" or leave unset for all groups
    const traitGroupsStr = process.env.TRAIT_GROUPS;
    const traitGroups = traitGroupsStr ? traitGroupsStr.split(',').map(g => g.trim()) : undefined;

    tac = new TAC({
      config: {
        environment: process.env.ENVIRONMENT as any,
        conversationServiceId: process.env.CONVERSATION_SERVICE_ID!,
        twilioAccountSid: process.env.TWILIO_ACCOUNT_SID!,
        twilioAuthToken: process.env.TWILIO_AUTH_TOKEN!,
        twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER!,
        memoryStoreId: memoryStoreSid || '',
        voicePublicDomain: process.env.VOICE_PUBLIC_DOMAIN,
      },
    });

    // Register Voice channel
    const voiceChannel = new VoiceChannel(tac);
    tac.registerChannel(voiceChannel);

    // Register callback for message ready
    tac.onMessageReady(handleMessageReady);

    // Create Fastify app
    const app = Fastify({
      logger: true,
    });

    // Register form body parser and WebSocket support
    await app.register(formbody);
    await app.register(websocket);

    // Voice TwiML endpoint
    app.get('/twiml', async (request, reply) => {
      try {
        console.log('📞 Generating TwiML for voice call');

        // Get Voice channel from TAC
        const voiceChannel = tac.getChannel<VoiceChannel>('voice');
        if (!voiceChannel) {
          throw new Error('Voice channel not available');
        }

        // Extract custom parameters from query
        const query = request.query as Record<string, string>;
        const customParameters = {
          conversation_id: query.conversation_id,
          profile_id: query.profile_id,
        };

        // Generate WebSocket URL
        const protocol = request.headers['x-forwarded-proto'] || 'http';
        const host = request.headers.host;
        const websocketUrl = `${protocol === 'https' ? 'wss' : 'ws'}://${host}/voice`;

        const twiMLOptions = {
          websocketUrl,
          customParameters,
        };

        const twiml = voiceChannel.generateTwiML(twiMLOptions);

        return reply.type('application/xml').send(twiml);
      } catch (error) {
        console.error('TwiML generation error:', error);
        return reply.code(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Voice WebSocket endpoint
    app.register(async (fastify) => {
      fastify.get('/voice', { websocket: true }, (connection: any, _request) => {
        const voiceChannel = tac.getChannel<VoiceChannel>('voice');

        if (!voiceChannel) {
          connection.socket.terminate();
          return;
        }

        console.log('🔊 WebSocket connection established for voice channel');

        // Handle WebSocket connection
        voiceChannel.handleWebSocketConnection(connection.socket as any);
      });
    });

    // Start the server
    const port = Number(process.env.PORT) || 8000;
    await app.listen({ host: '0.0.0.0', port });

    console.log(`✅ TAC Voice Server running on http://0.0.0.0:${port}`);

  } catch (error) {
    console.error('❌ Failed to start Voice Channel Example:', error);
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
