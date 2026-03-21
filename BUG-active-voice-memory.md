# Bug: Active Voice Missing Automatic Memory Enrichment

**Status**: Documented, awaiting fix
**Branch**: port/conversation-webhook
**Severity**: High - Core feature missing
**Discovered**: 2025-03-21

## Summary

Active voice (WebSocket-based ConversationRelay) does NOT automatically retrieve memory enrichment, while passive voice (webhook-based) DOES. This creates an inconsistent API and forces users to manually retrieve memory in their callbacks, defeating TAC's value proposition of automatic Maestro/Memora orchestration.

## Current Behavior

### Passive Voice (Webhook) - ✅ Works Correctly

**File**: `packages/core/src/channels/voice.ts` (lines 105-200)

```typescript
protected override async handleCommunicationCreated(...) {
  // Lines 178-193: Automatic memory retrieval
  let userMemory;
  if (session && this.tac.isMemoryEnabled()) {
    try {
      userMemory = await this.tac.retrieveMemory(session, trimmedText);
    } catch (error) {
      this.logger.warn('Failed to retrieve memory');
    }
  }

  // Invokes callback with enriched data
  this.voiceCallbacks.onMessageReceived({
    conversationId,
    profileId,
    message: trimmedText,
    author,
    userMemory,  // ← Memory automatically provided!
  });
}
```

### Active Voice (WebSocket) - ❌ Bug: No Memory Retrieval

**File**: `packages/core/src/channels/voice.ts` (lines 350-360)

```typescript
private handlePromptMessage(conversationId: ConversationId, message: PromptMessage): void {
  const transcript = message.voicePrompt;

  // NO memory retrieval happens here!

  if (this.voiceCallbacks.onPrompt) {
    this.voiceCallbacks.onPrompt({
      conversationId,
      transcript,  // ← Only transcript, NO userMemory!
    });
  }
}
```

**File**: `packages/core/src/lib/tac.ts` (lines 176-195)

The bug is also visible in TAC's event routing:

```typescript
channel.on('prompt', async ({ conversationId, transcript }) => {
  const session = channel.getConversationSession(conversationId);
  if (session) {
    await this.handleMessageReady({
      conversationId,
      message: transcript,
      userMemory: undefined,  // ← BUG: Always explicitly set to undefined!
      channelType: channel.channelType,
    });
  }
});
```

## Impact

1. **Inconsistent API**: SMS and passive voice get automatic enrichment; active voice doesn't
2. **Manual workarounds required**: Users must call `tac.retrieveMemory()` manually in callbacks
3. **Missing value proposition**: TAC is supposed to automate Maestro/Memora orchestration
4. **Poor developer experience**: Forces boilerplate that should be handled by framework

## Evidence: Exec-Demo Workaround

**File**: `examples/exec-connect-demo/src/index.ts` (lines 105-119) on `local/exec-demo` branch

The exec-demo only works because it manually retrieves memory:

```typescript
// Voice channel does not retrieve memory, so we need to retrieve it here
// SMS channel already retrieves memory before calling this callback
let finalMemoryResponse: typeof memoryResponse = memoryResponse;
if (!memoryResponse && context.channel === 'voice' && tac.isMemoryEnabled()) {
  try {
    finalMemoryResponse = await tac.retrieveMemory(context, userMessage);
    console.log('MEMORY | Retrieved context for voice channel');
  } catch (error) {
    console.error('Failed to retrieve memory for voice channel:', error);
  }
}
```

**The comment explicitly states the bug**: "Voice channel does not retrieve memory, so we need to retrieve it here"

## Expected Behavior

Both active and passive voice should automatically retrieve memory before invoking callbacks:

```typescript
private async handlePromptMessage(conversationId: ConversationId, message: PromptMessage): Promise<void> {
  const transcript = message.voicePrompt;

  // Get session
  const session = this.getConversationSession(conversationId);

  // Automatic memory retrieval (like passive voice!)
  let userMemory;
  if (session && this.tac.isMemoryEnabled()) {
    try {
      userMemory = await this.tac.retrieveMemory(session, transcript);
    } catch (error) {
      this.logger.warn('Failed to retrieve memory for active voice');
    }
  }

  // Invoke callback with enriched data
  if (this.voiceCallbacks.onPrompt) {
    this.voiceCallbacks.onPrompt({
      conversationId,
      transcript,
      userMemory,  // ← Now enriched!
      session,
    });
  }
}
```

## Fix Required

### 1. Update `handlePromptMessage()` in `packages/core/src/channels/voice.ts`

- Add session retrieval
- Add automatic memory retrieval with error handling
- Pass `userMemory` and `session` to callback

### 2. Update `VoiceChannelEvents` interface

```typescript
onPrompt?: (data: {
  conversationId: ConversationId;
  transcript: string;
  userMemory?: TACMemoryResponse;  // ADD
  session?: ConversationSession;    // ADD
}) => void;
```

### 3. Update TAC's event routing in `packages/core/src/lib/tac.ts`

Change from:
```typescript
channel.on('prompt', async ({ conversationId, transcript }) => {
  const session = channel.getConversationSession(conversationId);
  if (session) {
    await this.handleMessageReady({
      conversationId,
      message: transcript,
      userMemory: undefined,  // ← Remove this!
      channelType: channel.channelType,
    });
  }
});
```

To:
```typescript
channel.on('prompt', async ({ conversationId, transcript, userMemory, session }) => {
  if (session) {
    await this.handleMessageReady({
      conversationId,
      message: transcript,
      userMemory,  // ← Now provided by channel!
      channelType: channel.channelType,
    });
  }
});
```

### 4. Add tests

Create tests in `tests/voice-channel-active.test.ts` to verify:
- Memory is automatically retrieved for active voice
- userMemory is passed to onPrompt callback
- Graceful degradation when Memory API unavailable

### 5. Remove workarounds

After fix is merged:
- Remove manual memory retrieval from `examples/exec-connect-demo/src/index.ts`
- Update documentation to clarify both modes get automatic enrichment
- Add examples showing both patterns work identically

## Breaking Change Analysis

**NO** - This is adding optional fields to an existing callback:

**Before**:
```typescript
onPrompt?: (data: { conversationId: ConversationId; transcript: string }) => void;
```

**After**:
```typescript
onPrompt?: (data: {
  conversationId: ConversationId;
  transcript: string;
  userMemory?: TACMemoryResponse;  // Optional - existing code works
  session?: ConversationSession;    // Optional - existing code works
}) => void;
```

Existing code that only uses `conversationId` and `transcript` will continue to work.

## Related Issues

- Architecture discussion about TACServer vs SDK usage patterns (see `ARCHITECTURE-DISCUSSION.md` in `add-developer-guides` branch)
- Exec-demo workaround documentation (see `BUG-workaround-notes.md` in `local/exec-demo` branch)

## Testing Plan

1. **Unit tests**: Verify memory retrieval in active voice
2. **Integration tests**: Test both active and passive voice with Memory API
3. **Exec-demo validation**: Remove workaround and verify it still works
4. **Manual testing**:
   - Voice call with memory enabled
   - Voice call with memory disabled
   - Verify memory appears in callback without manual retrieval

## References

- **Main bug location**: `packages/core/src/channels/voice.ts:350-360` (handlePromptMessage)
- **TAC routing bug**: `packages/core/src/lib/tac.ts:176-195` (setupChannelEventListeners)
- **Passive voice (correct)**: `packages/core/src/channels/voice.ts:178-193` (handleCommunicationCreated)
- **Workaround example**: `examples/exec-connect-demo/src/index.ts:105-119` (local/exec-demo branch)
