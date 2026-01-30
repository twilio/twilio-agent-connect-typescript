import { z } from 'zod';

/**
 * Environment types for the Twilio Agent Connect
 */
export const EnvironmentSchema = z.enum(['dev', 'stage', 'prod']).default('prod');
export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Channel types supported by the framework
 */
export const ChannelTypeSchema = z.enum(['sms', 'voice']);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

/**
 * TAC Configuration schema with environment-aware URL computation
 */
export const TACConfigSchema = z.object({
  environment: EnvironmentSchema,
  twilioAccountSid: z.string().min(1, 'Twilio Account SID is required'),
  twilioAuthToken: z.string().min(1, 'Twilio Auth Token is required'),
  twilioPhoneNumber: z.string().min(1, 'Twilio Phone Number is required'),
  memoryStoreId: z
    .string()
    .regex(/^mem_(service|store)_[0-9a-z]{26}$/, 'Invalid Memory Store ID format')
    .optional(),
  memoryApiKey: z.string().optional(),
  memoryApiToken: z.string().optional(),
  traitGroups: z.array(z.string()).optional(),
  conversationServiceId: z
    .string()
    .regex(
      /^(comms_service|conv_configuration)_[0-9a-z]{26}$/,
      'Invalid Conversation Configuration ID format'
    ),
  voicePublicDomain: z.string().url().optional(),
  cintelConfigurationId: z.string().optional(),
  cintelObservationOperatorSid: z.string().optional(),
  cintelSummaryOperatorSid: z.string().optional(),
});

export type TACConfigData = z.infer<typeof TACConfigSchema>;

/**
 * Environment variable mapping for configuration
 */
export const EnvironmentVariables = {
  ENVIRONMENT: 'ENVIRONMENT',
  TWILIO_ACCOUNT_SID: 'TWILIO_ACCOUNT_SID',
  TWILIO_AUTH_TOKEN: 'TWILIO_AUTH_TOKEN',
  TWILIO_PHONE_NUMBER: 'TWILIO_PHONE_NUMBER',
  MEMORY_STORE_ID: 'MEMORY_STORE_ID',
  MEMORY_API_KEY: 'MEMORY_API_KEY',
  MEMORY_API_TOKEN: 'MEMORY_API_TOKEN',
  TRAIT_GROUPS: 'TRAIT_GROUPS',
  CONVERSATION_SERVICE_ID: 'CONVERSATION_SERVICE_ID',
  VOICE_PUBLIC_DOMAIN: 'VOICE_PUBLIC_DOMAIN',
  TWILIO_TAC_CI_CONFIGURATION_ID: 'TWILIO_TAC_CI_CONFIGURATION_ID',
  TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID: 'TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID',
  TWILIO_TAC_CI_SUMMARY_OPERATOR_SID: 'TWILIO_TAC_CI_SUMMARY_OPERATOR_SID',
} as const;

/**
 * Compute service URLs based on environment
 */
export function computeServiceUrls(environment: Environment): {
  memoryApiUrl: string;
  conversationsApiUrl: string;
} {
  const baseUrls = {
    dev: {
      memoryApiUrl: 'https://memory.dev-us1.twilio.com',
      conversationsApiUrl: 'https://conversations.dev-us1.twilio.com',
    },
    stage: {
      memoryApiUrl: 'https://memory.stage-us1.twilio.com',
      conversationsApiUrl: 'https://conversations.stage-us1.twilio.com',
    },
    prod: {
      memoryApiUrl: 'https://memory.twilio.com',
      conversationsApiUrl: 'https://conversations.twilio.com',
    },
  };

  return baseUrls[environment];
}
