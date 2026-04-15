import { TACConfigData, TACConfigSchema, EnvironmentVariables } from '../types/index';

/**
 * TAC Configuration class with Python-like static factory methods
 *
 * Example usage:
 * ```typescript
 * // Load from environment variables
 * const config = TACConfig.fromEnv();
 *
 * // Or create manually
 * const config = new TACConfig({
 *   twilioAccountSid: 'ACxxxx',
 *   // ...
 * });
 * ```
 */
export class TACConfig {
  public readonly twilioAccountSid: string;
  public readonly twilioAuthToken: string;
  public readonly twilioApiKey: string;
  public readonly twilioApiToken: string;
  public readonly twilioPhoneNumber: string;
  public readonly memoryStoreId?: string;
  public readonly traitGroups?: string[];
  public readonly conversationServiceId: string;
  public readonly voicePublicDomain?: string;
  public readonly cintelConfigurationId?: string;
  public readonly cintelObservationOperatorSid?: string;
  public readonly cintelSummaryOperatorSid?: string;
  constructor(data: TACConfigData) {
    // Validate the configuration data
    const validatedConfig = TACConfigSchema.parse(data);

    // Assign all properties
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
  }

  /**
   * Create TACConfig from environment variables.
   *
   * Loads configuration from the following environment variables:
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
  public static fromEnv(): TACConfig {
    // Check for required environment variables
    const requiredVars = [
      { key: EnvironmentVariables.TWILIO_ACCOUNT_SID, name: 'TWILIO_ACCOUNT_SID' },
      { key: EnvironmentVariables.TWILIO_AUTH_TOKEN, name: 'TWILIO_AUTH_TOKEN' },
      { key: EnvironmentVariables.TWILIO_API_KEY, name: 'TWILIO_API_KEY' },
      { key: EnvironmentVariables.TWILIO_API_TOKEN, name: 'TWILIO_API_TOKEN' },
      { key: EnvironmentVariables.TWILIO_PHONE_NUMBER, name: 'TWILIO_PHONE_NUMBER' },
      { key: EnvironmentVariables.CONVERSATION_SERVICE_ID, name: 'CONVERSATION_SERVICE_ID' },
    ];

    // Throw error for missing required variables (like Python's KeyError)
    for (const { key, name } of requiredVars) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${name}`);
      }
    }

    const rawConfig: TACConfigData = {
      twilioAccountSid: process.env[EnvironmentVariables.TWILIO_ACCOUNT_SID]!,
      twilioAuthToken: process.env[EnvironmentVariables.TWILIO_AUTH_TOKEN]!,
      twilioApiKey: process.env[EnvironmentVariables.TWILIO_API_KEY]!,
      twilioApiToken: process.env[EnvironmentVariables.TWILIO_API_TOKEN]!,
      twilioPhoneNumber: process.env[EnvironmentVariables.TWILIO_PHONE_NUMBER]!,
      memoryStoreId: process.env[EnvironmentVariables.MEMORY_STORE_ID],
      traitGroups: process.env[EnvironmentVariables.TRAIT_GROUPS]?.split(','),
      conversationServiceId: process.env[EnvironmentVariables.CONVERSATION_SERVICE_ID]!,
      voicePublicDomain: process.env[EnvironmentVariables.VOICE_PUBLIC_DOMAIN],
      cintelConfigurationId: process.env[EnvironmentVariables.TWILIO_TAC_CI_CONFIGURATION_ID],
      cintelObservationOperatorSid:
        process.env[EnvironmentVariables.TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID],
      cintelSummaryOperatorSid:
        process.env[EnvironmentVariables.TWILIO_TAC_CI_SUMMARY_OPERATOR_SID],
    };

    return new TACConfig(rawConfig);
  }

  /**
   * Get basic auth credentials for Twilio APIs
   */
  public getBasicAuthCredentials(): { username: string; password: string } {
    return {
      username: this.twilioAccountSid,
      password: this.twilioAuthToken,
    };
  }
}
