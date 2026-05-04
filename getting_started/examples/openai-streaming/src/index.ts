/**
 * Example: OpenAI Agents SDK — Streaming Voice with Interrupt Handling
 *
 * Demonstrates token-by-token voice streaming via ConversationRelay for lower
 * latency, plus graceful handling of user interruptions. Uses the OpenAI Agents
 * SDK with client-side conversation history. SMS falls back to the simple
 * auto-send pattern.
 */

import { config } from 'dotenv';
import { Agent, run } from '@openai/agents';
import type { AgentInputItem } from '@openai/agents';
import { TAC, TACConfig, VoiceChannel, SMSChannel, TACServer } from 'twilio-agent-connect';

config({ path: '../.env' });

const agent = new Agent({
  name: 'customer-service',
  instructions:
    'You are a voice assistant speaking with a user over the phone. ' +
    'Keep responses short and conversational — a sentence or two. ' +
    'Do not use markdown, asterisks, bullets, or emojis; your words ' +
    'will be spoken aloud.',
  model: 'gpt-5.4-mini',
});

const tac = await TAC.create({ config: TACConfig.fromEnv() });
const voiceChannel = new VoiceChannel(tac);
const smsChannel = new SMSChannel(tac);

tac.registerChannel(voiceChannel);
tac.registerChannel(smsChannel);

const conversationHistory: Record<string, AgentInputItem[]> = {};

tac.onMessageReady(async ({ conversationId, message, channel, abortSignal }) => {
  const convId = conversationId as string;

  try {
    if (!conversationHistory[convId]) {
      conversationHistory[convId] = [];
    }

    conversationHistory[convId].push({
      type: 'message',
      role: 'user',
      content: message,
    });

    if (channel === 'voice') {
      if (abortSignal?.aborted) return;

      const streamedResult = await run(agent, conversationHistory[convId], {
        stream: true,
        signal: abortSignal,
      });

      async function* tokenStream() {
        for await (const chunk of streamedResult.toTextStream()) {
          console.debug('[stream] token:', chunk);
          yield chunk;
        }
      }

      const fullResponse = await voiceChannel.sendStreamingResponse(
        conversationId,
        tokenStream(),
        abortSignal !== undefined ? { signal: abortSignal } : undefined
      );

      await streamedResult.completed;

      if (!abortSignal?.aborted) {
        conversationHistory[convId].push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: fullResponse }],
        });
      }
    } else {
      const result = await run(agent, conversationHistory[convId]);

      conversationHistory[convId].push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: result.finalOutput }],
      });

      return result.finalOutput;
    }
  } catch (error) {
    if (abortSignal?.aborted) return;
    console.error(`Error processing message for conversation ${convId}:`, error);
  }
});

tac.onInterrupt(({ conversationId, utteranceUntilInterrupt }) => {
  const convId = conversationId as string;
  const history = conversationHistory[convId];
  if (!history || utteranceUntilInterrupt === undefined) return;

  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item?.type === 'message' && item.role === 'assistant') {
      history[i] = {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: utteranceUntilInterrupt }],
      };
      history.splice(i + 1);
      break;
    }
  }
});

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
