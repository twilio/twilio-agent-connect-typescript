import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockTrack = vi.fn();
const mockCloseAndFlush = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();

vi.mock('@segment/analytics-node', () => ({
  Analytics: class MockAnalytics {
    track = mockTrack;
    closeAndFlush = mockCloseAndFlush;
    on = mockOn;
  },
}));

import { trackEvent, shutdownAnalytics, _resetAnalytics } from '../packages/core/src/lib/analytics';

describe('analytics', () => {
  beforeEach(() => {
    _resetAnalytics();
    mockTrack.mockClear();
    mockCloseAndFlush.mockClear();
    mockOn.mockClear();
    delete process.env.TAC_ANALYTICS_DISABLED;
  });

  afterEach(() => {
    delete process.env.TAC_ANALYTICS_DISABLED;
  });

  it('tracks an event with correct shape', () => {
    trackEvent('Websocket Connected', {
      account_sid: 'AC123',
      channel: 'voice',
      conversation_id: 'conv-1',
    });

    expect(mockTrack).toHaveBeenCalledWith({
      anonymousId: 'AC123',
      event: 'Websocket Connected',
      properties: {
        account_sid: 'AC123',
        channel: 'voice',
        conversation_id: 'conv-1',
        sdk_version: expect.any(String),
        sdk_package: 'twilio-agent-connect-typescript',
      },
    });
  });

  it('uses account_sid as anonymousId', () => {
    trackEvent('Conversation Started', {
      account_sid: 'AC456',
      channel: 'sms',
      conversation_id: 'conv-2',
    });

    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({ anonymousId: 'AC456' })
    );
  });

  it('does not track when TAC_ANALYTICS_DISABLED=true', () => {
    process.env.TAC_ANALYTICS_DISABLED = 'true';
    _resetAnalytics();

    trackEvent('Websocket Connected', {
      account_sid: 'AC123',
      channel: 'voice',
      conversation_id: 'conv-1',
    });

    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('shutdownAnalytics calls closeAndFlush', async () => {
    trackEvent('Websocket Connected', {
      account_sid: 'AC123',
      channel: 'voice',
      conversation_id: 'conv-1',
    });

    await shutdownAnalytics();

    expect(mockCloseAndFlush).toHaveBeenCalledWith({ timeout: 5000 });
  });

  it('shutdownAnalytics is a no-op when no client exists', async () => {
    await shutdownAnalytics();
    expect(mockCloseAndFlush).not.toHaveBeenCalled();
  });

  it('does not throw when track throws', () => {
    mockTrack.mockImplementationOnce(() => {
      throw new Error('network error');
    });

    expect(() =>
      trackEvent('Websocket Connected', {
        account_sid: 'AC123',
        channel: 'voice',
        conversation_id: 'conv-1',
      })
    ).not.toThrow();
  });

  it('requires account_sid in properties at compile time', () => {
    trackEvent('Conversation Started', {
      account_sid: 'AC789',
      channel: 'sms',
      conversation_id: 'conv-3',
    });

    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ account_sid: 'AC789' }),
      })
    );
  });
});
