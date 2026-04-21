# Getting Started with Twilio Agent Connect (TAC)

This guide will walk you through setting up and running your first TAC application in TypeScript.

## Prerequisites

1. **Node.js 22.13.0+** installed
2. **Twilio account** with a phone number
3. **API key** for the SDK you're using (e.g., OpenAI API key)
4. **ngrok** or similar tunneling tool for local development

## Step 1: Set Up Twilio Services

You need to create Twilio Conversation and Memory services before using TAC.

Create services through the [Twilio Console](https://1console.twilio.com/).

**Required Services:**

- **Conversation Configuration**: For managing conversations
- **Memory Service** (optional): For storing and retrieving user context (e.g., persistent profiles, observations, summaries, and richer communication history)

## Step 2: Run the Example

### Install Dependencies

From the repository root:

```bash
npm install
npm run build
```

### Configure Environment Variables

Create your `.env` file:

```bash
cd getting_started/examples
cp .env.example .env
# Edit .env with your credentials
```

See the **Environment Variables** section below for details.

### Install Example Dependencies and Run the Server

From the `getting_started/examples/openai` directory:

```bash
cd getting_started/examples/openai
npm install
npm run dev
```

The server will start on `http://localhost:8000`.

### Expose Your Server

In another terminal, start ngrok:

```bash
ngrok http 8000
# Copy the ngrok URL (e.g., https://abc123.ngrok.io)
```

Update `VOICE_PUBLIC_DOMAIN` in your `.env` file with the full ngrok URL (including `https://`).

## Environment Variables

See [`examples/.env.example`](examples/.env.example) for all available configuration options. Key variables:

### Required

- `TWILIO_ACCOUNT_SID`: Twilio account SID
- `TWILIO_AUTH_TOKEN`: Twilio auth token
- `TWILIO_API_KEY`: Twilio API key
- `TWILIO_API_SECRET`: Twilio API secret
- `TWILIO_PHONE_NUMBER`: Your Twilio phone number
- `TWILIO_CONVERSATION_CONFIGURATION_ID`: Conversation configuration ID
- `OPENAI_API_KEY`: Your OpenAI API key (for OpenAI example)

### Optional (Server)

- `VOICE_PUBLIC_DOMAIN`: Your ngrok domain (required for voice)

### Optional (Region)

- `TWILIO_REGION`: Twilio region subdomain for API routing

## Other Examples

- **[Chat Example](examples/chat/)** - Web-based chat using the Twilio Conversations JS SDK and ChatChannel

## Next Steps

- Customize the agent's behavior by modifying the message handler in `examples/openai/src/index.ts`
- Add tool calling to enable agent actions beyond text responses
- Explore the main [README](../README.md) for advanced features
- Review [CLAUDE.md](../CLAUDE.md) for architecture and development guidelines
