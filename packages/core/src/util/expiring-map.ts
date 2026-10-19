/**
 * A small bounded, time-expiring map for short-lived cross-request state.
 */

/**
 * Default entry lifetime. Sized for the gap between one Twilio request minting
 * a value and the call's WebSocket connecting.
 */
export const DEFAULT_EXPIRING_MAP_TTL_MS = 15 * 60 * 1000;

/** Default cap on live entries. */
export const DEFAULT_EXPIRING_MAP_MAX_ENTRIES = 1000;

/**
 * A string-keyed map whose entries expire and whose size is bounded.
 *
 * For state one Twilio request creates and a later one for the same call
 * consumes. Normally deleted within seconds — but a call that is never
 * answered, or whose second request lands on another instance, leaves an entry
 * nobody will collect. The TTL and cap make that leak impossible rather than
 * unlikely. Expiry is lazy: no timers are armed, so nothing keeps the process
 * alive.
 *
 * @internal
 */
export class ExpiringMap<V> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  // Insertion-ordered, so the oldest entries are also the first to expire.
  private readonly entries = new Map<string, { expiresAt: number; value: V }>();

  constructor(options?: { ttlMs?: number; maxEntries?: number }) {
    const ttlMs = options?.ttlMs ?? DEFAULT_EXPIRING_MAP_TTL_MS;
    const maxEntries = options?.maxEntries ?? DEFAULT_EXPIRING_MAP_MAX_ENTRIES;
    if (!(ttlMs > 0)) {
      throw new Error(`ttlMs must be positive, got ${ttlMs}`);
    }
    if (!(maxEntries > 0)) {
      throw new Error(`maxEntries must be positive, got ${maxEntries}`);
    }
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /** Current time in ms; overridable in tests. */
  protected now(): number {
    return Date.now();
  }

  /** Drop expired entries, then the oldest survivors if still over capacity. */
  private purge(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) break;
      this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.entries.delete(oldest);
    }
  }

  public set(key: string, value: V): this {
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, value });
    this.purge();
    return this;
  }

  public get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined || entry.expiresAt <= this.now()) {
      return undefined;
    }
    return entry.value;
  }

  public has(key: string): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && entry.expiresAt > this.now();
  }

  /** Remove `key` and return its live value, if any. */
  public take(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    return entry.expiresAt <= this.now() ? undefined : entry.value;
  }

  public delete(key: string): boolean {
    const live = this.has(key);
    this.entries.delete(key);
    return live;
  }

  public clear(): void {
    this.entries.clear();
  }

  /** Number of live entries. */
  public get size(): number {
    this.purge();
    return this.entries.size;
  }
}
