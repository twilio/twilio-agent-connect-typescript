import { z } from 'zod';

/**
 * Channel types supported by the framework
 */
export const ChannelTypeSchema = z.enum(['sms', 'voice', 'chat']);
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
});

export type TwilioMemoryConfig = z.infer<typeof TwilioMemoryConfigSchema>;

/**
 * TAC configuration schema
 */
export const TACConfigSchema = z
  .object({
    accountSid: z.string().min(1, 'Twilio Account SID is required'),
    authToken: z.string().min(1, 'Twilio Auth Token is required'),
    apiKey: z.string().min(1, 'Twilio API Key is required').optional(),
    apiSecret: z.string().min(1, 'Twilio API Secret is required').optional(),
    phoneNumber: z.string().min(1, 'Twilio Phone Number is required'),
    memoryConfig: TwilioMemoryConfigSchema.default({}),
    conversationConfigurationId: z
      .string()
      .regex(/^conv_configuration_[0-9a-z]{26}$/, 'Invalid Conversation Configuration ID format')
      .optional(),
    voicePublicDomain: z.string().url().optional(),
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
  })
  .refine(
    data =>
      !data.conversationConfigurationId || (data.apiKey !== undefined && data.apiSecret !== undefined),
    {
      message:
        'apiKey and apiSecret are required when conversationConfigurationId is set',
      path: ['apiKey'],
    }
  );

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
  TWILIO_MEMORY_PROFILE_TRAIT_GROUPS: 'TWILIO_MEMORY_PROFILE_TRAIT_GROUPS',
  TWILIO_MEMORY_OBSERVATIONS_LIMIT: 'TWILIO_MEMORY_OBSERVATIONS_LIMIT',
  TWILIO_MEMORY_SUMMARIES_LIMIT: 'TWILIO_MEMORY_SUMMARIES_LIMIT',
  TWILIO_MEMORY_COMMUNICATIONS_LIMIT: 'TWILIO_MEMORY_COMMUNICATIONS_LIMIT',
  TWILIO_MEMORY_RELEVANCE_THRESHOLD: 'TWILIO_MEMORY_RELEVANCE_THRESHOLD',
  TWILIO_CONVERSATION_CONFIGURATION_ID: 'TWILIO_CONVERSATION_CONFIGURATION_ID',
  VOICE_PUBLIC_DOMAIN: 'VOICE_PUBLIC_DOMAIN',
  TWILIO_TAC_CI_CONFIGURATION_ID: 'TWILIO_TAC_CI_CONFIGURATION_ID',
  TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID: 'TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID',
  TWILIO_TAC_CI_SUMMARY_OPERATOR_SID: 'TWILIO_TAC_CI_SUMMARY_OPERATOR_SID',
  TWILIO_REGION: 'TWILIO_REGION',
  TWILIO_STUDIO_HANDOFF_FLOW_SID: 'TWILIO_STUDIO_HANDOFF_FLOW_SID',
} as const;

/**
 * Server configuration for built-in Fastify setup
 */
export const VoiceServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().positive().default(3000),
});

export type VoiceServerConfig = z.infer<typeof VoiceServerConfigSchema>;
