import { ToolFunction, JSONSchema } from '@twilio/tac-core';

/**
 * TAC Tool class with helper methods for LLM integration
 *
 * Matches Python's TACTool dataclass with conversion methods.
 */
export class TACTool<TParams = any, TResult = any> {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly parameters: JSONSchema,
    public readonly implementation: ToolFunction<TParams, TResult>
  ) {}

  /**
   * Convert to OpenAI function calling format
   */
  toOpenAIFormat(): Record<string, any> {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }

  /**
   * Convert to Anthropic tool calling format
   */
  toAnthropicFormat(): Record<string, any> {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.parameters,
    };
  }

  /**
   * Convert to JSON string (OpenAI format by default)
   */
  toJSON(): string {
    return JSON.stringify(this.toOpenAIFormat(), null, 2);
  }
}

/**
 * Create a tool directly with all parameters
 *
 * Simplified approach matching Python's create_tool function.
 * No builder pattern - just a simple function call.
 */
export function defineTool<TParams = any, TResult = any>(
  name: string,
  description: string,
  parameters: JSONSchema,
  implementation: ToolFunction<TParams, TResult>
): TACTool<TParams, TResult> {
  if (!name) {
    throw new Error('Tool name is required');
  }

  if (!description) {
    throw new Error('Tool description is required');
  }

  if (!parameters) {
    throw new Error('Tool parameters schema is required');
  }

  if (!implementation) {
    throw new Error('Tool implementation is required');
  }

  return new TACTool(name, description, parameters, implementation);
}
