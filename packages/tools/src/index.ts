/**
 * Twilio Agent Connect - Tools Package
 *
 * Simple tool system for building LLM-powered agents.
 * Matches Python's straightforward approach without over-engineering.
 */

// TAC Tool class and creation function (matches Python's TACTool and create_tool)
export { TACTool, defineTool } from './lib/builder';

// Built-in tools
export { createMemoryRetrievalTool, createMemoryTools } from './built-in/memory';
export { createSendMessageTool, createMessagingTools } from './built-in/messaging';
export { createHandoffTool, createHandoffTools } from './built-in/handoff';

// Re-export types from the core package (excluding TACTool which we define here)
export type {
  ToolFunction,
  JSONSchema,
  OpenAITool,
  ToolContext,
  ToolExecutionResult,
} from '@twilio/tac-core';
