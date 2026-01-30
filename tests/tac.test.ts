import { describe, it, expect } from 'vitest';
import { TAC, TACConfig } from '@twilio/tac-core';

describe('TAC Core', () => {
  const getTestConfig = () => ({
    environment: 'dev' as const,
    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd'
  });

  describe('initialization', () => {
    it('should initialize TAC with config object', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      expect(tac).toBeInstanceOf(TAC);
    });

    it('should initialize TAC without config (from environment)', () => {
      // This will fail without env vars but should instantiate
      const keys = [
        'ENVIRONMENT',
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_PHONE_NUMBER',
        'MEMORY_STORE_ID',
        'CONVERSATION_SERVICE_ID',
        'VOICE_PUBLIC_DOMAIN',
      ] as const;
      const snapshot: Record<(typeof keys)[number], string | undefined> = {
        ENVIRONMENT: process.env.ENVIRONMENT,
        TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
        MEMORY_STORE_ID: process.env.MEMORY_STORE_ID,
        CONVERSATION_SERVICE_ID: process.env.CONVERSATION_SERVICE_ID,
        VOICE_PUBLIC_DOMAIN: process.env.VOICE_PUBLIC_DOMAIN,
      };

      try {
        keys.forEach(key => {
          delete process.env[key];
        });

        expect(() => new TAC()).toThrow();
      } finally {
        keys.forEach(key => {
          const value = snapshot[key];
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        });
      }
    });

    it('should provide access to config', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      const retrievedConfig = tac.getConfig();
      expect(retrievedConfig.environment).toBe('dev');
      expect(retrievedConfig.twilioAccountSid).toBe('ACtest123456789');
    });

    it('should provide access to clients', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      // Memory client should be undefined when credentials not provided
      expect(tac.getMemoryClient()).toBeUndefined();
      expect(tac.getConversationClient()).toBeDefined();
    });

    it('should initialize memory client when credentials are provided', () => {
      const configWithMemory = {
        ...getTestConfig(),
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        memoryApiKey: 'test_api_key',
        memoryApiToken: 'test_api_token',
      };
      const config = new TACConfig(configWithMemory);
      const tac = new TAC({ config });

      expect(tac.getMemoryClient()).toBeDefined();
    });

    it('should start with no channels (until explicitly registered)', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      // Verify no channels are registered by default
      const smsChannel = tac.getChannel('sms');
      const voiceChannel = tac.getChannel('voice');
      expect(smsChannel).toBeUndefined();
      expect(voiceChannel).toBeUndefined();
    });
  });

  describe('callback registration', () => {
    it('should register message ready callback', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      const mockCallback = () => 'response';

      expect(() => {
        tac.onMessageReady(mockCallback);
      }).not.toThrow();
    });

    it('should register interrupt callback', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      const mockCallback = () => {};

      expect(() => {
        tac.onInterrupt(mockCallback);
      }).not.toThrow();
    });

    it('should register handoff callback', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      const mockCallback = () => {};

      expect(() => {
        tac.onHandoff(mockCallback);
      }).not.toThrow();
    });
  });

  describe('lifecycle', () => {
    it('should shutdown cleanly', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      expect(() => {
        tac.shutdown();
      }).not.toThrow();
    });
  });
});
