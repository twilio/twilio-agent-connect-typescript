import pino from 'pino';
import { scrubObject } from '../util/log-redaction';

/**
 * Logger type that can be either Pino logger or Fastify's logger
 */
export type Logger = pino.Logger;

const scrubArg = (arg: unknown): unknown => scrubObject(arg);

/**
 * Pino `logMethod` hook that masks phone numbers and emails in log arguments.
 *
 * @internal
 */
export function scrubLogMethod(this: pino.Logger, args: unknown[], method: pino.LogFn): void {
  return method.apply(this, args.map(scrubArg) as Parameters<pino.LogFn>);
}

const LOG_METHODS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const scrubbingLoggers = new WeakSet<object>();

/**
 * Wrap a logger so its log calls, and those of its children, are scrubbed
 * the same way as a logger from {@link createLogger}.
 *
 * @internal
 */
export function withScrubbing(logger: Logger): Logger {
  if (scrubbingLoggers.has(logger)) return logger;
  const wrapped = new Proxy(logger, {
    get(target, prop): unknown {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (typeof prop === 'string' && LOG_METHODS.has(prop)) {
        return (...args: unknown[]): unknown => fn.apply(target, args.map(scrubArg));
      }
      if (prop === 'child') {
        return (bindings: unknown, ...rest: unknown[]): Logger =>
          withScrubbing(fn.call(target, scrubObject(bindings), ...rest) as Logger);
      }
      return value;
    },
  });
  scrubbingLoggers.add(wrapped);
  return wrapped;
}

export function createLogger(options?: { level?: string; name?: string }): Logger {
  const level = options?.level || process.env.TWILIO_LOG_LEVEL || 'info';

  return pino({
    level,
    ...(options?.name && { name: options.name }),
    hooks: { logMethod: scrubLogMethod },
  });
}
