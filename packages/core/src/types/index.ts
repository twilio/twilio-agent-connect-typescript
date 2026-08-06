/**
 * Twilio Agent Connect - Core Types
 *
 * This module provides all TypeScript types and Zod schemas used
 * throughout the Twilio Agent Connect.
 */

// Configuration types
export * from './config';

// Memory types
export * from './memory';

// Conversation types
export * from './conversation';

// ConversationRelay types (Twilio Voice API)
export * from './crelay';

// Handoff types
export * from './handoff';

// Tool types (TACTool interface excluded — use the TACTool class from the tools package)
export {
  JSONSchemaSchema,
  type JSONSchema,
  type ToolFunction,
  OpenAIToolSchema,
  type OpenAITool,
  AnthropicToolSchema,
  type AnthropicTool,
  type ToolContext,
  ToolExecutionResultSchema,
  type ToolExecutionResult,
  BuiltInTools,
  type BuiltInToolName,
} from './tools';

// Conversation Intelligence types
export * from './cintel';

// TAC unified response types
export * from './tac';

// Knowledge types
export * from './knowledge';

// Re-export Zod for convenience
export { z } from 'zod';
