# Overview Example (Framework-Agnostic)

This example shows the core Twilio Agent Connect (TAC) pattern with **no LLM SDK dependency**. The LLM call is simulated, so you can see how memory reaches your agent before choosing a framework — and the same code works with OpenAI, AWS Bedrock, Azure AI, GCP Vertex AI, or your own agent.

## What This Example Shows

1. Creating TAC with `TAC.create({ config: TACConfig.fromEnv() })`
2. Creating a `VoiceChannel` and an `SMSChannel`
3. Passing the channels to `TACServer`, which registers them with TAC and serves their webhooks
4. An `onMessageReady` callback that receives the inbound `message`, the `memory` TAC retrieved, and the conversation `session`
5. Folding memory and profile data into the system prompt with `MemoryPromptBuilder.compose()`
6. A placeholder showing where any LLM call goes
7. Returning the reply string, which TAC sends back on the channel the message arrived on

## Prerequisites

1. **Node.js 22.13.0+** installed
2. **Twilio Account** with a phone number
3. **ngrok** or similar tunneling tool for local development

No LLM API key is needed.

## Setup

### 1. Install Dependencies

From the repository root:

```bash
npm install
npm run build
```

Then install the example's dependencies:

```bash
cd getting_started/examples/overview
npm install
```

### 2. Configure Environment Variables

From this example's directory, copy the template shared by all examples in `getting_started/examples/`:

```bash
cp ../.env.example ../.env
# Edit .env with your credentials
```

Required variables:

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
TWILIO_CONVERSATION_CONFIGURATION_ID=conv_configuration_xxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_VOICE_PUBLIC_DOMAIN=your-domain.ngrok.app
```

### 3. Run the Server

```bash
npm run dev
```

Or, from the repository root: `npm run example:overview`.

The server starts on `http://localhost:8000`. Expose it with `ngrok http 8000` and point your Conversation Configuration webhook at `/webhook` and your phone number's voice webhook at `/twiml`. The [`openai/` example README](../openai/README.md#5-configure-twilio-webhooks) has step-by-step Console instructions.

## Adding Your LLM

Replace the simulated reply in `src/index.ts` with a call to your LLM, passing `systemPrompt` and the conversation history. For a complete integration, see the [`openai/`](../openai/) example.
