import { z } from 'zod';

/**
 * Channel types supported by the framework
 */
export const ChannelTypeSchema = z.enum(['sms', 'voice', 'chat']);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

/**
 * TAC configuration schema
 */
export const TACConfigSchema = z.object({
  twilioAccountSid: z.string().min(1, 'Twilio Account SID is required'),
  twilioAuthToken: z.string().min(1, 'Twilio Auth Token is required'),
  twilioApiKey: z.string().min(1, 'Twilio API Key is required'),
  twilioApiToken: z.string().min(1, 'Twilio API Token is required'),
  twilioPhoneNumber: z.string().min(1, 'Twilio Phone Number is required'),
  memoryStoreId: z
    .string()
    .regex(/^mem_(service|store)_[0-9a-z]{26}$/, 'Invalid Memory Store ID format')
    .optional(),
  traitGroups: z.array(z.string()).optional(),
  conversationServiceId: z
    .string()
    .regex(/^conv_configuration_[0-9a-z]{26}$/, 'Invalid Conversation Configuration ID format'),
  voicePublicDomain: z.string().url().optional(),
  cintelConfigurationId: z.string().optional(),
  cintelObservationOperatorSid: z.string().optional(),
  cintelSummaryOperatorSid: z.string().optional(),
  twilioRegion: z
    .string()
    .max(63, 'Invalid Twilio region format (must be a valid DNS label)')
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      'Invalid Twilio region format (must be a valid DNS label)'
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
  TWILIO_API_TOKEN: 'TWILIO_API_TOKEN',
  TWILIO_PHONE_NUMBER: 'TWILIO_PHONE_NUMBER',
  MEMORY_STORE_ID: 'MEMORY_STORE_ID',
  TRAIT_GROUPS: 'TRAIT_GROUPS',
  CONVERSATION_SERVICE_ID: 'CONVERSATION_SERVICE_ID',
  VOICE_PUBLIC_DOMAIN: 'VOICE_PUBLIC_DOMAIN',
  TWILIO_TAC_CI_CONFIGURATION_ID: 'TWILIO_TAC_CI_CONFIGURATION_ID',
  TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID: 'TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID',
  TWILIO_TAC_CI_SUMMARY_OPERATOR_SID: 'TWILIO_TAC_CI_SUMMARY_OPERATOR_SID',
  TWILIO_REGION: 'TWILIO_REGION',
} as const;

/**
 * Server configuration for built-in Fastify setup
 */
export const VoiceServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().positive().default(3000),
});

export type VoiceServerConfig = z.infer<typeof VoiceServerConfigSchema>;
