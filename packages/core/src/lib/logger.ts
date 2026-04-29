import pino from 'pino';
import { scrubObject } from '../util/log-redaction';

/**
 * Logger type that can be either Pino logger or Fastify's logger
 */
export type Logger = pino.Logger;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function piiLogMethod(this: any, args: unknown[], method: pino.LogFn) {
  const scrubbed = args.map(arg =>
    typeof arg === 'string'
      ? scrubObject(arg)
      : typeof arg === 'object' && arg !== null
        ? scrubObject(arg)
        : arg
  );
  return method.apply(this, scrubbed as Parameters<pino.LogFn>);
}

/**
 * Create a Pino logger with configured settings
 *
 * @param options - Logger configuration options
 * @returns Configured Pino logger
 */
export function createLogger(options?: {
  level?: string;
  pretty?: boolean;
  name?: string;
}): Logger {
  const level = options?.level || process.env.TWILIO_LOG_LEVEL || 'info';
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const usePretty = options?.pretty !== undefined ? options.pretty : isDevelopment;

  const pinoOptions: pino.LoggerOptions = {
    level,
    ...(options?.name && { name: options.name }),
    hooks: { logMethod: piiLogMethod },
  };

  // Use pretty printing in development for better readability
  if (usePretty) {
    return pino({
      ...pinoOptions,
      transport: {
        target: 'pino-pretty',
        options: {},
      },
    });
  }

  return pino(pinoOptions);
}
