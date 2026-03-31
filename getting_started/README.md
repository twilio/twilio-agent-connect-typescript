# Getting Started with Twilio Agent Connect (TAC)

This guide will walk you through setting up and running your first TAC application in TypeScript.

## Prerequisites

1. **Node.js 20+** installed
2. **Twilio account** with a phone number
3. **API key** for the SDK you're using (e.g., OpenAI API key)
4. **ngrok** or similar tunneling tool for local development

## Step 1: Set Up Twilio Services

You need to create Twilio Conversation and Memory services before using TAC.

**Option 1: Use the Setup Wizard (Recommended)**

Use the [Twilio Setup Wizard](https://github.com/twilio-innovation/twilio-agent-connect-python/tree/main/getting_started/twilio_setup) from the Python repository to automatically create Memory and Conversation services and generate your `.env` file:

```bash
git clone https://github.com/twilio-innovation/twilio-agent-connect-python.git
cd twilio-agent-connect-python
make setup  # Open http://localhost:8080
```

Copy the generated `.env` file to your TypeScript project's `getting_started/examples/` directory.

**Option 2: Manual Setup**

You can also create services manually through the [Twilio Console](https://console.twilio.com/).

**Required Services:**

- **Conversation Configuration**: For managing conversations
- **Memory Service** (optional): For persistent user profiles and conversation history

## Step 2: Run the Example

### Install Dependencies

From the repository root:

```bash
npm install
npm run build
```

### Configure Environment Variables

If you used the Setup Wizard, copy the generated `.env` file to `getting_started/examples/`.

Otherwise, create your `.env` file manually:

```bash
cd getting_started/examples
cp .env.example .env
# Edit .env with your credentials
```

See the **Environment Variables** section below for details.

### Run the Server

From the `getting_started/examples` directory:

```bash
cd openai
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
- `TWILIO_API_TOKEN`: Twilio API token
- `TWILIO_PHONE_NUMBER`: Your Twilio phone number
- `CONVERSATION_SERVICE_ID`: Conversation service ID
- `OPENAI_API_KEY`: Your OpenAI API key (for OpenAI example)

### Optional (Memory)

- `MEMORY_STORE_ID`: Memory store ID

### Optional (Server)

- `VOICE_PUBLIC_DOMAIN`: Your ngrok domain (required for voice)

**Note**: The `ENVIRONMENT` variable is optional and defaults to `prod`. You can omit it for production use.

## Next Steps

- Customize the agent's behavior by modifying the message handler in `examples/openai/src/index.ts`
- Add tool calling to enable agent actions beyond text responses
- Explore the main [README](../README.md) for advanced features
- Review [CLAUDE.md](../CLAUDE.md) for architecture and development guidelines
