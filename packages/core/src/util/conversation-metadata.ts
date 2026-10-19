/**
 * Fit app metadata into Conversation Orchestrator's conversation-metadata limits.
 */

/** Conversation Orchestrator's documented limits for conversation metadata. */
export const CONVERSATION_METADATA_MAX_KEYS = 8;
export const CONVERSATION_METADATA_MAX_KEY_LENGTH = 128;
export const CONVERSATION_METADATA_MAX_VALUE_LENGTH = 512;
const KEY_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Split `metadata` into what CO will store and what it won't.
 *
 * Entries are kept in insertion order while they fit. An entry is skipped when
 * its key isn't letters, digits, `.`, `_` or `-` up to 128 characters, its
 * value isn't a string of at most 512 characters, or the 8-key limit is
 * reached.
 *
 * @internal
 */
export function fitConversationMetadata(metadata: Record<string, unknown> | null | undefined): {
  persisted: Record<string, string>;
  skippedKeys: string[];
} {
  const persisted: Record<string, string> = {};
  const skippedKeys: string[] = [];
  let count = 0;
  for (const [key, value] of Object.entries(metadata ?? {})) {
    const fits =
      key.length <= CONVERSATION_METADATA_MAX_KEY_LENGTH &&
      KEY_PATTERN.test(key) &&
      typeof value === 'string' &&
      value.length <= CONVERSATION_METADATA_MAX_VALUE_LENGTH &&
      count < CONVERSATION_METADATA_MAX_KEYS;
    if (fits) {
      persisted[key] = value;
      count += 1;
    } else {
      skippedKeys.push(key);
    }
  }
  return { persisted, skippedKeys };
}
