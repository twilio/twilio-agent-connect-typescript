# OpenAI SDK Example

This example demonstrates how to use OpenAI with Twilio Agent Connect (TAC) to build an intelligent conversational agent that works across both SMS and Voice channels.

## What This Example Does

- **Multi-Channel Support**: Handles both SMS and Voice conversations in a single application
- **OpenAI Integration**: Uses GPT-4o-mini for intelligent, context-aware responses
- **Memory Integration**: Automatically retrieves user profiles and conversation history from Twilio Memory
- **Profile Personalization**: Incorporates user profile traits into responses for personalized interactions
- **Conversation History**: Maintains context across multiple message exchanges

## Prerequisites

1. **Node.js 22.13.0+** installed
2. **Twilio Account** with a phone number
3. **OpenAI API Key** for GPT-4o-mini access
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
cd getting_started/examples/openai
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

### 3. Run the Server

```bash
npm run dev
```

The server starts on `http://localhost:8000` with endpoints:

- `POST /webhook` - SMS webhook endpoint
- `POST /twiml` - Voice webhook endpoint (generates TwiML)
- `WS /ws` - Voice WebSocket endpoint
- `POST /conversation-relay-callback` - Voice callback endpoint

### 4. Expose Your Server

In another terminal, start ngrok:

```bash
ngrok http 8000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok.app`).

### 5. Configure Twilio Webhooks

**SMS:**

1. In the [Console](https://1console.twilio.com/), go to **Products & services** > **Conversation Orchestrator** > **Conversation Configurations**.
2. Select your conversation configuration.
3. In the **Overview** tab, click **Edit**.
4. Set **Webhook > Callback method** to `https://abc123.ngrok.app/webhook` with HTTP method `POST`.
5. Click **Save changes**.

**Voice:**

1. In the [Console](https://1console.twilio.com/), go to **Products & services** > **Numbers & senders**.
2. Select your Twilio phone number.
3. Under **Voice configuration**, set the webhook URL to `https://abc123.ngrok.app/twiml` with HTTP method `POST`.

## Example Conversations

### SMS

Send an SMS to your Twilio number:

- "Hello!" → AI responds with a personalized greeting
- "What can you help me with?" → AI explains its capabilities
- "Remember my name is John" → AI remembers and uses your name in future conversations

### Voice

Call your Twilio number:

- Say "Hello" → AI responds via voice
- Have a natural conversation → AI maintains context across the call
- Conversation history is preserved for future calls

## Code Structure

```
getting_started/examples/openai/
├── src/
│   └── index.ts           # Main application
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
└── README.md              # This file
```

## Key Features

### Memory Integration

When Memory is configured and channels are set to `memoryMode: 'always'`, TAC automatically:

- Retrieves user profile information before each message
- Includes profile traits (name, preferences, etc.) in the AI context
- Loads recent conversation history for context continuity

The example configures channels with automatic memory retrieval:

```typescript
const voiceChannel = new VoiceChannel(tac, { memoryMode: 'once' });
const smsChannel = new SMSChannel(tac, { memoryMode: 'always' });
```

Voice uses `'once'` (fetch once per conversation and reuse the cache across calls until the conversation becomes INACTIVE), while SMS uses `'always'` (fetch on every message). To disable automatic memory retrieval (default is `'never'`), omit the `memoryMode` option or use `tac.retrieveMemory()` in your callback for conditional retrieval.

### MemoryPromptBuilder

The example uses `MemoryPromptBuilder` to automatically format memory data into structured prompts that include:

- **Customer Profile**: Profile traits such as name, preferences, and other known customer details when available
- **Key Observations**: Important notes from previous interactions
- **Past Conversation Summaries**: Summaries of previous conversations
- **Recent Message History**: Recent communications with the customer

This context is injected as a system message to help the AI provide context-aware responses.

### Conversation History

The application maintains conversation history per conversation ID, allowing the AI to:

- Remember what was said earlier in the conversation
- Provide contextually relevant responses
- Build on previous exchanges

## Production Considerations

1. **Error Handling**: Add comprehensive error handling and retry logic
2. **Rate Limiting**: Implement rate limiting to prevent abuse
3. **Monitoring**: Add logging and metrics for production debugging
4. **Security**: Enable Twilio webhook signature validation in production
5. **Scaling**: Consider horizontal scaling for high-volume applications
6. **Cost Management**: Monitor OpenAI API usage and implement cost controls

## Next Steps

- Customize the system prompt for your specific use case
- Add tool calling to enable agent actions (e.g., look up information, create tickets)
- Implement conversation handoff to human agents
- Add support for additional channels (WhatsApp, etc.)

## Troubleshooting

- **OpenAI Errors**: Verify your API key and check for rate limits
- **Memory Errors**: Ensure Memory service credentials are correct
- **Webhook Errors**: Verify ngrok is running and webhooks are configured correctly
- **WebSocket Issues**: Check that your ngrok URL uses HTTPS for WebSocket connections
