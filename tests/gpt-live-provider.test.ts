import { describe, it, expect } from 'vitest';
import { CallState } from '../packages/core/src/channels/voice/media-streams/gpt-live/state';
import { InitiateVoiceConversationOptionsGPTLiveSchema } from '@twilio/tac-core';

describe('GPT-Live call state', () => {
  it('resolves its closed promise only once markClosed is called', async () => {
    const state = new CallState();
    let settled = false;
    void state.closed.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    state.markClosed();
    await state.closed;
    expect(settled).toBe(true);
  });

  it('inherits the shared socket handles', () => {
    const state = new CallState();
    expect(state.twilioWs).toBeNull();
    expect(state.modelWs).toBeNull();
  });
});

describe('InitiateVoiceConversationOptionsGPTLive', () => {
  it('carries a per-call sessionConfig alongside the base outbound fields', () => {
    const parsed = InitiateVoiceConversationOptionsGPTLiveSchema.parse({
      to: '+15551234567',
      sessionConfig: { model: 'gpt-live-1' },
    });
    expect(parsed.sessionConfig).toEqual({ model: 'gpt-live-1' });
  });

  it('leaves sessionConfig absent when it is not supplied', () => {
    const parsed = InitiateVoiceConversationOptionsGPTLiveSchema.parse({ to: '+15551234567' });
    expect(parsed.sessionConfig).toBeUndefined();
  });
});
