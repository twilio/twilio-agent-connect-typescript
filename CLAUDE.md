# Twilio Agent Connect - TypeScript SDK

A TypeScript framework for building AI-powered conversational agents on Twilio infrastructure. Provides channel abstractions (SMS, Voice), tool integration, memory/knowledge APIs, and a production-ready Fastify server — designed for 1:1 parity with the [Python SDK](https://github.com/twilio-innovation/twilio-agent-connect-python).

## Development Commands

```bash
npm run build          # Build all packages (tsup)
npm run clean          # Remove dist/ directories
npm run test           # Run tests once (vitest --run)
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with v8 coverage
npm run lint           # ESLint check
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier format
npm run format:check   # Prettier check only
npm run typecheck      # tsc --noEmit
```

## Package Structure

```
packages/
  core/        # Central framework: TAC orchestrator, channels (SMS/Voice),
               #   API clients (Memory, Conversation, Knowledge), adapters
               #   (MemoryPromptBuilder), config, types
  tools/       # Tool system: TACTool class, defineTool(), built-in tools
               #   (memory, messaging, handoff, knowledge)
  server/      # TACServer: Fastify wrapper with webhook + WebSocket handlers
src/
  index.ts     # Root re-export of all three packages (single entry point)
tests/         # Vitest test suite
getting_started/  # Example apps (OpenAI integration)
```

## Code Conventions

- **TypeScript strict mode** with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **Zod** for all runtime validation and type inference (`z.infer<typeof Schema>`)
- **ESM only** (`"type": "module"`) — imports use `.js` extensions in compiled output
- **Prettier**: single quotes, trailing commas (es5), 100 char width, no parens on single arrow params
- **ESLint**: `@typescript-eslint` with type-checking; unused vars prefixed `_` are allowed; explicit return types warned
- **Naming**: PascalCase classes, camelCase functions/variables
- **Logging**: Pino with hierarchical child loggers tagged by component

## Key Architecture

- **TAC class** (`packages/core/src/lib/tac.ts`): Central orchestrator managing config, channels, callbacks, and API clients
- **Channel abstraction** (`packages/core/src/channels/base.ts`): `BaseChannel` abstract base class extended by `SMSChannel` (webhooks/TwiML) and `VoiceChannel` (WebSocket)
- **Voice channel initialization**: VoiceChannel waits for the first prompt message to initialize the conversation (fetches from ConversationRelay using `callSid`, extracts `profileId` from participants, then starts local session)
- **Callback pattern**: Simple callbacks (`onMessageReady`, `onInterrupt`, `onHandoff`, `onConversationEnded`) instead of EventEmitter
- **Callback responses**: `onMessageReady` callbacks return `string` (auto-sent), `void`/`null` (manual `channel.sendResponse()`)
- **Tool system** (`packages/tools/src/lib/builder.ts`): `defineTool()` with JSON schema; supports conversion to OpenAI and Anthropic formats
- **Config via Zod** (`packages/core/src/lib/config.ts`): `TACConfig.fromEnv()` validates env vars
- **API client architecture** (`packages/core/src/clients/`):
  - `BaseClient` abstract class provides common HTTP functionality using **axios**
  - All API clients (Memory, Conversation, Knowledge) inherit from BaseClient
  - **HTTP client**: axios with axios-retry for resilience
  - **Automatic retry**: 3 retries with exponential backoff; retries idempotent methods on 5xx responses and non-idempotent methods only on network/no-response failures
  - **Timeout**: Fixed 30-second timeout for all requests
  - **Redirect handling**: Follows up to 5 redirects; preserves Authorization header for same-origin redirects only (prevents credential leaks to malicious redirect targets)
  - **Authentication**: Automatic Basic Auth using Twilio API credentials
  - **User-Agent**: Automatic header injection (`twilio-agent-connect-typescript/{version}`)
  - **JSON handling**: Automatic serialization/deserialization
  - **Type safety**: Generic type parameters on `makeRequest<T>()` for better IDE support
  - **Validation**: Zod schemas validate all responses at runtime
  - **Error logging**: Logs 4xx client errors as warnings, 5xx/network failures as errors via interceptors
  - Credentials consolidated at `TACConfig` level (apiKey/apiSecret shared across clients)
- **Adapter utilities** (`packages/core/src/adapters/`):
  - **MemoryPromptBuilder** (`prompt-builder.ts`): Builds formatted LLM prompts from memory and profile data
  - **AdapterOptions** (`options.ts`): Configuration options for profile trait filtering
  - **buildProfilePrompt** (`conversation-session-helpers.ts`): Helper to build profile section from ConversationSession
- **TACServer** (`packages/server/src/lib/server.ts`): Fastify-based server with default `welcomeGreeting` for voice calls; customizable via `conversationRelayConfig`

## Dependencies

**Runtime**: twilio, fastify, @fastify/websocket, @fastify/formbody, ws, zod, pino, pino-pretty, dotenv, fastify-graceful-shutdown
**Dev**: typescript, tsup, vitest, @vitest/coverage-v8, eslint, prettier, rimraf, @types/node, @types/ws

## TACServer Configuration

The `TACServer` class (`packages/server/src/lib/server.ts`) provides a production-ready Fastify server with sensible defaults:

### Default Configuration

```typescript
{
  voice: { host: '0.0.0.0', port: 3000 },
  webhookPaths: {
    sms: '/webhook',
    twiml: '/twiml',
    ws: '/ws',
    conversationRelayCallback: '/conversation-relay-callback',
  },
  conversationRelayConfig: {
    welcomeGreeting: 'Hello! How can I assist you today?',
  },
  development: false,
}
```

### Customizing Voice Greeting

The default `welcomeGreeting` is automatically applied to all voice calls. Customize it via `conversationRelayConfig`:

```typescript
const server = new TACServer(tac, {
  conversationRelayConfig: {
    welcomeGreeting: 'Welcome to our support line!',
    welcomeGreetingInterruptible: 'any',
    transcriptionProvider: 'Deepgram',
    ttsProvider: 'Google',
  },
});
```

All ConversationRelay attributes except `url` are supported (see `packages/core/src/types/crelay.ts`). The `url` field is automatically set by the server based on the request host and WebSocket path.

## Pull Requests

When creating PRs, read and fill in `.github/PULL_REQUEST_TEMPLATE.md`.
