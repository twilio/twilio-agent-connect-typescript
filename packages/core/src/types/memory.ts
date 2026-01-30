import { z } from 'zod';
import { CommunicationSchema } from './conversation';

/**
 * Message direction in a conversation
 */
export const MessageDirectionSchema = z.enum(['inbound', 'outbound']);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

/**
 * Individual session message
 */
export const SessionMessageSchema = z.object({
  direction: MessageDirectionSchema,
  channel: z.string(),
  from_address: z.string().optional(),
  to_address: z.string().optional(),
  content: z.string(),
  timestamp: z.string().datetime(),
});

export type SessionMessage = z.infer<typeof SessionMessageSchema>;

/**
 * Session information containing conversation history
 */
export const SessionInfoSchema = z.object({
  session_id: z.string(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
  channel: z.string(),
  messages: z.array(SessionMessageSchema),
});

export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/**
 * Individual observation extracted from conversations
 */
export const ObservationInfoSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  occurredAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  conversationIds: z.array(z.string()).nullable().optional(),
  source: z.string().optional(),
});

export type ObservationInfo = z.infer<typeof ObservationInfoSchema>;

/**
 * Conversation summary information
 */
export const SummaryInfoSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  conversationIds: z.array(z.string()).optional(),
});

export type SummaryInfo = z.infer<typeof SummaryInfoSchema>;

/**
 * Memory retrieval request parameters
 */
export const MemoryRetrievalRequestSchema = z.object({
  query: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  observation_limit: z.number().int().positive().optional().default(10),
  summary_limit: z.number().int().positive().optional().default(5),
  session_limit: z.number().int().positive().optional().default(3),
});

export type MemoryRetrievalRequest = z.infer<typeof MemoryRetrievalRequestSchema>;

/**
 * Memory retrieval response containing all memory types
 */
export const MemoryRetrievalResponseSchema = z.object({
  observations: z.array(ObservationInfoSchema),
  summaries: z.array(SummaryInfoSchema),
  communications: z.array(CommunicationSchema).optional().default([]),
  meta: z
    .object({
      queryTime: z.number().optional(),
    })
    .optional(),
});

export type MemoryRetrievalResponse = z.infer<typeof MemoryRetrievalResponseSchema>;

/**
 * Profile lookup response
 */
export const ProfileLookupResponseSchema = z.object({
  normalizedValue: z.string().max(255),
  profiles: z.array(z.string()).max(100),
});

export type ProfileLookupResponse = z.infer<typeof ProfileLookupResponseSchema>;

/**
 * Profile response with traits
 */
export const ProfileResponseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  traits: z.record(z.unknown()),
});

export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

/**
 * Empty memory response for error fallback
 */
export const EMPTY_MEMORY_RESPONSE: MemoryRetrievalResponse = {
  observations: [],
  summaries: [],
  communications: [],
};

/**
 * Response from creating an observation
 */
export const CreateObservationResponseSchema = z.object({
  content: z.string(),
  source: z.string(),
  occurredAt: z.string(),
  conversationIds: z.array(z.string()),
});

export type CreateObservationResponse = z.infer<typeof CreateObservationResponseSchema>;

/**
 * Response from creating conversation summaries
 */
export const CreateConversationSummariesResponseSchema = z.object({
  message: z.string(),
});

export type CreateConversationSummariesResponse = z.infer<
  typeof CreateConversationSummariesResponseSchema
>;
