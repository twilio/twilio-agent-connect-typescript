import { z } from 'zod';
import { ChannelTypeSchema } from './config';

/**
 * Participant address type for different communication channels
 */
export const ParticipantAddressTypeSchema = z.enum([
  'VOICE',
  'SMS',
  'RCS',
  'EMAIL',
  'WHATSAPP',
  'CHAT',
  'API',
  'SYSTEM',
]);
export type ParticipantAddressType = z.infer<typeof ParticipantAddressTypeSchema>;

/**
 * Participant address containing channel and address (snake_case format)
 */
export const ParticipantAddressSchema = z.object({
  channel: ParticipantAddressTypeSchema,
  address: z.string().min(1, 'Address is required'),
  channel_id: z.string().nullable().optional(),
});

export type ParticipantAddress = z.infer<typeof ParticipantAddressSchema>;

/**
 * Communication participant for Conversations Service API (Maestro).
 *
 * Note: participant_id is required for SDK validation when creating communications.
 */
export const CommunicationParticipantSchema = z.object({
  address: z.string().max(254),
  channel: ParticipantAddressTypeSchema,
  participant_id: z.string(),
  delivery_status: z
    .enum(['INITIATED', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'FAILED'])
    .optional(),
});

export type CommunicationParticipant = z.infer<typeof CommunicationParticipantSchema>;

/**
 * Word-level transcription data with timing information.
 */
export const TranscriptionWordSchema = z.object({
  text: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

export type TranscriptionWord = z.infer<typeof TranscriptionWordSchema>;

/**
 * Transcription metadata for communication content.
 */
export const TranscriptionSchema = z.object({
  channel: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
  engine: z.string().optional(),
  words: z.array(TranscriptionWordSchema).optional(),
});

export type Transcription = z.infer<typeof TranscriptionSchema>;

/**
 * Communication content (ContentText or ContentTranscription).
 *
 * Note: In Maestro API, both `type` and `text` are required fields.
 */
export const CommunicationContentSchema = z.object({
  type: z.enum(['TEXT', 'TRANSCRIPTION']),
  text: z.string().max(8388608),
  transcription: TranscriptionSchema.optional(),
});

export type CommunicationContent = z.infer<typeof CommunicationContentSchema>;

/**
 * Communication from Conversations Service API (Maestro).
 *
 * Note: `created_at` is optional per API spec.
 */
export const CommunicationSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  account_id: z.string(),
  author: CommunicationParticipantSchema,
  content: CommunicationContentSchema,
  recipients: z.array(CommunicationParticipantSchema),
  channel_id: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type Communication = z.infer<typeof CommunicationSchema>;

/**
 * Author information for a conversation session
 */
export const AuthorInfoSchema = z.object({
  address: z.string(),
  participant_id: z.string().optional(),
});

export type AuthorInfo = z.infer<typeof AuthorInfoSchema>;

/**
 * Profile information for a conversation participant
 */
export interface Profile {
  profile_id: string;
  traits?: Record<string, unknown>;
}

/**
 * Conversation session context
 */
export const ConversationSessionSchema = z.object({
  conversation_id: z.string().min(1, 'Conversation ID is required'),
  profile_id: z.string().optional(),
  service_id: z.string().optional(),
  channel: ChannelTypeSchema,
  started_at: z.date(),
  author_info: AuthorInfoSchema.optional(),
  profile: z.custom<Profile>().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
});

export type ConversationSession = z.infer<typeof ConversationSessionSchema>;

/**
 * Branded types for type safety
 */
export type ConversationId = string & { readonly _brand: 'ConversationId' };
export type ProfileId = string & { readonly _brand: 'ProfileId' };
export type ParticipantId = string & { readonly _brand: 'ParticipantId' };

/**
 * Type guards for branded types
 */
export function isConversationId(value: string): value is ConversationId {
  return value.length > 0;
}

export function isProfileId(value: string): value is ProfileId {
  return value.length > 0;
}

export function isParticipantId(value: string): value is ParticipantId {
  return value.length > 0;
}

/**
 * Conversation response from Conversations Service API
 */
export const ConversationResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  status: z.string().optional(),
  name: z.string().nullish(), // API returns null when not set
  configurationId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;

/**
 * Participant address from Conversations Service API (camelCase format)
 */
export const ConversationAddressSchema = z.object({
  channel: ParticipantAddressTypeSchema,
  address: z.string(),
  channelId: z.string().nullish(), // API returns null when not set
});

export type ConversationAddress = z.infer<typeof ConversationAddressSchema>;

/**
 * Participant response from Conversations Service API
 */
export const ConversationParticipantSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  accountId: z.string(),
  name: z.string().optional(),
  type: z.enum(['HUMAN_AGENT', 'CUSTOMER', 'AI_AGENT']).optional(),
  profileId: z.string().nullable().optional(),
  addresses: z.array(ConversationAddressSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ConversationParticipant = z.infer<typeof ConversationParticipantSchema>;
