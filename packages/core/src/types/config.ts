import { z } from 'zod';

/**
 * Channel types supported by the framework
 */
export const ChannelTypeSchema = z.enum(['sms', 'voice', 'chat', 'whatsapp']);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

/**
 * Twilio Memory configuration schema
 */
export const TwilioMemoryConfigSchema = z.object({
  traitGroups: z.array(z.string()).optional(),
  observationsLimit: z.number().int().min(0).max(100).default(20),
  summariesLimit: z.number().int().min(0).max(100).default(5),
  // API default is 0 (no communications fetched). SDK defaults to 10 for a useful out-of-box experience.
  communicationsLimit: z.number().int().min(0).max(100).default(10),
  relevanceThreshold: z.number().min(0.0).max(1.0).default(0.0),
  /**
   * Trait group name that holds the phone identifier on newly created profiles.
   * Must match the promoted-to-identifier configuration of the Conversation Memory store.
   */
  phoneTraitGroup: z.string().default('Contact'),
  /** Trait field name within `phoneTraitGroup` that holds the phone identifier. */
  phoneTraitField: z.string().default('phone'),
});

export type TwilioMemoryConfig = z.infer<typeof TwilioMemoryConfigSchema>;

/**
 * TAC configuration schema
 */
export const TACConfigSchema = z.object({
  accountSid: z.string().min(1, 'Twilio Account SID is required'),
  authToken: z.string().min(1, 'Twilio Auth Token is required'),
  apiKey: z.string().min(1, 'Twilio API Key is required'),
  apiSecret: z.string().min(1, 'Twilio API Secret is required'),
  phoneNumber: z.string().min(1, 'Twilio Phone Number is required'),
  whatsappNumber: z
    .string()
    .regex(/^whatsapp:\+\d+$/, 'WhatsApp number must be in format: whatsapp:+1234567890')
    .optional(),
  memoryConfig: TwilioMemoryConfigSchema.default({}),
  conversationConfigurationId: z
    .string()
    .regex(/^conv_configuration_[0-9a-z]{26}$/, 'Invalid Conversation Configuration ID format')
    .optional(),
  voicePublicDomain: z
    .string()
    .max(253, 'Hostname too long (max 253 characters)')
    .regex(
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
      'Invalid hostname format. Must be a hostname without protocol, port, or path (e.g., "abc123.ngrok.app", "localhost", or "192.168.1.100")'
    )
    .optional(),
  cintelConfigurationId: z.string().optional(),
  cintelObservationOperatorSid: z.string().optional(),
  cintelSummaryOperatorSid: z.string().optional(),
  region: z
    .string()
    .max(63, 'Invalid Twilio region format (must be a valid DNS label)')
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      'Invalid Twilio region format (must be a valid DNS label)'
    )
    .optional(),
  /**
   * Twilio Studio Flow SID (FWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx) for handoff.
   * TAC derives both the digital-handoff Studio Executions URL and the voice
   * `<Connect action>` webhook URL from this SID.
   */
  studioHandoffFlowSid: z
    .string()
    .regex(
      /^FW[0-9a-f]{32}$/,
      'Invalid Studio Flow SID format (expected FW followed by 32 hex chars)'
    )
    .optional(),
});

export type TACConfigData = z.infer<typeof TACConfigSchema>;

/**
 * Environment variable mapping for configuration
 */
export const EnvironmentVariables = {
  TWILIO_ACCOUNT_SID: 'TWILIO_ACCOUNT_SID',
  TWILIO_AUTH_TOKEN: 'TWILIO_AUTH_TOKEN',
  TWILIO_API_KEY: 'TWILIO_API_KEY',
  TWILIO_API_SECRET: 'TWILIO_API_SECRET',
  TWILIO_PHONE_NUMBER: 'TWILIO_PHONE_NUMBER',
  TWILIO_WHATSAPP_NUMBER: 'TWILIO_WHATSAPP_NUMBER',
  TWILIO_MEMORY_PROFILE_TRAIT_GROUPS: 'TWILIO_MEMORY_PROFILE_TRAIT_GROUPS',
  TWILIO_MEMORY_OBSERVATIONS_LIMIT: 'TWILIO_MEMORY_OBSERVATIONS_LIMIT',
  TWILIO_MEMORY_SUMMARIES_LIMIT: 'TWILIO_MEMORY_SUMMARIES_LIMIT',
  TWILIO_MEMORY_COMMUNICATIONS_LIMIT: 'TWILIO_MEMORY_COMMUNICATIONS_LIMIT',
  TWILIO_MEMORY_RELEVANCE_THRESHOLD: 'TWILIO_MEMORY_RELEVANCE_THRESHOLD',
  TWILIO_MEMORY_PHONE_TRAIT_GROUP: 'TWILIO_MEMORY_PHONE_TRAIT_GROUP',
  TWILIO_MEMORY_PHONE_TRAIT_FIELD: 'TWILIO_MEMORY_PHONE_TRAIT_FIELD',
  TWILIO_CONVERSATION_CONFIGURATION_ID: 'TWILIO_CONVERSATION_CONFIGURATION_ID',
  TWILIO_VOICE_PUBLIC_DOMAIN: 'TWILIO_VOICE_PUBLIC_DOMAIN',
  TWILIO_TAC_CI_CONFIGURATION_ID: 'TWILIO_TAC_CI_CONFIGURATION_ID',
  TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID: 'TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID',
  TWILIO_TAC_CI_SUMMARY_OPERATOR_SID: 'TWILIO_TAC_CI_SUMMARY_OPERATOR_SID',
  TWILIO_REGION: 'TWILIO_REGION',
  TWILIO_STUDIO_HANDOFF_FLOW_SID: 'TWILIO_STUDIO_HANDOFF_FLOW_SID',
} as const;

