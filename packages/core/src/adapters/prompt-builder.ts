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
 * // Basic usage - includes all available data
 * const memoryPrompt = MemoryPromptBuilder.build(memoryResponse, session);
 * const systemPrompt = 'You are a helpful assistant.' + (memoryPrompt && `\n\n${memoryPrompt}`);
 *
 * // With trait filtering - only include specific profile trait groups
 * const memoryPrompt = MemoryPromptBuilder.build(
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
