import { z } from 'zod';
export { z } from 'zod';
import pino from 'pino';
import axios, { AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { WebSocket } from 'ws';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import twilio from 'twilio';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import gracefulShutdown from 'fastify-graceful-shutdown';

// packages/core/src/types/tac.ts
var ChannelTypeSchema = z.enum(["sms", "voice", "chat"]);
var TwilioMemoryConfigSchema = z.object({
  traitGroups: z.array(z.string()).optional(),
  observationsLimit: z.number().int().min(0).max(100).default(20),
  summariesLimit: z.number().int().min(0).max(100).default(5),
  // API default is 0 (no communications fetched). SDK defaults to 10 for a useful out-of-box experience.
  communicationsLimit: z.number().int().min(0).max(100).default(10),
  relevanceThreshold: z.number().min(0).max(1).default(0)
});
function normalizeVoicePublicDomain(value) {
  let v = value.trim();
  if (!v) return "";
  for (const scheme of ["https://", "http://", "wss://", "ws://"]) {
    if (v.toLowerCase().startsWith(scheme)) {
      v = v.slice(scheme.length);
      break;
    }
  }
  return v.replace(/\/+$/, "");
}
var TACConfigSchema = z.object({
  accountSid: z.string().min(1, "Twilio Account SID is required"),
  authToken: z.string().min(1, "Twilio Auth Token is required"),
  apiKey: z.string().min(1, "Twilio API Key is required"),
  apiSecret: z.string().min(1, "Twilio API Secret is required"),
  phoneNumber: z.string().min(1, "Twilio Phone Number is required"),
  memoryConfig: TwilioMemoryConfigSchema.default({}),
  conversationConfigurationId: z.string().regex(/^conv_configuration_[0-9a-z]{26}$/, "Invalid Conversation Configuration ID format"),
  /**
   * Public domain where voice routes are reachable (e.g. `example.ngrok.app`).
   * Used by VoiceChannel to construct the public WebSocket URL and
   * ConversationRelay action URL. Required when using the Voice channel.
   * Schemes (https://, wss://) and trailing slashes are stripped automatically,
   * so a copy-pasted `https://example.ngrok.app/` normalizes to `example.ngrok.app`.
   */
  voicePublicDomain: z.string().transform(normalizeVoicePublicDomain).optional().transform((v) => v ? v : void 0),
  /**
   * Path the voice WebSocket is served at. Combined with voicePublicDomain to
   * build the public WebSocket URL the voice channel hands to Twilio in TwiML;
   * TACServer also registers its WebSocket route at this path. Override only if
   * you mount the route at a non-default path.
   */
  voiceWebsocketPath: z.string().default("/ws"),
  /**
   * Path the ConversationRelay action callback is served at. Same role as
   * voiceWebsocketPath but for the `<Connect action=...>` cleanup callback.
   */
  voiceActionPath: z.string().default("/conversation-relay-callback"),
  cintelConfigurationId: z.string().optional(),
  cintelObservationOperatorSid: z.string().optional(),
  cintelSummaryOperatorSid: z.string().optional(),
  region: z.string().max(63, "Invalid Twilio region format (must be a valid DNS label)").regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Invalid Twilio region format (must be a valid DNS label)"
  ).optional(),
  /**
   * Twilio Studio Flow SID (FWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx) for handoff.
   * TAC derives both the digital-handoff Studio Executions URL and the voice
   * `<Connect action>` webhook URL from this SID.
   */
  studioHandoffFlowSid: z.string().regex(
    /^FW[0-9a-f]{32}$/,
    "Invalid Studio Flow SID format (expected FW followed by 32 hex chars)"
  ).optional()
});
var EnvironmentVariables = {
  TWILIO_ACCOUNT_SID: "TWILIO_ACCOUNT_SID",
  TWILIO_AUTH_TOKEN: "TWILIO_AUTH_TOKEN",
  TWILIO_API_KEY: "TWILIO_API_KEY",
  TWILIO_API_SECRET: "TWILIO_API_SECRET",
  TWILIO_PHONE_NUMBER: "TWILIO_PHONE_NUMBER",
  TWILIO_MEMORY_PROFILE_TRAIT_GROUPS: "TWILIO_MEMORY_PROFILE_TRAIT_GROUPS",
  TWILIO_MEMORY_OBSERVATIONS_LIMIT: "TWILIO_MEMORY_OBSERVATIONS_LIMIT",
  TWILIO_MEMORY_SUMMARIES_LIMIT: "TWILIO_MEMORY_SUMMARIES_LIMIT",
  TWILIO_MEMORY_COMMUNICATIONS_LIMIT: "TWILIO_MEMORY_COMMUNICATIONS_LIMIT",
  TWILIO_MEMORY_RELEVANCE_THRESHOLD: "TWILIO_MEMORY_RELEVANCE_THRESHOLD",
  TWILIO_CONVERSATION_CONFIGURATION_ID: "TWILIO_CONVERSATION_CONFIGURATION_ID",
  TWILIO_VOICE_PUBLIC_DOMAIN: "TWILIO_VOICE_PUBLIC_DOMAIN",
  TWILIO_VOICE_WEBSOCKET_PATH: "TWILIO_VOICE_WEBSOCKET_PATH",
  TWILIO_VOICE_ACTION_PATH: "TWILIO_VOICE_ACTION_PATH",
  TWILIO_TAC_CI_CONFIGURATION_ID: "TWILIO_TAC_CI_CONFIGURATION_ID",
  TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID: "TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID",
  TWILIO_TAC_CI_SUMMARY_OPERATOR_SID: "TWILIO_TAC_CI_SUMMARY_OPERATOR_SID",
  TWILIO_REGION: "TWILIO_REGION",
  TWILIO_STUDIO_HANDOFF_FLOW_SID: "TWILIO_STUDIO_HANDOFF_FLOW_SID"
};
var VoiceServerConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().int().positive().default(3e3)
});
var HandoffPayloadSchema = z.object({
  conversationId: z.string(),
  storeId: z.string(),
  profileId: z.string(),
  attributes: z.record(z.unknown()).default({})
});
var PendingHandoffDataSchema = z.object({
  type: z.literal("end").default("end"),
  handoffData: z.string()
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
var ListCommunicationsResponseSchema = z.object({
  communications: z.array(CommunicationSchema)
});
var ActionParticipantRefSchema = z.object({
  participantId: z.string().min(1).optional(),
  address: z.string().min(1).max(254).optional(),
  channel: ParticipantAddressTypeSchema
}).refine((v) => Boolean(v.participantId) || Boolean(v.address), {
  message: "ActionParticipantRef requires at least `participantId` or `address`"
});
var ActionTextContentSchema = z.object({
  text: z.string().max(8388608)
});
var ActionChannelSettingsSchema = z.object({
  channelId: z.string().optional(),
  // TODO(conv-orch): Drop `chatService` once the Actions API resolves the V1 Chat
  // service SID server-side. Confirmed this should not be required client-side;
  // keep the field until the server-side fix ships.
  chatService: z.string().optional()
}).passthrough();
var SendMessageActionPayloadSchema = z.object({
  from: ActionParticipantRefSchema,
  to: z.array(ActionParticipantRefSchema).min(1),
  content: ActionTextContentSchema,
  channelSettings: ActionChannelSettingsSchema.optional()
});
var SendMessageActionRequestSchema = z.object({
  type: z.literal("SEND_MESSAGE").default("SEND_MESSAGE"),
  payload: SendMessageActionPayloadSchema
});
var ActionResponseSchema = z.object({
  id: z.string(),
  // Kept as string (not enum) to tolerate future action types. Known: SEND_MESSAGE.
  type: z.string(),
  // Kept as string (not enum) to tolerate future statuses. Known: PENDING, COMPLETED, FAILED.
  status: z.string(),
  conversationId: z.string(),
  createdAt: z.string().nullish()
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
  metadata: z.record(z.unknown()).optional().default({}),
  /**
   * Pending handoff payload set by the handoff tool. Voice channel sends
   * this as a WS "end" message after the LLM's final response.
   */
  pendingHandoffData: PendingHandoffDataSchema.optional()
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
var ListConversationsResponseSchema = z.object({
  conversations: z.array(ConversationResponseSchema)
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
var ListParticipantsResponseSchema = z.object({
  participants: z.array(ConversationParticipantSchema)
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
  "GROUP_BY_PROFILE",
  "GROUP_BY_PARTICIPANT_ADDRESSES",
  "GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE"
]);
var ConversationsV1BridgeSchema = z.object({
  serviceId: z.string()
});
var ConversationConfigurationSchema = z.object({
  id: z.string(),
  displayName: z.string().max(32).regex(/^[a-zA-Z0-9-_ ]+$/).nullable().optional(),
  description: z.string(),
  conversationGroupingType: ConversationGroupingTypeSchema,
  memoryStoreId: z.string().regex(/^mem_(store|service)_[0-7][0-9a-z]{25}$/, "Invalid Memory Store ID format"),
  channelSettings: z.record(ChannelSettingsSchema).nullable().optional(),
  statusCallbacks: z.array(StatusCallbackSchema).max(20).nullable().optional(),
  intelligenceConfigurationIds: z.array(z.string()).max(5).nullable().optional(),
  // TODO(conv-orch): Drop this field once the Actions API resolves the V1 Chat
  // service SID server-side — see ConversationsV1BridgeSchema above.
  conversationsV1Bridge: ConversationsV1BridgeSchema.nullish(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  version: z.number().int().nullable().optional()
});
var InitiateMessagingConversationOptionsSchema = z.object({
  to: z.string().min(1, "Recipient address is required"),
  from: z.string().optional(),
  message: z.string().min(1, "Initial message is required"),
  metadata: z.record(z.unknown()).optional()
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
var TACParticipantTypeSchema = z.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT", "AGENT"]);
var TACCommunicationAuthorSchema = z.object({
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
  profileId: z.string().nullable().optional()
});
var TACCommunicationContentSchema = z.object({
  // Conversation Orchestrator-only: content type discriminator
  type: z.enum(["TEXT", "TRANSCRIPTION"]).optional(),
  // Both APIs: message text (optional in unified model to handle both)
  text: z.string().optional(),
  // Conversation Orchestrator-only: transcription metadata
  transcription: TranscriptionSchema.optional()
});
var TACCommunicationSchema = z.object({
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
  accountId: z.string().optional()
});

// packages/core/src/lib/tac-memory-response.ts
function isMemoryRetrievalResponse(data) {
  return !Array.isArray(data);
}
var TACMemoryResponse = class {
  _data;
  _communications;
  /**
   * Initialize wrapper with either Memory or Conversation Orchestrator data.
   *
   * @param data - Either MemoryRetrievalResponse (Memory) or Communication[] (Conversation Orchestrator)
   */
  constructor(data) {
    this._data = data;
    if (isMemoryRetrievalResponse(data)) {
      this._communications = (data.communications ?? []).map(
        (comm) => TACCommunicationSchema.parse(comm)
      );
    } else {
      this._communications = data.map((comm) => TACCommunicationSchema.parse(comm));
    }
  }
  /**
   * Get observation memories.
   *
   * @returns List of observations if Memory is configured, empty array for Conversation Orchestrator fallback
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
   * @returns List of summaries if Memory is configured, empty array for Conversation Orchestrator fallback
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
   * all fields from both Memory and Conversation Orchestrator APIs. Fields not available from a particular
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
   *          false if using Conversation Orchestrator fallback (only communications available)
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
  /**
   * Build formatted prompt sections from available memory data.
   *
   * Generates markdown-formatted sections for observations, summaries, and communications
   * that can be injected into LLM prompts. Each section includes a heading and formatted content.
   * Sections with no data are omitted from the result.
   *
   * @returns Array of formatted prompt sections, empty array if no memory data available
   */
  buildMemoryPrompts() {
    const sections = [];
    const observationsSection = this.buildObservationsPrompt();
    if (observationsSection) {
      sections.push(observationsSection);
    }
    const summariesSection = this.buildSummariesPrompt();
    if (summariesSection) {
      sections.push(summariesSection);
    }
    const communicationsSection = this.buildCommunicationsPrompt();
    if (communicationsSection) {
      sections.push(communicationsSection);
    }
    return sections;
  }
  buildObservationsPrompt() {
    if (this.observations.length === 0) {
      return null;
    }
    const lines = [
      "## Key Observations",
      "Important notes about the customer from previous interactions:"
    ];
    for (const obs of this.observations) {
      lines.push(`- ${obs.content}`);
    }
    return lines.join("\n");
  }
  buildSummariesPrompt() {
    if (this.summaries.length === 0) {
      return null;
    }
    const lines = [
      "## Past Conversation Summaries",
      "Summaries of previous conversations with this customer:"
    ];
    for (const summary of this.summaries) {
      lines.push(`- ${summary.content}`);
    }
    return lines.join("\n");
  }
  buildCommunicationsPrompt() {
    if (this.communications.length === 0) {
      return null;
    }
    const lines = ["## Recent Message History", "Recent messages exchanged with this customer:"];
    for (const comm of this.communications) {
      const content = comm.content?.text;
      if (typeof content !== "string" || content.trim().length === 0) {
        continue;
      }
      const role = comm.author?.type === "CUSTOMER" ? "User" : "Assistant";
      lines.push(`${role}: ${content}`);
    }
    return lines.length > 2 ? lines.join("\n") : null;
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
var MemoryParticipantTypeSchema = z.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT", "AGENT"]);
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
  profileId: z.string().nullable().optional(),
  deliveryStatus: MemoryDeliveryStatusSchema.optional()
});
var MemoryCommunicationContentSchema = z.object({
  text: z.string().max(8388608).optional()
});
var MemoryCommunicationSchema = z.object({
  id: z.string(),
  author: MemoryParticipantSchema,
  content: MemoryCommunicationContentSchema,
  recipients: z.array(MemoryParticipantSchema).max(100),
  channelId: z.string().max(256).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional()
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
  conversationId: z.string().optional(),
  query: z.string().optional(),
  beginDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  observationsLimit: z.number().int().min(0).max(100).optional(),
  summariesLimit: z.number().int().min(0).max(100).optional(),
  communicationsLimit: z.number().int().min(0).max(100).optional(),
  relevanceThreshold: z.number().min(0).max(1).optional()
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
var InterruptModeSchema = z.enum(["none", "dtmf", "speech", "any"]);
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
  /** What caller input can interrupt the welcome greeting. Defaults to 'any' on Twilio. */
  welcomeGreetingInterruptible: InterruptModeSchema.optional(),
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
  /**
   * What caller input interrupts TTS playback. Defaults to 'any'.
   * (Python's TwiMLOptions also accepts a boolean for backward compat; the
   * Twilio SDK's TS types only permit the string enum, so we expose the enum.)
   */
  interruptible: InterruptModeSchema.optional(),
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
  utteranceUntilInterrupt: z.string().optional(),
  durationUntilInterruptMs: z.number().int().nonnegative().optional()
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
var ConversationRelayExtraSchema = z.record(
  z.union([z.string(), z.boolean(), z.number()])
);
var CRELAY_NON_ATTRIBUTE_KEYS = ["languages", "extra", "actionUrl", "customParameters"];
var CRELAY_TYPED_ATTRIBUTE_KEYS = [
  ...Object.keys(ConversationRelayAttributesSchema.shape),
  "eotThreshold",
  "deepgramSmartFormat",
  "speechTimeout",
  "ignoreBackchannel",
  "events"
];
function refineNoExtraShadowing(config, ctx) {
  if (!config.extra) return;
  const typed = new Set(
    Object.keys(config).filter((k) => !CRELAY_NON_ATTRIBUTE_KEYS.includes(k))
  );
  for (const k of CRELAY_TYPED_ATTRIBUTE_KEYS) typed.add(k);
  const shadowed = Object.keys(config.extra).filter((k) => typed.has(k)).sort();
  if (shadowed.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["extra"],
      message: `extra keys ${JSON.stringify(shadowed)} shadow typed fields. Set the typed field directly instead of using extra.`
    });
  }
}
var ConversationRelayConfigShape = {
  /** Optional language configurations as child <Language> elements */
  languages: z.array(LanguageAttributesSchema).optional(),
  eotThreshold: z.number().optional(),
  deepgramSmartFormat: z.boolean().optional(),
  speechTimeout: z.union([z.number().int(), z.literal("auto")]).optional(),
  ignoreBackchannel: z.boolean().optional(),
  events: z.string().optional(),
  actionUrl: z.string().url().optional(),
  customParameters: CustomParametersSchema.optional(),
  extra: ConversationRelayExtraSchema.optional()
};
var ConversationRelayConfigSchema = ConversationRelayAttributesSchema.extend(ConversationRelayConfigShape).superRefine(
  refineNoExtraShadowing
);
var ConversationRelayOptionsSchema = ConversationRelayAttributesSchema.omit({ url: true }).extend(ConversationRelayConfigShape).superRefine(refineNoExtraShadowing);
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
  SessionDuration: z.string().optional()
});
var TWIML_REQUEST_FIELD_KEYS = {
  from: "From",
  to: "To",
  callSid: "CallSid",
  callerCountry: "CallerCountry",
  callerState: "CallerState",
  callerCity: "CallerCity",
  direction: "Direction"
};
function twimlRequestFromForm(form) {
  const knownByKey = new Map(
    Object.entries(TWIML_REQUEST_FIELD_KEYS).map(([field, key]) => [key, field])
  );
  const request = { extra: {} };
  for (const [key, value] of Object.entries(form)) {
    const field = knownByKey.get(key);
    if (field) {
      request[field] = value;
    } else {
      request.extra[key] = value;
    }
  }
  return request;
}
var InitiateVoiceConversationOptionsSchema = z.object({
  to: z.string().min(1, "Recipient phone number is required"),
  from: z.string().optional(),
  websocketUrl: z.string().optional(),
  twimlOptions: ConversationRelayOptionsSchema.optional()
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
  HANDOFF: "handoff",
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
  accountSid;
  authToken;
  apiKey;
  apiSecret;
  phoneNumber;
  memoryConfig;
  conversationConfigurationId;
  voicePublicDomain;
  /** Path the voice WebSocket is served at (combined with voicePublicDomain). */
  voiceWebsocketPath;
  /** Path the ConversationRelay `<Connect action>` callback is served at. */
  voiceActionPath;
  cintelConfigurationId;
  cintelObservationOperatorSid;
  cintelSummaryOperatorSid;
  /** Optional Twilio region subdomain for API routing (e.g. transforms base URLs to `https://{product}.{region}.twilio.com`) */
  region;
  /**
   * Twilio Studio Flow SID for handoff. TAC derives both the digital-handoff
   * Studio Executions URL (`studio.twilio.com/v2/Flows/{SID}/Executions`) and
   * the voice `<Connect action>` webhook URL
   * (`webhooks.twilio.com/v1/Accounts/{AccountSid}/Flows/{SID}?Trigger=incomingCall`)
   * from this SID.
   */
  studioHandoffFlowSid;
  constructor(data) {
    const validatedConfig = TACConfigSchema.parse(data);
    this.accountSid = validatedConfig.accountSid;
    this.authToken = validatedConfig.authToken;
    this.apiKey = validatedConfig.apiKey;
    this.apiSecret = validatedConfig.apiSecret;
    this.phoneNumber = validatedConfig.phoneNumber;
    this.memoryConfig = validatedConfig.memoryConfig;
    this.conversationConfigurationId = validatedConfig.conversationConfigurationId;
    if (validatedConfig.voicePublicDomain) {
      this.voicePublicDomain = validatedConfig.voicePublicDomain;
    }
    this.voiceWebsocketPath = validatedConfig.voiceWebsocketPath;
    this.voiceActionPath = validatedConfig.voiceActionPath;
    if (validatedConfig.cintelConfigurationId) {
      this.cintelConfigurationId = validatedConfig.cintelConfigurationId;
    }
    if (validatedConfig.cintelObservationOperatorSid) {
      this.cintelObservationOperatorSid = validatedConfig.cintelObservationOperatorSid;
    }
    if (validatedConfig.cintelSummaryOperatorSid) {
      this.cintelSummaryOperatorSid = validatedConfig.cintelSummaryOperatorSid;
    }
    if (validatedConfig.region) {
      this.region = validatedConfig.region;
    }
    if (validatedConfig.studioHandoffFlowSid) {
      this.studioHandoffFlowSid = validatedConfig.studioHandoffFlowSid;
    }
  }
  /**
   * Create TACConfig from environment variables.
   *
   * Required environment variables:
   * - TWILIO_ACCOUNT_SID: Twilio Account SID
   * - TWILIO_AUTH_TOKEN: Twilio Auth Token for API authentication
   * - TWILIO_API_KEY: Twilio API Key SID (starts with SK)
   * - TWILIO_API_SECRET: Twilio API Secret for API Key authentication
   * - TWILIO_PHONE_NUMBER: Phone number for voice and SMS channels
   * - TWILIO_CONVERSATION_CONFIGURATION_ID: Conversation Orchestrator configuration ID
   *
   * Optional environment variables:
   * - TWILIO_VOICE_PUBLIC_DOMAIN: Public domain for voice routes (required for voice; e.g. `example.ngrok.app`)
   * - TWILIO_VOICE_WEBSOCKET_PATH: Path for the voice WebSocket (default: /ws)
   * - TWILIO_VOICE_ACTION_PATH: Path for the ConversationRelay action callback (default: /conversation-relay-callback)
   * - TWILIO_REGION: Twilio region subdomain for API routing (e.g. transforms base URLs to `https://{product}.{region}.twilio.com`)
   * - TWILIO_STUDIO_HANDOFF_FLOW_SID: Studio Flow SID used by createStudioHandoffTool for human handoff
   *
   * Memory Configuration (defaults defined in TwilioMemoryConfigSchema):
   * - TWILIO_MEMORY_PROFILE_TRAIT_GROUPS: Trait groups to include (comma-separated, e.g., "Contact,Preferences")
   * - TWILIO_MEMORY_OBSERVATIONS_LIMIT: Max observations in memory retrieval
   * - TWILIO_MEMORY_SUMMARIES_LIMIT: Max summaries in memory retrieval
   * - TWILIO_MEMORY_COMMUNICATIONS_LIMIT: Max communications in memory retrieval
   * - TWILIO_MEMORY_RELEVANCE_THRESHOLD: Min relevance score (0.0-1.0)
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
      { key: EnvironmentVariables.TWILIO_API_SECRET, name: "TWILIO_API_SECRET" },
      { key: EnvironmentVariables.TWILIO_PHONE_NUMBER, name: "TWILIO_PHONE_NUMBER" },
      {
        key: EnvironmentVariables.TWILIO_CONVERSATION_CONFIGURATION_ID,
        name: "TWILIO_CONVERSATION_CONFIGURATION_ID"
      }
    ];
    for (const { key, name } of requiredVars) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${name}`);
      }
    }
    const traitGroupsStr = process.env[EnvironmentVariables.TWILIO_MEMORY_PROFILE_TRAIT_GROUPS];
    const trimmedTraitGroups = traitGroupsStr?.trim();
    const parsedTraitGroups = trimmedTraitGroups && trimmedTraitGroups.length > 0 ? trimmedTraitGroups.split(",").map((g) => g.trim()).filter((g) => g.length > 0) : void 0;
    const traitGroups = parsedTraitGroups && parsedTraitGroups.length > 0 ? parsedTraitGroups : void 0;
    const parseIntEnv = (envVarName, value, min, max) => {
      if (!value) return void 0;
      const trimmed = value.trim();
      if (trimmed.length === 0) return void 0;
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid ${envVarName}: expected an integer, got "${value}"`);
      }
      if (!Number.isInteger(parsed)) {
        throw new Error(`Invalid ${envVarName}: expected an integer, got "${value}"`);
      }
      if (parsed < min || parsed > max) {
        throw new Error(`Invalid ${envVarName}: must be between ${min} and ${max}, got ${parsed}`);
      }
      return parsed;
    };
    const parseFloatEnv = (envVarName, value, min, max) => {
      if (!value) return void 0;
      const trimmed = value.trim();
      if (trimmed.length === 0) return void 0;
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid ${envVarName}: expected a number, got "${value}"`);
      }
      if (parsed < min || parsed > max) {
        throw new Error(`Invalid ${envVarName}: must be between ${min} and ${max}, got ${parsed}`);
      }
      return parsed;
    };
    const rawConfig = {
      accountSid: process.env[EnvironmentVariables.TWILIO_ACCOUNT_SID],
      authToken: process.env[EnvironmentVariables.TWILIO_AUTH_TOKEN],
      apiKey: process.env[EnvironmentVariables.TWILIO_API_KEY],
      apiSecret: process.env[EnvironmentVariables.TWILIO_API_SECRET],
      phoneNumber: process.env[EnvironmentVariables.TWILIO_PHONE_NUMBER],
      memoryConfig: {
        traitGroups,
        observationsLimit: parseIntEnv(
          "TWILIO_MEMORY_OBSERVATIONS_LIMIT",
          process.env[EnvironmentVariables.TWILIO_MEMORY_OBSERVATIONS_LIMIT],
          0,
          100
        ),
        summariesLimit: parseIntEnv(
          "TWILIO_MEMORY_SUMMARIES_LIMIT",
          process.env[EnvironmentVariables.TWILIO_MEMORY_SUMMARIES_LIMIT],
          0,
          100
        ),
        communicationsLimit: parseIntEnv(
          "TWILIO_MEMORY_COMMUNICATIONS_LIMIT",
          process.env[EnvironmentVariables.TWILIO_MEMORY_COMMUNICATIONS_LIMIT],
          0,
          100
        ),
        relevanceThreshold: parseFloatEnv(
          "TWILIO_MEMORY_RELEVANCE_THRESHOLD",
          process.env[EnvironmentVariables.TWILIO_MEMORY_RELEVANCE_THRESHOLD],
          0,
          1
        )
      },
      conversationConfigurationId: process.env[EnvironmentVariables.TWILIO_CONVERSATION_CONFIGURATION_ID],
      voicePublicDomain: process.env[EnvironmentVariables.TWILIO_VOICE_PUBLIC_DOMAIN],
      voiceWebsocketPath: process.env[EnvironmentVariables.TWILIO_VOICE_WEBSOCKET_PATH],
      voiceActionPath: process.env[EnvironmentVariables.TWILIO_VOICE_ACTION_PATH],
      cintelConfigurationId: process.env[EnvironmentVariables.TWILIO_TAC_CI_CONFIGURATION_ID],
      cintelObservationOperatorSid: process.env[EnvironmentVariables.TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID],
      cintelSummaryOperatorSid: process.env[EnvironmentVariables.TWILIO_TAC_CI_SUMMARY_OPERATOR_SID],
      region: process.env[EnvironmentVariables.TWILIO_REGION],
      studioHandoffFlowSid: process.env[EnvironmentVariables.TWILIO_STUDIO_HANDOFF_FLOW_SID]
    };
    return new _TACConfig(rawConfig);
  }
  /**
   * Get basic auth credentials for Twilio APIs
   */
  getBasicAuthCredentials() {
    return {
      username: this.accountSid,
      password: this.authToken
    };
  }
};
function createLogger(options) {
  const level = options?.level || process.env.TWILIO_LOG_LEVEL || "info";
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

// package.json
var package_default = {
  version: "1.0.0"};
function buildUserAgent() {
  return `twilio-agent-connect-typescript/${package_default.version}`;
}
var BaseClient = class {
  baseUrl;
  logger;
  axiosInstance;
  constructor(baseUrl, config, logger) {
    this.baseUrl = baseUrl;
    this.logger = logger || createLogger({ name: this.constructor.name });
    const authHeader = "Basic " + Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64");
    const baseOrigin = new URL(baseUrl).origin;
    this.axiosInstance = axios.create({
      baseURL: baseUrl,
      timeout: 3e4,
      maxRedirects: 5,
      headers: {
        "User-Agent": buildUserAgent(),
        Authorization: authHeader
      },
      beforeRedirect: (options, _responseDetails) => {
        const redirectUrl = new URL(
          String(options.path || ""),
          `${String(options.protocol)}//${String(options.host)}`
        );
        if (redirectUrl.origin === baseOrigin && options.headers) {
          options.headers.Authorization = authHeader;
        }
      }
    });
    axiosRetry(this.axiosInstance, {
      retries: 3,
      retryDelay: (retryCount) => axiosRetry.exponentialDelay(retryCount),
      retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error);
      }
    });
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const logContext = {
            error: error.message,
            method: error.config?.method,
            url: error.config?.url,
            status
          };
          if (status !== void 0 && status >= 400 && status < 500) {
            this.logger.warn(logContext, "HTTP request client error");
          } else {
            this.logger.error(logContext, "HTTP request error");
          }
        }
        throw error;
      }
    );
  }
  /**
   * Make an HTTP request with automatic header injection and error handling
   *
   * @param url - The URL path (relative to baseURL)
   * @param method - HTTP method (GET, POST, etc.)
   * @param data - Optional request body (will be automatically serialized to JSON)
   * @param params - Optional query string parameters
   * @returns Promise resolving to the response data (already parsed from JSON)
   * @throws Error on timeout, HTTP errors, or network failures
   */
  async makeRequest(url, method, data, params) {
    const response = await this.axiosInstance.request({
      url,
      method,
      data,
      params
    });
    return response.data;
  }
};

// packages/core/src/clients/memory.ts
var MemoryClient = class extends BaseClient {
  constructor(config, logger) {
    const baseUrl = config.region ? `https://memory.${config.region}.twilio.com` : "https://memory.twilio.com";
    super(baseUrl, config, logger);
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
      const url = `/v1/Stores/${serviceSid}/Profiles/${profileId}/Recall`;
      this.logger.debug(
        {
          memory_store_id: serviceSid,
          profile_id: profileId,
          request
        },
        "Retrieving memories"
      );
      const validatedRequest = MemoryRetrievalRequestSchema.parse(request);
      const requestBody = {
        conversationId: validatedRequest.conversationId,
        query: validatedRequest.query,
        beginDate: validatedRequest.beginDate,
        endDate: validatedRequest.endDate,
        observationsLimit: validatedRequest.observationsLimit,
        summariesLimit: validatedRequest.summariesLimit,
        communicationsLimit: validatedRequest.communicationsLimit,
        relevanceThreshold: validatedRequest.relevanceThreshold
      };
      const cleanedBody = Object.fromEntries(
        Object.entries(requestBody).filter(([_, value]) => value !== void 0)
      );
      const data = await this.makeRequest(url, "POST", cleanedBody);
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
          error: error instanceof Error ? error.message : String(error),
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
    const url = `/v1/Stores/${serviceSid}/Profiles/Lookup`;
    const requestBody = {
      idType,
      value
    };
    try {
      const data = await this.makeRequest(url, "POST", requestBody);
      return ProfileLookupResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to lookup profile: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
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
    const url = `/v1/Stores/${serviceSid}/Profiles/${profileId}`;
    const params = {};
    if (traitGroups && traitGroups.length > 0) {
      params.traitGroups = traitGroups.join(",");
    }
    try {
      const data = await this.makeRequest(
        url,
        "GET",
        void 0,
        Object.keys(params).length > 0 ? params : void 0
      );
      return ProfileResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to get profile: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
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
    const url = `/v1/Stores/${serviceSid}/Profiles/${profileId}/Observations`;
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
    try {
      const data = await this.makeRequest(url, "POST", requestBody);
      return CreateObservationResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to create observation: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
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
    const url = `/v1/Stores/${serviceSid}/Profiles/${profileId}/ConversationSummaries`;
    const requestBody = {
      summaries: summaries.map((s) => ({
        content: s.content,
        conversationId: s.conversationId,
        occurredAt: s.occurredAt,
        source: s.source ?? "conversation-intelligence"
      }))
    };
    try {
      const data = await this.makeRequest(
        url,
        "POST",
        requestBody
      );
      return CreateConversationSummariesResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to create conversation summaries: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
};
var ConversationClient = class extends BaseClient {
  conversationConfigurationId;
  constructor(config, logger) {
    const baseUrl = config.region ? `https://conversations.${config.region}.twilio.com` : "https://conversations.twilio.com";
    super(baseUrl, config, logger);
    this.conversationConfigurationId = config.conversationConfigurationId;
  }
  /**
   * Create an action on a conversation via the Conversation Orchestrator Actions API.
   *
   * Currently supports SEND_MESSAGE actions. Returns 202 Accepted; the action is
   * processed asynchronously and delivered via COMMUNICATION_CREATED webhook.
   *
   * @param conversationId - The conversation ID
   * @param request - The action request ({type, payload})
   * @returns Promise containing the ActionResponse
   */
  async createAction(conversationId, request) {
    const url = `/v2/Conversations/${conversationId}/Actions`;
    try {
      const data = await this.makeRequest(url, "POST", request);
      return ActionResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to create action: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
  /**
   * List communications for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of communications
   */
  async listCommunications(conversationId) {
    const url = `/v2/Conversations/${conversationId}/Communications`;
    try {
      const data = await this.makeRequest(url, "GET");
      const validated = ListCommunicationsResponseSchema.parse(data);
      return validated.communications;
    } catch (error) {
      throw new Error(
        `Failed to list communications: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
  /**
   * Create a new conversation, optionally with inline participants.
   *
   * When participants are provided, CO creates them atomically with the
   * conversation. If an active conversation with the same participant
   * addresses already exists (respecting the configuration's group-by
   * rules), CO returns 409 with a pointer to the existing conversation.
   */
  async createConversation(options) {
    const url = `/v2/Conversations`;
    const requestBody = {
      configurationId: this.conversationConfigurationId
    };
    if (options?.name) {
      requestBody.name = options.name;
    }
    if (options?.participants) {
      requestBody.participants = options.participants;
    }
    try {
      const data = await this.makeRequest(url, "POST", requestBody);
      return ConversationResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
  /**
   * Create a conversation with inline participants, reusing an existing active
   * conversation if CO returns 409 (group-by dedup).
   *
   * On 409 CO returns the existing conversation ID in the
   * X-Conflicting-Resource-Id response header.
   */
  async createOrReuseConversation(participants) {
    try {
      const conversation = await this.createConversation({ participants });
      return { conversation, reused: false };
    } catch (error) {
      const existingId = this.extractConversationIdFrom409(error);
      if (existingId) {
        this.logger.info(
          { conversation_id: existingId },
          "Reusing existing active conversation (409 dedup)"
        );
        return { conversation: { id: existingId }, reused: true };
      }
      throw error;
    }
  }
  /**
   * Extract conversation ID from a 409 response's X-Conflicting-Resource-Id header.
   */
  extractConversationIdFrom409(error) {
    const cause = error instanceof Error ? error.cause ?? error : error;
    if (!axios.isAxiosError(cause) || cause.response?.status !== 409) {
      return null;
    }
    const headers = cause.response.headers;
    const conflictId = headers?.["x-conflicting-resource-id"];
    return typeof conflictId === "string" && conflictId.length > 0 ? conflictId : null;
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
    const url = `/v2/Conversations/${conversationId}/Participants`;
    const requestBody = {
      type: participantType,
      addresses
    };
    try {
      const data = await this.makeRequest(url, "POST", requestBody);
      return ConversationParticipantSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to add participant: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
  /**
   * List participants in a conversation
   *
   * @param conversationId - The conversation ID
   * @returns Promise containing array of participants
   */
  async listParticipants(conversationId) {
    const url = `/v2/Conversations/${conversationId}/Participants`;
    try {
      const data = await this.makeRequest(url, "GET");
      const validated = ListParticipantsResponseSchema.parse(data);
      return validated.participants;
    } catch (error) {
      throw new Error(
        `Failed to list participants: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
  /**
   * List conversations with optional filters
   *
   * @param filters - Optional filters (channelId, status)
   * @returns Promise containing array of conversations
   */
  async listConversations(filters) {
    const url = `/v2/Conversations`;
    const params = {};
    if (filters?.channelId) {
      params.channelId = filters.channelId;
    }
    if (filters?.status && filters.status.length > 0) {
      params.status = filters.status.join(",");
    }
    try {
      const data = await this.makeRequest(
        url,
        "GET",
        void 0,
        Object.keys(params).length > 0 ? params : void 0
      );
      const validated = ListConversationsResponseSchema.parse(data);
      return validated.conversations;
    } catch (error) {
      throw new Error(
        `Failed to list conversations: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
  /**
   * Clear statusCallbacks on a conversation's instance configuration.
   *
   * This stops the conversation from sending webhook events to TAC,
   * which is needed during handoff so the receiving system can take over.
   *
   * @param conversationId - The conversation ID to update
   */
  async clearStatusCallbacks(conversationId) {
    const url = `/v2/Conversations/${conversationId}`;
    try {
      await this.makeRequest(url, "PATCH", {
        configuration: { statusCallbacks: [] }
      });
    } catch (error) {
      throw new Error(
        `Failed to clear status callbacks: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
  /**
   * Update conversation status
   *
   * @param conversationId - The conversation ID
   * @param status - New status (ACTIVE, INACTIVE, CLOSED)
   * @returns Promise containing updated conversation
   */
  async updateConversation(conversationId, status) {
    const url = `/v2/Conversations/${conversationId}`;
    const requestBody = { status };
    try {
      const data = await this.makeRequest(url, "PUT", requestBody);
      return ConversationResponseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to update conversation: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
  /**
   * Retrieve the details for a single configuration
   *
   * @param configurationId - The configuration ID to retrieve
   * @returns Promise containing configuration details
   */
  async getConfiguration(configurationId) {
    const url = `/v2/ControlPlane/Configurations/${configurationId}`;
    try {
      const data = await this.makeRequest(url, "GET");
      return ConversationConfigurationSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to get configuration: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
};

// packages/core/src/clients/knowledge.ts
var KnowledgeClient = class extends BaseClient {
  constructor(config, logger) {
    const baseUrl = config.region ? `https://knowledge.${config.region}.twilio.com` : "https://knowledge.twilio.com";
    super(baseUrl, config, logger);
  }
  /**
   * Get knowledge base metadata
   *
   * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
   * @returns Promise containing knowledge base metadata
   */
  async getKnowledgeBase(knowledgeBaseId) {
    const url = `/v2/ControlPlane/KnowledgeBases/${knowledgeBaseId}`;
    try {
      const data = await this.makeRequest(url, "GET");
      return KnowledgeBaseSchema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to get knowledge base: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
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
    const url = `/v2/KnowledgeBases/${knowledgeBaseId}/Search`;
    const requestBody = {
      query,
      top: Math.min(Math.max(topK, 1), 20)
      // Clamp to 1-20
    };
    if (knowledgeIds && knowledgeIds.length > 0) {
      requestBody.knowledgeIds = knowledgeIds;
    }
    try {
      const data = await this.makeRequest(url, "POST", requestBody);
      const validated = KnowledgeSearchResponseSchema.parse(data);
      return validated.chunks;
    } catch (error) {
      throw new Error(
        `Failed to search knowledge base: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
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
  constructor(memoryClient, config, logger) {
    this.memoryClient = memoryClient;
    this.config = config;
    this.logger = logger ?? createLogger({ name: "cintel-processor" });
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
var TAC = class _TAC {
  static FACTORY_TOKEN = /* @__PURE__ */ Symbol("TAC.create");
  config;
  logger;
  memoryClient;
  knowledgeClient;
  conversationClient;
  channels;
  cintelProcessor;
  memoryStoreId;
  /**
   * V1 Conversations service SID sourced from `conversationsV1Bridge.serviceId`
   * on the configuration. Forwarded by the chat channel as
   * `channelSettings.chatService` on Actions API requests.
   *
   * TODO(conv-orch): Remove once the Actions API resolves the V1 Chat service SID
   * server-side. Confirmed this should not be required client-side; until the
   * server-side fix ships, CHAT sends fail with
   *   "chatService attribute is required for CHAT channel"
   * unless we pass it on channelSettings.chatService. When the server-side fix
   * lands, drop this attribute plus ActionChannelSettings.chatService and the
   * chat channel's chatServiceSid plumbing.
   */
  conversationsV1ServiceSid;
  // Callback registrations
  messageReadyCallback;
  interruptCallback;
  conversationEndedCallback;
  constructor(token, options = {}) {
    if (token !== _TAC.FACTORY_TOKEN) {
      throw new Error("TAC constructor is private. Use TAC.create() instead of new TAC().");
    }
    const finalConfig = options.config ? options.config instanceof TACConfig ? options.config : new TACConfig(options.config) : TACConfig.fromEnv();
    const finalLogger = options.logger ?? createLogger({ name: "tac" });
    this.config = finalConfig;
    this.logger = finalLogger;
    this.channels = /* @__PURE__ */ new Map();
    this.conversationClient = new ConversationClient(
      this.config,
      this.logger.child({ component: "conversation" })
    );
  }
  static async create(options = {}) {
    const tac = new _TAC(_TAC.FACTORY_TOKEN, options);
    try {
      const conversationConfig = await tac.conversationClient.getConfiguration(
        tac.config.conversationConfigurationId
      );
      tac.memoryStoreId = conversationConfig.memoryStoreId;
      tac.conversationsV1ServiceSid = conversationConfig.conversationsV1Bridge?.serviceId ?? void 0;
      tac.memoryClient = new MemoryClient(tac.config, tac.logger.child({ component: "memory" }));
      tac.knowledgeClient = new KnowledgeClient(
        tac.config,
        tac.logger.child({ component: "knowledge" })
      );
      if (tac.config.cintelConfigurationId) {
        tac.cintelProcessor = new OperatorResultProcessor(
          tac.memoryClient,
          {
            configurationId: tac.config.cintelConfigurationId,
            observationOperatorSid: tac.config.cintelObservationOperatorSid,
            summaryOperatorSid: tac.config.cintelSummaryOperatorSid
          },
          tac.logger.child({ component: "cintel" })
        );
      }
      return tac;
    } catch (error) {
      tac.logger.error({ err: error }, "TAC initialization failed");
      throw error;
    }
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
        session,
        abortSignal
      }) => {
        const eventSession = session || channel.getConversationSession(conversationId);
        if (eventSession) {
          await this.handleMessageReady({
            conversationId,
            profileId: eventSession.profileId ? eventSession.profileId : void 0,
            message: transcript,
            author: "user",
            userMemory,
            channelType: channel.channelType,
            abortSignal
          });
        }
      }
    );
    channel.on(
      "interrupt",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async event handler
      async ({
        conversationId,
        utteranceUntilInterrupt,
        durationUntilInterruptMs
      }) => {
        const session = channel.getConversationSession(conversationId);
        if (session && this.interruptCallback) {
          try {
            await this.interruptCallback({
              conversationId,
              utteranceUntilInterrupt,
              durationUntilInterruptMs,
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
      if (!memory && data.profileId) {
        this.logger.debug(
          { profile_id: data.profileId, operation: "memory_retrieval" },
          "Retrieving memory for profile"
        );
        try {
          const memoryResponse = await this.memoryClient.retrieveMemories(
            this.memoryStoreId,
            data.profileId,
            {
              conversationId: data.conversationId,
              observationsLimit: this.config.memoryConfig.observationsLimit,
              summariesLimit: this.config.memoryConfig.summariesLimit,
              communicationsLimit: this.config.memoryConfig.communicationsLimit,
              relevanceThreshold: this.config.memoryConfig.relevanceThreshold
            }
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
        const response = await this.messageReadyCallback({
          conversationId: data.conversationId,
          profileId: data.profileId,
          message: data.message,
          author: data.author,
          memory: memory ?? void 0,
          session,
          channel: channel.channelType,
          ...data.abortSignal !== void 0 && { abortSignal: data.abortSignal }
        });
        this.logger.debug(
          { conversation_id: data.conversationId },
          "Message ready callback completed"
        );
        if (typeof response === "string") {
          if (response === "") {
            this.logger.warn(
              { conversation_id: data.conversationId },
              "Callback returned empty string, skipping auto-send"
            );
          } else {
            try {
              await channel.sendResponse(data.conversationId, response);
            } catch (sendError) {
              this.logger.error(
                { err: sendError, conversation_id: data.conversationId },
                "Failed to auto-send callback response"
              );
            }
          }
        }
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
   * Register callback for when messages are ready to be processed.
   * Return a string to auto-send, or null/void for manual handling.
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
   */
  getMemoryClient() {
    return this.memoryClient;
  }
  /**
   * Get the memory store ID resolved from the ConversationConfiguration at startup.
   */
  getMemoryStoreId() {
    return this.memoryStoreId;
  }
  /**
   * Get knowledge client for knowledge base operations
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
        "Conversation Intelligence processor is not initialized. Ensure cintelConfigurationId is provided in TAC configuration."
      );
    }
    return this.cintelProcessor.processEvent(payload);
  }
  /**
   * Retrieve memories from Memory API with automatic fallback to Conversations API
   *
   * @param session - Conversation session context
   * @param query - Optional semantic search query
   * @returns Promise containing TACMemoryResponse wrapper providing unified access to memory data.
   *
   * Attempts to retrieve from Memory API first:
   * - observations, summaries, and communications available
   * - communications include author name and type
   *
   * Falls back to Conversations API on error:
   * - observations and summaries are empty arrays
   * - communications have basic fields only (no author name/type)
   */
  async retrieveMemory(session, query) {
    try {
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
        const lookupResponse = await this.memoryClient.lookupProfile(
          this.memoryStoreId,
          identityType,
          session.authorInfo.address
        );
        if (!lookupResponse.profiles || lookupResponse.profiles.length === 0) {
          throw new Error(
            `No profile found for ${identityType} ${session.authorInfo.address}. Profile lookup returned no results. Ensure the identity is registered in the identity resolution system.`
          );
        }
        session.profileId = lookupResponse.profiles[0];
      }
      const memoryResponse = await this.memoryClient.retrieveMemories(
        this.memoryStoreId,
        session.profileId,
        {
          conversationId: session.conversationId,
          query,
          observationsLimit: this.config.memoryConfig.observationsLimit,
          summariesLimit: this.config.memoryConfig.summariesLimit,
          communicationsLimit: this.config.memoryConfig.communicationsLimit,
          relevanceThreshold: this.config.memoryConfig.relevanceThreshold
        }
      );
      return new TACMemoryResponse(memoryResponse);
    } catch (error) {
      this.logger.warn(
        { err: error },
        "Failed to retrieve memory from Memory API, falling back to Conversations API"
      );
      try {
        const communications = await this.conversationClient.listCommunications(
          session.conversationId
        );
        return new TACMemoryResponse(communications);
      } catch (fallbackError) {
        this.logger.error({ err: fallbackError }, "Failed to retrieve communications");
        throw fallbackError;
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
    if (!profileId) {
      this.logger.warn("profile_id is required for profile fetching but was not provided");
      return void 0;
    }
    try {
      const traitGroups = this.config.memoryConfig.traitGroups;
      const profileResponse = await this.memoryClient.getProfile(
        this.memoryStoreId,
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
   * Check if a message is from the bot itself.
   *
   * 1. Default agent address (stateless, no API call)
   * 2. Session metadata fromAddress (works same-process for custom `from`)
   * 3. API lookup: resolve participantId → participant type (works cross-process
   *    for custom `from` when session is missing, e.g., after restart or on
   *    another worker)
   */
  async isOwnMessage(authorAddress, conversationId, authorParticipantId) {
    if (this.isDefaultAgentAddress(authorAddress)) return true;
    const session = this.activeConversations.get(conversationId);
    if (session?.metadata?.fromAddress === authorAddress) return true;
    if (session) return false;
    if (authorParticipantId) {
      try {
        const participants = await this.conversationClient.listParticipants(conversationId);
        const authorParticipant = participants.find((p) => p.id === authorParticipantId);
        if (authorParticipant) {
          if (authorParticipant.type === void 0) {
            this.logger.warn(
              { conversation_id: conversationId, participant_id: authorParticipantId },
              "Participant type is undefined \u2014 cannot determine if this is an agent message"
            );
          }
          if (authorParticipant.type === "AI_AGENT" || authorParticipant.type === "HUMAN_AGENT" || authorParticipant.type === "AGENT") {
            return true;
          }
        }
      } catch (error) {
        this.logger.warn(
          { err: error, conversation_id: conversationId, participant_id: authorParticipantId },
          "Failed to look up participant type for self-message check; falling through"
        );
      }
    }
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
    const communicationId = payload.data?.id;
    if (communicationId) {
      const session2 = this.getConversationSession(conversationId);
      if (session2?.metadata?.lastCommunicationId === communicationId) {
        this.logger.debug(
          { conversation_id: conversationId, communication_id: communicationId },
          "Skipping already-processed communication"
        );
        return;
      }
    }
    if (await this.isOwnMessage(author, conversationId, payload.data?.author?.participantId)) {
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
      if (communicationId) {
        if (!session.metadata) {
          session.metadata = {};
        }
        session.metadata.lastCommunicationId = communicationId;
      }
    }
    let userMemory;
    if (session) {
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
  /**
   * Return the conversation's AI_AGENT participant, creating one if absent.
   *
   * Returns the first participant in `existingParticipants` whose type is
   * AI_AGENT / HUMAN_AGENT / AGENT and owns `agentAddress`. If none match,
   * creates an AI_AGENT with that address. On failure from another worker
   * creating it concurrently (typically 409), re-lists and re-matches.
   *
   * Returns undefined if match-then-create-then-retry all fail. The caller
   * should log and bail on undefined.
   */
  async ensureAgentParticipant(conversationId, existingParticipants, agentAddress) {
    const matches = (p) => (p.type === "AI_AGENT" || p.type === "HUMAN_AGENT" || p.type === "AGENT") && Array.isArray(p.addresses) && p.addresses.some(
      (a) => a.channel === agentAddress.channel && a.address === agentAddress.address
    );
    const existing = existingParticipants.find(matches);
    if (existing) {
      return existing;
    }
    this.logger.debug(
      {
        conversation_id: conversationId,
        channel: agentAddress.channel,
        address: agentAddress.address
      },
      "No agent participant found, creating AI_AGENT"
    );
    try {
      const agent2 = await this.conversationClient.addParticipant(
        conversationId,
        [agentAddress],
        "AI_AGENT"
      );
      this.logger.debug(
        {
          conversation_id: conversationId,
          participant_id: agent2.id
        },
        "Created AI_AGENT participant"
      );
      return agent2;
    } catch (error) {
      this.logger.warn(
        { err: error, conversation_id: conversationId },
        "Failed to create AI_AGENT, retrying participant list"
      );
    }
    let retried;
    try {
      retried = await this.conversationClient.listParticipants(conversationId);
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: conversationId },
        "Failed to retry listing participants"
      );
      return void 0;
    }
    const agent = retried.find(matches);
    if (!agent) {
      this.logger.error(
        { conversation_id: conversationId },
        "Failed to create or find AI_AGENT participant"
      );
    }
    return agent;
  }
  /**
   * Shared outbound conversation initiation for messaging channels (SMS/Chat).
   *
   * Handles the full flow: create conversation → find participants → start
   * session → send initial message → error cleanup.
   */
  async initiateOutboundMessagingConversation(params) {
    const {
      channel,
      to,
      from: fromAddress,
      message,
      metadata,
      channelId,
      channelSettings
    } = params;
    let conversationId;
    let conversationReused = false;
    try {
      const customerAddress = {
        channel,
        address: to,
        ...channelId ? { channelId } : {}
      };
      const agentAddress = {
        channel,
        address: fromAddress,
        ...channelId ? { channelId } : {}
      };
      const result = await this.conversationClient.createOrReuseConversation([
        { type: "CUSTOMER", addresses: [customerAddress] },
        { type: "AI_AGENT", addresses: [agentAddress] }
      ]);
      conversationId = result.conversation.id;
      conversationReused = result.reused;
      if (!isConversationId(conversationId)) {
        throw new Error(`Invalid conversation ID returned: ${conversationId}`);
      }
      const participants = await this.conversationClient.listParticipants(conversationId);
      const customerParticipant = participants.find(
        (p) => p.type === "CUSTOMER" && Array.isArray(p.addresses) && p.addresses.some(
          (a) => a.channel === channel && a.address === to && (channelId === void 0 || a.channelId === channelId)
        )
      );
      if (!customerParticipant) {
        throw new Error("Customer participant not found after conversation creation");
      }
      const agentParticipant = participants.find(
        (p) => (p.type === "AI_AGENT" || p.type === "HUMAN_AGENT" || p.type === "AGENT") && Array.isArray(p.addresses) && p.addresses.some(
          (a) => a.channel === channel && a.address === fromAddress && (channelId === void 0 || a.channelId === channelId)
        )
      );
      if (!agentParticipant) {
        throw new Error("Agent participant not found after conversation creation");
      }
      const session = this.startConversation(conversationId);
      session.authorInfo = {
        address: to,
        participantId: customerParticipant.id
      };
      session.metadata = {
        ...session.metadata,
        ...metadata ?? {},
        direction: "outbound",
        fromAddress,
        ...channelId ? { channelId } : {}
      };
      const actionRequest = {
        type: "SEND_MESSAGE",
        payload: {
          from: { channel, participantId: agentParticipant.id },
          to: [{ channel, participantId: customerParticipant.id }],
          content: { text: message },
          ...channelSettings ? { channelSettings } : {}
        }
      };
      await this.conversationClient.createAction(conversationId, actionRequest);
      this.logger.info(
        { conversation_id: conversationId, to },
        `Outbound ${channel} conversation initiated`
      );
      return { conversationId, session };
    } catch (error) {
      if (conversationId) {
        this.activeConversations.delete(conversationId);
      }
      if (conversationId && !conversationReused) {
        await this.conversationClient.updateConversation(conversationId, "CLOSED").catch((closeErr) => {
          this.logger.warn(
            { err: closeErr, conversation_id: conversationId },
            "Failed to close orphaned conversation after initiation error"
          );
        });
      }
      this.logger.error({ err: error, to }, `Failed to initiate outbound ${channel}`);
      this.handleError(error instanceof Error ? error : new Error(String(error)), { to });
      throw error;
    }
  }
};

// packages/core/src/channels/sms.ts
var SMSChannel = class extends MessagingChannel {
  get channelType() {
    return "sms";
  }
  isDefaultAgentAddress(authorAddress) {
    return authorAddress === this.config.phoneNumber;
  }
  /**
   * Send SMS response using the Conversation Orchestrator Actions API (SEND_MESSAGE).
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
      let customerParticipantId;
      for (const p of participants) {
        if (p.type !== "CUSTOMER" || !Array.isArray(p.addresses)) continue;
        const smsAddress = p.addresses.find(
          (a) => a.channel === "SMS" && a.address === recipientAddress
        );
        if (smsAddress) {
          customerParticipantId = p.id;
          break;
        }
      }
      const agentAddress = typeof session.metadata?.fromAddress === "string" ? session.metadata.fromAddress : this.config.phoneNumber;
      const agentParticipant = await this.ensureAgentParticipant(conversationId, participants, {
        channel: "SMS",
        address: agentAddress
      });
      if (!agentParticipant) {
        throw new Error(
          `Failed to resolve AI_AGENT participant for conversation ${conversationId}`
        );
      }
      if (!customerParticipantId) {
        throw new Error(
          `Customer participant not found on SMS channel for conversation ${conversationId}`
        );
      }
      const channelId = typeof session.metadata?.channelId === "string" ? session.metadata.channelId : void 0;
      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_address: recipientAddress,
          recipient_participant_id: customerParticipantId,
          agent_participant_id: agentParticipant.id,
          from_number: agentAddress
        },
        "Sending SMS via Actions API"
      );
      const actionRequest = {
        type: "SEND_MESSAGE",
        payload: {
          from: {
            channel: "SMS",
            participantId: agentParticipant.id
          },
          to: [
            {
              channel: "SMS",
              participantId: customerParticipantId
            }
          ],
          content: { text: message },
          ...channelId ? { channelSettings: { channelId } } : {}
        }
      };
      await this.conversationClient.createAction(conversationId, actionRequest);
      this.logger.info(
        { conversation_id: conversationId, recipient_address: recipientAddress },
        "SMS sent successfully via Actions API"
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
  /**
   * Initiate an outbound SMS conversation
   *
   * Creates a conversation via Conversation Orchestrator, adds customer and
   * agent participants, then sends the initial message via the Actions API.
   */
  async initiateOutboundConversation(options) {
    const validated = InitiateMessagingConversationOptionsSchema.parse(options);
    this.logger.info(
      { to: validated.to, message_length: validated.message.length },
      "Initiating outbound SMS conversation"
    );
    return this.initiateOutboundMessagingConversation({
      channel: "SMS",
      to: validated.to,
      from: validated.from ?? this.config.phoneNumber,
      message: validated.message,
      ...validated.metadata ? { metadata: validated.metadata } : {}
    });
  }
};
var InitiateChatConversationOptionsSchema = z.object({
  to: z.string().min(1, "Recipient identity is required"),
  /**
   * Custom sender address. Defaults to agentAddress.
   * Own-message filtering considers outbound sender values, including
   * agentAddress and session metadata such as fromAddress.
   */
  from: z.string().optional(),
  channelId: z.string().min(1, "Chat Channel SID is required"),
  message: z.string().min(1, "Initial message is required"),
  metadata: z.record(z.unknown()).optional()
});
var ChatChannel = class extends MessagingChannel {
  agentAddress;
  constructor(tac, config) {
    super(tac, config);
    this.agentAddress = config?.agentAddress ?? "ai-assistant";
  }
  get channelType() {
    return "chat";
  }
  isDefaultAgentAddress(authorAddress) {
    return authorAddress === this.agentAddress;
  }
  /**
   * Send chat response using the Conversation Orchestrator Actions API (SEND_MESSAGE).
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
      const recipientParticipantId = session.authorInfo.participantId;
      if (!recipientParticipantId) {
        throw new Error(`No recipient participant ID found for conversation ${conversationId}`);
      }
      const chatChannelSid = typeof session.metadata?.channelId === "string" ? session.metadata.channelId : void 0;
      if (!chatChannelSid) {
        throw new Error(
          "Missing required session.metadata['channelId'] for chat sendResponse; this is normally populated by an inbound webhook. Ensure an inbound message has been processed before calling sendResponse, or set session.metadata['channelId'] explicitly in advanced usage."
        );
      }
      const participants = await this.conversationClient.listParticipants(conversationId);
      const effectiveAgentAddress = typeof session.metadata?.fromAddress === "string" ? session.metadata.fromAddress : this.agentAddress;
      const agentParticipant = await this.ensureAgentParticipant(conversationId, participants, {
        channel: "CHAT",
        address: effectiveAgentAddress,
        channelId: chatChannelSid
      });
      if (!agentParticipant) {
        throw new Error(
          `Failed to resolve AI_AGENT participant for conversation ${conversationId}`
        );
      }
      const chatServiceSid = this.tac.conversationsV1ServiceSid;
      const channelSettings = {
        channelId: chatChannelSid,
        ...chatServiceSid ? { chatService: chatServiceSid } : {}
      };
      this.logger.debug(
        {
          conversation_id: conversationId,
          recipient_participant_id: session.authorInfo.participantId,
          agent_participant_id: agentParticipant.id,
          agent_address: effectiveAgentAddress,
          channel_id: chatChannelSid
        },
        "Sending chat message via Actions API"
      );
      const actionRequest = {
        type: "SEND_MESSAGE",
        payload: {
          from: {
            channel: "CHAT",
            participantId: agentParticipant.id
          },
          to: [
            {
              channel: "CHAT",
              participantId: recipientParticipantId
            }
          ],
          content: { text: message },
          channelSettings
        }
      };
      await this.conversationClient.createAction(conversationId, actionRequest);
      this.logger.info(
        { conversation_id: conversationId, channel_id: chatChannelSid },
        "Chat message sent successfully via Actions API"
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
  /**
   * Initiate an outbound chat conversation
   *
   * Creates a conversation via Conversation Orchestrator, adds customer and
   * agent participants, then sends the initial message via the Actions API.
   */
  async initiateOutboundConversation(options) {
    const validated = InitiateChatConversationOptionsSchema.parse(options);
    this.logger.info(
      { to: validated.to, channel_id: validated.channelId },
      "Initiating outbound chat conversation"
    );
    const chatServiceSid = this.tac.conversationsV1ServiceSid;
    return this.initiateOutboundMessagingConversation({
      channel: "CHAT",
      to: validated.to,
      from: validated.from ?? this.agentAddress,
      message: validated.message,
      ...validated.metadata ? { metadata: validated.metadata } : {},
      channelId: validated.channelId,
      channelSettings: {
        channelId: validated.channelId,
        ...chatServiceSid ? { chatService: chatServiceSid } : {}
      }
    });
  }
};

// packages/core/src/util/handoff-urls.ts
function studioExecutionsUrl(flowSid) {
  return `https://studio.twilio.com/v2/Flows/${flowSid}/Executions`;
}
function studioVoiceHandoffUrl(accountSid, flowSid) {
  return `https://webhooks.twilio.com/v1/Accounts/${accountSid}/Flows/${flowSid}?Trigger=incomingCall`;
}

// packages/core/src/channels/voice.ts
var DEFAULT_WELCOME_GREETING = "Hello! How can I assist you today?";
function stringifyParameterValue(value) {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
var VoiceChannel = class extends BaseChannel {
  webSocketConnections;
  voiceCallbacks;
  streamTasks;
  promptQueues;
  initializationRetries;
  MAX_INITIALIZATION_RETRIES = 3;
  twilioClient;
  voiceConfig;
  onInboundCallTwimlHandler;
  constructor(tac, config = {}) {
    super(tac);
    this.webSocketConnections = /* @__PURE__ */ new Map();
    this.voiceCallbacks = {};
    this.streamTasks = /* @__PURE__ */ new Map();
    this.promptQueues = /* @__PURE__ */ new Map();
    this.initializationRetries = /* @__PURE__ */ new Map();
    this.voiceConfig = config;
  }
  /**
   * Register a callback that produces per-call overrides for the TwiML inside
   * `<ConversationRelay>` on inbound calls.
   *
   * The callback receives a framework-neutral {@link TwiMLRequest} (parsed from
   * the Twilio webhook form) and returns a ConversationRelayConfig. Keys the
   * callback explicitly sets override `defaultTwimlOptions` and TAC defaults;
   * unset keys fall through.
   *
   * Outbound calls don't use this — pass per-call TwiML via
   * `InitiateVoiceConversationOptions.twimlOptions` instead.
   */
  onInboundCallTwiml(callback) {
    this.onInboundCallTwimlHandler = callback;
  }
  /**
   * Resolve the public WebSocket URL from TACConfig.voicePublicDomain +
   * voiceWebsocketPath. Throws if voicePublicDomain isn't set.
   */
  resolveWebsocketUrl(action) {
    if (this.config.voicePublicDomain) {
      return `wss://${this.config.voicePublicDomain}${this.config.voiceWebsocketPath}`;
    }
    throw new Error(
      `${action} needs a WebSocket URL. Set TWILIO_VOICE_PUBLIC_DOMAIN (or TACConfig.voicePublicDomain).`
    );
  }
  /**
   * Resolve the default `<Connect action=...>` cleanup URL. Returns undefined
   * if voicePublicDomain isn't set — fine, because action_url has
   * higher-priority layers (customizer, twimlOptions, Studio handoff).
   */
  resolveDefaultActionUrl() {
    if (this.config.voicePublicDomain) {
      return `https://${this.config.voicePublicDomain}${this.config.voiceActionPath}`;
    }
    return void 0;
  }
  /**
   * Layer TwiML options: TAC defaults -> channel `defaultTwimlOptions` ->
   * `perCall` (customizer output for inbound, or twimlOptions for outbound).
   * Mirrors Python's `_build_twiml_options`.
   *
   * Returns the merged `<ConversationRelay>` config (with `url` set) plus the
   * separately-resolved `actionUrl` for the enclosing `<Connect>`.
   */
  buildTwimlOptions(websocketUrl, perCall) {
    const merged = {
      url: websocketUrl,
      welcomeGreeting: DEFAULT_WELCOME_GREETING
    };
    const conversationConfiguration = this.config.conversationConfigurationId;
    if (conversationConfiguration) {
      merged.conversationConfiguration = conversationConfiguration;
    }
    const actionUrl = this.resolveActionUrl(perCall);
    if (this.voiceConfig.defaultTwimlOptions) {
      this.overlayFields(merged, this.voiceConfig.defaultTwimlOptions);
    }
    if (perCall) {
      this.overlayFields(merged, perCall);
    }
    return { config: merged, actionUrl };
  }
  /**
   * Apply keys explicitly present on `source` onto `target`. Lists
   * (`languages`) and nested objects (`extra`) replace wholesale.
   *
   * `actionUrl`/`url` are skipped — `url` is owned by the caller and the action
   * URL is resolved once across all layers via {@link resolveActionUrl}.
   */
  overlayFields(target, source) {
    for (const [key, value] of Object.entries(source)) {
      if (key === "actionUrl" || key === "url") continue;
      if (value === void 0) continue;
      target[key] = value;
    }
  }
  /**
   * Resolve the TwiML `<Connect action=...>` URL. Precedence (highest first):
   *   1. customizer / per-call twimlOptions (`actionUrl` key present)
   *   2. channel `defaultTwimlOptions.actionUrl`
   *   3. Studio handoff (when studioHandoffFlowSid is configured)
   *   4. Channel default derived from voicePublicDomain + voiceActionPath.
   *
   * An explicit `actionUrl: undefined`... has no representation in JS object
   * spreads (the key is simply absent), so unlike Python there is no
   * "explicitly suppress" sentinel — omit the key to fall through.
   */
  resolveActionUrl(perCall) {
    if (perCall && "actionUrl" in perCall && perCall.actionUrl !== void 0) {
      return perCall.actionUrl;
    }
    const channelDefault = this.voiceConfig.defaultTwimlOptions;
    if (channelDefault && "actionUrl" in channelDefault && channelDefault.actionUrl !== void 0) {
      return channelDefault.actionUrl;
    }
    if (this.config.studioHandoffFlowSid) {
      return studioVoiceHandoffUrl(this.config.accountSid, this.config.studioHandoffFlowSid);
    }
    return this.resolveDefaultActionUrl();
  }
  getTwilioClient() {
    if (!this.twilioClient) {
      this.twilioClient = twilio(this.config.apiKey, this.config.apiSecret, {
        accountSid: this.config.accountSid
      });
    }
    return this.twilioClient;
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
                  const POLL_ATTEMPTS = 5;
                  const POLL_DELAY_MS = 500;
                  let conversations = [];
                  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
                    conversations = await this.conversationClient.listConversations({
                      channelId: callSid
                    });
                    if (conversations.length === 1) break;
                    if (attempt < POLL_ATTEMPTS - 1) {
                      this.logger.debug(
                        { call_sid: callSid, attempt: attempt + 1, found: conversations.length },
                        "Conversation not ready yet, polling again"
                      );
                      await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
                    }
                  }
                  if (conversations.length !== 1) {
                    throw new Error(
                      `Expected exactly 1 conversation for callSid ${callSid}, but found ${conversations.length} after ${POLL_ATTEMPTS} attempts`
                    );
                  }
                  const conversation = conversations[0];
                  conversationId = conversation.id;
                  const participants = await this.conversationClient.listParticipants(conversationId);
                  const customerParticipant = participants.find((p) => p.type === "CUSTOMER");
                  const customerAddress = customerParticipant?.addresses?.find((a) => a.channel === "VOICE")?.address ?? fromNumber ?? void 0;
                  const profileId = customerParticipant?.profileId ? customerParticipant.profileId : void 0;
                  this.webSocketConnections.set(conversationId, ws);
                  const session = this.startConversation(conversationId, profileId);
                  if (customerAddress) {
                    session.authorInfo = {
                      address: customerAddress
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
    const streamTask = this.startStreamTask(conversationId);
    const session = this.getConversationSession(conversationId);
    let userMemory;
    if (session) {
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
      await this.voiceCallbacks.onPrompt({
        conversationId,
        transcript,
        abortSignal: streamTask.controller.signal,
        ...userMemory !== void 0 && { userMemory },
        ...session !== void 0 && { session }
      });
    }
  }
  /**
   * Handle WebSocket interrupt message
   */
  handleInterruptMessage(conversationId, message) {
    const { utteranceUntilInterrupt, durationUntilInterruptMs } = message;
    const streamTask = this.streamTasks.get(conversationId);
    const wasStreaming = streamTask?.hasSentTokens ?? false;
    const cancelled = this.cancelStreamTask(conversationId);
    if (cancelled) {
      this.logger.info(
        { conversation_id: conversationId },
        "Cancelled stream task due to interrupt"
      );
    }
    if (cancelled && wasStreaming) {
      const ws = this.webSocketConnections.get(conversationId);
      if (ws?.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "text", token: "", last: true }));
        } catch (err) {
          this.logger.debug(
            { conversation_id: conversationId, err },
            "WebSocket closed before sending stream finalization"
          );
        }
      }
    }
    if (this.voiceCallbacks.onInterrupt) {
      this.voiceCallbacks.onInterrupt({
        conversationId,
        utteranceUntilInterrupt,
        durationUntilInterruptMs
      });
    }
  }
  /**
   * Handle WebSocket disconnection
   */
  async handleWebSocketDisconnect(conversationId) {
    this.cancelStreamTask(conversationId);
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
      const session = this.getConversationSession(conversationId);
      if (session?.pendingHandoffData) {
        try {
          ws.send(JSON.stringify(session.pendingHandoffData));
          delete session.pendingHandoffData;
        } catch (err) {
          this.logger.warn(
            { err, conversation_id: conversationId },
            "WebSocket closed before sending handoff end message; caller will not be transferred"
          );
        }
      }
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
  /**
   * Send a streaming voice response via WebSocket, token by token.
   *
   * Each chunk from the iterable is sent as a text token message with last: false.
   * After the iterable completes, a final empty marker with last: true is sent
   * only if at least one token was emitted. If the AbortSignal fires (e.g., user
   * interrupted), iteration stops and no final marker is sent (the interrupt
   * handler sends the finalization instead).
   *
   * @returns The accumulated full response text.
   */
  async sendStreamingResponse(conversationId, stream, options) {
    const ws = this.webSocketConnections.get(conversationId);
    if (ws?.readyState !== WebSocket.OPEN) {
      throw new Error(`No active WebSocket connection for conversation ${conversationId}`);
    }
    const activeTask = this.streamTasks.get(conversationId);
    const signal = options?.signal ?? activeTask?.controller.signal;
    let fullResponse = "";
    let hasSentTokens = false;
    if (signal?.aborted) {
      return fullResponse;
    }
    try {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          break;
        }
        if (ws.readyState !== WebSocket.OPEN) {
          this.logger.info(
            { conversation_id: conversationId },
            "WebSocket closed during streaming"
          );
          break;
        }
        fullResponse += chunk;
        const tokenMessage = {
          type: "text",
          token: chunk,
          last: false
        };
        ws.send(JSON.stringify(tokenMessage));
        hasSentTokens = true;
        if (activeTask) {
          activeTask.hasSentTokens = true;
        }
      }
      if (!signal?.aborted && hasSentTokens && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "text", token: "", last: true }));
      }
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId
      });
      throw error;
    } finally {
      if (activeTask && this.streamTasks.get(conversationId) === activeTask) {
        this.completeStreamTask(conversationId);
      }
    }
    return fullResponse;
  }
  // =========================================================================
  // Incoming Call Handling
  // =========================================================================
  /**
   * Handle incoming voice call — generate TwiML to connect to ConversationRelay.
   *
   * The WebSocket URL and default session-cleanup action URL are derived from
   * TACConfig.voicePublicDomain + voiceWebsocketPath / voiceActionPath.
   *
   * TwiML fields are merged per-field, highest precedence first:
   *   1. Output of the customizer registered via `onInboundCallTwiml(...)` (if
   *      configured and `twimlRequest` is given).
   *   2. `VoiceChannelConfig.defaultTwimlOptions` — per-channel defaults.
   *   3. TAC defaults: default welcomeGreeting, conversationConfiguration from
   *      TACConfig, and the action URL (Studio handoff if configured, else
   *      derived from voicePublicDomain + voiceActionPath).
   *
   * @param twimlRequest - Parsed Twilio webhook fields, passed to the customizer.
   * @returns TwiML XML string with ConversationRelay configuration.
   * @throws {Error} if the WebSocket URL can't be resolved (voicePublicDomain unset).
   */
  async handleIncomingCall(twimlRequest) {
    const websocketUrl = this.resolveWebsocketUrl("handleIncomingCall");
    let customized;
    if (this.onInboundCallTwimlHandler && twimlRequest) {
      customized = await this.onInboundCallTwimlHandler(twimlRequest);
    }
    const { config, actionUrl } = this.buildTwimlOptions(websocketUrl, customized);
    return this.connectConversationRelay(config, actionUrl ? { actionUrl } : void 0);
  }
  // =========================================================================
  // Outbound Call Handling
  // =========================================================================
  /**
   * Initiate an outbound voice conversation
   *
   * Places an outbound call with inline TwiML that connects to ConversationRelay.
   * The conversationConfiguration attribute tells CO to create and manage the
   * conversation during passive hydration. The session is initialized lazily
   * on the first prompt when the conversation is discovered by callSid.
   *
   * The WebSocket URL is derived from TACConfig.voicePublicDomain +
   * voiceWebsocketPath, unless overridden per-call via `options.websocketUrl`.
   *
   * TwiML fields are merged per-field, highest precedence first:
   *   1. `options.twimlOptions` — per-call overrides
   *   2. `VoiceChannelConfig.defaultTwimlOptions` — channel-wide defaults
   *   3. TAC defaults (welcome greeting, conversationConfiguration, action URL).
   */
  async initiateOutboundConversation(options) {
    const validated = InitiateVoiceConversationOptionsSchema.parse(options);
    const fromNumber = validated.from ?? this.config.phoneNumber;
    const websocketUrl = validated.websocketUrl ?? this.resolveWebsocketUrl("initiateOutboundConversation");
    this.logger.info(
      { to: validated.to, from: fromNumber },
      "Initiating outbound voice conversation"
    );
    try {
      const { config, actionUrl } = this.buildTwimlOptions(websocketUrl, validated.twimlOptions);
      const twiml = this.connectConversationRelay(config, actionUrl ? { actionUrl } : void 0);
      const client = this.getTwilioClient();
      const call = await client.calls.create({
        to: validated.to,
        from: fromNumber,
        twiml
      });
      this.logger.info({ call_sid: call.sid, to: validated.to }, "Outbound voice call placed");
      return { callSid: call.sid };
    } catch (error) {
      this.logger.error({ err: error, to: validated.to }, "Failed to initiate outbound call");
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        to: validated.to
      });
      throw error;
    }
  }
  // =========================================================================
  // ConversationRelay Callback Handling
  // =========================================================================
  /**
   * Handle ConversationRelay callback from Twilio
   *
   * @param payload - Callback payload from Twilio
   * @returns Response with status, content, and content type
   */
  handleConversationRelayCallback(payload) {
    this.logger.debug(
      { call_sid: payload.CallSid, call_status: payload.CallStatus },
      "ConversationRelay callback received"
    );
    return Promise.resolve({ status: 200, content: "OK", contentType: "text/plain" });
  }
  // =========================================================================
  // Stream Task Management
  // =========================================================================
  /**
   * Start tracking a streaming task for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns The stream task with its AbortController
   */
  startStreamTask(conversationId) {
    this.cancelStreamTask(conversationId);
    const task = { controller: new AbortController(), hasSentTokens: false };
    this.streamTasks.set(conversationId, task);
    this.logger.debug({ conversation_id: conversationId }, "Started stream task");
    return task;
  }
  /**
   * Cancel an active streaming task
   *
   * @param conversationId - The conversation ID
   * @returns true if a task was cancelled, false otherwise
   */
  cancelStreamTask(conversationId) {
    const task = this.streamTasks.get(conversationId);
    if (task) {
      task.controller.abort();
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
    const task = this.streamTasks.get(conversationId);
    return task !== void 0 && !task.controller.signal.aborted;
  }
  // =========================================================================
  // ConversationRelay TwiML Generation
  // =========================================================================
  /**
   * Generate TwiML to connect a call to ConversationRelay.
   * Validates configuration with Zod before generating TwiML.
   *
   * @param config - ConversationRelay configuration (url, transcription, TTS, etc.)
   * @param options - Optional settings for parameters and the Connect verb
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
    const { languages, customParameters, extra, actionUrl, ...conversationRelayAttributes } = validatedConfig;
    const attributes = {
      ...this.filterUnsetValues(conversationRelayAttributes),
      ...extra ?? {}
    };
    const resolvedActionUrl = options?.actionUrl ?? actionUrl;
    const response = new VoiceResponse();
    const connect = response.connect(resolvedActionUrl ? { action: resolvedActionUrl } : {});
    const relay = connect.conversationRelay(
      attributes
    );
    if (languages && languages.length > 0) {
      for (const lang of languages) {
        const filteredLang = this.filterUnsetValues(lang);
        relay.language(filteredLang);
      }
    }
    const parameterSources = [customParameters, options?.parameters];
    for (const source of parameterSources) {
      if (!source) continue;
      for (const [name, value] of Object.entries(source)) {
        if (value === void 0 || value === null) continue;
        relay.parameter({ name, value: stringifyParameterValue(value) });
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

// packages/core/src/lib/conversation-session-helpers.ts
function formatTraitValue(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value, (_key, replacerValue) => {
      if (typeof replacerValue === "bigint") {
        return String(replacerValue);
      }
      return replacerValue;
    }) ?? String(value);
  } catch {
    return String(value);
  }
}
function buildProfilePrompt(context, traitGroups) {
  if (!context.profile || !context.profile.traits) {
    return null;
  }
  let filteredTraits;
  if (traitGroups !== void 0) {
    if (traitGroups.length === 0) {
      return null;
    }
    filteredTraits = Object.fromEntries(
      Object.entries(context.profile.traits).filter(
        ([key, value]) => traitGroups.includes(key) && value != null
      )
    );
  } else {
    filteredTraits = Object.fromEntries(
      Object.entries(context.profile.traits).filter(([, value]) => value != null)
    );
  }
  if (Object.keys(filteredTraits).length === 0) {
    return null;
  }
  const lines = ["## Customer Profile", "Information about this customer:"];
  for (const [key, value] of Object.entries(filteredTraits)) {
    lines.push(`- ${key}: ${formatTraitValue(value)}`);
  }
  return lines.join("\n");
}

// packages/core/src/adapters/options.ts
function getProfileTraits(options) {
  if (!options || options.profileTraits === void 0) {
    return void 0;
  }
  if (options.profileTraits.length === 0) {
    return [];
  }
  return options.profileTraits;
}

// packages/core/src/adapters/prompt-builder.ts
var MemoryPromptBuilder = class {
  /**
   * Build a formatted memory prompt from available memory and profile data.
   *
   * Generates a structured prompt with up to four sections:
   * - **Customer Profile**: Profile traits (filtered by options if provided)
   * - **Key Observations**: Important notes from previous interactions
   * - **Past Conversation Summaries**: Summaries of previous conversations
   * - **Recent Message History**: Recent communications with the customer
   *
   * Sections with no data are omitted. If no data is available at all, returns an empty string.
   *
   * @param memoryResponse - Memory data from TAC.retrieveMemory() containing observations,
   *                         summaries, and communications. Optional.
   * @param context - Conversation session containing profile data. Optional.
   * @param options - Configuration options for filtering profile traits. If profileTraits is
   *                  provided, only those trait groups will be included in the output. If an
   *                  empty array is provided, profile section is omitted. Optional.
   * @returns Formatted markdown prompt string ready for injection into LLM system messages.
   *          Returns empty string if no memory or profile data is available.
   */
  static build(memoryResponse, context, options) {
    if (!memoryResponse && (!context || !context.profile)) {
      return "";
    }
    const sections = [];
    if (context) {
      const traitGroups = getProfileTraits(options);
      const profileSection = buildProfilePrompt(context, traitGroups);
      if (profileSection) {
        sections.push(profileSection);
      }
    }
    if (memoryResponse) {
      const memorySections = memoryResponse.buildMemoryPrompts();
      sections.push(...memorySections);
    }
    if (sections.length === 0) {
      return "";
    }
    return this.assemblePrompt(sections);
  }
  static assemblePrompt(sections) {
    const header = [
      "# Customer Context",
      "You have access to the following information about this customer from previous interactions:",
      ""
    ];
    const body = sections.join("\n\n");
    return header.join("\n") + body;
  }
};

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
  /**
   * Convert this tool to an OpenAI Agents SDK `FunctionTool` instance.
   *
   * Unlike `toOpenAIFormat` and `toAnthropicFormat` (which return plain
   * objects consumed by HTTP APIs), the OpenAI Agents SDK dispatches on tool
   * *type*, so this returns a live `tool(...)` object with an invoke callback
   * that calls this tool and JSON-encodes the result.
   *
   * Requires the `@openai/agents` package:
   *
   *     npm install @openai/agents
   *
   * @returns A FunctionTool ready to pass to `new Agent({ tools: [...] })`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Return type depends on an optional peer dep we don't declare
  async toOpenAIAgentsSDKTool() {
    let agentsModule;
    try {
      const moduleSpec = "@openai/agents";
      agentsModule = await import(
        /* @vite-ignore */
        moduleSpec
      );
    } catch {
      throw new Error(
        "toOpenAIAgentsSDKTool() requires the @openai/agents package. Install with: npm install @openai/agents"
      );
    }
    const impl = this.implementation;
    const parameters = {
      ...this.parameters,
      additionalProperties: true
    };
    return agentsModule.tool({
      name: this.name,
      description: this.description,
      parameters,
      // Disable strict mode: the Agents SDK's strict JSON schema rejects
      // some features TAC emits (e.g. unions, top-level description).
      strict: false,
      execute: async (args) => {
        const result = await impl(args);
        return JSON.stringify(result);
      }
    });
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
function createMemoryRetrievalTool(memoryClient, serviceSid, profileId, conversationId, options = {}) {
  return defineTool(
    options.name ?? BuiltInTools.RETRIEVE_MEMORY,
    options.description ?? "Retrieve user memories including observations, summaries, and conversation history",
    {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional semantic search query to filter memories"
        },
        beginDate: {
          type: "string",
          description: "Optional start date for filtering memories (ISO 8601 format)"
        },
        endDate: {
          type: "string",
          description: "Optional end date for filtering memories (ISO 8601 format)"
        },
        observationsLimit: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          default: 20,
          description: "Maximum number of observations to retrieve. Set to 0 to skip observations."
        },
        summariesLimit: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          default: 5,
          description: "Maximum number of summaries to retrieve. Set to 0 to skip summaries."
        },
        communicationsLimit: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          default: 0,
          description: "Maximum number of communications to retrieve. Set to 0 to skip communications."
        },
        relevanceThreshold: {
          type: "number",
          minimum: 0,
          maximum: 1,
          default: 0,
          description: "Minimum relevance score threshold for observations and summaries."
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
      const request = Object.fromEntries(
        Object.entries({
          conversationId,
          query: params.query,
          beginDate: params.beginDate,
          endDate: params.endDate,
          observationsLimit: params.observationsLimit,
          summariesLimit: params.summariesLimit,
          communicationsLimit: params.communicationsLimit,
          relevanceThreshold: params.relevanceThreshold
        }).filter(([_, value]) => value !== void 0)
      );
      return memoryClient.retrieveMemories(serviceSid, profileId, request);
    }
  );
}
function createMemoryTools(memoryClient, serviceSid) {
  return {
    forProfile: (profileId, conversationId) => createMemoryRetrievalTool(memoryClient, serviceSid, profileId, conversationId),
    forSession: (profileId, conversationId) => createMemoryRetrievalTool(memoryClient, serviceSid, profileId, conversationId)
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
function buildHandoffPayload(session, memoryStoreId, attributes) {
  return {
    conversationId: session.conversationId,
    storeId: memoryStoreId,
    profileId: session.profileId ?? "",
    attributes
  };
}
async function postStudioHandoff(payload, session, options) {
  const { handoffUrl, fromAddress, apiKey, apiSecret } = options;
  const toAddress = session.authorInfo?.address ?? "";
  const form = new URLSearchParams();
  form.append("To", toAddress);
  form.append("From", fromAddress);
  form.append("Parameters", JSON.stringify({ HandoffData: payload }));
  await axios.post(handoffUrl, form.toString(), {
    timeout: 1e4,
    auth: { username: apiKey, password: apiSecret },
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
}
var DEFAULT_HANDOFF_TOOL_NAME = "handoff";
var DEFAULT_HANDOFF_TOOL_DESCRIPTION = "Hand off the conversation to a human agent. Use this when the customer requests a human, or when you cannot adequately handle the request.";
function createStudioHandoffTool(tac, session, options = {}) {
  const config = tac.getConfig();
  if (!config.studioHandoffFlowSid) {
    throw new Error(
      "createStudioHandoffTool requires tac.getConfig().studioHandoffFlowSid (set TWILIO_STUDIO_HANDOFF_FLOW_SID in your environment)."
    );
  }
  const flowSid = config.studioHandoffFlowSid;
  const staticAttributes = options.attributes ?? {};
  const toolName = options.name ?? DEFAULT_HANDOFF_TOOL_NAME;
  const toolDescription = options.description ?? DEFAULT_HANDOFF_TOOL_DESCRIPTION;
  return defineTool(
    toolName,
    toolDescription,
    {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "The reason for handing off to a human agent"
        }
      },
      required: ["reason"],
      description: "Hand off the conversation to a human agent"
    },
    async (params) => {
      const attributes = { ...staticAttributes, reason: params.reason };
      const coClient = tac.getConversationClient();
      const memoryStoreId = tac.getMemoryStoreId();
      const payload = buildHandoffPayload(session, memoryStoreId, attributes);
      try {
        await coClient.updateConversation(session.conversationId, "INACTIVE");
      } catch (err) {
        tac.logger.warn(
          { err, conversation_id: session.conversationId },
          "Failed to set conversation INACTIVE during handoff"
        );
      }
      try {
        await coClient.clearStatusCallbacks(session.conversationId);
      } catch (err) {
        tac.logger.warn(
          { err, conversation_id: session.conversationId },
          "Failed to clear status callbacks during handoff"
        );
      }
      if (session.channel === "voice") {
        const pending = {
          type: "end",
          handoffData: JSON.stringify(payload)
        };
        session.pendingHandoffData = pending;
      } else {
        try {
          await postStudioHandoff(payload, session, {
            handoffUrl: studioExecutionsUrl(flowSid),
            fromAddress: config.phoneNumber,
            apiKey: config.apiKey,
            apiSecret: config.apiSecret
          });
        } catch (err) {
          const message = err instanceof AxiosError ? err.message : err instanceof Error ? err.message : String(err);
          tac.logger.error(
            { err, conversation_id: session.conversationId },
            "Failed to deliver handoff payload"
          );
          return {
            status: "handoff_failed",
            channel: session.channel,
            error: message
          };
        }
      }
      return { status: "handoff_initiated", channel: session.channel };
    }
  );
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
    twiml: "/twiml"
  },
  development: false
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
      }
    };
    this.voiceChannel = config.voiceChannel ?? tac.getChannel("voice");
    if (this.voiceChannel && !tac.getConfig().voicePublicDomain) {
      throw new Error(
        "Voice channel is configured but TACConfig.voicePublicDomain is not set. Set it directly or via the TWILIO_VOICE_PUBLIC_DOMAIN env var."
      );
    }
    this.messagingChannels = config.messagingChannels ?? [tac.getChannel("sms"), tac.getChannel("chat")].filter((ch) => ch != null);
    if (this.messagingChannels.length === 0) {
      console.warn(
        'TACServer: No messaging channels configured. Messaging webhooks will be disabled. Register a MessagingChannel (e.g., "sms" or "chat") with TAC to enable messaging.'
      );
    }
    if (config.fastifyInstance) {
      this.fastify = config.fastifyInstance;
    } else {
      this.fastify = Fastify({
        logger: this.config.development ? {
          level: process.env.TWILIO_LOG_LEVEL || "info",
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true
            }
          }
        } : {
          level: process.env.TWILIO_LOG_LEVEL || "info"
        },
        ...config.fastify
      });
    }
  }
  getForwardedProto(request) {
    const raw = request.headers["x-forwarded-proto"];
    return raw?.split(",")[0]?.trim() || "https";
  }
  getForwardedHost(request) {
    const raw = request.headers["x-forwarded-host"] || request.headers.host;
    return raw?.split(",")[0]?.trim() || "";
  }
  /**
   * Get the full URL for webhook validation
   * Handles X-Forwarded-* headers for proxy/ngrok scenarios
   */
  getWebhookUrl(request) {
    const proto = this.getForwardedProto(request);
    const host = this.getForwardedHost(request);
    return `${proto}://${host}${request.url}`;
  }
  /**
   * Register global Twilio webhook signature validation hook
   */
  registerWebhookValidation() {
    this.fastify.addHook("preHandler", (request, reply, done) => {
      if (request.method === "GET") {
        done();
        return;
      }
      const signature = request.headers["x-twilio-signature"];
      const url = this.getWebhookUrl(request);
      const authToken = this.tac.getConfig().authToken;
      let isValid;
      if (request.url.includes("bodySHA256=")) {
        const body = request.rawBody ?? "";
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
          const formBody = request.body || {};
          const twimlRequest = twimlRequestFromForm(formBody);
          const twiml = await voiceChannel.handleIncomingCall(twimlRequest);
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
      this.tac.getConfig().voiceActionPath,
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
          const result = await voiceChannel.handleConversationRelayCallback(parseResult.data);
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
        this.tac.getConfig().voiceWebsocketPath,
        { websocket: true },
        (socket, request) => {
          const signature = request.headers["x-twilio-signature"];
          const authToken = this.tac.getConfig().authToken;
          const proto = this.getForwardedProto(request);
          const host = this.getForwardedHost(request);
          if (!host) {
            this.fastify.log.warn("WebSocket connection rejected: missing host header");
            socket.close(1008, "Invalid request");
            return;
          }
          const wsProto = proto === "https" ? "wss" : "ws";
          const fullUrl = new URL(`${wsProto}://${host}${request.url}`);
          const params = {};
          fullUrl.searchParams.forEach((value, key) => {
            params[key] = value;
          });
          const url = fullUrl.origin + fullUrl.pathname;
          const isValid = twilio.validateRequest(authToken, signature, url, params);
          if (!isValid) {
            this.fastify.log.warn(
              { url, hasSignature: !!signature },
              "WebSocket connection rejected: invalid Twilio signature"
            );
            socket.close(1008, "Invalid signature");
            return;
          }
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
      if (!this.fastify.hasContentTypeParser("application/x-www-form-urlencoded")) {
        await this.fastify.register(formbody);
      }
      if (!this.fastify.hasDecorator("websocketServer")) {
        await this.fastify.register(websocket);
      }
      if (!this.fastify.hasDecorator("gracefulShutdown")) {
        await this.fastify.register(gracefulShutdown);
      }
      const defaultJsonParser = this.fastify.getDefaultJsonParser("error", "error");
      if (this.fastify.hasContentTypeParser("application/json")) {
        this.fastify.removeContentTypeParser("application/json");
      }
      this.fastify.addContentTypeParser(
        "application/json",
        { parseAs: "string" },
        (request, body, done) => {
          request.rawBody = body;
          void defaultJsonParser(request, body, done);
        }
      );
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
          ws_websocket: this.tac.getConfig().voiceWebsocketPath,
          conversation_relay_callback: this.tac.getConfig().voiceActionPath,
          ...this.config.webhookPaths.cintel && {
            cintel_webhook: this.config.webhookPaths.cintel
          }
        },
        "TAC Server started"
      );
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

export { ActionChannelSettingsSchema, ActionParticipantRefSchema, ActionResponseSchema, ActionTextContentSchema, AuthorInfoSchema, BaseChannel, BaseClient, BuiltInTools, CaptureRuleSchema, ChannelSettingsSchema, ChannelTypeSchema, ChatChannel, CintelParticipantSchema, CommunicationContentSchema, CommunicationParticipantSchema, CommunicationSchema, ConversationAddressSchema, ConversationClient, ConversationConfigurationSchema, ConversationGroupingTypeSchema, ConversationIntelligenceConfigSchema, ConversationParticipantSchema, ConversationRelayAttributesSchema, ConversationRelayCallbackPayloadSchema, ConversationRelayConfigSchema, ConversationRelayExtraSchema, ConversationRelayOptionsSchema, ConversationResponseSchema, ConversationSessionSchema, ConversationSummaryItemSchema, ConversationsV1BridgeSchema, CreateConversationSummariesResponseSchema, CreateObservationResponseSchema, CustomParametersSchema, DEFAULT_WELCOME_GREETING, EMPTY_MEMORY_RESPONSE, EnvironmentVariables, ExecutionDetailsSchema, HandoffPayloadSchema, InitiateMessagingConversationOptionsSchema, InitiateVoiceConversationOptionsSchema, IntelligenceConfigurationSchema, InterruptMessageSchema, InterruptModeSchema, JSONSchemaSchema, KnowledgeBaseSchema, KnowledgeBaseStatusSchema, KnowledgeChunkResultSchema, KnowledgeClient, KnowledgeSearchResponseSchema, LanguageAttributesSchema, ListCommunicationsResponseSchema, ListConversationsResponseSchema, ListParticipantsResponseSchema, MemoryChannelTypeSchema, MemoryClient, MemoryCommunicationContentSchema, MemoryCommunicationSchema, MemoryDeliveryStatusSchema, MemoryParticipantSchema, MemoryParticipantTypeSchema, MemoryPromptBuilder, MemoryRetrievalRequestSchema, MemoryRetrievalResponseSchema, MessageDirectionSchema, MessagingChannel, ObservationInfoSchema, OpenAIToolSchema, OperatorProcessingResultSchema, OperatorResultEventSchema, OperatorResultProcessor, OperatorResultSchema, OperatorSchema, ParticipantAddressSchema, ParticipantAddressTypeSchema, PendingHandoffDataSchema, ProfileLookupResponseSchema, ProfileResponseSchema, PromptMessageSchema, SMSChannel, SendMessageActionPayloadSchema, SendMessageActionRequestSchema, SessionInfoSchema, SessionMessageSchema, SetupMessageSchema, StatusCallbackSchema, StatusTimeoutsSchema, SummaryInfoSchema, TAC, TACChannelTypeSchema, TACCommunicationAuthorSchema, TACCommunicationContentSchema, TACCommunicationSchema, TACConfig, TACConfigSchema, TACDeliveryStatusSchema, TACMemoryResponse, TACParticipantTypeSchema, TACServer, TACTool, TextTokenMessageSchema, ToolExecutionResultSchema, TranscriptionSchema, TranscriptionWordSchema, TwilioMemoryConfigSchema, VoiceChannel, VoiceServerConfigSchema, WebSocketMessageSchema, buildHandoffPayload, createKnowledgeSearchTool, createKnowledgeSearchToolAsync, createKnowledgeTools, createLogger, createMemoryRetrievalTool, createMemoryTools, createMessagingTools, createSendMessageTool, createStudioHandoffTool, defineTool, isConversationId, isParticipantId, isProfileId, postStudioHandoff, studioExecutionsUrl, studioVoiceHandoffUrl, twimlRequestFromForm };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map