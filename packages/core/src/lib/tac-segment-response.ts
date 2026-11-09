import { SegmentEvent } from '../types/segment';

/** Options controlling how Segment events are rendered into a prompt section. */
export interface SegmentPromptOptions {
  /** Maximum number of activity lines (default 10). */
  maxLines?: number;
  /** Event properties to show. Omit to show up to 5 scalar properties per event. */
  propertyAllowlist?: string[];
  /** Reference time for relative timestamps; defaults to `new Date()`. */
  now?: Date;
}

const DEFAULT_MAX_LINES = 10;
const MAX_PROPERTIES = 5;
const MAX_VALUE_LENGTH = 60;

interface ActivityGroup {
  label: string;
  count: number;
  latest: SegmentEvent;
}

/**
 * Wrapper for Segment events retrieved by `TAC.retrieveSegmentEvents()`.
 *
 * Turns a raw event history into a compact "Recent Customer Activity" prompt section:
 * repeated events are collapsed into counts and only the most recent activity is kept.
 */
export class TACSegmentResponse {
  /** Events newest first, as returned by the Segment Profile API client. */
  public readonly events: readonly SegmentEvent[];

  constructor(events: SegmentEvent[]) {
    this.events = events;
  }

  public get isEmpty(): boolean {
    return this.events.length === 0;
  }

  /**
   * Build the "Recent Customer Activity" markdown section.
   * Returns an empty string when there is nothing to report.
   */
  public buildPrompt(options: SegmentPromptOptions = {}): string {
    const groups = this.groupEvents();
    if (groups.length === 0) {
      return '';
    }

    const now = options.now ?? new Date();
    const allowlist = options.propertyAllowlist ? new Set(options.propertyAllowlist) : undefined;
    const lines = groups.slice(0, options.maxLines ?? DEFAULT_MAX_LINES).map(group => {
      const count = group.count > 1 ? ` ×${group.count}` : '';
      const when = formatAgo(group.latest.timestamp, now);
      const props = formatProperties(group.latest, allowlist);
      return `- ${group.label}${count} — ${when}${props ? ` (${props})` : ''}`;
    });

    return ['## Recent Customer Activity', ...lines].join('\n');
  }

  /**
   * Collapse events by label, ordered by most recent occurrence. `identify` calls carry traits,
   * not activity, so they are skipped.
   */
  private groupEvents(): ActivityGroup[] {
    const groups = new Map<string, ActivityGroup>();
    for (const event of this.events) {
      if (event.type === 'identify') continue;
      const label = eventLabel(event);
      const existing = groups.get(label);
      if (existing) {
        existing.count++;
      } else {
        groups.set(label, { label, count: 1, latest: event });
      }
    }
    return [...groups.values()];
  }
}

/**
 * The Profile API returns page/screen calls as `track` events named "Page Viewed" /
 * "Screen Viewed"; raw `page`/`screen` types are handled too.
 */
function viewKind(event: SegmentEvent): 'page' | 'screen' | undefined {
  if (event.type === 'page' || event.event === 'Page Viewed') return 'page';
  if (event.type === 'screen' || event.event === 'Screen Viewed') return 'screen';
  return undefined;
}

function eventLabel(event: SegmentEvent): string {
  const kind = viewKind(event);
  if (kind) {
    const props = event.properties ?? {};
    const target = [props.path, props.page_name, props.name, props.title, props.url].find(
      (v): v is string => typeof v === 'string' && v.length > 0
    );
    return target ? `Viewed ${kind} ${target}` : `Viewed ${kind}`;
  }
  return event.event ?? event.type ?? 'Unknown event';
}

/** Keys already shown in a page/screen label, so they are not repeated as properties. */
const LABEL_KEYS = new Set(['path', 'page_name', 'name', 'title', 'url']);

function formatProperties(event: SegmentEvent, allowlist: Set<string> | undefined): string {
  if (!event.properties) return '';
  const isView = viewKind(event) !== undefined;
  return Object.entries(event.properties)
    .filter(([key]) => !(isView && LABEL_KEYS.has(key)))
    .filter(([key]) => !allowlist || allowlist.has(key))
    .filter(([, value]) => isScalar(value))
    .slice(0, MAX_PROPERTIES)
    .map(([key, value]) => `${key}: ${truncate(String(value))}`)
    .join(', ');
}

function isScalar(value: unknown): value is string | number | boolean {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function truncate(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…` : value;
}

function formatAgo(timestamp: string, now: Date): string {
  const elapsedMs = now.getTime() - Date.parse(timestamp);
  if (Number.isNaN(elapsedMs)) return 'unknown time';
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
