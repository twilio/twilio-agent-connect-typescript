# Simple SMS Bot Example

This example demonstrates how to create a basic SMS bot using the Twilio Agent Connect. The bot responds to SMS messages using simple keyword matching without requiring external AI services, making it lightweight and perfect for learning the core TAC concepts.

## Features

- 📱 Responds to SMS messages
- 🧠 Accesses user memory
- 🤝 Supports handoff to human agents
- 🔧 Simple setup and configuration

## Quick Start

### From Repository Root (Recommended)

1. **Install all dependencies**:
   ```bash
   npm install
   ```

2. **Build the framework packages**:
   ```bash
   npm run build
   ```

3. **Configure environment**:
   ```bash
   cp examples/simple-sms-bot/.env.example examples/simple-sms-bot/.env
   # Edit .env with your Twilio credentials
   ```

4. **Run the example**:
   ```bash
   npm run example:sms
   ```

### From Example Directory

1. **Install dependencies** (from repo root first):
   ```bash
   cd ../../ && npm install && cd examples/simple-sms-bot
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your Twilio credentials
   ```

3. **Start the bot**:
   ```bash
   npm run dev
   ```

> **Note**: This example uses `*` dependencies to automatically pull in your local TAC packages. Any changes you make to the framework will be reflected when you rebuild and restart the example.

4. **Configure Twilio webhook**:
   - Go to your Twilio Console
   - Navigate to Messaging > Services > [Your Service]
   - Set the webhook URL to: `http://your-domain.com/sms`

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ENVIRONMENT` | Environment (dev/stage/prod) | Yes |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID | Yes |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token | Yes |
| `TWILIO_PHONE_NUMBER` | Your Twilio phone number | Yes |
| `MEMORY_STORE_ID` | Memory Store ID (mem_service_xxx) | Yes |
| `CONVERSATION_SERVICE_ID` | Conversation Service ID (comms_service_xxx) | Yes |

## Example Interactions

Send these messages to your bot:

- **"Hello"** - Get a friendly greeting
- **"Help"** - See available commands
- **"Memory"** - Check what the bot remembers about you
- **"Human"** - Request to speak with a human agent

## Code Structure

- `src/index.ts` - Main bot implementation
- `.env` - Environment configuration
- `package.json` - Dependencies and scripts

## Next Steps

- Integrate with your preferred LLM (OpenAI, Anthropic, etc.)
- Add custom tools for your specific use case
- Implement proper human handoff logic
- Add logging and monitoring
- Deploy to production

## Related Examples

- [Voice Assistant](../voice-assistant/) - Voice-based bot
- [Multi-Channel Demo](../multi-channel-demo/) - Combined SMS + Voice