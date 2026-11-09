import { SegmentEvent } from '@twilio/tac-core';

export const segmentTestConfig = () => ({
  accountSid: 'ACtest123456789',
  authToken: 'test_token_123',
  apiKey: 'test_api_key',
  apiSecret: 'test_api_token',
  phoneNumber: '+15551234567',
  segmentSpaceId: 'spa_test123',
  segmentProfileApiToken: 'profile_api_token',
});

export const NOW = new Date('2026-11-09T12:00:00Z');

export function makeEvent(overrides: Partial<SegmentEvent> & { timestamp: string }): SegmentEvent {
  return { type: 'track', ...overrides } as SegmentEvent;
}
