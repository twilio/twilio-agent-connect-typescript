import { createRequire } from 'node:module';
import axios, { type AxiosAdapter } from 'axios';
import { afterEach } from 'vitest';

// Keep telemetry off for the whole suite so tests never construct a real
// Segment client or send fixture events. Tests that exercise the analytics
// module clear this and mock the client themselves.
process.env.TAC_ANALYTICS_DISABLED = 'true';

// Fail any HTTP request a test didn't mock. Rejecting alone isn't enough: TAC
// catches many request failures and falls back (e.g. the profile lookup), so
// a leaked request would still pass. Recording it and failing in afterEach
// makes the leak visible. Per-test mocks (axios-mock-adapter, vi.spyOn) replace
// this adapter or skip it, so they're unaffected. The rejection is a plain
// Error with no `config`, so axios-retry doesn't retry it.
const unmockedRequests: string[] = [];

const blockingAdapter: AxiosAdapter = config => {
  const url = axios.getUri(config);
  unmockedRequests.push(`${(config.method ?? 'get').toUpperCase()} ${url}`);
  return Promise.reject(new Error(`Unmocked HTTP request in test: ${url}`));
};

axios.defaults.adapter = blockingAdapter;
// twilio-node loads the CommonJS build, which has its own defaults object.
(createRequire(import.meta.url)('axios') as typeof axios).defaults.adapter = blockingAdapter;

afterEach(() => {
  if (unmockedRequests.length === 0) return;
  const leaked = unmockedRequests.splice(0);
  throw new Error(
    `Test made ${leaked.length} unmocked HTTP request(s); mock them:\n  ${leaked.join('\n  ')}`
  );
});
