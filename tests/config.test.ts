import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TACConfig } from '@twilio/tac-core';

describe('TACConfig', () => {
  const getTestConfigData = () => ({
    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'SKtest123456789',
    apiSecret: 'test_api_token_123',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  // Store original env vars
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_API_KEY: process.env.TWILIO_API_KEY,
      TWILIO_API_SECRET: process.env.TWILIO_API_SECRET,
      TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
      TWILIO_CONVERSATION_CONFIGURATION_ID: process.env.TWILIO_CONVERSATION_CONFIGURATION_ID,
      VOICE_PUBLIC_DOMAIN: process.env.VOICE_PUBLIC_DOMAIN,
      TWILIO_REGION: process.env.TWILIO_REGION,
      TWILIO_STUDIO_HANDOFF_FLOW_SID: process.env.TWILIO_STUDIO_HANDOFF_FLOW_SID,
      TWILIO_MEMORY_PROFILE_TRAIT_GROUPS: process.env.TWILIO_MEMORY_PROFILE_TRAIT_GROUPS,
      TWILIO_MEMORY_OBSERVATIONS_LIMIT: process.env.TWILIO_MEMORY_OBSERVATIONS_LIMIT,
      TWILIO_MEMORY_SUMMARIES_LIMIT: process.env.TWILIO_MEMORY_SUMMARIES_LIMIT,
      TWILIO_MEMORY_COMMUNICATIONS_LIMIT: process.env.TWILIO_MEMORY_COMMUNICATIONS_LIMIT,
      TWILIO_MEMORY_RELEVANCE_THRESHOLD: process.env.TWILIO_MEMORY_RELEVANCE_THRESHOLD,
    };
  });

  afterEach(() => {
    // Restore original env vars
    Object.keys(originalEnv).forEach(key => {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
  });

  describe('constructor', () => {
    it('should create config with valid data', () => {
      const configData = getTestConfigData();
      const config = new TACConfig(configData);

      expect(config.accountSid).toBe('ACtest123456789');
      expect(config.authToken).toBe('test_token_123');
      expect(config.phoneNumber).toBe('+15551234567');
      expect(config.conversationConfigurationId).toBe('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd');
    });

    it('should validate required fields', () => {
      expect(() => {
        new TACConfig({} as any);
      }).toThrow();
    });

    it('should validate Twilio SID formats', () => {
      const invalidConfig = {
        ...getTestConfigData(),
        accountSid: 'invalid_sid',
        conversationConfigurationId: 'invalid_conv_sid',
      };

      expect(() => {
        new TACConfig(invalidConfig);
      }).toThrow();
    });

    it('should reject legacy comms_service format', () => {
      const legacyConfig = {
        ...getTestConfigData(),
        conversationConfigurationId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
      };

      expect(() => {
        new TACConfig(legacyConfig);
      }).toThrow('Invalid Conversation Configuration ID format');
    });

    it('should store region when provided', () => {
      const config = new TACConfig({
        ...getTestConfigData(),
        region: 'test-region',
      });

      expect(config.region).toBe('test-region');
    });

    it('should leave region undefined when not provided', () => {
      const config = new TACConfig(getTestConfigData());

      expect(config.region).toBeUndefined();
    });

    it('should accept single-character region', () => {
      const config = new TACConfig({ ...getTestConfigData(), region: 'a' });

      expect(config.region).toBe('a');
    });

    it('should reject invalid region values', () => {
      const invalidRegions = [
        'has spaces',
        'has/slash',
        'has:colon',
        'UPPERCASE',
        '-leading-dash',
        'trailing-dash-',
        'a'.repeat(64),
      ];

      for (const region of invalidRegions) {
        expect(() => {
          new TACConfig({ ...getTestConfigData(), region: region });
        }).toThrow('Invalid Twilio region format');
      }
    });

  });

  describe('fromEnv', () => {
    const setRequiredEnvVars = () => {
      process.env.TWILIO_ACCOUNT_SID = 'ACtest123';
      process.env.TWILIO_AUTH_TOKEN = 'test_auth_token';
      process.env.TWILIO_API_KEY = 'SKtest123';
      process.env.TWILIO_API_SECRET = 'test_api_token';
      process.env.TWILIO_PHONE_NUMBER = '+1234567890';
      process.env.TWILIO_CONVERSATION_CONFIGURATION_ID = 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd';
    };

    it('should create config when all required env vars are set', () => {
      setRequiredEnvVars();

      const config = TACConfig.fromEnv();

      expect(config.accountSid).toBe('ACtest123');
      expect(config.authToken).toBe('test_auth_token');
      expect(config.phoneNumber).toBe('+1234567890');
      expect(config.conversationConfigurationId).toBe('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd');
    });

    it('should throw error when TWILIO_ACCOUNT_SID is missing', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_ACCOUNT_SID;

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Missing required environment variable: TWILIO_ACCOUNT_SID');
    });

    it('should throw error when TWILIO_AUTH_TOKEN is missing', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_AUTH_TOKEN;

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Missing required environment variable: TWILIO_AUTH_TOKEN');
    });

    it('should throw error when TWILIO_API_KEY is missing', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_API_KEY;

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Missing required environment variable: TWILIO_API_KEY');
    });

    it('should throw error when TWILIO_API_SECRET is missing', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_API_SECRET;

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Missing required environment variable: TWILIO_API_SECRET');
    });

    it('should throw error when TWILIO_PHONE_NUMBER is missing', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_PHONE_NUMBER;

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Missing required environment variable: TWILIO_PHONE_NUMBER');
    });

    it('should succeed without TWILIO_CONVERSATION_CONFIGURATION_ID (relay-only mode)', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_CONVERSATION_CONFIGURATION_ID;

      const config = TACConfig.fromEnv();
      expect(config.conversationConfigurationId).toBeUndefined();
      expect(config.isOrchestratorEnabled()).toBe(false);
    });

    it('should throw error when no environment variables are set', () => {
      Object.keys(originalEnv).forEach(key => {
        delete process.env[key];
      });

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Missing required environment variable');
    });

    it('should read TWILIO_REGION from environment', () => {
      setRequiredEnvVars();
      process.env.TWILIO_REGION = 'test-region';

      const config = TACConfig.fromEnv();

      expect(config.region).toBe('test-region');
    });

    it('should leave twilioRegion undefined when TWILIO_REGION is not set', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_REGION;

      const config = TACConfig.fromEnv();

      expect(config.region).toBeUndefined();
    });

    it('should read TWILIO_STUDIO_HANDOFF_FLOW_SID from environment', () => {
      setRequiredEnvVars();
      process.env.TWILIO_STUDIO_HANDOFF_FLOW_SID = 'FW' + 'a'.repeat(32);

      const config = TACConfig.fromEnv();

      expect(config.studioHandoffFlowSid).toBe('FW' + 'a'.repeat(32));
    });

    it('should leave studioHandoffFlowSid undefined when TWILIO_STUDIO_HANDOFF_FLOW_SID is not set', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_STUDIO_HANDOFF_FLOW_SID;

      const config = TACConfig.fromEnv();

      expect(config.studioHandoffFlowSid).toBeUndefined();
    });

    it('should use default memory configuration values when env vars not set', () => {
      setRequiredEnvVars();

      const config = TACConfig.fromEnv();

      expect(config.memoryConfig.observationsLimit).toBe(20);
      expect(config.memoryConfig.summariesLimit).toBe(5);
      expect(config.memoryConfig.communicationsLimit).toBe(10);
      expect(config.memoryConfig.relevanceThreshold).toBe(0.0);
      expect(config.memoryConfig.traitGroups).toBeUndefined();
    });

    it('should parse custom memory configuration from env vars', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_PROFILE_TRAIT_GROUPS = 'Contact,Preferences';
      process.env.TWILIO_MEMORY_OBSERVATIONS_LIMIT = '10';
      process.env.TWILIO_MEMORY_SUMMARIES_LIMIT = '3';
      process.env.TWILIO_MEMORY_COMMUNICATIONS_LIMIT = '5';
      process.env.TWILIO_MEMORY_RELEVANCE_THRESHOLD = '0.7';

      const config = TACConfig.fromEnv();

      expect(config.memoryConfig.traitGroups).toEqual(['Contact', 'Preferences']);
      expect(config.memoryConfig.observationsLimit).toBe(10);
      expect(config.memoryConfig.summariesLimit).toBe(3);
      expect(config.memoryConfig.communicationsLimit).toBe(5);
      expect(config.memoryConfig.relevanceThreshold).toBe(0.7);
    });

    it('should handle whitespace in trait groups', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_PROFILE_TRAIT_GROUPS = ' Contact , Preferences , Custom ';

      const config = TACConfig.fromEnv();

      expect(config.memoryConfig.traitGroups).toEqual(['Contact', 'Preferences', 'Custom']);
    });

    it('should filter empty strings from trait groups', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_PROFILE_TRAIT_GROUPS = 'Contact,,Preferences,';

      const config = TACConfig.fromEnv();

      expect(config.memoryConfig.traitGroups).toEqual(['Contact', 'Preferences']);
    });

    it('should handle empty trait groups string', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_PROFILE_TRAIT_GROUPS = '';

      const config = TACConfig.fromEnv();

      expect(config.memoryConfig.traitGroups).toBeUndefined();
    });

    it('should handle whitespace-only trait groups string', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_PROFILE_TRAIT_GROUPS = '   ';

      const config = TACConfig.fromEnv();

      expect(config.memoryConfig.traitGroups).toBeUndefined();
    });

    it('should handle delimiter-only trait groups string', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_PROFILE_TRAIT_GROUPS = ',,,';

      const config = TACConfig.fromEnv();

      expect(config.memoryConfig.traitGroups).toBeUndefined();
    });

    it('should handle whitespace-only memory limit env vars', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_OBSERVATIONS_LIMIT = '   ';
      process.env.TWILIO_MEMORY_SUMMARIES_LIMIT = '  ';

      const config = TACConfig.fromEnv();

      expect(config.memoryConfig.observationsLimit).toBe(20);
      expect(config.memoryConfig.summariesLimit).toBe(5);
    });

    it('should accept zero values for memory limits', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_OBSERVATIONS_LIMIT = '0';
      process.env.TWILIO_MEMORY_SUMMARIES_LIMIT = '0';
      process.env.TWILIO_MEMORY_COMMUNICATIONS_LIMIT = '0';

      const config = TACConfig.fromEnv();

      expect(config.memoryConfig.observationsLimit).toBe(0);
      expect(config.memoryConfig.summariesLimit).toBe(0);
      expect(config.memoryConfig.communicationsLimit).toBe(0);
    });

    it('should throw error for invalid observations limit', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_OBSERVATIONS_LIMIT = 'abc';

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Invalid TWILIO_MEMORY_OBSERVATIONS_LIMIT: expected an integer, got "abc"');
    });

    it('should throw error for out of range observations limit', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_OBSERVATIONS_LIMIT = '150';

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Invalid TWILIO_MEMORY_OBSERVATIONS_LIMIT: must be between 0 and 100, got 150');
    });

    it('should throw error for invalid relevance threshold', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_RELEVANCE_THRESHOLD = 'not_a_number';

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Invalid TWILIO_MEMORY_RELEVANCE_THRESHOLD: expected a number, got "not_a_number"');
    });

    it('should throw error for out of range relevance threshold', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_RELEVANCE_THRESHOLD = '1.5';

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Invalid TWILIO_MEMORY_RELEVANCE_THRESHOLD: must be between 0 and 1, got 1.5');
    });

    it('should reject partially valid integer values', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_OBSERVATIONS_LIMIT = '10abc';

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Invalid TWILIO_MEMORY_OBSERVATIONS_LIMIT: expected an integer, got "10abc"');
    });

    it('should reject float values for integer fields', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_OBSERVATIONS_LIMIT = '10.5';

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Invalid TWILIO_MEMORY_OBSERVATIONS_LIMIT: expected an integer, got "10.5"');
    });

    it('should reject partially valid float values', () => {
      setRequiredEnvVars();
      process.env.TWILIO_MEMORY_RELEVANCE_THRESHOLD = '0.5abc';

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Invalid TWILIO_MEMORY_RELEVANCE_THRESHOLD: expected a number, got "0.5abc"');
    });
  });

  describe('getBasicAuthCredentials', () => {
    it('should return basic auth credentials', () => {
      const configData = getTestConfigData();
      const config = new TACConfig(configData);

      const credentials = config.getBasicAuthCredentials();

      expect(credentials.username).toBe('ACtest123456789');
      expect(credentials.password).toBe('test_token_123');
    });
  });
});
