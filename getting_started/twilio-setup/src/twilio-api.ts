/**
 * Thin HTTP layer for the Twilio control-plane calls the setup wizard makes.
 *
 * This deliberately does not reuse the SDK's `BaseClient`: that class is constructed from
 * a validated `TACConfig` and one fixed base URL, retries via axios-retry, and throws on
 * non-2xx responses. The wizard has only the API key and secret the operator just typed
 * into the browser, hits an arbitrary absolute URL when polling an operation, and needs
 * to branch on the status code rather than catch. Plain axios matches the Python wizard's
 * single-attempt httpx calls exactly.
 *
 * The API key and secret must never be logged.
 */

import axios from 'axios';

export const MEMORY_API_BASE = 'https://memory.twilio.com/v1/ControlPlane';
export const MEMORY_STORES_BASE = 'https://memory.twilio.com/v1/Stores';
export const CONVERSATION_API_BASE = 'https://conversations.twilio.com/v2/ControlPlane';

const DEFAULT_TIMEOUT_MS = 30_000;

export function basicAuthHeader(apiKey: string, apiSecret: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
}

export interface TwilioApiResult {
  statusCode: number;
  /** Raw response body. The wizard echoes this verbatim in its error envelopes. */
  text: string;
  /** Parsed body, or undefined when the body was absent or not JSON. */
  json: unknown;
}

export interface TwilioRequestOptions {
  method: 'get' | 'post' | 'delete';
  url: string;
  apiKey: string;
  apiSecret: string;
  body?: unknown;
  timeoutMs?: number;
}

export async function twilioRequest(options: TwilioRequestOptions): Promise<TwilioApiResult> {
  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(options.apiKey, options.apiSecret),
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await axios.request({
    method: options.method,
    url: options.url,
    headers,
    ...(options.body !== undefined ? { data: options.body } : {}),
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // Branch on the status code instead of catching, the way the Python wizard does.
    validateStatus: () => true,
    // Keep the body as raw text. The frontend runs JSON.parse on the `response` field of
    // an error envelope, so it has to receive a string, not an already-parsed object.
    transformResponse: [(data: unknown): unknown => data],
  });

  const text = typeof response.data === 'string' ? response.data : '';
  return { statusCode: response.status, text, json: safeJsonParse(text) };
}

function safeJsonParse(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function isTimeout(error: unknown): boolean {
  return axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT');
}

/** Narrows an unknown parsed body to something indexable, without using `any`. */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Reads a string field, returning null when absent — matching Python's `.get()`. */
export function readString(value: unknown, key: string): string | null {
  const field = asRecord(value)[key];
  return typeof field === 'string' ? field : null;
}

/** Reads an array field, returning an empty array when absent. */
export function readArray(value: unknown, key: string): unknown[] {
  const field = asRecord(value)[key];
  return Array.isArray(field) ? field : [];
}

/** Reads an array of strings, skipping any non-string entries. */
export function readStringArray(value: unknown, key: string): string[] {
  return readArray(value, key).filter((entry): entry is string => typeof entry === 'string');
}
