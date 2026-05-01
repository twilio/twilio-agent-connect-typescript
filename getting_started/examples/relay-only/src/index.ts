/**
 * Example: Voice-Only Mode (ConversationRelay)
 *
 * Demonstrates TAC in voice-only mode using ConversationRelay with streaming.
 * This is the simplest way to get started — only requires Twilio account
 * credentials and a phone number. Conversation state is managed locally.
 *
 * Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_PHONE_NUMBER
 */

import { config } from 'dotenv';
import { Agent, run } from '@openai/agents';
import type { AgentInputItem } from '@openai/agents';
import { TAC, TACConfig, VoiceChannel, TACServer } from 'twilio-agent-connect';

config({ path: '../.env' });

const agent = new Agent({
  name: 'relay-only-agent',
  instructions: 'You are a helpful assistant. Keep responses concise for voice.',
  model: 'gpt-5.4-mini',
});

const tac = await TAC.create({ config: TACConfig.fromEnv() });

if (tac.isOrchestratorEnabled()) {
  throw new Error(
    'This example expects voice-only mode — unset TWILIO_CONVERSATION_CONFIGURATION_ID.'
  );
}

const voiceChannel = new VoiceChannel(tac);

tac.registerChannel(voiceChannel);

const conversationHistory: Record<string, AgentInputItem[]> = {};

tac.onMessageReady(async ({ conversationId, message, abortSignal }) => {
  const convId = conversationId as string;

  if (!conversationHistory[convId]) {
    conversationHistory[convId] = [];
  }

  conversationHistory[convId].push({
    type: 'message',
    role: 'user',
    content: message,
  });

  if (abortSignal?.aborted) return;

  const streamedResult = await run(agent, conversationHistory[convId], {
    stream: true,
    signal: abortSignal,
  });

  async function* tokenStream() {
    for await (const chunk of streamedResult.toTextStream()) {
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

tac.onConversationEnded(({ session }) => {
  const convId = session.conversationId as string;
  delete conversationHistory[convId];
  console.log(`Conversation ${convId} ended, history cleaned up`);
});

const server = new TACServer(tac, {
  voice: { host: '0.0.0.0', port: 8000 },
  development: true,
});

await server.start();
