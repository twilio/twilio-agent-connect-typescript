import { describe, it, expect, vi } from 'vitest';
import { SMSChannel, TAC, TACConfig } from '@twilio/tac-core';
import type { ConversationSession } from '@twilio/tac-core';
import { createTestTAC, createTestTACWithMemory } from './helpers/tac';

describe('TAC Core', () => {
  const getTestConfig = () => ({
    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd'
  });

  /** Stub the one participant lookup each inbound message makes. */
  const stubParticipants = (tac: TAC) =>
    vi.spyOn(tac.getConversationClient()!, 'listParticipants').mockResolvedValue([
      {
        id: 'PA111',
        conversationId: 'CHtest',
        accountId: 'ACtest123456789',
        type: 'AI_AGENT',
        addresses: [{ channel: 'SMS', address: '+15551234567' }],
      },
      {
        id: 'PA222',
        conversationId: 'CHtest',
        accountId: 'ACtest123456789',
        type: 'CUSTOMER',
        addresses: [{ channel: 'SMS', address: '+15559876543' }],
      },
    ]);

  describe('initialization', () => {
    it('should prevent direct construction with clear error message', () => {
      expect(() => {
        new (TAC as any)();
      }).toThrow('TAC constructor is private. Use TAC.create() instead of new TAC().');
    });

    it('should initialize TAC with config object', async () => {
      const tac = await createTestTAC(getTestConfig());

      expect(tac).toBeInstanceOf(TAC);
    });

    it('should initialize TAC without config (from environment)', async () => {
      // This will fail without env vars but should instantiate
      const keys = [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_PHONE_NUMBER',
        'MEMORY_STORE_ID',
        'TWILIO_CONVERSATION_CONFIGURATION_ID',
        'TWILIO_VOICE_PUBLIC_DOMAIN',
      ] as const;
      const snapshot: Record<(typeof keys)[number], string | undefined> = {
        TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
        MEMORY_STORE_ID: process.env.MEMORY_STORE_ID,
        TWILIO_CONVERSATION_CONFIGURATION_ID: process.env.TWILIO_CONVERSATION_CONFIGURATION_ID,
        TWILIO_VOICE_PUBLIC_DOMAIN: process.env.TWILIO_VOICE_PUBLIC_DOMAIN,
      };

      try {
        keys.forEach(key => {
          delete process.env[key];
        });

        await expect(TAC.create()).rejects.toThrow();
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

    it('should provide access to config', async () => {
      const tac = await createTestTAC(getTestConfig());

      const retrievedConfig = tac.getConfig();
      expect(retrievedConfig.accountSid).toBe('ACtest123456789');
    });

    it('should provide access to clients', async () => {
      const tac = await createTestTAC(getTestConfig());

      expect(tac.getMemoryClient()).toBeDefined();
      expect(tac.getConversationClient()).toBeDefined();
    });

    it('should initialize memory client when memoryStoreId is provided from conversation config', async () => {
      const tac = await createTestTACWithMemory(getTestConfig());

      expect(tac.getMemoryClient()).toBeDefined();
    });

    it('should start with no channels (until explicitly registered)', async () => {
      const tac = await createTestTAC(getTestConfig());

      // Verify no channels are registered by default
      const smsChannel = tac.getChannel('sms');
      const voiceChannel = tac.getChannel('voice');
      expect(smsChannel).toBeUndefined();
      expect(voiceChannel).toBeUndefined();
    });
  });

  describe('callback registration', () => {
    it('should register message ready callback', async () => {
      const tac = await createTestTAC(getTestConfig());

      const mockCallback = () => 'response';

      expect(() => {
        tac.onMessageReady(mockCallback);
      }).not.toThrow();
    });

    it('should register interrupt callback', async () => {
      const tac = await createTestTAC(getTestConfig());

      const mockCallback = () => {};

      expect(() => {
        tac.onInterrupt(mockCallback);
      }).not.toThrow();
    });

  });

  describe('lifecycle', () => {
    it('should shutdown cleanly', async () => {
      const tac = await createTestTAC(getTestConfig());

      expect(() => {
        tac.shutdown();
      }).not.toThrow();
    });
  });

  describe('callback return behavior', () => {
    it('should not auto-send empty string (log warning instead)', async () => {
      const tac = await createTestTAC(getTestConfig());
      const { SMSChannel } = await import('@twilio/tac-core');
      const channel = new SMSChannel(tac);
      tac.registerChannel(channel);

      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as any);
      stubParticipants(tac);
      const sendSpy = vi.spyOn(channel, 'sendResponse').mockResolvedValue();
      const warnSpy = vi.spyOn(tac.logger, 'warn');

      tac.onMessageReady(() => '');

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest',
          content: { type: 'TEXT', text: 'test' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(
          { conversation_id: 'CHtest' },
          'Callback returned empty string, skipping auto-send'
        );
      });

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('should not auto-send when callback returns null', async () => {
      const tac = await createTestTAC(getTestConfig());
      const { SMSChannel } = await import('@twilio/tac-core');
      const channel = new SMSChannel(tac);
      tac.registerChannel(channel);

      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as any);
      stubParticipants(tac);
      const sendSpy = vi.spyOn(channel, 'sendResponse').mockResolvedValue();
      const callback = vi.fn(() => null);

      tac.onMessageReady(callback);

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest',
          content: { type: 'TEXT', text: 'test' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      await vi.waitFor(() => expect(callback).toHaveBeenCalled());

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('should not auto-send when callback returns number', async () => {
      const tac = await createTestTAC(getTestConfig());
      const { SMSChannel } = await import('@twilio/tac-core');
      const channel = new SMSChannel(tac);
      tac.registerChannel(channel);

      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as any);
      stubParticipants(tac);
      const sendSpy = vi.spyOn(channel, 'sendResponse').mockResolvedValue();
      const callback = vi.fn(() => 123 as any);

      tac.onMessageReady(callback);

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest',
          content: { type: 'TEXT', text: 'test' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      await vi.waitFor(() => expect(callback).toHaveBeenCalled());

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('should not auto-send when callback returns object', async () => {
      const tac = await createTestTAC(getTestConfig());
      const { SMSChannel } = await import('@twilio/tac-core');
      const channel = new SMSChannel(tac);
      tac.registerChannel(channel);

      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as any);
      stubParticipants(tac);
      const sendSpy = vi.spyOn(channel, 'sendResponse').mockResolvedValue();
      const callback = vi.fn(() => ({ message: 'test' }) as any);

      tac.onMessageReady(callback);

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest',
          content: { type: 'TEXT', text: 'test' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      await vi.waitFor(() => expect(callback).toHaveBeenCalled());

      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('messaging session hand-off', () => {
    it("passes the channel's per-turn session to onMessageReady and back to sendResponse", async () => {
      const tac = await createTestTAC(getTestConfig());
      const channel = new SMSChannel(tac);
      tac.registerChannel(channel);
      stubParticipants(tac);
      const sendSpy = vi.spyOn(channel, 'sendResponse').mockResolvedValue();
      const callback = vi.fn((_: { session: ConversationSession }) => 'reply');
      tac.onMessageReady(callback);

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          conversationId: 'CHtest',
          content: { type: 'TEXT', text: 'test' },
          author: { address: '+15559876543', channel: 'SMS' },
        },
      });

      await vi.waitFor(() => expect(sendSpy).toHaveBeenCalled());
      const { session } = callback.mock.calls[0]![0];
      expect(session.conversationId).toBe('CHtest');
      expect(session.authorInfo?.participantId).toBe('PA222');
      expect(session.aiAgentInfo?.participantId).toBe('PA111');
      // The same session object goes back, so the send needs no lookup.
      expect(sendSpy).toHaveBeenCalledWith(session, 'reply');
    });
  });

  describe('listParticipantsShared', () => {
    const participants = [
      {
        id: 'PA222',
        conversationId: 'CHshared',
        accountId: 'ACtest123456789',
        type: 'CUSTOMER' as const,
        addresses: [{ channel: 'SMS' as const, address: '+15559876543' }],
      },
    ];

    it('shares one in-flight lookup between concurrent callers', async () => {
      const tac = await createTestTAC(getTestConfig());
      const lookup = vi
        .spyOn(tac.getConversationClient()!, 'listParticipants')
        .mockResolvedValue(participants);

      const [a, b] = await Promise.all([
        tac.listParticipantsShared('CHshared'),
        tac.listParticipantsShared('CHshared'),
      ]);

      expect(a).toBe(participants);
      expect(b).toBe(participants);
      expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('keeps the result for a minute, then looks up again', async () => {
      vi.useFakeTimers();
      try {
        const tac = await createTestTAC(getTestConfig());
        const lookup = vi
          .spyOn(tac.getConversationClient()!, 'listParticipants')
          .mockResolvedValue(participants);

        await tac.listParticipantsShared('CHshared');
        vi.advanceTimersByTime(59_000);
        await tac.listParticipantsShared('CHshared');
        expect(lookup).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(2_000);
        await tac.listParticipantsShared('CHshared');
        expect(lookup).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not cache a failed lookup', async () => {
      const tac = await createTestTAC(getTestConfig());
      const lookup = vi
        .spyOn(tac.getConversationClient()!, 'listParticipants')
        .mockRejectedValueOnce(new Error('CO down'))
        .mockResolvedValueOnce(participants);

      await expect(tac.listParticipantsShared('CHshared')).rejects.toThrow('CO down');
      await expect(tac.listParticipantsShared('CHshared')).resolves.toBe(participants);
      expect(lookup).toHaveBeenCalledTimes(2);
    });

    it('rejects without Conversation Orchestrator', async () => {
      const { conversationConfigurationId: _omitted, ...relayOnly } = getTestConfig();
      const tac = await createTestTAC(relayOnly);

      await expect(tac.listParticipantsShared('CHshared')).rejects.toThrow(
        'Conversation Orchestrator is not configured'
      );
    });
  });
});
