# TAC Exec Connect Demo

A complete, production-ready example demonstrating how to build an AI-powered customer service agent using TAC with both SMS and Voice channels, powered by the OpenAI Agents SDK.

> **Prerequisites:** Ensure you have completed the TAC setup and have the required Twilio and OpenAI credentials.

## Overview

This demo simulates **Owl Internet**, a fictional ISP's customer service agent that can:
- Handle customer inquiries via SMS and Voice
- Retrieve customer context and conversation history using TAC memory
- Look up internet plan pricing and process orders
- Run router diagnostics and check service outages
- Provide personalized responses based on customer profile
- Escalate to human agents when needed (voice only)

**Use Case:** An internet service provider customer can text or call to inquire about plan upgrades, check for outages, run diagnostics, and the AI agent retrieves their current plan, offers relevant options, and processes orders.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      TACServer (Fastify)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  /sms        │  │  /twiml      │  │  /voice      │      │
│  │  SMS webhook │  │  TwiML gen   │  │  WebSocket   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │ SMSChannel  │    │VoiceChannel │    │VoiceChannel │
    └─────────────┘    └─────────────┘    └─────────────┘
           │                  │                  │
           └──────────────────┴──────────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │   TAC Core      │
                 │  Memory/Context │
                 └─────────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │   LLM Service   │
                 │  (OpenAI Agent) │
                 └─────────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ Business Tools  │
                 │ - get_plans     │
                 │ - pricing       │
                 │ - diagnostics   │
                 │ - outages       │
                 │ - confirm_order │
                 └─────────────────┘
```

## Files

- **`src/index.ts`** - Main server with TAC initialization and message handling
- **`src/llm-service.ts`** - LLM integration using OpenAI Agents SDK with tool calling
- **`src/tools.ts`** - Business-specific tools (order lookup, pricing, confirmation)
- **`src/business-data.ts`** - Company information and internet plan data

## Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Required Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_PHONE_NUMBER=+1xxx
TWILIO_CONVERSATION_SERVICE_SID=CHxxxx

# Optional: Twilio Memory
TWILIO_MEMORY_STORE_ID=MEMxxxx
TWILIO_MEMORY_API_KEY=xxxx
TWILIO_MEMORY_API_TOKEN=xxxx

# Required: OpenAI
OPENAI_API_KEY=sk-xxxx

# Voice Configuration (optional)
TWILIO_VOICE_PUBLIC_DOMAIN=your-ngrok-domain.ngrok.app
```

## Running the Demo

### 1. Install Dependencies

From the repository root:

```bash
npm install
```

### 2. Start the Server

```bash
npm run example:exec
```

Or directly:

```bash
cd examples/exec-connect-demo
npm run dev
```

The server will start on `http://0.0.0.0:3000` with:
- `/sms` - SMS webhook endpoint
- `/twiml` - Voice TwiML generation endpoint
- `/voice` - Voice WebSocket endpoint

### 3. Test with SMS

**Setup Twilio Webhook:**

1. Start ngrok tunnel:
   ```bash
   ngrok http 3000 --domain=your-ngrok-domain
   ```

2. Your ngrok URL will be `https://your-ngrok-domain`

3. Configure Twilio Conversations API Webhook:
   - Go to Twilio Console → Conversations → Configuration
   - Set "Post-Event Webhook URL" to: `https://your-ngrok-domain/sms`
   - Enable webhook events: `onMessageAdded`, `onConversationAdded`, `onConversationRemoved`

4. Send an SMS to your Twilio phone number to interact with the agent

### 4. Test with Voice

1. Start ngrok tunnel (if not already running):
   ```bash
   ngrok http 3000 --domain=your-ngrok-domain
   ```

2. Update `.env` with ngrok domain:
   ```bash
   TWILIO_VOICE_PUBLIC_DOMAIN=your-ngrok-domain
   ```

3. Configure Twilio phone number webhook to: `https://your-ngrok-domain/twiml`

4. Call your Twilio phone number to interact with the voice agent

## Key Features

### 1. Multi-Channel Support

The same logic handles both SMS and Voice:

```typescript
if (context.channel === 'sms') {
  await smsChannel.sendResponse(conversationId, response);
} else if (context.channel === 'voice') {
  await voiceChannel.sendResponse(conversationId, response, 'assistant');
}
```

### 2. Memory Integration

TAC automatically retrieves customer context:

```typescript
tac.onMessageReady(async (userMessage, context, memoryResponse) => {
  // Memory response contains:
  // - observations: User preferences, past interactions
  // - summaries: Conversation summaries
  // - communications: Historical conversation sessions

  const llmResponse = await llmService.processMessage(
    userMessage,
    memoryResponse,
    context,
    websocket,
    conversationHistory
  );
});
```

### 3. Business Tools with OpenAI Agents SDK

Custom tools for business logic:

```typescript
export const lookUpOrderPrice = functionTool({
  name: 'look_up_order_price',
  description: 'Get pricing for internet plan upgrade',
  parameters: {
    type: 'object',
    properties: {
      planSpeed: {
        type: 'string',
        description: 'Target internet speed (e.g., "1000 Mbps")',
      },
    },
    required: ['planSpeed'],
  },
  execute: async ({ planSpeed }) => {
    // Business logic here
    return pricingInfo;
  },
});
```

The LLM agent automatically calls these tools when needed.

### 4. Conversation History Management

User-managed conversation history for context:

```typescript
const conversationMessages = new Map<string, ChatCompletionMessageParam[]>();

// Add messages to history
history.push({ role: 'user', content: userMessage });
history.push({ role: 'assistant', content: llmResponse });
```

## Example Conversation Flow

**Customer (via SMS):** "I want to upgrade my internet plan"

1. **Webhook received** → `/sms` endpoint
2. **SMS channel processes** → Extracts message, conversation ID, profile ID
3. **TAC retrieves memory** → Gets customer's current plan, preferences, history
4. **Message ready callback** → Triggers with context and memories
5. **LLM processes** → Agent uses customer context + business tools
6. **Tool execution** → Calls `look_up_order_price("1000 Mbps")`
7. **Response generated** → "Based on your current 500 Mbps plan, you can upgrade to..."
8. **Response sent** → Via SMS channel back to customer

## Customization

### Adding New Tools

1. Define tool in `src/tools.ts`:
   ```typescript
   export const myCustomTool = functionTool({
     name: 'my_custom_tool',
     description: 'Tool description',
     parameters: {
       type: 'object',
       properties: {
         param: { type: 'string', description: 'Parameter description' },
       },
       required: ['param'],
     },
     execute: async ({ param }) => {
       // Implementation
       return result;
     },
   });
   ```

2. Add to `llm-service.ts` baseTools array

### Updating Business Data

Modify `src/business-data.ts` to update:
- Company information
- Internet plans and pricing
- Router models and specifications
- Any business-specific constants

### Changing LLM Model

Update in `src/llm-service.ts`:
```typescript
const agent = new Agent({
  name: 'Owl Internet Customer Service',
  instructions: enhancedInstructions,
  model: 'gpt-4o-mini',  // Change model here
  tools,
});
```

## Tools Available

1. **get_available_plans** - List all internet plans with details
2. **look_up_order_price** - Get pricing for specific plan speed
3. **look_up_outage** - Check for service outages by zip code
4. **run_diagnostic** - Check router compatibility with plan
5. **look_up_discounts** - Find available discounts and promotions
6. **confirm_order** - Send order confirmation via SMS (with TAC integration)
7. **flex_escalate_to_human** - Escalate to human agent in Flex (voice only)

## Technology Stack

- **TypeScript** - Type-safe development
- **TAC (Twilio Agent Connect)** - Multi-channel framework
- **TACServer (Fastify)** - High-performance HTTP server
- **OpenAI Agents SDK** - AI agent orchestration with tools
- **Twilio SDK** - Platform integration
- **WebSocket (ws)** - Real-time voice communication

## Next Steps

- Integrate with real customer database
- Add authentication and authorization
- Implement analytics and monitoring
- Connect to actual billing systems
- Add more sophisticated diagnostics
- Integrate with CRM systems
