import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { SegmentClient, TACConfig } from '@twilio/tac-core';
import { makeEvent, segmentTestConfig } from './helpers/segment';

const EVENTS_URL = '/v1/spaces/spa_test123/collections/users/profiles/phone:%2B15551234567/events';

describe('SegmentClient', () => {
  let client: SegmentClient;
  let mock: MockAdapter;

  const build = (overrides: Record<string, unknown> = {}): SegmentClient =>
    new SegmentClient(new TACConfig({ ...segmentTestConfig(), ...overrides }));

  beforeEach(() => {
    client = build();
    mock = new MockAdapter((client as any).axiosInstance);
  });

  afterEach(() => {
    mock.restore();
  });

  describe('construction', () => {
    it('should report whether config is sufficient via isConfigured()', () => {
      expect(SegmentClient.isConfigured(new TACConfig(segmentTestConfig()))).toBe(true);
      expect(
        SegmentClient.isConfigured(
          new TACConfig({ ...segmentTestConfig(), segmentProfileApiToken: undefined })
        )
      ).toBe(false);
      expect(
        SegmentClient.isConfigured(
          new TACConfig({ ...segmentTestConfig(), segmentSpaceId: undefined })
        )
      ).toBe(false);
    });

    it('should throw when space ID or token is missing', () => {
      const config = new TACConfig({ ...segmentTestConfig(), segmentSpaceId: undefined });
      expect(() => new SegmentClient(config)).toThrow(/segmentSpaceId and segmentProfileApiToken/);
    });

    it('should use the US Profile API host by default', () => {
      expect((client as any).baseUrl).toBe('https://profiles.segment.com');
    });

    it('should use the EU Profile API host when region is eu', () => {
      expect((build({ segmentRegion: 'eu' }) as any).baseUrl).toBe(
        'https://profiles.euw1.segment.com'
      );
    });

    it('should authenticate with the Profile API token, not Twilio credentials', async () => {
      mock.onGet(EVENTS_URL).reply(200, { data: [] });

      await client.getProfileEvents({ type: 'phone', value: '+15551234567' });

      const expected = 'Basic ' + Buffer.from('profile_api_token:').toString('base64');
      expect(mock.history.get[0]?.headers?.Authorization).toBe(expected);
    });
  });

  describe('getProfileEvents()', () => {
    it('should build the URL from identity type and URL-encoded value', async () => {
      mock.onGet(EVENTS_URL).reply(200, { data: [] });

      const result = await client.getProfileEvents({ type: 'phone', value: '+15551234567' });

      expect(result).toEqual([]);
      expect(mock.history.get).toHaveLength(1);
    });

    it('should use the configured identifier type for bare string identities', async () => {
      const emailClient = build({ segmentIdentifierType: 'email' });
      const emailMock = new MockAdapter((emailClient as any).axiosInstance);
      emailMock
        .onGet('/v1/spaces/spa_test123/collections/users/profiles/email:a%40b.com/events')
        .reply(200, {
          data: [makeEvent({ event: 'Signed Up', timestamp: '2026-11-01T00:00:00Z' })],
        });

      const result = await emailClient.getProfileEvents('a@b.com');

      expect(result).toHaveLength(1);
      emailMock.restore();
    });

    it('should return events newest first', async () => {
      mock.onGet(EVENTS_URL).reply(200, {
        data: [
          makeEvent({ event: 'old', timestamp: '2026-11-01T00:00:00Z' }),
          makeEvent({ event: 'new', timestamp: '2026-11-08T00:00:00Z' }),
          makeEvent({ event: 'mid', timestamp: '2026-11-05T00:00:00Z' }),
        ],
      });

      const result = await client.getProfileEvents('+15551234567');

      expect(result.map(e => e.event)).toEqual(['new', 'mid', 'old']);
    });

    it('should respect the limit', async () => {
      mock.onGet(EVENTS_URL).reply(200, {
        data: [
          makeEvent({ event: 'a', timestamp: '2026-11-03T00:00:00Z' }),
          makeEvent({ event: 'b', timestamp: '2026-11-02T00:00:00Z' }),
          makeEvent({ event: 'c', timestamp: '2026-11-01T00:00:00Z' }),
        ],
      });

      const result = await client.getProfileEvents('+15551234567', { limit: 2 });

      expect(result.map(e => e.event)).toEqual(['a', 'b']);
    });

    it('should filter by event name case-insensitively, matching page/screen by type', async () => {
      mock.onGet(EVENTS_URL).reply(200, {
        data: [
          makeEvent({ event: 'Application Submitted', timestamp: '2026-11-03T00:00:00Z' }),
          makeEvent({ type: 'page', timestamp: '2026-11-02T00:00:00Z' }),
          makeEvent({ event: 'Product Viewed', timestamp: '2026-11-01T00:00:00Z' }),
        ],
      });

      const result = await client.getProfileEvents('+15551234567', {
        eventNames: ['application submitted', 'PAGE'],
      });

      expect(result).toHaveLength(2);
      expect(result.map(e => SegmentClient.eventName(e))).toEqual([
        'Application Submitted',
        'page',
      ]);
    });

    describe('excluded system events', () => {
      const data = [
        makeEvent({ event: 'Audience Entered', timestamp: '2026-11-09T11:00:00Z' }),
        makeEvent({ event: 'audience exited', timestamp: '2026-11-09T10:00:00Z' }),
        makeEvent({ event: 'Application Submitted', timestamp: '2026-11-09T09:00:00Z' }),
      ];

      it('should drop Engage Audience Entered/Exited events by default', async () => {
        mock.onGet(EVENTS_URL).reply(200, { data });

        const result = await client.getProfileEvents('+15551234567');

        expect(result.map(e => e.event)).toEqual(['Application Submitted']);
      });

      it('should keep everything when excludeEventNames is empty', async () => {
        mock.onGet(EVENTS_URL).reply(200, { data });

        const result = await client.getProfileEvents('+15551234567', { excludeEventNames: [] });

        expect(result).toHaveLength(3);
      });

      it('should support a custom exclusion list that replaces the default', async () => {
        mock.onGet(EVENTS_URL).reply(200, { data });

        const result = await client.getProfileEvents('+15551234567', {
          excludeEventNames: ['Application Submitted'],
        });

        expect(result.map(e => e.event)).toEqual(['Audience Entered', 'audience exited']);
      });

      it('should return an excluded event when it is requested explicitly', async () => {
        mock.onGet(EVENTS_URL).reply(200, { data });

        const result = await client.getProfileEvents('+15551234567', {
          eventNames: ['Audience Entered'],
        });

        expect(result.map(e => e.event)).toEqual(['Audience Entered']);
      });

      it('should not count excluded events toward the page limit', async () => {
        mock.onGet(EVENTS_URL).reply(200, { data });

        const result = await client.getProfileEvents('+15551234567', { limit: 1 });

        expect(result.map(e => e.event)).toEqual(['Application Submitted']);
      });
    });

    it('should filter by since', async () => {
      mock.onGet(EVENTS_URL).reply(200, {
        data: [
          makeEvent({ event: 'recent', timestamp: '2026-11-08T00:00:00Z' }),
          makeEvent({ event: 'stale', timestamp: '2026-10-01T00:00:00Z' }),
        ],
      });

      const result = await client.getProfileEvents('+15551234567', {
        since: '2026-11-01T00:00:00Z',
      });

      expect(result.map(e => e.event)).toEqual(['recent']);
    });

    it('should reject an invalid since date', async () => {
      await expect(
        client.getProfileEvents('+15551234567', { since: 'not-a-date' })
      ).rejects.toThrow(/invalid 'since' date/);
    });

    it('should reject an empty identity value', async () => {
      await expect(client.getProfileEvents({ type: 'phone', value: '' })).rejects.toThrow(
        /identity value is required/
      );
    });

    it('should follow cursor.next across pages', async () => {
      mock
        .onGet(EVENTS_URL)
        .replyOnce(200, {
          data: [makeEvent({ event: 'p1', timestamp: '2026-11-03T00:00:00Z' })],
          cursor: { has_more: true, next: 'cursor-2' },
        })
        .onGet(EVENTS_URL)
        .replyOnce(200, {
          data: [makeEvent({ event: 'p2', timestamp: '2026-11-02T00:00:00Z' })],
          cursor: { has_more: false },
        });

      const result = await client.getProfileEvents('+15551234567');

      expect(result.map(e => e.event)).toEqual(['p1', 'p2']);
      expect(mock.history.get).toHaveLength(2);
      expect(mock.history.get[0]?.params).toEqual({ limit: '100' });
      expect(mock.history.get[1]?.params).toEqual({ limit: '100', next: 'cursor-2' });
    });

    it('should stop paging once the limit is satisfied', async () => {
      mock.onGet(EVENTS_URL).reply(200, {
        data: [
          makeEvent({ event: 'a', timestamp: '2026-11-03T00:00:00Z' }),
          makeEvent({ event: 'b', timestamp: '2026-11-02T00:00:00Z' }),
        ],
        cursor: { has_more: true, next: 'more' },
      });

      await client.getProfileEvents('+15551234567', { limit: 2 });

      expect(mock.history.get).toHaveLength(1);
    });

    it('should cap paging at 5 pages when filters match nothing', async () => {
      mock.onGet(EVENTS_URL).reply(200, {
        data: [makeEvent({ event: 'noise', timestamp: '2026-11-03T00:00:00Z' })],
        cursor: { has_more: true, next: 'more' },
      });

      const result = await client.getProfileEvents('+15551234567', { eventNames: ['wanted'] });

      expect(result).toEqual([]);
      expect(mock.history.get).toHaveLength(5);
    });

    it('should return an empty list when the profile does not exist (404)', async () => {
      mock.onGet(EVENTS_URL).reply(404, { error: 'not found' });

      await expect(client.getProfileEvents('+15551234567')).resolves.toEqual([]);
    });

    it('should wrap other HTTP errors', async () => {
      mock.onGet(EVENTS_URL).reply(401, { error: 'unauthorized' });

      await expect(client.getProfileEvents('+15551234567')).rejects.toThrow(
        /Failed to get Segment events/
      );
    });

    it('should wrap response validation errors', async () => {
      mock.onGet(EVENTS_URL).reply(200, { data: [{ event: 'missing timestamp' }] });

      await expect(client.getProfileEvents('+15551234567')).rejects.toThrow(
        /Failed to get Segment events/
      );
    });

    it('should keep unknown event fields', async () => {
      mock.onGet(EVENTS_URL).reply(200, {
        data: [
          {
            type: 'track',
            event: 'X',
            timestamp: '2026-11-03T00:00:00Z',
            context: { ip: '1.2.3.4' },
          },
        ],
      });

      const [event] = await client.getProfileEvents('+15551234567');

      expect(event?.context).toEqual({ ip: '1.2.3.4' });
    });
  });

  describe('eventName()', () => {
    it('should prefer the track event name, then type, then "unknown"', () => {
      expect(SegmentClient.eventName(makeEvent({ event: 'Bought', timestamp: 't' }))).toBe(
        'Bought'
      );
      expect(SegmentClient.eventName(makeEvent({ type: 'page', timestamp: 't' }))).toBe('page');
      expect(SegmentClient.eventName({ timestamp: 't' } as any)).toBe('unknown');
    });
  });
});
