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

export function createLogger(options?: { level?: string; name?: string }): Logger {
  const level = options?.level || process.env.TWILIO_LOG_LEVEL || 'info';

  return pino({
    level,
    ...(options?.name && { name: options.name }),
    hooks: { logMethod: piiLogMethod },
  });
}
