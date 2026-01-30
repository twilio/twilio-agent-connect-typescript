# Twilio Agent Connect (TypeScript)

A modern TypeScript framework for building intelligent conversational agents that integrate seamlessly with Twilio's communication infrastructure.

<div style="text-align: center;">

[![Build Status](https://img.shields.io/badge/build-passing-green.svg)](https://github.com/twilio/twilio-agent-connect-typescript)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-workspaces-red.svg)](https://docs.npmjs.com/cli/v7/using-npm/workspaces)

</div>

## 🚀 Features

- **Multi-Channel Support**: SMS and Voice channels with unified API
- **Memory Integration**: Seamless integration with Twilio Memory Service for persistent user context
- **Type-Safe**: Full TypeScript support with strict type checking
- **Tool System**: Pluggable tool architecture supporting popular LLM SDKs
- **Production Ready**: Built-in security, rate limiting, and error handling
- **Framework Agnostic**: Works with OpenAI, Anthropic, LangChain, and more
- **Real-time Voice**: WebSocket-based voice conversations with ConversationRelay
- **Monorepo Architecture**: Modular design with scoped packages

## 📦 Packages

| Package | Description | Version |
|---------|-------------|---------|
| [`@twilio/tac-core`](./packages/core) | Core framework functionality | ![npm](https://img.shields.io/badge/v1.0.0-blue.svg) |
| [`@twilio/tac-types`](./packages/types) | TypeScript types and Zod schemas | ![npm](https://img.shields.io/badge/v1.0.0-blue.svg) |
| [`@twilio/tac-tools`](./packages/tools) | Tool system and built-in tools | ![npm](https://img.shields.io/badge/v1.0.0-blue.svg) |
| [`@twilio/tac-server`](./packages/server) | Batteries-included Fastify server | ![npm](https://img.shields.io/badge/v1.0.0-blue.svg) |

## 🚀 Quick Start

### 1. Installation

Choose your preferred setup approach:

#### Option A: Batteries-Included Server (Recommended)
```bash
npm install @twilio/tac-server
```

#### Option B: Core Only (Bring Your Own Server)
```bash
npm install @twilio/tac-core @twilio/tac-tools
```

### 2. Environment Configuration

Create a `.env` file:

```env
# Environment
ENVIRONMENT=dev

# Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890

# TAC Services
MEMORY_STORE_ID=mem_service_01kbjqhhdpft0tbp21jt4ktbxg
CONVERSATION_SERVICE_ID=comms_service_01kbjqhn79f0fvwfsxqzd5nqhd

# Optional: Voice Configuration
VOICE_PUBLIC_DOMAIN=https://your-ngrok-domain.ngrok.io
```

### 3. Basic Usage

#### Simple SMS Bot

```typescript
import { TAC } from '@twilio/tac-core';
import { TACServer } from '@twilio/tac-server';

// Initialize framework
const tac = new TAC();

// Handle incoming messages
tac.onMessageReady(async ({ message, memory }) => {
  if (message.toLowerCase().includes('hello')) {
    return 'Hello! How can I help you today?';
  }

  return `You said: "${message}". How can I assist you?`;
});

// Start server
const server = new TACServer(tac);
await server.start();
```

## 📚 Examples

### Running Examples

The examples use workspace dependencies (`*`) to automatically pull in your local changes:

```bash
# Install all dependencies (including examples)
npm install

# Build packages first
npm run build

# Run specific examples
npm run example:sms        # Simple SMS Bot
npm run example:multi      # Multi-Channel Demo

# Or run directly in example directories
cd examples/simple-sms-bot
npm run dev
```

### Available Examples

- **[Simple SMS Bot](./examples/simple-sms-bot/)**: Basic SMS responder with memory
- **[Multi-Channel Demo](./examples/multi-channel-demo/)**: Full-featured customer service with OpenAI integration

## 🛠️ Development

### Prerequisites

- Node.js 20+
- npm 9+
- TypeScript 5+

### Setup

```bash
# Clone repository
git clone https://github.com/twilio/twilio-agent-connect-typescript.git
cd twilio-agent-connect-typescript

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Lint code
npm run lint
```

### Package Scripts

```bash
# Development
npm run dev              # Watch mode for all packages
npm run typecheck        # Type checking
npm run lint             # ESLint
npm run format           # Prettier formatting

# Building
npm run build            # Build all packages
npm run clean            # Clean dist directories

# Testing
npm test                 # Run all tests
npm run test:coverage    # Run with coverage

# Examples (automatically use local changes)
npm run example:sms      # Run Simple SMS Bot
npm run example:multi    # Run Multi-Channel Demo
```

### Development Workflow

When making changes to the framework packages:

1. **Make your changes** in `packages/`
2. **Build the packages**: `npm run build`
3. **Examples automatically use your local changes** (via `*` dependencies)
4. **Test with examples**: `npm run example:sms` or `npm run example:multi`

The `*` dependency pattern in examples means they always use your local workspace packages, so you can iterate quickly without publishing.

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ENVIRONMENT` | Environment (dev/stage/prod) | Yes |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID | Yes |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | Yes |
| `TWILIO_PHONE_NUMBER` | Twilio phone number | Yes |
| `MEMORY_STORE_ID` | Memory Store ID (mem_service_xxx) | Yes |
| `CONVERSATION_SERVICE_ID` | Conversation Service ID (comms_service_xxx) | Yes |
| `VOICE_PUBLIC_DOMAIN` | Public domain for voice (optional) | No |

## TAC E2E Tests
[![Build status](https://badge.buildkite.com/7d2c17fcc93d8f8cff917730fb17ce8fa935c4e9009b6084ec.svg?branch=main)](https://buildkite.com/twilio/tac-e2e-tests-typescript)

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div style="text-align: center;">

**Made with ❤️ by Twilio**

[Website](https://twilio.com) • [Documentation](https://docs.twilio.com) • [Community](https://discord.gg/twilio) • [Twitter](https://twitter.com/twilio)

</div>
