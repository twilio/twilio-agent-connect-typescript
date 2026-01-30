import { FastifyServerOptions } from 'fastify';
import { TAC, VoiceServerConfig, ConversationRelayCallbackPayload } from '@twilio/tac-core';
export * from '@twilio/tac-core';
export { JSONSchema, TACTool, ToolFunction, defineTool } from '@twilio/tac-tools';

/**
 * Server configuration options
 */
interface TACServerConfig {
    /** Fastify server options */
    fastify?: FastifyServerOptions;
    /** Voice server configuration */
    voice?: Partial<VoiceServerConfig>;
    /** Custom webhook paths */
    webhookPaths?: {
        sms?: string;
        voice?: string;
        twiml?: string;
        conversationRelayCallback?: string;
        /** Path for Conversation Intelligence webhook (optional - only registered if provided) */
        cintel?: string;
    };
    /** Welcome greeting for voice calls (played when call connects) */
    welcomeGreeting?: string;
    /** Handler for voice handoff requests (returns TwiML string) */
    handoffHandler?: (payload: ConversationRelayCallbackPayload) => Promise<string>;
    /** Enable development features */
    development?: boolean;
    /** Enable Twilio webhook signature validation (default: true) */
    validateWebhooks?: boolean;
}
/**
 * Batteries-included Fastify server for TAC
 *
 * Provides out-of-the-box setup for SMS and Voice channels with
 * proper webhook handling, WebSocket support, and production-ready defaults.
 */
declare class TACServer {
    private readonly fastify;
    private readonly tac;
    private readonly config;
    constructor(tac: TAC, config?: TACServerConfig);
    /**
     * Get the full URL for webhook validation
     * Handles X-Forwarded-* headers for proxy/ngrok scenarios
     */
    private getWebhookUrl;
    /**
     * Register global Twilio webhook signature validation hook
     */
    private registerWebhookValidation;
    /**
     * Setup routes
     */
    private setupRoutes;
    /**
     * Start the server
     */
    start(): Promise<void>;
    /**
     * Wait for all WebSocket connections to close
     */
    private waitForWebSocketsToClose;
    /**
     * Stop the server gracefully
     */
    stop(): Promise<void>;
}

export { TACServer, type TACServerConfig };
