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
 *   accountSid: 'ACxxxx',
 *   // ...
 * });
 * ```
 */
export class TACConfig {
  public readonly accountSid: string;
  public readonly authToken: string;
  public readonly apiKey: string;
  public readonly apiSecret: string;
  public readonly phoneNumber: string;
  public readonly traitGroups?: string[];
  public readonly conversationConfigurationId: string;
  public readonly voicePublicDomain?: string;
  public readonly cintelConfigurationId?: string;
  public readonly cintelObservationOperatorSid?: string;
  public readonly cintelSummaryOperatorSid?: string;
  /** Optional Twilio region subdomain for API routing (e.g. transforms base URLs to `https://{product}.{region}.twilio.com`) */
  public readonly region?: string;
  constructor(data: TACConfigData) {
    // Validate the configuration data
    const validatedConfig = TACConfigSchema.parse(data);

    // Assign all properties
    this.accountSid = validatedConfig.accountSid;
    this.authToken = validatedConfig.authToken;
    this.apiKey = validatedConfig.apiKey;
    this.apiSecret = validatedConfig.apiSecret;
    this.phoneNumber = validatedConfig.phoneNumber;
    if (validatedConfig.traitGroups) {
      this.traitGroups = validatedConfig.traitGroups;
    }
    this.conversationConfigurationId = validatedConfig.conversationConfigurationId;
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
    if (validatedConfig.region) {
      this.region = validatedConfig.region;
    }
  }

  /**
   * Create TACConfig from environment variables.
   *
   * Loads configuration from the following environment variables:
   * - TWILIO_ACCOUNT_SID: Twilio Account SID (required)
   * - TWILIO_AUTH_TOKEN: Twilio Auth Token (required)
   * - TWILIO_API_KEY: Twilio API Key (required)
   * - TWILIO_API_SECRET: Twilio API Secret (required)
   * - TWILIO_PHONE_NUMBER: Twilio Phone Number (required)
   * - TRAIT_GROUPS: Comma-separated trait group names (optional, for profile fetching)
   * - TWILIO_CONVERSATION_CONFIGURATION_ID: Twilio Conversation Configuration ID (required)
   * - VOICE_PUBLIC_DOMAIN: Public domain for voice webhooks (optional)
   * - TWILIO_REGION: Twilio region subdomain for API routing (optional, e.g. transforms base URLs to `https://{product}.{region}.twilio.com`)
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
      { key: EnvironmentVariables.TWILIO_API_SECRET, name: 'TWILIO_API_SECRET' },
      { key: EnvironmentVariables.TWILIO_PHONE_NUMBER, name: 'TWILIO_PHONE_NUMBER' },
      {
        key: EnvironmentVariables.TWILIO_CONVERSATION_CONFIGURATION_ID,
        name: 'TWILIO_CONVERSATION_CONFIGURATION_ID',
      },
    ];

    // Throw error for missing required variables (like Python's KeyError)
    for (const { key, name } of requiredVars) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${name}`);
      }
    }

    const rawConfig: TACConfigData = {
      accountSid: process.env[EnvironmentVariables.TWILIO_ACCOUNT_SID]!,
      authToken: process.env[EnvironmentVariables.TWILIO_AUTH_TOKEN]!,
      apiKey: process.env[EnvironmentVariables.TWILIO_API_KEY]!,
      apiSecret: process.env[EnvironmentVariables.TWILIO_API_SECRET]!,
      phoneNumber: process.env[EnvironmentVariables.TWILIO_PHONE_NUMBER]!,
      traitGroups: process.env[EnvironmentVariables.TRAIT_GROUPS]?.split(','),
      conversationConfigurationId:
        process.env[EnvironmentVariables.TWILIO_CONVERSATION_CONFIGURATION_ID]!,
      voicePublicDomain: process.env[EnvironmentVariables.VOICE_PUBLIC_DOMAIN],
      cintelConfigurationId: process.env[EnvironmentVariables.TWILIO_TAC_CI_CONFIGURATION_ID],
      cintelObservationOperatorSid:
        process.env[EnvironmentVariables.TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID],
      cintelSummaryOperatorSid:
        process.env[EnvironmentVariables.TWILIO_TAC_CI_SUMMARY_OPERATOR_SID],
      region: process.env[EnvironmentVariables.TWILIO_REGION],
    };

    return new TACConfig(rawConfig);
  }

  /**
   * Get basic auth credentials for Twilio APIs
   */
  public getBasicAuthCredentials(): { username: string; password: string } {
    return {
      username: this.accountSid,
      password: this.authToken,
    };
  }
}
