import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SMSChannel,
  VoiceChannel,
  SegmentClient,
  TAC,
  TACSegmentResponse,
  ConversationSession,
} from '@twilio/tac-core';
import { WebSocket } from 'ws';
import { createTestTAC } from './helpers/tac';
import { makeEvent, segmentTestConfig } from './helpers/segment';

const orchestratorConfig = {
  conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
};

const session = (address: string | undefined): ConversationSession =>
  ({
    conversationId: 'conv1',
    ...(address && { authorInfo: { address } }),
  }) as unknown as ConversationSession;

const events = [makeEvent({ event: 'Application Submitted', timestamp: '2026-11-09T10:00:00Z' })];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('TAC Segment integration', () => {
  describe('getSegmentClient()', () => {
    it('should be null when Segment is not configured', async () => {
      const { segmentSpaceId: _s, segmentProfileApiToken: _t, ...rest } = segmentTestConfig();
      const tac = await createTestTAC({ ...rest, ...orchestratorConfig });

      expect(tac.getSegmentClient()).toBeNull();
    });

    it('should be created when space ID and token are set', async () => {
      const tac = await createTestTAC({ ...segmentTestConfig(), ...orchestratorConfig });

      expect(tac.getSegmentClient()).toBeInstanceOf(SegmentClient);
    });

    it('should be created in voice-only mode (no conversationConfigurationId)', async () => {
      const tac = await TAC.create({ config: segmentTestConfig() });

      expect(tac.getSegmentClient()).toBeInstanceOf(SegmentClient);
    });
  });

  describe('resolveSegmentIdentity()', () => {
    let tac: TAC;
    beforeEach(async () => {
      tac = await createTestTAC({ ...segmentTestConfig(), ...orchestratorConfig });
    });

    it('should use the author address with the configured identifier type', () => {
      expect(tac.resolveSegmentIdentity(session('+15559876543'))).toEqual({
        type: 'phone',
        value: '+15559876543',
      });
    });

    it.each(['whatsapp:+15559876543', 'rcs:+15559876543', 'SMS:+15559876543'])(
      'should strip the channel prefix from %s',
      address => {
        expect(tac.resolveSegmentIdentity(session(address))?.value).toBe('+15559876543');
      }
    );

    it('should return undefined when the session has no author address', () => {
      expect(tac.resolveSegmentIdentity(session(undefined))).toBeUndefined();
    });

    it('should prefer a custom resolver', async () => {
      const custom = await TAC.create({
        config: segmentTestConfig(),
        segmentIdentityResolver: () => ({ type: 'email', value: 'a@b.com' }),
      });

      expect(custom.resolveSegmentIdentity(session('+1555'))).toEqual({
        type: 'email',
        value: 'a@b.com',
      });
    });
  });

  describe('retrieveSegmentEvents()', () => {
    it('should return an empty response when Segment is not configured', async () => {
      const { segmentSpaceId: _s, segmentProfileApiToken: _t, ...rest } = segmentTestConfig();
      const tac = await createTestTAC({ ...rest, ...orchestratorConfig });

      const result = await tac.retrieveSegmentEvents(session('+1555'));

      expect(result.isEmpty).toBe(true);
    });

    it('should skip the lookup when no identity can be derived', async () => {
      const tac = await createTestTAC({ ...segmentTestConfig(), ...orchestratorConfig });
      const spy = vi.spyOn(SegmentClient.prototype, 'getProfileEvents');

      const result = await tac.retrieveSegmentEvents(session(undefined));

      expect(result.isEmpty).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should fetch events for the resolved identity and wrap them', async () => {
      const tac = await createTestTAC({ ...segmentTestConfig(), ...orchestratorConfig });
      const spy = vi.spyOn(SegmentClient.prototype, 'getProfileEvents').mockResolvedValue(events);

      const result = await tac.retrieveSegmentEvents(session('whatsapp:+15559876543'), {
        limit: 5,
      });

      expect(spy).toHaveBeenCalledWith({ type: 'phone', value: '+15559876543' }, { limit: 5 });
      expect(result).toBeInstanceOf(TACSegmentResponse);
      expect(result.events).toEqual(events);
    });

    it('should propagate client errors', async () => {
      const tac = await createTestTAC({ ...segmentTestConfig(), ...orchestratorConfig });
      vi.spyOn(SegmentClient.prototype, 'getProfileEvents').mockRejectedValue(new Error('boom'));

      await expect(tac.retrieveSegmentEvents(session('+1555'))).rejects.toThrow('boom');
    });
  });
});

describe('Channel segmentMode', () => {
  let tac: TAC;

  beforeEach(async () => {
    tac = await createTestTAC({ ...segmentTestConfig(), ...orchestratorConfig });
  });

  it('should default to "never"', () => {
    expect((new SMSChannel(tac) as any).segmentMode).toBe('never');
  });

  it('should accept "always"', () => {
    expect((new SMSChannel(tac, { segmentMode: 'always' }) as any).segmentMode).toBe('always');
  });

  it('should reject an invalid mode', () => {
    expect(() => new SMSChannel(tac, { segmentMode: 'sometimes' as never })).toThrow(
      /Invalid segmentMode/
    );
  });

  describe('retrieveSegmentEventsIfEnabled()', () => {
    const run = (channel: SMSChannel) =>
      (channel as any).retrieveSegmentEventsIfEnabled(session('+1555'));

    it('should not fetch when mode is "never"', async () => {
      const spy = vi.spyOn(tac, 'retrieveSegmentEvents');

      await expect(run(new SMSChannel(tac))).resolves.toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it('should not fetch when Segment is not configured', async () => {
      const { segmentSpaceId: _s, segmentProfileApiToken: _t, ...rest } = segmentTestConfig();
      const unconfigured = await createTestTAC({ ...rest, ...orchestratorConfig });
      const spy = vi.spyOn(unconfigured, 'retrieveSegmentEvents');

      await expect(
        run(new SMSChannel(unconfigured, { segmentMode: 'always' }))
      ).resolves.toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it('should return the events when mode is "always"', async () => {
      const response = new TACSegmentResponse(events);
      vi.spyOn(tac, 'retrieveSegmentEvents').mockResolvedValue(response);

      await expect(run(new SMSChannel(tac, { segmentMode: 'always' }))).resolves.toBe(response);
    });

    it('should fail open when the lookup throws', async () => {
      vi.spyOn(tac, 'retrieveSegmentEvents').mockRejectedValue(new Error('segment down'));

      await expect(run(new SMSChannel(tac, { segmentMode: 'always' }))).resolves.toBeUndefined();
    });

    it('should fail open after the 2s timeout', async () => {
      vi.useFakeTimers();
      vi.spyOn(tac, 'retrieveSegmentEvents').mockReturnValue(new Promise(() => {}));

      const pending = run(new SMSChannel(tac, { segmentMode: 'always' }));
      await vi.advanceTimersByTimeAsync(1999);
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBeUndefined();
    });

    it('should not leave a pending timer after a fast response', async () => {
      vi.useFakeTimers();
      vi.spyOn(tac, 'retrieveSegmentEvents').mockResolvedValue(new TACSegmentResponse(events));

      await run(new SMSChannel(tac, { segmentMode: 'always' }));

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('VoiceChannel prompt handling', () => {
    it('should pass segmentEvents to the prompt callback', async () => {
      const voice = new VoiceChannel(tac, { segmentMode: 'always' });
      tac.registerChannel(voice);
      const response = new TACSegmentResponse(events);
      const spy = vi.spyOn(tac, 'retrieveSegmentEvents').mockResolvedValue(response);

      (voice as any).provider.webSocketConnections.set('conv123', {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        on: vi.fn(),
      });
      (voice as any).startConversation('conv123', 'prof123');
      const onPrompt = vi.fn();
      voice.on('prompt', onPrompt);

      await (voice as any).provider.handlePromptMessage('conv123', {
        type: 'prompt',
        voicePrompt: 'hello',
      });

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv123' }));
      expect(onPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conv123', segmentEvents: response })
      );
      voice.shutdown();
    });

    it('should omit segmentEvents when mode is "never"', async () => {
      const voice = new VoiceChannel(tac);
      tac.registerChannel(voice);
      (voice as any).provider.webSocketConnections.set('conv123', {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        on: vi.fn(),
      });
      (voice as any).startConversation('conv123', 'prof123');
      const onPrompt = vi.fn();
      voice.on('prompt', onPrompt);

      await (voice as any).provider.handlePromptMessage('conv123', {
        type: 'prompt',
        voicePrompt: 'hi',
      });

      expect(onPrompt.mock.calls[0]?.[0]).not.toHaveProperty('segmentEvents');
      voice.shutdown();
    });
  });

  describe('onMessageReady forwarding', () => {
    it('should hand segmentEvents to the registered callback', async () => {
      const response = new TACSegmentResponse(events);
      const channel = new SMSChannel(tac, { segmentMode: 'always' });
      tac.registerChannel(channel);
      const callback = vi.fn().mockResolvedValue(null);
      tac.onMessageReady(callback);
      vi.spyOn(channel, 'getConversationSession').mockReturnValue(session('+1555'));

      (channel as any).messagingCallbacks.onMessageReceived({
        conversationId: 'conv1',
        profileId: undefined,
        message: 'hi',
        author: '+1555',
        userMemory: undefined,
        segmentEvents: response,
      });
      await vi.waitFor(() => expect(callback).toHaveBeenCalled());

      expect(callback.mock.calls[0]?.[0]).toMatchObject({ segmentEvents: response });
    });
  });
});
