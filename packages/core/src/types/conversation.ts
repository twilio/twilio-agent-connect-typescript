import { z } from 'zod';
import { ChannelTypeSchema } from './config';
import { PendingHandoffDataSchema } from './handoff';
import type { TACMemoryResponse } from '../lib/tac-memory-response';

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
 * Communication participant for Conversations Service API (Conversation Orchestrator).
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
 * Note: In the Conversation Orchestrator API, both `type` and `text` are required fields.
 */
export const CommunicationContentSchema = z.object({
  type: z.enum(['TEXT', 'TRANSCRIPTION']),
  text: z.string().max(8388608),
  transcription: TranscriptionSchema.optional(),
});

export type CommunicationContent = z.infer<typeof CommunicationContentSchema>;

/**
 * Communication from Conversations Service API (Conversation Orchestrator).
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
 * List communications response
 */
export const ListCommunicationsResponseSchema = z.object({
  communications: z.array(CommunicationSchema),
});

export type ListCommunicationsResponse = z.infer<typeof ListCommunicationsResponseSchema>;

/**
 * Participant reference for the Actions API (`from`/`to` entries).
 *
 * Either `participantId` or `address` must be supplied; `channel` is always required.
 * When both are provided, Conversation Orchestrator uses `participantId` and
 * `channel` disambiguates which of the participant's addresses to use.
 */
export const ActionParticipantRefSchema = z
  .object({
    participantId: z.string().min(1).optional(),
    address: z.string().min(1).max(254).optional(),
    channel: ParticipantAddressTypeSchema,
  })
  .refine(v => Boolean(v.participantId) || Boolean(v.address), {
    message: 'ActionParticipantRef requires at least `participantId` or `address`',
  });

export type ActionParticipantRef = z.infer<typeof ActionParticipantRefSchema>;

/**
 * Plain-text content for a SEND_MESSAGE action.
 */
export const ActionTextContentSchema = z.object({
  text: z.string().max(8388608),
});

export type ActionTextContent = z.infer<typeof ActionTextContentSchema>;

/**
 * Channel-specific settings forwarded to the downstream backend.
 *
 * Open pass-through: any field not explicitly modeled here (e.g.
 * `messagingServiceSid`, `statusCallback`, `Attributes`) can be set by callers and
 * will be forwarded as-is.
 */
export const ActionChannelSettingsSchema = z.looseObject({
  channelId: z.string().optional(),
});

export type ActionChannelSettings = z.infer<typeof ActionChannelSettingsSchema>;

/**
 * Inner payload for a SEND_MESSAGE action.
 */
export const SendMessageActionPayloadSchema = z.object({
  from: ActionParticipantRefSchema,
  to: z.array(ActionParticipantRefSchema).min(1),
  content: ActionTextContentSchema,
  channelSettings: ActionChannelSettingsSchema.optional(),
});

export type SendMessageActionPayload = z.infer<typeof SendMessageActionPayloadSchema>;

/**
 * Request for POST /v2/Conversations/{id}/Actions with type=SEND_MESSAGE.
 *
 * Body is discriminated by `type` with the action-specific fields under `payload`.
 */
export const SendMessageActionRequestSchema = z.object({
  type: z.literal('SEND_MESSAGE').default('SEND_MESSAGE'),
  payload: SendMessageActionPayloadSchema,
});

export type SendMessageActionRequest = z.infer<typeof SendMessageActionRequestSchema>;

/**
 * Response from POST /v2/Conversations/{id}/Actions (202 Accepted).
 *
 * Listen for COMMUNICATION_CREATED webhook to get the full Communication.
 */
export const ActionResponseSchema = z.object({
  id: z.string(),
  // Kept as string (not enum) to tolerate future action types. Known: SEND_MESSAGE.
  type: z.string(),
  // Kept as string (not enum) to tolerate future statuses. Known: PENDING, COMPLETED, FAILED.
  status: z.string(),
  conversationId: z.string(),
  createdAt: z.string().nullish(),
});

export type ActionResponse = z.infer<typeof ActionResponseSchema>;

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
  /**
   * Twilio Call SID on the Voice channel, unset on messaging. The correlation
   * key for call events (`VoiceChannel.onCallStatus` / `onAmd` / `onRecording`)
   * and `endCall`. Equals `conversationId` in relay-only mode; look the session
   * up the other way with `VoiceChannel.getConversationSessionByCallSid`.
   */
  callSid: z.string().optional(),
  profileId: z.string().optional(),
  serviceId: z.string().optional(),
  channel: ChannelTypeSchema,
  startedAt: z.date(),
  authorInfo: AuthorInfoSchema.optional(),
  /**
   * Agent-side participant info stashed by inbound reconciliation or outbound
   * initiation. `sendResponse` reads this to avoid re-listing participants at
   * send time.
   */
  aiAgentInfo: AuthorInfoSchema.optional(),
  profile: z.custom<Profile>().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  /**
   * Pending handoff payload set by the handoff tool. Voice channel sends
   * this as a WS "end" message after the LLM's final response.
   */
  pendingHandoffData: PendingHandoffDataSchema.optional(),
  /**
   * Cached memory for "once" mode. Set on the first retrieval, cleared when
   * the conversation becomes INACTIVE. Not persisted/serialized.
   */
  cachedMemory: z.custom<TACMemoryResponse>().optional(),
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
 * List conversations response
 */
export const ListConversationsResponseSchema = z.object({
  conversations: z.array(ConversationResponseSchema),
});

export type ListConversationsResponse = z.infer<typeof ListConversationsResponseSchema>;

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
  type: z.enum(['HUMAN_AGENT', 'CUSTOMER', 'AI_AGENT', 'AGENT', 'UNKNOWN']).optional(),
  profileId: z.string().nullable().optional(),
  addresses: z.array(ConversationAddressSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ConversationParticipant = z.infer<typeof ConversationParticipantSchema>;

/**
 * List participants response
 */
export const ListParticipantsResponseSchema = z.object({
  participants: z.array(ConversationParticipantSchema),
});

export type ListParticipantsResponse = z.infer<typeof ListParticipantsResponseSchema>;

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
  metadata: z.record(z.string(), z.string()).nullable().optional(),
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
  url: z.url(),
  method: z.enum(['POST', 'GET', 'PUT', 'DELETE', 'PATCH']).optional().default('POST'),
});

export type StatusCallback = z.infer<typeof StatusCallbackSchema>;

/**
 * Conversation grouping type
 *
 * - `GROUP_BY_PROFILE`: Groups communications by participant profile. Communications
 *   with the same profile go to the same conversation, regardless of the channel or address.
 * - `GROUP_BY_PARTICIPANT_ADDRESSES`: Groups communications by participant addresses
 *   across all channels. A customer using +15551234567 will be in the same conversation
 *   whether they contact via SMS, WhatsApp, or RCS.
 * - `GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE`: Groups communications by both
 *   participant addresses AND channel. A customer using +15551234567 via SMS will be in
 *   a different conversation than the same customer via WhatsApp.
 */
export const ConversationGroupingTypeSchema = z.enum([
  'GROUP_BY_PROFILE',
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
  memoryStoreId: z
    .string()
    .regex(/^mem_(store|service)_[0-7][0-9a-z]{25}$/, 'Invalid Memory Store ID format'),
  channelSettings: z.record(z.string(), ChannelSettingsSchema).nullable().optional(),
  statusCallbacks: z.array(StatusCallbackSchema).max(20).nullable().optional(),
  intelligenceConfigurationIds: z.array(z.string()).max(5).nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  version: z.number().int().nullable().optional(),
});

export type ConversationConfiguration = z.infer<typeof ConversationConfigurationSchema>;

// =========================================================================
// Outbound Conversation Types
// =========================================================================

/**
 * Options for initiating an outbound SMS conversation.
 *
 * The sender is always TAC's configured `config.phoneNumber`. Multi-sender
 * deployments should run one TAC instance per sender so inbound webhook
 * routing, memory scoping, and configuration stay in sync.
 */
export const InitiateMessagingConversationOptionsSchema = z.object({
  to: z.string().min(1, 'Recipient address is required'),
  message: z.string().min(1, 'Initial message is required'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InitiateMessagingConversationOptions = z.infer<
  typeof InitiateMessagingConversationOptionsSchema
>;

/**
 * Result of initiating an outbound conversation
 */
export interface InitiateConversationResult {
  conversationId: ConversationId;
  session: ConversationSession;
}

/**
 * Result of initiating an outbound voice conversation.
 * Note: conversationId is not included because the conversation is created by
 * Conversation Orchestrator during passive hydration — the SDK discovers it
 * lazily on the first prompt via callSid lookup.
 */
export interface InitiateVoiceConversationResult {
  callSid: string;
}

/**
 * Webhook payload structure from Twilio Conversation Orchestrator.
 * This structure is used by all channels (messaging and voice) for webhook events.
 */
export interface ConversationWebhookPayload {
  eventType: string;
  timestamp?: string;
  data?: {
    id?: string;
    conversationId?: string;
    accountId?: string;
    serviceId?: string;
    status?: string;
    participantType?: string;
    profileId?: string;
    channelId?: string;
    author?: {
      address?: string;
      channel?: string;
      participantId?: string;
    };
    content?: {
      type?: string;
      text?: string;
    };
    recipients?: Array<{
      address?: string;
      channel?: string;
      participantId?: string;
      deliveryStatus?: string;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
