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
  TACSegmentResponse,
  createSegmentActivityTool,
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
// segmentMode only takes effect when SEGMENT_SPACE_ID / SEGMENT_PROFILE_API_TOKEN are set;
// otherwise the channels skip the Segment lookup.
const voiceChannel = new VoiceChannel(tac, { memoryMode: 'once', segmentMode: 'always' });
const smsChannel = new SMSChannel(tac, { memoryMode: 'always', segmentMode: 'always' });

// Store conversation history per conversation
const conversationMessages: Record<string, OpenAI.Chat.ChatCompletionMessageParam[]> = {};

async function handleMessageReady(params: {
  conversationId: ConversationId;
  profileId: ProfileId | undefined;
  message: string;
  author: string;
  memory: TACMemoryResponse | undefined;
  segmentEvents?: TACSegmentResponse | undefined;
  session: ConversationSession;
  channel: ChannelType;
}): Promise<string> {
  const {
    conversationId,
    message,
    memory: memoryResponse,
    segmentEvents,
    session: context,
  } = params;
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
    const systemContent = MemoryPromptBuilder.compose(basePrompt, memoryResponse, context, {
      segmentEvents,
    });

    // Let the LLM dig deeper into Segment activity on demand (only when Segment is configured)
    const segmentClient = tac.getSegmentClient();
    const activityTool = segmentClient
      ? createSegmentActivityTool(segmentClient, tac.resolveSegmentIdentity(context))
      : undefined;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemContent },
      ...conversationMessages[convId],
    ];

    const tools = activityTool ? [activityTool.toOpenAIFormat()] : undefined;
    const createCompletion = (): Promise<OpenAI.Chat.ChatCompletion> =>
      openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages,
        ...(tools && { tools: tools as OpenAI.Chat.ChatCompletionTool[] }),
      });

    let response = await createCompletion();

    // Tool-call loop (bounded): run requested tools, feed results back, ask again
    for (let round = 0; round < 3 && activityTool; round++) {
      const assistantMessage = response.choices[0]?.message;
      const toolCalls = assistantMessage?.tool_calls?.filter(call => call.type === 'function');
      if (!assistantMessage || !toolCalls?.length) break;

      messages.push(assistantMessage);
      for (const call of toolCalls) {
        let result: string;
        try {
          const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
          result = JSON.stringify(await activityTool.implementation(args));
        } catch (toolError) {
          result = JSON.stringify({
            error: toolError instanceof Error ? toolError.message : String(toolError),
          });
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      response = await createCompletion();
    }

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
const server = new TACServer(tac, { voiceChannel, messagingChannels: [smsChannel] });

server
  .start()
  .then(() => {
    console.log('Server started successfully');
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
