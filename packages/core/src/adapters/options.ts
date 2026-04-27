/**
 * Configuration options for adapter utilities like MemoryPromptBuilder.
 */
export interface AdapterOptions {
  /**
   * Optional array of profile trait group names to include in the output.
   *
   * - If undefined or not provided, all available trait groups are included
   * - If empty array ([]), no profile traits are included (profile section is omitted)
   * - If populated array, only the specified trait groups are included
   *
   * @example
   * ```typescript
   * // Include only Contact and Preferences traits
   * { profileTraits: ['Contact', 'Preferences'] }
   *
   * // Exclude all profile traits
   * { profileTraits: [] }
   *
   * // Include all traits (default)
   * { } // or undefined
   * ```
   */
  profileTraits?: string[];
}

/**
 * Extract and normalize profile trait groups from adapter options.
 *
 * This is an internal helper function used by MemoryPromptBuilder to handle trait filtering.
 * The returned array should be treated as immutable.
 *
 * @param options - Adapter options containing optional profileTraits configuration
 * @returns undefined if all traits should be included, empty array if traits should be
 *          excluded, or the specified trait groups array. The array is returned by reference.
 * @internal
 */
export function getProfileTraits(options?: AdapterOptions): string[] | undefined {
  if (!options || options.profileTraits === undefined) {
    return undefined;
  }

  if (options.profileTraits.length === 0) {
    return [];
  }

  return options.profileTraits;
}
