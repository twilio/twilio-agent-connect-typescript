# Basic SMS Channel Example

A production-ready SMS channel implementation for Twilio Agent Connect. This example demonstrates basic TAC integration with OpenAI for conversational SMS responses, matching the Python `channels/sms.py` example functionality.

## What This Example Does

- **SMS Channel Integration**: Full TAC SMS channel setup with webhook processing
- **OpenAI Conversations**: Uses GPT-4o-mini for intelligent, context-aware responses
- **Memory Integration**: Optional Twilio Memory support for persistent user context
- **Profile Traits**: Automatically incorporates user profile information for personalized responses
- **Conversation History**: Maintains conversation context across multiple message exchanges

## Features Demonstrated

- TAC SMS channel initialization and configuration
- OpenAI GPT-4o-mini integration for conversational responses
- Twilio Memory service integration for user context retrieval
- Profile trait extraction and personalization
- Conversation history management
- Production-ready error handling and logging

## How to Run

### Prerequisites

1. **Twilio Account** with SMS capabilities
2. **OpenAI API Key** for conversational responses
3. **Environment Setup**: Create `.env` file in this directory:

```bash
# Required Variables
ENVIRONMENT=dev
CONVERSATION_SERVICE_ID=your_conversation_service_sid_here
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
OPENAI_API_KEY=your_openai_api_key_here

# Optional Memory Variables (for user context/profiles)
MEMORY_STORE_ID=your_memory_store_id_here
MEMORY_API_KEY=your_api_key_here
MEMORY_API_TOKEN=your_api_token_here
TRAIT_GROUPS=Contact,Preferences
```

### Installation and Startup

```bash
# From project root - install and build all packages
npm install
npm run build

# Install example dependencies
npm install --prefix examples/basic

# Start the server
npm run dev --prefix examples/basic
```

The server starts on `http://localhost:8000` with endpoints:
- `POST /sms` - SMS webhook endpoint

### Twilio Configuration

1. **Configure SMS Webhook** in your Twilio Console:
   - Go to Phone Numbers → Manage → Active numbers
   - Select your Twilio phone number
   - Set SMS webhook URL to: `https://your-domain.com:8000/sms`
   - Use ngrok for local development: `ngrok http 8000`

## Example Conversations

Send SMS messages to your Twilio number to test:

| User Message | AI Response |
|-------------|-------------|
| "Hello!" | Personalized greeting using profile information if available |
| "What's the weather?" | Contextual response maintaining conversation history |
| "My name is John" | AI remembers and uses the name in future responses |

## Code Structure

```
├── server.ts           # Main TAC SMS implementation
├── package.json        # Dependencies including TAC and OpenAI
├── tsconfig.json      # TypeScript configuration
└── README.md          # This file
```

### Key Implementation Details

- **Message Handler** (`lines 47-148`): Processes incoming messages with OpenAI integration
- **Profile Integration** (`lines 77-114`): Extracts and uses Twilio Memory profile traits
- **Conversation History** (`lines 39, 122-144`): Maintains context across message exchanges
- **TAC Integration** (`lines 172-188`): Full framework initialization and channel setup

## Understanding the Flow

### Message Processing Pipeline
1. **Webhook Reception**: Twilio sends SMS webhook to `/sms` endpoint
2. **TAC Processing**: SMS channel processes webhook and extracts message
3. **Callback Invocation**: `handleMessageReady` function is called with context
4. **Memory Retrieval**: Optional profile traits and conversation history loaded
5. **OpenAI Generation**: GPT-4o-mini generates response using full context
6. **Response Delivery**: TAC sends response back via SMS channel

### Profile Personalization
- **Contact Info**: Uses first name, last name, and location from user profile
- **Preferences**: Incorporates language preferences and other user settings
- **Dynamic Context**: Profile information is injected as system messages for personalization

## Memory Integration

This example supports optional Twilio Memory integration for:
- **User Profiles**: Persistent user information and preferences
- **Conversation Context**: Cross-session conversation history
- **Trait Groups**: Configurable profile data categories

## Related Examples

- **[Simple SMS Bot](../simple-sms-bot/)** - Keyword-based responses without external AI
- **[Multi-Channel Demo](../multi-channel-demo/)** - Advanced TAC with tools and multiple channels

## Troubleshooting

- **OpenAI Errors**: Verify API key is correct and has sufficient credits
- **Memory Errors**: Check Twilio Memory service SID and API credentials
- **Webhook Errors**: Ensure ngrok is running and webhook URL is properly configured
- **TAC Initialization**: Verify all required environment variables are set

## Development Notes

- **Python Parity**: This example matches `channels/sms.py` from the Python TAC implementation
- **Production Ready**: Includes proper error handling, logging, and graceful shutdown
- **Memory Optional**: Works with or without Twilio Memory service configuration
- **Conversation Persistence**: Maintains context across multiple message exchanges
- **Profile Integration**: Automatically uses Twilio Memory profile traits for personalization

## Production Considerations

1. **Replace Mock Responses**: Customize the system prompt and conversation logic for your use case
2. **Add Authentication**: Implement user verification before processing messages
3. **Rate Limiting**: Add proper rate limiting for production usage
4. **Monitoring**: Implement logging, metrics, and alerting
5. **Error Handling**: Enhance error recovery and fallback mechanisms
6. **Scaling**: Consider horizontal scaling for high-volume applications