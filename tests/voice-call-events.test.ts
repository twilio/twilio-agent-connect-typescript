import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceChannel, TAC } from '@twilio/tac-core';
import {
  amdEventFromForm,
  callStatusEventFromForm,
  recordingEventFromForm,
} from '@twilio/tac-core';
import type { AmdEvent, CallStatusEvent, ConversationId, RecordingEvent } from '@twilio/tac-core';
import { createTestTAC } from './helpers/tac';

const mockCallUpdate = vi.fn();
const mockCalls = vi.fn(() => ({ update: mockCallUpdate }));

vi.mock('twilio', () => ({
  default: () => ({
    // `calls` is callable — client.calls(sid).update(...) — with a `create`
    // property, matching the real SDK shape.
    calls: Object.assign(mockCalls, { create: vi.fn() }),
  }),
}));

describe('Voice call events', () => {
  const getTestConfig = () => ({
    accountSid: 'ACtest123',
    authToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_token',
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let tac: TAC;
  let channel: VoiceChannel;

  beforeEach(async () => {
    mockCallUpdate.mockReset();
    mockCallUpdate.mockResolvedValue({});
    mockCalls.mockClear();
    tac = await createTestTAC(getTestConfig());
    channel = new VoiceChannel(tac);
  });

  afterEach(() => {
    tac.shutdown();
    vi.restoreAllMocks();
  });

  /** Start a session the way the WS setup path does, with its CallSid recorded. */
  const startSession = (conversationId: string, callSid?: string) => {
    // startConversation is protected; call events are the out-of-band path that
    // has to find whatever it created.
    const session = (
      channel as unknown as {
        startConversation: (id: string, profileId?: string) => { callSid?: string };
      }
    ).startConversation(conversationId);
    if (callSid !== undefined) {
      session.callSid = callSid;
    }
    return session;
  };

  // ===========================================================================
  // Event models
  // ===========================================================================

  describe('event parsing', () => {
    it('parses an AMD event', () => {
      const event = amdEventFromForm({
        CallSid: 'CA1',
        AccountSid: 'ACtest123',
        AnsweredBy: 'machine_end_beep',
        MachineDetectionDuration: '3200',
      });

      expect(event.callSid).toBe('CA1');
      expect(event.answeredBy).toBe('machine_end_beep');
      expect(event.machineDetectionDuration).toBe('3200');
    });

    it('parses a recording event', () => {
      const event = recordingEventFromForm({
        CallSid: 'CA1',
        RecordingSid: 'RE1',
        RecordingUrl: 'https://x/r',
        RecordingStatus: 'completed',
        RecordingDuration: '12',
      });

      expect(event.recordingSid).toBe('RE1');
      expect(event.recordingUrl).toBe('https://x/r');
      expect(event.recordingDuration).toBe('12');
    });

    it('parses a status event', () => {
      const event = callStatusEventFromForm({
        CallSid: 'CA1',
        CallStatus: 'no-answer',
        CallDuration: '0',
        SipResponseCode: '480',
      });

      expect(event.callStatus).toBe('no-answer');
      expect(event.callDuration).toBe('0');
      expect(event.sipResponseCode).toBe('480');
    });

    it('keeps unmodeled form fields in extra', () => {
      const event = callStatusEventFromForm({
        CallSid: 'CA1',
        CallStatus: 'completed',
        Custom: 'x',
      });

      expect(event.extra.Custom).toBe('x');
      // Fields belonging to another event type land in extra, not dropped.
      expect(event.extra.RecordingSid).toBeUndefined();
    });

    it('buckets another event type’s fields into extra', () => {
      const event = amdEventFromForm({
        CallSid: 'CA1',
        AnsweredBy: 'human',
        RecordingSid: 'RE1',
      });

      expect(event.extra.RecordingSid).toBe('RE1');
    });

    it('rejects a form with no CallSid', () => {
      // Better to fail than hand a handler an empty SID to act on.
      expect(() => amdEventFromForm({ AnsweredBy: 'machine_start' })).toThrow();
      expect(() => amdEventFromForm({ CallSid: '', AnsweredBy: 'human' })).toThrow();
    });
  });

  // ===========================================================================
  // Predicates — keep mode-specific string matching out of application code
  // ===========================================================================

  describe('predicates', () => {
    it.each(['machine_start', 'machine_end_beep', 'machine_end_silence', 'machine_end_other'])(
      'isMachine is true for %s',
      answeredBy => {
        expect(amdEventFromForm({ CallSid: 'CA1', AnsweredBy: answeredBy }).isMachine).toBe(true);
      }
    );

    it.each(['human', 'fax', 'unknown', ''])('isMachine is false for %s', answeredBy => {
      // 'unknown' means detection timed out — never hang up on a guess.
      expect(amdEventFromForm({ CallSid: 'CA1', AnsweredBy: answeredBy }).isMachine).toBe(false);
    });

    it('isMachine is false when AnsweredBy is absent', () => {
      expect(amdEventFromForm({ CallSid: 'CA1' }).isMachine).toBe(false);
    });

    it.each(['busy', 'no-answer', 'failed', 'canceled'])(
      'isUnreached is true for %s',
      callStatus => {
        expect(
          callStatusEventFromForm({ CallSid: 'CA1', CallStatus: callStatus }).isUnreached
        ).toBe(true);
      }
    );

    it.each(['completed', 'in-progress', 'ringing'])('isUnreached is false for %s', callStatus => {
      expect(callStatusEventFromForm({ CallSid: 'CA1', CallStatus: callStatus }).isUnreached).toBe(
        false
      );
    });

    it('isUnreached is false when CallStatus is absent', () => {
      expect(callStatusEventFromForm({ CallSid: 'CA1' }).isUnreached).toBe(false);
    });
  });

  // ===========================================================================
  // Handler dispatch
  // ===========================================================================

  describe('handler dispatch', () => {
    it('fires the registered status handler', async () => {
      const received: CallStatusEvent[] = [];
      channel.onCallStatus(event => {
        received.push(event);
      });

      const result = await channel.handleCallStatusEvent({
        CallSid: 'CA1',
        AccountSid: 'ACtest123',
        CallStatus: 'no-answer',
      });

      expect(result.status).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0]!.callStatus).toBe('no-answer');
    });

    it('fires the registered AMD handler', async () => {
      const received: AmdEvent[] = [];
      channel.onAmd(event => {
        received.push(event);
      });

      await channel.handleAmdEvent({
        CallSid: 'CA1',
        AccountSid: 'ACtest123',
        AnsweredBy: 'human',
      });

      expect(received[0]!.answeredBy).toBe('human');
    });

    it('fires the registered recording handler', async () => {
      const received: RecordingEvent[] = [];
      channel.onRecording(event => {
        received.push(event);
      });

      await channel.handleRecordingEvent({
        CallSid: 'CA1',
        AccountSid: 'ACtest123',
        RecordingStatus: 'completed',
      });

      expect(received[0]!.recordingStatus).toBe('completed');
    });

    it('keeps handlers independently optional', async () => {
      // Only onAmd registered: amd fires, status/recording no-op silently.
      const received: AmdEvent[] = [];
      channel.onAmd(event => {
        received.push(event);
      });

      await channel.handleCallStatusEvent({ CallSid: 'CA1', CallStatus: 'completed' });
      await channel.handleRecordingEvent({ CallSid: 'CA1', RecordingStatus: 'completed' });
      await channel.handleAmdEvent({ CallSid: 'CA1', AnsweredBy: 'human' });

      expect(received).toHaveLength(1);
      expect(received[0]!.answeredBy).toBe('human');
    });

    it('is a 200 no-op with no handler registered', async () => {
      // Routes register unconditionally, so a stale config no-ops instead of 404ing.
      const result = await channel.handleCallStatusEvent({
        CallSid: 'CA1',
        CallStatus: 'completed',
      });

      expect(result.status).toBe(200);
    });

    it('ignores an AccountSid mismatch', async () => {
      const received: CallStatusEvent[] = [];
      channel.onCallStatus(event => {
        received.push(event);
      });

      const result = await channel.handleCallStatusEvent({
        CallSid: 'CA1',
        AccountSid: 'ACwrong',
        CallStatus: 'completed',
      });

      expect(received).toEqual([]);
      expect(result.status).toBe(200);
    });

    it('allows a payload with no AccountSid through', async () => {
      const received: CallStatusEvent[] = [];
      channel.onCallStatus(event => {
        received.push(event);
      });

      await channel.handleCallStatusEvent({ CallSid: 'CA1', CallStatus: 'completed' });

      expect(received).toHaveLength(1);
    });

    it('returns 400 when the handler throws', async () => {
      channel.onAmd(() => {
        throw new Error('handler exploded');
      });

      const result = await channel.handleAmdEvent({ CallSid: 'CA1', AnsweredBy: 'human' });

      expect(result.status).toBe(400);
    });

    it('returns 400 when CallSid is missing', async () => {
      const received: AmdEvent[] = [];
      channel.onAmd(event => {
        received.push(event);
      });

      const result = await channel.handleAmdEvent({ AnsweredBy: 'machine_start' });

      expect(result.status).toBe(400);
      expect(received).toEqual([]);
    });
  });

  // ===========================================================================
  // endCall
  // ===========================================================================

  describe('endCall()', () => {
    it('hangs up via Twilio', async () => {
      await expect(channel.endCall('CA1')).resolves.toBe(true);

      expect(mockCalls).toHaveBeenCalledWith('CA1');
      expect(mockCallUpdate).toHaveBeenCalledWith({ status: 'completed' });
    });

    it('cleans up the session found by CallSid', async () => {
      // conversationId !== callSid in orchestrator mode; resolved by scanning sessions.
      startSession('conv_abc', 'CA1');
      const endConversation = vi
        .spyOn(
          channel as unknown as { endConversation: (id: ConversationId) => Promise<void> },
          'endConversation'
        )
        .mockResolvedValue(undefined);

      await channel.endCall('CA1');

      expect(endConversation).toHaveBeenCalledWith('conv_abc');
    });

    it('returns false without throwing when the hangup fails', async () => {
      // Already-ended calls are routine: reports rather than throws.
      mockCallUpdate.mockRejectedValue(new Error('Twilio 400'));

      await expect(channel.endCall('CA1')).resolves.toBe(false);
    });

    it('cleans up the session even when the hangup fails', async () => {
      startSession('conv_abc', 'CA1');
      const endConversation = vi
        .spyOn(
          channel as unknown as { endConversation: (id: ConversationId) => Promise<void> },
          'endConversation'
        )
        .mockResolvedValue(undefined);
      mockCallUpdate.mockRejectedValue(new Error('Twilio 400'));

      await expect(channel.endCall('CA1')).resolves.toBe(false);

      expect(endConversation).toHaveBeenCalledWith('conv_abc');
    });

    it('hangs up without a tracked session', async () => {
      // A machine may never prompt (no session); the hangup must still work.
      const endConversation = vi
        .spyOn(
          channel as unknown as { endConversation: (id: ConversationId) => Promise<void> },
          'endConversation'
        )
        .mockResolvedValue(undefined);

      await expect(channel.endCall('CA_unknown')).resolves.toBe(true);

      expect(mockCallUpdate).toHaveBeenCalledWith({ status: 'completed' });
      expect(endConversation).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getConversationSessionByCallSid
  // ===========================================================================

  describe('getConversationSessionByCallSid()', () => {
    it('resolves an orchestrator-mode session', () => {
      // conversationId is the Orchestrator id, so the CallSid needs a lookup.
      const session = startSession('conv_abc', 'CA1');

      const found = channel.getConversationSessionByCallSid('CA1');

      expect(found).toBe(session);
      expect(found!.conversationId).toBe('conv_abc');
    });

    it('resolves a relay-only session', () => {
      // conversationId === callSid here, but the lookup shouldn't assume it.
      const session = startSession('CA1', 'CA1');

      expect(channel.getConversationSessionByCallSid('CA1')).toBe(session);
    });

    it('returns undefined for an unknown CallSid', () => {
      startSession('conv_abc', 'CA1');

      expect(channel.getConversationSessionByCallSid('CA_other')).toBeUndefined();
    });

    it('ignores sessions with no CallSid', () => {
      // Messaging sessions leave callSid unset — must not match on undefined.
      startSession('conv_no_sid');

      expect(channel.getConversationSessionByCallSid('CA1')).toBeUndefined();
    });

    it('picks the matching session among several', () => {
      for (const [conversationId, callSid] of [
        ['c1', 'CA1'],
        ['c2', 'CA2'],
        ['c3', 'CA3'],
      ]) {
        startSession(conversationId!, callSid);
      }

      const found = channel.getConversationSessionByCallSid('CA2');

      expect(found?.conversationId).toBe('c2');
    });

    it('returns undefined before the first prompt', () => {
      // Sessions start on the first prompt, so a connected-but-silent call has
      // none. This is what an onAmd handler sees under machineDetection:
      // 'Enable' — AMD resolves before the callee has said anything.
      expect(channel.getConversationSessionByCallSid('CA1')).toBeUndefined();
    });

    it('reaches the live session mid-conversation from a handler', async () => {
      const session = startSession('conv_abc', 'CA1');
      const sendResponse = vi.spyOn(channel, 'sendResponse').mockResolvedValue(undefined);

      channel.onAmd(async event => {
        const found = channel.getConversationSessionByCallSid(event.callSid);
        expect(found).toBeDefined();
        found!.metadata.reachedVoicemail = true;
        await channel.sendResponse(found!.conversationId as ConversationId, "We'll try again.");
      });

      await channel.handleAmdEvent({ CallSid: 'CA1', AnsweredBy: 'machine_start' });

      expect(session.metadata.reachedVoicemail).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith('conv_abc', "We'll try again.");
    });
  });
});
