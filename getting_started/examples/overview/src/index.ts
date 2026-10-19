/**
 * Example: Framework-Agnostic Memory Injection
 *
 * Shows the core TAC pattern with no LLM SDK dependency, so it works with ANY
 * agent framework (OpenAI, AWS Bedrock, Azure AI, GCP Vertex AI, custom agents).
 *
 * Key concepts:
 * 1. TAC hands your `onMessageReady` callback the inbound `message`, the
 *    retrieved `memory`, and the conversation `session`.
 * 2. `MemoryPromptBuilder.compose()` folds memory and profile data into your
 *    system prompt.
 * 3. Pass that prompt to whatever LLM you use, and return its reply: TAC sends
 *    the returned string back on the channel the message arrived on.
 *
 * The LLM call is simulated, so this runs without any LLM credentials. For a
 * real integration, see the `openai/` example.
 */

import { config } from 'dotenv';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  SMSChannel,
  TACServer,
  MemoryPromptBuilder,
} from 'twilio-agent-connect';

// Load environment variables from parent directory
config({ path: '../.env' });

const tac = await TAC.create({ config: TACConfig.fromEnv() });

// memoryMode controls automatic memory retrieval (the default, 'never', fetches
// nothing). Voice fetches once per conversation; SMS fetches on every message.
const voiceChannel = new VoiceChannel(tac, { memoryMode: 'once' });
const smsChannel = new SMSChannel(tac, { memoryMode: 'always' });

// Store conversation history per conversation, in whatever shape your LLM expects
const conversationMessages: Record<string, { role: 'user' | 'assistant'; content: string }[]> = {};

const BASE_PROMPT =
  'You are a customer service agent speaking with a user over voice or SMS. ' +
  'Keep responses short and conversational — a sentence or two. ' +
  'Do not use markdown, asterisks, bullets, or emojis; your words will be ' +
  'spoken aloud or sent as plain text.';

tac.onMessageReady(({ conversationId, message, memory, session }) => {
  const history = (conversationMessages[conversationId] ??= []);

  try {
    // Append the customer's memory and profile to your base prompt. This works
    // the same for any LLM or framework, and returns BASE_PROMPT unchanged when
    // there is no memory to add.
    const systemPrompt = MemoryPromptBuilder.compose(BASE_PROMPT, memory, session);
    console.log(`System prompt for ${conversationId}:\n${systemPrompt}\n`);

    history.push({ role: 'user', content: message });

    // ------------------------------------------------------------------
    // Call your LLM here with `systemPrompt` and `history`, for example:
    // - OpenAI:      messages: [{ role: 'system', content: systemPrompt }, ...history]
    // - AWS Bedrock: system: [{ text: systemPrompt }], messages: history
    // - Azure AI:    messages: [{ role: 'system', content: systemPrompt }, ...history]
    // - Custom:      pass systemPrompt to your agent however it takes context
    // ------------------------------------------------------------------
    const llmResponse = `This is a simulated reply. You said: ${message}`;

    history.push({ role: 'assistant', content: llmResponse });

    // Returning a string sends it to the user on the channel the message came in on
    return llmResponse;
  } catch (error) {
    console.error(`Error processing message for conversation ${conversationId}:`, error);
    return 'Sorry, I encountered an error processing your message.';
  }
});

// Passing channels to TACServer registers them with TAC and serves their webhooks
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
