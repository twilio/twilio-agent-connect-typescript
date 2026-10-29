import { BuiltInTools, ConversationId, ConversationSession, BaseChannel } from '@twilio/tac-core';
import { TACTool, defineTool } from '../lib/builder';

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
 *
 * **Pass the session, not the id.** Hand in the `ConversationSession` that
 * `onMessageReady` gave you and every send reuses it as-is. A bare id still
 * works, but messaging channels keep no sessions, so each send spends a
 * `listParticipants` call rebuilding one — and on chat, where the customer
 * stays `UNKNOWN`, that rebuild resolves no recipient and the send fails.
 *
 * @param channel - Channel to send through.
 * @param conversationIdOrSession - The `ConversationSession` to reply within
 * (preferred), or the conversation id.
 */
export function createSendMessageTool(
  channel: BaseChannel,
  conversationIdOrSession: ConversationId | ConversationSession
): TACTool<SendMessageParams, SendMessageResult> {
  return defineTool(
    BuiltInTools.SEND_MESSAGE,
    'Send a message to the user in the current conversation',
    {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message content to send to the user',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata to include with the message',
        },
      },
      required: ['message'],
      description: 'Send a message to the user',
    },
    async (params: SendMessageParams) => {
      try {
        await channel.sendResponse(conversationIdOrSession, params.message, params.metadata);

        return {
          success: true,
          message_id: `msg_${Date.now()}`, // Simple ID generation
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}

/**
 * Create factory function for messaging tools
 */
export function createMessagingTools(): {
  forConversation: (
    channel: BaseChannel,
    conversationIdOrSession: ConversationId | ConversationSession
  ) => TACTool<SendMessageParams, SendMessageResult>;
} {
  return {
    /**
     * Create send message tool for specific channel and conversation. Prefer
     * passing the turn's `ConversationSession` (see {@link createSendMessageTool}).
     */
    forConversation: (
      channel: BaseChannel,
      conversationIdOrSession: ConversationId | ConversationSession
    ) => createSendMessageTool(channel, conversationIdOrSession),
  };
}
