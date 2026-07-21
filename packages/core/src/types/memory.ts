import { z } from 'zod';

/**
 * Memory retrieval mode for channels.
 *
 * - "always": Fetch memory with the message as query on every inbound message.
 * - "once": Fetch memory once at conversation start with an empty query and
 *   cache it. The cache is invalidated when the conversation becomes INACTIVE.
 * - "never": Never automatically fetch memory (default).
 */
export const MemoryModeSchema = z.enum(['always', 'never', 'once']);
export type MemoryMode = z.infer<typeof MemoryModeSchema>;

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
export const MemoryParticipantTypeSchema = z.enum(['HUMAN_AGENT', 'CUSTOMER', 'AI_AGENT', 'AGENT']);
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
 * Memory API has different field requirements than Conversation Orchestrator:
 * - Uses `id` and `name` instead of just `participant_id`
 * - Includes `type` and `profileId` fields
 */
export const MemoryParticipantSchema = z.object({
  id: z.string(),
  name: z.string().max(256),
  address: z.string().max(254),
  channel: MemoryChannelTypeSchema,
  type: MemoryParticipantTypeSchema.optional(),
  profileId: z.string().nullable().optional(),
  deliveryStatus: MemoryDeliveryStatusSchema.optional(),
});

export type MemoryParticipant = z.infer<typeof MemoryParticipantSchema>;

/**
 * Content of a Memory communication.
 *
 * Memory API content is simpler than Conversation Orchestrator - no type discriminator field.
 * The `text` field is optional in Memory API models.
 */
export const MemoryCommunicationContentSchema = z.object({
  text: z.string().max(8388608).optional(),
});

export type MemoryCommunicationContent = z.infer<typeof MemoryCommunicationContentSchema>;

/**
 * A communication from Memory API (historical conversation data).
 *
 * Memory API has different field requirements than Conversation Orchestrator:
 * - No `conversationId`, `accountId`, or `content.type` fields
 * - Participants use `id`, `name`, `type`, `profileId`
 */
export const MemoryCommunicationSchema = z.object({
  id: z.string(),
  author: MemoryParticipantSchema,
  content: MemoryCommunicationContentSchema,
  recipients: z.array(MemoryParticipantSchema).max(100),
  channelId: z.string().max(256).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
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
  timestamp: z.iso.datetime(),
});

export type SessionMessage = z.infer<typeof SessionMessageSchema>;

/**
 * Session information containing conversation history
 */
export const SessionInfoSchema = z.object({
  session_id: z.string(),
  started_at: z.iso.datetime(),
  ended_at: z.iso.datetime().optional(),
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
  createdAt: z.iso.datetime(),
  occurredAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().optional(),
  conversationIds: z.array(z.string()).optional(),
});

export type SummaryInfo = z.infer<typeof SummaryInfoSchema>;

/**
 * Memory retrieval request parameters.
 *
 * Defaults match the Memory API server defaults. The SDK-level defaults in
 * TwilioMemoryConfigSchema may differ (e.g. communicationsLimit defaults to 10
 * in the SDK config for a better out-of-box experience, vs 0 on the API).
 */
export const MemoryRetrievalRequestSchema = z.object({
  conversationId: z.string().optional(),
  query: z.string().optional(),
  beginDate: z.iso.datetime().optional(),
  endDate: z.iso.datetime().optional(),
  observationsLimit: z.number().int().min(0).max(100).optional(),
  summariesLimit: z.number().int().min(0).max(100).optional(),
  communicationsLimit: z.number().int().min(0).max(100).optional(),
  relevanceThreshold: z.number().min(0.0).max(1.0).optional(),
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
  profiles: z
    .array(z.string())
    .max(100)
    .nullable()
    .transform(v => v ?? []),
});

export type ProfileLookupResponse = z.infer<typeof ProfileLookupResponseSchema>;

/**
 * Profile response with traits
 */
export const ProfileResponseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  traits: z.record(z.string(), z.unknown()),
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
 * Response from creating an observation.
 *
 * The Memory API Observations endpoint is a batch create that returns a
 * confirmation message rather than the persisted observation.
 */
export const CreateObservationResponseSchema = z.object({
  message: z.string(),
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
