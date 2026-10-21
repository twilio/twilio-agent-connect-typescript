import { describe, it, expect } from 'vitest';
import { ExpiringMap } from '../packages/core/src/util/expiring-map';

/**
 * Tests for ExpiringMap — the bound that keeps cross-request state from
 * leaking. Mirrors the Python SDK's test_expiring_dict.py.
 */

/** An ExpiringMap on a clock the test controls. */
class ClockedMap<V> extends ExpiringMap<V> {
  public clock = 1_000_000;

  public advance(ms: number): void {
    this.clock += ms;
  }

  protected override now(): number {
    return this.clock;
  }
}

describe('ExpiringMap', () => {
  describe('basics', () => {
    it('sets, gets and takes', () => {
      const map = new ExpiringMap<string>();
      map.set('a', 'one');

      expect(map.has('a')).toBe(true);
      expect(map.get('a')).toBe('one');
      expect(map.take('a')).toBe('one');
      expect(map.has('a')).toBe(false);
      expect(map.take('a')).toBeUndefined();
    });

    it('returns undefined for a missing key', () => {
      expect(new ExpiringMap<string>().get('nope')).toBeUndefined();
    });

    it('keeps one entry when a key is reassigned', () => {
      const map = new ExpiringMap<string>();
      map.set('a', 'one');
      map.set('a', 'two');

      expect(map.size).toBe(1);
      expect(map.take('a')).toBe('two');
    });

    it('deletes and clears', () => {
      const map = new ExpiringMap<string>();
      map.set('a', 'one').set('b', 'two');

      expect(map.delete('a')).toBe(true);
      expect(map.delete('a')).toBe(false);
      map.clear();
      expect(map.size).toBe(0);
    });

    it('rejects nonsense construction', () => {
      expect(() => new ExpiringMap({ ttlMs: 0 })).toThrow('ttlMs must be positive');
      expect(() => new ExpiringMap({ maxEntries: 0 })).toThrow('maxEntries must be positive');
    });
  });

  describe('expiry', () => {
    it('expires an entry after its TTL', () => {
      const map = new ClockedMap<string>({ ttlMs: 60_000 });
      map.set('a', 'one');

      map.advance(59_000);
      expect(map.take('a')).toBe('one');

      map.set('b', 'two');
      map.advance(61_000);
      expect(map.get('b')).toBeUndefined();
      expect(map.has('b')).toBe(false);
      expect(map.take('b')).toBeUndefined();
      expect(map.size).toBe(0);
    });

    it('purges expired entries on write', () => {
      // A call that is never answered must not keep its entry forever.
      const map = new ClockedMap<string>({ ttlMs: 60_000 });
      for (let i = 0; i < 5; i++) {
        map.set(`abandoned_${i}`, 'config');
      }

      map.advance(61_000);
      map.set('fresh', 'config');

      expect(map.size).toBe(1);
      expect(map.take('fresh')).toBe('config');
    });

    it('reports an expired entry as not deleted', () => {
      const map = new ClockedMap<string>({ ttlMs: 60_000 });
      map.set('a', 'one');
      map.advance(61_000);

      expect(map.delete('a')).toBe(false);
    });
  });

  describe('capacity', () => {
    it('evicts the oldest entries over capacity', () => {
      const map = new ExpiringMap<string>({ maxEntries: 3 });
      for (let i = 0; i < 5; i++) {
        map.set(`k${i}`, String(i));
      }

      expect(map.size).toBe(3);
      expect(map.has('k0')).toBe(false);
      expect(map.has('k1')).toBe(false);
      expect(map.take('k4')).toBe('4');
    });
  });
});
