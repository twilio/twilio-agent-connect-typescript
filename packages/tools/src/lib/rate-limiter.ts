import { GuardrailError } from './errors.js';

export interface RateLimitConfig<TParams> {
  maxCalls: number;
  windowMs: number;
  keyFn?: (params: TParams) => string;
}

export class SlidingWindowRateLimiter<TParams> {
  private readonly timestamps: Map<string, number[]> = new Map();

  constructor(private readonly config: RateLimitConfig<TParams>) {}

  check(toolName: string, params: TParams): void {
    const key = this.config.keyFn ? this.config.keyFn(params) : toolName;
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    const calls = (this.timestamps.get(key) ?? []).filter(t => t > cutoff);

    if (calls.length >= this.config.maxCalls) {
      throw new GuardrailError(
        `Rate limit exceeded: max ${this.config.maxCalls} calls per ${this.config.windowMs}ms`,
        'rate_limit'
      );
    }

    calls.push(now);
    this.timestamps.set(key, calls);
  }
}
