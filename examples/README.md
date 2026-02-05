# TAC Examples

This directory contains examples demonstrating how to use the Twilio Agent Connect (TAC) with various LLM frameworks and channels.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   npm run build
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env` in your chosen example directory and fill in your credentials:
   ```bash
   ENVIRONMENT=dev  # Required: 'dev', 'stage', or 'prod'

   # Memory Service Configuration (all three required if using Twilio Memory)
   MEMORY_STORE_ID=mem_store_xxxxx...  # Optional: only if using Twilio Memory
   MEMORY_API_KEY=your_api_key  # Optional: only if using Twilio Memory
   MEMORY_API_TOKEN=your_api_token  # Optional: only if using Twilio Memory

   CONVERSATION_SERVICE_SID=ISxxxxx...
   TWILIO_ACCOUNT_SID=ACxxxxx...
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_PHONE_NUMBER=+1234567890
   OPENAI_API_KEY=sk-xxxxx...  # For examples using OpenAI
   VOICE_PUBLIC_DOMAIN=example.ngrok.io  # For voice examples (your ngrok domain)
   ```

3. **Run an example:**
   ```bash
   # Start basic SMS channel example (recommended for getting started)
   npm run dev --prefix examples/channels
   # Then: npm run sms

   # Or start Voice channel example
   npm run dev --prefix examples/channels
   # Then: npm run voice

   # Or try the multi-channel demo with advanced tools
   npm run dev --prefix examples/multi-channel-demo
   ```

## Examples Overview

### [multi-channel-demo/](multi-channel-demo/) - Advanced Multi-Channel Demo

Complete production-ready example demonstrating both SMS and Voice channels:

- **Multi-channel support** - Single server handling SMS and Voice
- **OpenAI integration** - LLM with custom business tools and function calling
- **Memory integration** - Full TAC memory retrieval and context
- **Realistic use case** - Customer service agent with lookup tools and handoff
- **Custom Tools** - Customer service tools for lookup, outage checking, and scheduling

[→ View Multi-Channel Demo](multi-channel-demo/)

### [channels/](channels/) - Channel Implementation Examples

**Recommended starting point** for new users. Production-ready examples with full control over server configuration:

- **`sms.ts`** - SMS channel webhook server with TAC integration and OpenAI
- **`voice.ts`** - Voice channel server with WebSocket setup and real-time audio
- Both examples include memory integration and conversation history

Perfect for understanding core TAC concepts. Use these examples when you need custom middleware, authentication, or integration with existing apps.

[→ View Channel Examples](channels/)

### [simple-sms-bot/](simple-sms-bot/) - Keyword-Based SMS Bot

Simple SMS bot without external AI dependencies:

- **Lightweight** - No OpenAI or external API requirements
- **Keyword responses** - Simple pattern matching for common queries
- **Memory integration** - Demonstrates TAC memory capabilities
- **Human handoff** - Shows escalation to human agents

Ideal for learning TAC fundamentals without AI complexity.

[→ View Simple SMS Bot](simple-sms-bot/)

### [basic/](basic/) - Foundation SMS Example

Basic SMS channel implementation matching Python `channels/sms.py` functionality:

- **TAC Integration** - Proper framework initialization and configuration
- **OpenAI Conversations** - GPT-4o-mini for intelligent responses
- **Profile Integration** - Uses Twilio Memory profile traits for personalization
- **Production Patterns** - Error handling, logging, and graceful shutdown

Use this as a foundation for building custom SMS applications.

[→ View Basic Example](basic/)

## What You'll Learn

- ✅ Setting up TAC with Twilio services (Memory, Conversations)
- ✅ Processing SMS and Voice webhooks
- ✅ Retrieving and using user memories and profiles
- ✅ Integrating with OpenAI for conversational AI
- ✅ Building production-ready agentic applications
- ✅ Implementing custom tools and business logic
- ✅ Handling real-time voice communication with WebSockets

## Architecture Overview

### Message Processing Flow
1. **Webhook Reception**: Twilio sends SMS/Voice webhook to your server
2. **TAC Processing**: Framework processes webhook and extracts conversation context
3. **Callback Invocation**: Your `onMessageReady` handler is called with full context
4. **Memory Retrieval**: Optional user profiles and conversation history loaded
5. **AI Generation**: Your LLM (OpenAI, etc.) generates contextual response
6. **Response Delivery**: TAC sends response back via appropriate Twilio channel

### Channel Types
- **SMS Channel**: Text-based conversations with immediate response delivery
- **Voice Channel**: Real-time audio with WebSocket streaming and TwiML generation

### Memory Integration
- **User Profiles**: Persistent user information and preferences via Twilio Memory
- **Conversation History**: Cross-session context and conversation state
- **Trait Groups**: Configurable profile data categories (Contact, Preferences, etc.)

## Development Workflow

1. **Start with [channels/](channels/)** - Learn core TAC concepts
2. **Try [multi-channel-demo/](multi-channel-demo/)** - See advanced features and tools
3. **Build custom applications** - Use examples as foundation for your use case

## Environment Setup

### ngrok for Local Development
All voice examples require a public HTTPS endpoint. Use ngrok for local development:

```bash
# Install ngrok
npm install -g ngrok

# Start ngrok tunnel
ngrok http 8000

# Use the https URL in your Twilio webhook configuration
# Example: https://abc123.ngrok.io/twiml
```

### Twilio Configuration
1. **Phone Number**: Purchase a Twilio phone number with SMS and Voice capabilities
2. **Conversation Configuration**: Create a Conversation Configuration in Twilio Console
3. **Memory Service**: Optional - Create a Sync Service for user memory/profiles
4. **Webhooks**: Configure your phone number's webhooks to point to your server endpoints

## Production Considerations

- **Security**: Implement Twilio webhook signature validation
- **Scaling**: Use load balancers and horizontal scaling for high volume
- **Monitoring**: Add comprehensive logging, metrics, and alerting
- **Error Handling**: Implement robust error recovery and fallback mechanisms
- **Performance**: Optimize for low latency, especially for voice channels
- **Compliance**: Ensure adherence to telecommunications and AI regulations

## TypeScript vs Python Parity

These TypeScript examples provide 1:1 parity with the Python TAC implementation:

| TypeScript | Python | Description |
|------------|--------|-------------|
| `channels/sms.ts` | `channels/sms.py` | Basic SMS channel with OpenAI |
| `channels/voice.ts` | `channels/voice.py` | Voice channel with WebSocket |
| `multi-channel-demo/` | `exec_demo/` | Advanced multi-channel demo |
| `basic/` | - | Foundation SMS example (TypeScript-specific) |
| `simple-sms-bot/` | - | Keyword-based bot (TypeScript-specific) |

## Need Help?

- See individual example READMEs for detailed setup and usage instructions
- Review [DEVELOPMENT.md](../DEVELOPMENT.md) for development guidelines