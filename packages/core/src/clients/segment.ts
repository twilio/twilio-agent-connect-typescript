import axios from 'axios';
import {
  DEFAULT_EXCLUDED_SEGMENT_EVENTS,
  SegmentEvent,
  SegmentEventsOptions,
  SegmentEventsResponse,
  SegmentEventsResponseSchema,
  SegmentIdentity,
} from '../types';
import { TACConfig } from '../lib/config';
import { Logger } from '../lib/logger';
import { BaseClient } from './base';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const PAGE_SIZE = 100;
/** Upper bound on pages fetched per call, so heavy filtering cannot loop through a whole history. */
const MAX_PAGES = 5;

/**
 * Segment client for reading a customer's event history from the Profile API.
 *
 * Authenticates with the Segment Profile API token (Basic Auth, token as username)
 * instead of Twilio API credentials.
 */
export class SegmentClient extends BaseClient {
  private readonly spaceId: string;
  private readonly defaultIdentifierType: string;

  constructor(config: TACConfig, logger?: Logger) {
    if (!SegmentClient.isConfigured(config)) {
      throw new Error(
        'SegmentClient requires segmentSpaceId and segmentProfileApiToken to be configured'
      );
    }
    const baseUrl =
      config.segmentRegion === 'eu'
        ? 'https://profiles.euw1.segment.com'
        : 'https://profiles.segment.com';
    const authHeader =
      'Basic ' + Buffer.from(`${config.segmentProfileApiToken}:`).toString('base64');
    super(baseUrl, config, logger, authHeader);
    this.spaceId = config.segmentSpaceId;
    this.defaultIdentifierType = config.segmentIdentifierType;
  }

  /**
   * Whether the config carries everything needed to talk to the Segment Profile API.
   */
  public static isConfigured(
    config: TACConfig
  ): config is TACConfig & { segmentSpaceId: string; segmentProfileApiToken: string } {
    return Boolean(config.segmentSpaceId && config.segmentProfileApiToken);
  }

  /**
   * Fetch recent events for a customer, newest first.
   *
   * @param identity - Segment identity, or a bare value (e.g. a phone number) that is
   *   combined with the configured `segmentIdentifierType`
   * @param options - Limit and filters; filters are applied client-side because the
   *   Profile API has no server-side event filtering. Engage `Audience Entered/Exited`
   *   events are excluded unless `excludeEventNames` says otherwise.
   * @returns Matching events, newest first. Empty when the profile does not exist in Segment.
   */
  public async getProfileEvents(
    identity: SegmentIdentity | string,
    options: SegmentEventsOptions = {}
  ): Promise<SegmentEvent[]> {
    const { type, value } =
      typeof identity === 'string'
        ? { type: this.defaultIdentifierType, value: identity }
        : identity;
    if (!value) {
      throw new Error('Failed to get Segment events: identity value is required');
    }

    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const sinceMs = options.since ? Date.parse(options.since) : undefined;
    if (sinceMs !== undefined && Number.isNaN(sinceMs)) {
      throw new Error(`Failed to get Segment events: invalid 'since' date "${options.since}"`);
    }
    const names = options.eventNames?.length
      ? new Set(options.eventNames.map(n => n.toLowerCase()))
      : undefined;

    const excluded = new Set(
      (options.excludeEventNames ?? DEFAULT_EXCLUDED_SEGMENT_EVENTS).map(n => n.toLowerCase())
    );

    const externalId = `${type}:${encodeURIComponent(value)}`;
    const url = `/v1/spaces/${encodeURIComponent(this.spaceId)}/collections/users/profiles/${externalId}/events`;

    const results: SegmentEvent[] = [];
    let next: string | undefined;

    try {
      for (let page = 0; page < MAX_PAGES && results.length < limit; page++) {
        const params: Record<string, string> = { limit: String(PAGE_SIZE) };
        if (next) params.next = next;

        const raw = await this.makeRequest<SegmentEventsResponse>(url, 'GET', undefined, params);
        const body = SegmentEventsResponseSchema.parse(raw);

        for (const event of body.data) {
          if (sinceMs !== undefined && Date.parse(event.timestamp) < sinceMs) continue;
          const name = SegmentClient.eventName(event).toLowerCase();
          if (names && !names.has(name)) continue;
          if (!names && excluded.has(name)) continue;
          results.push(event);
        }

        if (!body.cursor?.has_more || !body.cursor.next) break;
        next = body.cursor.next;
      }
    } catch (error) {
      // Unknown profile is a normal state for new customers, not a failure
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
      throw new Error(
        `Failed to get Segment events: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }

    results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return results.slice(0, limit);
  }

  /**
   * Human-readable event name: the track event name, or the call type for page/screen/identify.
   */
  public static eventName(event: SegmentEvent): string {
    return event.event ?? event.type ?? 'unknown';
  }
}
