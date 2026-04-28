import { z } from 'zod';
import { TranscriptionSchema } from './conversation';

/**
 * Channel type for communications
 */
export const TACChannelTypeSchema = z.enum([
  'VOICE',
  'SMS',
  'RCS',
  'EMAIL',
  'WHATSAPP',
  'CHAT',
  'API',
  'SYSTEM',
]);
export type TACChannelType = z.infer<typeof TACChannelTypeSchema>;

/**
 * Delivery status for communications
 */
export const TACDeliveryStatusSchema = z.enum([
  'INITIATED',
  'IN_PROGRESS',
  'DELIVERED',
  'COMPLETED',
  'FAILED',
]);
export type TACDeliveryStatus = z.infer<typeof TACDeliveryStatusSchema>;

/**
 * Participant type
 */
export const TACParticipantTypeSchema = z.enum(['HUMAN_AGENT', 'CUSTOMER', 'AI_AGENT', 'AGENT']);
export type TACParticipantType = z.infer<typeof TACParticipantTypeSchema>;

/**
 * Unified author model with all fields from both Memory and Conversation Orchestrator APIs.
 *
 * Fields not available from a particular API will be undefined.
 */
export const TACCommunicationAuthorSchema = z.object({
  // Common fields (both APIs)
  address: z.string(),
  channel: TACChannelTypeSchema,

  // Conversation Orchestrator-only fields
  participantId: z.string().optional(),
  deliveryStatus: TACDeliveryStatusSchema.optional(),

  // Memory-only fields
  id: z.string().optional(),
  name: z.string().optional(),
  type: TACParticipantTypeSchema.optional(),
  profileId: z.string().nullable().optional(),
});

export type TACCommunicationAuthor = z.infer<typeof TACCommunicationAuthorSchema>;

/**
 * Unified content model with all fields from both Memory and Conversation Orchestrator APIs.
 */
export const TACCommunicationContentSchema = z.object({
  // Conversation Orchestrator-only: content type discriminator
  type: z.enum(['TEXT', 'TRANSCRIPTION']).optional(),
  // Both APIs: message text (optional in unified model to handle both)
  text: z.string().optional(),
  // Conversation Orchestrator-only: transcription metadata
  transcription: TranscriptionSchema.optional(),
});

export type TACCommunicationContent = z.infer<typeof TACCommunicationContentSchema>;

/**
 * Unified communication model with all fields from both Memory and Conversation Orchestrator APIs.
 *
 * Provides complete access to all communication fields regardless of the source.
 * Fields not available from a particular API will be undefined.
 */
export const TACCommunicationSchema = z.object({
  // Common fields (both APIs)
  id: z.string(),
  author: TACCommunicationAuthorSchema,
  content: TACCommunicationContentSchema,
  recipients: z.array(TACCommunicationAuthorSchema).default([]),
  channelId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),

  // Conversation Orchestrator-only fields
  conversationId: z.string().optional(),
  accountId: z.string().optional(),
});

export type TACCommunication = z.infer<typeof TACCommunicationSchema>;
