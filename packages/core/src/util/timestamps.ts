/**
 * ISO 8601 helpers for Conversation Orchestrator payloads.
 */

/**
 * Parse an ISO 8601 timestamp into epoch milliseconds.
 *
 * A value without a timezone designator is taken as UTC (JavaScript would
 * otherwise read a date-time without one as local time). Returns `undefined`
 * for a missing or unparseable value.
 *
 * @internal
 */
export function parseIso8601(value: string | null | undefined): number | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const isDateTime = value.includes('T');
  const parsed = Date.parse(isDateTime && !hasZone ? `${value}Z` : value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Whole milliseconds from `start` to `end`.
 *
 * `undefined` if either is missing or unparseable, or `end` precedes `start`
 * — a duration is left out rather than guessed.
 *
 * @internal
 */
export function elapsedMs(
  start: string | null | undefined,
  end: string | null | undefined
): number | undefined {
  const startAt = parseIso8601(start);
  const endAt = parseIso8601(end);
  if (startAt === undefined || endAt === undefined || endAt < startAt) {
    return undefined;
  }
  return Math.trunc(endAt - startAt);
}
