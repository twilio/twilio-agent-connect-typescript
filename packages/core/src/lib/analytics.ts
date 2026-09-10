import { Analytics } from '@segment/analytics-node';
import packageJson from '../../../../package.json' with { type: 'json' };
import { createLogger, Logger } from './logger';

// The npm package name is unsuffixed, so it can't identify which Agent Connect
// SDK sent an event.
const SDK_PACKAGE = 'twilio-agent-connect-typescript';

let client: Analytics | null = null;
let log: Logger | null = null;
let disabled: boolean | null = null;

function getLog(): Logger {
  return (log ??= createLogger({ name: 'analytics' }));
}

function isDisabled(): boolean {
  if (disabled === null) {
    disabled = process.env.TAC_ANALYTICS_DISABLED === 'true';
  }
  return disabled;
}

function getClient(): Analytics | null {
  if (isDisabled()) return null;
  if (client) return client;
  client = new Analytics({
    writeKey: 'oH5gLNxB4NEg60y81mBxHWZn4RAoXQTN',
    flushAt: 20,
    flushInterval: 10_000,
  });
  client.on('error', err => {
    getLog().warn({ err }, 'Segment analytics error');
  });
  return client;
}

type EventProperties = { account_sid: string } & Record<string, unknown>;

/**
 * Record a telemetry event. Never throws.
 *
 * @internal
 */
export function trackEvent(event: string, properties: EventProperties): void {
  try {
    const analytics = getClient();
    if (!analytics) return;
    analytics.track({
      anonymousId: properties.account_sid,
      event,
      properties: {
        ...properties,
        sdk_version: packageJson.version,
        sdk_package: SDK_PACKAGE,
      },
    });
    getLog().debug({ event }, 'Analytics event tracked');
  } catch (err) {
    getLog().warn({ err, event }, 'Analytics event failed');
  }
}

/**
 * Flush pending events and close the client. Called by `TAC.shutdown()`.
 *
 * @internal
 */
export async function shutdownAnalytics(): Promise<void> {
  if (client) {
    await client.closeAndFlush({ timeout: 5000 }).catch(() => {});
    client = null;
  }
}

/** Reset internal state — for testing only. */
export function _resetAnalytics(): void {
  client = null;
  disabled = null;
  log = null;
}
