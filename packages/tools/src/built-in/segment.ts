import {
  BuiltInTools,
  SegmentClient,
  SegmentEvent,
  SegmentEventsOptions,
  SegmentIdentity,
} from '@twilio/tac-core';
import { TACTool, defineTool } from '../lib/builder';

/**
 * Parameters for the customer activity tool (visible to LLM)
 */
interface CustomerActivityParams {
  eventNames?: string[];
  since?: string;
  limit?: number;
}

/**
 * Compact event shape returned to the LLM
 */
export interface CustomerActivityEvent {
  event: string;
  type: string | undefined;
  timestamp: string;
  properties: Record<string, unknown> | undefined;
}

/**
 * Create a tool that lets the LLM look up a customer's Segment event history
 * (page views, applications, purchases, ...).
 *
 * @param segmentClient - Segment client instance
 * @param identity - Customer identity in Segment (`{ type, value }`), or a bare value such as a
 *   phone number that uses the configured `segmentIdentifierType`
 * @param options - Optional overrides
 * @param options.name - Tool name exposed to the LLM. Defaults to `get_customer_activity`.
 * @param options.description - Tool description exposed to the LLM.
 * @param options.propertyAllowlist - Event properties passed to the LLM. Properties not listed
 *   are dropped, which keeps PII and token usage down. Omit to pass all properties.
 */
export function createSegmentActivityTool(
  segmentClient: SegmentClient,
  identity?: SegmentIdentity | string,
  options: { name?: string; description?: string; propertyAllowlist?: string[] } = {}
): TACTool<CustomerActivityParams, CustomerActivityEvent[]> {
  const allowlist = options.propertyAllowlist ? new Set(options.propertyAllowlist) : undefined;

  return defineTool(
    options.name ?? BuiltInTools.GET_CUSTOMER_ACTIVITY,
    options.description ??
      "Look up the customer's recent activity tracked in Segment, such as page views, " +
        'applications and purchases. Returns events newest first.',
    {
      type: 'object',
      properties: {
        eventNames: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional event names to filter by (e.g. "Application Submitted"). ' +
            'Use "Page Viewed" for page views.',
        },
        since: {
          type: 'string',
          description: 'Optional start of the time window (ISO 8601). Only newer events return.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 10,
          description: 'Maximum number of events to return.',
        },
      },
      required: [],
      description: "Retrieve the current customer's recent Segment events",
    },
    async (params: CustomerActivityParams) => {
      if (!identity) {
        throw new Error('No customer identity available for Segment lookup');
      }

      const request: SegmentEventsOptions = { limit: params.limit ?? 10 };
      if (params.eventNames?.length) request.eventNames = params.eventNames;
      if (params.since) request.since = params.since;

      const events = await segmentClient.getProfileEvents(identity, request);
      return events.map(event => toActivityEvent(event, allowlist));
    }
  );
}

function toActivityEvent(event: SegmentEvent, allowlist?: Set<string>): CustomerActivityEvent {
  let properties = event.properties;
  if (properties && allowlist) {
    properties = Object.fromEntries(Object.entries(properties).filter(([k]) => allowlist.has(k)));
  }
  return {
    event: SegmentClient.eventName(event),
    type: event.type,
    timestamp: event.timestamp,
    properties: properties && Object.keys(properties).length > 0 ? properties : undefined,
  };
}

/**
 * Create factory for Segment tools
 *
 * @param segmentClient - Segment client instance
 */
export function createSegmentTools(segmentClient: SegmentClient): {
  forIdentity: (
    identity: SegmentIdentity | string,
    options?: { name?: string; description?: string; propertyAllowlist?: string[] }
  ) => TACTool<CustomerActivityParams, CustomerActivityEvent[]>;
} {
  return {
    forIdentity: (identity, options) => createSegmentActivityTool(segmentClient, identity, options),
  };
}
