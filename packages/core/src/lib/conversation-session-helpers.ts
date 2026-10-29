import { ConversationSession } from '../types/conversation';

function formatTraitValue(value: unknown): string {
  // For primitives (string, number, boolean, bigint), return as-is for readability
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  // For objects and arrays, use JSON.stringify with bigint replacer
  try {
    return (
      JSON.stringify(value, (_key, replacerValue: unknown) => {
        if (typeof replacerValue === 'bigint') {
          return String(replacerValue);
        }
        return replacerValue;
      }) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

/**
 * Build a formatted profile prompt section from conversation session data.
 *
 * Generates a markdown-formatted Customer Profile section with trait information.
 * Each trait is displayed as a bulleted list item with the trait name and formatted value.
 * Primitive values (string, number, boolean, bigint) are shown without quotes for readability,
 * while objects and arrays are JSON-stringified.
 *
 * @param context - The conversation session containing profile data
 * @param traitGroups - Optional array of trait group names to include. If provided, only
 *                      these trait groups will be included in the output. If an empty array
 *                      is provided, returns null.
 * @returns Formatted profile section or null if no profile data or no traits match filter
 */
export function buildProfilePrompt(
  context: ConversationSession,
  traitGroups?: string[]
): string | null {
  if (!context.profile || !context.profile.traits) {
    return null;
  }

  let filteredTraits: Record<string, unknown>;

  if (traitGroups !== undefined) {
    if (traitGroups.length === 0) {
      return null;
    }

    filteredTraits = Object.fromEntries(
      Object.entries(context.profile.traits).filter(
        ([key, value]) => traitGroups.includes(key) && value != null
      )
    );
  } else {
    filteredTraits = Object.fromEntries(
      Object.entries(context.profile.traits).filter(([, value]) => value != null)
    );
  }

  if (Object.keys(filteredTraits).length === 0) {
    return null;
  }

  const lines = ['## Customer Profile', 'Information about this customer:'];

  for (const [key, value] of Object.entries(filteredTraits)) {
    lines.push(`- ${key}: ${formatTraitValue(value)}`);
  }

  return lines.join('\n');
}

/**
 * Conversation Orchestrator metadata known for a session, and how to fetch it
 * when it isn't known yet. Set by the channel that built the session; kept off
 * the session object so it never shows up when the session is serialized or
 * copied.
 */
interface ConversationMetadataState {
  known?: Record<string, string>;
  loader?: () => Promise<Record<string, string> | undefined>;
}

const conversationMetadataStates = new WeakMap<ConversationSession, ConversationMetadataState>();

/**
 * Record what a channel knows about `session`'s Conversation Orchestrator
 * metadata: the metadata itself, a loader to fetch it on demand, or both.
 *
 * @internal
 */
export function attachConversationMetadata(
  session: ConversationSession,
  state: ConversationMetadataState
): void {
  const existing = conversationMetadataStates.get(session) ?? {};
  conversationMetadataStates.set(session, { ...existing, ...state });
}

/**
 * The metadata stored on a conversation in Conversation Orchestrator.
 *
 * `session.metadata` is the session's own data, which another replica doesn't
 * see. This reads what's stored on the conversation itself — for example the
 * `metadata` passed to `initiateOutboundConversation` — so it works on
 * whichever replica handles the turn. It costs one Conversation Orchestrator
 * request, kept for the rest of this turn, unless the session already knows
 * it: the session `initiateOutboundConversation` returns holds what it wrote,
 * and a CLOSED webhook's session holds the payload's copy.
 *
 * Returns a copy, so editing it changes nothing. Returns `{}` when the
 * conversation has no metadata, the session didn't come from a channel, or the
 * lookup fails; a failed lookup is retried on the next call.
 *
 * @example
 * ```typescript
 * tac.onMessageReady(async ({ session }) => {
 *   const metadata = await conversationMetadata(session);
 *   const appointmentId = metadata.appointment_id;
 * });
 * ```
 */
export async function conversationMetadata(
  session: ConversationSession
): Promise<Record<string, string>> {
  const state = conversationMetadataStates.get(session);
  if (state === undefined) {
    return {};
  }
  if (state.known === undefined && state.loader !== undefined) {
    const loaded = await state.loader();
    if (loaded !== undefined) {
      state.known = loaded;
    }
  }
  return { ...(state.known ?? {}) };
}
