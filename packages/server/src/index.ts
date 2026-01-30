/**
 * Twilio Agent Connect - Server Package
 *
 * Batteries-included Fastify server implementation with out-of-the-box
 * webhook handling, WebSocket support, and production-ready defaults.
 */

// Main server class
export { TACServer } from './lib/server';
export type { TACServerConfig } from './lib/server';


// Re-export from core
export * from '@twilio/tac-core';

// Re-export from tools (TACTool class from tools overrides the interface from core)
export { TACTool, defineTool } from '@twilio/tac-tools';
export type { ToolFunction, JSONSchema } from '@twilio/tac-tools';
