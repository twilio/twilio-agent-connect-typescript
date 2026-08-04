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
  ConversationRelayCallbackPayloadSchema,
  twiMLRequestFromForm,
  CALL_EVENT_KINDS,
} from '@twilio/tac-core';
import { TAC, VoiceChannel, MessagingChannel } from '@twilio/tac-core';

/**
 * Server configuration options
 */
export interface TACServerConfig {
  /** Fastify server options (ignored if `fastifyInstance` is provided) */
  fastify?: FastifyServerOptions;

  /**
   * Pre-configured Fastify instance to mount TAC routes onto.
   *
   * Use this to control construction-time settings (logger, `trustProxy`,
   * schema, ...) or to register your own plugins/hooks before TAC's
   * routes are set up. If provided, the `fastify` options field is
   * ignored.
   */
  fastifyInstance?: FastifyInstance;

  /** Host to bind the server to (default: '0.0.0.0') */
  host?: string;

  /** Port to bind the server to (default: 8000) */
  port?: number;

  /**
   * Custom server-only webhook paths. The voice WebSocket and ConversationRelay
   * action callback paths live on `TACConfig` (`voiceWebsocketPath` /
   * `voiceActionPath`) because they're consumed by the voice channel regardless
   * of which web framework is used; this server reads them from there.
   */
  webhookPaths?: {
    /**
     * @deprecated Use `conversation` instead. This field will be removed in a future version.
     * If both `messaging` and `conversation` are set, `conversation` takes precedence.
     */
    messaging?: string;
    conversation?: string;
    twiml?: string;
    /** Path for Conversation Intelligence webhook (optional - only registered if provided) */
    cintel?: string;
  };

  /** Voice channel instance (alternative to registering on TAC) */
  voiceChannel?: VoiceChannel;

  /** Messaging channel instances — webhooks are fanned out to all (alternative to registering on TAC) */
  messagingChannels?: MessagingChannel[];
}

/**
 * Default server configuration
 */
const DEFAULT_CONFIG = {
  host: '0.0.0.0',
  port: 8000,
  webhookPaths: {
    conversation: '/webhook',
    twiml: '/twiml',
  },
} satisfies Omit<
  TACServerConfig,
  'fastify' | 'fastifyInstance' | 'voiceChannel' | 'messagingChannels'
>;

/** Normalize a route path for comparison, so '/hooks' and '/hooks/' collide. */
function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '');
}

/** What the voice channel's webhook handlers hand back for a reply. */
type CallEventResult = { status: number; content: string; contentType: string };

/**
 * Batteries-included Fastify server for TAC
 *
 * Provides out-of-the-box setup for SMS and Voice channels with
 * proper webhook handling, WebSocket support, and production-ready defaults.
 *
 * Customization:
 *   - Pass your own Fastify instance via `config.fastifyInstance` to control
 *     construction-time settings (logger, `trustProxy`, schema, ...) and to
 *     register plugins/hooks before TAC's routes are set up.
 *   - Or mutate `server.fastify` after construction to add routes,
 *     decorators, or hooks — before calling `start()`.
 *
 * Example:
 *   import Fastify from 'fastify';
 *
 *   const app = Fastify({ logger: true, trustProxy: true });
 *   const server = new TACServer(tac, { fastifyInstance: app });
 *
 *   server.fastify.get('/health', async () => ({ status: 'ok' }));
 *
 *   await server.start();
 */
export class TACServer {
  public readonly fastify: FastifyInstance;
  private readonly tac: TAC;
  private readonly config: Required<
    Omit<TACServerConfig, 'fastify' | 'fastifyInstance' | 'voiceChannel' | 'messagingChannels'>
  >;
  /** All enabled messaging channels */
  private readonly messagingChannels: MessagingChannel[];
  /** Voice channel instance */
  private readonly voiceChannel: VoiceChannel | undefined;
  /** All channels that need webhook processing (voice + messaging) */
  private readonly webhookChannels: (VoiceChannel | MessagingChannel)[];

  constructor(tac: TAC, config: TACServerConfig = {}) {
    this.tac = tac;

    // Handle deprecated `messaging` field: log warning and apply fallback if needed
    const webhookPaths = { ...DEFAULT_CONFIG.webhookPaths, ...config.webhookPaths };
    if (config.webhookPaths?.messaging) {
      console.warn(
        'TACServer: The "webhookPaths.messaging" field is deprecated and will be removed in a future version. ' +
          'Please update your configuration to use "webhookPaths.conversation" instead.'
      );
      // If conversation isn't explicitly set, use messaging value as fallback
      if (!config.webhookPaths.conversation) {
        webhookPaths.conversation = config.webhookPaths.messaging;
      }
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      webhookPaths,
    };

    // Resolve channels: prefer explicit kwargs, fall back to tac.getChannel()
    this.voiceChannel = config.voiceChannel ?? tac.getChannel<VoiceChannel>('voice');

    // Fail fast at construction if a voice channel is attached but no public
    // URL is configured. Without this check, the misconfiguration would only
    // surface on the first inbound call as a 500 — easy to miss in CI or smoke
    // tests that don't hit voice. Custom adapters (Express/etc.) constructing
    // VoiceChannel directly still get the runtime error on first request.
    if (this.voiceChannel && !tac.getConfig().voicePublicDomain) {
      throw new Error(
        'Voice channel is configured but TACConfig.voicePublicDomain is not set. ' +
          'Set it directly or via the TWILIO_VOICE_PUBLIC_DOMAIN env var.'
      );
    }
    // Unconditional, because the call-event routes register unconditionally
    // (like the TwiML and ConversationRelay routes) — so the collision is real
    // whether or not a voice channel is attached.
    this.validateCallEventPaths();
    this.messagingChannels =
      config.messagingChannels ??
      (
        [
          tac.getChannel<MessagingChannel>('sms'),
          tac.getChannel<MessagingChannel>('rcs'),
          tac.getChannel<MessagingChannel>('chat'),
          tac.getChannel<MessagingChannel>('whatsapp'),
        ] as (MessagingChannel | undefined)[]
      ).filter((ch): ch is MessagingChannel => ch != null);

    // Gather all channels that need webhook processing
    this.webhookChannels = [];
    if (this.voiceChannel) {
      this.webhookChannels.push(this.voiceChannel);
    }
    this.webhookChannels.push(...this.messagingChannels);

    if (this.webhookChannels.length === 0) {
      console.warn(
        'TACServer: No channels configured for webhook processing. Register channels with TAC to enable webhooks.'
      );
    }
    // Use the user-supplied Fastify instance if provided; otherwise create
    // a default one with Pino logging.
    if (config.fastifyInstance) {
      this.fastify = config.fastifyInstance;
    } else {
      this.fastify = Fastify({
        logger: {
          level: process.env.TWILIO_LOG_LEVEL || 'info',
        },
        ...config.fastify,
      });
    }
  }

  /**
   * Validate `voiceCallEventPath`, the one path that isn't literal.
   *
   * Every other TAC path registers as configured, so a bad value is visible.
   * This one expands into three sub-paths, hiding a mistake the base path looks
   * innocent for: a sub-path colliding with another route while the base looks
   * unrelated (base `/hooks` vs `webhookPaths.twiml = '/hooks/status'`). Both
   * would register as POST routes and requests would reach the wrong handler.
   *
   * The leading-slash requirement is enforced by `TACConfigSchema` at parse
   * time, so it doesn't need re-checking here.
   */
  private validateCallEventPaths(): void {
    const cfg = this.tac.getConfig();

    const others: Record<string, string> = {
      [stripTrailingSlash(this.config.webhookPaths.twiml || '/twiml')]: 'webhookPaths.twiml',
      [stripTrailingSlash(cfg.voiceActionPath)]: 'TACConfig.voiceActionPath',
      [stripTrailingSlash(this.config.webhookPaths.conversation || '/webhook')]:
        'webhookPaths.conversation',
    };
    if (this.config.webhookPaths.cintel) {
      others[stripTrailingSlash(this.config.webhookPaths.cintel)] = 'webhookPaths.cintel';
    }

    for (const kind of CALL_EVENT_KINDS) {
      const path = cfg.callEventPath(kind);
      const clash = others[stripTrailingSlash(path)];
      if (clash !== undefined) {
        throw new Error(
          `TACConfig.voiceCallEventPath expands to '${path}', which collides with ` +
            `${clash}. Both would register as POST routes and requests would ` +
            'reach the wrong handler.'
        );
      }
    }
  }

  private getForwardedProto(request: FastifyRequest): string {
    const raw = request.headers['x-forwarded-proto'] as string | undefined;
    return raw?.split(',')[0]?.trim() || 'https';
  }

  private getForwardedHost(request: FastifyRequest): string {
    const raw = (request.headers['x-forwarded-host'] as string | undefined) || request.headers.host;
    return raw?.split(',')[0]?.trim() || '';
  }

  /**
   * Get the full URL for webhook validation
   * Handles X-Forwarded-* headers for proxy/ngrok scenarios
   */
  private getWebhookUrl(request: FastifyRequest): string {
    const proto = this.getForwardedProto(request);
    const host = this.getForwardedHost(request);
    return `${proto}://${host}${request.url}`;
  }

  /**
   * Validate the Twilio signature on an HTTP request. On failure, sends a 403
   * reply (Fastify halts the request once `reply.send` is called in a
   * `preHandler`, so the route handler won't run). Scoped to TAC-registered
   * webhook routes — does not run on user-added routes registered on
   * `server.fastify`.
   */
  private async validateRequestSignature(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const signature = request.headers['x-twilio-signature'] as string;
    const url = this.getWebhookUrl(request);
    const authToken = this.tac.getConfig().authToken;

    let isValid: boolean;
    if (request.url.includes('bodySHA256=')) {
      const body = (request as FastifyRequest & { rawBody?: string }).rawBody ?? '';
      isValid = twilio.validateRequestWithBody(authToken, signature, url, body);
    } else {
      const params = (request.body as Record<string, string>) || {};
      isValid = twilio.validateRequest(authToken, signature, url, params);
    }

    if (!isValid) {
      this.fastify.log.warn({ url, hasSignature: !!signature }, 'Invalid Twilio webhook signature');
      await reply.code(403).send({ error: 'Invalid webhook signature' });
    }
  }

  /**
   * Setup routes
   */
  private async setupRoutes(): Promise<void> {
    const validateSignature = {
      preHandler: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        await this.validateRequestSignature(request, reply);
      },
    };

    // Conversation Orchestrator webhook — fan out to all enabled channels
    if (this.webhookChannels.length > 0) {
      this.fastify.post(
        this.config.webhookPaths.conversation || '/webhook',
        validateSignature,
        async (request: FastifyRequest, reply: FastifyReply) => {
          const rawHeader = request.headers['i-twilio-idempotency-token'];
          const idempotencyToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

          // Fan out to all channels
          for (const channel of this.webhookChannels) {
            channel.processWebhook(request.body, idempotencyToken).catch((err: unknown) => {
              this.fastify.log.error(
                { err, channel: channel.channelType },
                'Webhook processing error'
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
      validateSignature,
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          if (!this.voiceChannel) {
            await reply.code(500).send({ error: 'Voice channel not available' });
            return;
          }

          const voiceChannel = this.voiceChannel;

          // Parse the Twilio webhook form into a framework-neutral TwiMLRequest
          // and hand it to the channel. The channel derives the WebSocket and
          // action URLs from TACConfig (voicePublicDomain + paths), layers in
          // VoiceChannelConfig.defaultTwimlOptions, and runs any per-call
          // customizer registered via voiceChannel.onInboundCallTwiml(...).
          const formDict = (request.body as Record<string, string>) ?? {};
          const twimlRequest = twiMLRequestFromForm(formDict);

          const twiml = await voiceChannel.handleIncomingCall(twimlRequest);

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

    // ConversationRelay callback endpoint. Path lives on TACConfig because the
    // voice channel derives the action URL from it too.
    this.fastify.post(
      this.tac.getConfig().voiceActionPath,
      validateSignature,
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
              { errors: parseResult.error.issues },
              'Invalid ConversationRelay callback payload'
            );
            await reply.code(400).send({ error: 'Invalid payload' });
            return;
          }

          const result = await voiceChannel.handleConversationRelayCallback(parseResult.data);

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

    // One route per Twilio call callback — the route is the discriminator, so
    // each handler parses its own typed event with no payload sniffing. Paths
    // live on TACConfig because the voice channel derives the callback URLs it
    // hands to the Calls API from the same base.
    const callEventHandlers: Record<
      (typeof CALL_EVENT_KINDS)[number],
      (channel: VoiceChannel, form: Record<string, string>) => Promise<CallEventResult>
    > = {
      status: (channel, form) => channel.handleCallStatusEvent(form),
      amd: (channel, form) => channel.handleAmdEvent(form),
      recording: (channel, form) => channel.handleRecordingEvent(form),
    };

    for (const kind of CALL_EVENT_KINDS) {
      const handle = callEventHandlers[kind];
      this.fastify.post(
        this.tac.getConfig().callEventPath(kind),
        validateSignature,
        async (request: FastifyRequest, reply: FastifyReply) => {
          try {
            if (!this.voiceChannel) {
              await reply.code(500).send({ error: 'Voice channel not available' });
              return;
            }

            const formData = (request.body as Record<string, string>) ?? {};
            const result = await handle(this.voiceChannel, formData);

            await reply.code(result.status).type(result.contentType).send(result.content);
          } catch (error) {
            this.fastify.log.error(
              `Call ${kind} callback error: ` +
                (error instanceof Error ? error.message : String(error))
            );
            await reply.code(500).send({ error: 'Internal server error' });
          }
        }
      );
    }

    // Voice WebSocket endpoint. Path lives on TACConfig because the voice
    // channel derives the WebSocket URL from it too.
    await this.fastify.register(fastify => {
      fastify.get(
        this.tac.getConfig().voiceWebsocketPath,
        { websocket: true },
        (socket: WebSocket, request: FastifyRequest) => {
          const signature = request.headers['x-twilio-signature'] as string;
          const authToken = this.tac.getConfig().authToken;

          const proto = this.getForwardedProto(request);
          const host = this.getForwardedHost(request);

          if (!host) {
            this.fastify.log.warn('WebSocket connection rejected: missing host header');
            socket.close(1008, 'Invalid request');
            return;
          }

          const wsProto = proto === 'https' ? 'wss' : 'ws';
          const fullUrl = new URL(`${wsProto}://${host}${request.url}`);
          const params: Record<string, string> = {};
          fullUrl.searchParams.forEach((value, key) => {
            params[key] = value;
          });
          const url = fullUrl.origin + fullUrl.pathname;

          const isValid = twilio.validateRequest(authToken, signature, url, params);

          if (!isValid) {
            this.fastify.log.warn(
              { url, hasSignature: !!signature },
              'WebSocket connection rejected: invalid Twilio signature'
            );
            socket.close(1008, 'Invalid signature');
            return;
          }

          if (!this.voiceChannel) {
            socket.terminate();
            return;
          }

          this.voiceChannel.handleWebSocketConnection(socket);
        }
      );
    });

    // Conversation Intelligence webhook endpoint (optional - only if path is configured)
    if (this.config.webhookPaths.cintel) {
      this.fastify.post(
        this.config.webhookPaths.cintel,
        validateSignature,
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
      // Register required plugins, guarding against users who pre-registered
      // them on a supplied `fastifyInstance` (duplicate registration throws).
      if (!this.fastify.hasContentTypeParser('application/x-www-form-urlencoded')) {
        await this.fastify.register(formbody);
      }
      if (!this.fastify.hasDecorator('websocketServer')) {
        await this.fastify.register(websocket);
      }
      if (!this.fastify.hasDecorator('gracefulShutdown')) {
        await this.fastify.register(gracefulShutdown);
      }

      // Replace the default JSON parser with one that stores the raw body string,
      // needed by validateRequestWithBody for bodySHA256 signature validation.
      const defaultJsonParser = this.fastify.getDefaultJsonParser('error', 'error');
      if (this.fastify.hasContentTypeParser('application/json')) {
        this.fastify.removeContentTypeParser('application/json');
      }
      this.fastify.addContentTypeParser(
        'application/json',
        { parseAs: 'string' },
        (request, body: string, done) => {
          (request as FastifyRequest & { rawBody?: string }).rawBody = body;
          void defaultJsonParser(request, body, done);
        }
      );

      // Set up routes (must be after plugin registration)
      // Signature validation is applied per-route as a `preHandler` so it only
      // runs on TAC-registered webhook routes, not on user-added routes on
      // `server.fastify`.
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
      await this.fastify.listen({
        host: this.config.host,
        port: this.config.port,
      });

      this.fastify.log.info(
        {
          host: this.config.host,
          port: this.config.port,
          conversation_webhook: this.config.webhookPaths.conversation,
          twiml_webhook: this.config.webhookPaths.twiml,
          ws_websocket: this.tac.getConfig().voiceWebsocketPath,
          conversation_relay_callback: this.tac.getConfig().voiceActionPath,
          ...(this.voiceChannel && {
            call_event_callbacks: CALL_EVENT_KINDS.map(kind =>
              this.tac.getConfig().callEventPath(kind)
            ),
          }),
          ...(this.config.webhookPaths.cintel && {
            cintel_webhook: this.config.webhookPaths.cintel,
          }),
        },
        'TAC Server started'
      );
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
