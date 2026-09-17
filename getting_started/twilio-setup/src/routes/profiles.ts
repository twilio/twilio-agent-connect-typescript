/**
 * Profile routes: create, verify and phone lookup.
 *
 * The wizard creates one test Profile from the operator's own contact details so the
 * setup can be proven end to end — created, readable by id, and resolvable by phone
 * number.
 *
 * Note these endpoints live under `/v1/Stores`, with no `/ControlPlane` segment.
 */

import type { FastifyInstance } from 'fastify';
import { TIMED_OUT, errorResponse, type WizardResponse } from '../envelope';
import {
  MEMORY_STORES_BASE,
  asRecord,
  isTimeout,
  readString,
  readStringArray,
  twilioRequest,
} from '../twilio-api';
import { errorMessage, readField, requireFields } from '../validation';

export function profileRoutes(app: FastifyInstance): void {
  app.post('/api/create-profile', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, [
      'memory_store_id',
      'api_key',
      'api_secret',
      'email',
      'phone',
    ]);
    if (fields === null) {
      return errorResponse(
        'Missing required fields: memory_store_id, api_key, api_secret, email, phone'
      );
    }

    const firstName = readField(request.body, 'first_name');
    const contact: Record<string, string> = { email: fields.email, phone: fields.phone };
    if (firstName) {
      contact.firstName = firstName;
    }
    const payload = { traits: { Contact: contact } };

    const endpoint = `${MEMORY_STORES_BASE}/${fields.memory_store_id}/Profiles`;
    try {
      const result = await twilioRequest({
        method: 'post',
        url: endpoint,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
        body: payload,
      });

      // Unlike the store and configuration creates, a 202 here is reported as success —
      // the frontend verifies the profile separately rather than polling an operation.
      if ([200, 201, 202].includes(result.statusCode)) {
        return {
          status: 'success',
          profile_id: readString(result.json, 'id'),
          message: readString(result.json, 'message') ?? 'Profile created successfully',
        };
      }

      app.log.error(
        { endpoint, payload, status: result.statusCode, response: result.text },
        'Failed to create Profile'
      );
      return errorResponse(`Failed to create Profile: ${result.statusCode} - ${result.text}`, {
        endpoint,
        payload,
        response: result.text,
        status_code: result.statusCode,
      });
    } catch (error) {
      if (isTimeout(error)) {
        app.log.error('Timeout creating Profile');
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error creating Profile');
      return errorResponse(`Error creating Profile: ${errorMessage(error)}`);
    }
  });

  app.post('/api/verify-profile', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, [
      'memory_store_id',
      'profile_id',
      'api_key',
      'api_secret',
    ]);
    if (fields === null) {
      return errorResponse('Missing required fields');
    }

    const endpoint = `${MEMORY_STORES_BASE}/${fields.memory_store_id}/Profiles/${fields.profile_id}`;
    try {
      const result = await twilioRequest({
        method: 'get',
        url: endpoint,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
      });

      if (result.statusCode === 200) {
        const contact = asRecord(asRecord(result.json).traits).Contact;
        const mismatches = [
          traitMismatch('email', readField(request.body, 'email'), readString(contact, 'email')),
          traitMismatch('phone', readField(request.body, 'phone'), readString(contact, 'phone')),
          traitMismatch(
            'firstName',
            readField(request.body, 'first_name'),
            readString(contact, 'firstName')
          ),
        ].filter((entry): entry is string => entry !== null);

        if (mismatches.length > 0) {
          return errorResponse(`Profile traits mismatch: ${mismatches.join(', ')}`);
        }

        return {
          status: 'success',
          message: 'Profile verified successfully',
          traits: contact,
        };
      }

      // Still being indexed — the frontend keeps retrying rather than failing.
      if (result.statusCode === 404) {
        return { status: 'pending', message: 'Profile not found yet, still processing...' };
      }

      app.log.error(
        { endpoint, status: result.statusCode, response: result.text },
        'Failed to verify Profile'
      );
      return errorResponse(`Failed to verify Profile: ${result.statusCode} - ${result.text}`, {
        endpoint,
        response: result.text,
        status_code: result.statusCode,
      });
    } catch (error) {
      if (isTimeout(error)) {
        app.log.error('Timeout verifying Profile');
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error verifying Profile');
      return errorResponse(`Error verifying Profile: ${errorMessage(error)}`);
    }
  });

  app.post('/api/lookup-profile', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, [
      'memory_store_id',
      'profile_id',
      'api_key',
      'api_secret',
      'phone',
    ]);
    if (fields === null) {
      return errorResponse('Missing required fields');
    }

    const payload = { idType: 'phone', value: fields.phone };
    const endpoint = `${MEMORY_STORES_BASE}/${fields.memory_store_id}/Profiles/Lookup`;
    try {
      const result = await twilioRequest({
        method: 'post',
        url: endpoint,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
        body: payload,
      });

      if (result.statusCode === 200) {
        const profiles = readStringArray(result.json, 'profiles');
        if (profiles.includes(fields.profile_id)) {
          return {
            status: 'success',
            message: 'Profile lookup verified successfully',
            normalized_value: readString(result.json, 'normalizedValue'),
            profiles,
          };
        }
        return {
          status: 'pending',
          message: `Profile not yet indexed for lookup. Found profiles: ${formatList(profiles)}`,
        };
      }

      if (result.statusCode === 404) {
        return { status: 'pending', message: 'No profiles found for this phone number yet' };
      }

      app.log.error(
        { endpoint, payload, status: result.statusCode, response: result.text },
        'Failed to lookup Profile'
      );
      return errorResponse(`Failed to lookup Profile: ${result.statusCode} - ${result.text}`, {
        endpoint,
        payload,
        response: result.text,
        status_code: result.statusCode,
      });
    } catch (error) {
      if (isTimeout(error)) {
        app.log.error('Timeout looking up Profile');
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error looking up Profile');
      return errorResponse(`Error looking up Profile: ${errorMessage(error)}`);
    }
  });
}

/** Returns a `field (expected: x, got: y)` fragment, or null when the trait matches. */
function traitMismatch(
  field: string,
  expected: string | undefined,
  actual: string | null
): string | null {
  if (!expected || expected === actual) return null;
  return `${field} (expected: ${expected}, got: ${actual ?? 'None'})`;
}

/** Renders a list the way Python's `str(list)` does, so the message text matches. */
function formatList(values: string[]): string {
  return `[${values.map(value => `'${value}'`).join(', ')}]`;
}
