# Outbound Conversations Example

This example demonstrates how to initiate **outbound (agent-initiated) conversations** using Twilio Agent Connect (TAC). The agent reaches out to a customer via SMS or Voice, then handles a full conversation loop powered by OpenAI.

## Supported Channels

### SMS

The agent sends an initial SMS to the customer. When the customer replies, the message arrives via Conversation Orchestrator webhook and the agent responds using OpenAI.

### Voice

The agent places an outbound phone call. When the customer answers, they can have a natural voice conversation powered by ConversationRelay (real-time speech-to-text and text-to-speech) and OpenAI.

By default, no welcome greeting is played — the agent waits for the customer to speak first (e.g., "hello?"), then responds via the `onMessageReady` callback. This mirrors how human outbound callers behave: the recipient speaks first, and the caller introduces themselves in response. You can optionally pass `--welcome-greeting` to play a greeting on pickup, but note that the customer's "hello?" may interrupt it.

### Chat (Not Supported)

Outbound chat is not included in this example. Chat is session-based — the customer initiates a session by opening a chat widget on a website. There's no way to "reach out" to a customer via chat the way you can with a phone number. For inbound chat, see the [chat example](../chat/).

## Prerequisites

1. **Node.js 22.13.0+** installed
2. **Twilio Account** with a phone number configured for SMS and/or Voice
3. **OpenAI API Key**
4. **ngrok** or similar tunneling tool for local development

## Setup

### 1. Install Dependencies

From the repository root:

```bash
npm install
npm run build
```

Then install the example's dependencies:

```bash
cd getting_started/examples/outbound
npm install
```

### 2. Configure Environment Variables

From the `getting_started/examples/` directory:

```bash
cp .env.example .env
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
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Required for Voice:

```bash
TWILIO_VOICE_PUBLIC_DOMAIN=your-domain.ngrok.app
```

### 3. Start ngrok

In another terminal:

```bash
ngrok http 8000
```

Copy the ngrok domain (e.g., `abc123.ngrok.app`) and set `TWILIO_VOICE_PUBLIC_DOMAIN` in your `.env` file.

### 4. Configure Twilio Webhooks

**SMS** — Configure Conversation Orchestrator to send webhooks to your ngrok URL:

1. In the [Console](https://1console.twilio.com/), go to **Products & services** > **Conversation Orchestrator** > **Conversation Configurations**.
2. Select your conversation configuration.
3. In the **Overview** tab, click **Edit**.
4. Set **Webhook > Callback method** to `https://abc123.ngrok.app/webhook` with HTTP method `POST`.
5. Click **Save changes**.

**Voice** — No additional webhook configuration needed for outbound calls. The TwiML and WebSocket URL are embedded in the outbound call request.

## Usage

### SMS

Send an outbound SMS and wait for replies:

```bash
npm run dev -- --to +16505551234 --channel sms --message "Hi! This is a follow-up about your recent order."
```

The agent sends the initial message, then waits for the customer to reply. Each reply triggers an OpenAI-powered response.

### Voice

Place an outbound call:

```bash
npm run dev -- --to +16505551234 --channel voice
```

The agent places the call. When the customer answers and speaks (e.g., "hello?"), their speech is transcribed and sent to `onMessageReady`, where OpenAI generates a response.

To play a greeting immediately when the call is answered:

```bash
npm run dev -- --to +16505551234 --channel voice --welcome-greeting "Hello! I'm calling about your upcoming appointment."
```

Note: the customer's "hello?" may interrupt the greeting. For most outbound use cases, omitting `--welcome-greeting` and letting the agent respond to the customer's first utterance is more natural.

### CLI Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `--to` | Yes | Recipient address (E.164 phone number for SMS/Voice) |
| `--channel` | Yes | Channel type: `sms` or `voice` |
| `--message` | SMS only | Initial outbound message text |
| `--welcome-greeting` | No | Voice greeting spoken when the call is answered |

## How It Works

### SMS Flow

```
CLI args → Start server → Send SMS via CO Send API
                              ↓
              CO auto-creates conversation via capture rules
                              ↓
              Customer replies → Webhook → onMessageReady
                              ↓
              OpenAI generates response → sendResponse via CO Send API
                              ↓
                         (repeat)
```

### Voice Flow

```
CLI args → Start server → Place outbound call with inline TwiML
              (ConversationRelay + conversationConfiguration)
                              ↓
              Customer answers → CO passively hydrates conversation
                              ↓
              ConversationRelay connects WebSocket
                              ↓
              Customer says "hello?" → Transcript → onMessageReady
                              ↓
              OpenAI generates introduction → Send text via WebSocket → TTS
                              ↓
                         (repeat until call ends)
```

## Code Structure

```
getting_started/examples/outbound/
├── src/
│   └── index.ts           # CLI + outbound conversation logic
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
└── README.md              # This file
```

## Troubleshooting

- **"TWILIO_VOICE_PUBLIC_DOMAIN is required"** — Set `TWILIO_VOICE_PUBLIC_DOMAIN` in your `.env` file to your ngrok domain (e.g., `abc123.ngrok.app`, without `https://` prefix)
- **Call goes to voicemail** — The recipient's phone may reject unknown numbers. Try calling a number you control first.
- **No SMS replies received** — Verify the Conversation Orchestrator webhook is configured to point to your ngrok URL
- **OpenAI errors** — Verify your `OPENAI_API_KEY` is set and valid
- **WebSocket connection fails** — Ensure ngrok is running and the domain matches `TWILIO_VOICE_PUBLIC_DOMAIN`
