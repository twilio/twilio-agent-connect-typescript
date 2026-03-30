import Fastify, {
  FastifyInstance,
  FastifyServerOptions,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import gracefulShutdown from 'fastify-graceful-shutdown';
import type { WebSocket } from 'ws';
import twilio from 'twilio';

import {
  VoiceServerConfig,
  VoiceServerConfigSchema,
  ConversationRelayCallbackPayload,
  ConversationRelayCallbackPayloadSchema,
  ConversationRelayConfig,
} from '@twilio/tac-core';
import { TAC, VoiceChannel, MessagingChannel } from '@twilio/tac-core';

/**
 * Server configuration options
 */
export interface TACServerConfig {
  /** Fastify server options */
  fastify?: FastifyServerOptions;

  /** Voice server configuration */
  voice?: Partial<VoiceServerConfig>;

  /** Custom webhook paths */
  webhookPaths?: {
    messaging?: string;
    twiml?: string;
    ws?: string;
    conversationRelayCallback?: string;
    /** Path for Conversation Intelligence webhook (optional - only registered if provided) */
    cintel?: string;
  };

  /** ConversationRelay configuration (welcomeGreeting, transcription, TTS, interaction settings, etc.) */
  conversationRelayConfig?: Partial<Omit<ConversationRelayConfig, 'url'>>;

  /** Handler for voice handoff requests (returns TwiML string) */
  handoffHandler?: (payload: ConversationRelayCallbackPayload) => Promise<string>;

  /** Enable development features */
  development?: boolean;

  /** Enable Twilio webhook signature validation (default: true) */
  validateWebhooks?: boolean;

  /** Voice channel instance (alternative to registering on TAC) */
  voiceChannel?: VoiceChannel;

  /** Messaging channel instances — webhooks are fanned out to all (alternative to registering on TAC) */
  messagingChannels?: MessagingChannel[];
}

/**
 * Default server configuration
 */
const DEFAULT_CONFIG = {
  voice: {
    host: '0.0.0.0',
    port: 3000,
  },
  webhookPaths: {
    messaging: '/webhook',
    twiml: '/twiml',
    ws: '/ws',
    conversationRelayCallback: '/conversation-relay-callback',
  },
  conversationRelayConfig: {
    welcomeGreeting: 'Hello! How can I assist you today?',
  },
  development: false,
  validateWebhooks: true,
} satisfies Omit<
  TACServerConfig,
  'fastify' | 'handoffHandler' | 'voiceChannel' | 'messagingChannels'
>;

/**
 * Batteries-included Fastify server for TAC
 *
 * Provides out-of-the-box setup for SMS and Voice channels with
 * proper webhook handling, WebSocket support, and production-ready defaults.
 */
export class TACServer {
  private readonly fastify: FastifyInstance;
  private readonly tac: TAC;
  private readonly config: Required<
    Omit<TACServerConfig, 'fastify' | 'handoffHandler' | 'voiceChannel' | 'messagingChannels'>
  > & {
    handoffHandler?: (payload: ConversationRelayCallbackPayload) => Promise<string>;
  };
  /** All enabled messaging channels — webhooks are fanned out to each one */
  private readonly messagingChannels: MessagingChannel[];
  /** Voice channel instance */
  private readonly voiceChannel: VoiceChannel | undefined;

  constructor(tac: TAC, config: TACServerConfig = {}) {
    this.tac = tac;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      // Deep merge webhookPaths to preserve defaults while allowing overrides
      webhookPaths: {
        ...DEFAULT_CONFIG.webhookPaths,
        ...config.webhookPaths,
      },
      // Deep merge conversationRelayConfig to preserve defaults while allowing overrides
      conversationRelayConfig: {
        ...DEFAULT_CONFIG.conversationRelayConfig,
        ...config.conversationRelayConfig,
      },
    };

    // Resolve channels: prefer explicit kwargs, fall back to tac.getChannel()
    this.voiceChannel = config.voiceChannel ?? tac.getChannel<VoiceChannel>('voice');
    this.messagingChannels =
      config.messagingChannels ??
      (
        [tac.getChannel<MessagingChannel>('sms'), tac.getChannel<MessagingChannel>('chat')] as (
          | MessagingChannel
          | undefined
        )[]
      ).filter((ch): ch is MessagingChannel => ch != null);

    if (this.messagingChannels.length === 0) {
      // eslint-disable-next-line no-console -- Fastify logger not yet initialized
      console.warn(
        'TACServer: No messaging channels configured. Messaging webhooks will be disabled. Register a MessagingChannel (e.g., "sms" or "chat") with TAC to enable messaging.'
      );
    }
    // Initialize Fastify with Pino logger
    this.fastify = Fastify({
      logger: this.config.development
        ? {
            level: process.env.LOG_LEVEL || 'info',
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
              },
            },
          }
        : {
            level: process.env.LOG_LEVEL || 'info',
          },
      ...config.fastify,
    });
  }

  /**
   * Get the full URL for webhook validation
   * Handles X-Forwarded-* headers for proxy/ngrok scenarios
   */
  private getWebhookUrl(request: FastifyRequest): string {
    const proto = (request.headers['x-forwarded-proto'] as string) || 'https';
    const host = (request.headers['x-forwarded-host'] as string) || request.headers.host || '';
    return `${proto}://${host}${request.url}`;
  }

  /**
   * Register global Twilio webhook signature validation hook
   */
  private registerWebhookValidation(): void {
    if (!this.config.validateWebhooks) {
      return;
    }

    this.fastify.addHook('preHandler', (request, reply, done): void => {
      // Skip GET requests (WebSocket upgrades)
      if (request.method === 'GET') {
        done();
        return;
      }

      const signature = request.headers['x-twilio-signature'] as string;
      const url = this.getWebhookUrl(request);
      const authToken = this.tac.getConfig().twilioAuthToken;

      let isValid: boolean;

      // Check if this is a JSON body webhook (has bodySHA256 in query string)
      if (request.url.includes('bodySHA256=')) {
        // JSON body validation - use raw body string
        const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
        isValid = twilio.validateRequestWithBody(authToken, signature, url, body);
      } else {
        // Form-encoded validation - use parsed params
        const params = (request.body as Record<string, string>) || {};
        isValid = twilio.validateRequest(authToken, signature, url, params);
      }

      if (!isValid) {
        this.fastify.log.warn(
          { url, hasSignature: !!signature },
          'Invalid Twilio webhook signature'
        );
        void reply.code(403).send({ error: 'Invalid webhook signature' });
        done();
        return;
      }

      done();
    });
  }

  /**
   * Setup routes
   */
  private async setupRoutes(): Promise<void> {
    // Messaging webhook — fan out to all enabled messaging channels (each self-filters)
    if (this.messagingChannels.length > 0) {
      this.fastify.post(
        this.config.webhookPaths.messaging || '/webhook',
        async (request: FastifyRequest, reply: FastifyReply) => {
          for (const channel of this.messagingChannels) {
            channel.processWebhook(request.body).catch((err: unknown) => {
              this.fastify.log.error(
                { err, channel: channel.channelType },
                'Messaging webhook processing error'
              );
            });
          }
          await reply.code(200).send({ status: 'ok' });
        }
      );
    }

    // Voice webhook (POST - Twilio calls this when an incoming call arrives)
    this.fastify.post(
      this.config.webhookPaths.twiml || '/twiml',
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          if (!this.voiceChannel) {
            await reply.code(500).send({ error: 'Voice channel not available' });
            return;
          }

          const voiceChannel = this.voiceChannel;

          // Extract form data from POST body
          const formData = request.body as Record<string, string>;
          const fromNumber = formData['From'] || '';
          const toNumber = formData['To'] || '';
          const callSid = formData['CallSid'] || '';

          // Generate WebSocket URL
          const protocol = (request.headers['x-forwarded-proto'] as string) || 'http';
          const host = request.headers.host as string;
          const websocketUrl = `${protocol === 'https' ? 'wss' : 'ws'}://${host}${this.config.webhookPaths.ws || '/ws'}`;
          const callbackUrl = `${protocol}://${host}${this.config.webhookPaths.conversationRelayCallback || '/conversation-relay-callback'}`;

          // Use handleIncomingCall to create conversation and generate TwiML
          const twiml = await voiceChannel.handleIncomingCall({
            toNumber,
            fromNumber,
            callSid,
            actionUrl: callbackUrl,
            conversationRelayConfig: {
              url: websocketUrl,
              ...this.config.conversationRelayConfig,
            },
          });

          await reply.type('application/xml').send(twiml);
        } catch (error) {
          this.fastify.log.error(
            'TwiML generation error: ' + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );

    // ConversationRelay callback endpoint
    this.fastify.post(
      this.config.webhookPaths.conversationRelayCallback || '/conversation-relay-callback',
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          if (!this.voiceChannel) {
            await reply.code(500).send({ error: 'Voice channel not available' });
            return;
          }

          const voiceChannel = this.voiceChannel;

          // Parse form data into payload
          const formData = request.body as Record<string, string>;
          const parseResult = ConversationRelayCallbackPayloadSchema.safeParse(formData);

          if (!parseResult.success) {
            this.fastify.log.error(
              { errors: parseResult.error.errors },
              'Invalid ConversationRelay callback payload'
            );
            await reply.code(400).send({ error: 'Invalid payload' });
            return;
          }

          const result = await voiceChannel.handleConversationRelayCallback(
            parseResult.data,
            this.config.handoffHandler
          );

          await reply.code(result.status).type(result.contentType).send(result.content);
        } catch (error) {
          this.fastify.log.error(
            'ConversationRelay callback error: ' +
              (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({ error: 'Internal server error' });
        }
      }
    );

    // Voice WebSocket endpoint
    await this.fastify.register(fastify => {
      fastify.get(
        this.config.webhookPaths.ws || '/ws',
        { websocket: true },
        (socket: WebSocket) => {
          if (!this.voiceChannel) {
            socket.terminate();
            return;
          }

          // Handle WebSocket connection
          this.voiceChannel.handleWebSocketConnection(socket);
        }
      );
    });

    // Conversation Intelligence webhook endpoint (optional - only if path is configured)
    if (this.config.webhookPaths.cintel) {
      this.fastify.post(
        this.config.webhookPaths.cintel,
        async (request: FastifyRequest, reply: FastifyReply) => {
          if (!this.tac.isCintelEnabled()) {
            await reply.code(400).send({
              error: 'Conversation Intelligence is not enabled',
              message:
                'Set TWILIO_TAC_CI_CONFIGURATION_ID and memory credentials to enable CI processing',
            });
            return;
          }

          try {
            this.fastify.log.info('Processing Conversation Intelligence webhook');
            const result = await this.tac.processCintelEvent(request.body);

            if (result.success) {
              if (result.skipped) {
                this.fastify.log.debug({ reason: result.skipReason }, 'CI event skipped');
              } else {
                this.fastify.log.info(
                  { eventType: result.eventType, createdCount: result.createdCount },
                  'CI event processed'
                );
              }
            } else {
              this.fastify.log.error({ error: result.error }, 'CI event processing failed');
            }

            await reply.send(result);
          } catch (error) {
            this.fastify.log.error(
              'CI webhook error: ' + (error instanceof Error ? error.message : String(error))
            );
            await reply.code(500).send({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      );
    }
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      // Register form body parser for POST requests
      await this.fastify.register(formbody);

      // Register WebSocket support
      await this.fastify.register(websocket);

      // Register graceful shutdown - waits for WebSockets to close
      await this.fastify.register(gracefulShutdown);

      // Register webhook signature validation (must be after formbody for body access)
      this.registerWebhookValidation();

      // Set up routes (must be after plugin registration)
      await this.setupRoutes();

      // Configure graceful shutdown to wait for WebSocket connections
      this.fastify.gracefulShutdown(async (signal: string) => {
        this.fastify.log.info({ signal }, 'Received shutdown signal');

        // Wait for WebSocket connections to close naturally
        await this.waitForWebSocketsToClose();

        // Shutdown TAC (cleans up channel state)
        this.tac.shutdown();
      });

      // Start Fastify server
      const voiceConfig = VoiceServerConfigSchema.parse(this.config.voice);
      await this.fastify.listen({
        host: voiceConfig.host,
        port: voiceConfig.port,
      });

      this.fastify.log.info(
        {
          host: voiceConfig.host,
          port: voiceConfig.port,
          messaging_webhook: this.config.webhookPaths.messaging,
          twiml_webhook: this.config.webhookPaths.twiml,
          ws_websocket: this.config.webhookPaths.ws,
          conversation_relay_callback: this.config.webhookPaths.conversationRelayCallback,
          ...(this.config.webhookPaths.cintel && {
            cintel_webhook: this.config.webhookPaths.cintel,
          }),
          webhook_validation: this.config.validateWebhooks ? 'enabled' : 'disabled',
        },
        'TAC Server started'
      );

      // Warn if webhook validation is disabled
      if (!this.config.validateWebhooks) {
        this.fastify.log.warn(
          'Webhook signature validation is DISABLED. Enable in production for security.'
        );
      }
    } catch (error) {
      this.fastify.log.error({ err: error }, 'Failed to start TAC Server');
      throw error;
    }
  }

  /**
   * Wait for all WebSocket connections to close
   */
  private async waitForWebSocketsToClose(timeoutMs = 30000): Promise<void> {
    const wsServer = this.fastify.websocketServer;
    if (!wsServer || wsServer.clients.size === 0) {
      return;
    }

    this.fastify.log.info(
      { websocket_count: wsServer.clients.size },
      'Waiting for WebSocket connections to close...'
    );

    const startTime = Date.now();

    return new Promise<void>(resolve => {
      const checkInterval = setInterval(() => {
        const clientCount = wsServer.clients.size;

        if (clientCount === 0) {
          clearInterval(checkInterval);
          this.fastify.log.info('All WebSocket connections closed');
          resolve();
          return;
        }

        // Check for timeout
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          this.fastify.log.warn(
            { remaining_websockets: clientCount },
            'Timeout waiting for WebSockets to close, proceeding with shutdown'
          );
          resolve();
          return;
        }

        this.fastify.log.info(
          { remaining_websockets: clientCount },
          'Waiting for WebSockets to close...'
        );
      }, 5000);
    });
  }

  /**
   * Stop the server gracefully
   */
  public async stop(): Promise<void> {
    try {
      await this.fastify.close();
      this.fastify.log.info('TAC Server stopped');
    } catch (error) {
      this.fastify.log.error({ err: error }, 'Error stopping TAC Server');
      throw error;
    }
  }
}
