import { z } from 'zod';

/**
 * JSON Schema definition for tool parameters
 */
export const JSONSchemaSchema = z.object({
  type: z.enum(['object', 'string', 'number', 'boolean', 'array']),
  properties: z.record(z.any()).optional(),
  required: z.array(z.string()).optional(),
  items: z.any().optional(),
  enum: z.array(z.any()).optional(),
  description: z.string().optional(),
});

export type JSONSchema = z.infer<typeof JSONSchemaSchema>;

/**
 * Tool function signature
 */
export type ToolFunction<TParams = any, TResult = any> = (
  params: TParams
) => Promise<TResult> | TResult;

/**
 * Core tool definition
 */
export interface TACTool<TParams = any, TResult = any> {
  name: string;
  description: string;
  parameters: JSONSchema;
  implementation: ToolFunction<TParams, TResult>;
}

/**
 * OpenAI tool format
 */
export const OpenAIToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string(),
    parameters: JSONSchemaSchema,
  }),
});

export type OpenAITool = z.infer<typeof OpenAIToolSchema>;

/**
 * Tool execution context
 */
export interface ToolContext {
  conversationId?: string;
  profileId?: string;
  channel?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool execution result
 */
export const ToolExecutionResultSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ToolExecutionResult = z.infer<typeof ToolExecutionResultSchema>;

/**
 * Built-in tool types
 */
export const BuiltInTools = {
  RETRIEVE_MEMORY: 'retrieve_profile_memory',
  SEND_MESSAGE: 'send_message',
  ESCALATE_TO_HUMAN: 'escalate_to_human',
  SEARCH_KNOWLEDGE: 'search_knowledge',
} as const;

export type BuiltInToolName = (typeof BuiltInTools)[keyof typeof BuiltInTools];
