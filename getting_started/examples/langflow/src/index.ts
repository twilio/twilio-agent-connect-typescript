/**
 * Example: Langflow — a visual flow as the agent brain
 *
 * Demonstrates using a Langflow flow as the LLM "brain" while TAC owns
 * everything around it: the Voice, SMS, and WhatsApp channels, memory
 * injection, token-by-token voice streaming via ConversationRelay, and
 * conversation continuity. Voice streams as the flow produces tokens; SMS and
 * WhatsApp use the simple auto-send pattern.
 *
 * How it fits together:
 *   - The flow owns the system prompt, tools, and any knowledge/RAG. You build
 *     it visually in Langflow (see ./flow/tac-langflow-example.json).
 *   - TAC fetches memory (memoryMode: 'always') and this handler prepends it to
 *     the user's message as context so the flow can tell context from input.
 *   - The TAC conversationId is passed as Langflow's session_id, so the flow
 *     keeps per-conversation chat memory across turns and across channels.
 *
 * Limitations of this minimal integration (kept simple on purpose):
 *   - Tools live in the flow — TAC tools are not passed through.
 *   - Memory is prepended as context, not wired as a Memora node in the flow.
 *   - Voice streaming requires Stream enabled on the flow's model component.
 *   - Flow-driven actions (e.g. handoff) are not surfaced back to TAC here.
 *
 * Requires LANGFLOW_BASE_URL and LANGFLOW_FLOW_ID (and optionally
 * LANGFLOW_API_KEY) in addition to the standard TAC env vars. WhatsApp also
 * needs TWILIO_WHATSAPP_NUMBER.
 */

import { config } from 'dotenv';
import { LangflowClient } from '@datastax/langflow-client';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  SMSChannel,
  WhatsAppChannel,
  TACServer,
  MemoryPromptBuilder,
} from 'twilio-agent-connect';

// Load environment variables from the shared examples/.env file
config({ path: '../.env' });

const baseUrl = process.env.LANGFLOW_BASE_URL;
const flowId = process.env.LANGFLOW_FLOW_ID;
const apiKey = process.env.LANGFLOW_API_KEY;

if (!baseUrl) throw new Error('LANGFLOW_BASE_URL is not set');
if (!flowId) throw new Error('LANGFLOW_FLOW_ID is not set');

// apiKey is optional — Langflow allows unauthenticated access in local dev.
const client = new LangflowClient(apiKey !== undefined ? { baseUrl, apiKey } : { baseUrl });
const flow = client.flow(flowId);

const tac = await TAC.create({ config: TACConfig.fromEnv() });

const voiceChannel = new VoiceChannel(tac, { memoryMode: 'always' });
const smsChannel = new SMSChannel(tac, { memoryMode: 'always' });
const whatsappChannel = new WhatsAppChannel(tac, { memoryMode: 'always' });

tac.registerChannel(voiceChannel);
tac.registerChannel(smsChannel);
tac.registerChannel(whatsappChannel);

tac.onMessageReady(async ({ conversationId, message, memory, session, channel, abortSignal }) => {
  // Map the TAC conversation to a Langflow session so the flow keeps chat
  // memory across turns and channels.
  const sessionId = conversationId as string;

  // Build the context the flow receives: any memory TAC fetched (memoryMode:
  // 'always'), plus the customer's phone on its own labeled line. Tools like the
  // advanced flow's observation/handoff components need the exact E.164 address,
  // and pulling it out of the memory blob is unreliable (the model tends to
  // invent a placeholder). The flow owns the system prompt, so the base
  // instruction here is empty.
  const memoryContext = MemoryPromptBuilder.compose('', memory, session);
  const customerAddress = session.authorInfo?.address;
  const contextParts: string[] = [];
  if (customerAddress) contextParts.push(`Customer phone: ${customerAddress}`);
  if (memoryContext) contextParts.push(memoryContext);
  const context = contextParts.join('\n\n');
  const input = context ? `[Context]\n${context}\n\n[Message]\n${message}` : message;

  // signal is built conditionally so we never pass `signal: undefined` (the
  // SDK option is `signal?: AbortSignal`, and strict mode forbids undefined).
  const options: { session_id: string; signal?: AbortSignal } =
    abortSignal !== undefined
      ? { session_id: sessionId, signal: abortSignal }
      : { session_id: sessionId };

  try {
    if (channel === 'voice') {
      if (abortSignal?.aborted) return;

      // Stream the flow's tokens straight to ConversationRelay for low-latency
      // TTS. Only `token` events carry user-visible text; `end` terminates.
      async function* tokenStream(): AsyncGenerator<string> {
        const stream = await flow.stream(input, options);
        for await (const event of stream) {
          if (abortSignal?.aborted) return;
          if (event.event === 'token') {
            yield event.data.chunk;
          } else if (event.event === 'end') {
            return;
          }
        }
      }

      await voiceChannel.sendStreamingResponse(
        conversationId,
        tokenStream(),
        abortSignal !== undefined ? { signal: abortSignal } : undefined
      );
      return;
    }

    // SMS / WhatsApp: non-streaming. Return the text and TAC auto-sends it.
    const response = await flow.run(input, options);
    return response.chatOutputText() ?? '';
  } catch (error) {
    if (abortSignal?.aborted) return;
    console.error(`Error processing message for conversation ${sessionId}:`, error);
    return;
  }
});

// Voice language + greeting, set per deployment via env (default: English).
// ConversationRelay's `language` sets the default speech-to-text and
// text-to-speech language for the call — handy for multi-language customers who
// each run in a single language (e.g. VOICE_LANGUAGE=pt-BR or es-ES). The reply
// *content* language is owned by your Langflow flow's prompt; this only affects
// how voice is heard and spoken, and is ignored by SMS/WhatsApp.
const server = new TACServer(tac, {
  conversationRelayConfig: {
    welcomeGreeting: process.env.WELCOME_GREETING ?? 'Hello! How can I help you today?',
    language: process.env.VOICE_LANGUAGE ?? 'en-US',
  },
});

server
  .start()
  .then(() => {
    console.log('Langflow example server started successfully');
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
