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

  /**
   * Convert this tool to an OpenAI Agents SDK `FunctionTool` instance.
   *
   * Unlike `toOpenAIFormat` and `toAnthropicFormat` (which return plain
   * objects consumed by HTTP APIs), the OpenAI Agents SDK dispatches on tool
   * *type*, so this returns a live `tool(...)` object with an invoke callback
   * that calls this tool and JSON-encodes the result.
   *
   * Requires the `@openai/agents` package:
   *
   *     npm install @openai/agents
   *
   * @returns A FunctionTool ready to pass to `new Agent({ tools: [...] })`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Return type depends on an optional peer dep we don't declare
  async toOpenAIAgentsSDKTool(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Optional peer dep: dynamic import, can't declare types
    let agentsModule: any;
    try {
      // Dynamic import of an optional peer dependency. The indirection via a
      // string variable keeps TypeScript from trying to resolve the module
      // at compile time (it isn't a declared dependency).
      const moduleSpec = '@openai/agents';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Dynamic optional-dep import
      agentsModule = await import(/* @vite-ignore */ moduleSpec);
    } catch {
      throw new Error(
        'toOpenAIAgentsSDKTool() requires the @openai/agents package. ' +
          'Install with: npm install @openai/agents'
      );
    }

    const impl = this.implementation;
    // The Agents SDK's `JsonObjectSchemaNonStrict` requires `additionalProperties: true`
    // (and `Strict` requires `: false`). Our schema sets neither by default, so normalize
    // for the non-strict path we're opting into.
    const parameters = {
      ...this.parameters,
      additionalProperties: true,
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call -- Optional peer dep
    return agentsModule.tool({
      name: this.name,
      description: this.description,
      parameters,
      // Disable strict mode: the Agents SDK's strict JSON schema rejects
      // some features TAC emits (e.g. unions, top-level description).
      strict: false,
      execute: async (args: unknown): Promise<string> => {
        const result = await impl(args as TParams);
        return JSON.stringify(result);
      },
    });
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
