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
  MemoryPromptBuilder,
} from 'twilio-agent-connect';

// Load environment variables from parent directory
config({ path: '../.env' });

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tac = await TAC.create({ config: TACConfig.fromEnv() });
const voiceChannel = new VoiceChannel(tac, { memoryMode: 'always' });
const smsChannel = new SMSChannel(tac, { memoryMode: 'always' });

// Register channels
tac.registerChannel(voiceChannel);
tac.registerChannel(smsChannel);

// Store conversation history per conversation
const conversationMessages: Record<string, OpenAI.Chat.ChatCompletionMessageParam[]> = {};

async function handleMessageReady(params: {
  conversationId: ConversationId;
  profileId: ProfileId | undefined;
  message: string;
  author: string;
  memory: TACMemoryResponse | undefined;
  session: ConversationSession;
  channel: ChannelType;
}): Promise<string> {
  const { conversationId, message, memory: memoryResponse, session: context } = params;
  const convId = conversationId as string;

  try {
    if (!conversationMessages[convId]) {
      conversationMessages[convId] = [];
    }

    conversationMessages[convId].push({
      role: 'user',
      content: message,
    });

    const basePrompt =
      'You are a customer service agent speaking with a user over voice or SMS. ' +
      'Keep responses short and conversational — a sentence or two. ' +
      'Do not use markdown, asterisks, bullets, or emojis; your words will be ' +
      'spoken aloud or sent as plain text.';
    const memoryContext = MemoryPromptBuilder.build(memoryResponse, context);
    const systemContent = basePrompt + (memoryContext && `\n\n${memoryContext}`);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemContent },
      ...conversationMessages[convId],
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages,
    });

    const llmResponse = response.choices[0]?.message?.content ?? '';

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

// Create and start server
const server = new TACServer(tac, {
  voice: {
    host: '0.0.0.0',
    port: 8000,
  },
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
