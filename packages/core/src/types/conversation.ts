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
 * Participant address containing channel and address
 */
export const ParticipantAddressSchema = z.object({
  channel: ParticipantAddressTypeSchema,
  address: z.string().min(1, 'Address is required'),
  channelId: z.string().nullable().optional(),
});

export type ParticipantAddress = z.infer<typeof ParticipantAddressSchema>;

/**
 * Communication participant for Conversations Service API (Maestro).
 *
 * Note: participantId is required for SDK validation when creating communications.
 */
export const CommunicationParticipantSchema = z.object({
  address: z.string().max(254),
  channel: ParticipantAddressTypeSchema,
  participantId: z.string(),
  deliveryStatus: z
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
 * Note: `createdAt` is optional per API spec.
 */
export const CommunicationSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  accountId: z.string(),
  author: CommunicationParticipantSchema,
  content: CommunicationContentSchema,
  recipients: z.array(CommunicationParticipantSchema),
  channelId: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  occurredAt: z.string().nullable().optional(),
});

export type Communication = z.infer<typeof CommunicationSchema>;

/**
 * Send API author/recipient address (ParticipantAddress)
 */
export const SendCommunicationParticipantAddressSchema = z.object({
  address: z.string().min(1, 'Address is required').max(254),
  channel: ParticipantAddressTypeSchema,
  participantId: z.string().optional(),
});

export type SendCommunicationParticipantAddress = z.infer<
  typeof SendCommunicationParticipantAddressSchema
>;

/**
 * Send API request fields for POST /v2/Communications.
 * Note: conversationId is supplied separately as a parameter to sendCommunication()
 * and merged into the JSON payload by the client before sending.
 */
export const SendCommunicationRequestSchema = z.object({
  author: SendCommunicationParticipantAddressSchema,
  content: z.object({
    type: z.enum(['TEXT', 'TRANSCRIPTION']),
    text: z.string(),
    transcription: TranscriptionSchema.optional(),
  }),
  recipients: z.array(SendCommunicationParticipantAddressSchema).min(1),
  channelId: z.string().optional(),
});

export type SendCommunicationRequest = z.infer<typeof SendCommunicationRequestSchema>;

/**
 * Send API response from POST /v2/Communications endpoint
 * Returns 202 Accepted with async job status.
 * The Communication record is created asynchronously after message delivery.
 * Listen for COMMUNICATION_CREATED webhook to get the full Communication.
 */
export const SendCommunicationResponseSchema = z.object({
  message: z.string(),
  conversationId: z.string(),
  channelId: z.string().nullable(),
});

export type SendCommunicationResponse = z.infer<typeof SendCommunicationResponseSchema>;

/**
 * Author information for a conversation session
 */
export const AuthorInfoSchema = z.object({
  address: z.string(),
  participantId: z.string().optional(),
});

export type AuthorInfo = z.infer<typeof AuthorInfoSchema>;

/**
 * Profile information for a conversation participant
 */
export interface Profile {
  profileId: string;
  traits?: Record<string, unknown>;
}

/**
 * Conversation session context
 */
export const ConversationSessionSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  profileId: z.string().optional(),
  serviceId: z.string().optional(),
  channel: ChannelTypeSchema,
  startedAt: z.date(),
  authorInfo: AuthorInfoSchema.optional(),
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

/**
 * Timeout settings for channel status transitions
 */
export const StatusTimeoutsSchema = z.object({
  inactive: z.number().int().gte(1).nullable().optional(),
  closed: z.number().int().gte(1),
});

export type StatusTimeouts = z.infer<typeof StatusTimeoutsSchema>;

/**
 * Capture rule with from/to addresses and optional metadata
 */
export const CaptureRuleSchema = z.object({
  from: z.string(),
  to: z.string(),
  metadata: z.record(z.string()).nullable().optional(),
});

export type CaptureRule = z.infer<typeof CaptureRuleSchema>;

/**
 * Configuration settings for a specific channel type
 */
export const ChannelSettingsSchema = z.object({
  statusTimeouts: StatusTimeoutsSchema.nullable().optional(),
  captureRules: z.array(CaptureRuleSchema).nullable().optional(),
});

export type ChannelSettings = z.infer<typeof ChannelSettingsSchema>;

/**
 * Webhook configuration for status callbacks
 */
export const StatusCallbackSchema = z.object({
  url: z.string().url(),
  method: z.enum(['POST', 'GET', 'PUT', 'DELETE', 'PATCH']).optional().default('POST'),
});

export type StatusCallback = z.infer<typeof StatusCallbackSchema>;

/**
 * Conversation grouping type
 */
export const ConversationGroupingTypeSchema = z.enum([
  'GROUP_BY_PARTICIPANT_ADDRESSES',
  'GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE',
]);

export type ConversationGroupingType = z.infer<typeof ConversationGroupingTypeSchema>;

/**
 * Configuration settings for a conversation
 */
export const ConversationConfigurationSchema = z.object({
  id: z.string(),
  displayName: z
    .string()
    .max(32)
    .regex(/^[a-zA-Z0-9-_ ]+$/)
    .nullable()
    .optional(),
  description: z.string(),
  conversationGroupingType: ConversationGroupingTypeSchema,
  memoryStoreId: z.string(),
  channelSettings: z.record(ChannelSettingsSchema).nullable().optional(),
  statusCallbacks: z.array(StatusCallbackSchema).max(20).nullable().optional(),
  intelligenceConfigurationIds: z.array(z.string()).max(5).nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  version: z.number().int().nullable().optional(),
});

export type ConversationConfiguration = z.infer<typeof ConversationConfigurationSchema>;
