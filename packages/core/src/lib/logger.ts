import pino from 'pino';
import { scrubObject } from '../util/log-redaction';

/**
 * Logger type that can be either Pino logger or Fastify's logger
 */
export type Logger = pino.Logger;

function piiLogMethod(this: pino.Logger, args: unknown[], method: pino.LogFn): void {
  const scrubbed = args.map(arg =>
    typeof arg === 'string'
      ? scrubObject(arg)
      : typeof arg === 'object' && arg !== null
        ? scrubObject(arg)
        : arg
  );
  return method.apply(this, scrubbed as Parameters<pino.LogFn>);
}

const LOG_LEVEL_ALIASES: Record<string, pino.LevelWithSilent> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  fatal: 'fatal',
  critical: 'fatal',
  silent: 'silent',
};

/**
 * Map a log level name to a pino level, case-insensitively. Accepts the Python
 * SDK's names (`WARNING`, `CRITICAL`) and, like it, falls back to `info` for an
 * unrecognized value, since pino throws on one.
 *
 * @internal
 */
export function resolveLogLevel(level: string | undefined): pino.LevelWithSilent {
  return LOG_LEVEL_ALIASES[level?.trim().toLowerCase() ?? ''] ?? 'info';
}

export function createLogger(options?: { level?: string; name?: string }): Logger {
  const level = resolveLogLevel(options?.level || process.env.TWILIO_LOG_LEVEL);

  return pino({
    level,
    ...(options?.name && { name: options.name }),
    hooks: { logMethod: piiLogMethod },
  });
}
