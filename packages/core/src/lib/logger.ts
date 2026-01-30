import pino from 'pino';

/**
 * Logger type that can be either Pino logger or Fastify's logger
 */
export type Logger = pino.Logger;

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
  const level = options?.level || process.env.LOG_LEVEL || 'info';
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const usePretty = options?.pretty !== undefined ? options.pretty : isDevelopment;

  const pinoOptions: pino.LoggerOptions = {
    level,
    ...(options?.name && { name: options.name }),
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
