import { BuiltInTools } from '@twilio/tac-core';

// src/lib/builder.ts
var TACTool = class {
  constructor(name, description, parameters, implementation) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.implementation = implementation;
  }
  /**
   * Convert to OpenAI function calling format
   */
  toOpenAIFormat() {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      }
    };
  }
  /**
   * Convert to Anthropic tool calling format
   */
  toAnthropicFormat() {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.parameters
    };
  }
  /**
   * Convert to JSON string (OpenAI format by default)
   */
  toJSON() {
    return JSON.stringify(this.toOpenAIFormat(), null, 2);
  }
};
function defineTool(name, description, parameters, implementation) {
  if (!name) {
    throw new Error("Tool name is required");
  }
  if (!description) {
    throw new Error("Tool description is required");
  }
  if (!parameters) {
    throw new Error("Tool parameters schema is required");
  }
  if (!implementation) {
    throw new Error("Tool implementation is required");
  }
  return new TACTool(name, description, parameters, implementation);
}
function createMemoryRetrievalTool(memoryClient, serviceSid, profileId) {
  return defineTool(
    BuiltInTools.RETRIEVE_MEMORY,
    "Retrieve user memories including observations, summaries, and conversation history",
    {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional semantic search query to filter memories"
        },
        start_date: {
          type: "string",
          description: "Optional start date for filtering memories (ISO 8601 format)"
        },
        end_date: {
          type: "string",
          description: "Optional end date for filtering memories (ISO 8601 format)"
        },
        observation_limit: {
          type: "number",
          description: "Maximum number of observations to retrieve (default: 10)"
        },
        summary_limit: {
          type: "number",
          description: "Maximum number of summaries to retrieve (default: 5)"
        },
        session_limit: {
          type: "number",
          description: "Maximum number of sessions to retrieve (default: 3)"
        }
      },
      required: [],
      // No required parameters
      description: "Retrieve memories for the current user"
    },
    async (params) => {
      if (!profileId) {
        throw new Error("No profile ID available for memory retrieval");
      }
      const request = {
        query: params.query,
        start_date: params.start_date,
        end_date: params.end_date,
        observation_limit: params.observation_limit ?? 10,
        summary_limit: params.summary_limit ?? 5,
        session_limit: params.session_limit ?? 3
      };
      return memoryClient.retrieveMemories(serviceSid, profileId, request);
    }
  );
}
function createMemoryTools(memoryClient, serviceSid) {
  return {
    /**
     * Create memory tool for specific profile
     */
    forProfile: (profileId) => createMemoryRetrievalTool(memoryClient, serviceSid, profileId),
    /**
     * Create memory tool for current session
     */
    forSession: (profileId) => createMemoryRetrievalTool(memoryClient, serviceSid, profileId)
  };
}
function createSendMessageTool(channel, conversationId) {
  return defineTool(
    BuiltInTools.SEND_MESSAGE,
    "Send a message to the user in the current conversation",
    {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message content to send to the user"
        },
        metadata: {
          type: "object",
          description: "Optional metadata to include with the message"
        }
      },
      required: ["message"],
      description: "Send a message to the user"
    },
    async (params) => {
      try {
        await channel.sendResponse(conversationId, params.message, params.metadata);
        return {
          success: true,
          message_id: `msg_${Date.now()}`
          // Simple ID generation
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );
}
function createMessagingTools() {
  return {
    /**
     * Create send message tool for specific channel and conversation
     */
    forConversation: (channel, conversationId) => createSendMessageTool(channel, conversationId)
  };
}
function createHandoffTool(tac, conversationId) {
  return defineTool(
    BuiltInTools.ESCALATE_TO_HUMAN,
    "Escalate the conversation to a human agent when the AI cannot help further",
    {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "The reason for escalating to a human agent"
        },
        urgency: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "The urgency level of the handoff (default: medium)"
        },
        context: {
          type: "string",
          description: "Additional context to provide to the human agent"
        },
        metadata: {
          type: "object",
          description: "Optional metadata for the handoff"
        }
      },
      required: ["reason"],
      description: "Escalate to human agent"
    },
    async (params) => {
      try {
        let fullReason = params.reason;
        if (params.context) {
          fullReason += `

Additional Context: ${params.context}`;
        }
        if (params.urgency) {
          fullReason += `

Urgency: ${params.urgency}`;
        }
        await tac.triggerHandoff(conversationId, fullReason);
        return {
          success: true,
          handoff_id: `handoff_${Date.now()}`,
          estimated_wait_time: getEstimatedWaitTime(params.urgency ?? "medium")
        };
      } catch (error) {
        return {
          success: false,
          handoff_id: `failed_${Date.now()}`,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );
}
function getEstimatedWaitTime(urgency) {
  switch (urgency) {
    case "high":
      return "< 2 minutes";
    case "medium":
      return "2-5 minutes";
    case "low":
      return "5-10 minutes";
    default:
      return "2-5 minutes";
  }
}
function createHandoffTools() {
  return {
    /**
     * Create handoff tool for specific TAC instance and conversation
     */
    forConversation: (tac, conversationId) => createHandoffTool(tac, conversationId)
  };
}

export { TACTool, createHandoffTool, createHandoffTools, createMemoryRetrievalTool, createMemoryTools, createMessagingTools, createSendMessageTool, defineTool };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map