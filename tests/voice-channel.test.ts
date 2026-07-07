import { describe, it, expect, vi } from 'vitest';
import { createTestTAC } from './helpers/tac';
import { VoiceChannel, TAC, TACConfig, ConversationSession } from '@twilio/tac-core';
import { InterruptMessageSchema } from '@twilio/tac-core';

describe('VoiceChannel', () => {
  const getTestConfig = () => ({
    accountSid: 'ACtest123',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  describe('connectConversationRelay()', () => {
    it('should generate TwiML without welcomeGreeting', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
      });

      expect(twiml).toContain('url="wss://example.com/conversation-relay"');
      expect(twiml).not.toContain('welcomeGreeting');
    });

    it('should generate TwiML with welcomeGreeting', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        welcomeGreeting: 'Hello! How can I help you today?',
      });

      expect(twiml).toContain('url="wss://example.com/conversation-relay"');
      expect(twiml).toContain('welcomeGreeting="Hello! How can I help you today?"');
    });

    it('should handle undefined welcomeGreeting', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        welcomeGreeting: undefined,
      });

      expect(twiml).toContain('url="wss://example.com/conversation-relay"');
      expect(twiml).not.toContain('welcomeGreeting');
    });
  });

  describe('getWebsocket()', () => {
    it('should return null for unknown conversation', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const ws = voiceChannel.getWebsocket('CA_unknown' as any);

      expect(ws).toBeNull();
    });
  });

  describe('isConversationActive()', () => {
    it('should return false for unknown conversation', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const isActive = voiceChannel.isConversationActive('CA_unknown' as any);

      expect(isActive).toBe(false);
    });
  });

  describe('stream task management', () => {
    it('should start and track a stream task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      const task = voiceChannel.startStreamTask(conversationId);

      expect(task.controller).toBeInstanceOf(AbortController);
      expect(task.hasSentTokens).toBe(false);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);
    });

    it('should cancel an active stream task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      const task = voiceChannel.startStreamTask(conversationId);
      const cancelled = voiceChannel.cancelStreamTask(conversationId);

      expect(cancelled).toBe(true);
      expect(task.controller.signal.aborted).toBe(true);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });

    it('should return false when cancelling non-existent task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const cancelled = voiceChannel.cancelStreamTask('CH_nonexistent' as any);

      expect(cancelled).toBe(false);
    });

    it('should complete a stream task (remove from tracking)', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      voiceChannel.startStreamTask(conversationId);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);

      voiceChannel.completeStreamTask(conversationId);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });

    it('should replace existing stream task when starting new one', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      const firstTask = voiceChannel.startStreamTask(conversationId);
      const secondTask = voiceChannel.startStreamTask(conversationId);

      expect(firstTask.controller.signal.aborted).toBe(true);
      expect(secondTask.controller.signal.aborted).toBe(false);
      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(true);
    });

    it('should report inactive for aborted task', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const conversationId = 'CH_test_123' as any;

      voiceChannel.startStreamTask(conversationId);
      voiceChannel.cancelStreamTask(conversationId);

      expect(voiceChannel.hasActiveStreamTask(conversationId)).toBe(false);
    });
  });

  describe('shutdown()', () => {
    it('should clear all stream tasks on shutdown', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      voiceChannel.startStreamTask('CH_1' as any);
      voiceChannel.startStreamTask('CH_2' as any);

      expect(voiceChannel.hasActiveStreamTask('CH_1' as any)).toBe(true);
      expect(voiceChannel.hasActiveStreamTask('CH_2' as any)).toBe(true);

      voiceChannel.shutdown();

      expect(voiceChannel.hasActiveStreamTask('CH_1' as any)).toBe(false);
      expect(voiceChannel.hasActiveStreamTask('CH_2' as any)).toBe(false);
    });

    it('should clear WebSocket references on shutdown', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Start with no WebSocket connections
      expect(voiceChannel.getWebsocket('CH_test' as any)).toBeNull();

      // After shutdown, should still return null (cleared state)
      voiceChannel.shutdown();
      expect(voiceChannel.getWebsocket('CH_test' as any)).toBeNull();
    });
  });

  describe('ConversationRelay attributes', () => {
    it('should apply transcription configuration', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        transcriptionProvider: 'Deepgram',
        transcriptionLanguage: 'en-AU',
        speechModel: 'nova-3-general',
      });

      expect(twiml).toContain('transcriptionProvider="Deepgram"');
      expect(twiml).toContain('transcriptionLanguage="en-AU"');
      expect(twiml).toContain('speechModel="nova-3-general"');
    });

    it('should apply TTS configuration', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        ttsProvider: 'Google',
        ttsLanguage: 'en-US',
        voice: 'en-US-Journey-O',
      });

      expect(twiml).toContain('ttsProvider="Google"');
      expect(twiml).toContain('voice="en-US-Journey-O"');
    });

    it('should apply interaction configuration', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        interruptible: 'any',
        interruptSensitivity: 'high',
        dtmfDetection: true,
        hints: 'account balance, billing, payment',
      });

      expect(twiml).toContain('interruptible="any"');
      expect(twiml).toContain('dtmfDetection="true"');
      expect(twiml).toContain('hints="account balance, billing, payment"');
    });

    it('should filter out undefined attributes', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        interruptible: 'any',
        hints: undefined, // should not appear
      });

      expect(twiml).toContain('interruptible="any"');
      expect(twiml).not.toContain('hints=');
    });

    it('should support multiple language configurations', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = voiceChannel.connectConversationRelay({
        url: 'wss://example.com/conversation-relay',
        language: 'en-AU', // Default language
        languages: [
          {
            code: 'en-AU',
            ttsProvider: 'ElevenLabs',
            voice: 'IKne3meq5aSn9XLyUdCD',
            transcriptionProvider: 'Deepgram',
            speechModel: 'nova-3-general',
          },
          {
            code: 'en-NZ',
            ttsProvider: 'ElevenLabs',
            voice: 'VEWZvLXUrFL3O7dUnBSW',
            transcriptionProvider: 'Deepgram',
            speechModel: 'nova-3-general',
          },
        ],
      });

      expect(twiml).toContain('language="en-AU"');
      expect(twiml).toContain('<Language code="en-AU"');
      expect(twiml).toContain('ttsProvider="ElevenLabs"');
      expect(twiml).toContain('<Language code="en-NZ"');
    });

    it('should throw error for invalid configuration', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      expect(() => {
        voiceChannel.connectConversationRelay({
          url: 'invalid-url', // Not a valid URL
        });
      }).toThrow('Invalid ConversationRelay configuration');
    });
  });

  describe('handleIncomingCall', () => {
    // handleIncomingCall now derives the WebSocket URL from
    // TACConfig.voicePublicDomain and layers in VoiceChannelConfig.defaultTwimlOptions.
    const getVoiceConfig = () => ({ ...getTestConfig(), voicePublicDomain: 'example.com' });

    it('should derive the WebSocket URL from voicePublicDomain', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain('url="wss://example.com/ws"');
      expect(twiml).toContain('conversationConfiguration=');
    });

    it('should throw when voicePublicDomain is not set', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      await expect(voiceChannel.handleIncomingCall()).rejects.toThrow('voicePublicDomain');
    });

    it('should apply defaultTwimlOptions to generated TwiML', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: {
          transcriptionProvider: 'Deepgram',
          interruptible: 'any',
          hints: 'technical support, billing',
        },
      });

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain('transcriptionProvider="Deepgram"');
      expect(twiml).toContain('interruptible="any"');
      expect(twiml).toContain('hints="technical support, billing"');
    });

    it('should apply multi-language defaultTwimlOptions', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: {
          language: 'en-US',
          languages: [
            { code: 'en-US', ttsProvider: 'Google', voice: 'en-US-Journey-O' },
            { code: 'es-ES', ttsProvider: 'Google', voice: 'es-ES-Standard-A' },
          ],
        },
      });

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain('language="en-US"');
      expect(twiml).toContain('<Language code="en-US"');
      expect(twiml).toContain('<Language code="es-ES"');
    });

    it('should include welcomeGreeting from defaultTwimlOptions', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { welcomeGreeting: 'Hello! How can I help you today?' },
      });

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain('welcomeGreeting="Hello! How can I help you today?"');
    });

    it('should apply the fixed default welcomeGreeting when no layer sets one', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain('welcomeGreeting="Hello! How can I assist you today?"');
    });
  });

  describe('handleIncomingCall TwiML merge layers', () => {
    const getVoiceConfig = () => ({ ...getTestConfig(), voicePublicDomain: 'example.com' });

    it('should let defaultTwimlOptions override conversationConfiguration', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: {
          conversationConfiguration: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5custm',
        },
      });

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain(
        'conversationConfiguration="conv_configuration_01kbjqhn79f0fvwfsxqzd5custm"'
      );
      expect(twiml).not.toContain('conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd');
    });

    it('should derive the action URL from voicePublicDomain by default', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain('action="https://example.com/conversation-relay-callback"');
    });

    it('should let a static action URL beat the derived default', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { actionUrl: 'https://static.example.com/end' },
      });

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain('action="https://static.example.com/end"');
      expect(twiml).not.toContain('conversation-relay-callback');
    });

    it('should use the Studio handoff URL when configured', async () => {
      const flowSid = 'FW' + 'a'.repeat(32);
      const tac = await createTestTAC({ ...getVoiceConfig(), studioHandoffFlowSid: flowSid });
      const voiceChannel = new VoiceChannel(tac);

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain(
        `action="https://webhooks.twilio.com/v1/Accounts/ACtest123/Flows/${flowSid}?Trigger=incomingCall"`
      );
      // The default cleanup URL must not also appear.
      expect(twiml).not.toContain('conversation-relay-callback');
    });

    it('should run a registered customizer and let its output beat static options', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { voice: 'en-US-Journey-D' },
      });
      voiceChannel.onInboundCallTwiml(async () => ({ voice: 'es-MX-Neural2-A' }));

      const twiml = await voiceChannel.handleIncomingCall({ extra: {} });

      expect(twiml).toContain('voice="es-MX-Neural2-A"');
      expect(twiml).not.toContain('en-US-Journey-D');
    });

    it('should skip the customizer when no TwiMLRequest is passed', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac);
      let called = false;
      voiceChannel.onInboundCallTwiml(async () => {
        called = true;
        return { voice: 'en-US-Journey-D' };
      });

      const twiml = await voiceChannel.handleIncomingCall();

      expect(called).toBe(false);
      expect(twiml).not.toContain('voice=');
    });

    it('should keep lower-layer fields the customizer did not set', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { welcomeGreeting: 'Channel default' },
      });
      voiceChannel.onInboundCallTwiml(async () => ({ voice: 'en-US-Journey-D' }));

      const twiml = await voiceChannel.handleIncomingCall({ extra: {} });

      expect(twiml).toContain('welcomeGreeting="Channel default"');
      expect(twiml).toContain('voice="en-US-Journey-D"');
    });

    it('should not let a customizer that omits actionUrl clobber a static actionUrl', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { actionUrl: 'https://static.example.com/end' },
      });
      voiceChannel.onInboundCallTwiml(async () => ({ voice: 'en-US-Journey-D' }));

      const twiml = await voiceChannel.handleIncomingCall({ extra: {} });

      expect(twiml).toContain('action="https://static.example.com/end"');
      expect(twiml).toContain('voice="en-US-Journey-D"');
    });

    it('should let an explicit actionUrl undefined on the customizer suppress the action', async () => {
      const flowSid = 'FW' + 'a'.repeat(32);
      const tac = await createTestTAC({ ...getVoiceConfig(), studioHandoffFlowSid: flowSid });
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { actionUrl: 'https://static.example.com/end' },
      });
      voiceChannel.onInboundCallTwiml(async () => ({ actionUrl: undefined }));

      const twiml = await voiceChannel.handleIncomingCall({ extra: {} });

      expect(twiml).not.toContain('action=');
    });

    it('should let a customizer actionUrl beat the Studio handoff URL', async () => {
      const flowSid = 'FW' + 'a'.repeat(32);
      const tac = await createTestTAC({ ...getVoiceConfig(), studioHandoffFlowSid: flowSid });
      const voiceChannel = new VoiceChannel(tac);
      voiceChannel.onInboundCallTwiml(async () => ({
        actionUrl: 'https://customizer.example.com/end',
      }));

      const twiml = await voiceChannel.handleIncomingCall({ extra: {} });

      expect(twiml).toContain('action="https://customizer.example.com/end"');
    });
  });

  describe('handleIncomingCall websocketUrl layering', () => {
    const getVoiceConfig = () => ({ ...getTestConfig(), voicePublicDomain: 'example.com' });

    // websocketUrl is a normal TwiMLOptions field, so it rides the same layered
    // merge as every other attribute. This is the affinity-routed-host case
    // (e.g. Azure Hosted Agents) appending a per-call token to the upgrade URL —
    // done through the existing customizer, no new API surface.
    it('should let a customizer override websocketUrl per call', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { welcomeGreeting: 'Welcome!' },
      });
      voiceChannel.onInboundCallTwiml(async req => ({
        websocketUrl: `wss://example.com/ws?agent_session_id=${req.callSid}`,
      }));

      const twiml = await voiceChannel.handleIncomingCall({ callSid: 'CA123' });

      // The customizer's URL is emitted verbatim...
      expect(twiml).toContain('url="wss://example.com/ws?agent_session_id=CA123"');
      // ...and the bare derived URL (without the query string) is NOT used.
      expect(twiml).not.toContain('url="wss://example.com/ws"');
      // The override only changes the URL; other layered fields still apply.
      expect(twiml).toContain('welcomeGreeting="Welcome!"');
      expect(twiml).toContain('conversationConfiguration=');
    });

    it('should let defaultTwimlOptions.websocketUrl override the derived URL', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const override = 'wss://static.example.com/socket';
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { websocketUrl: override },
      });

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain(`url="${override}"`);
      expect(twiml).not.toContain('url="wss://example.com/ws"');
      // websocketUrl feeds the `url` attribute; it must not leak as its own attr.
      expect(twiml).not.toContain('websocketUrl=');
    });

    it('should let a customizer websocketUrl win over defaultTwimlOptions', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { websocketUrl: 'wss://static.example.com/socket' },
      });
      voiceChannel.onInboundCallTwiml(async () => ({
        websocketUrl: 'wss://per-call.example.com/ws',
      }));

      const twiml = await voiceChannel.handleIncomingCall({ callSid: 'CA999' });

      expect(twiml).toContain('url="wss://per-call.example.com/ws"');
      expect(twiml).not.toContain('static.example.com');
    });

    it('should derive the URL when no layer sets websocketUrl', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac);

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain('url="wss://example.com/ws"');
    });

    it('should ignore a `url` key in extra and keep the resolved URL', async () => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { extra: { url: 'wss://attacker.example.com/ws' } },
      });

      const twiml = await voiceChannel.handleIncomingCall();

      expect(twiml).toContain('url="wss://example.com/ws"');
      expect(twiml).not.toContain('attacker.example.com');
    });
  });

  describe('handleIncomingCall hostTwimlOptions', () => {
    const getVoiceConfig = () => ({ ...getTestConfig(), voicePublicDomain: 'example.com' });

    it('should set a per-call websocketUrl via hostTwimlOptions', async () => {
      // A custom in-process host passes per-call transport facts via
      // hostTwimlOptions — e.g. an affinity URL — without registering a
      // customizer.
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac);

      const affinityUrl = 'wss://example.com/ws?agent_session_id=CA123';
      const twiml = await voiceChannel.handleIncomingCall(undefined, {
        hostTwimlOptions: {
          websocketUrl: affinityUrl,
          customParameters: { agent_session_id: 'CA123' },
        },
      });

      expect(twiml).toContain(`url="${affinityUrl}"`);
      expect(twiml).not.toContain('url="wss://example.com/ws"'); // not the derived URL
      // conversationConfiguration still populated from TACConfig (not clobbered).
      expect(twiml).toContain('conversationConfiguration=');
    });

    it('should let the app customizer beat hostTwimlOptions on contested fields', async () => {
      // Precedence: the application's onInboundCallTwiml customizer sits ABOVE
      // hostTwimlOptions — a developer's explicit choice wins for fields the dev
      // sets, while the host's uncontested websocketUrl still applies.
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac);
      voiceChannel.onInboundCallTwiml(async () => ({ welcomeGreeting: 'App wins' }));

      const twiml = await voiceChannel.handleIncomingCall(
        { extra: {} },
        {
          hostTwimlOptions: {
            websocketUrl: 'wss://example.com/ws?agent_session_id=CA1',
            welcomeGreeting: 'Host loses',
          },
        }
      );

      expect(twiml).toContain('welcomeGreeting="App wins"');
      expect(twiml).not.toContain('Host loses');
      // ...but the host's websocketUrl (dev didn't set it) still applies.
      expect(twiml).toContain('url="wss://example.com/ws?agent_session_id=CA1"');
    });

    it('should let defaultTwimlOptions beat hostTwimlOptions on contested fields', async () => {
      // Precedence: channel `defaultTwimlOptions` sits ABOVE hostTwimlOptions,
      // so a contested field set on both resolves to the channel default.
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { welcomeGreeting: 'Channel default' },
      });

      const twiml = await voiceChannel.handleIncomingCall(undefined, {
        hostTwimlOptions: { welcomeGreeting: 'Host loses' },
      });

      expect(twiml).toContain('welcomeGreeting="Channel default"');
      expect(twiml).not.toContain('Host loses');
    });

    it('should keep the host websocketUrl when defaultTwimlOptions does not set it', async () => {
      // Uncontested host fields still apply even though defaultTwimlOptions
      // outranks the host layer.
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, {
        defaultTwimlOptions: { welcomeGreeting: 'Channel default' },
      });

      const affinityUrl = 'wss://example.com/ws?agent_session_id=CA7';
      const twiml = await voiceChannel.handleIncomingCall(undefined, {
        hostTwimlOptions: { websocketUrl: affinityUrl },
      });

      expect(twiml).toContain(`url="${affinityUrl}"`);
      expect(twiml).toContain('welcomeGreeting="Channel default"');
    });
  });

  describe('conversation ended callback', () => {
    const createMockWebSocket = () => {
      const handlers: Record<string, ((...args: any[]) => void)[]> = {};
      return {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1, // WebSocket.OPEN
        _handlers: handlers,
        _emit(event: string, ...args: any[]) {
          for (const h of handlers[event] || []) {
            h(...args);
          }
        },
      };
    };

    const setupMessage = JSON.stringify({
      type: 'setup',
      sessionId: 'sess_cb_test',
      callSid: 'CA_cb_test',
      from: '+15551234567',
      to: '+15559876543',
      direction: 'inbound',
      callType: 'PSTN',
      callStatus: 'ringing',
      accountSid: 'ACtest123',
      customParameters: {
        conversation_id: 'CHcb_test12345',
        profile_id: 'mem_profile_cb_test',
      },
    });

    const promptMessage = JSON.stringify({
      type: 'prompt',
      voicePrompt: 'Hello',
      lang: 'en-US',
      last: true,
    });

    // Helper: mock init APIs, connect a WS, and drive setup + first prompt so
    // the conversation is initialized and tracked.
    const initConversation = async (tac: TAC, voiceChannel: VoiceChannel) => {
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);
      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 10));
      return mockWs;
    };

    it('keeps the conversation tracked on WebSocket disconnect in orchestrated mode', async () => {
      // Teardown is owned by the CLOSED webhook, so a follow-up call can reuse it.
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const captured: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(voiceChannel);

      const mockWs = await initConversation(tac, voiceChannel);
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      mockWs._emit('close');
      await new Promise(resolve => setTimeout(resolve, 0));

      // Conversation is still tracked and the callback did NOT fire on disconnect.
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);
      expect(captured).toHaveLength(0);
      // The WebSocket connection itself is torn down.
      expect(voiceChannel.getWebsocket('CHcb_test12345' as any)).toBeNull();
    });

    it('fires onConversationEnded when the CLOSED webhook arrives', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const captured: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(voiceChannel);

      const mockWs = await initConversation(tac, voiceChannel);
      mockWs._emit('close');
      await new Promise(resolve => setTimeout(resolve, 0));

      // CLOSED webhook is the mechanism that ends the conversation.
      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHcb_test12345', status: 'CLOSED' },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHcb_test12345');
      expect(captured[0].channel).toBe('voice');
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(false);
    });

    it('should still clean up session if callback throws', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      tac.onConversationEnded(() => {
        throw new Error('boom');
      });
      tac.registerChannel(voiceChannel);

      await initConversation(tac, voiceChannel);
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      // A throwing callback must not prevent the CLOSED webhook from cleaning up.
      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHcb_test12345', status: 'CLOSED' },
      });

      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(false);
    });

    it('should support async callback', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const captured: ConversationSession[] = [];

      tac.onConversationEnded(async ({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(voiceChannel);

      await initConversation(tac, voiceChannel);

      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHcb_test12345', status: 'CLOSED' },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHcb_test12345');
    });

    it('should clean up silently when no callback is registered', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      await initConversation(tac, voiceChannel);
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHcb_test12345', status: 'CLOSED' },
      });

      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(false);
    });

    it('ends the conversation on WebSocket disconnect in voice-only mode', async () => {
      // No CLOSED webhook in voice-only mode, so disconnect must end the call.
      // The callSid is used directly as the conversation ID.
      const { conversationConfigurationId: _omit, ...voiceOnlyConfig } = getTestConfig();
      const tac = await createTestTAC(voiceOnlyConfig);
      const voiceChannel = new VoiceChannel(tac);
      const captured: ConversationSession[] = [];
      tac.onConversationEnded(({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(voiceChannel);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);
      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 10));

      // In voice-only mode the conversation ID is the callSid from setup.
      expect(voiceChannel.isConversationActive('CA_cb_test' as any)).toBe(true);

      mockWs._emit('close');
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(voiceChannel.isConversationActive('CA_cb_test' as any)).toBe(false);
      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CA_cb_test');
    });

    it('should call onError when initialization fails and not close WebSocket', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const errorsCaptured: Array<{ error: Error; context?: Record<string, unknown> }> = [];

      // Mock listConversations to fail
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockRejectedValue(
        new Error('API 500 Server Error')
      );

      tac.registerChannel(voiceChannel);

      // Set onError callback AFTER registerChannel to avoid it being overwritten
      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      // Trigger setup
      mockWs._emit('message', Buffer.from(setupMessage));

      // Trigger first prompt (should fail initialization)
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async error handling
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have captured the initialization error
      expect(errorsCaptured).toHaveLength(1);
      expect(errorsCaptured[0].error.message).toContain('API 500 Server Error');
      expect(errorsCaptured[0].context).toMatchObject({
        callSid: 'CA_cb_test',
      });

      // WebSocket should NOT be closed
      expect(mockWs.close).not.toHaveBeenCalled();
    });

    it('should retry initialization on subsequent prompts after initial failure', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const errorsCaptured: Array<{ error: Error; context?: Record<string, unknown> }> = [];

      // Mock listConversations to fail first, then succeed
      let callCount = 0;
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('API 500 Server Error'));
        }
        return Promise.resolve([{ id: 'CHcb_test12345', status: 'ACTIVE' }] as any);
      });
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      // Trigger setup
      mockWs._emit('message', Buffer.from(setupMessage));

      // Trigger first prompt (should fail initialization)
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async error handling
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(errorsCaptured).toHaveLength(1);
      expect(errorsCaptured[0].error.message).toContain('API 500 Server Error');

      // Trigger second prompt (should retry and succeed)
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have captured only the first error, second attempt succeeded
      expect(errorsCaptured).toHaveLength(1);
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      // WebSocket should NOT be closed
      expect(mockWs.close).not.toHaveBeenCalled();
    });

    it('should throw error after exhausting retry limit', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const errorsCaptured: Array<{ error: Error; context?: Record<string, unknown> }> = [];

      // Mock listConversations to always fail
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockRejectedValue(
        new Error('API 500 Server Error')
      );

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      // Trigger setup
      mockWs._emit('message', Buffer.from(setupMessage));

      // Attempt 1
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorsCaptured).toHaveLength(1);

      // Attempt 2
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorsCaptured).toHaveLength(2);

      // Attempt 3
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorsCaptured).toHaveLength(3);

      // Attempt 4 (should hit retry limit)
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Last error should mention retry limit
      expect(errorsCaptured).toHaveLength(4);
      expect(errorsCaptured[3].error.message).toContain('failed after 3 attempts');

      // WebSocket should still NOT be closed
      expect(mockWs.close).not.toHaveBeenCalled();
    });

    // TODO: This test is flaky due to timing issues with callback registration after async initialization
    // It was removed in 2d943c7 as redundant/flaky, but came back in merge. Should be refactored or removed.
    it.skip('should clear retry counter on successful initialization', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const errorsCaptured: Array<{ error: Error; context?: Record<string, unknown> }> = [];

      // Mock listConversations to fail once, then succeed
      let callCount = 0;
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve([{ id: 'CHcb_test12345', status: 'ACTIVE' }] as any);
      });
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      // Trigger setup
      mockWs._emit('message', Buffer.from(setupMessage));

      // First prompt fails
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorsCaptured).toHaveLength(1);

      // Second prompt succeeds
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorsCaptured).toHaveLength(1); // No new errors
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);

      // Verify subsequent prompts work fine (retry counter was cleared)
      const capturedPrompts: string[] = [];
      voiceChannel.on('prompt', ({ transcript }) => {
        capturedPrompts.push(transcript);
      });

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'prompt',
            voicePrompt: 'Test prompt after success',
            lang: 'en-US',
            last: true,
          })
        )
      );
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(capturedPrompts).toContain('Test prompt after success');
      expect(errorsCaptured).toHaveLength(1); // Still only one error
    });

    it('should clear retry counter on WebSocket disconnect', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Mock listConversations to fail
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockRejectedValue(
        new Error('API Error')
      );

      tac.registerChannel(voiceChannel);

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      // Trigger setup and failed prompt
      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Trigger disconnect (should clean up retry counter)
      mockWs._emit('close');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Create a new WebSocket connection with same callSid
      const mockWs2 = createMockWebSocket();

      // This time make it succeed immediately
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_cb_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);

      voiceChannel.handleWebSocketConnection(mockWs2 as any);
      mockWs2._emit('message', Buffer.from(setupMessage));
      mockWs2._emit('message', Buffer.from(promptMessage));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should succeed because retry counter was cleared on disconnect
      expect(voiceChannel.isConversationActive('CHcb_test12345')).toBe(true);
    });

    it('should call onError when listParticipants fails and not close WebSocket', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const errorsCaptured: Array<{ error: Error; context?: Record<string, unknown> }> = [];

      // Mock listConversations to succeed but listParticipants to fail
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHcb_test12345', status: 'ACTIVE' },
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockRejectedValue(
        new Error('Failed to list participants: 500 Server Error')
      );

      tac.registerChannel(voiceChannel);

      voiceChannel.on('error', ({ error, context }) => {
        errorsCaptured.push({ error, context });
      });

      const mockWs = createMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      // Trigger setup and first prompt
      mockWs._emit('message', Buffer.from(setupMessage));
      mockWs._emit('message', Buffer.from(promptMessage));

      // Wait for async error handling
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have captured the error
      expect(errorsCaptured).toHaveLength(1);
      expect(errorsCaptured[0].error.message).toContain('Failed to list participants');
      expect(errorsCaptured[0].context).toMatchObject({
        callSid: 'CA_cb_test',
      });

      // WebSocket should NOT be closed
      expect(mockWs.close).not.toHaveBeenCalled();
    });
  });

  describe('handleConversationRelayCallback()', () => {
    it('should return 200 OK for completed call without conversations', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Mock the listConversations to return empty
      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([]);

      const result = await voiceChannel.handleConversationRelayCallback({
        AccountSid: 'ACtest123',
        CallSid: 'CA123',
        CallStatus: 'completed',
        From: '+15551234567',
        To: '+15559876543',
      });

      expect(result.status).toBe(200);
      expect(result.content).toBe('OK');
      expect(result.contentType).toBe('text/plain');
    });

    it('returns 403 on AccountSid mismatch without cleaning up', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const endSpy = vi.spyOn(voiceChannel as any, 'endConversation');

      const result = await voiceChannel.handleConversationRelayCallback({
        AccountSid: 'ACwrong999',
        CallSid: 'CA123',
        CallStatus: 'completed',
        From: '+15551234567',
        To: '+15559876543',
      });

      expect(result.status).toBe(403);
      expect(endSpy).not.toHaveBeenCalled();
    });

    it('does not end the conversation on completion in orchestrated mode (CO handles it)', async () => {
      // conversationConfigurationId is set -> orchestrator enabled.
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const endSpy = vi.spyOn(voiceChannel as any, 'endConversation').mockResolvedValue(undefined);

      // Simulate an established call mapping so the guard is what prevents cleanup.
      (voiceChannel as any).callSidToConversationId.set('CA123', 'CH123');

      const result = await voiceChannel.handleConversationRelayCallback({
        AccountSid: 'ACtest123',
        CallSid: 'CA123',
        CallStatus: 'completed',
        From: '+15551234567',
        To: '+15559876543',
      });

      expect(result.status).toBe(200);
      expect(endSpy).not.toHaveBeenCalled();
      // Mapping is left intact; CO webhook cleanup owns teardown.
      expect((voiceChannel as any).callSidToConversationId.has('CA123')).toBe(true);
    });

    it('ends the conversation on completion in voice-only mode', async () => {
      // No conversationConfigurationId -> orchestrator disabled (voice-only).
      const { conversationConfigurationId: _omit, ...voiceOnlyConfig } = getTestConfig();
      const tac = await createTestTAC(voiceOnlyConfig);
      const voiceChannel = new VoiceChannel(tac);
      const endSpy = vi.spyOn(voiceChannel as any, 'endConversation').mockResolvedValue(undefined);

      (voiceChannel as any).callSidToConversationId.set('CA123', 'CH123');

      const result = await voiceChannel.handleConversationRelayCallback({
        AccountSid: 'ACtest123',
        CallSid: 'CA123',
        CallStatus: 'completed',
        From: '+15551234567',
        To: '+15559876543',
      });

      expect(result.status).toBe(200);
      expect(endSpy).toHaveBeenCalledWith('CH123');
      // Mapping is cleared as part of cleanup.
      expect((voiceChannel as any).callSidToConversationId.has('CA123')).toBe(false);
    });
  });

  describe('InterruptMessage schema', () => {
    it('should parse utteranceUntilInterrupt', () => {
      const result = InterruptMessageSchema.parse({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Hello, I was say',
      });

      expect(result.utteranceUntilInterrupt).toBe('Hello, I was say');
      expect(result.durationUntilInterruptMs).toBeUndefined();
    });

    it('should parse durationUntilInterruptMs', () => {
      const result = InterruptMessageSchema.parse({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Test',
        durationUntilInterruptMs: 1500,
      });

      expect(result.durationUntilInterruptMs).toBe(1500);
    });

    it('should parse minimal interrupt (no optional fields)', () => {
      const result = InterruptMessageSchema.parse({ type: 'interrupt' });

      expect(result.utteranceUntilInterrupt).toBeUndefined();
      expect(result.durationUntilInterruptMs).toBeUndefined();
    });
  });

  describe('sendStreamingResponse()', () => {
    const createStreamingMockWebSocket = () => {
      const handlers: Record<string, ((...args: any[]) => void)[]> = {};
      return {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1, // WebSocket.OPEN
        _handlers: handlers,
        _emit(event: string, ...args: any[]) {
          for (const h of handlers[event] || []) {
            h(...args);
          }
        },
      };
    };

    const setupForStreaming = async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest123',
        authToken: 'test_token_123',
        apiKey: 'test_api_key',
        apiSecret: 'test_api_token',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });
      const voiceChannel = new VoiceChannel(tac);

      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHstream_test', status: 'ACTIVE' },
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);
      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as any);

      tac.registerChannel(voiceChannel);

      const mockWs = createStreamingMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'setup',
            sessionId: 'sess_stream',
            callSid: 'CA_stream',
            from: '+15551234567',
            to: '+15559876543',
            direction: 'inbound',
            callType: 'PSTN',
            callStatus: 'ringing',
            accountSid: 'ACtest123',
          })
        )
      );

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'prompt',
            voicePrompt: 'Hello',
            lang: 'en-US',
            last: true,
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      return { tac, voiceChannel, mockWs };
    };

    async function* makeTokenStream(tokens: string[]): AsyncGenerator<string> {
      for (const token of tokens) {
        yield token;
      }
    }

    it('should stream tokens with last: false and end with last: true', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      const result = await voiceChannel.sendStreamingResponse(
        'CHstream_test' as any,
        makeTokenStream(['Hello', ' ', 'world'])
      );

      expect(result).toBe('Hello world');

      const sendCalls = mockWs.send.mock.calls;
      const streamCalls = sendCalls.filter((call: any[]) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.type === 'text';
      });

      expect(streamCalls.length).toBeGreaterThanOrEqual(4);

      const tokens = streamCalls.map((call: any[]) => JSON.parse(call[0] as string));
      const intermediateTokens = tokens.filter((t: any) => t.last === false);
      const finalMarker = tokens.find((t: any) => t.last === true && t.token === '');

      expect(intermediateTokens).toHaveLength(3);
      expect(intermediateTokens[0].token).toBe('Hello');
      expect(intermediateTokens[1].token).toBe(' ');
      expect(intermediateTokens[2].token).toBe('world');
      expect(finalMarker).toBeDefined();
    });

    it('should stop streaming when AbortSignal is aborted', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      const controller = new AbortController();

      async function* abortableStream(): AsyncGenerator<string> {
        yield 'First';
        controller.abort();
        yield 'Second';
        yield 'Third';
      }

      const result = await voiceChannel.sendStreamingResponse(
        'CHstream_test' as any,
        abortableStream(),
        { signal: controller.signal }
      );

      expect(result).toBe('First');

      const sendCalls = mockWs.send.mock.calls;
      const textMessages = sendCalls
        .map((call: any[]) => JSON.parse(call[0] as string))
        .filter((m: any) => m.type === 'text');

      const hasSecondToken = textMessages.some((m: any) => m.token === 'Second');
      expect(hasSecondToken).toBe(false);

      const hasFinalMarker = textMessages.some((m: any) => m.last === true && m.token === '');
      expect(hasFinalMarker).toBe(false);
    });

    it('should stop streaming when WebSocket closes mid-stream', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      let sendCount = 0;
      mockWs.send = vi.fn(() => {
        sendCount++;
        if (sendCount >= 2) {
          (mockWs as any).readyState = 3; // WebSocket.CLOSED
        }
      });

      const result = await voiceChannel.sendStreamingResponse(
        'CHstream_test' as any,
        makeTokenStream(['One', 'Two', 'Three'])
      );

      expect(result).toBe('OneTwo');
    });

    it('should throw for missing WebSocket connection', async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest123',
        authToken: 'test_token_123',
        apiKey: 'test_api_key',
        apiSecret: 'test_api_token',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });
      const voiceChannel = new VoiceChannel(tac);

      await expect(
        voiceChannel.sendStreamingResponse('CH_nonexistent' as any, makeTokenStream(['test']))
      ).rejects.toThrow('No active WebSocket connection');
    });

    it('should clean up stream task when ws.send throws', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      voiceChannel.startStreamTask('CHstream_test' as any);
      mockWs.send = vi.fn(() => {
        throw new Error('socket write failed');
      });

      await expect(
        voiceChannel.sendStreamingResponse('CHstream_test' as any, makeTokenStream(['boom']))
      ).rejects.toThrow('socket write failed');

      expect(voiceChannel.hasActiveStreamTask('CHstream_test' as any)).toBe(false);
    });

    it('should complete stream task on successful completion', async () => {
      const { voiceChannel } = await setupForStreaming();

      voiceChannel.startStreamTask('CHstream_test' as any);
      expect(voiceChannel.hasActiveStreamTask('CHstream_test' as any)).toBe(true);

      await voiceChannel.sendStreamingResponse('CHstream_test' as any, makeTokenStream(['test']));

      expect(voiceChannel.hasActiveStreamTask('CHstream_test' as any)).toBe(false);
    });

    it('should fall back to active stream task signal when no explicit signal passed', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      const task = voiceChannel.startStreamTask('CHstream_test' as any);

      async function* slowStream(): AsyncGenerator<string> {
        yield 'First';
        task.controller.abort();
        yield 'Second';
      }

      const result = await voiceChannel.sendStreamingResponse('CHstream_test' as any, slowStream());

      expect(result).toBe('First');

      const textMessages = mockWs.send.mock.calls
        .map((call: any[]) => JSON.parse(call[0] as string))
        .filter((m: any) => m.type === 'text');

      const hasSecondToken = textMessages.some((m: any) => m.token === 'Second');
      expect(hasSecondToken).toBe(false);
    });

    it('should stop streaming when explicit signal is aborted via cancelStreamTask', async () => {
      const { voiceChannel, mockWs } = await setupForStreaming();

      const task = voiceChannel.startStreamTask('CHstream_test' as any);
      let yieldCount = 0;

      async function* slowStream(): AsyncGenerator<string> {
        yield 'First';
        yieldCount++;
        // Simulate interrupt cancelling the stream task externally
        voiceChannel.cancelStreamTask('CHstream_test' as any);
        yield 'Second';
        yieldCount++;
      }

      const result = await voiceChannel.sendStreamingResponse(
        'CHstream_test' as any,
        slowStream(),
        { signal: task.controller.signal }
      );

      expect(result).toBe('First');

      const textMessages = mockWs.send.mock.calls
        .map((call: any[]) => JSON.parse(call[0] as string))
        .filter((m: any) => m.type === 'text');

      const hasSecondToken = textMessages.some((m: any) => m.token === 'Second');
      expect(hasSecondToken).toBe(false);

      const hasFinalMarker = textMessages.some((m: any) => m.last === true && m.token === '');
      expect(hasFinalMarker).toBe(false);
    });
  });

  describe('interrupt handling', () => {
    const createInterruptMockWebSocket = () => {
      const handlers: Record<string, ((...args: any[]) => void)[]> = {};
      return {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1,
        _handlers: handlers,
        _emit(event: string, ...args: any[]) {
          for (const h of handlers[event] || []) {
            h(...args);
          }
        },
      };
    };

    const setupForInterrupt = async () => {
      const tac = await createTestTAC({
        accountSid: 'ACtest123',
        authToken: 'test_token_123',
        apiKey: 'test_api_key',
        apiSecret: 'test_api_token',
        phoneNumber: '+15551234567',
        conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      });
      const voiceChannel = new VoiceChannel(tac);

      vi.spyOn(tac.getConversationClient(), 'listConversations').mockResolvedValue([
        { id: 'CHinterrupt_test', status: 'ACTIVE' },
      ] as any);
      vi.spyOn(tac.getConversationClient(), 'listParticipants').mockResolvedValue([
        {
          profileId: 'mem_profile_test',
          addresses: [{ channel: 'VOICE', address: '+15551234567' }],
        },
      ] as any);
      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue(undefined as any);

      tac.registerChannel(voiceChannel);

      const mockWs = createInterruptMockWebSocket();
      voiceChannel.handleWebSocketConnection(mockWs as any);

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'setup',
            sessionId: 'sess_int',
            callSid: 'CA_int',
            from: '+15551234567',
            to: '+15559876543',
            direction: 'inbound',
            callType: 'PSTN',
            callStatus: 'ringing',
            accountSid: 'ACtest123',
          })
        )
      );

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'prompt',
            voicePrompt: 'Hello',
            lang: 'en-US',
            last: true,
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      return { tac, voiceChannel, mockWs };
    };

    it('should send stream finalization when interrupt cancels an active stream with tokens sent', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      expect(voiceChannel.hasActiveStreamTask('CHinterrupt_test' as any)).toBe(true);

      // Actually send a streaming token so the stream is considered active
      voiceChannel
        .sendStreamingResponse(
          'CHinterrupt_test' as any,
          (async function* () {
            yield 'Hello';
            yield new Promise(() => {}) as never;
          })()
        )
        .catch(() => {});

      await new Promise(resolve => setTimeout(resolve, 10));
      mockWs.send.mockClear();

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'interrupt',
            utteranceUntilInterrupt: 'Hello, I was',
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      const ackCall = mockWs.send.mock.calls.find((call: any[]) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.type === 'text' && parsed.token === '' && parsed.last === true;
      });

      expect(ackCall).toBeDefined();
    });

    it('should not send stream finalization when stream task exists but no tokens sent', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      expect(voiceChannel.hasActiveStreamTask('CHinterrupt_test' as any)).toBe(true);
      mockWs.send.mockClear();

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'interrupt',
            utteranceUntilInterrupt: 'Hello',
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      const ackCall = mockWs.send.mock.calls.find((call: any[]) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.type === 'text' && parsed.token === '' && parsed.last === true;
      });

      expect(ackCall).toBeUndefined();
    });

    it('should not send stream finalization when no stream is active', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      voiceChannel.completeStreamTask('CHinterrupt_test' as any);
      expect(voiceChannel.hasActiveStreamTask('CHinterrupt_test' as any)).toBe(false);
      mockWs.send.mockClear();

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'interrupt',
            utteranceUntilInterrupt: 'Hello again',
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      const ackCall = mockWs.send.mock.calls.find((call: any[]) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.type === 'text' && parsed.token === '' && parsed.last === true;
      });

      expect(ackCall).toBeUndefined();
    });

    it('should pass utteranceUntilInterrupt through onInterrupt callback', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      const captured: {
        utteranceUntilInterrupt: string | undefined;
        durationUntilInterruptMs: number | undefined;
      }[] = [];
      voiceChannel.on('interrupt', (data: any) => {
        captured.push({
          utteranceUntilInterrupt: data.utteranceUntilInterrupt,
          durationUntilInterruptMs: data.durationUntilInterruptMs,
        });
      });

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'interrupt',
            utteranceUntilInterrupt: 'Hello, I was say',
            durationUntilInterruptMs: 2500,
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(captured).toHaveLength(1);
      expect(captured[0].utteranceUntilInterrupt).toBe('Hello, I was say');
      expect(captured[0].durationUntilInterruptMs).toBe(2500);
    });

    it('should propagate utteranceUntilInterrupt through tac.onInterrupt callback', async () => {
      const { tac, mockWs } = await setupForInterrupt();

      const captured: {
        utteranceUntilInterrupt: string | undefined;
        durationUntilInterruptMs: number | undefined;
      }[] = [];
      tac.onInterrupt(({ utteranceUntilInterrupt, durationUntilInterruptMs }) => {
        captured.push({ utteranceUntilInterrupt, durationUntilInterruptMs });
      });

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'interrupt',
            utteranceUntilInterrupt: 'Hello, I was saying',
            durationUntilInterruptMs: 3200,
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(captured).toHaveLength(1);
      expect(captured[0].utteranceUntilInterrupt).toBe('Hello, I was saying');
      expect(captured[0].durationUntilInterruptMs).toBe(3200);
    });

    it('should auto-start stream task on prompt and pass abortSignal', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      const capturedSignals: AbortSignal[] = [];
      voiceChannel.on('prompt', (data: any) => {
        capturedSignals.push(data.abortSignal);
      });

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'prompt',
            voicePrompt: 'Another prompt',
            lang: 'en-US',
            last: true,
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(capturedSignals).toHaveLength(1);
      expect(capturedSignals[0]).toBeInstanceOf(AbortSignal);
      expect(capturedSignals[0].aborted).toBe(false);
    });

    it('should abort stream task signal on interrupt', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      const capturedSignals: AbortSignal[] = [];
      voiceChannel.on('prompt', (data: any) => {
        capturedSignals.push(data.abortSignal);
      });

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'prompt',
            voicePrompt: 'Start talking',
            lang: 'en-US',
            last: true,
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(capturedSignals).toHaveLength(1);
      expect(capturedSignals[0].aborted).toBe(false);

      mockWs._emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'interrupt',
            utteranceUntilInterrupt: 'Hello',
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(capturedSignals[0].aborted).toBe(true);
    });

    it('should cancel stream task on WebSocket disconnect', async () => {
      const { voiceChannel, mockWs } = await setupForInterrupt();

      expect(voiceChannel.hasActiveStreamTask('CHinterrupt_test' as any)).toBe(true);

      mockWs._emit('close');

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(voiceChannel.hasActiveStreamTask('CHinterrupt_test' as any)).toBe(false);
    });
  });

  describe('ConversationRelay attribute emission', () => {
    // Exercises the merged-TwiMLOptions emit path via handleIncomingCall +
    // defaultTwimlOptions. The widened TwiMLOptions surface should emit every
    // documented attribute.
    const getVoiceConfig = () => ({ ...getTestConfig(), voicePublicDomain: 'example.com' });

    const emit = async (defaultTwimlOptions: Record<string, unknown>): Promise<string> => {
      const tac = await createTestTAC(getVoiceConfig());
      const voiceChannel = new VoiceChannel(tac, { defaultTwimlOptions } as never);
      return voiceChannel.handleIncomingCall();
    };

    it('emits voice / language / provider attributes', async () => {
      const twiml = await emit({
        voice: 'en-US-Journey-D',
        language: 'en-US',
        transcriptionProvider: 'deepgram',
        ttsProvider: 'elevenlabs',
      });
      expect(twiml).toContain('voice="en-US-Journey-D"');
      expect(twiml).toContain('language="en-US"');
      expect(twiml).toContain('transcriptionProvider="deepgram"');
      expect(twiml).toContain('ttsProvider="elevenlabs"');
    });

    it('emits interruptible / dtmfDetection / debug', async () => {
      const twiml = await emit({
        interruptible: 'speech',
        dtmfDetection: true,
        debug: 'speaker-events',
      });
      expect(twiml).toContain('interruptible="speech"');
      expect(twiml).toContain('dtmfDetection="true"');
      expect(twiml).toContain('debug="speaker-events"');
    });

    it('normalizes a boolean interruptible to the documented enum', async () => {
      const twimlTrue = await emit({ interruptible: true });
      const twimlFalse = await emit({ interruptible: false });
      expect(twimlTrue).toContain('interruptible="any"');
      expect(twimlFalse).toContain('interruptible="none"');
    });

    it('emits <Language> children', async () => {
      const twiml = await emit({
        languages: [
          {
            code: 'es-MX',
            voice: 'es-MX-Neural2-A',
            ttsProvider: 'google',
            transcriptionProvider: 'google',
            speechModel: 'long',
          },
          { code: 'fr-FR' },
        ],
      });
      expect(twiml).toContain('<Language code="es-MX"');
      expect(twiml).toContain('voice="es-MX-Neural2-A"');
      expect(twiml).toContain('ttsProvider="google"');
      expect(twiml).toContain('speechModel="long"');
      expect(twiml).toContain('<Language code="fr-FR"/>');
    });

    it('emits welcomeGreetingInterruptible and language overrides', async () => {
      const twiml = await emit({
        welcomeGreeting: 'Hi',
        welcomeGreetingInterruptible: 'dtmf',
        ttsLanguage: 'en-US',
        transcriptionLanguage: 'fr-FR',
      });
      expect(twiml).toContain('welcomeGreetingInterruptible="dtmf"');
      expect(twiml).toContain('ttsLanguage="en-US"');
      expect(twiml).toContain('transcriptionLanguage="fr-FR"');
    });

    it('emits speechModel and elevenlabs normalization', async () => {
      const twiml = await emit({
        speechModel: 'nova-3-general',
        elevenlabsTextNormalization: 'on',
      });
      expect(twiml).toContain('speechModel="nova-3-general"');
      expect(twiml).toContain('elevenlabsTextNormalization="on"');
    });

    it('emits turn-detection attributes', async () => {
      const twiml = await emit({
        eotThreshold: 0.75,
        partialPrompts: true,
        deepgramSmartFormat: false,
        speechTimeout: 1500,
      });
      expect(twiml).toContain('eotThreshold="0.75"');
      expect(twiml).toContain('partialPrompts="true"');
      expect(twiml).toContain('deepgramSmartFormat="false"');
      expect(twiml).toContain('speechTimeout="1500"');
    });

    it('emits interruptSensitivity / reportInputDuringAgentSpeech', async () => {
      const twiml = await emit({
        interruptSensitivity: 'medium',
        reportInputDuringAgentSpeech: 'speech',
      });
      expect(twiml).toContain('interruptSensitivity="medium"');
      expect(twiml).toContain('reportInputDuringAgentSpeech="speech"');
    });

    it('emits ignoreBackchannel / preemptible', async () => {
      const twiml = await emit({ ignoreBackchannel: true, preemptible: true });
      expect(twiml).toContain('ignoreBackchannel="true"');
      expect(twiml).toContain('preemptible="true"');
    });

    it('emits hints / events / intelligenceService', async () => {
      const twiml = await emit({
        hints: 'TwiML,ConversationRelay',
        events: 'speaker-events tokens-played',
        intelligenceService: 'GAaabbcc',
      });
      expect(twiml).toContain('hints="TwiML,ConversationRelay"');
      expect(twiml).toContain('events="speaker-events tokens-played"');
      expect(twiml).toContain('intelligenceService="GAaabbcc"');
    });

    it('accepts the literal "auto" speechTimeout', async () => {
      const twiml = await emit({ speechTimeout: 'auto' });
      expect(twiml).toContain('speechTimeout="auto"');
    });

    it('omits unset attributes from output', async () => {
      const twiml = await emit({});
      for (const attr of [
        'voice=',
        'transcriptionProvider=',
        'ttsProvider=',
        'interruptible=',
        'dtmfDetection=',
        'debug=',
        'welcomeGreetingInterruptible=',
        'ttsLanguage=',
        'transcriptionLanguage=',
        'speechModel=',
        'elevenlabsTextNormalization=',
        'eotThreshold=',
        'partialPrompts=',
        'deepgramSmartFormat=',
        'speechTimeout=',
        'interruptSensitivity=',
        'reportInputDuringAgentSpeech=',
        'ignoreBackchannel=',
        'preemptible=',
        'hints=',
        'events=',
        'intelligenceService=',
        '<Language',
      ]) {
        expect(twiml).not.toContain(attr);
      }
    });

    it('emits extra attributes as-is', async () => {
      const twiml = await emit({ extra: { futureFeature: 'on', anotherAttr: true } });
      expect(twiml).toContain('futureFeature="on"');
      expect(twiml).toContain('anotherAttr="true"');
    });
  });

  describe('webhook processing', () => {
    it('should clean up session when conversation is closed', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Simulate a voice conversation started (normally happens via WebSocket)
      (voiceChannel as any).startConversation('CHtest123456789', undefined);

      expect(voiceChannel.isConversationActive('CHtest123456789' as any)).toBe(true);

      // Process CONVERSATION_UPDATED webhook with CLOSED status
      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          id: 'CHtest123456789',
          status: 'CLOSED',
        },
      });

      expect(voiceChannel.isConversationActive('CHtest123456789' as any)).toBe(false);
    });

    it('invalidates cached memory on INACTIVE for "once" mode, then re-fetches', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac, { memoryMode: 'once' });
      const spy = vi.spyOn(tac, 'retrieveMemory').mockResolvedValue({ v: 1 } as never);

      // Simulate a voice conversation started (normally happens via WebSocket)
      (voiceChannel as any).startConversation('CHtest123456789', undefined);
      const session = voiceChannel.getConversationSession('CHtest123456789' as any);

      // Prime the cache the way the first inbound prompt would.
      await (voiceChannel as any).retrieveMemoryIfEnabled(session);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(session?.cachedMemory).toBeDefined();

      // Conversation goes INACTIVE -> cache cleared.
      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHtest123456789', status: 'INACTIVE' },
      });
      expect(session?.cachedMemory).toBeUndefined();

      // Next retrieval re-fetches fresh memory.
      await (voiceChannel as any).retrieveMemoryIfEnabled(session);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('does not invalidate cached memory on non-INACTIVE status updates', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac, { memoryMode: 'once' });
      vi.spyOn(tac, 'retrieveMemory').mockResolvedValue({ v: 1 } as never);

      (voiceChannel as any).startConversation('CHtest123456789', undefined);
      const session = voiceChannel.getConversationSession('CHtest123456789' as any);

      await (voiceChannel as any).retrieveMemoryIfEnabled(session);
      const cachedBefore = session?.cachedMemory;
      expect(cachedBefore).toBeDefined();

      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHtest123456789', status: 'ACTIVE' },
      });

      expect(session?.cachedMemory).toBe(cachedBefore);
    });

    it('should trigger onConversationEnded callback when closed', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);
      const captured: ConversationSession[] = [];

      tac.onConversationEnded(({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(voiceChannel);

      // Start conversation
      (voiceChannel as any).startConversation('CHtest123456789', undefined);

      // Close conversation
      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHtest123456789', status: 'CLOSED' },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].conversationId).toBe('CHtest123456789');
      expect(captured[0].channel).toBe('voice');
    });

    it('should handle duplicate webhooks via idempotency token', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Start conversation
      (voiceChannel as any).startConversation('CHtest123456789', undefined);

      const idempotencyToken = 'idempotency-token-123';

      // First webhook should process
      await voiceChannel.processWebhook(
        {
          eventType: 'CONVERSATION_UPDATED',
          data: { id: 'CHtest123456789', status: 'CLOSED' },
        },
        idempotencyToken
      );

      expect(voiceChannel.isConversationActive('CHtest123456789' as any)).toBe(false);

      // Restart the same conversation to test duplicate webhook
      (voiceChannel as any).startConversation('CHtest123456789', undefined);
      expect(voiceChannel.isConversationActive('CHtest123456789' as any)).toBe(true);

      // Duplicate webhook should be ignored (same idempotency token)
      await voiceChannel.processWebhook(
        {
          eventType: 'CONVERSATION_UPDATED',
          data: { id: 'CHtest123456789', status: 'CLOSED' },
        },
        idempotencyToken
      );

      // Conversation should still be active (duplicate was ignored)
      expect(voiceChannel.isConversationActive('CHtest123456789' as any)).toBe(true);
    });

    it('should ignore webhook for unknown conversation', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // No error should be thrown for unknown conversation
      await voiceChannel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHunknown', status: 'CLOSED' },
      });
    });

    it('should ignore unhandled event types', async () => {
      const tac = await createTestTAC(getTestConfig());
      const voiceChannel = new VoiceChannel(tac);

      // Start conversation
      (voiceChannel as any).startConversation('CHtest123456789', undefined);

      // Process unhandled event type (should not throw)
      await voiceChannel.processWebhook({
        eventType: 'UNKNOWN_EVENT_TYPE',
        data: { id: 'CHtest123456789' },
      });

      // Conversation should still be active
      expect(voiceChannel.isConversationActive('CHtest123456789' as any)).toBe(true);
    });
  });
});
