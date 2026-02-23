import { JSONSchema, ToolFunction, MemoryClient, MemoryRetrievalResponse, BaseChannel, ConversationId, TAC, KnowledgeClient, KnowledgeChunkResult } from '@twilio/tac-core';
export { JSONSchema, OpenAITool, ToolContext, ToolExecutionResult, ToolFunction } from '@twilio/tac-core';

/**
 * TAC Tool class with helper methods for LLM integration
 *
 * Matches Python's TACTool dataclass with conversion methods.
 */
declare class TACTool<TParams = any, TResult = any> {
    readonly name: string;
    readonly description: string;
    readonly parameters: JSONSchema;
    readonly implementation: ToolFunction<TParams, TResult>;
    constructor(name: string, description: string, parameters: JSONSchema, implementation: ToolFunction<TParams, TResult>);
    /**
     * Convert to OpenAI function calling format
     */
    toOpenAIFormat(): Record<string, any>;
    /**
     * Convert to Anthropic tool calling format
     */
    toAnthropicFormat(): Record<string, any>;
    /**
     * Convert to JSON string (OpenAI format by default)
     */
    toJSON(): string;
}
/**
 * Create a tool directly with all parameters
 *
 * Simplified approach matching Python's create_tool function.
 * No builder pattern - just a simple function call.
 */
declare function defineTool<TParams = any, TResult = any>(name: string, description: string, parameters: JSONSchema, implementation: ToolFunction<TParams, TResult>): TACTool<TParams, TResult>;

/**
 * Parameters for memory retrieval tool
 */
interface MemoryRetrievalParams {
    query?: string;
    start_date?: string;
    end_date?: string;
    observation_limit?: number;
    summary_limit?: number;
    session_limit?: number;
}
/**
 * Create memory retrieval tool
 */
declare function createMemoryRetrievalTool(memoryClient: MemoryClient, serviceSid: string, profileId?: string): TACTool<MemoryRetrievalParams, MemoryRetrievalResponse>;
/**
 * Create factory function for memory tools
 */
declare function createMemoryTools(memoryClient: MemoryClient, serviceSid: string): {
    forProfile: (profileId: string) => TACTool<MemoryRetrievalParams, MemoryRetrievalResponse>;
    forSession: (profileId?: string) => TACTool<MemoryRetrievalParams, MemoryRetrievalResponse>;
};

/**
 * Parameters for send message tool
 */
interface SendMessageParams {
    message: string;
    metadata?: Record<string, unknown>;
}
/**
 * Result from send message tool
 */
interface SendMessageResult {
    success: boolean;
    message_id?: string;
    error?: string;
}
/**
 * Create send message tool
 */
declare function createSendMessageTool(channel: BaseChannel, conversationId: ConversationId): TACTool<SendMessageParams, SendMessageResult>;
/**
 * Create factory function for messaging tools
 */
declare function createMessagingTools(): {
    /**
     * Create send message tool for specific channel and conversation
     */
    forConversation: (channel: BaseChannel, conversationId: ConversationId) => TACTool<SendMessageParams, SendMessageResult>;
};

/**
 * Parameters for handoff tool
 */
interface HandoffParams {
    reason: string;
    urgency?: 'low' | 'medium' | 'high';
    context?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Result from handoff tool
 */
interface HandoffResult {
    success: boolean;
    handoff_id: string;
    estimated_wait_time?: string;
    error?: string;
}
/**
 * Create human handoff tool
 */
declare function createHandoffTool(tac: TAC, conversationId: ConversationId): TACTool<HandoffParams, HandoffResult>;
/**
 * Create factory function for handoff tools
 */
declare function createHandoffTools(): {
    /**
     * Create handoff tool for specific TAC instance and conversation
     */
    forConversation: (tac: TAC, conversationId: ConversationId) => TACTool<HandoffParams, HandoffResult>;
};

/**
 * Parameters for knowledge search tool (visible to LLM)
 */
interface KnowledgeSearchParams {
    query: string;
}
/**
 * Configuration for knowledge search tool
 */
interface KnowledgeToolConfig {
    name?: string;
    description?: string;
    topK?: number;
}
/**
 * Create knowledge search tool with explicit name and description
 *
 * @param knowledgeClient - The Knowledge client instance
 * @param knowledgeBaseId - The knowledge base ID to search
 * @param config - Configuration with required name and description
 * @returns TACTool configured for knowledge search
 */
declare function createKnowledgeSearchTool(knowledgeClient: KnowledgeClient, knowledgeBaseId: string, config: {
    name: string;
    description: string;
    topK?: number;
}): TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>;
/**
 * Create knowledge search tool with auto-fetched metadata from knowledge base
 *
 * This async version fetches the knowledge base metadata to auto-generate
 * the tool name and description if not provided.
 *
 * @param knowledgeClient - The Knowledge client instance
 * @param knowledgeBaseId - The knowledge base ID to search
 * @param config - Optional configuration (name/description auto-generated if not provided)
 * @returns Promise containing TACTool configured for knowledge search
 */
declare function createKnowledgeSearchToolAsync(knowledgeClient: KnowledgeClient, knowledgeBaseId: string, config?: KnowledgeToolConfig): Promise<TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>>;
/**
 * Create factory for knowledge tools
 *
 * @param knowledgeClient - The Knowledge client instance
 * @returns Factory object with methods to create knowledge tools
 */
declare function createKnowledgeTools(knowledgeClient: KnowledgeClient): {
    forKnowledgeBase: (knowledgeBaseId: string, config: {
        name: string;
        description: string;
        topK?: number;
    }) => TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>;
    forKnowledgeBaseAsync: (knowledgeBaseId: string, config?: KnowledgeToolConfig) => Promise<TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>>;
};

export { TACTool, createHandoffTool, createHandoffTools, createKnowledgeSearchTool, createKnowledgeSearchToolAsync, createKnowledgeTools, createMemoryRetrievalTool, createMemoryTools, createMessagingTools, createSendMessageTool, defineTool };
