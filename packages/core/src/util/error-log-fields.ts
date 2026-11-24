import axios from 'axios';

/**
 * Log fields for a caught error. An HTTP client error is reduced to its message,
 * code and status, since the raw error also holds the request config and socket.
 * Any other value is logged as `err`.
 *
 * @internal
 */
export function errorLogFields(err: unknown): Record<string, unknown> {
  if (!axios.isAxiosError(err)) return { err };
  return { error: err.message, code: err.code, status: err.response?.status };
}
