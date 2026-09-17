# Getting Started with Twilio Agent Connect (TAC)

This guide will walk you through setting up and running your first TAC application in TypeScript.

## Prerequisites

1. **Node.js 22.13.0+** installed
2. **Twilio account** with a phone number that has both **Voice** and **Messaging** capabilities enabled. Messaging requires [A2P 10DLC registration](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc) for US long-code numbers before the number can send SMS.
3. **API key** for the SDK you're using (e.g., OpenAI API key)
4. **ngrok** or similar tunneling tool for local development

## Step 1: Set Up Twilio Services

You need to create a Twilio Conversation Configuration and Memory Store before using TAC.

**Option 1: Use the Setup Wizard**

Run the interactive wizard to automatically create services:

```bash
npm run setup
# Open http://localhost:8080 and follow the wizard
```

The wizard will:

- Create a Twilio Conversation Configuration and Memory Store
- Create a test Profile so you can verify the setup works
- Generate the `.env` values you need

See [`twilio-setup/`](twilio-setup/) for details.

**Option 2: Manual Setup**

Create services manually through the [Twilio Console](https://1console.twilio.com/). For a complete walkthrough — including which credentials to gather, how to configure SMS and Voice webhooks, and step-by-step Console navigation — see the [TAC Quickstart](https://www.twilio.com/docs/conversations/agent-connect/quickstart).

## Step 2: Choose an Example

TAC includes examples for different integration approaches. Each one is a self-contained npm project under `examples/`.

### Partner SDK Examples

- **[`openai/`](examples/openai/)** — OpenAI Chat Completions across Voice and SMS with conversation memory and user context. **Start here.**
- **[`openai-streaming/`](examples/openai-streaming/)** — Stream LLM responses token-by-token for faster time-to-first-audio on voice

### Channel Examples

- **[`whatsapp/`](examples/whatsapp/)** — WhatsApp channel with automatic memory retrieval
- **[`rcs/`](examples/rcs/)** — RCS (Rich Communication Services) channel using the OpenAI Agents SDK
- **[`chat/`](examples/chat/)** — Web-based chat using the Twilio Conversations JS SDK and `ChatChannel`
- **[`relay-only/`](examples/relay-only/)** — ConversationRelay-only mode: get started with voice using just ConversationRelay, no Conversation Orchestrator

### Feature Examples

- **[`outbound/`](examples/outbound/)** — Agent-initiated outbound conversations via SMS, RCS, WhatsApp, or Voice
- **[`handoff/`](examples/handoff/)** — Hand the conversation off to a human agent via a Twilio Studio Flow
- **[`voice-call-events/`](examples/voice-call-events/)** — Answering machine detection, recording, and call disposition on outbound calls — hang up on voicemail, track which calls went unreached
- **[`voice-dtmf/`](examples/voice-dtmf/)** — Keypad input over ConversationRelay: collect an account number digit by digit and hand it to the agent as context
- **[`voice-twiml-customization/`](examples/voice-twiml-customization/)** — Customize ConversationRelay TwiML attributes per call

## Step 3: Run an Example

### Install Dependencies

From the repository root:

```bash
npm install
npm run build
```

### Configure Environment Variables

```bash
cd getting_started/examples
cp .env.example .env
# Edit .env with your credentials
```

See the **Environment Variables** section below for details.

### Start ngrok First

Start ngrok before the server so you have a public URL to put in `.env`:

```bash
ngrok http 8000
# Copy the ngrok URL (e.g., https://abc123.ngrok.app)
```

Update `TWILIO_VOICE_PUBLIC_DOMAIN` in your `.env` file with your ngrok domain (e.g., `abc123.ngrok.app`, without the `https://` prefix). If you start the server first and then change the URL, you'll need to restart the server for it to pick up the new value.

### Run the Server

Each example installs its own dependencies:

```bash
cd getting_started/examples/openai
npm install
npm run dev
```

The server will start on `http://localhost:8000`.

## Environment Variables

See [`examples/.env.example`](examples/.env.example) for all available configuration options. Key variables:

### Required

- `TWILIO_ACCOUNT_SID`: Twilio account SID
- `TWILIO_AUTH_TOKEN`: Twilio auth token
- `TWILIO_API_KEY`: Twilio API key SID (starts with `SK`)
- `TWILIO_API_SECRET`: Twilio API key secret
- `TWILIO_PHONE_NUMBER`: Your Twilio phone number

### Required for Orchestrator Mode (omit for ConversationRelay-only)

- `TWILIO_CONVERSATION_CONFIGURATION_ID`: Conversation Configuration ID. Omit it to run in ConversationRelay-only mode, as the [`relay-only/`](examples/relay-only/) example does.

### Optional (Voice Channel)

- `TWILIO_VOICE_PUBLIC_DOMAIN`: Public host for voice routes (required for voice, e.g., `abc123.ngrok.app`). May include a port and/or base path (e.g., `example.ngrok.app:8080` or `example.com/server1`). Schemes like `https://` and trailing slashes are stripped automatically.

### Optional (OpenAI Examples)

- `OPENAI_API_KEY`: Your OpenAI API key (only needed to run the OpenAI examples)

### Optional (Channel-Specific)

- `TWILIO_WHATSAPP_NUMBER`: WhatsApp-enabled phone number in format `whatsapp:+1234567890` (required for [`whatsapp/`](examples/whatsapp/))
- `TWILIO_RCS_SENDER_ID`: RCS Sender ID, e.g., `rcs:your_sender_id` (required for [`rcs/`](examples/rcs/) and RCS outbound)
- `TWILIO_CONVERSATIONS_SERVICE_SID`: Conversations Service SID, starts with `IS` (required for [`chat/`](examples/chat/))
- `TWILIO_STUDIO_HANDOFF_FLOW_SID`: Studio Flow SID used by `createStudioHandoffTool` to route conversations to a human agent, e.g., via Flex (required for [`handoff/`](examples/handoff/))

### Optional (Region)

- `TWILIO_REGION`: Twilio region subdomain for API routing

## Next Steps

- Customize the agent's behavior by modifying the message handler in `examples/openai/src/index.ts`
- Add tool calling to enable agent actions beyond text responses
- Explore the main [README](../README.md) for advanced features
- Review [CLAUDE.md](../CLAUDE.md) for architecture and development guidelines

## AWS and Microsoft connectors

Building AI agents on AWS or Microsoft? Connect them to Twilio's voice, messaging, and conversation context with these dedicated packages:

- **[TAC for AWS](https://github.com/twilio/twilio-agent-connect-aws)** — `StrandsConnector`, `BedrockConnector`, `BedrockAgentCoreConnector` for AWS Strands, Bedrock Agents, and Bedrock AgentCore
- **[TAC for Microsoft](https://github.com/twilio/twilio-agent-connect-microsoft)** — `AgentFrameworkConnector` and `VoiceLiveConnector` for Microsoft Agent Framework, Azure AI Foundry (including Voice Live), and Azure OpenAI
