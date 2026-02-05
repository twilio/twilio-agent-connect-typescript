# Multi-Channel Customer Service Demo

A comprehensive customer service bot that demonstrates advanced TAC capabilities across both SMS and Voice channels. This example integrates with OpenAI GPT-4o and showcases the full power of the Twilio Agent Connect with custom tools, conversation memory, and intelligent agent behavior.

## What This Example Does

- **Multi-Channel Support**: Works seamlessly across SMS and Voice channels
- **AI-Powered Responses**: Uses OpenAI GPT-4o for intelligent, context-aware conversations
- **Custom Tool Integration**: Implements customer service tools (lookup, outage checking, technician scheduling)
- **Advanced Memory**: Maintains conversation history and customer context across sessions
- **Professional Customer Service**: Handles realistic customer support scenarios
- **Human Handoff**: Intelligent escalation to human agents when needed

## Features Demonstrated

- OpenAI function calling with TAC tools
- Complex conversation state management
- Multi-turn conversations with context retention
- Custom business logic implementation
- Voice channel WebSocket handling
- Professional error handling and graceful degradation

## Architecture

This example simulates a **TechCorp Internet Services** customer support system with:

### Customer Database
- Simulated customer records with account details, service plans, billing info
- Service history and outage tracking
- Account balances and service addresses

### Custom Tools
- **Customer Lookup**: Retrieve account information by phone number
- **Service Outage Checker**: Check for current and recent outages in customer area
- **Technician Scheduling**: Schedule service appointments for technical issues
- **Memory Tools**: Access conversation history and customer preferences

## How to Run

### Prerequisites

1. **Twilio Account** with SMS and Voice capabilities
2. **OpenAI API Key** for GPT-4o access
3. **Environment Setup**: Create `.env` file in this directory:

```bash
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
CONVERSATION_SERVICE_ID=comms_service_xxxx
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Memory Service
MEMORY_STORE_ID=mem_store_xxxx
MEMORY_API_KEY=your_api_key_here
MEMORY_API_TOKEN=your_api_token_here
```

### Installation and Startup

```bash
# From project root - install and build
npm install
npm run build

# Start the demo
npm run dev
```

The server starts on `http://localhost:8000` with endpoints:
- `POST /sms` - SMS webhook endpoint
- `POST /twiml` - Voice TwiML endpoint
- `WS /voice` - Voice WebSocket endpoint

### Twilio Configuration

#### SMS Setup
1. Go to Phone Numbers → Manage → Active numbers
2. Select your Twilio phone number
3. Set SMS webhook: `https://your-domain.com/sms`

#### Voice Setup
1. Go to Phone Numbers → Manage → Active numbers
2. Select your Twilio phone number
3. Set Voice webhook: `https://your-domain.com/twiml`

**For local development**: Use ngrok to expose your local server:
```bash
ngrok http 8000
# Use the https URL for webhook configuration
```

## Example Interactions

### SMS Examples
Send these messages to test the system:

| Message | AI Response |
|---------|------------|
| "Check my account status" | Uses customer lookup tool to retrieve account details |
| "Is there an outage in my area?" | Checks service outages for your location |
| "Schedule a technician visit" | Guides through appointment scheduling process |
| "I need help with my bill" | Provides billing information and payment options |
| "Transfer me to an agent" | Initiates human handoff process |

### Voice Examples
Call your Twilio number and try:
- "What's my current plan?"
- "I'm having internet issues"
- "When is my next bill due?"
- "Let me talk to someone"

## Code Structure

```
src/
├── index.ts              # Main application with OpenAI integration
├── package.json          # Dependencies including OpenAI
└── tsconfig.json         # TypeScript configuration
```

### Key Implementation Details

- **OpenAI Integration** (`lines 222-228`): GPT-4o with function calling
- **Custom Tools** (`lines 69-142`): Customer service tools (lookup, outage check, scheduling)
- **Conversation History** (`lines 145-312`): Full context management
- **Multi-Channel Handler** (`lines 148-313`): Unified message processing
- **Error Handling** (`lines 309-312`): Graceful degradation

### Simulated Customer Data

The demo includes test customers:
- **+1234567890**: John Doe (Premium Internet, recent outages)
- **+0987654321**: Jane Smith (Basic Internet, clean record)

## Advanced Features

### AI Tool Integration
- Tools are automatically registered with OpenAI function calling
- Responses include tool results in natural language
- Multi-step conversations with tool chaining

### Memory System
- Automatic conversation persistence
- Customer preference learning
- Context-aware responses based on history

### Voice Channel
- Real-time WebSocket communication
- Bi-directional audio streaming
- Interrupt handling for natural conversations

## Development Notes

- **OpenAI Costs**: Uses GPT-4o - monitor usage in production
- **Tool Extensibility**: Easy to add new tools following the established pattern
- **Database Integration**: Replace simulated data with real database calls
- **Error Recovery**: Comprehensive error handling with fallback responses

## Production Considerations

1. **Replace Mock Data**: Integrate with real customer database
2. **Implement Real Handoff**: Connect to actual support ticketing system
3. **Add Authentication**: Verify customer identity before tool usage
4. **Monitoring**: Add logging, metrics, and alerting
5. **Rate Limiting**: Implement proper API rate limiting
6. **Security**: Add input validation and sanitization

## Next Steps

To extend this example:

1. **Custom Business Logic**: Add industry-specific tools and workflows
2. **Advanced AI**: Implement retrieval-augmented generation (RAG)
3. **Multi-Language**: Add internationalization support
4. **Analytics**: Track conversation metrics and customer satisfaction
5. **Integration**: Connect to CRM, billing, and support systems

## Troubleshooting

- **OpenAI Errors**: Verify API key and check rate limits
- **Tool Failures**: Check tool implementation and parameter validation
- **WebSocket Issues**: Ensure proper ngrok setup for voice channel
- **Memory Problems**: Verify Twilio Sync service configuration