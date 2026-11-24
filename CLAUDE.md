# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Keep it accurate: when a change alters anything described here (behavior, commands, layout, CI), update this file in the same PR.

If a PR, including later pushes to it, conflicts with anything in this file, the PR must also update this file to match before it merges.

## Project Overview

Twilio Agent Connect (TAC) is a TypeScript SDK, published to npm as `twilio-agent-connect`. It is middleware, not an agent runtime: it gives LLM applications channel abstractions (SMS, RCS, WhatsApp, Chat, Voice), tool integration, Conversation Memory / Conversation Orchestrator / Knowledge APIs, and a Fastify server.

**Key Architecture**: This SDK is kept at feature parity with the reference [Python SDK](https://github.com/twilio/twilio-agent-connect-python). Behavior changes should land in both.

## Development Commands

```bash
npm run build          # Bundle src/index.ts into dist/ (tsup)
npm run clean          # Remove build output
npm run test           # Run tests once (vitest --run)
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with v8 coverage
npm run lint           # ESLint check
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier format
npm run format:check   # Prettier check only
npm run typecheck      # tsc --noEmit (root, then getting_started/twilio-setup)
npm run docs           # Generate the API reference site (TypeDoc) into docs/
npm run docs:watch     # Regenerate the docs on change
npm run setup          # Start the Twilio setup wizard
npm run example:overview   # Also example:getting-started, example:chat
```

ESLint covers `packages/*/src`, `src` and `getting_started/twilio-setup/src`; Prettier covers those plus all of `getting_started/`; neither runs on `tests/`. The root `tsconfig.json` excludes `getting_started/`.

## Package Structure

`packages/*` are not separate npm packages: they are path aliases (`@twilio/tac-core`, `@twilio/tac-tools`, `@twilio/tac-server`) bundled by tsup into the single `twilio-agent-connect` package.

```
packages/
├── core/src/
│   ├── lib/             # TAC class, TACConfig + fromEnv, logger (PII scrubbing), analytics (Segment),
│   │                    #   operator-result-processor (Conversation Intelligence), conversation-session-helpers
│   ├── types/           # Zod schemas and types (config, conversation, memory, crelay, cintel, ...)
│   ├── clients/         # BaseClient + ConversationClient, MemoryClient, KnowledgeClient
│   ├── channels/        # BaseChannel, MessagingChannel, SMS, RCS, WhatsApp, Chat
│   │   └── voice/       # VoiceChannel plus conversation-relay/ and media-streams/ (openai-realtime, gpt-live, shared)
│   ├── adapters/        # MemoryPromptBuilder, AdapterOptions
│   └── util/            # ExpiringMap, log redaction, outbound sender, handoff URLs, conversation metadata
├── tools/src/           # TACTool, defineTool() (lib/builder.ts) and built-in memory, messaging, handoff, knowledge tools
└── server/src/lib/      # TACServer (Fastify)

src/index.ts             # Root re-export of all three packages (the single build entry)
tests/                   # Flat Vitest suite (*.test.ts) plus tests/helpers/ (tac, voice-invariants)
getting_started/         # Example apps (examples/*, one per feature) and the twilio-setup/ wizard
docs/                    # TypeDoc output (gitignored, published to gh-pages by CI)
```

## Code Conventions

- **Node 22.13+**: `engines.node` is `>=22.13.0`. ESM only (`"type": "module"`), with extensionless relative imports (`moduleResolution: bundler`).
- **TypeScript strict mode** with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`.
- **ESLint**: `typescript-eslint` `recommendedTypeChecked`; unused args prefixed `_` are allowed; explicit return types and `any` warn; `prefer-const` errors.
- **Prettier**: single quotes, trailing commas (es5), 100 char width, no parens on single arrow params.
- **Zod 4** for config and API response validation (`z.infer<typeof Schema>`). Tool parameters are plain JSON Schema.
- **Naming**: PascalCase classes, camelCase functions/variables.
- **Logging**: Pino with child loggers tagged `{ component }`. `TWILIO_LOG_LEVEL` sets the level. Loggers mask phone numbers and emails (`scrubLogMethod` in `lib/logger.ts`): `createLogger()`, an app logger passed as `TACOptions.logger` (wrapped by `withScrubbing()`) and TACServer's default Fastify logger. An app-supplied Fastify `logger` or `fastifyInstance` is not masked unless built with `loggerInstance: createLogger()`. Never log message text, transcripts or Recall queries, and mask addresses with `maskAddress()`. Log a caught error with `errorLogFields(err)` (`util/error-log-fields.ts`) where it may be an axios error, so only its message, code and status are logged.

## Dependencies

- **Runtime**: twilio, fastify, @fastify/websocket, @fastify/formbody, fastify-graceful-shutdown, ws, axios, axios-retry, zod, pino, dotenv, @segment/analytics-node
- **Optional peer**: `@openai/agents`, needed only for `toOpenAIAgentsSDKTool()`
- **Dev**: typescript, tsup, tsx, vitest, @vitest/coverage-v8, axios-mock-adapter, eslint, typescript-eslint, prettier, typedoc (+ Material theme and versions plugin), pino-pretty, rimraf

## Key Architecture Concepts

- **TAC class** (`packages/core/src/lib/tac.ts`): Central orchestrator managing config, channels, callbacks, and API clients. `ConversationClient`, `MemoryClient` and `KnowledgeClient` are created only in orchestrated mode; the Conversation Intelligence processor only when `cintelConfigurationId` is set.
- **Channel abstraction** (`packages/core/src/channels/base.ts`): `BaseChannel` abstract base class extended by messaging channels (`SMSChannel`, `RCSChannel`, `WhatsAppChannel`, `ChatChannel`) via the shared `MessagingChannel` and by `VoiceChannel` (WebSocket). `RCSChannel` uses the RCS Sender ID configured on `TACConfig` (`TWILIO_RCS_SENDER_ID`); `WhatsAppChannel` uses `TWILIO_WHATSAPP_NUMBER`.
- **Voice providers**: ConversationRelay (default, `channels/voice/conversation-relay/`) or Media Streams (`channels/voice/media-streams/`: OpenAI Realtime, GPT Live).
- **Voice channel initialization**: In orchestrated mode, VoiceChannel starts the conversation lookup in the background on the `setup` message (polls Conversation Orchestrator using `callSid`, extracts `profileId` from participants, then starts the local session); the first message that needs a conversation — a prompt or a DTMF keypress — awaits it. ConversationRelay creates the conversation at call-connect, so the poll overlaps the wait for the caller's first utterance instead of delaying it — which means the session and `onWebSocketConnected` can land before the caller speaks. In voice-only mode (no `conversationConfigurationId`), uses `callSid` directly as the conversation ID without polling, on that same first message.
- **Voice conversation lifecycle**: A call's session lives on the instance holding its WebSocket and is released on every disconnect path (`releaseSession()`, idempotent), firing `voiceChannel.onCallEnded(...)` with the live session — the only hook guaranteed it (transcript, metadata). In orchestrated mode `onConversationEnded` is left to Conversation Orchestrator's `CONVERSATION_UPDATED`/`CLOSED` webhook, which gets a session rebuilt from CO participants (identity only) on whichever instance receives it; a CLOSED for a call still live on that instance fires from a detached snapshot and leaves the session for teardown, so `onCallEnded` still fires. In voice-only mode there is no such webhook, so teardown ends the conversation directly.
- **Voice call events** (`packages/core/src/channels/voice/channel.ts`): The Calls-API callbacks — status/disposition, async AMD, recording — are a second, independently-arriving traffic class, served one route per kind under `TACConfig.voiceCallEventPath` and dispatched to the optional `onCallStatus` / `onAmd` / `onRecording` handlers. A callback URL is put on an outbound call **only when its handler is registered**, so TAC never points Twilio at a 404 (error 11200). These events carry only the `CallSid`: `getConversationSessionByCallSid()` finds a session only on the instance holding the call, while `resolveConversationSessionByCallSid()` (orchestrated mode) falls back to an identity-only session rebuilt from Conversation Orchestrator. `endCall()` needs no session: the Twilio-side hangup succeeds from any instance.
- **Voice DTMF** (`packages/core/src/channels/voice/conversation-relay/provider.ts`): ConversationRelay sends a `dtmf` WebSocket message per keypress when `dtmfDetection` is on; `channel.on('dtmf', ...)` (or the typed `voiceChannel.onDtmf(...)`) receives them one digit at a time (accumulating multi-digit entries is the handler's job). A keypress initializes the conversation the same way a prompt does, since a caller can press a digit without ever speaking and the handler needs a session and WebSocket to respond on; if that initialization fails the digit is still delivered, with `conversationId` undefined. DTMF alone does not cancel in-flight streaming — Twilio sends a separate `interrupt` for that when `interruptible` includes `dtmf`.
- **Callback pattern**: Simple callbacks (`onMessageReady`, `onInterrupt`, `onConversationEnded`) instead of EventEmitter
- **Callback responses**: `onMessageReady` callbacks return `string` (auto-sent), `void`/`null` (manual `channel.sendResponse()`)
- **Tool system** (`packages/tools/src/lib/builder.ts`): `defineTool()` with JSON Schema; converts to OpenAI (`toOpenAIFormat`), Anthropic (`toAnthropicFormat`) and OpenAI Agents SDK (`toOpenAIAgentsSDKTool`) formats
- **Config via Zod**: the schema is in `packages/core/src/types/config.ts`; the `TACConfig` class and `TACConfig.fromEnv()` are in `packages/core/src/lib/config.ts`. `accountSid`, `authToken`, `apiKey`, `apiSecret` are required; `phoneNumber` / `phoneNumbers` are optional at the config level, but `SMSChannel` and `VoiceChannel` throw at construction without one; `conversationConfigurationId` is optional (voice-only mode when omitted). Voice routes live on `TACConfig` (`voiceWebsocketPath` default `/ws`, `voiceActionPath` default `/conversation-relay-callback`, `voiceCallEventPath`), not on the server.
- **Multi-sender support**: Each channel has a singular default sender plus a plural allowlist (`phoneNumber`/`phoneNumbers`, `rcsSenderId`/`rcsSenderIds`, `whatsappNumber`/`whatsappNumbers`), back-filled from each other by a config transform (default kept first, de-duplicated). Inbound derives the agent address from the webhook's recipient (SMS/RCS/WhatsApp), validates it against the allowlist, and drops messages addressed to an unconfigured number (chat opts out via `deriveInboundAgentFromRecipients = false`). Outbound selects the sender via an optional `from` (defaulting to the channel's default sender), and digital handoff sends from the session's active agent number. Note: unlike the Python SDK, a live ConversationRelay call does not resolve the inbound agent participant from the dialed number; only sessions rebuilt from CO participants match it against `phoneNumbers`, and outbound `from` selection is wired for voice
- **Horizontal scaling**: N replicas behind a load balancer, **no shared datastore**.
  - **Messaging is stateless** — `MessagingChannel` keeps no sessions; each webhook derives a `ConversationSession` from the payload, config, and one `listParticipants` call it needs anyway, and hands it to `onMessageReady`. A session lasts one turn, so `session.metadata` doesn't carry to the next message (apps keep cross-turn state themselves, keyed by `conversationId`), and a turn whose `listParticipants` fails is dropped (`onError` with `dropped_inbound`). `conversationMetadata(session)` reads the CO-stored metadata (written at outbound initiation) on any instance. `sendResponse` takes the session (preferred) or a bare id (rebuilds from participants). The idempotency cache is per-process, so a retry landing elsewhere is reprocessed. `getConversationSession()` / `isConversationActive()` / `on('conversationStarted')` are deprecated no-ops on messaging channels.
  - **Voice is instance-local**, correctly: a WebSocket pins a call to one process, and teardown always runs `releaseSession()` (invariant: `tests/helpers/voice-invariants.ts`).
  - **Out-of-band call webhooks** (status/AMD/recording, `<Connect action>`) carry only a `CallSid`. Set `TACConfig.instancePublicDomain` (`TWILIO_INSTANCE_PUBLIC_DOMAIN`) and TAC mints the URLs it controls against it (`TACConfig.voiceCallbackDomain`): the WebSocket and `<Connect action>` URLs always, call-event callbacks only on calls TAC places. Otherwise route by `CallSid` at the balancer, or use `resolveConversationSessionByCallSid()`.
  - **Per-call Media Streams session config requires `instancePublicDomain` with more than one instance**: the config is kept (in an `ExpiringMap`) on the instance that served the TwiML or placed the call; only a token rides the TwiML. A token not held locally logs a warning and the call falls back to the default session config.
  - **Lifecycle analytics** ("Conversation Started"/"Conversation Ended") come from CO webhooks: `PARTICIPANT_ADDED` for the customer, and `CONVERSATION_UPDATED`/CLOSED with `duration_ms` = CO's `updatedAt − createdAt`. Each channel reports "Started" only for its own channel type (`BaseChannel.trackConversationStarted`). CLOSED carries no channel, and TAC makes no API call just for telemetry, so "Ended" has no `channel` (join to "Started" on `conversation_id`) and is reported once per process across channels (`TAC.reportConversationEnded`, 60 s dedupe). The CLOSED participant lookup runs only for a registered `onConversationEnded`, shared via `TAC.listParticipantsShared` (in-flight + 60 s). Relay-only and Media Streams voice report at session start/teardown instead. On chat, customers stay UNKNOWN, so each UNKNOWN non-agent participant counts as a start. `TAC_ANALYTICS_DISABLED=true` turns analytics off.
- **API client architecture** (`packages/core/src/clients/`):
  - `BaseClient` abstract class provides common HTTP functionality using **axios**; Memory, Conversation and Knowledge clients inherit from it
  - **Automatic retry** (axios-retry): 3 retries with exponential backoff; retries idempotent methods on 5xx/429 responses and non-idempotent methods only on network/no-response failures
  - **Timeout**: Fixed 30-second timeout for all requests
  - **Redirect handling**: Follows up to 5 redirects; preserves Authorization header for same-origin redirects only (prevents credential leaks to malicious redirect targets)
  - **Authentication**: Basic Auth with the API key and secret from `TACConfig`, shared across clients
  - **User-Agent**: `twilio-agent-connect-typescript/{version}`
  - **Validation**: Zod schemas validate responses at runtime; `makeRequest<T>()` is generic over the response type
  - **Error logging**: Interceptors log 4xx client errors as warnings, 5xx/network failures as errors
- **Adapter utilities**:
  - **MemoryPromptBuilder** (`adapters/prompt-builder.ts`): Builds formatted LLM prompts from memory and profile data
  - **AdapterOptions** (`adapters/options.ts`): Configuration options for profile trait filtering
  - **buildProfilePrompt** (`lib/conversation-session-helpers.ts`): Helper to build profile section from ConversationSession

## TACServer Configuration

`TACServer` (`packages/server/src/lib/server.ts`) is a Fastify server. Defaults:

```typescript
{
  host: '0.0.0.0',
  port: 8000,
  webhookPaths: {
    conversation: '/webhook',
    twiml: '/twiml',
    // cintel: optional, registered only when set
  },
}
```

It also takes `voiceChannel`, `messagingChannels` (both registered on TAC for you) and `fastify` / `fastifyInstance`. The voice WebSocket and `<Connect action>` paths come from `TACConfig`, not `webhookPaths`.

### Customizing Voice TwiML

The default greeting (`DEFAULT_WELCOME_GREETING` in `channels/voice/conversation-relay/twiml.ts`) and other ConversationRelay attributes are set on the voice channel, not the server. TACServer no longer accepts `conversationRelayConfig`; its schema rejects it.

```typescript
const voiceChannel = new VoiceChannel(tac, {
  defaultTwimlOptions: {
    welcomeGreeting: 'Welcome to our support line!',
    interruptible: 'speech',
  },
});
voiceChannel.onInboundCallTwiml(async req => ({ /* per-call overrides */ }));
```

Outbound calls take per-call `twimlOptions`. **See full example**: `getting_started/examples/voice-twiml-customization/`

## Memory Retrieval Control

Channels support `memoryMode` to control automatic memory fetching (invalid values throw):

```typescript
const smsChannel = new SMSChannel(tac, { memoryMode: 'always' });
const whatsappChannel = new WhatsAppChannel(tac, { memoryMode: 'always' });
const voiceChannel = new VoiceChannel(tac, { memoryMode: 'never' }); // default
```

- **`"never"` (default)**: No automatic fetching. Use `tac.retrieveMemory()` in callbacks for conditional retrieval.
- **`"always"`**: Automatically fetches memory (using the message as query) for every inbound message. Available in `onMessageReady` callback's `memory` parameter.
- **`"once"`** (**Voice only**): Fetches memory once at conversation start with no query and caches it on the session. Subsequent messages reuse the cache until the conversation becomes INACTIVE (Conversation Orchestrator refreshes memory on that transition), after which the next message re-fetches. The fetch also omits `conversationId`: with no query it would only trigger Memory's server-side query expansion (an extra LLM call), so results come back by recency. `"always"` still sends it. It needs a session outliving one request, which only voice has — on messaging channels it is deprecated (removed in 3.0): the `MessagingChannel` constructor warns and runs it as `"always"`.
- **Profile traits**: `retrieveMemory()` also fetches the profile (`memoryConfig.traitGroups`) into `session.profile`, which `buildProfilePrompt()` renders; recall itself never returns traits. It is one extra API call, made in parallel with the recall and skipped when `session.profile` is already set. Messaging sessions last one turn, so on messaging channels it runs on every inbound message; voice with `"once"` pays it once per call. Set `memoryConfig.fetchProfileTraits: false` to skip it. A failed fetch is logged and memory retrieval continues without traits.
- `memoryConfig.communicationsLimit` therefore defaults to **0**, as in the Memory API and Python SDK. Above 0, Memory requires `conversationId` on every `/Recall`, so raising it makes `"once"` fetches fail with a 400 and fall back to the Conversations API.

## Testing

Tests live in `tests/` and use Vitest (globals, node environment). `tests/setup.ts` sets `TAC_ANALYTICS_DISABLED=true`, and `vitest.config.ts` maps the same `@twilio/tac-*` aliases as the build. Tests should:
- Mock HTTP with `axios-mock-adapter` (or `vi.mock`) rather than calling Twilio
- Use `tests/helpers/tac.ts` to build a TAC instance, and the voice invariants in `tests/helpers/voice-invariants.ts` after tests that end a call

CI (`.github/workflows/ci.yml`) runs lockfile hygiene, lint + format check, typecheck, tests on Node 22.13 and 24, lint and typecheck of the `openai` and `chat` examples, and a package build that smoke-imports `dist/`.

## Documentation

- The public API reference is published at https://twilio.github.io/twilio-agent-connect-typescript/, versioned with `@shipgirl/typedoc-plugin-versions` and deployed from `.github/workflows/docs.yml` on each GitHub release.
- The reference is generated from TSDoc comments by TypeDoc (Material theme), so **TSDoc comments are published documentation**. Write them for both source readers and the rendered site.
- Tag internal-facing public members (ones consumers shouldn't call) with `@internal` so `excludeInternal` drops them from the published reference; keep those tags accurate when adding, renaming, or changing the visibility of such members.
- Verify docs changes with `npm run docs`. See `DEVELOPMENT.md` for building the docs locally.

## Releases, Skills and PRs

- `/create-release-pr` (`.claude/skills/create-release-pr/`) bumps the version in `package.json` and opens a release PR. `.github/workflows/release.yml` publishes to npm (with provenance) when a GitHub release is published.
- `/sync-to-python-sdk` (`.claude/skills/sync-to-python-sdk/`) ports a merged change to twilio-agent-connect-python. Behavior changes should land in both SDKs.
- When creating PRs, read and fill in `.github/PULL_REQUEST_TEMPLATE.md`.

## Common Pitfalls

1. **`packages/*` are aliases, not npm packages** - import from `twilio-agent-connect` in apps and examples.
2. **Voice TwiML options live on `VoiceChannel`** - TACServer rejects `conversationRelayConfig`.
3. **Messaging sessions last one turn** - don't keep cross-turn state in `session.metadata`; key it by `conversationId` yourself.
4. **`"once"` memory is voice-only** - on messaging channels it warns and runs as `"always"`.
5. **Keep the Python SDK in sync** - a public behavior change here needs a matching change there.

## Related Documentation

- TAC Python SDK: [twilio-agent-connect-python](https://github.com/twilio/twilio-agent-connect-python)
- Product docs: [twilio.com/docs/conversations/agent-connect](https://www.twilio.com/docs/conversations/agent-connect)
- Examples: `getting_started/examples/`
- Development guide: `DEVELOPMENT.md`
- Published API reference: [twilio.github.io/twilio-agent-connect-typescript](https://twilio.github.io/twilio-agent-connect-typescript/)
