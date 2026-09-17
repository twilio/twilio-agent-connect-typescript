/**
 * Request validation for the setup wizard.
 *
 * Every failure here is reported as an `{ status: 'error', message }` envelope with an
 * HTTP 200, because the wizard's frontend branches on the `status` field and never
 * inspects the HTTP status code.
 */

/** Hosts the operation-status poller is allowed to reach. */
const ALLOWED_OPERATION_HOSTS = ['memory.twilio.com', 'conversations.twilio.com'];

/** Control-plane path prefixes the operation-status poller is allowed to reach. */
const ALLOWED_OPERATION_PATHS = ['/v1/ControlPlane/Operations/', '/v2/ControlPlane/Operations/'];

/** Reads a body field as a string, treating any non-string (including null) as absent. */
export function readField(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads every named field, returning `null` if any one of them is absent.
 *
 * Absence mirrors Python's `if not all([...])`: a missing key, a JSON `null`, a
 * non-string and `''` all count as absent, but a whitespace-only string counts as
 * present. Pass `trim` for the stricter behavior `poll-operation-status` uses, where
 * whitespace-only is absent and the trimmed values are what get used.
 */
export function requireFields<const K extends readonly string[]>(
  body: unknown,
  keys: K,
  options: { trim?: boolean } = {}
): Record<K[number], string> | null {
  const result = {} as Record<K[number], string>;
  for (const key of keys) {
    const raw = readField(body, key);
    const value = options.trim === true ? raw?.trim() : raw;
    if (!value) return null;
    result[key as K[number]] = value;
  }
  return result;
}

/**
 * Extracts the path component of a URL *without* normalizing it.
 *
 * `new URL()` resolves `..` segments while parsing, so `URL.pathname` cannot be used to
 * detect path traversal — `/v1/ControlPlane/Operations/../Operations/x` would arrive here
 * already collapsed to `/v1/ControlPlane/Operations/x` and pass the prefix allowlist.
 * Python checks the unnormalized `urlparse().path`, so this reproduces that input.
 */
function rawPath(url: string): string {
  const afterScheme = url.indexOf('://');
  const authorityStart = afterScheme === -1 ? 0 : afterScheme + 3;
  const pathStart = url.slice(authorityStart).search(/[/?#]/);
  if (pathStart === -1) return '';
  const fromPath = url.slice(authorityStart + pathStart);
  const end = fromPath.search(/[?#]/);
  return end === -1 ? fromPath : fromPath.slice(0, end);
}

export interface OperationUrlValidation {
  /** The URL to request, reparsed and re-serialized so what we validate is what we send. */
  url?: string;
  /** Present when validation failed; already worded for the wizard's error panel. */
  error?: string;
}

/**
 * Validates a `statusUrl` handed back by a Twilio 202 response before we follow it.
 *
 * Without this gate the endpoint is an open proxy that forwards the caller's Twilio API
 * credentials to any host they name, so each check below is load-bearing.
 */
export function validateOperationStatusUrl(statusUrl: string): OperationUrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(statusUrl);
  } catch (error) {
    return { error: `Invalid status_url format: ${errorMessage(error)}` };
  }

  const scheme = parsed.protocol.replace(/:$/, '');
  if (scheme !== 'https') {
    return { error: `Invalid status_url scheme: ${scheme}. Must be https.` };
  }

  if (!ALLOWED_OPERATION_HOSTS.includes(parsed.hostname)) {
    const hosts = ALLOWED_OPERATION_HOSTS.map(host => `'${host}'`).join(', ');
    return { error: `Invalid status_url host: ${parsed.hostname}. Must be one of [${hosts}].` };
  }

  // `URL.port` is '' both when the port is omitted and when it is the scheme default,
  // so this accepts exactly the same inputs as Python's `port not in (None, 443)`.
  if (parsed.port !== '') {
    return { error: `Invalid status_url port: ${parsed.port}. Must be 443 or omitted.` };
  }

  const unnormalizedPath = rawPath(statusUrl);
  if (unnormalizedPath.includes('..') || unnormalizedPath.toLowerCase().includes('%2e')) {
    return { error: 'Invalid status_url path: Path traversal detected.' };
  }

  // Strip trailing slashes the way posixpath.normpath does, so a bare
  // `/v1/ControlPlane/Operations/` fails the prefix check as it does in Python.
  const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
  if (!ALLOWED_OPERATION_PATHS.some(prefix => normalizedPath.startsWith(prefix))) {
    return {
      error:
        'Invalid status_url path: Must be a ControlPlane Operations endpoint ' +
        '(e.g., /v1/ControlPlane/Operations/... or /v2/ControlPlane/Operations/...)',
    };
  }

  return { url: parsed.href };
}

/** Python's `str(e)` equivalent. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
