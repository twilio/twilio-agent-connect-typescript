import { TACConfigData, TACConfigSchema, EnvironmentVariables } from '../types/index';
import { z } from 'zod';

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
  public readonly memoryConfig: TACConfigData['memoryConfig'];
  public readonly conversationConfigurationId: string;
  public readonly voicePublicDomain?: string;
  /** Path the voice WebSocket is served at (combined with voicePublicDomain). */
  public readonly voiceWebsocketPath: string;
  /** Path the ConversationRelay `<Connect action>` callback is served at. */
  public readonly voiceActionPath: string;
  public readonly cintelConfigurationId?: string;
  public readonly cintelObservationOperatorSid?: string;
  public readonly cintelSummaryOperatorSid?: string;
  /** Optional Twilio region subdomain for API routing (e.g. transforms base URLs to `https://{product}.{region}.twilio.com`) */
  public readonly region?: string;
  /**
   * Twilio Studio Flow SID for handoff. TAC derives both the digital-handoff
   * Studio Executions URL (`studio.twilio.com/v2/Flows/{SID}/Executions`) and
   * the voice `<Connect action>` webhook URL
   * (`webhooks.twilio.com/v1/Accounts/{AccountSid}/Flows/{SID}?Trigger=incomingCall`)
   * from this SID.
   */
  public readonly studioHandoffFlowSid?: string;
  constructor(data: TACConfigData | z.input<typeof TACConfigSchema>) {
    // Validate the configuration data
    const validatedConfig = TACConfigSchema.parse(data);

    // Assign all properties
    this.accountSid = validatedConfig.accountSid;
    this.authToken = validatedConfig.authToken;
    this.apiKey = validatedConfig.apiKey;
    this.apiSecret = validatedConfig.apiSecret;
    this.phoneNumber = validatedConfig.phoneNumber;
    // Assign the validated memory config directly; schema parsing already validates shape and applies defaults
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

    // Parse memory configuration from environment variables
    const traitGroupsStr = process.env[EnvironmentVariables.TWILIO_MEMORY_PROFILE_TRAIT_GROUPS];
    // Parse trait groups, filtering out empty strings from malformed CSV (e.g., "A,,B,")
    // Treat empty/whitespace-only strings and delimiter-only inputs as undefined for consistency
    const trimmedTraitGroups = traitGroupsStr?.trim();
    const parsedTraitGroups =
      trimmedTraitGroups && trimmedTraitGroups.length > 0
        ? trimmedTraitGroups
            .split(',')
            .map(g => g.trim())
            .filter(g => g.length > 0)
        : undefined;
    const traitGroups =
      parsedTraitGroups && parsedTraitGroups.length > 0 ? parsedTraitGroups : undefined;

    // Helper to parse integer from env var with validation and bounds checking.
    // Returns undefined when the env var is not set, letting the Zod schema apply defaults.
    const parseIntEnv = (
      envVarName: string,
      value: string | undefined,
      min: number,
      max: number
    ): number | undefined => {
      if (!value) return undefined;
      const trimmed = value.trim();
      if (trimmed.length === 0) return undefined;

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

    // Helper to parse float from env var with validation and bounds checking.
    // Returns undefined when the env var is not set, letting the Zod schema apply defaults.
    const parseFloatEnv = (
      envVarName: string,
      value: string | undefined,
      min: number,
      max: number
    ): number | undefined => {
      if (!value) return undefined;
      const trimmed = value.trim();
      if (trimmed.length === 0) return undefined;

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
      accountSid: process.env[EnvironmentVariables.TWILIO_ACCOUNT_SID]!,
      authToken: process.env[EnvironmentVariables.TWILIO_AUTH_TOKEN]!,
      apiKey: process.env[EnvironmentVariables.TWILIO_API_KEY]!,
      apiSecret: process.env[EnvironmentVariables.TWILIO_API_SECRET]!,
      phoneNumber: process.env[EnvironmentVariables.TWILIO_PHONE_NUMBER]!,
      memoryConfig: {
        traitGroups,
        observationsLimit: parseIntEnv(
          'TWILIO_MEMORY_OBSERVATIONS_LIMIT',
          process.env[EnvironmentVariables.TWILIO_MEMORY_OBSERVATIONS_LIMIT],
          0,
          100
        ),
        summariesLimit: parseIntEnv(
          'TWILIO_MEMORY_SUMMARIES_LIMIT',
          process.env[EnvironmentVariables.TWILIO_MEMORY_SUMMARIES_LIMIT],
          0,
          100
        ),
        communicationsLimit: parseIntEnv(
          'TWILIO_MEMORY_COMMUNICATIONS_LIMIT',
          process.env[EnvironmentVariables.TWILIO_MEMORY_COMMUNICATIONS_LIMIT],
          0,
          100
        ),
        relevanceThreshold: parseFloatEnv(
          'TWILIO_MEMORY_RELEVANCE_THRESHOLD',
          process.env[EnvironmentVariables.TWILIO_MEMORY_RELEVANCE_THRESHOLD],
          0.0,
          1.0
        ),
      },
      conversationConfigurationId:
        process.env[EnvironmentVariables.TWILIO_CONVERSATION_CONFIGURATION_ID]!,
      voicePublicDomain: process.env[EnvironmentVariables.TWILIO_VOICE_PUBLIC_DOMAIN],
      voiceWebsocketPath: process.env[EnvironmentVariables.TWILIO_VOICE_WEBSOCKET_PATH],
      voiceActionPath: process.env[EnvironmentVariables.TWILIO_VOICE_ACTION_PATH],
      cintelConfigurationId: process.env[EnvironmentVariables.TWILIO_TAC_CI_CONFIGURATION_ID],
      cintelObservationOperatorSid:
        process.env[EnvironmentVariables.TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID],
      cintelSummaryOperatorSid:
        process.env[EnvironmentVariables.TWILIO_TAC_CI_SUMMARY_OPERATOR_SID],
      region: process.env[EnvironmentVariables.TWILIO_REGION],
      studioHandoffFlowSid: process.env[EnvironmentVariables.TWILIO_STUDIO_HANDOFF_FLOW_SID],
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
