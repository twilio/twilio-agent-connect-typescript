import { describe, it, expect } from 'vitest';
import { elapsedMs, parseIso8601 } from '../packages/core/src/util/timestamps';

/**
 * Tests for the ISO 8601 helpers used on Conversation Orchestrator payloads.
 * Mirrors the Python SDK's test_timestamps.py.
 */
describe('parseIso8601', () => {
  const at = Date.UTC(2026, 8, 30, 10, 0);

  it('parses a trailing Z', () => {
    expect(parseIso8601('2026-09-30T10:00:00Z')).toBe(at);
  });

  it('parses an offset', () => {
    expect(parseIso8601('2026-09-30T12:00:00+02:00')).toBe(at);
  });

  it('takes a value without a zone as UTC', () => {
    expect(parseIso8601('2026-09-30T10:00:00')).toBe(at);
  });

  it('keeps fractional seconds', () => {
    expect(parseIso8601('2026-09-30T10:00:00.500Z')).toBe(at + 500);
  });

  it.each([undefined, null, '', 'not a timestamp'])(
    'returns undefined for missing or unparseable %j',
    value => {
      expect(parseIso8601(value)).toBeUndefined();
    }
  );
});

describe('elapsedMs', () => {
  it('returns whole milliseconds', () => {
    expect(elapsedMs('2026-09-30T10:00:00Z', '2026-09-30T10:01:30.250Z')).toBe(90_250);
  });

  it.each([
    [undefined, '2026-09-30T10:00:00Z'],
    ['2026-09-30T10:00:00Z', undefined],
    ['garbage', '2026-09-30T10:00:00Z'],
  ])('returns undefined when either side is missing (%j, %j)', (start, end) => {
    expect(elapsedMs(start, end)).toBeUndefined();
  });

  it('returns undefined when end precedes start', () => {
    expect(elapsedMs('2026-09-30T10:05:00Z', '2026-09-30T10:00:00Z')).toBeUndefined();
  });
});
