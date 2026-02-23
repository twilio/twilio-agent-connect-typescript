# TAC Channel Examples

Production-ready channel implementation examples for Twilio Agent Connect (TAC).

> **Prerequisites:** Complete the [Quick Start setup](../README.md#quick-start) in the main examples README before running these servers.

## Profile Traits (Optional Feature)

All examples support optional profile trait retrieval from Twilio Memory. When configured, profile traits are automatically fetched and made available in the callback context.

**Environment Variable:**
```bash
TRAIT_GROUPS="Contact,Preferences"  # Optional: Specify which trait groups to fetch
```

**Accessing Profile Traits in Callbacks:**
```typescript
async function handleMessageReady(params: {
  conversationId: ConversationId;
  memory: MemoryRetrievalResponse | undefined;
  // ... other params
}): Promise<string> {
  // Initialize conversation with system message
  if (!conversationMessages.has(conversationId)) {
    const systemMsg = { role: 'system', content: systemPrompt };
    conversationMessages.set(conversationId, [systemMsg]);

    // Add profile traits as context for personalized responses
    if (params.memory?.observations.length) {
      const profileContext = "User Profile:\n" +
        params.memory.observations
          .slice(0, 3)
          .map(obs => `- ${obs.observation}`)
          .join('\n');

      const contextMsg = { role: 'system', content: profileContext };
      conversationMessages.get(conversationId)!.push(contextMsg);
    }
  }

  // Now LLM can greet user by name: "Hello, John! How can I help you today?"
  // ...rest of your logic
}
```

**Behavior by Channel:**
- **SMS**: Memory retrieval happens on every message
- **Voice**: Memory retrieval happens once at conversation start

## Available Examples

### [SMS Channel](./sms.ts)
Basic SMS channel implementation with OpenAI integration.

```bash
# Run SMS example
npm run dev:sms
```

**Features:**
- Full SMS webhook processing
- OpenAI GPT-4o-mini conversational responses
- Conversation history management
- Optional Twilio Memory integration
- Profile trait personalization

**Webhook Configuration:**
- SMS webhook: `POST https://your-domain.com/sms`

### [Voice Channel](./voice.ts)
Basic voice channel implementation with real-time WebSocket communication.

```bash
# Run Voice example
npm run dev:voice
```

**Features:**
- TwiML generation for voice calls
- WebSocket connection for real-time audio streaming
- OpenAI integration for voice responses
- Memory retrieval and context management
- Bi-directional voice communication

**Webhook Configuration:**
- Voice webhook: `POST https://your-domain.com/twiml`
- WebSocket endpoint: `WS https://your-domain.com/voice`

## Environment Configuration

Create a `.env` file in this directory with the following variables:

### Required Variables
```bash
# Environment
ENVIRONMENT=dev                           # dev/stage/prod

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_phone_number
CONVERSATION_SERVICE_ID=your_conversation_service_sid

# AI Configuration
OPENAI_API_KEY=your_openai_api_key
```

### Optional Memory Variables
```bash
# Twilio Memory Service (for user profiles and conversation history)
MEMORY_STORE_ID=your_memory_store_id
MEMORY_API_KEY=your_memory_api_key
MEMORY_API_TOKEN=your_memory_api_token
TRAIT_GROUPS=Contact,Preferences          # Comma-separated trait groups
```

### Optional Voice Variables
```bash
# Voice-specific configuration
VOICE_PUBLIC_DOMAIN=your-domain.com       # For production WebSocket connections
PORT=8000                                 # Server port (default: 8000)
```

## Quick Start

1. **Install dependencies:**
   ```bash
   # From project root
   npm install
   npm run build

   # Install channel example dependencies
   npm install --prefix examples/channels
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Run an example:**
   ```bash
   # SMS Channel
   npm run dev:sms

   # Voice Channel
   npm run dev:voice
   ```

4. **Configure Twilio webhooks:**
   - Use ngrok for local development: `ngrok http 8000`
   - Set webhook URLs in Twilio Console to your ngrok URL

## Example Interactions

### SMS Channel
Send these messages to test the SMS channel:

| Message | AI Response |
|---------|-------------|
| "Hello!" | Personalized greeting using profile information |
| "What's the weather?" | Contextual response with conversation history |
| "My name is Sarah" | AI remembers and uses name in future responses |

### Voice Channel
Call your Twilio number to test the Voice channel:

- **"Hello, how are you?"** - Natural voice conversation
- **"Tell me about the weather"** - AI responds with contextual information
- **"What did I ask before?"** - Demonstrates conversation memory

## Architecture

### Message Flow
1. **Webhook Reception**: Twilio sends webhook to appropriate endpoint
2. **TAC Processing**: TAC processes webhook and extracts message
3. **Callback Invocation**: `handleMessageReady` function called with context
4. **Memory Retrieval**: Optional profile traits and history loaded
5. **AI Generation**: OpenAI generates response using full context
6. **Response Delivery**: TAC TAC sends response back via appropriate channel

### Memory Integration
- **SMS**: Retrieves memory on each message for full context
- **Voice**: Retrieves memory once at conversation start for efficiency
- **Profile Traits**: Automatically injected as system messages for personalization

## Development Notes

- **Python Parity**: These examples match the functionality of the Python TAC implementation
- **Production Ready**: Include proper error handling, logging, and graceful shutdown
- **Memory Optional**: All examples work with or without Twilio Memory service
- **Conversation Persistence**: Maintain context across multiple message exchanges
- **WebSocket Support**: Voice channel includes real-time bi-directional communication

## Troubleshooting

### Common Issues
- **OpenAI Errors**: Verify API key and check rate limits/credits
- **Memory Errors**: Check Twilio Memory service SID and API credentials
- **Webhook Errors**: Ensure ngrok is running and URLs are correctly configured
- **WebSocket Issues**: Verify WebSocket endpoint is accessible and not blocked by firewall

### Voice Channel Specific
- **Audio Quality**: Check network connection and WebSocket stability
- **Latency Issues**: Ensure server is geographically close to users
- **Connection Drops**: Implement reconnection logic for production use

## Production Considerations

1. **Security**: Implement proper webhook signature validation
2. **Scaling**: Use load balancers and horizontal scaling for high volume
3. **Monitoring**: Add comprehensive logging, metrics, and alerting
4. **Error Handling**: Implement robust error recovery and fallback mechanisms
5. **Performance**: Optimize for low latency, especially for voice channels
6. **Compliance**: Ensure adherence to telecommunications regulations

## Related Examples

- **[Simple SMS Bot](../simple-sms-bot/)** - Keyword-based responses without AI
- **[Multi-Channel Demo](../multi-channel-demo/)** - Advanced TAC with tools and multiple channels
- **[Basic Example](../basic/)** - Foundation SMS example with TAC integration