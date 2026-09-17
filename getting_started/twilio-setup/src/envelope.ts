/**
 * The response envelope shared by every wizard endpoint.
 *
 * The frontend branches solely on `status` and never checks the HTTP status code, so even
 * validation failures are returned with HTTP 200. Extra diagnostic keys (`endpoint`,
 * `payload`, `response`, `status_code`) are rendered by the wizard's error panel, so they
 * are passed through untouched — which is also why no Fastify response schema is declared
 * for these routes: fast-json-stringify would silently strip the keys it was not told
 * about.
 */

export type WizardStatus = 'success' | 'error' | 'pending' | 'accepted' | 'completed';

export interface WizardResponse {
  status: WizardStatus;
  [key: string]: unknown;
}

export function errorResponse(message: string, extra?: Record<string, unknown>): WizardResponse {
  return { status: 'error', message, ...extra };
}

export const TIMED_OUT = 'Request timed out. Please try again.';
