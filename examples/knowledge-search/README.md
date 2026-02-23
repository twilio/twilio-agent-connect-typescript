# Knowledge Search Example

This example demonstrates how to use the knowledge search tool with Twilio Agent Connect. When users send an SMS, the bot searches a knowledge base and returns relevant results.

## Features

- 🔍 Searches knowledge base for user queries
- 📱 Responds via SMS
- 🔧 Simple setup with minimal code

## Prerequisites

Before running this example, you need to set up a knowledge base:

1. **Create a Knowledge Base** in Twilio Console
   - Navigate to AI Assistants > Knowledge
   - Create a new knowledge base
   - Note the ID (format: `know_knowledgebase_*`)

2. **Upload Content** to the knowledge base
   - Add documents, FAQs, or other content
   - Wait for the knowledge base status to become `ACTIVE`

3. **Get Memory API Credentials**
   - Knowledge access uses the same credentials as Memory
   - Obtain your `MEMORY_API_KEY` and `MEMORY_API_TOKEN` from Twilio

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ENVIRONMENT` | Environment (dev/stage/prod) | Yes |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID | Yes |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token | Yes |
| `TWILIO_PHONE_NUMBER` | Your Twilio phone number | Yes |
| `CONVERSATION_SERVICE_ID` | Conversation Service ID (comms_service_xxx) | Yes |
| `MEMORY_API_KEY` | Memory API Key (for Knowledge access) | Yes |
| `MEMORY_API_TOKEN` | Memory API Token (for Knowledge access) | Yes |
| `KNOWLEDGE_BASE_ID` | Knowledge Base ID (know_knowledgebase_xxx) | Yes |

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
   cp examples/knowledge-search/.env.example examples/knowledge-search/.env
   # Edit .env with your credentials
   ```

4. **Run the example**:
   ```bash
   cd examples/knowledge-search && npm run dev
   ```

### From Example Directory

1. **Install dependencies** (from repo root first):
   ```bash
   cd ../../ && npm install && cd examples/knowledge-search
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Start the bot**:
   ```bash
   npm run dev
   ```

4. **Configure Twilio webhook**:
   - Go to your Twilio Console
   - Navigate to Messaging > Services > [Your Service]
   - Set the webhook URL to: `http://your-domain.com/sms`

## Example Interactions

Send SMS messages with questions that match your knowledge base content:

**User**: What is the return policy?
**Bot**: Here's what I found:

1. Items can be returned within 30 days of purchase with original receipt...

2. Refunds are processed within 5-7 business days...

---

**User**: How do I reset my password?
**Bot**: Here's what I found:

1. To reset your password, go to Settings > Security > Change Password...

## Code Structure

- `src/index.ts` - Main bot implementation
- `.env` - Environment configuration
- `package.json` - Dependencies and scripts

## Related Examples

- [Simple SMS Bot](../simple-sms-bot/) - Basic SMS bot without knowledge search
- [Voice Assistant](../voice-assistant/) - Voice-based bot
