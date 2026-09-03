import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlidingWindowRateLimiter } from '../packages/tools/src/lib/rate-limiter.js';
import { GuardrailError } from '@twilio/tac-tools';

describe('SlidingWindowRateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows calls under the limit', () => {
    const limiter = new SlidingWindowRateLimiter<Record<string, never>>({ maxCalls: 3, windowMs: 1000 });
    expect(() => limiter.check('tool', {})).not.toThrow();
    expect(() => limiter.check('tool', {})).not.toThrow();
    expect(() => limiter.check('tool', {})).not.toThrow();
  });

  it('blocks the (maxCalls+1)th call within the window', () => {
    const limiter = new SlidingWindowRateLimiter<Record<string, never>>({ maxCalls: 3, windowMs: 1000 });
    limiter.check('tool', {});
    limiter.check('tool', {});
    limiter.check('tool', {});
    expect(() => limiter.check('tool', {})).toThrow(GuardrailError);
  });

  it('thrown GuardrailError has type rate_limit', () => {
    const limiter = new SlidingWindowRateLimiter<Record<string, never>>({ maxCalls: 1, windowMs: 1000 });
    limiter.check('tool', {});
    let caught: unknown;
    try { limiter.check('tool', {}); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(GuardrailError);
    expect((caught as GuardrailError).type).toBe('rate_limit');
  });

  it('resets after the window expires', () => {
    const limiter = new SlidingWindowRateLimiter<Record<string, never>>({ maxCalls: 2, windowMs: 1000 });
    limiter.check('tool', {});
    limiter.check('tool', {});
    vi.advanceTimersByTime(1001);
    expect(() => limiter.check('tool', {})).not.toThrow();
  });

  it('tracks different keys independently', () => {
    const limiter = new SlidingWindowRateLimiter<{ key: string }>({
      maxCalls: 1,
      windowMs: 1000,
      keyFn: p => p.key,
    });
    limiter.check('tool', { key: 'a' });
    expect(() => limiter.check('tool', { key: 'b' })).not.toThrow();
  });

  it('blocks same key after limit', () => {
    const limiter = new SlidingWindowRateLimiter<{ key: string }>({
      maxCalls: 1,
      windowMs: 1000,
      keyFn: p => p.key,
    });
    limiter.check('tool', { key: 'a' });
    expect(() => limiter.check('tool', { key: 'a' })).toThrow(GuardrailError);
  });

  it('calls keyFn with actual params', () => {
    const keyFn = vi.fn((_p: { msg: string }) => 'k');
    const limiter = new SlidingWindowRateLimiter({ maxCalls: 5, windowMs: 1000, keyFn });
    const params = { msg: 'hello' };
    limiter.check('tool', params);
    expect(keyFn).toHaveBeenCalledWith(params);
  });

  it('defaults key to tool name when keyFn omitted', () => {
    const limiter = new SlidingWindowRateLimiter<Record<string, never>>({ maxCalls: 1, windowMs: 1000 });
    limiter.check('my_tool', {});
    expect(() => limiter.check('my_tool', {})).toThrow(GuardrailError);
    // different tool name = different key, should not throw
    expect(() => limiter.check('other_tool', {})).not.toThrow();
  });
});
