/**
 * Example: OpenAI Integration with Voice and SMS Channels
 *
 * Demonstrates how to use OpenAI with TAC for intelligent, context-aware conversations
 * across both SMS and Voice channels.
 */

import { config } from 'dotenv';
import OpenAI from 'openai';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  SMSChannel,
  ConversationSession,
  TACMemoryResponse,
  ConversationId,
  ChannelType,
  ProfileId,
  TACServer,
} from 'twilio-agent-connect';

// Load environment variables from parent directory
config({ path: '../.env' });

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize TAC and channels
const tac = new TAC({ config: TACConfig.fromEnv() });
const voiceChannel = new VoiceChannel(tac);
const smsChannel = new SMSChannel(tac);

// Register channels
tac.registerChannel(voiceChannel);
tac.registerChannel(smsChannel);

// Store conversation history per conversation
const conversationMessages: Record<string, OpenAI.Chat.ChatCompletionMessageParam[]> = {};

const SYSTEM_MESSAGE: OpenAI.Chat.ChatCompletionSystemMessageParam = {
  role: 'system',
  content: 'You are a helpful customer service agent.',
};

/**
 * Build memory context messages from TAC memory response
 */
function buildMemoryMessages(
  memoryResponse: TACMemoryResponse | null,
  context: ConversationSession
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (!memoryResponse) {
    return messages;
  }

  // Add profile information if available
  if (context.profile) {
    const profileParts: string[] = ['User Profile:'];

    if (context.profile.traits) {
      const traits = context.profile.traits;
      for (const [key, value] of Object.entries(traits)) {
        if (value && typeof value === 'object') {
          profileParts.push(`${key}: ${JSON.stringify(value)}`);
        } else if (value !== null && value !== undefined) {
          profileParts.push(`${key}: ${String(value)}`);
        }
      }
    }

    if (profileParts.length > 1) {
      messages.push({
        role: 'system',
        content: profileParts.join('\n'),
      });
    }
  }

  // Add conversation history
  if (memoryResponse.communications && memoryResponse.communications.length > 0) {
    const historyParts = ['Previous conversation history:'];

    for (const comm of memoryResponse.communications.slice(0, 10)) {
      // Limit to last 10
      const author = comm.author?.name || 'Unknown';
      const content = comm.content?.text || '';
      historyParts.push(`${author}: ${content}`);
    }

    messages.push({
      role: 'system',
      content: historyParts.join('\n'),
    });
  }

  return messages;
}

/**
 * Handle incoming messages from SMS or Voice channels
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
  const { conversationId, message, memory, session, channel } = params;
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

    // Build memory context messages
    const memoryMessages = buildMemoryMessages(memory ?? null, session);

    // Combine system message, memory context, and conversation history
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      SYSTEM_MESSAGE,
      ...memoryMessages,
      ...conversationMessages[convId],
    ];

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    });

    const llmResponse = response.choices[0]?.message?.content ?? '';

    // Add assistant response to history
    conversationMessages[convId].push({
      role: 'assistant',
      content: llmResponse,
    });

    // Send response based on channel
    if (channel === 'voice') {
      await voiceChannel.sendResponse(conversationId, llmResponse);
    } else if (channel === 'sms') {
      await smsChannel.sendResponse(conversationId, llmResponse);
    }
  } catch (error) {
    console.error(`Error processing message for conversation ${convId}:`, error);
  }
}

// Register message handler
tac.onMessageReady(handleMessageReady);

// Create and start server
const server = new TACServer(tac, {
  voice: {
    host: '0.0.0.0',
    port: 8000,
  },
  development: true,
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
