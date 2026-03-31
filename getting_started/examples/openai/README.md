# OpenAI SDK Example

This example demonstrates how to use OpenAI with Twilio Agent Connect (TAC) to build an intelligent conversational agent that works across both SMS and Voice channels.

## What This Example Does

- **Multi-Channel Support**: Handles both SMS and Voice conversations in a single application
- **OpenAI Integration**: Uses GPT-4o-mini for intelligent, context-aware responses
- **Memory Integration**: Automatically retrieves user profiles and conversation history from Twilio Memory
- **Profile Personalization**: Incorporates user profile traits into responses for personalized interactions
- **Conversation History**: Maintains context across multiple message exchanges

## Prerequisites

1. **Node.js 20+** installed
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

### 2. Configure Environment Variables

```bash
cd getting_started/examples/openai
cp ../.env.example .env
# Edit .env with your credentials
```

Required variables:

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
CONVERSATION_SERVICE_ID=conv_configuration_xxxxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Optional (for Memory integration):

```bash
MEMORY_STORE_ID=mem_store_xxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Run the Server

```bash
npm run dev
```

The server starts on `http://localhost:3000` with endpoints:

- `POST /sms` - SMS webhook endpoint
- `POST /twiml` - Voice webhook endpoint (generates TwiML)
- `WS /ws` - Voice WebSocket endpoint
- `POST /conversation-relay-callback` - Voice callback endpoint

### 4. Expose Your Server

In another terminal, start ngrok:

```bash
ngrok http 3000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok.io`).

### 5. Configure Twilio Webhooks

1. Go to [Twilio Console](https://console.twilio.com/us1/develop/phone-numbers/manage/active)
2. Select your Twilio phone number
3. Configure webhooks:
   - **SMS**: Set "A MESSAGE COMES IN" webhook to `https://abc123.ngrok.io/sms`
   - **Voice**: Set "A CALL COMES IN" webhook to `https://abc123.ngrok.io/twiml`

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
├── tsup.config.ts         # Build config
└── README.md              # This file
```

## Key Features

### Memory Integration

When Memory is configured, TAC automatically:

- Retrieves user profile information before each conversation
- Includes profile traits (name, preferences, etc.) in the AI context
- Loads recent conversation history for context continuity

### Profile Personalization

The example extracts profile traits and includes them as system messages to OpenAI:

```typescript
User Profile:
Contact: {"firstName": "John", "lastName": "Doe"}
Preferences: {"language": "en"}
```

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
