<div align="center">
  <div>
    <img src="logo.svg" alt="TAC Logo" width="120" height="120">
  </div>

  <h1>
    Twilio Agent Connect
  </h1>

  <h2>
    A powerful SDK for building intelligent, context-aware AI agents with Twilio's communication technologies.
  </h2>

  <div align="center">
    <a href="https://github.com/twilio/twilio-agent-connect-typescript"><img alt="Node.js" src="https://img.shields.io/badge/Node.js-22.13+-339933.svg"/></a>
    <a href="https://github.com/twilio/twilio-agent-connect-typescript/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green.svg"/></a>
    <a href="https://www.twilio.com/docs/conversations/agent-connect/quickstart"><img alt="Getting Started" src="https://img.shields.io/badge/Getting%20Started-Quickstart-F22F46.svg"/></a>
  </div>
  
  <p>
    <a href="https://www.twilio.com/docs/conversations/agent-connect">Documentation</a>
    ◆ <a href="https://twilio.github.io/twilio-agent-connect-typescript/">API Reference</a>
    ◆ <a href="https://github.com/twilio/twilio-agent-connect-python">Python SDK</a>
    ◆ <a href="https://github.com/twilio/twilio-agent-connect-typescript">TypeScript SDK</a>
    ◆ <a href="https://github.com/twilio/twilio-agent-connect-typescript/tree/main/getting_started/examples">Examples</a>
  </p>
</div>

Seamlessly integrate with Twilio Conversation Memory and Conversation Orchestrator to build LLM-powered agents with persistent memory and conversation context.

> [!TIP]
> **Building AI agents on AWS or Microsoft?** Connect them to Twilio's voice, messaging, and conversation context with these dedicated packages:
> - **[TAC for AWS](https://github.com/twilio/twilio-agent-connect-aws)** — Strands, Bedrock Agents, Bedrock AgentCore
> - **[TAC for Microsoft](https://github.com/twilio/twilio-agent-connect-microsoft)** — Microsoft Agent Framework, Azure AI Foundry (incl. Voice Live), Azure OpenAI

---

## Key Features

- **Multi-Channel Support**: Built-in handling for Voice (ConversationRelay), SMS, RCS, WhatsApp, and Chat
- **Outbound Conversations**: Agent-initiated conversations across all supported channels
- **ConversationRelay-Only Mode**: Get started quickly with TAC's voice plumbing (TwiML, WebSocket, callbacks) before adding Conversation Orchestrator or Conversation Memory
- **Memory Management**: Automatic integration with Twilio Conversation Memory for persistent user context
- **Conversation Lifecycle**: Automatic tracking of conversation sessions and state
- **Human Handoff**: Built-in tool to route conversations to human agents via Twilio Studio Flows (including Flex)

## Get Started

To get started, set up your Node.js environment (Node.js 22.13.0 or newer required), and then install the [TAC SDK package](https://www.npmjs.com/package/twilio-agent-connect):

```bash
npm install twilio-agent-connect
```

## Quick Examples

**Option 1: Use the Setup Wizard**

Use the [Twilio Setup Wizard](https://github.com/twilio/twilio-agent-connect-python/tree/main/getting_started/twilio_setup) from the Python SDK to automatically create a Memory Store and Conversation Configuration and generate your `.env` file:

```bash
git clone https://github.com/twilio/twilio-agent-connect-python.git
cd twilio-agent-connect-python
make setup  # Open http://localhost:8080
```

**Option 2: Manual Setup**

You can also create a Memory Store and Conversation Configuration manually through the [Twilio Console](https://1console.twilio.com). For a full walkthrough — credentials, Console navigation, and webhook configuration — see the [TAC Quickstart](https://www.twilio.com/docs/conversations/agent-connect/quickstart).

---

After completing setup, here's a minimal example to get started:

### Multi-Channel with OpenAI SDK

Use the OpenAI SDK to build an AI agent that works across Voice and SMS channels with conversation memory and user context.

First, install the required dependencies:

```bash
npm install twilio-agent-connect openai dotenv
```

> **Note**: `dotenv` is optional — TAC works with environment variables from any source (`.env` files, Docker, Kubernetes, CI/CD, shell exports, etc.).

Then create your application:

```typescript
import { config } from 'dotenv';
import OpenAI from 'openai';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  SMSChannel,
  TACServer,
  MemoryPromptBuilder,
} from 'twilio-agent-connect';

config();

const openai = new OpenAI();

// Initialize TAC and channels
const tac = await TAC.create({ config: TACConfig.fromEnv() });
const voiceChannel = new VoiceChannel(tac);
const smsChannel = new SMSChannel(tac);

// Register channels
tac.registerChannel(voiceChannel);
tac.registerChannel(smsChannel);

// Store conversation history
const conversationHistory: Record<string, OpenAI.Chat.ChatCompletionMessageParam[]> = {};

// System instructions for the AI agent
const SYSTEM_INSTRUCTIONS =
  'You are a customer service agent speaking with a user over voice or SMS. ' +
  'Keep responses short and conversational — a sentence or two. ' +
  'Do not use markdown, asterisks, bullets, or emojis; your words will be ' +
  'spoken aloud or sent as plain text.';

// Handle incoming messages
tac.onMessageReady(async ({ conversationId, message, memory, session }) => {
  const convId = conversationId as string;

  if (!conversationHistory[convId]) {
    conversationHistory[convId] = [];
  }

  // Build system prompt with memory context using compose()
  const systemPrompt = MemoryPromptBuilder.compose(SYSTEM_INSTRUCTIONS, memory, session);

  conversationHistory[convId].push({ role: 'user', content: message });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      ...conversationHistory[convId],
    ],
  });

  const llmResponse = response.choices[0]?.message?.content ?? '';
  conversationHistory[convId].push({ role: 'assistant', content: llmResponse });

  return llmResponse;
});

const server = new TACServer(tac);
await server.start();
```

> **Note**: See the [getting started guide](https://github.com/twilio/twilio-agent-connect-typescript/blob/main/getting_started/README.md) for complete setup instructions and `.env` configuration details.

**That's it!** The server automatically:
- Creates Fastify app with `/twiml`, `/ws`, and `/webhook` endpoints
- Handles Voice and SMS conversations
- Routes responses to the appropriate channel
- Provides conversation memory and user profile in the callback

For configuration details and environment variables, see the [getting started guide](https://github.com/twilio/twilio-agent-connect-typescript/blob/main/getting_started/README.md).

## How It Works

TAC simplifies building AI agents by handling the integration between Twilio's communication channels and your LLM:

### Message Flow

1. **Webhook/Connection Received**: Twilio sends webhook (SMS) or WebSocket connection (Voice) to your server
2. **Channel Processing**: Channel validates and processes the incoming event
3. **Memory Retrieval**: TAC optionally retrieves user memories and profile from Memory
4. **Callback Invoked**: Your `onMessageReady` callback receives user message, context, and optional memory response
5. **Response Handling**: Your callback returns a response string that TAC routes to the appropriate channel

For detailed architecture and advanced usage, see [CLAUDE.md](https://github.com/twilio/twilio-agent-connect-typescript/blob/main/CLAUDE.md).

## Learn More

**Examples & Guides:**
- **[API Reference](https://twilio.github.io/twilio-agent-connect-typescript/)** - Full API documentation generated from the source
- **[Getting Started Guide](https://github.com/twilio/twilio-agent-connect-typescript/tree/main/getting_started/)** - Examples and comprehensive documentation
- **[OpenAI SDK Example](https://github.com/twilio/twilio-agent-connect-typescript/tree/main/getting_started/examples/openai/)** - Complete multi-channel example with Voice, SMS, and Chat
- **[WhatsApp Example](https://github.com/twilio/twilio-agent-connect-typescript/tree/main/getting_started/examples/whatsapp/)** - WhatsApp channel with memory integration
- **[Chat Example](https://github.com/twilio/twilio-agent-connect-typescript/tree/main/getting_started/examples/chat/)** - Web chat integration example
- **[ConversationRelay-Only Mode](https://github.com/twilio/twilio-agent-connect-typescript/tree/main/getting_started/examples/relay-only/)** - Get started with voice using just ConversationRelay
- **[Outbound Conversations](https://github.com/twilio/twilio-agent-connect-typescript/tree/main/getting_started/examples/outbound/)** - Agent-initiated conversations example
- More examples coming soon

**AWS and Microsoft connectors:**
- **[TAC for AWS](https://github.com/twilio/twilio-agent-connect-aws)** — `StrandsConnector`, `BedrockConnector`, `BedrockAgentCoreConnector` for AWS Strands, Bedrock Agents, and Bedrock AgentCore
- **[TAC for Microsoft](https://github.com/twilio/twilio-agent-connect-microsoft)** — `AgentFrameworkConnector` and `VoiceLiveConnector` for Microsoft Agent Framework, Azure AI Foundry (including Voice Live), and Azure OpenAI

**Documentation:**
- **[CLAUDE.md](https://github.com/twilio/twilio-agent-connect-typescript/blob/main/CLAUDE.md)** - Architecture, development guide, and API reference
- **[Getting Started Guide](https://github.com/twilio/twilio-agent-connect-typescript/blob/main/getting_started/README.md)** - Setup instructions, environment variables, and troubleshooting

---

# TAC Development / Contribution

TAC uses npm workspaces for package management. Ensure you have Node.js and npm installed:

```bash
node --version  # Should be 22.13.0 or newer
npm --version   # Should be 9 or newer
```

### Setup Development Environment

```bash
# Clone repository
git clone https://github.com/twilio/twilio-agent-connect-typescript.git
cd twilio-agent-connect-typescript

# Install all dependencies
npm install

# Build all packages
npm run build
```

### Running Tests and Checks

```bash
# Format code
npm run format

# Run linting
npm run lint

# Run type checking
npm run typecheck

# Run tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run all checks at once
npm run build && npm run lint && npm run typecheck && npm test
```
