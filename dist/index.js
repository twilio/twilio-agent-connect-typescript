import { z } from 'zod';
export { z } from 'zod';
import pino from 'pino';
import { WebSocket } from 'ws';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import gracefulShutdown from 'fastify-graceful-shutdown';
import twilio from 'twilio';

// packages/core/src/types/tac.ts
var EnvironmentSchema = z.enum(["dev", "stage", "prod"]).default("prod");
var ChannelTypeSchema = z.enum(["sms", "voice", "chat"]);
var TACConfigSchema = z.object({
  environment: EnvironmentSchema,
  twilioAccountSid: z.string().min(1, "Twilio Account SID is required"),
  twilioAuthToken: z.string().min(1, "Twilio Auth Token is required"),
  twilioApiKey: z.string().min(1, "Twilio API Key is required"),
  twilioApiToken: z.string().min(1, "Twilio API Token is required"),
  twilioPhoneNumber: z.string().min(1, "Twilio Phone Number is required"),
  memoryStoreId: z.string().regex(/^mem_(service|store)_[0-9a-z]{26}$/, "Invalid Memory Store ID format").optional(),
  traitGroups: z.array(z.string()).optional(),
  conversationServiceId: z.string().regex(
    /^(comms_service|conv_configuration)_[0-9a-z]{26}$/,
    "Invalid Conversation Configuration ID format"
  ),
  voicePublicDomain: z.string().url().optional(),
  cintelConfigurationId: z.string().optional(),
  cintelObservationOperatorSid: z.string().optional(),
  cintelSummaryOperatorSid: z.string().optional()
});
var EnvironmentVariables = {
  ENVIRONMENT: "ENVIRONMENT",
  TWILIO_ACCOUNT_SID: "TWILIO_ACCOUNT_SID",
  TWILIO_AUTH_TOKEN: "TWILIO_AUTH_TOKEN",
  TWILIO_API_KEY: "TWILIO_API_KEY",
  TWILIO_API_TOKEN: "TWILIO_API_TOKEN",
  TWILIO_PHONE_NUMBER: "TWILIO_PHONE_NUMBER",
  MEMORY_STORE_ID: "MEMORY_STORE_ID",
  TRAIT_GROUPS: "TRAIT_GROUPS",
  CONVERSATION_SERVICE_ID: "CONVERSATION_SERVICE_ID",
  VOICE_PUBLIC_DOMAIN: "VOICE_PUBLIC_DOMAIN",
  TWILIO_TAC_CI_CONFIGURATION_ID: "TWILIO_TAC_CI_CONFIGURATION_ID",
  TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID: "TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID",
  TWILIO_TAC_CI_SUMMARY_OPERATOR_SID: "TWILIO_TAC_CI_SUMMARY_OPERATOR_SID"
};
function computeServiceUrls(environment) {
  const baseUrls = {
    dev: {
      memoryApiUrl: "https://memory.dev-us1.twilio.com",
      conversationsApiUrl: "https://conversations.dev-us1.twilio.com",
      knowledgeApiUrl: "https://knowledge.dev.twilio.com"
    },
    stage: {
      memoryApiUrl: "https://memory.stage-us1.twilio.com",
      conversationsApiUrl: "https://conversations.stage-us1.twilio.com",
      knowledgeApiUrl: "https://knowledge.stage.twilio.com"
    },
    prod: {
      memoryApiUrl: "https://memory.twilio.com",
      conversationsApiUrl: "https://conversations.twilio.com",
      knowledgeApiUrl: "https://knowledge.twilio.com"
    }
  };
  return baseUrls[environment];
}
var VoiceServerConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().int().positive().default(3e3)
});

// packages/core/src/types/conversation.ts
var ParticipantAddressTypeSchema = z.enum([
  "VOICE",
  "SMS",
  "RCS",
  "EMAIL",
  "WHATSAPP",
  "CHAT",
  "API",
  "SYSTEM"
]);
var ParticipantAddressSchema = z.object({
  channel: ParticipantAddressTypeSchema,
  address: z.string().min(1, "Address is required"),
  channelId: z.string().nullable().optional()
});
var CommunicationParticipantSchema = z.object({
  address: z.string().max(254),
  channel: ParticipantAddressTypeSchema,
  participantId: z.string(),
  deliveryStatus: z.enum(["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]).optional()
});
var TranscriptionWordSchema = z.object({
  text: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional()
});
var TranscriptionSchema = z.object({
  channel: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
  engine: z.string().optional(),
  words: z.array(TranscriptionWordSchema).optional()
});
var CommunicationContentSchema = z.object({
  type: z.enum(["TEXT", "TRANSCRIPTION"]),
  text: z.string().max(8388608),
  transcription: TranscriptionSchema.optional()
});
var CommunicationSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  accountId: z.string(),
  author: CommunicationParticipantSchema,
  content: CommunicationContentSchema,
  recipients: z.array(CommunicationParticipantSchema),
  channelId: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  occurredAt: z.string().nullable().optional()
});
var SendCommunicationParticipantAddressSchema = z.object({
  address: z.string().min(1, "Address is required").max(254),
  channel: ParticipantAddressTypeSchema,
  participantId: z.string().optional()
});
var SendCommunicationRequestSchema = z.object({
  author: SendCommunicationParticipantAddressSchema,
  content: z.object({
    type: z.enum(["TEXT", "TRANSCRIPTION"]),
    text: z.string(),
    transcription: TranscriptionSchema.optional()
  }),
  recipients: z.array(SendCommunicationParticipantAddressSchema).min(1),
  channelId: z.string().optional()
});
var SendCommunicationResponseSchema = z.object({
  message: z.string(),
  conversationId: z.string(),
  channelId: z.string().nullable()
});
var AuthorInfoSchema = z.object({
  address: z.string(),
  participantId: z.string().optional()
});
var ConversationSessionSchema = z.object({
  conversationId: z.string().min(1, "Conversation ID is required"),
  profileId: z.string().optional(),
  serviceId: z.string().optional(),
  channel: ChannelTypeSchema,
  startedAt: z.date(),
  authorInfo: AuthorInfoSchema.optional(),
  profile: z.custom().optional(),
  metadata: z.record(z.unknown()).optional().default({})
});
function isConversationId(value) {
  return value.length > 0;
}
function isProfileId(value) {
  return value.length > 0;
}
function isParticipantId(value) {
  return value.length > 0;
}
var ConversationResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  status: z.string().optional(),
  name: z.string().nullish(),
  // API returns null when not set
  configurationId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
var ConversationAddressSchema = z.object({
  channel: ParticipantAddressTypeSchema,
  address: z.string(),
  channelId: z.string().nullish()
  // API returns null when not set
});
var ConversationParticipantSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  accountId: z.string(),
  name: z.string().optional(),
  type: z.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT", "AGENT", "UNKNOWN"]).optional(),
  profileId: z.string().nullable().optional(),
  addresses: z.array(ConversationAddressSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
var StatusTimeoutsSchema = z.object({
  inactive: z.number().int().gte(1).nullable().optional(),
  closed: z.number().int().gte(1)
});
var CaptureRuleSchema = z.object({
  from: z.string(),
  to: z.string(),
  metadata: z.record(z.string()).nullable().optional()
});
var ChannelSettingsSchema = z.object({
  statusTimeouts: StatusTimeoutsSchema.nullable().optional(),
  captureRules: z.array(CaptureRuleSchema).nullable().optional()
});
var StatusCallbackSchema = z.object({
  url: z.string().url(),
  method: z.enum(["POST", "GET", "PUT", "DELETE", "PATCH"]).optional().default("POST")
});
var ConversationGroupingTypeSchema = z.enum([
  "GROUP_BY_PARTICIPANT_ADDRESSES",
  "GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE"
]);
var ConversationConfigurationSchema = z.object({
  id: z.string(),
  displayName: z.string().max(32).regex(/^[a-zA-Z0-9-_ ]+$/).nullable().optional(),
  description: z.string(),
  conversationGroupingType: ConversationGroupingTypeSchema,
  memoryStoreId: z.string(),
  channelSettings: z.record(ChannelSettingsSchema).nullable().optional(),
  statusCallbacks: z.array(StatusCallbackSchema).max(20).nullable().optional(),
  intelligenceConfigurationIds: z.array(z.string()).max(5).nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  version: z.number().int().nullable().optional()
});

// packages/core/src/types/tac.ts
var TACChannelTypeSchema = z.enum([
  "VOICE",
  "SMS",
  "RCS",
  "EMAIL",
  "WHATSAPP",
  "CHAT",
  "API",
  "SYSTEM"
]);
var TACDeliveryStatusSchema = z.enum([
  "INITIATED",
  "IN_PROGRESS",
  "DELIVERED",
  "COMPLETED",
  "FAILED"
]);
var TACParticipantTypeSchema = z.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]);
var TACCommunicationAuthorSchema = z.object({
  // Common fields (both APIs)
  address: z.string(),
  channel: TACChannelTypeSchema,
  // Maestro-only fields
  participantId: z.string().optional(),
  deliveryStatus: TACDeliveryStatusSchema.optional(),
  // Memory-only fields
  id: z.string().optional(),
  name: z.string().optional(),
  type: TACParticipantTypeSchema.optional(),
  profileId: z.string().optional()
});
var TACCommunicationContentSchema = z.object({
  // Maestro-only: content type discriminator
  type: z.enum(["TEXT", "TRANSCRIPTION"]).optional(),
  // Both APIs: message text (optional in unified model to handle both)
  text: z.string().optional(),
  // Maestro-only: transcription metadata
  transcription: TranscriptionSchema.optional()
});
var TACCommunicationSchema = z.object({
  // Common fields (both APIs)
  id: z.string(),
  author: TACCommunicationAuthorSchema,
  content: TACCommunicationContentSchema,
  recipients: z.array(TACCommunicationAuthorSchema).default([]),
  channelId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  // Maestro-only fields
  conversationId: z.string().optional(),
  accountId: z.string().optional()
});

// packages/core/src/lib/tac-memory-response.ts
function isMemoryRetrievalResponse(data) {
  return !Array.isArray(data);
}
function normalizeMemoryCommunication(comm) {
  return {
    ...comm,
    channelId: comm.channel_id,
    createdAt: comm.created_at,
    updatedAt: comm.updated_at,
    author: {
      ...comm.author,
      profileId: comm.author.profile_id,
      deliveryStatus: comm.author.delivery_status
    },
    recipients: comm.recipients.map((r) => ({
      ...r,
      profileId: r.profile_id,
      deliveryStatus: r.delivery_status
    }))
  };
}
var TACMemoryResponse = class {
  _data;
  _communications;
  /**
   * Initialize wrapper with either Memory or Maestro data.
   *
   * @param data - Either MemoryRetrievalResponse (Memory) or Communication[] (Maestro)
   */
  constructor(data) {
    this._data = data;
    if (isMemoryRetrievalResponse(data)) {
      this._communications = (data.communications ?? []).map(
        (comm) => TACCommunicationSchema.parse(normalizeMemoryCommunication(comm))
      );
    } else {
      this._communications = data.map((comm) => TACCommunicationSchema.parse(comm));
    }
  }
  /**
   * Get observation memories.
   *
   * @returns List of observations if Memory is configured, empty array for Maestro fallback
   */
  get observations() {
    if (isMemoryRetrievalResponse(this._data)) {
      return this._data.observations;
    }
    return [];
  }
  /**
   * Get summary memories.
   *
   * @returns List of summaries if Memory is configured, empty array for Maestro fallback
   */
  get summaries() {
    if (isMemoryRetrievalResponse(this._data)) {
      return this._data.summaries;
    }
    return [];
  }
  /**
   * Get communications in unified format with all available fields.
   *
   * Communications are converted to a common format during initialization that includes
   * all fields from both Memory and Maestro APIs. Fields not available from a particular
   * API will be undefined.
   *
   * @returns List of unified communications with all available fields
   */
  get communications() {
    return this._communications;
  }
  /**
   * Check if Memory API is configured and providing full features.
   *
   * @returns true if Memory is configured (observations/summaries available),
   *          false if using Maestro fallback (only communications available)
   */
  get hasMemoryFeatures() {
    return isMemoryRetrievalResponse(this._data);
  }
  /**
   * Access raw underlying data for advanced use cases.
   *
   * Use this when you need access to all fields from the original API responses,
   * not just the unified common fields.
   *
   * @returns Either MemoryRetrievalResponse or Communication[] depending on configuration
   */
  get rawData() {
    return this._data;
  }
};
var MessageDirectionSchema = z.enum(["inbound", "outbound"]);
var MemoryChannelTypeSchema = z.enum([
  "VOICE",
  "SMS",
  "RCS",
  "EMAIL",
  "WHATSAPP",
  "CHAT",
  "API",
  "SYSTEM"
]);
var MemoryParticipantTypeSchema = z.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]);
var MemoryDeliveryStatusSchema = z.enum([
  "INITIATED",
  "IN_PROGRESS",
  "DELIVERED",
  "COMPLETED",
  "FAILED"
]);
var MemoryParticipantSchema = z.object({
  id: z.string(),
  name: z.string().max(256),
  address: z.string().max(254),
  channel: MemoryChannelTypeSchema,
  type: MemoryParticipantTypeSchema.optional(),
  profile_id: z.string().optional(),
  delivery_status: MemoryDeliveryStatusSchema.optional()
});
var MemoryCommunicationContentSchema = z.object({
  text: z.string().max(8388608).optional()
});
var MemoryCommunicationSchema = z.object({
  id: z.string(),
  author: MemoryParticipantSchema,
  content: MemoryCommunicationContentSchema,
  recipients: z.array(MemoryParticipantSchema).max(100),
  channel_id: z.string().max(256).optional(),
  created_at: z.string(),
  updated_at: z.string().optional()
});
var SessionMessageSchema = z.object({
  direction: MessageDirectionSchema,
  channel: z.string(),
  from_address: z.string().optional(),
  to_address: z.string().optional(),
  content: z.string(),
  timestamp: z.string().datetime()
});
var SessionInfoSchema = z.object({
  session_id: z.string(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
  channel: z.string(),
  messages: z.array(SessionMessageSchema)
});
var ObservationInfoSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  occurredAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  conversationIds: z.array(z.string()).nullable().optional(),
  source: z.string().optional()
});
var SummaryInfoSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  conversationIds: z.array(z.string()).optional()
});
var MemoryRetrievalRequestSchema = z.object({
  query: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  observation_limit: z.number().int().positive().optional().default(10),
  summary_limit: z.number().int().positive().optional().default(5),
  session_limit: z.number().int().positive().optional().default(3)
});
var MemoryRetrievalResponseSchema = z.object({
  observations: z.array(ObservationInfoSchema),
  summaries: z.array(SummaryInfoSchema),
  communications: z.array(MemoryCommunicationSchema).optional().default([]),
  meta: z.object({
    queryTime: z.number().optional()
  }).optional()
});
var ProfileLookupResponseSchema = z.object({
  normalizedValue: z.string().max(255),
  profiles: z.array(z.string()).max(100).nullable().transform((v) => v ?? [])
});
var ProfileResponseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  traits: z.record(z.unknown())
});
var EMPTY_MEMORY_RESPONSE = {
  observations: [],
  summaries: [],
  communications: []
};
var CreateObservationResponseSchema = z.object({
  content: z.string(),
  source: z.string(),
  occurredAt: z.string(),
  conversationIds: z.array(z.string())
});
var CreateConversationSummariesResponseSchema = z.object({
  message: z.string()
});
var LanguageAttributesSchema = z.object({
  /** Language code (e.g., 'en-US', 'es-ES', 'en-AU') */
  code: z.string(),
  /** TTS provider for this language */
  ttsProvider: z.string().optional(),
  /** TTS voice for this language */
  voice: z.string().optional(),
  /** TTS language (may differ from code) */
  ttsLanguage: z.string().optional(),
  /** Transcription provider for this language */
  transcriptionProvider: z.string().optional(),
  /** Speech model for transcription */
  speechModel: z.string().optional(),
  /** Transcription language (may differ from code) */
  transcriptionLanguage: z.string().optional()
});
var ConversationRelayAttributesSchema = z.object({
  /** WebSocket URL for ConversationRelay (required) */
  url: z.string().url(),
  // Welcome greeting settings
  /** Initial greeting to play when call connects */
  welcomeGreeting: z.string().optional(),
  /** Whether welcome greeting can be interrupted */
  welcomeGreetingInterruptible: z.enum(["any", "speech", "none"]).optional(),
  // Transcription settings
  /** Transcription provider (e.g., 'Deepgram', 'Google') */
  transcriptionProvider: z.string().optional(),
  /** Language for transcription (e.g., 'en-US') */
  transcriptionLanguage: z.string().optional(),
  /** Speech model for transcription (e.g., 'nova-3-general') */
  speechModel: z.string().optional(),
  // TTS settings
  /** Text-to-speech provider (e.g., 'Google', 'ElevenLabs') */
  ttsProvider: z.string().optional(),
  /** Language for TTS (e.g., 'en-US') */
  ttsLanguage: z.string().optional(),
  /** Voice identifier for TTS (e.g., 'en-US-Journey-O') */
  voice: z.string().optional(),
  /** ElevenLabs text normalization setting */
  elevenlabsTextNormalization: z.string().optional(),
  // Interaction settings
  /** When agent speech can be interrupted */
  interruptible: z.enum(["any", "speech", "none"]).optional(),
  /** Interrupt detection sensitivity */
  interruptSensitivity: z.enum(["low", "medium", "high"]).optional(),
  /** Enable DTMF tone detection */
  dtmfDetection: z.boolean().optional(),
  /** Recognition hints for domain-specific vocabulary */
  hints: z.string().optional(),
  /** Whether prompts should be reported when TTS is playing and interrupt is disabled */
  reportInputDuringAgentSpeech: z.boolean().optional(),
  // Advanced settings
  /** Enable partial prompts (streaming) */
  partialPrompts: z.boolean().optional(),
  /** Enable profanity filtering */
  profanityFilter: z.boolean().optional(),
  /** Allow preemption of agent speech */
  preemptible: z.boolean().optional(),
  /** Default language code */
  language: z.string().optional(),
  /** Debug options for troubleshooting (string per SDK, not boolean) */
  debug: z.string().optional(),
  // Intelligence service
  /** Conversational Intelligence Service ID or unique name */
  intelligenceService: z.string().optional(),
  // Conversation orchestrator
  /** Twilio Conversation Orchestrator configuration ID */
  conversationConfiguration: z.string().optional()
});
var CustomParametersSchema = z.record(z.unknown());
var SetupMessageSchema = z.object({
  type: z.literal("setup"),
  sessionId: z.string(),
  callSid: z.string(),
  parentCallSid: z.string().optional(),
  from: z.string(),
  to: z.string(),
  forwardedFrom: z.string().optional(),
  callerName: z.string().optional(),
  direction: z.string(),
  callType: z.string(),
  callStatus: z.string(),
  accountSid: z.string(),
  customParameters: z.record(z.unknown()).optional()
});
var PromptMessageSchema = z.object({
  type: z.literal("prompt"),
  voicePrompt: z.string(),
  lang: z.string().optional(),
  last: z.boolean().optional(),
  agentSpeaking: z.string().optional()
});
var InterruptMessageSchema = z.object({
  type: z.literal("interrupt"),
  reason: z.string().optional(),
  transcript: z.string().optional()
});
var WebSocketMessageSchema = z.union([
  SetupMessageSchema,
  PromptMessageSchema,
  InterruptMessageSchema
]);
var TextTokenMessageSchema = z.object({
  type: z.literal("text"),
  token: z.string(),
  last: z.boolean().optional().default(true)
});
var ConversationRelayConfigSchema = ConversationRelayAttributesSchema.extend({
  /** Optional language configurations as child <Language> elements */
  languages: z.array(LanguageAttributesSchema).optional()
});
var ConversationRelayCallbackPayloadSchema = z.object({
  // Core Twilio identifiers (required)
  AccountSid: z.string(),
  CallSid: z.string(),
  /** Call status with strict type checking for all valid Twilio call states */
  CallStatus: z.enum([
    "queued",
    "initiated",
    "ringing",
    "in-progress",
    "completed",
    "busy",
    "no-answer",
    "failed",
    "canceled"
  ]),
  // Call participants (required)
  From: z.string(),
  To: z.string(),
  /** Direction of the call */
  Direction: z.enum(["inbound", "outbound-api", "outbound-dial"]),
  // Standard voice webhook parameters (optional)
  ApiVersion: z.string().optional(),
  ForwardedFrom: z.string().optional(),
  CallerName: z.string().optional(),
  ParentCallSid: z.string().optional(),
  ApplicationSid: z.string().optional(),
  // ConversationRelay session information (optional)
  SessionId: z.string().optional(),
  SessionStatus: z.string().optional(),
  SessionDuration: z.string().optional(),
  HandoffData: z.string().optional()
  // JSON string
});
var HandoffDataSchema = z.object({
  reason: z.string(),
  call_summary: z.string(),
  sentiment: z.string()
});
var JSONSchemaSchema = z.object({
  type: z.enum(["object", "string", "number", "boolean", "array"]),
  properties: z.record(z.any()).optional(),
  required: z.array(z.string()).optional(),
  items: z.any().optional(),
  enum: z.array(z.any()).optional(),
  description: z.string().optional()
});
var OpenAIToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string(),
    parameters: JSONSchemaSchema
  })
});
var ToolExecutionResultSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
var BuiltInTools = {
  RETRIEVE_MEMORY: "retrieve_profile_memory",
  SEND_MESSAGE: "send_message",
  ESCALATE_TO_HUMAN: "escalate_to_human",
  SEARCH_KNOWLEDGE: "search_knowledge"
};
var CintelParticipantSchema = z.object({
  type: z.string(),
  profileId: z.string().optional(),
  mediaParticipantId: z.string().optional()
});
var ExecutionDetailsSchema = z.object({
  participants: z.array(CintelParticipantSchema).optional()
});
var OperatorSchema = z.object({
  id: z.string(),
  name: z.string().optional()
});
var OperatorResultSchema = z.object({
  id: z.string(),
  operator: OperatorSchema,
  outputFormat: z.string(),
  result: z.unknown(),
  dateCreated: z.string(),
  referenceIds: z.array(z.string()).optional().default([]),
  executionDetails: ExecutionDetailsSchema.optional()
});
var IntelligenceConfigurationSchema = z.object({
  id: z.string(),
  friendlyName: z.string().optional()
});
var OperatorResultEventSchema = z.object({
  accountId: z.string(),
  conversationId: z.string(),
  memoryStoreId: z.string().optional(),
  intelligenceConfiguration: IntelligenceConfigurationSchema,
  operatorResults: z.array(OperatorResultSchema)
});
var OperatorProcessingResultSchema = z.object({
  success: z.boolean(),
  eventType: z.string().optional(),
  skipped: z.boolean().default(false),
  skipReason: z.string().optional(),
  error: z.string().optional(),
  createdCount: z.number().default(0)
});
var ConversationIntelligenceConfigSchema = z.object({
  configurationId: z.string(),
  observationOperatorSid: z.string().optional(),
  summaryOperatorSid: z.string().optional()
});
var ConversationSummaryItemSchema = z.object({
  content: z.string(),
  conversationId: z.string(),
  occurredAt: z.string(),
  source: z.string().optional()
});
var KnowledgeBaseStatusSchema = z.enum([
  "QUEUED",
  "PROVISIONING",
  "ACTIVE",
  "FAILED",
  "DELETING"
]);
var KnowledgeBaseSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  status: KnowledgeBaseStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number()
});
var KnowledgeChunkResultSchema = z.object({
  content: z.string(),
  knowledgeId: z.string(),
  createdAt: z.string(),
  score: z.number().optional()
});
var KnowledgeSearchResponseSchema = z.object({
  chunks: z.array(KnowledgeChunkResultSchema)
});

// packages/core/src/lib/config.ts
var TACConfig = class _TACConfig {
  environment;
  twilioAccountSid;
  twilioAuthToken;
  twilioApiKey;
  twilioApiToken;
  twilioPhoneNumber;
  memoryStoreId;
  traitGroups;
  conversationServiceId;
  voicePublicDomain;
  cintelConfigurationId;
  cintelObservationOperatorSid;
  cintelSummaryOperatorSid;
  memoryApiUrl;
  conversationsApiUrl;
  knowledgeApiUrl;
  constructor(data) {
    const validatedConfig = TACConfigSchema.parse(data);
    const serviceUrls = computeServiceUrls(validatedConfig.environment);
    this.environment = validatedConfig.environment;
    this.twilioAccountSid = validatedConfig.twilioAccountSid;
    this.twilioAuthToken = validatedConfig.twilioAuthToken;
    this.twilioApiKey = validatedConfig.twilioApiKey;
    this.twilioApiToken = validatedConfig.twilioApiToken;
    this.twilioPhoneNumber = validatedConfig.twilioPhoneNumber;
    if (validatedConfig.memoryStoreId) {
      this.memoryStoreId = validatedConfig.memoryStoreId;
    }
    if (validatedConfig.traitGroups) {
      this.traitGroups = validatedConfig.traitGroups;
    }
    this.conversationServiceId = validatedConfig.conversationServiceId;
    if (validatedConfig.voicePublicDomain) {
      this.voicePublicDomain = validatedConfig.voicePublicDomain;
    }
    if (validatedConfig.cintelConfigurationId) {
      this.cintelConfigurationId = validatedConfig.cintelConfigurationId;
    }
    if (validatedConfig.cintelObservationOperatorSid) {
      this.cintelObservationOperatorSid = validatedConfig.cintelObservationOperatorSid;
    }
    if (validatedConfig.cintelSummaryOperatorSid) {
      this.cintelSummaryOperatorSid = validatedConfig.cintelSummaryOperatorSid;
    }
    this.memoryApiUrl = serviceUrls.memoryApiUrl;
    this.conversationsApiUrl = serviceUrls.conversationsApiUrl;
    this.knowledgeApiUrl = serviceUrls.knowledgeApiUrl;
  }
  /**
   * Create TACConfig from environment variables.
   *
   * Loads configuration from the following environment variables:
   * - ENVIRONMENT: TAC environment (dev, stage, or prod) - defaults to 'prod'
   * - TWILIO_ACCOUNT_SID: Twilio Account SID (required)
   * - TWILIO_AUTH_TOKEN: Twilio Auth Token (required)
   * - TWILIO_API_KEY: Twilio API Key (required)
   * - TWILIO_API_TOKEN: Twilio API Token (required)
   * - TWILIO_PHONE_NUMBER: Twilio Phone Number (required)
   * - MEMORY_STORE_ID: Memory Store ID (optional, for Twilio Memory)
   * - TRAIT_GROUPS: Comma-separated trait group names (optional, for profile fetching)
   * - CONVERSATION_SERVICE_ID: Twilio Conversation Configuration ID (required)
   * - VOICE_PUBLIC_DOMAIN: Public domain for voice webhooks (optional)
   *
   * @throws Error if required environment variables are not set or invalid
   *
   * @example
   * ```typescript
   * // Ensure env vars are set before calling (e.g. via dotenv, Docker, CI, etc.)
   * const config = TACConfig.fromEnv();
   *
   * // Use in TAC initialization
   * const tac = new TAC({ config });
   * ```
   */
  static fromEnv() {
    const requiredVars = [
      { key: EnvironmentVariables.TWILIO_ACCOUNT_SID, name: "TWILIO_ACCOUNT_SID" },
      { key: EnvironmentVariables.TWILIO_AUTH_TOKEN, name: "TWILIO_AUTH_TOKEN" },
      { key: EnvironmentVariables.TWILIO_API_KEY, name: "TWILIO_API_KEY" },
      { key: EnvironmentVariables.TWILIO_API_TOKEN, name: "TWILIO_API_TOKEN" },
      { key: EnvironmentVariables.TWILIO_PHONE_NUMBER, name: "TWILIO_PHONE_NUMBER" },
      { key: EnvironmentVariables.CONVERSATION_SERVICE_ID, name: "CONVERSATION_SERVICE_ID" }
    ];
    for (const { key, name } of requiredVars) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${name}`);
      }
    }
    const rawConfig = {
      environment: process.env[EnvironmentVariables.ENVIRONMENT] ?? "prod",
      twilioAccountSid: process.env[EnvironmentVariables.TWILIO_ACCOUNT_SID],
      twilioAuthToken: process.env[EnvironmentVariables.TWILIO_AUTH_TOKEN],
      twilioApiKey: process.env[EnvironmentVariables.TWILIO_API_KEY],
      twilioApiToken: process.env[EnvironmentVariables.TWILIO_API_TOKEN],
      twilioPhoneNumber: process.env[EnvironmentVariables.TWILIO_PHONE_NUMBER],
      memoryStoreId: process.env[EnvironmentVariables.MEMORY_STORE_ID],
      traitGroups: process.env[EnvironmentVariables.TRAIT_GROUPS]?.split(","),
      conversationServiceId: process.env[EnvironmentVariables.CONVERSATION_SERVICE_ID],
      voicePublicDomain: process.env[EnvironmentVariables.VOICE_PUBLIC_DOMAIN],
      cintelConfigurationId: process.env[EnvironmentVariables.TWILIO_TAC_CI_CONFIGURATION_ID],
      cintelObservationOperatorSid: process.env[EnvironmentVariables.TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID],
      cintelSummaryOperatorSid: process.env[EnvironmentVariables.TWILIO_TAC_CI_SUMMARY_OPERATOR_SID]
    };
    return new _TACConfig(rawConfig);
  }
  /**
   * Get basic auth credentials for Twilio APIs
   */
  getBasicAuthCredentials() {
    return {
      username: this.twilioAccountSid,
      password: this.twilioAuthToken
    };
  }
};
function createLogger(options) {
  const level = options?.level || process.env.LOG_LEVEL || "info";
  const isDevelopment = process.env.NODE_ENV !== "production";
  const usePretty = options?.pretty !== void 0 ? options.pretty : isDevelopment;
  const pinoOptions = {
    level,
    ...options?.name && { name: options.name }
  };
  if (usePretty) {
    return pino({
      ...pinoOptions,
      transport: {
        target: "pino-pretty",
        options: {}
      }
    });
  }
  return pino(pinoOptions);
}

// packages/core/src/clients/memory.ts
var MemoryClient = class {
  baseUrl;
  credentials;
  logger;
  constructor(config, logger2) {
    this.baseUrl = config.memoryApiUrl;
    this.credentials = {
      username: config.twilioApiKey,
      password: config.twilioApiToken
    };
    const baseLogger = logger2 || createLogger({ name: "tac-memory" });
    this.logger = baseLogger.child({ client: "memory" });
  }
  /**
   * Retrieve memories for a specific profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to retrieve memories for
   * @param request - Optional request parameters for filtering results
   * @returns Promise containing memory retrieval response
   */
  async retrieveMemories(serviceSid, profileId, request = {}) {
    try {
      const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/Recall`;
      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId,
          request
        },
        "Retrieving memories"
      );
      const requestBody = {
        query: request.query,
        start_date: request.start_date,
        end_date: request.end_date,
        observation_limit: request.observation_limit ?? 10,
        summary_limit: request.summary_limit ?? 5,
        session_limit: request.session_limit ?? 3
      };
      const cleanedBody = Object.fromEntries(
        Object.entries(requestBody).filter(([_, value]) => value !== void 0)
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.getBasicAuthHeader()
        },
        body: JSON.stringify(cleanedBody)
      };
      this.logRequest(options.method, url, options.body);
      const response = await fetch(url, options);
      await this.logResponse(response);
      if (!response.ok) {
        this.logger.warn(
          {
            http_status: response.status,
            status_text: response.statusText,
            profile_id: profileId,
            memory_store_id: serviceSid
          },
          "Memory retrieval failed"
        );
        return EMPTY_MEMORY_RESPONSE;
      }
      const data = await response.json();
      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId
        },
        "Raw memory response received"
      );
      const validatedResponse = MemoryRetrievalResponseSchema.safeParse(data);
      if (!validatedResponse.success) {
        this.logger.warn(
          {
            profile_id: profileId,
            memory_store_id: serviceSid,
            validation_errors: validatedResponse.error.errors
          },
          "Invalid memory response format"
        );
        return EMPTY_MEMORY_RESPONSE;
      }
      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId,
          observation_count: validatedResponse.data.observations.length,
          summary_count: validatedResponse.data.summaries.length
        },
        "Memory retrieval succeeded"
      );
      return validatedResponse.data;
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          profile_id: profileId,
          memory_store_id: serviceSid
        },
        "Memory retrieval error"
      );
      return EMPTY_MEMORY_RESPONSE;
    }
  }
  /**
   * Find profiles that contain a specific identifier value
   *
   * @param serviceSid - The memory service SID
   * @param idType - Identifier type (e.g., 'phone', 'email')
   * @param value - Raw value captured for the identifier
   * @returns Promise containing profile lookup response with normalized value and matching profile IDs
   */
  async lookupProfile(serviceSid, idType, value) {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/Lookup`;
    const requestBody = {
      idType,
      value
    };
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to lookup profile: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ProfileLookupResponseSchema.parse(data);
  }
  /**
   * Fetch profile information with traits
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to fetch
   * @param traitGroups - Optional list of trait group names to include
   * @returns Promise containing profile response with ID, created timestamp, and traits
   */
  async getProfile(serviceSid, profileId, traitGroups) {
    let url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}`;
    if (traitGroups && traitGroups.length > 0) {
      url += `?traitGroups=${traitGroups.join(",")}`;
    }
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to get profile: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ProfileResponseSchema.parse(data);
  }
  /**
   * Create an observation for a profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to create the observation for
   * @param content - The observation content
   * @param source - Source of the observation (default: 'conversation-intelligence')
   * @param conversationIds - Optional array of conversation IDs associated with this observation
   * @param occurredAt - Optional timestamp when the observation occurred
   * @returns Promise containing the created observation
   */
  async createObservation(serviceSid, profileId, content, source = "conversation-intelligence", conversationIds, occurredAt) {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/Observations`;
    const requestBody = {
      content,
      source
    };
    if (conversationIds && conversationIds.length > 0) {
      requestBody.conversationIds = conversationIds;
    }
    if (occurredAt) {
      requestBody.occurredAt = occurredAt;
    }
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to create observation: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return CreateObservationResponseSchema.parse(data);
  }
  /**
   * Create conversation summaries for a profile
   *
   * @param serviceSid - The memory service SID
   * @param profileId - The profile ID to create summaries for
   * @param summaries - Array of summary items to create
   * @returns Promise containing a success message for the created conversation summaries
   */
  async createConversationSummaries(serviceSid, profileId, summaries) {
    const url = `${this.baseUrl}/v1/Stores/${serviceSid}/Profiles/${profileId}/ConversationSummaries`;
    const requestBody = {
      summaries: summaries.map((s) => ({
        content: s.content,
        conversationId: s.conversationId,
        occurredAt: s.occurredAt,
        source: s.source ?? "conversation-intelligence"
      }))
    };
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(
        `Failed to create conversation summaries: ${response.status} ${response.statusText}`
      );
    }
    const data = await response.json();
    return CreateConversationSummariesResponseSchema.parse(data);
  }
  /**
   * Get Basic Auth header for HTTP requests
   */
  getBasicAuthHeader() {
    const credentials = `${this.credentials.username}:${this.credentials.password}`;
    const encoded = Buffer.from(credentials).toString("base64");
    return `Basic ${encoded}`;
  }
  /**
   * Log HTTP request details
   */
  logRequest(method, url, body) {
    this.logger.debug(
      {
        http_method: method,
        http_url: url,
        http_body: body ? JSON.parse(body) : void 0
      },
      "Memory HTTP request"
    );
  }
  /**
   * Log HTTP response details
   */
  async logResponse(response) {
    const bodyText = await response.clone().text();
    let bodyJson;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : void 0;
    } catch {
      bodyJson = bodyText;
    }
    this.logger.debug(
      {
        http_status: response.status,
        http_status_text: response.statusText,
        http_body: bodyJson
      },
      "HTTP response"
    );
  }
};

// packages/core/src/clients/conversation.ts
var ConversationClient = class {
  baseUrl;
  credentials;
  conversationServiceId;
  logger;
  constructor(config, logger2) {
    this.baseUrl = config.conversationsApiUrl;
    this.credentials = {
      username: config.twilioApiKey,
      password: config.twilioApiToken
    };
    this.conversationServiceId = config.conversationServiceId;
    const baseLogger = logger2 || createLogger({ name: "tac-conversations" });
    this.logger = baseLogger.child({ client: "conversations" });
  }
  /**
   * Send a communication using the Conversation Orchestrator Send API
   *
   * @param conversationId - The conversation ID
   * @param request - Send communication request
   * @returns Promise containing communication response
   */
  async sendCommunication(conversationId, request) {
    const url = `${this.baseUrl}/v2/Communications`;
    const requestBody = {
      conversationId,
      ...request
    };
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      const errorBody = await response.clone().text();
      this.logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          errorBody,
          requestBody: options.body
        },
        "Send communication failed"
      );
      throw new Error(`Failed to send communication: ${response.status} ${response.statusText}`);
    }
    if (response.status !== 202) {
      this.logger.warn(
        { status: response.status, expected: 202 },
        "Send API returned unexpected success status (expected 202 Accepted)"
      );
    }
    const data = await response.json();
    return SendCommunicationResponseSchema.parse(data);
  }
  /**
   * List communications for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of communications
   */
  async listCommunications(conversationId) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Communications`;
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to list communications: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (typeof data === "object" && data !== null && "communications" in data && Array.isArray(data.communications)) {
      return data.communications.map(
        (comm) => CommunicationSchema.parse(comm)
      );
    }
    return [];
  }
  /**
   * Create a new conversation
   *
   * @param name - Optional conversation name
   * @returns Promise containing conversation response
   */
  async createConversation(name) {
    const url = `${this.baseUrl}/v2/Conversations`;
    const requestBody = {
      configurationId: this.conversationServiceId
    };
    if (name) {
      requestBody.name = name;
    }
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to create conversation: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ConversationResponseSchema.parse(data);
  }
  /**
   * Add a participant to a conversation
   *
   * @param conversationId - The conversation ID
   * @param addresses - Array of participant addresses
   * @param participantType - Type of participant (CUSTOMER, AI_AGENT, HUMAN_AGENT)
   * @returns Promise containing participant response
   */
  async addParticipant(conversationId, addresses, participantType) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Participants`;
    const requestBody = {
      type: participantType,
      addresses
    };
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to add participant: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ConversationParticipantSchema.parse(data);
  }
  /**
   * List participants in a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of participants
   */
  async listParticipants(conversationId) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}/Participants`;
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to list participants: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (typeof data === "object" && data !== null && "participants" in data && Array.isArray(data.participants)) {
      return data.participants.map(
        (participant) => ConversationParticipantSchema.parse(participant)
      );
    }
    return [];
  }
  /**
   * List conversations with optional filters
   *
   * @param filters - Optional filters (channelId, status)
   * @returns Promise containing array of conversations
   */
  async listConversations(filters) {
    const urlObj = new URL(`${this.baseUrl}/v2/Conversations`);
    if (filters?.channelId) {
      urlObj.searchParams.set("channelId", filters.channelId);
    }
    if (filters?.status && filters.status.length > 0) {
      urlObj.searchParams.set("status", filters.status.join(","));
    }
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, urlObj.toString());
    const response = await fetch(urlObj.toString(), options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to list conversations: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (typeof data === "object" && data !== null && "conversations" in data && Array.isArray(data.conversations)) {
      return data.conversations.map(
        (c) => ConversationResponseSchema.parse(c)
      );
    }
    return [];
  }
  /**
   * Update conversation status
   *
   * @param conversationId - The conversation ID
   * @param status - New status (ACTIVE, INACTIVE, CLOSED)
   * @returns Promise containing updated conversation
   */
  async updateConversation(conversationId, status) {
    const url = `${this.baseUrl}/v2/Conversations/${conversationId}`;
    const requestBody = { status };
    const options = {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to update conversation: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ConversationResponseSchema.parse(data);
  }
  /**
   * Retrieve the details for a single configuration
   *
   * @param configurationId - The configuration ID to retrieve
   * @returns Promise containing configuration details
   */
  async getConfiguration(configurationId) {
    const url = `${this.baseUrl}/v2/ControlPlane/Configurations/${configurationId}`;
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      const errorBody = await response.clone().text();
      this.logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          errorBody
        },
        "Get configuration failed"
      );
      throw new Error(`Failed to get configuration: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return ConversationConfigurationSchema.parse(data);
  }
  /**
   * Get Basic Auth header for HTTP requests
   */
  getBasicAuthHeader() {
    const credentials = `${this.credentials.username}:${this.credentials.password}`;
    const encoded = Buffer.from(credentials).toString("base64");
    return `Basic ${encoded}`;
  }
  /**
   * Log HTTP request details
   */
  logRequest(method, url, body) {
    this.logger.debug(
      {
        http_method: method,
        http_url: url,
        http_body: body ? JSON.parse(body) : void 0
      },
      "Conversations Service HTTP request"
    );
  }
  /**
   * Log HTTP response details
   */
  async logResponse(response) {
    const bodyText = await response.clone().text();
    let bodyJson;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : void 0;
    } catch {
      bodyJson = bodyText;
    }
    this.logger.debug(
      {
        http_status: response.status,
        http_status_text: response.statusText,
        http_body: bodyJson
      },
      "HTTP response"
    );
  }
};

// packages/core/src/clients/knowledge.ts
var KnowledgeClient = class {
  baseUrl;
  credentials;
  logger;
  constructor(config, logger2) {
    this.baseUrl = config.knowledgeApiUrl;
    this.credentials = {
      username: config.twilioApiKey,
      password: config.twilioApiToken
    };
    const baseLogger = logger2 || createLogger({ name: "tac-knowledge" });
    this.logger = baseLogger.child({ client: "knowledge" });
  }
  /**
   * Get knowledge base metadata
   *
   * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
   * @returns Promise containing knowledge base metadata
   */
  async getKnowledgeBase(knowledgeBaseId) {
    const url = `${this.baseUrl}/v2/ControlPlane/KnowledgeBases/${knowledgeBaseId}`;
    const options = {
      method: "GET",
      headers: {
        Authorization: this.getBasicAuthHeader()
      }
    };
    this.logRequest(options.method, url);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to get knowledge base: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return KnowledgeBaseSchema.parse(data);
  }
  /**
   * Search knowledge base for relevant content
   *
   * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
   * @param query - Search query (max 2048 characters)
   * @param topK - Maximum number of results to return (default: 5, max: 20)
   * @param knowledgeIds - Optional list of knowledge IDs to filter results
   * @returns Promise containing array of search result chunks
   */
  async searchKnowledgeBase(knowledgeBaseId, query, topK = 5, knowledgeIds) {
    const url = `${this.baseUrl}/v2/KnowledgeBases/${knowledgeBaseId}/Search`;
    const requestBody = {
      query,
      top: Math.min(Math.max(topK, 1), 20)
      // Clamp to 1-20
    };
    if (knowledgeIds && knowledgeIds.length > 0) {
      requestBody.knowledgeIds = knowledgeIds;
    }
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getBasicAuthHeader()
      },
      body: JSON.stringify(requestBody)
    };
    this.logRequest(options.method, url, options.body);
    const response = await fetch(url, options);
    await this.logResponse(response);
    if (!response.ok) {
      throw new Error(`Failed to search knowledge base: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const validated = KnowledgeSearchResponseSchema.parse(data);
    return validated.chunks;
  }
  /**
   * Get Basic Auth header for HTTP requests
   */
  getBasicAuthHeader() {
    const credentials = `${this.credentials.username}:${this.credentials.password}`;
    const encoded = Buffer.from(credentials).toString("base64");
    return `Basic ${encoded}`;
  }
  /**
   * Log HTTP request details
   */
  logRequest(method, url, body) {
    this.logger.debug(
      {
        http_method: method,
        http_url: url,
        http_body: body ? JSON.parse(body) : void 0
      },
      "Knowledge HTTP request"
    );
  }
  /**
   * Log HTTP response details
   */
  async logResponse(response) {
    const bodyText = await response.clone().text();
    let bodyJson;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : void 0;
    } catch {
      bodyJson = bodyText;
    }
    this.logger.debug(
      {
        http_status: response.status,
        http_status_text: response.statusText,
        http_body: bodyJson
      },
      "HTTP response"
    );
  }
};

// packages/core/src/lib/operator-result-processor.ts
function extractProfileIds(operatorResult) {
  const profileIds = [];
  if (operatorResult.executionDetails?.participants) {
    for (const participant of operatorResult.executionDetails.participants) {
      if (participant.profileId) {
        profileIds.push(participant.profileId);
      }
    }
  }
  return profileIds;
}
function generateContent(operatorResult) {
  const result = operatorResult.result;
  if (result === null || result === void 0) {
    return void 0;
  }
  if (typeof result === "string") {
    return result.trim() || void 0;
  }
  const jsonString = JSON.stringify(result);
  return jsonString === "{}" || jsonString === "[]" ? void 0 : jsonString;
}
function parseObservationsContent(jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent);
    if (typeof parsed === "object" && parsed !== null && "observations" in parsed) {
      const observations = parsed.observations;
      if (Array.isArray(observations)) {
        return observations.filter(
          (obs) => typeof obs === "string" && obs.trim() !== ""
        );
      }
    }
    return [];
  } catch {
    return [];
  }
}
function parseSummariesContent(jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent);
    if (typeof parsed === "object" && parsed !== null && "summaries" in parsed) {
      const summaries = parsed.summaries;
      if (Array.isArray(summaries)) {
        return summaries.filter((s) => typeof s === "string" && s.trim() !== "");
      }
    }
    return [];
  } catch {
    return [];
  }
}
var OperatorResultProcessor = class {
  memoryClient;
  config;
  logger;
  constructor(memoryClient, config, logger2) {
    this.memoryClient = memoryClient;
    this.config = config;
    this.logger = logger2 ?? createLogger({ name: "cintel-processor" });
  }
  /**
   * Process an operator result event webhook payload
   *
   * @param payload - The raw webhook payload
   * @returns Processing result indicating success/failure and details
   */
  async processEvent(payload) {
    const parseResult = OperatorResultEventSchema.safeParse(payload);
    if (!parseResult.success) {
      this.logger.warn(
        { validation_errors: parseResult.error.errors },
        "Invalid operator result event payload"
      );
      return {
        success: false,
        skipped: false,
        error: `Invalid payload: ${parseResult.error.message}`,
        createdCount: 0
      };
    }
    const event = parseResult.data;
    if (event.intelligenceConfiguration.id !== this.config.configurationId) {
      this.logger.debug(
        {
          received_config_id: event.intelligenceConfiguration.id,
          expected_config_id: this.config.configurationId
        },
        "Skipping event from different CI configuration"
      );
      return {
        success: true,
        skipped: true,
        skipReason: `Event from different CI configuration: ${event.intelligenceConfiguration.id}`,
        createdCount: 0
      };
    }
    const results = [];
    for (const operatorResult of event.operatorResults) {
      const result = await this.processOperatorResult(event, operatorResult);
      results.push(result);
    }
    const successCount = results.filter((r) => r.success && !r.skipped).length;
    const skippedCount = results.filter((r) => r.skipped).length;
    const errorCount = results.filter((r) => !r.success).length;
    const totalCreated = results.reduce((sum, r) => sum + r.createdCount, 0);
    const eventTypes = results.filter((r) => r.success && !r.skipped && r.eventType).map((r) => r.eventType);
    const uniqueEventTypes = [...new Set(eventTypes)];
    const eventType = uniqueEventTypes.length === 1 ? uniqueEventTypes[0] : uniqueEventTypes.length > 1 ? "mixed" : void 0;
    if (errorCount > 0) {
      const errors = results.filter((r) => !r.success).map((r) => r.error);
      return {
        success: false,
        eventType,
        skipped: false,
        error: `${errorCount} operator(s) failed: ${errors.join("; ")}`,
        createdCount: totalCreated
      };
    }
    if (skippedCount === results.length) {
      return {
        success: true,
        skipped: true,
        skipReason: "All operator results were skipped",
        createdCount: 0
      };
    }
    this.logger.info(
      {
        conversation_id: event.conversationId,
        success_count: successCount,
        skipped_count: skippedCount,
        created_count: totalCreated,
        event_type: eventType
      },
      "Processed operator result event"
    );
    return {
      success: true,
      eventType,
      skipped: false,
      createdCount: totalCreated
    };
  }
  /**
   * Process an individual operator result
   */
  async processOperatorResult(event, operatorResult) {
    const operatorSid = operatorResult.operator.id;
    const isObservationOperator = this.config.observationOperatorSid === operatorSid;
    const isSummaryOperator = this.config.summaryOperatorSid === operatorSid;
    if (!isObservationOperator && !isSummaryOperator) {
      this.logger.debug(
        {
          operator_sid: operatorSid,
          observation_operator_sid: this.config.observationOperatorSid,
          summary_operator_sid: this.config.summaryOperatorSid
        },
        "Skipping unconfigured operator"
      );
      return {
        success: true,
        skipped: true,
        skipReason: `Operator ${operatorSid} is not configured for processing`,
        createdCount: 0
      };
    }
    const content = generateContent(operatorResult);
    if (!content) {
      this.logger.debug(
        { operator_sid: operatorSid },
        "Skipping operator result with empty content"
      );
      return {
        success: true,
        skipped: true,
        skipReason: "Operator result has empty content",
        createdCount: 0
      };
    }
    const profileIds = extractProfileIds(operatorResult);
    if (profileIds.length === 0) {
      this.logger.warn(
        { operator_sid: operatorSid, conversation_id: event.conversationId },
        "No profile IDs found in operator result"
      );
      return {
        success: true,
        skipped: true,
        skipReason: "No profile IDs found in operator result execution details",
        createdCount: 0
      };
    }
    if (!event.memoryStoreId) {
      this.logger.warn({ conversation_id: event.conversationId }, "No memory store ID in event");
      return {
        success: false,
        skipped: false,
        error: "No memory store ID provided in event",
        createdCount: 0
      };
    }
    if (isObservationOperator) {
      return this.processObservationEvent(event, operatorResult, content, profileIds);
    } else {
      return this.processSummaryEvent(event, operatorResult, content, profileIds);
    }
  }
  /**
   * Process an observation operator result
   */
  async processObservationEvent(event, operatorResult, content, profileIds) {
    const observations = parseObservationsContent(content);
    if (observations.length === 0) {
      this.logger.debug(
        { operator_sid: operatorResult.operator.id },
        "No observations found in content"
      );
      return {
        success: true,
        eventType: "observation",
        skipped: true,
        skipReason: "No observations found in operator result content",
        createdCount: 0
      };
    }
    let createdCount = 0;
    for (const profileId of profileIds) {
      for (const observation of observations) {
        try {
          await this.memoryClient.createObservation(
            event.memoryStoreId,
            profileId,
            observation,
            "conversation-intelligence",
            [event.conversationId],
            operatorResult.dateCreated
          );
          createdCount++;
          this.logger.debug(
            {
              profile_id: profileId,
              conversation_id: event.conversationId,
              observation_preview: observation.substring(0, 100)
            },
            "Created observation"
          );
        } catch (error) {
          this.logger.error(
            {
              err: error,
              profile_id: profileId,
              conversation_id: event.conversationId
            },
            "Failed to create observation"
          );
          return {
            success: false,
            eventType: "observation",
            skipped: false,
            error: `Failed to create observation: ${error instanceof Error ? error.message : String(error)}`,
            createdCount
          };
        }
      }
    }
    return {
      success: true,
      eventType: "observation",
      skipped: false,
      createdCount
    };
  }
  /**
   * Process a summary operator result
   */
  async processSummaryEvent(event, operatorResult, content, profileIds) {
    const summaries = parseSummariesContent(content);
    if (summaries.length === 0) {
      this.logger.debug(
        { operator_sid: operatorResult.operator.id },
        "No summaries found in content"
      );
      return {
        success: true,
        eventType: "summary",
        skipped: true,
        skipReason: "No summaries found in operator result content",
        createdCount: 0
      };
    }
    let createdCount = 0;
    for (const profileId of profileIds) {
      try {
        const summaryItems = summaries.map((summaryContent) => ({
          content: summaryContent,
          conversationId: event.conversationId,
          occurredAt: operatorResult.dateCreated,
          source: "conversation-intelligence"
        }));
        await this.memoryClient.createConversationSummaries(
          event.memoryStoreId,
          profileId,
          summaryItems
        );
        createdCount += summaries.length;
        this.logger.debug(
          {
            profile_id: profileId,
            conversation_id: event.conversationId,
            summary_count: summaries.length
          },
          "Created conversation summaries"
        );
      } catch (error) {
        this.logger.error(
          {
            err: error,
            profile_id: profileId,
            conversation_id: event.conversationId
          },
          "Failed to create conversation summaries"
        );
        return {
          success: false,
          eventType: "summary",
          skipped: false,
          error: `Failed to create summaries: ${error instanceof Error ? error.message : String(error)}`,
          createdCount
        };
      }
    }
    return {
      success: true,
      eventType: "summary",
      skipped: false,
      createdCount
    };
  }
};

// packages/core/src/lib/tac.ts
var TAC = class {
  config;
  logger;
  memoryClient;
  knowledgeClient;
  conversationClient;
  channels;
  cintelProcessor;
  // Callback registrations
  messageReadyCallback;
  interruptCallback;
  handoffCallback;
  conversationEndedCallback;
  constructor(options = {}) {
    const finalConfig = options.config ? options.config instanceof TACConfig ? options.config : new TACConfig(options.config) : TACConfig.fromEnv();
    const finalLogger = options.logger ?? createLogger({ name: "tac" });
    this.config = finalConfig;
    this.logger = finalLogger;
    this.channels = /* @__PURE__ */ new Map();
    if (this.config.memoryStoreId) {
      this.memoryClient = new MemoryClient(this.config, this.logger.child({ component: "memory" }));
      this.logger.info("Memory client initialized");
      this.knowledgeClient = new KnowledgeClient(
        this.config,
        this.logger.child({ component: "knowledge" })
      );
      this.logger.info("Knowledge client initialized");
    } else {
      this.logger.info("Memory and Knowledge clients not initialized (credentials not provided)");
    }
    if (this.memoryClient && this.config.cintelConfigurationId) {
      this.cintelProcessor = new OperatorResultProcessor(
        this.memoryClient,
        {
          configurationId: this.config.cintelConfigurationId,
          observationOperatorSid: this.config.cintelObservationOperatorSid,
          summaryOperatorSid: this.config.cintelSummaryOperatorSid
        },
        this.logger.child({ component: "cintel" })
      );
      this.logger.info("Conversation Intelligence processor initialized");
    }
    this.conversationClient = new ConversationClient(
      this.config,
      this.logger.child({ component: "conversation" })
    );
  }
  /**
   * Register a channel with the framework
   */
  registerChannel(channel) {
    this.logger.info({ channel: channel.channelType }, "Registering channel");
    const existingChannel = this.channels.get(channel.channelType);
    if (existingChannel) {
      this.logger.info({ channel: channel.channelType }, "Replacing existing channel registration");
      existingChannel.shutdown();
    }
    this.channels.set(channel.channelType, channel);
    this.setupChannelEventListeners(channel);
    this.logger.info({ channel: channel.channelType }, "Channel registration complete");
  }
  /**
   * Set up event listeners for a channel
   */
  setupChannelEventListeners(channel) {
    channel.on(
      "error",
      ({ error, context }) => {
        this.logger.error({ err: error, ...context }, "Channel error");
      }
    );
    channel.on(
      "messageReceived",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async callback
      async (data) => {
        await this.handleMessageReady({ ...data, channelType: channel.channelType });
      }
    );
    channel.on(
      "prompt",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async callback
      async ({
        conversationId,
        transcript,
        userMemory,
        session
      }) => {
        const eventSession = session || channel.getConversationSession(conversationId);
        if (eventSession) {
          await this.handleMessageReady({
            conversationId,
            profileId: eventSession.profileId ? eventSession.profileId : void 0,
            message: transcript,
            author: "user",
            userMemory,
            channelType: channel.channelType
          });
        }
      }
    );
    channel.on(
      "interrupt",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async event handler
      async ({
        conversationId,
        reason,
        transcript
      }) => {
        const session = channel.getConversationSession(conversationId);
        if (session && this.interruptCallback) {
          try {
            await this.interruptCallback({
              conversationId,
              reason,
              transcript: transcript ?? void 0,
              session
            });
          } catch (error) {
            this.logger.error(
              { err: error, conversation_id: conversationId },
              "Interrupt callback error"
            );
          }
        }
      }
    );
    channel.on(
      "conversationEnded",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async event handler
      async ({ session }) => {
        if (this.conversationEndedCallback) {
          try {
            await this.conversationEndedCallback({ session });
          } catch (error) {
            this.logger.error(
              { err: error, conversation_id: session.conversationId },
              "Conversation ended callback error"
            );
          }
        }
      }
    );
  }
  /**
   * Handle message ready event from channels
   */
  async handleMessageReady(data) {
    this.logger.debug(
      {
        conversation_id: data.conversationId,
        profile_id: data.profileId,
        author: data.author,
        message_length: data.message.length,
        channel: data.channelType,
        operation: "handle_message_ready"
      },
      "Handling message ready"
    );
    if (!this.messageReadyCallback) {
      this.logger.warn("No message ready callback registered");
      return;
    }
    try {
      const channel = this.channels.get(data.channelType);
      if (!channel) {
        throw new Error(`No channel found for type ${data.channelType}`);
      }
      this.logger.debug(
        { conversation_id: data.conversationId, channel: channel.channelType },
        "Using channel for message"
      );
      const session = channel.getConversationSession(data.conversationId);
      if (!session) {
        throw new Error(`No session found for conversation ${data.conversationId}`);
      }
      let memory = data.userMemory;
      if (!memory && data.profileId && this.memoryClient && this.config.memoryStoreId) {
        this.logger.debug(
          { profile_id: data.profileId, operation: "memory_retrieval" },
          "Retrieving memory for profile"
        );
        try {
          const memoryResponse = await this.memoryClient.retrieveMemories(
            this.config.memoryStoreId,
            data.profileId
          );
          memory = new TACMemoryResponse(memoryResponse);
          this.logger.debug({ profile_id: data.profileId }, "Memory retrieved");
        } catch (error) {
          this.logger.warn({ err: error, profile_id: data.profileId }, "Failed to retrieve memory");
        }
      }
      this.logger.debug(
        { conversation_id: data.conversationId },
        "Executing message ready callback"
      );
      try {
        await this.messageReadyCallback({
          conversationId: data.conversationId,
          profileId: data.profileId,
          message: data.message,
          author: data.author,
          memory: memory ?? void 0,
          session,
          channel: channel.channelType
        });
        this.logger.debug(
          { conversation_id: data.conversationId },
          "Message ready callback completed"
        );
      } catch (error) {
        this.logger.error(
          { err: error, conversation_id: data.conversationId },
          "Message ready callback error"
        );
      }
      this.logger.debug({ conversation_id: data.conversationId }, "Message handling completed");
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: data.conversationId },
        "Message handling error"
      );
    }
  }
  /**
   * Register callback for when messages are ready to be processed
   */
  onMessageReady(callback) {
    this.messageReadyCallback = callback;
  }
  /**
   * Register callback for when user interrupts (voice channel)
   */
  onInterrupt(callback) {
    this.interruptCallback = callback;
  }
  /**
   * Register callback for human handoff
   */
  onHandoff(callback) {
    this.handoffCallback = callback;
  }
  /**
   * Register callback for when a conversation ends.
   *
   * The callback is triggered by channels when a conversation is closed
   * (e.g., SMS conversation status changed to CLOSED, or voice WebSocket
   * disconnected). The callback receives the full ConversationSession before
   * it is cleaned up.
   */
  onConversationEnded(callback) {
    this.conversationEndedCallback = callback;
  }
  /**
   * Trigger handoff callback
   */
  async triggerHandoff(conversationId, reason) {
    if (!this.handoffCallback) {
      this.logger.warn({ conversation_id: conversationId }, "No handoff callback registered");
      return;
    }
    const channel = this.getChannelByConversationId(conversationId);
    const session = channel?.getConversationSession(conversationId);
    if (!session) {
      throw new Error(`No session found for conversation ${conversationId}`);
    }
    try {
      await this.handoffCallback({
        conversationId,
        profileId: session.profileId ? session.profileId : void 0,
        reason,
        session
      });
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, "Handoff callback error");
    }
  }
  /**
   * Get channel by conversation ID
   */
  getChannelByConversationId(conversationId) {
    for (const channel of this.channels.values()) {
      if (channel.isConversationActive(conversationId)) {
        return channel;
      }
    }
    return void 0;
  }
  /**
   * Get registered channel by type
   */
  getChannel(channelType) {
    return this.channels.get(channelType);
  }
  /**
   * Get configuration
   */
  getConfig() {
    return this.config;
  }
  /**
   * Get memory client for advanced memory operations
   * Returns undefined if memory credentials are not configured
   */
  getMemoryClient() {
    return this.memoryClient;
  }
  /**
   * Get knowledge client for knowledge base operations
   * Returns undefined if memory credentials are not configured
   */
  getKnowledgeClient() {
    return this.knowledgeClient;
  }
  /**
   * Get conversation client for advanced conversation operations
   */
  getConversationClient() {
    return this.conversationClient;
  }
  /**
   * Check if Twilio Memory functionality is enabled
   *
   * @returns true if memory client is initialized, false otherwise
   */
  isMemoryEnabled() {
    return this.memoryClient !== void 0;
  }
  /**
   * Check if Knowledge functionality is enabled
   *
   * @returns true if knowledge client is initialized, false otherwise
   */
  isKnowledgeEnabled() {
    return this.knowledgeClient !== void 0;
  }
  /**
   * Check if Conversation Intelligence processing is enabled
   *
   * @returns true if CI processor is initialized, false otherwise
   */
  isCintelEnabled() {
    return this.cintelProcessor !== void 0;
  }
  /**
   * Process a Conversation Intelligence operator result webhook event
   *
   * @param payload - The raw webhook payload from CI
   * @returns Promise containing the processing result
   * @throws Error if CI processor is not initialized
   */
  async processCintelEvent(payload) {
    if (!this.cintelProcessor) {
      throw new Error(
        "Conversation Intelligence processor is not initialized. Ensure both memory credentials and cintelConfigurationId are provided."
      );
    }
    return this.cintelProcessor.processEvent(payload);
  }
  /**
   * Retrieve memories from Memory API or fallback to Conversations API
   *
   * @param session - Conversation session context
   * @param query - Optional semantic search query
   * @returns Promise containing TACMemoryResponse wrapper providing unified access to memory data.
   *
   * When Memory is configured:
   * - observations, summaries, and communications available
   * - communications include author name and type
   *
   * When using Maestro fallback:
   * - observations and summaries are empty arrays
   * - communications have basic fields only (no author name/type)
   */
  async retrieveMemory(session, query) {
    if (this.memoryClient && this.config.memoryStoreId) {
      if (!session.profileId) {
        if (!session.authorInfo || !session.authorInfo.address) {
          throw new Error(
            "profileId is required for memory retrieval but was not found in conversation context. Additionally, authorInfo.address is not available for profile lookup. Ensure either profileId or authorInfo.address is provided when creating the ConversationSession."
          );
        }
        const address = session.authorInfo.address;
        let identityType;
        if (address.includes("@")) {
          identityType = "email";
        } else if (address.startsWith("+")) {
          identityType = "phone";
        } else {
          throw new Error(
            `Unsupported authorInfo.address format '${address}'. Expected an email address containing '@' or a phone number starting with '+'.`
          );
        }
        this.logger.debug(
          { identityType, address, channel: session.channel },
          "profileId not found, attempting to lookup profile"
        );
        try {
          const lookupResponse = await this.memoryClient.lookupProfile(
            this.config.memoryStoreId,
            identityType,
            session.authorInfo.address
          );
          if (!lookupResponse.profiles || lookupResponse.profiles.length === 0) {
            throw new Error(
              `No profile found for ${identityType} ${session.authorInfo.address}. Profile lookup returned no results. Ensure the identity is registered in the identity resolution system.`
            );
          }
          session.profileId = lookupResponse.profiles[0];
        } catch (error) {
          this.logger.error(
            { err: error },
            `Failed to lookup profile for ${session.authorInfo.address}`
          );
          throw error;
        }
      }
      try {
        const memoryResponse = await this.memoryClient.retrieveMemories(
          this.config.memoryStoreId,
          session.profileId,
          { query }
        );
        return new TACMemoryResponse(memoryResponse);
      } catch (error) {
        this.logger.error({ err: error }, "Failed to retrieve memory");
        throw error;
      }
    } else {
      this.logger.info("Twilio Memory not configured, falling back to Conversations API");
      try {
        const communications = await this.conversationClient.listCommunications(
          session.conversationId
        );
        return new TACMemoryResponse(communications);
      } catch (error) {
        this.logger.error({ err: error }, "Failed to retrieve communications");
        throw error;
      }
    }
  }
  /**
   * Fetch profile information with traits
   *
   * @param profileId - Profile ID to fetch
   * @returns Promise containing profile response or undefined if not available
   */
  async fetchProfile(profileId) {
    if (!this.memoryClient || !this.config.memoryStoreId) {
      this.logger.warn(
        "Memory client is not initialized. Cannot fetch profile. Provide memory credentials when creating TAC to enable profile fetching."
      );
      return void 0;
    }
    if (!profileId) {
      this.logger.warn("profile_id is required for profile fetching but was not provided");
      return void 0;
    }
    try {
      const traitGroups = this.config.traitGroups;
      const profileResponse = await this.memoryClient.getProfile(
        this.config.memoryStoreId,
        profileId,
        traitGroups
      );
      return profileResponse;
    } catch (error) {
      this.logger.error({ err: error }, `Failed to fetch profile for ${profileId}`);
      return void 0;
    }
  }
  /**
   * Shutdown TAC and cleanup resources
   */
  shutdown() {
    for (const channel of this.channels.values()) {
      this.logger.debug({ channel: channel.channelType }, "Shutting down channel");
      channel.shutdown();
    }
    this.channels.clear();
    this.logger.info("TAC shutdown complete");
  }
};

// packages/core/src/channels/base.ts
var BaseChannel = class {
  tac;
  config;
  logger;
  conversationClient;
  activeConversations;
  callbacks;
  constructor(tac) {
    this.tac = tac;
    this.config = tac.getConfig();
    this.logger = tac.logger.child({ component: "channel" });
    this.conversationClient = tac.getConversationClient();
    this.activeConversations = /* @__PURE__ */ new Map();
    this.callbacks = {};
  }
  /**
   * Register event callbacks
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  on(event, callback) {
    switch (event) {
      case "conversationStarted":
        this.callbacks.onConversationStarted = callback;
        break;
      case "conversationEnded":
        this.callbacks.onConversationEnded = callback;
        break;
      case "error":
        this.callbacks.onError = callback;
        break;
    }
  }
  /**
   * Start a new conversation session
   */
  startConversation(conversationId, profileId, serviceId) {
    if (this.activeConversations.has(conversationId)) {
      this.logger.debug(
        {
          conversation_id: conversationId,
          profile_id: this.activeConversations.get(conversationId)?.profileId,
          service_id: this.activeConversations.get(conversationId)?.serviceId
        },
        "Conversation already active"
      );
      return this.activeConversations.get(conversationId);
    }
    const session = {
      conversationId,
      profileId,
      serviceId,
      channel: this.channelType,
      startedAt: /* @__PURE__ */ new Date(),
      metadata: {}
    };
    this.activeConversations.set(conversationId, session);
    this.logger.debug(
      {
        conversation_id: conversationId,
        profile_id: profileId,
        service_id: serviceId,
        channel: this.channelType
      },
      "Conversation started"
    );
    if (this.callbacks.onConversationStarted) {
      this.callbacks.onConversationStarted({ session });
    }
    return session;
  }
  /**
   * End a conversation session.
   *
   * Triggers the onConversationEnded callback BEFORE removing the session,
   * so the callback receives the full ConversationSession data.
   * Errors in the callback do not prevent session cleanup.
   */
  async endConversation(conversationId) {
    const session = this.activeConversations.get(conversationId);
    if (session) {
      if (this.callbacks.onConversationEnded) {
        try {
          await this.callbacks.onConversationEnded({ session });
        } catch (error) {
          this.logger.error(
            { err: error, conversation_id: conversationId },
            "Error in conversation ended callback"
          );
        }
      }
      this.activeConversations.delete(conversationId);
      this.logger.debug(
        {
          conversation_id: conversationId,
          channel: this.channelType,
          service_id: session.serviceId
        },
        "Conversation ended"
      );
    } else {
      this.logger.debug(
        { conversation_id: conversationId, channel: this.channelType },
        "Conversation end requested but no active session found"
      );
    }
  }
  /**
   * Get an active conversation session
   */
  getConversationSession(conversationId) {
    return this.activeConversations.get(conversationId);
  }
  /**
   * Check if a conversation is active
   */
  isConversationActive(conversationId) {
    return this.activeConversations.has(conversationId);
  }
  /**
   * Handle errors with proper context
   */
  handleError(error, context) {
    this.logger.error({ err: error, ...context }, "Channel error");
    if (this.callbacks.onError) {
      if (context) {
        this.callbacks.onError({ error, context });
      } else {
        this.callbacks.onError({ error });
      }
    }
  }
  /**
   * Validate webhook payload (override in subclasses for specific validation)
   */
  validateWebhookPayload(payload) {
    return payload !== null && payload !== void 0;
  }
  /**
   * Cleanup resources when shutting down
   */
  shutdown() {
    this.activeConversations.clear();
    delete this.callbacks.onConversationStarted;
    delete this.callbacks.onConversationEnded;
    delete this.callbacks.onError;
  }
};

// packages/core/src/channels/messaging.ts
var DEFAULT_DEDUP_CAPACITY = 1e4;
var MessagingChannel = class extends BaseChannel {
  messagingCallbacks;
  processedTokens = /* @__PURE__ */ new Set();
  maxTrackedTokens;
  constructor(tac, config) {
    super(tac);
    this.messagingCallbacks = {};
    const capacity = config?.dedupCapacity ?? DEFAULT_DEDUP_CAPACITY;
    if (capacity < 1 || !Number.isInteger(capacity)) {
      throw new Error("dedupCapacity must be a positive integer");
    }
    this.maxTrackedTokens = capacity;
  }
  /**
   * Check if a webhook has already been processed, and if not, record the token immediately.
   * This is intentionally a single synchronous check-and-record to prevent race conditions
   * where a duplicate arrives while the first request is still awaiting async work.
   * Uses a sliding window with FIFO eviction at capacity.
   */
  isDuplicateWebhook(idempotencyToken) {
    if (this.processedTokens.has(idempotencyToken)) {
      return true;
    }
    if (this.processedTokens.size >= this.maxTrackedTokens) {
      const oldest = this.processedTokens.values().next().value;
      this.processedTokens.delete(oldest);
    }
    this.processedTokens.add(idempotencyToken);
    return false;
  }
  /**
   * Register event callbacks (override for messaging-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  on(event, callback) {
    if (event === "messageReceived") {
      this.messagingCallbacks.onMessageReceived = callback;
    } else {
      super.on(event, callback);
    }
  }
  /**
   * Check if this webhook event belongs to this channel.
   * Returns false if the event is clearly for a different channel type.
   */
  isEventForThisChannel(webhookData) {
    const eventType = webhookData.eventType;
    const authorChannel = webhookData.data?.author?.channel;
    if (eventType === "COMMUNICATION_CREATED") {
      if (!authorChannel) {
        return false;
      }
      return authorChannel === this.channelType.toUpperCase();
    }
    if (eventType === "CONVERSATION_UPDATED") {
      const conversationId = this.extractConversationId(webhookData);
      if (conversationId && !this.isConversationActive(conversationId)) {
        return false;
      }
    }
    return true;
  }
  /**
   * Process messaging channel webhook from Twilio Conversations Service
   */
  async processWebhook(payload, idempotencyToken) {
    this.logger.debug({ operation: "webhook_processing", payload }, "Processing webhook");
    try {
      if (idempotencyToken && this.isDuplicateWebhook(idempotencyToken)) {
        this.logger.debug({ idempotency_token: idempotencyToken }, "Skipping duplicate webhook");
        return;
      }
      if (!this.validateWebhookPayload(payload)) {
        throw new Error("Invalid webhook payload");
      }
      const webhookData = payload;
      const eventType = webhookData.eventType;
      const conversationId = webhookData.data?.conversationId || webhookData.data?.id;
      if (!this.isEventForThisChannel(webhookData)) {
        this.logger.debug(
          { event_type: eventType, channel: this.channelType, conversation_id: conversationId },
          "Ignoring event for different channel type"
        );
        return;
      }
      this.logger.info(
        {
          event_type: eventType,
          raw_event_type: webhookData.eventType,
          conversation_id: conversationId
        },
        "Processing webhook event"
      );
      switch (eventType) {
        case "CONVERSATION_CREATED":
          this.logger.debug(
            { conversation_id: conversationId, profile_id: webhookData.data?.profileId },
            "Handling CONVERSATION_CREATED"
          );
          this.handleConversationCreated(webhookData);
          break;
        case "PARTICIPANT_ADDED":
          this.logger.debug(
            { conversation_id: conversationId, profile_id: webhookData.data?.profileId },
            "Handling PARTICIPANT_ADDED"
          );
          this.handleParticipantAdded(webhookData);
          break;
        case "COMMUNICATION_CREATED":
          this.logger.debug({ conversation_id: conversationId }, "Handling COMMUNICATION_CREATED");
          await this.handleCommunicationCreated(webhookData);
          break;
        case "CONVERSATION_UPDATED":
          this.logger.debug(
            { conversation_id: conversationId, status: webhookData.data?.status },
            "Handling CONVERSATION_UPDATED"
          );
          await this.handleConversationUpdated(webhookData);
          break;
        default:
          this.logger.warn(
            {
              event_type: eventType,
              raw_event_type: webhookData.eventType,
              conversation_id: conversationId,
              payload
            },
            "Unhandled event type - this event will be ignored"
          );
      }
      this.logger.debug({ event_type: eventType }, "Webhook processing completed");
    } catch (error) {
      if (idempotencyToken) {
        this.processedTokens.delete(idempotencyToken);
      }
      this.logger.error(
        { err: error, operation: "webhook_processing" },
        "Webhook processing error"
      );
      this.handleError(error instanceof Error ? error : new Error(String(error)), { payload });
    }
  }
  /**
   * Handle conversation creation event
   */
  handleConversationCreated(payload) {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    if (!conversationId) {
      this.logger.warn(
        { payload, operation: "handle_conversation_created" },
        "Missing conversation ID in conversation.created event"
      );
      throw new Error("Missing conversation ID in conversation.created event");
    }
    this.startConversation(conversationId, profileId ?? void 0, payload.data?.serviceId);
  }
  /**
   * Handle participant added event
   */
  handleParticipantAdded(payload) {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    if (!conversationId) {
      this.logger.warn(
        { payload, operation: "handle_participant_added" },
        "Missing conversation ID in participant.added event"
      );
      throw new Error("Missing conversation ID in participant.added event");
    }
    if (this.isConversationActive(conversationId)) {
      const session = this.getConversationSession(conversationId);
      if (session) {
        if (profileId) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_profile_id: session.profileId,
              new_profile_id: profileId
            },
            "Updating conversation profile ID from participant.added"
          );
          session.profileId = profileId;
        }
        if (payload.data?.serviceId && session.serviceId !== payload.data.serviceId) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_service_id: session.serviceId,
              new_service_id: payload.data.serviceId
            },
            "Updating conversation configuration ID from participant.added"
          );
          session.serviceId = payload.data.serviceId;
        }
      }
    } else {
      this.logger.debug(
        { conversation_id: conversationId, profile_id: profileId },
        "Auto-starting conversation from participant.added"
      );
      this.startConversation(conversationId, profileId ?? void 0, payload.data?.serviceId);
    }
  }
  /**
   * Handle new communication event (incoming message)
   */
  async handleCommunicationCreated(payload) {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    const message = payload.data?.content?.text?.trim();
    const author = payload.data?.author?.address || "unknown";
    this.logger.info(
      {
        conversation_id: conversationId,
        profile_id: profileId,
        author,
        message,
        message_length: message?.length,
        operation: "handle_communication_created"
      },
      "Handling communication.created"
    );
    if (!conversationId) {
      this.logger.warn(
        { payload, operation: "handle_communication_created" },
        "Missing conversation ID in communication.created event"
      );
      throw new Error("Missing conversation ID in communication.created event");
    }
    if (!message) {
      this.logger.info({ conversation_id: conversationId }, "Ignoring empty message");
      return;
    }
    if (this.isOwnMessage(author)) {
      this.logger.info(
        {
          conversation_id: conversationId,
          author_address: author
        },
        "Ignoring message from AI agent"
      );
      return;
    }
    if (!this.isConversationActive(conversationId)) {
      this.logger.debug({ conversation_id: conversationId }, "Starting new conversation");
      this.startConversation(conversationId, profileId ?? void 0, payload.data?.serviceId);
    } else if (payload.data?.serviceId) {
      const session2 = this.getConversationSession(conversationId);
      if (session2 && session2.serviceId !== payload.data.serviceId) {
        this.logger.debug(
          {
            conversation_id: conversationId,
            old_service_id: session2.serviceId,
            new_service_id: payload.data.serviceId
          },
          "Updating conversation configuration ID from communication.created"
        );
        session2.serviceId = payload.data.serviceId;
      }
    }
    const session = this.getConversationSession(conversationId);
    if (session) {
      session.authorInfo = {
        address: author,
        participantId: payload.data?.author?.participantId
      };
      if (payload.data?.channelId) {
        if (!session.metadata) {
          session.metadata = {};
        }
        session.metadata.channelId = payload.data.channelId;
        this.logger.debug(
          { conversation_id: conversationId, channel_id: payload.data.channelId },
          "Stored channelId in session metadata"
        );
      }
    }
    let userMemory;
    if (session && this.tac.isMemoryEnabled()) {
      this.logger.debug({ conversation_id: conversationId, author }, "Retrieving user memory");
      try {
        userMemory = await this.tac.retrieveMemory(session, message);
        this.logger.debug(
          { conversation_id: conversationId, profile_id: session.profileId },
          "User memory retrieved"
        );
      } catch (error) {
        this.logger.warn(
          { err: error, conversation_id: conversationId },
          "Failed to retrieve user memory"
        );
      }
    }
    if (this.messagingCallbacks.onMessageReceived) {
      this.logger.debug({ conversation_id: conversationId }, "Invoking message received callback");
      this.messagingCallbacks.onMessageReceived({
        conversationId,
        profileId: session?.profileId ?? profileId ?? void 0,
        message,
        author,
        userMemory
      });
    }
  }
  /**
   * Handle conversation updated event
   */
  async handleConversationUpdated(payload) {
    const conversationId = this.extractConversationId(payload);
    if (!conversationId) {
      throw new Error("Missing conversation ID in conversation.updated event");
    }
    if (payload.data?.status === "CLOSED") {
      this.logger.info(
        { conversation_id: conversationId, status: payload.data.status },
        "Conversation closed, cleaning up"
      );
      await this.endConversation(conversationId);
    }
  }
  /**
   * Extract conversation ID from webhook payload
   */
  extractConversationId(payload) {
    const webhookData = payload;
    const conversationId = webhookData.data?.conversationId || webhookData.data?.id;
    if (conversationId && isConversationId(conversationId)) {
      return conversationId;
    }
    return null;
  }
  /**
   * Extract profile ID from webhook payload
   */
  extractProfileId(payload) {
    const webhookData = payload;
    const profileId = webhookData.data?.profileId;
    if (profileId && isProfileId(profileId)) {
      this.logger.debug(
        { profile_id: profileId, conversation_id: webhookData.data?.conversationId },
        "Extracted profile ID from webhook payload"
      );
      return profileId;
    }
    this.logger.debug(
      { conversation_id: webhookData.data?.conversationId },
      "Profile ID missing or invalid in webhook payload"
    );
    return null;
  }
  /**
   * Validate messaging channel webhook payload structure
   */
  validateWebhookPayload(payload) {
    if (!super.validateWebhookPayload(payload)) {
      return false;
    }
    const webhookData = payload;
    return typeof webhookData === "object" && typeof webhookData.eventType === "string" && webhookData.eventType.length > 0;
  }
};

// packages/core/src/channels/sms.ts
var SMSChannel = class extends MessagingChannel {
  get channelType() {
    return "sms";
  }
  /**
   * Check if a message is from the bot itself (by phone number)
   */
  isOwnMessage(authorAddress) {
    return authorAddress === this.config.twilioPhoneNumber;
  }
  /**
   * Send SMS response using Conversation Orchestrator Send API
   */
  async sendResponse(conversationId, message, metadata) {
    this.logger.debug(
      {
        conversation_id: conversationId,
        message_length: message.length,
        operation: "send_response"
      },
      "Sending SMS response"
    );
    try {
      const session = this.getConversationSession(conversationId);
      if (!session) {
        throw new Error(`No active session found for conversation ${conversationId}`);
      }
      if (!session.authorInfo) {
        throw new Error(
          `No author info found for conversation ${conversationId} - no inbound message received yet`
        );
      }
      const recipientAddress = session.authorInfo.address;
      const participants = await this.conversationClient.listParticipants(conversationId);
      const smsParticipants = participants.filter(
        (p) => Array.isArray(p.addresses) && p.addresses.some(
          (addr) => addr.channel === "SMS" && addr.address === this.config.twilioPhoneNumber
        )
      );
      const agentParticipant = smsParticipants.find(
        (p) => p.type === "AI_AGENT" || p.type === "HUMAN_AGENT" || p.type === "AGENT"
      ) ?? smsParticipants[0];
      if (!agentParticipant) {
        throw new Error(
          `Agent participant not found for conversation ${conversationId} with phone ${this.config.twilioPhoneNumber}`
        );
      }
      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_address: recipientAddress,
          recipient_participant_id: session.authorInfo.participantId,
          agent_participant_id: agentParticipant.id,
          from_number: this.config.twilioPhoneNumber
        },
        "Sending SMS via Send API"
      );
      await this.conversationClient.sendCommunication(conversationId, {
        author: {
          address: this.config.twilioPhoneNumber,
          channel: "SMS",
          participantId: agentParticipant.id
        },
        recipients: [
          {
            address: recipientAddress,
            channel: "SMS",
            participantId: session.authorInfo.participantId
          }
        ],
        content: {
          type: "TEXT",
          text: message
        }
      });
      this.logger.info(
        { conversation_id: conversationId, recipient_address: recipientAddress },
        "SMS sent successfully via Send API"
      );
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, "Send response error");
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message,
        metadata
      });
      throw error;
    }
  }
};

// packages/core/src/channels/chat.ts
var ChatChannel = class extends MessagingChannel {
  agentAddress;
  constructor(tac, config) {
    super(tac, config);
    this.agentAddress = config?.agentAddress ?? "ai-assistant";
  }
  get channelType() {
    return "chat";
  }
  /**
   * Check if a message is from the bot itself (by agent address)
   */
  isOwnMessage(authorAddress) {
    return authorAddress === this.agentAddress;
  }
  /**
   * Send chat response using Conversation Orchestrator Send API
   */
  async sendResponse(conversationId, message, metadata) {
    this.logger.debug(
      {
        conversation_id: conversationId,
        message_length: message.length,
        operation: "send_response"
      },
      "Sending chat response"
    );
    try {
      const session = this.getConversationSession(conversationId);
      if (!session) {
        throw new Error(`No active session found for conversation ${conversationId}`);
      }
      if (!session.authorInfo) {
        throw new Error(
          `No author info found for conversation ${conversationId} - no inbound message received yet`
        );
      }
      const chatChannelSid = typeof session.metadata?.channelId === "string" ? session.metadata.channelId : void 0;
      if (!chatChannelSid) {
        throw new Error(
          `No channelId found in session metadata for conversation ${conversationId}`
        );
      }
      const recipientAddress = session.authorInfo.address;
      const participants = await this.conversationClient.listParticipants(conversationId);
      let agentParticipant = participants.find((p) => p.type === "AI_AGENT" || p.type === "AGENT");
      if (!agentParticipant) {
        this.logger.debug(
          {
            conversation_id: conversationId,
            agent_address: this.agentAddress,
            channel_id: chatChannelSid
          },
          "No AI_AGENT participant found, creating one"
        );
        try {
          agentParticipant = await this.conversationClient.addParticipant(
            conversationId,
            [{ channel: "CHAT", address: this.agentAddress, channelId: chatChannelSid }],
            "AI_AGENT"
          );
          this.logger.info(
            {
              conversation_id: conversationId,
              participant_id: agentParticipant.id,
              agent_address: this.agentAddress,
              channel_id: chatChannelSid
            },
            "Created AI_AGENT participant"
          );
        } catch (error) {
          this.logger.warn(
            { err: error, conversation_id: conversationId },
            "Failed to create AI_AGENT participant, attempting to list participants again"
          );
          const retriedParticipants = await this.conversationClient.listParticipants(conversationId);
          agentParticipant = retriedParticipants.find(
            (p) => p.type === "AI_AGENT" || p.type === "AGENT"
          );
          if (!agentParticipant) {
            throw new Error(
              `Failed to create or find AI_AGENT participant for conversation ${conversationId}`
            );
          }
        }
      }
      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_address: recipientAddress,
          recipient_participant_id: session.authorInfo.participantId,
          agent_participant_id: agentParticipant.id,
          agent_address: this.agentAddress
        },
        "Sending chat message via Send API"
      );
      const sendRequest = {
        author: {
          address: this.agentAddress,
          channel: "CHAT",
          participantId: agentParticipant.id
        },
        recipients: [
          {
            address: recipientAddress,
            channel: "CHAT",
            participantId: session.authorInfo.participantId
          }
        ],
        content: {
          type: "TEXT",
          text: message
        },
        channelId: chatChannelSid
      };
      await this.conversationClient.sendCommunication(conversationId, sendRequest);
      this.logger.info(
        { conversation_id: conversationId, channel_id: chatChannelSid },
        "Chat message sent successfully via Send API"
      );
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, "Send response error");
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message,
        metadata
      });
      throw error;
    }
  }
};
var VoiceChannel = class extends BaseChannel {
  webSocketConnections;
  voiceCallbacks;
  streamTasks;
  promptQueues;
  initializationRetries;
  MAX_INITIALIZATION_RETRIES = 3;
  constructor(tac) {
    super(tac);
    this.webSocketConnections = /* @__PURE__ */ new Map();
    this.voiceCallbacks = {};
    this.streamTasks = /* @__PURE__ */ new Map();
    this.promptQueues = /* @__PURE__ */ new Map();
    this.initializationRetries = /* @__PURE__ */ new Map();
  }
  get channelType() {
    return "voice";
  }
  /**
   * Register event callbacks (override for Voice-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  on(event, callback) {
    switch (event) {
      case "setup":
        this.voiceCallbacks.onSetup = callback;
        break;
      case "prompt":
        this.voiceCallbacks.onPrompt = callback;
        break;
      case "interrupt":
        this.voiceCallbacks.onInterrupt = callback;
        break;
      case "webSocketConnected":
        this.voiceCallbacks.onWebSocketConnected = callback;
        break;
      case "webSocketDisconnected":
        this.voiceCallbacks.onWebSocketDisconnected = callback;
        break;
      default:
        super.on(event, callback);
        break;
    }
  }
  /**
   * Process webhook - Voice channel doesn't use traditional webhooks,
   * but this method is required by the base class
   */
  processWebhook(_payload) {
    this.logger.warn("processWebhook called but Voice channel uses WebSocket connections");
    return Promise.resolve();
  }
  /**
   * Get active WebSocket connection for a conversation
   */
  getWebsocket(conversationId) {
    return this.webSocketConnections.get(conversationId) || null;
  }
  /**
   * Handle WebSocket connection from ConversationRelay
   */
  handleWebSocketConnection(ws) {
    let conversationId = null;
    let callSid = null;
    let fromNumber = null;
    let initializationFailed = false;
    ws.on("message", (data) => {
      (async () => {
        try {
          const messageData = JSON.parse(data.toString());
          const result = WebSocketMessageSchema.safeParse(messageData);
          if (!result.success) {
            this.logger.debug(
              {
                raw_message: messageData,
                validation_errors: result.error.errors.map((error) => ({
                  path: error.path.join("."),
                  message: error.message
                }))
              },
              "Invalid or unrecognized WebSocket message, skipping"
            );
            return;
          }
          const message = result.data;
          switch (message.type) {
            case "setup":
              callSid = message.callSid;
              fromNumber = message.from;
              if (this.voiceCallbacks.onSetup) {
                this.voiceCallbacks.onSetup({
                  callSid,
                  from: message.from,
                  to: message.to,
                  customParameters: message.customParameters
                });
              }
              break;
            case "prompt":
              if (!conversationId && callSid) {
                const retryCount = this.initializationRetries.get(callSid) ?? 0;
                if (retryCount >= this.MAX_INITIALIZATION_RETRIES) {
                  throw new Error(
                    `Cannot process prompt - conversation initialization failed after ${retryCount} attempts for callSid ${callSid}`
                  );
                }
                try {
                  if (initializationFailed) {
                    this.logger.info(
                      { call_sid: callSid, retry_count: retryCount },
                      "Retrying conversation initialization after previous failure"
                    );
                  }
                  const conversations = await this.conversationClient.listConversations({
                    channelId: callSid
                  });
                  if (conversations.length !== 1) {
                    throw new Error(
                      `Expected exactly 1 conversation for callSid ${callSid}, but found ${conversations.length}`
                    );
                  }
                  const conversation = conversations[0];
                  conversationId = conversation.id;
                  const participants = await this.conversationClient.listParticipants(conversationId);
                  let profileId;
                  if (fromNumber) {
                    for (const participant of participants) {
                      if (participant.addresses) {
                        for (const address of participant.addresses) {
                          if (address.channel === "VOICE" && address.address === fromNumber && participant.profileId) {
                            profileId = participant.profileId;
                            break;
                          }
                        }
                      }
                      if (profileId) {
                        break;
                      }
                    }
                  }
                  this.webSocketConnections.set(conversationId, ws);
                  const session = this.startConversation(conversationId, profileId);
                  if (fromNumber) {
                    session.authorInfo = {
                      address: fromNumber
                    };
                  }
                  if (this.voiceCallbacks.onWebSocketConnected) {
                    this.voiceCallbacks.onWebSocketConnected({ conversationId });
                  }
                  initializationFailed = false;
                  this.initializationRetries.delete(callSid);
                  this.logger.info(
                    { conversation_id: conversationId, call_sid: callSid },
                    "Conversation initialization succeeded"
                  );
                } catch (err) {
                  initializationFailed = true;
                  this.initializationRetries.set(callSid, retryCount + 1);
                  this.logger.error(
                    { err, call_sid: callSid, retry_count: retryCount + 1 },
                    "Conversation initialization failed"
                  );
                  throw err;
                }
              }
              if (conversationId) {
                const previousPrompt = this.promptQueues.get(conversationId) ?? Promise.resolve();
                const currentPrompt = previousPrompt.then(() => this.handlePromptMessage(conversationId, message)).catch((err) => {
                  this.handleError(err instanceof Error ? err : new Error(String(err)), {
                    conversationId,
                    message: data.toString()
                  });
                });
                this.promptQueues.set(conversationId, currentPrompt);
              } else {
                this.logger.warn("Received prompt before conversation initialized");
              }
              break;
            case "interrupt":
              if (conversationId) {
                this.handleInterruptMessage(conversationId, message);
              }
              break;
            default:
              this.logger.debug(
                { conversation_id: conversationId, message: messageData },
                "Unhandled WebSocket event type"
              );
              break;
          }
        } catch (error) {
          this.handleError(error instanceof Error ? error : new Error(String(error)), {
            conversationId,
            callSid,
            message: data.toString()
          });
        }
      })().catch((err) => {
        this.logger.error({ err }, "Unhandled error in WebSocket message handler");
      });
    });
    ws.on("close", () => {
      if (conversationId) {
        void this.handleWebSocketDisconnect(conversationId).catch((err) => {
          this.logger.error(
            { err, conversation_id: conversationId },
            "WebSocket disconnect handler error"
          );
        });
      }
      if (callSid) {
        this.initializationRetries.delete(callSid);
      }
    });
    ws.on("error", (error) => {
      this.handleError(error, { conversationId });
    });
  }
  /**
   * Handle WebSocket prompt message (user speech)
   */
  async handlePromptMessage(conversationId, message) {
    const transcript = message.voicePrompt;
    this.cancelStreamTask(conversationId);
    const session = this.getConversationSession(conversationId);
    let userMemory;
    if (session && this.tac.isMemoryEnabled()) {
      try {
        userMemory = await this.tac.retrieveMemory(session, transcript);
        this.logger.debug({ conversation_id: conversationId }, "Retrieved memory for active voice");
      } catch (error) {
        this.logger.warn(
          { err: error, conversation_id: conversationId },
          "Failed to retrieve memory for active voice"
        );
      }
    }
    if (this.voiceCallbacks.onPrompt) {
      this.voiceCallbacks.onPrompt({
        conversationId,
        transcript,
        ...userMemory !== void 0 && { userMemory },
        ...session !== void 0 && { session }
      });
    }
  }
  /**
   * Handle WebSocket interrupt message
   */
  handleInterruptMessage(conversationId, message) {
    const { reason, transcript } = message;
    const cancelled = this.cancelStreamTask(conversationId);
    if (cancelled) {
      this.logger.info(
        { conversation_id: conversationId },
        "Cancelled stream task due to interrupt"
      );
    }
    if (this.voiceCallbacks.onInterrupt) {
      this.voiceCallbacks.onInterrupt({
        conversationId,
        reason: reason ?? "unknown",
        transcript: transcript ?? void 0
      });
    }
  }
  /**
   * Handle WebSocket disconnection
   */
  async handleWebSocketDisconnect(conversationId) {
    this.webSocketConnections.delete(conversationId);
    this.promptQueues.delete(conversationId);
    if (this.voiceCallbacks.onWebSocketDisconnected) {
      this.voiceCallbacks.onWebSocketDisconnected({ conversationId });
    }
    await this.endConversation(conversationId);
  }
  /**
   * Send voice response via WebSocket
   */
  sendResponse(conversationId, message, metadata) {
    try {
      const ws = this.webSocketConnections.get(conversationId);
      if (ws?.readyState !== WebSocket.OPEN) {
        throw new Error(`No active WebSocket connection for conversation ${conversationId}`);
      }
      const response = {
        type: "text",
        token: message,
        last: true
      };
      ws.send(JSON.stringify(response));
      return Promise.resolve();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message,
        metadata
      });
      throw error;
    }
  }
  // =========================================================================
  // Incoming Call Handling
  // =========================================================================
  /**
   * Handle incoming voice call - generate TwiML to connect to ConversationRelay
   *
   * ConversationRelay will create the conversation automatically. The conversation
   * will be initialized on the first prompt using the callSid.
   *
   * @param options - Options for handling the incoming call
   * @returns TwiML XML string with ConversationRelay configuration
   */
  handleIncomingCall(options) {
    const { actionUrl, conversationRelayConfig } = options;
    return this.connectConversationRelay(
      {
        ...conversationRelayConfig,
        conversationConfiguration: conversationRelayConfig.conversationConfiguration ?? this.config.conversationServiceId
      },
      actionUrl ? { actionUrl } : void 0
    );
  }
  // =========================================================================
  // ConversationRelay Callback Handling
  // =========================================================================
  /**
   * Handle ConversationRelay callback from Twilio
   *
   * @param payload - Callback payload from Twilio
   * @param handoffHandler - Optional handler for handoff requests
   * @returns Response with status, content, and content type
   */
  async handleConversationRelayCallback(payload, handoffHandler) {
    this.logger.debug(
      { call_sid: payload.CallSid, call_status: payload.CallStatus },
      "ConversationRelay callback received"
    );
    if (payload.CallStatus === "in-progress" && payload.HandoffData) {
      if (handoffHandler) {
        try {
          const response = await handoffHandler(payload);
          return { status: 200, content: response, contentType: "application/xml" };
        } catch (error) {
          this.logger.error({ err: error }, "Handoff handler failed");
          return { status: 500, content: "Handoff handler error", contentType: "text/plain" };
        }
      }
      return { status: 501, content: "No handoff handler registered", contentType: "text/plain" };
    }
    if (payload.CallStatus === "completed") {
      await this.closeConversationsForCall(payload.CallSid);
    }
    return { status: 200, content: "OK", contentType: "text/plain" };
  }
  /**
   * Close all conversations associated with a call
   */
  async closeConversationsForCall(callSid) {
    try {
      const conversationClient = this.tac.getConversationClient();
      const conversations = await conversationClient.listConversations({ channelId: callSid });
      this.logger.info(
        { call_sid: callSid, count: conversations.length },
        "Closing conversations for completed call"
      );
      for (const conversation of conversations) {
        try {
          await conversationClient.updateConversation(conversation.id, "CLOSED");
          this.logger.debug({ conversation_id: conversation.id }, "Closed conversation");
        } catch (error) {
          this.logger.error(
            { err: error, conversation_id: conversation.id },
            "Failed to close conversation"
          );
        }
      }
    } catch (error) {
      this.logger.error({ err: error, call_sid: callSid }, "Failed to list conversations for call");
    }
  }
  // =========================================================================
  // Stream Task Management
  // =========================================================================
  /**
   * Start tracking a streaming task for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns AbortController for the task
   */
  startStreamTask(conversationId) {
    this.cancelStreamTask(conversationId);
    const controller = new AbortController();
    this.streamTasks.set(conversationId, controller);
    this.logger.debug({ conversation_id: conversationId }, "Started stream task");
    return controller;
  }
  /**
   * Cancel an active streaming task
   *
   * @param conversationId - The conversation ID
   * @returns true if a task was cancelled, false otherwise
   */
  cancelStreamTask(conversationId) {
    const controller = this.streamTasks.get(conversationId);
    if (controller) {
      controller.abort();
      this.streamTasks.delete(conversationId);
      this.logger.debug({ conversation_id: conversationId }, "Cancelled stream task");
      return true;
    }
    return false;
  }
  /**
   * Complete a streaming task (remove from tracking)
   *
   * @param conversationId - The conversation ID
   */
  completeStreamTask(conversationId) {
    this.streamTasks.delete(conversationId);
    this.logger.debug({ conversation_id: conversationId }, "Completed stream task");
  }
  /**
   * Check if a stream task is active
   *
   * @param conversationId - The conversation ID
   * @returns true if an active task exists
   */
  hasActiveStreamTask(conversationId) {
    const controller = this.streamTasks.get(conversationId);
    return controller !== void 0 && !controller.signal.aborted;
  }
  // =========================================================================
  // ConversationRelay TwiML Generation
  // =========================================================================
  /**
   * Generate TwiML to connect a call to ConversationRelay.
   * Validates configuration with Zod before generating TwiML.
   *
   * @param config - ConversationRelay configuration (url, transcription, TTS, etc.)
   * @param options - Optional settings for the Connect verb (e.g., actionUrl)
   * @returns TwiML XML string
   * @throws {Error} if config validation fails
   */
  connectConversationRelay(config, options) {
    const validationResult = ConversationRelayConfigSchema.safeParse(config);
    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
      throw new Error(`Invalid ConversationRelay configuration: ${errorMessage}`);
    }
    const validatedConfig = validationResult.data;
    const { languages, ...conversationRelayAttributes } = validatedConfig;
    const filteredConfig = this.filterUnsetValues(conversationRelayAttributes);
    const response = new VoiceResponse();
    const connect = response.connect(options?.actionUrl ? { action: options.actionUrl } : {});
    const relay = connect.conversationRelay(filteredConfig);
    if (languages && languages.length > 0) {
      for (const lang of languages) {
        const filteredLang = this.filterUnsetValues(lang);
        relay.language(filteredLang);
      }
    }
    return response.toString();
  }
  /**
   * Filter out undefined values from configuration object.
   * Keeps null, false, 0, and empty strings as they are valid values.
   */
  filterUnsetValues(config) {
    const filtered = {};
    for (const [key, value] of Object.entries(config)) {
      if (value !== void 0) {
        filtered[key] = value;
      }
    }
    return filtered;
  }
  /**
   * Extract conversation ID - Not applicable for Voice channel
   */
  extractConversationId(_payload) {
    return null;
  }
  /**
   * Extract profile ID - Not applicable for Voice channel
   */
  extractProfileId(_payload) {
    return null;
  }
  /**
   * Cleanup channel state on shutdown
   *
   * Note: WebSocket connections are managed by the server and closed there.
   * This method only cleans up internal channel state.
   */
  shutdown() {
    this.streamTasks.clear();
    this.webSocketConnections.clear();
    this.promptQueues.clear();
    this.initializationRetries.clear();
    super.shutdown();
  }
};
var logger = createLogger({ name: "tac-flex" });
function handleFlexHandoffLogic(formData, flexWorkflowSid) {
  if (!flexWorkflowSid) {
    logger.error("No Flex workflow SID configured");
    return {
      success: false,
      status: 400,
      content: "Invalid handoff data",
      contentType: "text/plain"
    };
  }
  const response = new VoiceResponse();
  const handoffDataRaw = formData["HandoffData"] || "";
  if (handoffDataRaw) {
    let handoffData;
    try {
      handoffData = HandoffDataSchema.parse(JSON.parse(handoffDataRaw));
    } catch (error) {
      logger.error({ err: error }, "Invalid handoff data");
      return {
        success: false,
        status: 400,
        content: "Invalid handoff data",
        contentType: "text/plain"
      };
    }
    const enqueue = response.enqueue({
      workflowSid: flexWorkflowSid
    });
    enqueue.task(
      {
        priority: 5
      },
      JSON.stringify(handoffData)
    );
    logger.debug(
      { workflow_sid: flexWorkflowSid, handoff_data: handoffData },
      "Generated Flex handoff TwiML"
    );
    return {
      success: true,
      status: 200,
      content: response.toString(),
      contentType: "application/xml"
    };
  } else {
    if (formData["CallStatus"] === "completed") {
      return {
        success: true,
        status: 200,
        content: "Call Completed",
        contentType: "application/xml"
      };
    } else {
      return {
        success: false,
        status: 400,
        content: "Handoff Data is Missing",
        contentType: "application/xml"
      };
    }
  }
}

// packages/tools/src/lib/builder.ts
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

// packages/tools/src/built-in/memory.ts
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

// packages/tools/src/built-in/messaging.ts
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

// packages/tools/src/built-in/handoff.ts
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

// packages/tools/src/built-in/knowledge.ts
function createKnowledgeSearchTool(knowledgeClient, knowledgeBaseId, config) {
  const topK = config.topK ?? 5;
  return defineTool(
    config.name,
    config.description,
    {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant knowledge"
        }
      },
      required: ["query"],
      description: config.description
    },
    async (params) => {
      return knowledgeClient.searchKnowledgeBase(knowledgeBaseId, params.query, topK);
    }
  );
}
async function createKnowledgeSearchToolAsync(knowledgeClient, knowledgeBaseId, config) {
  let name = config?.name;
  let description = config?.description;
  if (!name || !description) {
    const kb = await knowledgeClient.getKnowledgeBase(knowledgeBaseId);
    if (!name) {
      const normalized = kb.displayName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
      name = normalized ? `search_${normalized}` : "search_knowledge_base";
    }
    if (!description) {
      description = kb.description || `Search the ${kb.displayName} knowledge base`;
    }
  }
  const toolConfig = {
    name,
    description
  };
  if (config?.topK !== void 0) {
    toolConfig.topK = config.topK;
  }
  return createKnowledgeSearchTool(knowledgeClient, knowledgeBaseId, toolConfig);
}
function createKnowledgeTools(knowledgeClient) {
  return {
    /**
     * Create knowledge search tool with explicit config
     */
    forKnowledgeBase: (knowledgeBaseId, config) => createKnowledgeSearchTool(knowledgeClient, knowledgeBaseId, config),
    /**
     * Create knowledge search tool with auto-fetched metadata
     */
    forKnowledgeBaseAsync: (knowledgeBaseId, config) => createKnowledgeSearchToolAsync(knowledgeClient, knowledgeBaseId, config)
  };
}
var DEFAULT_CONFIG = {
  voice: {
    host: "0.0.0.0",
    port: 3e3
  },
  webhookPaths: {
    messaging: "/webhook",
    twiml: "/twiml",
    ws: "/ws",
    conversationRelayCallback: "/conversation-relay-callback"
  },
  conversationRelayConfig: {
    welcomeGreeting: "Hello! How can I assist you today?"
  },
  development: false,
  validateWebhooks: true
};
var TACServer = class {
  fastify;
  tac;
  config;
  /** All enabled messaging channels — webhooks are fanned out to each one */
  messagingChannels;
  /** Voice channel instance */
  voiceChannel;
  constructor(tac, config = {}) {
    this.tac = tac;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      // Deep merge webhookPaths to preserve defaults while allowing overrides
      webhookPaths: {
        ...DEFAULT_CONFIG.webhookPaths,
        ...config.webhookPaths
      },
      // Deep merge conversationRelayConfig to preserve defaults while allowing overrides
      conversationRelayConfig: {
        ...DEFAULT_CONFIG.conversationRelayConfig,
        ...config.conversationRelayConfig
      }
    };
    this.voiceChannel = config.voiceChannel ?? tac.getChannel("voice");
    this.messagingChannels = config.messagingChannels ?? [tac.getChannel("sms"), tac.getChannel("chat")].filter((ch) => ch != null);
    if (this.messagingChannels.length === 0) {
      console.warn(
        'TACServer: No messaging channels configured. Messaging webhooks will be disabled. Register a MessagingChannel (e.g., "sms" or "chat") with TAC to enable messaging.'
      );
    }
    this.fastify = Fastify({
      logger: this.config.development ? {
        level: process.env.LOG_LEVEL || "info",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true
          }
        }
      } : {
        level: process.env.LOG_LEVEL || "info"
      },
      ...config.fastify
    });
  }
  /**
   * Get the full URL for webhook validation
   * Handles X-Forwarded-* headers for proxy/ngrok scenarios
   */
  getWebhookUrl(request) {
    const proto = request.headers["x-forwarded-proto"] || "https";
    const host = request.headers["x-forwarded-host"] || request.headers.host || "";
    return `${proto}://${host}${request.url}`;
  }
  /**
   * Register global Twilio webhook signature validation hook
   */
  registerWebhookValidation() {
    if (!this.config.validateWebhooks) {
      return;
    }
    this.fastify.addHook("preHandler", (request, reply, done) => {
      if (request.method === "GET") {
        done();
        return;
      }
      const signature = request.headers["x-twilio-signature"];
      const url = this.getWebhookUrl(request);
      const authToken = this.tac.getConfig().twilioAuthToken;
      let isValid;
      if (request.url.includes("bodySHA256=")) {
        const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
        isValid = twilio.validateRequestWithBody(authToken, signature, url, body);
      } else {
        const params = request.body || {};
        isValid = twilio.validateRequest(authToken, signature, url, params);
      }
      if (!isValid) {
        this.fastify.log.warn(
          { url, hasSignature: !!signature },
          "Invalid Twilio webhook signature"
        );
        void reply.code(403).send({ error: "Invalid webhook signature" });
        done();
        return;
      }
      done();
    });
  }
  /**
   * Setup routes
   */
  async setupRoutes() {
    if (this.messagingChannels.length > 0) {
      this.fastify.post(
        this.config.webhookPaths.messaging || "/webhook",
        async (request, reply) => {
          const rawHeader = request.headers["i-twilio-idempotency-token"];
          const idempotencyToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
          for (const channel of this.messagingChannels) {
            channel.processWebhook(request.body, idempotencyToken).catch((err) => {
              this.fastify.log.error(
                { err, channel: channel.channelType },
                "Messaging webhook processing error"
              );
            });
          }
          await reply.code(200).send({ status: "ok" });
        }
      );
    }
    this.fastify.post(
      this.config.webhookPaths.twiml || "/twiml",
      async (request, reply) => {
        try {
          if (!this.voiceChannel) {
            await reply.code(500).send({ error: "Voice channel not available" });
            return;
          }
          const voiceChannel = this.voiceChannel;
          const protocol = request.headers["x-forwarded-proto"] || "http";
          const host = request.headers.host;
          const websocketUrl = `${protocol === "https" ? "wss" : "ws"}://${host}${this.config.webhookPaths.ws || "/ws"}`;
          const callbackUrl = `${protocol}://${host}${this.config.webhookPaths.conversationRelayCallback || "/conversation-relay-callback"}`;
          const twiml = voiceChannel.handleIncomingCall({
            actionUrl: callbackUrl,
            conversationRelayConfig: {
              url: websocketUrl,
              ...this.config.conversationRelayConfig
            }
          });
          await reply.type("application/xml").send(twiml);
        } catch (error) {
          this.fastify.log.error(
            "TwiML generation error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    );
    this.fastify.post(
      this.config.webhookPaths.conversationRelayCallback || "/conversation-relay-callback",
      async (request, reply) => {
        try {
          if (!this.voiceChannel) {
            await reply.code(500).send({ error: "Voice channel not available" });
            return;
          }
          const voiceChannel = this.voiceChannel;
          const formData = request.body;
          const parseResult = ConversationRelayCallbackPayloadSchema.safeParse(formData);
          if (!parseResult.success) {
            this.fastify.log.error(
              { errors: parseResult.error.errors },
              "Invalid ConversationRelay callback payload"
            );
            await reply.code(400).send({ error: "Invalid payload" });
            return;
          }
          const result = await voiceChannel.handleConversationRelayCallback(
            parseResult.data,
            this.config.handoffHandler
          );
          await reply.code(result.status).type(result.contentType).send(result.content);
        } catch (error) {
          this.fastify.log.error(
            "ConversationRelay callback error: " + (error instanceof Error ? error.message : String(error))
          );
          await reply.code(500).send({ error: "Internal server error" });
        }
      }
    );
    await this.fastify.register((fastify) => {
      fastify.get(
        this.config.webhookPaths.ws || "/ws",
        { websocket: true },
        (socket) => {
          if (!this.voiceChannel) {
            socket.terminate();
            return;
          }
          this.voiceChannel.handleWebSocketConnection(socket);
        }
      );
    });
    if (this.config.webhookPaths.cintel) {
      this.fastify.post(
        this.config.webhookPaths.cintel,
        async (request, reply) => {
          if (!this.tac.isCintelEnabled()) {
            await reply.code(400).send({
              error: "Conversation Intelligence is not enabled",
              message: "Set TWILIO_TAC_CI_CONFIGURATION_ID and memory credentials to enable CI processing"
            });
            return;
          }
          try {
            this.fastify.log.info("Processing Conversation Intelligence webhook");
            const result = await this.tac.processCintelEvent(request.body);
            if (result.success) {
              if (result.skipped) {
                this.fastify.log.debug({ reason: result.skipReason }, "CI event skipped");
              } else {
                this.fastify.log.info(
                  { eventType: result.eventType, createdCount: result.createdCount },
                  "CI event processed"
                );
              }
            } else {
              this.fastify.log.error({ error: result.error }, "CI event processing failed");
            }
            await reply.send(result);
          } catch (error) {
            this.fastify.log.error(
              "CI webhook error: " + (error instanceof Error ? error.message : String(error))
            );
            await reply.code(500).send({
              success: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  }
  /**
   * Start the server
   */
  async start() {
    try {
      await this.fastify.register(formbody);
      await this.fastify.register(websocket);
      await this.fastify.register(gracefulShutdown);
      this.registerWebhookValidation();
      await this.setupRoutes();
      this.fastify.gracefulShutdown(async (signal) => {
        this.fastify.log.info({ signal }, "Received shutdown signal");
        await this.waitForWebSocketsToClose();
        this.tac.shutdown();
      });
      const voiceConfig = VoiceServerConfigSchema.parse(this.config.voice);
      await this.fastify.listen({
        host: voiceConfig.host,
        port: voiceConfig.port
      });
      this.fastify.log.info(
        {
          host: voiceConfig.host,
          port: voiceConfig.port,
          messaging_webhook: this.config.webhookPaths.messaging,
          twiml_webhook: this.config.webhookPaths.twiml,
          ws_websocket: this.config.webhookPaths.ws,
          conversation_relay_callback: this.config.webhookPaths.conversationRelayCallback,
          ...this.config.webhookPaths.cintel && {
            cintel_webhook: this.config.webhookPaths.cintel
          },
          webhook_validation: this.config.validateWebhooks ? "enabled" : "disabled"
        },
        "TAC Server started"
      );
      if (!this.config.validateWebhooks) {
        this.fastify.log.warn(
          "Webhook signature validation is DISABLED. Enable in production for security."
        );
      }
    } catch (error) {
      this.fastify.log.error({ err: error }, "Failed to start TAC Server");
      throw error;
    }
  }
  /**
   * Wait for all WebSocket connections to close
   */
  async waitForWebSocketsToClose(timeoutMs = 3e4) {
    const wsServer = this.fastify.websocketServer;
    if (!wsServer || wsServer.clients.size === 0) {
      return;
    }
    this.fastify.log.info(
      { websocket_count: wsServer.clients.size },
      "Waiting for WebSocket connections to close..."
    );
    const startTime = Date.now();
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const clientCount = wsServer.clients.size;
        if (clientCount === 0) {
          clearInterval(checkInterval);
          this.fastify.log.info("All WebSocket connections closed");
          resolve();
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          this.fastify.log.warn(
            { remaining_websockets: clientCount },
            "Timeout waiting for WebSockets to close, proceeding with shutdown"
          );
          resolve();
          return;
        }
        this.fastify.log.info(
          { remaining_websockets: clientCount },
          "Waiting for WebSockets to close..."
        );
      }, 5e3);
    });
  }
  /**
   * Stop the server gracefully
   */
  async stop() {
    try {
      await this.fastify.close();
      this.fastify.log.info("TAC Server stopped");
    } catch (error) {
      this.fastify.log.error({ err: error }, "Error stopping TAC Server");
      throw error;
    }
  }
};

export { AuthorInfoSchema, BaseChannel, BuiltInTools, CaptureRuleSchema, ChannelSettingsSchema, ChannelTypeSchema, ChatChannel, CintelParticipantSchema, CommunicationContentSchema, CommunicationParticipantSchema, CommunicationSchema, ConversationAddressSchema, ConversationClient, ConversationConfigurationSchema, ConversationGroupingTypeSchema, ConversationIntelligenceConfigSchema, ConversationParticipantSchema, ConversationRelayAttributesSchema, ConversationRelayCallbackPayloadSchema, ConversationRelayConfigSchema, ConversationResponseSchema, ConversationSessionSchema, ConversationSummaryItemSchema, CreateConversationSummariesResponseSchema, CreateObservationResponseSchema, CustomParametersSchema, EMPTY_MEMORY_RESPONSE, EnvironmentSchema, EnvironmentVariables, ExecutionDetailsSchema, HandoffDataSchema, IntelligenceConfigurationSchema, InterruptMessageSchema, JSONSchemaSchema, KnowledgeBaseSchema, KnowledgeBaseStatusSchema, KnowledgeChunkResultSchema, KnowledgeClient, KnowledgeSearchResponseSchema, LanguageAttributesSchema, MemoryChannelTypeSchema, MemoryClient, MemoryCommunicationContentSchema, MemoryCommunicationSchema, MemoryDeliveryStatusSchema, MemoryParticipantSchema, MemoryParticipantTypeSchema, MemoryRetrievalRequestSchema, MemoryRetrievalResponseSchema, MessageDirectionSchema, MessagingChannel, ObservationInfoSchema, OpenAIToolSchema, OperatorProcessingResultSchema, OperatorResultEventSchema, OperatorResultProcessor, OperatorResultSchema, OperatorSchema, ParticipantAddressSchema, ParticipantAddressTypeSchema, ProfileLookupResponseSchema, ProfileResponseSchema, PromptMessageSchema, SMSChannel, SendCommunicationParticipantAddressSchema, SendCommunicationRequestSchema, SendCommunicationResponseSchema, SessionInfoSchema, SessionMessageSchema, SetupMessageSchema, StatusCallbackSchema, StatusTimeoutsSchema, SummaryInfoSchema, TAC, TACChannelTypeSchema, TACCommunicationAuthorSchema, TACCommunicationContentSchema, TACCommunicationSchema, TACConfig, TACConfigSchema, TACDeliveryStatusSchema, TACMemoryResponse, TACParticipantTypeSchema, TACServer, TACTool, TextTokenMessageSchema, ToolExecutionResultSchema, TranscriptionSchema, TranscriptionWordSchema, VoiceChannel, VoiceServerConfigSchema, WebSocketMessageSchema, computeServiceUrls, createHandoffTool, createHandoffTools, createKnowledgeSearchTool, createKnowledgeSearchToolAsync, createKnowledgeTools, createLogger, createMemoryRetrievalTool, createMemoryTools, createMessagingTools, createSendMessageTool, defineTool, handleFlexHandoffLogic, isConversationId, isParticipantId, isProfileId };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map