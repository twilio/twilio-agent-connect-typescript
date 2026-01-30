import { config } from 'dotenv';
import { z } from 'zod';
export { z } from 'zod';
import pino from 'pino';
import Twilio from 'twilio';
import { WebSocket } from 'ws';
import VoiceResponse2 from 'twilio/lib/twiml/VoiceResponse.js';

// src/lib/config.ts
var EnvironmentSchema = z.enum(["dev", "stage", "prod"]).default("prod");
var ChannelTypeSchema = z.enum(["sms", "voice"]);
var TACConfigSchema = z.object({
  environment: EnvironmentSchema,
  twilioAccountSid: z.string().min(1, "Twilio Account SID is required"),
  twilioAuthToken: z.string().min(1, "Twilio Auth Token is required"),
  twilioPhoneNumber: z.string().min(1, "Twilio Phone Number is required"),
  memoryStoreId: z.string().regex(/^mem_(service|store)_[0-9a-z]{26}$/, "Invalid Memory Store ID format").optional(),
  memoryApiKey: z.string().optional(),
  memoryApiToken: z.string().optional(),
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
  TWILIO_PHONE_NUMBER: "TWILIO_PHONE_NUMBER",
  MEMORY_STORE_ID: "MEMORY_STORE_ID",
  MEMORY_API_KEY: "MEMORY_API_KEY",
  MEMORY_API_TOKEN: "MEMORY_API_TOKEN",
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
      conversationsApiUrl: "https://conversations.dev-us1.twilio.com"
    },
    stage: {
      memoryApiUrl: "https://memory.stage-us1.twilio.com",
      conversationsApiUrl: "https://conversations.stage-us1.twilio.com"
    },
    prod: {
      memoryApiUrl: "https://memory.twilio.com",
      conversationsApiUrl: "https://conversations.twilio.com"
    }
  };
  return baseUrls[environment];
}
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
  channel_id: z.string().nullable().optional()
});
var CommunicationParticipantSchema = z.object({
  address: z.string().max(254),
  channel: ParticipantAddressTypeSchema,
  participant_id: z.string().optional(),
  delivery_status: z.enum(["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]).optional()
});
var CommunicationContentSchema = z.object({
  type: z.enum(["TEXT", "TRANSCRIPTION"]).default("TEXT"),
  text: z.string().max(8388608).optional(),
  transcription: z.record(z.unknown()).optional()
});
var CommunicationSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  account_id: z.string(),
  author: CommunicationParticipantSchema,
  content: CommunicationContentSchema,
  recipients: z.array(CommunicationParticipantSchema),
  channel_id: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string().optional()
});
var AuthorInfoSchema = z.object({
  address: z.string(),
  participant_id: z.string().optional()
});
var ConversationSessionSchema = z.object({
  conversation_id: z.string().min(1, "Conversation ID is required"),
  profile_id: z.string().optional(),
  service_id: z.string().optional(),
  channel: ChannelTypeSchema,
  started_at: z.date(),
  author_info: AuthorInfoSchema.optional(),
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
  type: z.enum(["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]).optional(),
  profileId: z.string().nullable().optional(),
  addresses: z.array(ConversationAddressSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

// src/types/memory.ts
var MessageDirectionSchema = z.enum(["inbound", "outbound"]);
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
  communications: z.array(CommunicationSchema).optional().default([]),
  meta: z.object({
    queryTime: z.number().optional()
  }).optional()
});
var ProfileLookupResponseSchema = z.object({
  normalizedValue: z.string().max(255),
  profiles: z.array(z.string()).max(100)
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
var VoiceServerConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().int().positive().default(3e3),
  path: z.string().default("/twiml"),
  webhookPath: z.string().default("/voice")
});
var CustomParametersSchema = z.object({
  conversation_id: z.string().optional(),
  profile_id: z.string().optional(),
  customer_participant_id: z.string().optional(),
  ai_agent_participant_id: z.string().optional()
});
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
var VoiceResponseSchema = z.object({
  type: z.literal("text"),
  token: z.string(),
  last: z.boolean().optional().default(true)
});
var ConversationRelayCallbackPayloadSchema = z.object({
  AccountSid: z.string(),
  CallSid: z.string(),
  CallStatus: z.string(),
  // 'in-progress', 'completed', 'busy', 'no-answer', 'failed'
  From: z.string(),
  To: z.string(),
  Direction: z.string().optional(),
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

// src/lib/config.ts
var TACConfig = class _TACConfig {
  environment;
  twilioAccountSid;
  twilioAuthToken;
  twilioPhoneNumber;
  memoryStoreId;
  memoryApiKey;
  memoryApiToken;
  traitGroups;
  conversationServiceId;
  voicePublicDomain;
  cintelConfigurationId;
  cintelObservationOperatorSid;
  cintelSummaryOperatorSid;
  memoryApiUrl;
  conversationsApiUrl;
  constructor(data) {
    const validatedConfig = TACConfigSchema.parse(data);
    const serviceUrls = computeServiceUrls(validatedConfig.environment);
    this.environment = validatedConfig.environment;
    this.twilioAccountSid = validatedConfig.twilioAccountSid;
    this.twilioAuthToken = validatedConfig.twilioAuthToken;
    this.twilioPhoneNumber = validatedConfig.twilioPhoneNumber;
    if (validatedConfig.memoryStoreId) {
      this.memoryStoreId = validatedConfig.memoryStoreId;
    }
    if (validatedConfig.memoryApiKey) {
      this.memoryApiKey = validatedConfig.memoryApiKey;
    }
    if (validatedConfig.memoryApiToken) {
      this.memoryApiToken = validatedConfig.memoryApiToken;
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
  }
  /**
   * Create TACConfig from environment variables.
   *
   * Loads configuration from the following environment variables:
   * - ENVIRONMENT: TAC environment (dev, stage, or prod) - defaults to 'prod'
   * - TWILIO_ACCOUNT_SID: Twilio Account SID (required)
   * - TWILIO_AUTH_TOKEN: Twilio Auth Token (required)
   * - TWILIO_PHONE_NUMBER: Twilio Phone Number (required)
   * - MEMORY_STORE_ID: Memory Store ID (optional, for Twilio Memory)
   * - MEMORY_API_KEY: Memory API Key (optional, required if using Memory)
   * - MEMORY_API_TOKEN: Memory API Token (optional, required if using Memory)
   * - TRAIT_GROUPS: Comma-separated trait group names (optional, for profile fetching)
   * - CONVERSATION_SERVICE_ID: Twilio Conversation Configuration ID (required)
   * - VOICE_PUBLIC_DOMAIN: Public domain for voice webhooks (optional)
   *
   * @throws Error if required environment variables are not set or invalid
   *
   * @example
   * ```typescript
   * // With all env vars set in .env file
   * const config = TACConfig.fromEnv();
   *
   * // Use in TAC initialization
   * const tac = new TAC({ config });
   * ```
   */
  static fromEnv() {
    config();
    const requiredVars = [
      { key: EnvironmentVariables.TWILIO_ACCOUNT_SID, name: "TWILIO_ACCOUNT_SID" },
      { key: EnvironmentVariables.TWILIO_AUTH_TOKEN, name: "TWILIO_AUTH_TOKEN" },
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
      twilioPhoneNumber: process.env[EnvironmentVariables.TWILIO_PHONE_NUMBER],
      memoryStoreId: process.env[EnvironmentVariables.MEMORY_STORE_ID],
      memoryApiKey: process.env[EnvironmentVariables.MEMORY_API_KEY],
      memoryApiToken: process.env[EnvironmentVariables.MEMORY_API_TOKEN],
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

// src/clients/memory.ts
var MemoryClient = class {
  baseUrl;
  credentials;
  logger;
  constructor(config2, logger2) {
    this.baseUrl = config2.memoryApiUrl;
    if (!config2.memoryApiKey || !config2.memoryApiToken) {
      throw new Error(
        "Memory API credentials are required. Please set MEMORY_API_KEY and MEMORY_API_TOKEN environment variables."
      );
    }
    this.credentials = {
      username: config2.memoryApiKey,
      password: config2.memoryApiToken
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

// src/clients/conversation.ts
var ConversationClient = class {
  baseUrl;
  credentials;
  conversationServiceId;
  logger;
  constructor(config2, logger2) {
    this.baseUrl = config2.conversationsApiUrl;
    this.credentials = {
      username: config2.twilioAccountSid,
      password: config2.twilioAuthToken
    };
    this.conversationServiceId = config2.conversationServiceId;
    const baseLogger = logger2 || createLogger({ name: "tac-conversations" });
    this.logger = baseLogger.child({ client: "conversations" });
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

// src/lib/operator-result-processor.ts
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
  constructor(memoryClient, config2, logger2) {
    this.memoryClient = memoryClient;
    this.config = config2;
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

// src/lib/tac.ts
var TAC = class {
  config;
  logger;
  memoryClient;
  conversationClient;
  channels;
  cintelProcessor;
  // Callback registrations
  messageReadyCallback;
  interruptCallback;
  handoffCallback;
  constructor(options = {}) {
    const finalConfig = options.config ? options.config instanceof TACConfig ? options.config : new TACConfig(options.config) : TACConfig.fromEnv();
    const finalLogger = options.logger ?? createLogger({ name: "tac" });
    this.config = finalConfig;
    this.logger = finalLogger;
    this.channels = /* @__PURE__ */ new Map();
    if (this.config.memoryStoreId && this.config.memoryApiKey && this.config.memoryApiToken) {
      this.memoryClient = new MemoryClient(this.config, this.logger.child({ component: "memory" }));
      this.logger.info("Memory client initialized");
    } else {
      this.logger.info("Memory client not initialized (credentials not provided)");
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
        transcript
      }) => {
        const session = channel.getConversationSession(conversationId);
        if (session) {
          await this.handleMessageReady({
            conversationId,
            profileId: session.profile_id ? session.profile_id : void 0,
            message: transcript,
            author: "user",
            // Voice transcripts are always from user
            userMemory: void 0,
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
          memory = await this.memoryClient.retrieveMemories(
            this.config.memoryStoreId,
            data.profileId
          );
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
        profileId: session.profile_id ? session.profile_id : void 0,
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
   * @returns Promise containing memory retrieval response
   */
  async retrieveMemory(session, query) {
    if (this.memoryClient && this.config.memoryStoreId) {
      if (!session.profile_id) {
        this.logger.debug("profile_id not found, attempting to lookup profile using phone number");
        if (!session.author_info || !session.author_info.address) {
          throw new Error(
            "profile_id is required for memory retrieval but was not found in conversation context. Additionally, author_info.address is not available for profile lookup. Ensure either profile_id or author_info.address is provided when creating the ConversationSession."
          );
        }
        try {
          const lookupResponse = await this.memoryClient.lookupProfile(
            this.config.memoryStoreId,
            "phone",
            session.author_info.address
          );
          if (!lookupResponse.profiles || lookupResponse.profiles.length === 0) {
            throw new Error(
              `No profile found for phone number ${session.author_info.address}. Profile lookup returned no results. Ensure the phone number is registered in the identity resolution system.`
            );
          }
          session.profile_id = lookupResponse.profiles[0];
        } catch (error) {
          this.logger.error(
            { err: error },
            `Failed to lookup profile for ${session.author_info.address}`
          );
          throw error;
        }
      }
      try {
        const memory = await this.memoryClient.retrieveMemories(
          this.config.memoryStoreId,
          session.profile_id,
          { query }
        );
        return memory;
      } catch (error) {
        this.logger.error({ err: error }, "Failed to retrieve memory");
        throw error;
      }
    } else {
      this.logger.info("Twilio Memory not configured, falling back to Conversations API");
      try {
        const communications = await this.conversationClient.listCommunications(
          session.conversation_id
        );
        return {
          observations: [],
          summaries: [],
          communications
        };
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

// src/channels/base.ts
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
    this.conversationClient = new ConversationClient(this.config);
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
          profile_id: this.activeConversations.get(conversationId)?.profile_id,
          service_id: this.activeConversations.get(conversationId)?.service_id
        },
        "Conversation already active"
      );
      return this.activeConversations.get(conversationId);
    }
    const session = {
      conversation_id: conversationId,
      profile_id: profileId,
      service_id: serviceId,
      channel: this.channelType,
      started_at: /* @__PURE__ */ new Date(),
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
   * End a conversation session
   */
  endConversation(conversationId) {
    const session = this.activeConversations.get(conversationId);
    if (session) {
      this.activeConversations.delete(conversationId);
      this.logger.debug(
        {
          conversation_id: conversationId,
          channel: this.channelType,
          service_id: session.service_id
        },
        "Conversation ended"
      );
      if (this.callbacks.onConversationEnded) {
        this.callbacks.onConversationEnded({ conversationId });
      }
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
var SMSChannel = class extends BaseChannel {
  twilioClient;
  smsCallbacks;
  constructor(tac) {
    super(tac);
    this.twilioClient = Twilio(this.config.twilioAccountSid, this.config.twilioAuthToken);
    this.smsCallbacks = {};
  }
  get channelType() {
    return "sms";
  }
  /**
   * Register event callbacks (override for SMS-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  on(event, callback) {
    if (event === "messageReceived") {
      this.smsCallbacks.onMessageReceived = callback;
    } else {
      super.on(event, callback);
    }
  }
  /**
   * Process SMS webhook from Twilio Conversations Service
   */
  async processWebhook(payload) {
    this.logger.debug({ operation: "webhook_processing", payload }, "Processing webhook");
    try {
      if (!this.validateWebhookPayload(payload)) {
        throw new Error("Invalid webhook payload");
      }
      const webhookData = payload;
      const eventType = webhookData.eventType;
      const conversationId = webhookData.data?.conversationId || webhookData.data?.id;
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
          this.handleConversationUpdated(webhookData);
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
      if (profileId) {
        const session = this.getConversationSession(conversationId);
        if (session) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_profile_id: session.profile_id,
              new_profile_id: profileId
            },
            "Updating conversation profile ID from participant.added"
          );
          session.profile_id = profileId;
        }
      }
      if (payload.data?.serviceId) {
        const session = this.getConversationSession(conversationId);
        if (session && session.service_id !== payload.data.serviceId) {
          this.logger.debug(
            {
              conversation_id: conversationId,
              old_service_id: session.service_id,
              new_service_id: payload.data.serviceId
            },
            "Updating conversation configuration ID from participant.added"
          );
          session.service_id = payload.data.serviceId;
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
    if (author === this.config.twilioPhoneNumber) {
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
      const session = this.getConversationSession(conversationId);
      if (session && session.service_id !== payload.data.serviceId) {
        this.logger.debug(
          {
            conversation_id: conversationId,
            old_service_id: session.service_id,
            new_service_id: payload.data.serviceId
          },
          "Updating conversation configuration ID from communication.created"
        );
        session.service_id = payload.data.serviceId;
      }
    }
    let userMemory;
    const memoryClient = this.tac.getMemoryClient();
    if (profileId && memoryClient && this.config.memoryStoreId) {
      this.logger.debug(
        { profile_id: profileId, conversation_id: conversationId },
        "Retrieving user memory"
      );
      try {
        userMemory = await memoryClient.retrieveMemories(this.config.memoryStoreId, profileId);
        this.logger.debug({ profile_id: profileId }, "User memory retrieved");
      } catch (error) {
        this.logger.warn({ err: error, profile_id: profileId }, "Failed to retrieve user memory");
      }
    }
    if (this.smsCallbacks.onMessageReceived) {
      this.logger.debug({ conversation_id: conversationId }, "Invoking message received callback");
      this.smsCallbacks.onMessageReceived({
        conversationId,
        profileId: profileId ?? void 0,
        message,
        author,
        userMemory
      });
    }
  }
  /**
   * Handle conversation updated event
   */
  handleConversationUpdated(payload) {
    const conversationId = this.extractConversationId(payload);
    if (!conversationId) {
      throw new Error("Missing conversation ID in conversation.updated event");
    }
    if (payload.data?.status === "CLOSED") {
      this.logger.info(
        { conversation_id: conversationId, status: payload.data.status },
        "Conversation closed, cleaning up"
      );
      this.endConversation(conversationId);
    }
  }
  /**
   * Send SMS response using Twilio Messages API
   * Note: This is a workaround until Conversations Service supports sending messages
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
      try {
        this.logger.debug(
          { conversation_id: conversationId },
          "Listing participants for conversation"
        );
        const participants = await this.conversationClient.listParticipants(conversationId);
        this.logger.debug(
          {
            conversation_id: conversationId,
            participant_count: participants.length,
            service_id: session.service_id ?? this.config.conversationServiceId
          },
          "Found participants"
        );
        let messagesSent = 0;
        for (const participant of participants) {
          if (participant.type !== "CUSTOMER") {
            this.logger.debug(
              { participant_type: participant.type },
              "Skipping non-customer participant"
            );
            continue;
          }
          const addresses = participant.addresses || [];
          this.logger.debug(
            { addresses_count: addresses.length },
            "Checking participant addresses"
          );
          for (const addr of addresses) {
            if (addr.channel !== "SMS") {
              this.logger.debug({ channel: addr.channel }, "Skipping non-SMS address");
              continue;
            }
            this.logger.debug(
              { to_address: addr.address, from_number: this.config.twilioPhoneNumber },
              "Sending SMS"
            );
            await this.twilioClient.messages.create({
              to: addr.address,
              from: this.config.twilioPhoneNumber,
              body: message
            });
            this.logger.info(
              { conversation_id: conversationId, to_address: addr.address },
              "SMS sent successfully"
            );
            messagesSent++;
          }
        }
        if (messagesSent === 0) {
          this.logger.warn(
            { conversation_id: conversationId },
            "No SMS addresses found for any CUSTOMER participants"
          );
        }
      } catch (error) {
        this.logger.error(
          { err: error, conversation_id: conversationId },
          "Failed to list participants"
        );
        throw error;
      }
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
   * Validate SMS webhook payload structure
   */
  validateWebhookPayload(payload) {
    if (!super.validateWebhookPayload(payload)) {
      return false;
    }
    const webhookData = payload;
    return typeof webhookData === "object" && typeof webhookData.eventType === "string" && webhookData.eventType.length > 0;
  }
};
var VoiceChannel = class extends BaseChannel {
  webSocketConnections;
  callSidToConversationId;
  voiceCallbacks;
  streamTasks;
  constructor(tac) {
    super(tac);
    this.webSocketConnections = /* @__PURE__ */ new Map();
    this.callSidToConversationId = /* @__PURE__ */ new Map();
    this.voiceCallbacks = {};
    this.streamTasks = /* @__PURE__ */ new Map();
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
    ws.on("message", (data) => {
      try {
        const messageText = data.toString();
        const messageData = JSON.parse(messageText);
        this.logger.debug({ raw_message: messageData }, "Received WebSocket message");
        const validatedMessage = WebSocketMessageSchema.safeParse(messageData);
        if (!validatedMessage.success) {
          this.logger.error(
            { validation_errors: validatedMessage.error.errors, raw_message: messageData },
            "Invalid WebSocket message"
          );
          return;
        }
        const message = validatedMessage.data;
        switch (message.type) {
          case "setup":
            conversationId = this.handleSetupMessage(ws, message);
            break;
          case "prompt":
            if (conversationId) {
              this.handlePromptMessage(conversationId, message);
            }
            break;
          case "interrupt":
            if (conversationId) {
              this.handleInterruptMessage(conversationId, message);
            }
            break;
          default:
            this.logger.warn(
              { conversation_id: conversationId, message: messageData },
              "Unhandled WebSocket event type"
            );
            break;
        }
      } catch (error) {
        this.handleError(error instanceof Error ? error : new Error(String(error)), {
          conversationId,
          message: data.toString()
        });
      }
    });
    ws.on("close", () => {
      if (conversationId) {
        this.handleWebSocketDisconnect(conversationId);
      }
    });
    ws.on("error", (error) => {
      this.handleError(error, { conversationId });
    });
  }
  /**
   * Handle WebSocket setup message
   */
  handleSetupMessage(ws, message) {
    const { callSid, from, to, customParameters } = message;
    let conversationId;
    let profileId;
    if (customParameters?.conversation_id && typeof customParameters.conversation_id === "string" && isConversationId(customParameters.conversation_id)) {
      conversationId = customParameters.conversation_id;
    } else {
      conversationId = callSid;
    }
    if (customParameters?.profile_id && typeof customParameters.profile_id === "string" && isProfileId(customParameters.profile_id)) {
      profileId = customParameters.profile_id;
    }
    this.webSocketConnections.set(conversationId, ws);
    this.callSidToConversationId.set(callSid, conversationId);
    const session = this.startConversation(conversationId, profileId);
    session.author_info = {
      address: from
    };
    if (this.voiceCallbacks.onSetup) {
      this.voiceCallbacks.onSetup({
        conversationId,
        profileId: profileId ?? void 0,
        callSid,
        from,
        to,
        customParameters: customParameters ?? void 0
      });
    }
    if (this.voiceCallbacks.onWebSocketConnected) {
      this.voiceCallbacks.onWebSocketConnected({ conversationId });
    }
    return conversationId;
  }
  /**
   * Handle WebSocket prompt message (user speech)
   */
  handlePromptMessage(conversationId, message) {
    const transcript = message.voicePrompt;
    this.cancelStreamTask(conversationId);
    if (this.voiceCallbacks.onPrompt) {
      this.voiceCallbacks.onPrompt({
        conversationId,
        transcript
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
  handleWebSocketDisconnect(conversationId) {
    this.webSocketConnections.delete(conversationId);
    for (const [callSid, cId] of this.callSidToConversationId.entries()) {
      if (cId === conversationId) {
        this.callSidToConversationId.delete(callSid);
        break;
      }
    }
    if (this.voiceCallbacks.onWebSocketDisconnected) {
      this.voiceCallbacks.onWebSocketDisconnected({ conversationId });
    }
    this.endConversation(conversationId);
  }
  /**
   * Send voice response via WebSocket
   */
  sendResponse(conversationId, message, metadata) {
    try {
      const ws = this.webSocketConnections.get(conversationId);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
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
  // Incoming Call Handling (with conversation creation)
  // =========================================================================
  /**
   * Handle incoming voice call - create conversation, add participants, generate TwiML
   *
   * @param options - Options for handling the incoming call
   * @returns TwiML XML string with ConversationRelay configuration
   */
  async handleIncomingCall(options) {
    const {
      websocketUrl,
      toNumber,
      fromNumber,
      callSid,
      actionUrl,
      welcomeGreeting = "Hello! How can I assist you today?"
    } = options;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
    const conversationName = `tac-voice-${fromNumber}-${timestamp}`;
    const conversationClient = this.tac.getConversationClient();
    const conversation = await conversationClient.createConversation(conversationName);
    const conversationId = conversation.id;
    this.logger.debug(
      { conversation_id: conversationId, call_sid: callSid },
      "Created conversation for voice call"
    );
    const customerParticipant = await conversationClient.addParticipant(
      conversationId,
      [{ channel: "VOICE", address: fromNumber, channelId: callSid }],
      "CUSTOMER"
    );
    const profileId = customerParticipant.profileId || "";
    const customerParticipantId = customerParticipant.id;
    const aiAgentParticipant = await conversationClient.addParticipant(
      conversationId,
      [{ channel: "VOICE", address: toNumber, channelId: callSid }],
      "AI_AGENT"
    );
    const aiAgentParticipantId = aiAgentParticipant.id;
    const actionAttr = actionUrl ? ` action="${actionUrl}"` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect${actionAttr}>
        <ConversationRelay url="${websocketUrl}" welcomeGreeting="${welcomeGreeting}">
            <Parameter name="conversation_id" value="${conversationId}" />
            <Parameter name="profile_id" value="${profileId}" />
            <Parameter name="customer_participant_id" value="${customerParticipantId}" />
            <Parameter name="ai_agent_participant_id" value="${aiAgentParticipantId}" />
        </ConversationRelay>
    </Connect>
</Response>`;
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
  // TwiML Generation (legacy, without conversation creation)
  // =========================================================================
  /**
   * Generate TwiML for incoming calls
   */
  generateTwiML(options) {
    const { websocketUrl, customParameters, welcomeGreeting } = options;
    let customParamsXml = "";
    if (customParameters) {
      for (const [key, value] of Object.entries(customParameters)) {
        if (value !== void 0) {
          customParamsXml += `<Parameter name="${key}" value="${value}" />`;
        }
      }
    }
    const greetingAttr = welcomeGreeting ? ` welcomeGreeting="${welcomeGreeting}"` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${websocketUrl}"${greetingAttr}>
      ${customParamsXml}
    </ConversationRelay>
  </Connect>
</Response>`;
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
    this.callSidToConversationId.clear();
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
  const response = new VoiceResponse2();
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

export { AuthorInfoSchema, BaseChannel, BuiltInTools, ChannelTypeSchema, CintelParticipantSchema, CommunicationContentSchema, CommunicationParticipantSchema, CommunicationSchema, ConversationAddressSchema, ConversationClient, ConversationIntelligenceConfigSchema, ConversationParticipantSchema, ConversationRelayCallbackPayloadSchema, ConversationResponseSchema, ConversationSessionSchema, ConversationSummaryItemSchema, CreateConversationSummariesResponseSchema, CreateObservationResponseSchema, CustomParametersSchema, EMPTY_MEMORY_RESPONSE, EnvironmentSchema, EnvironmentVariables, ExecutionDetailsSchema, HandoffDataSchema, IntelligenceConfigurationSchema, InterruptMessageSchema, JSONSchemaSchema, MemoryClient, MemoryRetrievalRequestSchema, MemoryRetrievalResponseSchema, MessageDirectionSchema, ObservationInfoSchema, OpenAIToolSchema, OperatorProcessingResultSchema, OperatorResultEventSchema, OperatorResultProcessor, OperatorResultSchema, OperatorSchema, ParticipantAddressSchema, ParticipantAddressTypeSchema, ProfileLookupResponseSchema, ProfileResponseSchema, PromptMessageSchema, SMSChannel, SessionInfoSchema, SessionMessageSchema, SetupMessageSchema, SummaryInfoSchema, TAC, TACConfig, TACConfigSchema, ToolExecutionResultSchema, VoiceChannel, VoiceResponseSchema, VoiceServerConfigSchema, WebSocketMessageSchema, computeServiceUrls, createLogger, handleFlexHandoffLogic, isConversationId, isParticipantId, isProfileId };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map