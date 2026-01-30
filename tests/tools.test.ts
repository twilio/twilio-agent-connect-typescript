import { describe, it, expect } from 'vitest';
import { defineTool } from '@twilio/tac-tools';

describe('Tool System', () => {
  describe('defineTool', () => {
    it('should create a tool with basic parameters', () => {
      const tool = defineTool(
        'test_tool',
        'A test tool',
        {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message to process'
            }
          },
          required: ['message'],
          description: 'Test tool parameters'
        },
        async (params: { message: string }) => {
          return `Processed: ${params.message}`;
        }
      );

      expect(tool.name).toBe('test_tool');
      expect(tool.description).toBe('A test tool');
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties.message.type).toBe('string');
      expect(tool.parameters.required).toContain('message');
    });

    it('should execute tool implementation', async () => {
      const tool = defineTool(
        'echo_tool',
        'Echoes input',
        {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to echo' }
          },
          required: ['text'],
          description: 'Echo parameters'
        },
        async (params: { text: string }) => {
          return `Echo: ${params.text}`;
        }
      );

      const result = await tool.implementation({ text: 'hello world' });
      expect(result).toBe('Echo: hello world');
    });

    it('should handle multiple parameter types', () => {
      const tool = defineTool(
        'multi_param_tool',
        'Tool with multiple parameters',
        {
          type: 'object',
          properties: {
            stringParam: { type: 'string', description: 'A string parameter' },
            numberParam: { type: 'number', description: 'A number parameter' },
            booleanParam: { type: 'boolean', description: 'A boolean parameter' },
            arrayParam: {
              type: 'array',
              items: { type: 'string' },
              description: 'An array parameter'
            }
          },
          required: ['stringParam', 'numberParam'],
          description: 'Multi-parameter tool'
        },
        async (params) => params
      );

      expect(tool.parameters.properties.stringParam.type).toBe('string');
      expect(tool.parameters.properties.numberParam.type).toBe('number');
      expect(tool.parameters.properties.booleanParam.type).toBe('boolean');
      expect(tool.parameters.properties.arrayParam.type).toBe('array');
      expect(tool.parameters.required).toEqual(['stringParam', 'numberParam']);
    });

    it('should handle optional parameters', () => {
      const tool = defineTool(
        'optional_tool',
        'Tool with optional params',
        {
          type: 'object',
          properties: {
            required_param: { type: 'string', description: 'Required parameter' },
            optional_param: { type: 'string', description: 'Optional parameter' }
          },
          required: ['required_param'],
          description: 'Tool with optional parameters'
        },
        async (params) => params
      );

      expect(tool.parameters.required).toEqual(['required_param']);
      expect(tool.parameters.required).not.toContain('optional_param');
    });

    it('should handle enum parameters', () => {
      const tool = defineTool(
        'enum_tool',
        'Tool with enum parameter',
        {
          type: 'object',
          properties: {
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'Priority level'
            }
          },
          required: ['priority'],
          description: 'Tool with enum parameter'
        },
        async (params) => params
      );

      expect(tool.parameters.properties.priority.enum).toEqual(['low', 'medium', 'high']);
    });
  });

  describe('tool validation', () => {
    it('should create valid JSON schema', () => {
      const tool = defineTool(
        'schema_tool',
        'Tool for schema testing',
        {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name field' },
            age: { type: 'number', description: 'Age field' },
            active: { type: 'boolean', description: 'Active status' }
          },
          required: ['name'],
          description: 'Schema validation tool'
        },
        async (params) => params
      );

      // Verify schema structure
      expect(tool.parameters).toMatchObject({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          active: { type: 'boolean' }
        },
        required: ['name']
      });
    });
  });

  describe('tool execution', () => {
    it('should handle sync and async implementations', async () => {
      const syncTool = defineTool(
        'sync_tool',
        'Synchronous tool',
        {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Value to double' }
          },
          required: ['value'],
          description: 'Sync tool parameters'
        },
        (params: { value: number }) => params.value * 2
      );

      const asyncTool = defineTool(
        'async_tool',
        'Asynchronous tool',
        {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Value to triple' }
          },
          required: ['value'],
          description: 'Async tool parameters'
        },
        async (params: { value: number }) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          return params.value * 3;
        }
      );

      // Both should work with await
      const syncResult = await syncTool.implementation({ value: 5 });
      const asyncResult = await asyncTool.implementation({ value: 5 });

      expect(syncResult).toBe(10);
      expect(asyncResult).toBe(15);
    });
  });

  describe('TACTool helper methods', () => {
    it('should convert to OpenAI format', () => {
      const tool = defineTool(
        'test_tool',
        'A test tool',
        {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Test message' }
          },
          required: ['message'],
          description: 'Test parameters'
        },
        async (params: { message: string }) => params.message
      );

      const openaiFormat = tool.toOpenAIFormat();

      expect(openaiFormat).toEqual({
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Test message' }
            },
            required: ['message'],
            description: 'Test parameters'
          }
        }
      });
    });

    it('should convert to Anthropic format', () => {
      const tool = defineTool(
        'test_tool',
        'A test tool',
        {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Test message' }
          },
          required: ['message'],
          description: 'Test parameters'
        },
        async (params: { message: string }) => params.message
      );

      const anthropicFormat = tool.toAnthropicFormat();

      expect(anthropicFormat).toEqual({
        name: 'test_tool',
        description: 'A test tool',
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Test message' }
          },
          required: ['message'],
          description: 'Test parameters'
        }
      });
    });

    it('should convert to JSON string', () => {
      const tool = defineTool(
        'test_tool',
        'A test tool',
        {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Test message' }
          },
          required: ['message'],
          description: 'Test parameters'
        },
        async (params: { message: string }) => params.message
      );

      const json = tool.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe('function');
      expect(parsed.function.name).toBe('test_tool');
      expect(parsed.function.description).toBe('A test tool');
    });
  });
});