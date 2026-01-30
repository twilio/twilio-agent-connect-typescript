import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import gracefulShutdown from 'fastify-graceful-shutdown';
import twilio from 'twilio';
import { ConversationRelayCallbackPayloadSchema, VoiceServerConfigSchema } from '@twilio/tac-core';
export * from '@twilio/tac-core';
export { TACTool, defineTool } from '@twilio/tac-tools';

// src/lib/server.ts
var DEFAULT_CONFIG = {
  voice: {
    host: "0.0.0.0",
    port: 3e3,
    path: "/twiml",
    webhookPath: "/voice"
  },
  webhookPaths: {
    sms: "/sms",
    voice: "/voice",
    twiml: "/twiml",
    conversationRelayCallback: "/conversation-relay-callback"
  },
  development: false,
  validateWebhooks: true
};
var TACServer = class {
  fastify;
  tac;
  config;
  constructor(tac, config = {}) {
    this.tac = tac;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.fastify = Fastify({
      logger: this.config.development ? {
        level: process.env.LOG_LEVEL || "info",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true
          }
        }
      } : {
        level: process.env.LOG_LEVEL || "info"
      },
      ...config.fastify
    });
  }
  /**
   * Get the full URL for webhook validation
   * Handles X-Forwarded-* headers for proxy/ngrok scenarios
   */
  getWebhookUrl(request) {
    const proto = request.headers["x-forwarded-proto"] || "https";
    const host = request.headers["x-forwarded-host"] || request.headers.host || "";
    return `${proto}://${host}${request.url}`;
  }
  /**
   * Register global Twilio webhook signature validation hook
   */
  registerWebhookValidation() {
    if (!this.config.validateWebhooks) {
      return;
    }
    this.fastify.addHook("preHandler", (request, reply, done) => {
      if (request.method === "GET") {
        done();
        return;
      }
      const signature = request.headers["x-twilio-signature"];
      const url = this.getWebhookUrl(request);
      const authToken = this.tac.getConfig().twilioAuthToken;
      let isValid;
      if (request.url.includes("bodySHA256=")) {
        const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
        isValid = twilio.validateRequestWithBody(authToken, signature, url, body);
      } else {
        const params = request.body || {};
        isValid = twilio.validateRequest(authToken, signature, url, params);
      }
      if (!isValid) {
        this.fastify.log.warn(
          { url, hasSignature: !!signature },
          "Invalid Twilio webhook signature"
        );
        void reply.code(403).send({ error: "Invalid webhook signature" });
        done();
        return;
      }
      done();
    });
  }
  /**
   * Setup routes
   */
  async setupRoutes() {
    this.fastify.post(
      this.config.webhookPaths.sms || "/sms",
      async (request, reply) => {
        try {
          const smsChannel = this.tac.getChannel("sms");
          if (!smsChannel) {
            await reply.code(500).send({ error: "SMS channel not available" });
            return;
          }
          await smsChannel.processWebhook(request.body);
          await reply.code(200).send({ status: "ok" });
        } catch (error) {
          this.fastify.log.error(
            "SMS webhook error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    );
    this.fastify.post(
      this.config.webhookPaths.twiml || "/twiml",
      async (request, reply) => {
        try {
          const voiceChannel = this.tac.getChannel("voice");
          if (!voiceChannel) {
            await reply.code(500).send({ error: "Voice channel not available" });
            return;
          }
          const formData = request.body;
          const fromNumber = formData["From"] || "";
          const toNumber = formData["To"] || "";
          const callSid = formData["CallSid"] || "";
          const protocol = request.headers["x-forwarded-proto"] || "http";
          const host = request.headers.host;
          const websocketUrl = `${protocol === "https" ? "wss" : "ws"}://${host}${this.config.webhookPaths.voice || "/voice"}`;
          const callbackUrl = `${protocol}://${host}${this.config.webhookPaths.conversationRelayCallback || "/conversation-relay-callback"}`;
          const twiml = await voiceChannel.handleIncomingCall({
            websocketUrl,
            toNumber,
            fromNumber,
            callSid,
            actionUrl: callbackUrl,
            ...this.config.welcomeGreeting && { welcomeGreeting: this.config.welcomeGreeting }
          });
          await reply.type("application/xml").send(twiml);
        } catch (error) {
          this.fastify.log.error(
            "TwiML generation error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    );
    this.fastify.post(
      this.config.webhookPaths.conversationRelayCallback || "/conversation-relay-callback",
      async (request, reply) => {
        try {
          const voiceChannel = this.tac.getChannel("voice");
          if (!voiceChannel) {
            await reply.code(500).send({ error: "Voice channel not available" });
            return;
          }
          const formData = request.body;
          const parseResult = ConversationRelayCallbackPayloadSchema.safeParse(formData);
          if (!parseResult.success) {
            this.fastify.log.error(
              { errors: parseResult.error.errors },
              "Invalid ConversationRelay callback payload"
            );
            await reply.code(400).send({ error: "Invalid payload" });
            return;
          }
          const result = await voiceChannel.handleConversationRelayCallback(
            parseResult.data,
            this.config.handoffHandler
          );
          await reply.code(result.status).type(result.contentType).send(result.content);
        } catch (error) {
          this.fastify.log.error(
            "ConversationRelay callback error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({ error: "Internal server error" });
        }
      }
    );
    await this.fastify.register((fastify) => {
      fastify.get(
        this.config.webhookPaths.voice || "/voice",
        { websocket: true },
        (socket) => {
          const voiceChannel = this.tac.getChannel("voice");
          if (!voiceChannel) {
            socket.terminate();
            return;
          }
          voiceChannel.handleWebSocketConnection(socket);
        }
      );
    });
    if (this.config.webhookPaths.cintel) {
      this.fastify.post(
        this.config.webhookPaths.cintel,
        async (request, reply) => {
          if (!this.tac.isCintelEnabled()) {
            await reply.code(400).send({
              error: "Conversation Intelligence is not enabled",
              message: "Set TWILIO_TAC_CI_CONFIGURATION_ID and memory credentials to enable CI processing"
            });
            return;
          }
          try {
            this.fastify.log.info("Processing Conversation Intelligence webhook");
            const result = await this.tac.processCintelEvent(request.body);
            if (result.success) {
              if (result.skipped) {
                this.fastify.log.debug({ reason: result.skipReason }, "CI event skipped");
              } else {
                this.fastify.log.info(
                  { eventType: result.eventType, createdCount: result.createdCount },
                  "CI event processed"
                );
              }
            } else {
              this.fastify.log.error({ error: result.error }, "CI event processing failed");
            }
            await reply.send(result);
          } catch (error) {
            this.fastify.log.error(
              "CI webhook error: " + (error instanceof Error ? error.message : String(error))
            );
            await reply.code(500).send({
              success: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  }
  /**
   * Start the server
   */
  async start() {
    try {
      await this.fastify.register(formbody);
      await this.fastify.register(websocket);
      await this.fastify.register(gracefulShutdown);
      this.registerWebhookValidation();
      await this.setupRoutes();
      this.fastify.gracefulShutdown(async (signal) => {
        this.fastify.log.info({ signal }, "Received shutdown signal");
        await this.waitForWebSocketsToClose();
        this.tac.shutdown();
      });
      const voiceConfig = VoiceServerConfigSchema.parse(this.config.voice);
      await this.fastify.listen({
        host: voiceConfig.host,
        port: voiceConfig.port
      });
      this.fastify.log.info(
        {
          host: voiceConfig.host,
          port: voiceConfig.port,
          sms_webhook: this.config.webhookPaths.sms,
          twiml_path: this.config.webhookPaths.twiml,
          voice_websocket: this.config.webhookPaths.voice,
          conversation_relay_callback: this.config.webhookPaths.conversationRelayCallback,
          ...this.config.webhookPaths.cintel && {
            cintel_webhook: this.config.webhookPaths.cintel
          },
          webhook_validation: this.config.validateWebhooks ? "enabled" : "disabled"
        },
        "TAC Server started"
      );
      if (!this.config.validateWebhooks) {
        this.fastify.log.warn(
          "Webhook signature validation is DISABLED. Enable in production for security."
        );
      }
    } catch (error) {
      this.fastify.log.error({ err: error }, "Failed to start TAC Server");
      throw error;
    }
  }
  /**
   * Wait for all WebSocket connections to close
   */
  async waitForWebSocketsToClose(timeoutMs = 3e4) {
    const wsServer = this.fastify.websocketServer;
    if (!wsServer || wsServer.clients.size === 0) {
      return;
    }
    this.fastify.log.info(
      { websocket_count: wsServer.clients.size },
      "Waiting for WebSocket connections to close..."
    );
    const startTime = Date.now();
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const clientCount = wsServer.clients.size;
        if (clientCount === 0) {
          clearInterval(checkInterval);
          this.fastify.log.info("All WebSocket connections closed");
          resolve();
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          this.fastify.log.warn(
            { remaining_websockets: clientCount },
            "Timeout waiting for WebSockets to close, proceeding with shutdown"
          );
          resolve();
          return;
        }
        this.fastify.log.info(
          { remaining_websockets: clientCount },
          "Waiting for WebSockets to close..."
        );
      }, 5e3);
    });
  }
  /**
   * Stop the server gracefully
   */
  async stop() {
    try {
      await this.fastify.close();
      this.fastify.log.info("TAC Server stopped");
    } catch (error) {
      this.fastify.log.error({ err: error }, "Error stopping TAC Server");
      throw error;
    }
  }
};

export { TACServer };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map