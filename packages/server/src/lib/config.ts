import { z } from 'zod';

/**
 * Server configuration schema
 *
 * Controls host/port binding, public domain for WebSocket URLs,
 * and customizable webhook paths.
 */
export const TACServerConfigSchema = z.object({
  /** Host to bind the server to */
  host: z.string().default('0.0.0.0'),
  /** Port to bind the server to */
  port: z.number().int().positive().default(8000),
  /** Public domain for WebSocket URL (e.g., 'example.ngrok.io' - without protocol) */
  publicDomain: z
    .string()
    .default('')
    .transform(val => {
      if (!val) return '';
      // Strip protocol if present (http://, https://)
      let normalized = val.replace(/^https?:\/\//, '');
      // Strip trailing slashes
      normalized = normalized.replace(/\/+$/, '');
      return normalized;
    })
    .refine(
      val => {
        // Empty is allowed (will trigger warning at runtime)
        if (!val) return true;
        // Reject if contains path or protocol separator
        return !val.includes('/') && !val.includes('://');
      },
      {
        message:
          'publicDomain must be a domain only (e.g., "example.ngrok.io"), without protocol or paths',
      }
    ),
  /** Initial greeting message for callers */
  welcomeGreeting: z.string().default('Hello! How can I assist you today?'),
  /** Path for messaging webhook endpoint (for all channels) */
  messagingWebhookPath: z
    .string()
    .default('/webhook')
    .refine(val => val.startsWith('/'), {
      message: 'messagingWebhookPath must start with "/"',
    }),
  /** Path for TwiML generation endpoint */
  twimlPath: z
    .string()
    .default('/twiml')
    .refine(val => val.startsWith('/'), {
      message: 'twimlPath must start with "/"',
    }),
  /** Path for voice WebSocket endpoint */
  websocketPath: z
    .string()
    .default('/ws')
    .refine(val => val.startsWith('/'), {
      message: 'websocketPath must start with "/"',
    }),
  /** Path for ConversationRelay action callback endpoint */
  conversationRelayCallbackPath: z
    .string()
    .default('/conversation-relay-callback')
    .refine(val => val.startsWith('/'), {
      message: 'conversationRelayCallbackPath must start with "/"',
    }),
  /** Path for Conversation Intelligence webhook endpoint. Set to enable CI webhook route (e.g., '/ci-webhook') */
  cintelWebhookPath: z
    .string()
    .refine(val => val.startsWith('/'), {
      message: 'cintelWebhookPath must start with "/"',
    })
    .optional(),
});

export type TACServerConfigData = z.infer<typeof TACServerConfigSchema>;

/**
 * Environment variable mapping for server configuration
 */
export const ServerEnvironmentVariables = {
  TWILIO_VOICE_PUBLIC_DOMAIN: 'TWILIO_VOICE_PUBLIC_DOMAIN',
  TWILIO_SERVER_HOST: 'TWILIO_SERVER_HOST',
  TWILIO_SERVER_PORT: 'TWILIO_SERVER_PORT',
} as const;

/**
 * Server configuration class
 *
 * Example usage:
 * ```typescript
 * // Load from environment variables
 * const serverConfig = TACServerConfig.fromEnv();
 *
 * // Or create manually
 * const serverConfig = new TACServerConfig({
 *   host: '0.0.0.0',
 *   port: 8000,
 *   publicDomain: 'example.ngrok.io',
 * });
 * ```
 */
export class TACServerConfig {
  public readonly host: string;
  public readonly port: number;
  public readonly publicDomain: string;
  public readonly welcomeGreeting: string;
  public readonly messagingWebhookPath: string;
  public readonly twimlPath: string;
  public readonly websocketPath: string;
  public readonly conversationRelayCallbackPath: string;
  public readonly cintelWebhookPath?: string;

  constructor(data?: Partial<TACServerConfigData>) {
    const validated = TACServerConfigSchema.parse(data ?? {});
    this.host = validated.host;
    this.port = validated.port;
    this.publicDomain = validated.publicDomain;
    this.welcomeGreeting = validated.welcomeGreeting;
    this.messagingWebhookPath = validated.messagingWebhookPath;
    this.twimlPath = validated.twimlPath;
    this.websocketPath = validated.websocketPath;
    this.conversationRelayCallbackPath = validated.conversationRelayCallbackPath;
    if (validated.cintelWebhookPath !== undefined) {
      this.cintelWebhookPath = validated.cintelWebhookPath;
    }
  }

  /**
   * Create TACServerConfig from environment variables.
   *
   * Environment variables:
   * - TWILIO_VOICE_PUBLIC_DOMAIN: Public domain for WebSocket URLs (without protocol, e.g., 'example.ngrok.io')
   * - TWILIO_SERVER_HOST: Host to bind to (default: 0.0.0.0)
   * - TWILIO_SERVER_PORT: Port to bind to (default: 8000)
   *
   * @example
   * ```typescript
   * const server = new TACServer({
   *   tac,
   *   config: TACServerConfig.fromEnv()
   * });
   * ```
   */
  public static fromEnv(): TACServerConfig {
    const data: Partial<TACServerConfigData> = {};

    // Extract public domain (schema will normalize it)
    const publicDomain = process.env[ServerEnvironmentVariables.TWILIO_VOICE_PUBLIC_DOMAIN];
    if (publicDomain) {
      data.publicDomain = publicDomain;
    }

    const host = process.env[ServerEnvironmentVariables.TWILIO_SERVER_HOST];
    if (host) {
      data.host = host;
    }

    const port = process.env[ServerEnvironmentVariables.TWILIO_SERVER_PORT];
    if (port) {
      const parsed = parseInt(port, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid TWILIO_SERVER_PORT: expected a positive integer, got "${port}"`);
      }
      data.port = parsed;
    }

    return new TACServerConfig(data);
  }
}
