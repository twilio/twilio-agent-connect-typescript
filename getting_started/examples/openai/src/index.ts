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

const tac = await TAC.create({ config: TACConfig.fromEnv() });
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
 * Build a memory context system message from TAC memory response.
 * Follows the same format as the Python SDK's MemoryPromptBuilder.
 */
function buildMemoryMessage(
  memoryResponse: TACMemoryResponse | null,
  context: ConversationSession
): OpenAI.Chat.ChatCompletionSystemMessageParam | null {
  const sections: string[] = [];

  // Add profile information if available
  if (context.profile?.traits) {
    const traitLines: string[] = [];
    for (const [key, value] of Object.entries(context.profile.traits)) {
      if (value !== null && value !== undefined) {
        traitLines.push(
          `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : (value as string | number | boolean)}`
        );
      }
    }
    if (traitLines.length > 0) {
      sections.push(
        ['## Customer Profile', 'Information about this customer:', ...traitLines].join('\n')
      );
    }
  }

  // Add observations
  if (memoryResponse && memoryResponse.observations.length > 0) {
    const lines = [
      '## Key Observations',
      'Important notes about the customer from previous interactions:',
    ];
    for (const obs of memoryResponse.observations) {
      lines.push(`- ${obs.content}`);
    }
    sections.push(lines.join('\n'));
  }

  // Add conversation summaries
  if (memoryResponse && memoryResponse.summaries.length > 0) {
    const lines = [
      '## Past Conversation Summaries',
      'Summaries of previous conversations with this customer:',
    ];
    for (const summary of memoryResponse.summaries) {
      lines.push(`- ${summary.content}`);
    }
    sections.push(lines.join('\n'));
  }

  // Add recent message history (limit to last 10 messages to avoid exceeding context limits)
  if (memoryResponse && memoryResponse.communications.length > 0) {
    const lines = ['## Recent Message History', 'Recent messages exchanged with this customer:'];
    const recentComms = memoryResponse.communications.slice(-10);
    for (const comm of recentComms) {
      let role: string;
      if (comm.author?.type === 'CUSTOMER') {
        role = 'User';
      } else if (comm.author?.type) {
        role = 'Assistant';
      } else {
        role = 'Unknown';
      }
      const content = comm.content?.text ?? '';
      lines.push(`${role}: ${content}`);
    }
    sections.push(lines.join('\n'));
  }

  if (sections.length === 0) {
    return null;
  }

  const header = [
    '# Customer Context',
    'You have access to the following information about this customer from previous interactions:',
    '',
  ].join('\n');

  return {
    role: 'system',
    content: header + '\n' + sections.join('\n\n'),
  };
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

    // Build memory context message
    const memoryMessage = buildMemoryMessage(memory ?? null, session);

    // Combine system message, memory context, and conversation history
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      SYSTEM_MESSAGE,
      ...(memoryMessage ? [memoryMessage] : []),
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
