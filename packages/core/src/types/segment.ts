import { z } from 'zod';

/**
 * A single event from the Segment Profile API (`/collections/users/profiles/{id}/events`).
 *
 * Only the fields the SDK relies on are required; the Profile API returns more
 * (context, message_id, external_ids, ...) which pass through untouched.
 */
export const SegmentEventSchema = z.looseObject({
  type: z.string().optional(),
  event: z.string().optional(),
  timestamp: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
  message_id: z.string().optional(),
});

export type SegmentEvent = z.infer<typeof SegmentEventSchema>;

/**
 * Profile API events response. `cursor.next` is passed back as the `next` query
 * parameter to fetch the following page.
 */
export const SegmentEventsResponseSchema = z.object({
  data: z.array(SegmentEventSchema),
  cursor: z
    .object({
      has_more: z.boolean().optional(),
      next: z.string().nullish(),
    })
    .nullish(),
});

export type SegmentEventsResponse = z.infer<typeof SegmentEventsResponseSchema>;

/**
 * Options for fetching a customer's Segment events.
 */
export interface SegmentEventsOptions {
  /** Maximum number of events to return after filtering (default 25, max 100). */
  limit?: number;
  /** Only return events at or after this time (ISO 8601). */
  since?: string;
  /** Only return events whose name matches one of these (case-insensitive). */
  eventNames?: string[];
  /**
   * Event names to drop (case-insensitive). Defaults to `DEFAULT_EXCLUDED_SEGMENT_EVENTS`;
   * pass `[]` to keep everything. Names listed in `eventNames` are never excluded.
   */
  excludeEventNames?: string[];
}

/**
 * Engage-generated system events that describe audience/journey plumbing rather than
 * something the customer did, so they are excluded from agent context by default.
 */
export const DEFAULT_EXCLUDED_SEGMENT_EVENTS: readonly string[] = [
  'Audience Entered',
  'Audience Exited',
];

/**
 * Identity used to look a customer up in Segment, e.g. `{ type: 'phone', value: '+15551234567' }`.
 */
export interface SegmentIdentity {
  type: string;
  value: string;
}

/**
 * Segment event retrieval mode for channels (mirrors `MemoryMode`)
 */
export const SegmentModeSchema = z.enum(['always', 'never']);
export type SegmentMode = z.infer<typeof SegmentModeSchema>;
