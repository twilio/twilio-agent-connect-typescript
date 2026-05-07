import { TACMemoryResponse } from '../lib/tac-memory-response';
import { buildProfilePrompt } from '../lib/conversation-session-helpers';
import { ConversationSession } from '../types/conversation';
import { AdapterOptions, getProfileTraits } from './options';

/**
 * Utility class for building formatted LLM prompts from TAC memory and profile data.
 *
 * Generates markdown-formatted prompt sections that can be injected into LLM system messages,
 * providing context about the customer from previous interactions.
 *
 * @example
 * ```typescript
 * // Simple usage with compose() - no if/else needed
 * const systemPrompt = MemoryPromptBuilder.compose(
 *   'You are a helpful assistant.',
 *   memoryResponse,
 *   session
 * );
 *
 * // Advanced usage with trait filtering
 * const systemPrompt = MemoryPromptBuilder.compose(
 *   'You are a helpful assistant.',
 *   memoryResponse,
 *   session,
 *   { profileTraits: ['Contact', 'Preferences'] }
 * );
 * ```
 */
export class MemoryPromptBuilder {
  /**
   * Build a formatted memory prompt from available memory and profile data.
   *
   * **Note:** Most users should use `compose()` instead, which automatically handles
   * combining memory with your system prompt. Use `build()` only if you need the raw
   * memory content without a system prompt.
   *
   * Generates a structured prompt with up to four sections:
   * - **Customer Profile**: Profile traits (filtered by options if provided)
   * - **Key Observations**: Important notes from previous interactions
   * - **Past Conversation Summaries**: Summaries of previous conversations
   * - **Recent Message History**: Recent communications with the customer
   *
   * Sections with no data are omitted. If no data is available at all, returns an empty string.
   *
   * @param memoryResponse - Memory data from TAC.retrieveMemory() containing observations,
   *                         summaries, and communications. Optional.
   * @param context - Conversation session containing profile data. Optional.
   * @param options - Configuration options for filtering profile traits. If profileTraits is
   *                  provided, only those trait groups will be included in the output. If an
   *                  empty array is provided, profile section is omitted. Optional.
   * @returns Formatted markdown prompt string ready for injection into LLM system messages.
   *          Returns empty string if no memory or profile data is available.
   *
   * @example
   * ```typescript
   * // Recommended: Use compose() for most cases
   * const prompt = MemoryPromptBuilder.compose(basePrompt, memory, session);
   *
   * // Advanced: Use build() only if you need raw memory content
   * const rawMemory = MemoryPromptBuilder.build(memory, session);
   * if (rawMemory) {
   *   // Custom handling of memory content
   * }
   * ```
   */
  static build(
    memoryResponse?: TACMemoryResponse | null,
    context?: ConversationSession | null,
    options?: AdapterOptions
  ): string {
    if (!memoryResponse && (!context || !context.profile)) {
      return '';
    }

    const sections: string[] = [];

    if (context) {
      const traitGroups = getProfileTraits(options);
      const profileSection = buildProfilePrompt(context, traitGroups);
      if (profileSection) {
        sections.push(profileSection);
      }
    }

    if (memoryResponse) {
      const memorySections = memoryResponse.buildMemoryPrompts();
      sections.push(...memorySections);
    }

    if (sections.length === 0) {
      return '';
    }

    return this.assemblePrompt(sections);
  }

  /**
   * Compose system prompt with memory context.
   *
   * Appends memory to systemPrompt if available. Always returns a string.
   * Eliminates the need for manual if/else checks when combining prompts.
   *
   * **Note:** Empty strings (`''`) are treated as "no system prompt" (same as null/undefined).
   * This matches the behavior of the manual if/else pattern and Python SDK implementation.
   *
   * @param systemPrompt - Base system prompt for the LLM. Empty string, null, and undefined
   *                       are all treated as "no system prompt". Optional.
   * @param memoryResponse - Memory data from TAC.retrieveMemory(). Optional.
   * @param context - Conversation session containing profile data. Optional.
   * @param options - Configuration options for filtering profile traits. Optional.
   * @returns Composed prompt with memory appended to systemPrompt. Returns empty string
   *          if both systemPrompt and memory are empty/null/undefined.
   *
   * @example
   * ```typescript
   * // Before (manual if/else)
   * const memoryContext = MemoryPromptBuilder.build(memoryResponse, context);
   * const systemPrompt = basePrompt + (memoryContext ? `\n\n${memoryContext}` : '');
   *
   * // After (compose handles it)
   * const systemPrompt = MemoryPromptBuilder.compose(basePrompt, memoryResponse, context);
   *
   * // Empty strings are treated as "no prompt"
   * compose('', memory, context);  // Returns just memory content (no prefix)
   * compose('   ', memory, context);  // Returns '   \n\nmemory' (whitespace preserved)
   * ```
   */
  static compose(
    systemPrompt?: string | null,
    memoryResponse?: TACMemoryResponse | null,
    context?: ConversationSession | null,
    options?: AdapterOptions
  ): string {
    const memoryContent = this.build(memoryResponse, context, options);

    if (!systemPrompt && !memoryContent) {
      return '';
    }

    if (!systemPrompt) {
      return memoryContent;
    }

    if (!memoryContent) {
      return systemPrompt;
    }

    return `${systemPrompt}\n\n${memoryContent}`;
  }

  private static assemblePrompt(sections: string[]): string {
    const header = [
      '# Customer Context',
      'You have access to the following information about this customer ' +
        'from previous interactions:',
      '',
    ];

    const body = sections.join('\n\n');

    return header.join('\n') + body;
  }
}
