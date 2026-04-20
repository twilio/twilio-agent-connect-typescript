import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TACConfig } from '@twilio/tac-core';

describe('TACConfig', () => {
  const getTestConfigData = () => ({
    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    twilioApiKey: 'SKtest123456789',
    twilioApiToken: 'test_api_token_123',
    twilioPhoneNumber: '+15551234567',
    memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
    conversationServiceId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  // Store original env vars
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_API_KEY: process.env.TWILIO_API_KEY,
      TWILIO_API_TOKEN: process.env.TWILIO_API_TOKEN,
      TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
      MEMORY_STORE_ID: process.env.MEMORY_STORE_ID,
      CONVERSATION_SERVICE_ID: process.env.CONVERSATION_SERVICE_ID,
      VOICE_PUBLIC_DOMAIN: process.env.VOICE_PUBLIC_DOMAIN,
      TWILIO_REGION: process.env.TWILIO_REGION,
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

      expect(config.twilioAccountSid).toBe('ACtest123456789');
      expect(config.twilioAuthToken).toBe('test_token_123');
      expect(config.twilioPhoneNumber).toBe('+15551234567');
      expect(config.memoryStoreId).toBe('mem_service_01kbjqhhdpft0tbp21jt4ktbxg');
      expect(config.conversationServiceId).toBe('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd');
    });

    it('should validate required fields', () => {
      expect(() => {
        new TACConfig({} as any);
      }).toThrow();
    });

    it('should validate Twilio SID formats', () => {
      const invalidConfig = {
        ...getTestConfigData(),
        twilioAccountSid: 'invalid_sid',
        conversationServiceId: 'invalid_conv_sid',
      };

      expect(() => {
        new TACConfig(invalidConfig);
      }).toThrow();
    });

    it('should reject legacy comms_service format', () => {
      const legacyConfig = {
        ...getTestConfigData(),
        conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
      };

      expect(() => {
        new TACConfig(legacyConfig);
      }).toThrow('Invalid Conversation Configuration ID format');
    });

    it('should validate memory store ID format when provided', () => {
      const invalidConfig = {
        ...getTestConfigData(),
        memoryStoreId: 'invalid_memory_sid',
      };

      expect(() => {
        new TACConfig(invalidConfig);
      }).toThrow();
    });

    it('should work without memoryStoreId', () => {
      const configWithoutMemory = {
        ...getTestConfigData(),
        memoryStoreId: undefined,
      };

      const config = new TACConfig(configWithoutMemory);

      expect(config.memoryStoreId).toBeUndefined();
      expect(config.conversationServiceId).toBe('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd');
    });

    it('should store twilioRegion when provided', () => {
      const config = new TACConfig({
        ...getTestConfigData(),
        twilioRegion: 'test-region',
      });

      expect(config.twilioRegion).toBe('test-region');
    });

    it('should leave twilioRegion undefined when not provided', () => {
      const config = new TACConfig(getTestConfigData());

      expect(config.twilioRegion).toBeUndefined();
    });

    it('should accept single-character twilioRegion', () => {
      const config = new TACConfig({ ...getTestConfigData(), twilioRegion: 'a' });

      expect(config.twilioRegion).toBe('a');
    });

    it('should reject invalid twilioRegion values', () => {
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
          new TACConfig({ ...getTestConfigData(), twilioRegion: region });
        }).toThrow('Invalid Twilio region format');
      }
    });

  });

  describe('fromEnv', () => {
    const setRequiredEnvVars = () => {
      process.env.TWILIO_ACCOUNT_SID = 'ACtest123';
      process.env.TWILIO_AUTH_TOKEN = 'test_auth_token';
      process.env.TWILIO_API_KEY = 'SKtest123';
      process.env.TWILIO_API_TOKEN = 'test_api_token';
      process.env.TWILIO_PHONE_NUMBER = '+1234567890';
      process.env.MEMORY_STORE_ID = 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg';
      process.env.CONVERSATION_SERVICE_ID = 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd';
    };

    it('should create config when all required env vars are set', () => {
      setRequiredEnvVars();

      const config = TACConfig.fromEnv();

      expect(config.twilioAccountSid).toBe('ACtest123');
      expect(config.twilioAuthToken).toBe('test_auth_token');
      expect(config.twilioPhoneNumber).toBe('+1234567890');
      expect(config.memoryStoreId).toBe('mem_service_01kbjqhhdpft0tbp21jt4ktbxg');
      expect(config.conversationServiceId).toBe('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd');
    });

    it('should include optional voicePublicDomain when set', () => {
      setRequiredEnvVars();
      process.env.VOICE_PUBLIC_DOMAIN = 'https://example.com';

      const config = TACConfig.fromEnv();

      expect(config.voicePublicDomain).toBe('https://example.com');
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

    it('should throw error when TWILIO_API_TOKEN is missing', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_API_TOKEN;

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Missing required environment variable: TWILIO_API_TOKEN');
    });

    it('should throw error when TWILIO_PHONE_NUMBER is missing', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_PHONE_NUMBER;

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Missing required environment variable: TWILIO_PHONE_NUMBER');
    });

    it('should work when MEMORY_STORE_ID is not provided', () => {
      setRequiredEnvVars();
      delete process.env.MEMORY_STORE_ID;

      const config = TACConfig.fromEnv();

      expect(config.memoryStoreId).toBeUndefined();
      expect(config.conversationServiceId).toBe('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd');
    });

    it('should throw error when CONVERSATION_SERVICE_ID is missing', () => {
      setRequiredEnvVars();
      delete process.env.CONVERSATION_SERVICE_ID;

      expect(() => {
        TACConfig.fromEnv();
      }).toThrow('Missing required environment variable: CONVERSATION_SERVICE_ID');
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

      expect(config.twilioRegion).toBe('test-region');
    });

    it('should leave twilioRegion undefined when TWILIO_REGION is not set', () => {
      setRequiredEnvVars();
      delete process.env.TWILIO_REGION;

      const config = TACConfig.fromEnv();

      expect(config.twilioRegion).toBeUndefined();
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
