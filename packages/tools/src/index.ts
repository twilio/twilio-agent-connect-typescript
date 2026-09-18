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
export {
  createStudioHandoffTool,
  buildHandoffPayload,
  postStudioHandoff,
  studioExecutionsUrl,
  studioVoiceHandoffUrl,
  type HandoffResult,
} from './built-in/handoff';
export {
  createKnowledgeSearchTool,
  createKnowledgeSearchToolAsync,
  createKnowledgeTools,
} from './built-in/knowledge';

// Guardrails
export { GuardrailError } from './lib/errors';
