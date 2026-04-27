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
