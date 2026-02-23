import { z } from 'zod';

/**
 * Message direction in a conversation
 */
export const MessageDirectionSchema = z.enum(['inbound', 'outbound']);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

/**
 * Channel type for Memory communications
 */
export const MemoryChannelTypeSchema = z.enum([
  'VOICE',
  'SMS',
  'RCS',
  'EMAIL',
  'WHATSAPP',
  'CHAT',
  'API',
  'SYSTEM',
]);
export type MemoryChannelType = z.infer<typeof MemoryChannelTypeSchema>;

/**
 * Participant type in Memory API
 */
export const MemoryParticipantTypeSchema = z.enum(['HUMAN_AGENT', 'CUSTOMER', 'AI_AGENT']);
export type MemoryParticipantType = z.infer<typeof MemoryParticipantTypeSchema>;

/**
 * Delivery status for Memory communications
 */
export const MemoryDeliveryStatusSchema = z.enum([
  'INITIATED',
  'IN_PROGRESS',
  'DELIVERED',
  'COMPLETED',
  'FAILED',
]);
export type MemoryDeliveryStatus = z.infer<typeof MemoryDeliveryStatusSchema>;

/**
 * Participant in a Memory communication (author or recipient).
 *
 * Memory API has different field requirements than Maestro:
 * - Uses `id` and `name` instead of just `participant_id`
 * - Includes `type` and `profile_id` fields
 */
export const MemoryParticipantSchema = z.object({
  id: z.string(),
  name: z.string().max(256),
  address: z.string().max(254),
  channel: MemoryChannelTypeSchema,
  type: MemoryParticipantTypeSchema.optional(),
  profile_id: z.string().optional(),
  delivery_status: MemoryDeliveryStatusSchema.optional(),
});

export type MemoryParticipant = z.infer<typeof MemoryParticipantSchema>;

/**
 * Content of a Memory communication.
 *
 * Memory API content is simpler than Maestro - no type discriminator field.
 * The `text` field is optional in Memory API models.
 */
export const MemoryCommunicationContentSchema = z.object({
  text: z.string().max(8388608).optional(),
});

export type MemoryCommunicationContent = z.infer<typeof MemoryCommunicationContentSchema>;

/**
 * A communication from Memory API (historical conversation data).
 *
 * Memory API has different field requirements than Maestro:
 * - No `conversation_id`, `account_id`, or `content.type` fields
 * - Participants use `id`, `name`, `type`, `profile_id`
 */
export const MemoryCommunicationSchema = z.object({
  id: z.string(),
  author: MemoryParticipantSchema,
  content: MemoryCommunicationContentSchema,
  recipients: z.array(MemoryParticipantSchema).max(100),
  channel_id: z.string().max(256).optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

export type MemoryCommunication = z.infer<typeof MemoryCommunicationSchema>;

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
 * Memory retrieval response from the Memory API /Recall endpoint.
 *
 * Contains observations, summaries, and communications from Memory API.
 */
export const MemoryRetrievalResponseSchema = z.object({
  observations: z.array(ObservationInfoSchema),
  summaries: z.array(SummaryInfoSchema),
  communications: z.array(MemoryCommunicationSchema).optional().default([]),
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
