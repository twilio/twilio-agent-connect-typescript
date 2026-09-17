/**
 * Memory Store routes: create, poll, get, list, delete and verify.
 *
 * Ported from the Python wizard's `server.py`. Message strings, status-code branches and
 * envelope keys are kept identical so the shared `templates/index.html` works unchanged
 * against either backend.
 */

import type { FastifyInstance } from 'fastify';
import { TIMED_OUT, errorResponse, type WizardResponse } from '../envelope';
import {
  MEMORY_API_BASE,
  asRecord,
  isTimeout,
  readString,
  readStringArray,
  twilioRequest,
} from '../twilio-api';
import { errorMessage, requireFields, validateOperationStatusUrl } from '../validation';

const MEMORY_DESCRIPTION_MAX_LENGTH = 128;
const STORE_LIST_LIMIT = 100;
const STORE_DETAIL_TIMEOUT_MS = 10_000;

const STORE_FIELDS = ['memory_store_id', 'api_key', 'api_secret'] as const;
const STORE_FIELDS_MESSAGE = 'Missing required fields: memory_store_id, api_key, api_secret';

interface MemoryStoreSummary {
  id: string | null;
  displayName: string | null;
  description: string | null;
  status: string | null;
}

export function memoryStoreRoutes(app: FastifyInstance): void {
  app.post('/api/create-memory-store', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, [
      'api_key',
      'api_secret',
      'memory_display_name',
      'memory_description',
    ]);
    if (fields === null) {
      return errorResponse(
        'Missing required fields: api_key, api_secret, memory_display_name, memory_description'
      );
    }

    if (fields.memory_description.length > MEMORY_DESCRIPTION_MAX_LENGTH) {
      return errorResponse('Memory description must not exceed 128 characters');
    }

    const payload: Record<string, unknown> = {
      displayName: fields.memory_display_name,
      description: fields.memory_description,
    };

    const endpoint = `${MEMORY_API_BASE}/Stores`;
    try {
      const result = await twilioRequest({
        method: 'post',
        url: endpoint,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
        body: payload,
      });

      if (result.statusCode === 200 || result.statusCode === 201) {
        const id = readString(result.json, 'id');
        return {
          status: 'success',
          memory_store_id: id,
          memory_store_name: readString(result.json, 'displayName') ?? fields.memory_display_name,
          memory_store_status: readString(result.json, 'status'),
          intelligence_service_id: readString(result.json, 'intelligenceServiceId'),
          message: `Memory Store created: ${id}`,
        };
      }

      if (result.statusCode === 202) {
        const statusUrl = readString(result.json, 'statusUrl');
        app.log.info({ statusUrl }, 'Memory Store creation accepted (async)');
        return {
          status: 'accepted',
          status_url: statusUrl,
          message:
            readString(result.json, 'message') ?? 'Memory Store creation accepted for processing',
        };
      }

      app.log.error(
        { endpoint, payload, status: result.statusCode, response: result.text },
        'Failed to create Memory Store'
      );
      return errorResponse(`Failed to create Memory Store: ${result.statusCode} - ${result.text}`, {
        payload,
        response: result.text,
        status_code: result.statusCode,
      });
    } catch (error) {
      if (isTimeout(error)) {
        app.log.error('Timeout creating Memory Store');
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error creating Memory Store');
      return errorResponse(`Error creating Memory Store: ${errorMessage(error)}`);
    }
  });

  app.post('/api/poll-operation-status', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, ['status_url', 'api_key', 'api_secret'], {
      trim: true,
    });
    if (fields === null) {
      return errorResponse('Missing required fields: status_url, api_key, api_secret');
    }

    const validated = validateOperationStatusUrl(fields.status_url);
    if (validated.url === undefined) {
      return errorResponse(validated.error ?? 'Invalid status_url');
    }

    try {
      const result = await twilioRequest({
        method: 'get',
        url: validated.url,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
      });

      if (result.statusCode === 200) {
        const operationStatus = (readString(result.json, 'status') ?? '').toUpperCase();

        if (operationStatus === 'COMPLETED') {
          return {
            status: 'completed',
            operation_status: operationStatus,
            result: asRecord(result.json).result ?? {},
            message: 'Operation completed successfully',
          };
        }

        if (operationStatus === 'FAILED') {
          return {
            status: 'error',
            operation_status: operationStatus,
            message: `Operation failed: ${readString(result.json, 'error') ?? 'Unknown error'}`,
          };
        }

        // PENDING, IN_PROGRESS, QUEUED and anything unrecognised all keep the frontend
        // polling rather than aborting.
        return {
          status: 'pending',
          operation_status: operationStatus,
          message: `Operation status: ${operationStatus}`,
        };
      }

      app.log.error(
        { endpoint: validated.url, status: result.statusCode, response: result.text },
        'Failed to poll operation status'
      );
      return errorResponse(
        `Failed to poll operation status: ${result.statusCode} - ${result.text}`,
        { status_code: result.statusCode }
      );
    } catch (error) {
      if (isTimeout(error)) {
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error polling operation status');
      return errorResponse(`Error polling operation status: ${errorMessage(error)}`);
    }
  });

  app.post('/api/get-memory-store', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, STORE_FIELDS);
    if (fields === null) {
      return errorResponse(STORE_FIELDS_MESSAGE);
    }

    const endpoint = `${MEMORY_API_BASE}/Stores/${fields.memory_store_id}`;
    try {
      const result = await twilioRequest({
        method: 'get',
        url: endpoint,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
      });

      if (result.statusCode === 200) {
        return { status: 'success', memory_store: toStoreSummary(result.json) };
      }

      app.log.error(
        { endpoint, status: result.statusCode, response: result.text },
        'Failed to get Memory Store'
      );
      return errorResponse(`Failed to get Memory Store: ${result.statusCode} - ${result.text}`, {
        endpoint,
        response: result.text,
        status_code: result.statusCode,
      });
    } catch (error) {
      if (isTimeout(error)) {
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error getting Memory Store');
      return errorResponse(`Error getting Memory Store: ${errorMessage(error)}`);
    }
  });

  app.post('/api/list-memory-stores', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, ['api_key', 'api_secret']);
    if (fields === null) {
      return errorResponse('Missing required fields: api_key, api_secret');
    }

    const endpoint = `${MEMORY_API_BASE}/Stores`;
    try {
      const result = await twilioRequest({
        method: 'get',
        url: endpoint,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
      });

      if (result.statusCode !== 200) {
        app.log.error(
          { endpoint, status: result.statusCode, response: result.text },
          'Failed to list Memory Stores'
        );
        return errorResponse(
          `Failed to list Memory Stores: ${result.statusCode} - ${result.text}`,
          { endpoint, response: result.text, status_code: result.statusCode }
        );
      }

      // Sequential on purpose: it preserves ordering and avoids firing up to 100
      // concurrent authenticated requests at the Memory API.
      const stores: MemoryStoreSummary[] = [];
      for (const storeId of readStringArray(result.json, 'stores').slice(0, STORE_LIST_LIMIT)) {
        try {
          const detail = await twilioRequest({
            method: 'get',
            url: `${MEMORY_API_BASE}/Stores/${storeId}`,
            apiKey: fields.api_key,
            apiSecret: fields.api_secret,
            timeoutMs: STORE_DETAIL_TIMEOUT_MS,
          });
          // A non-200 detail response drops the store from the list entirely; only a
          // thrown request falls back to an UNKNOWN row.
          if (detail.statusCode === 200) {
            stores.push(toStoreSummary(detail.json));
          }
        } catch (error) {
          app.log.warn({ storeId, err: error }, 'Failed to fetch details for store');
          stores.push({ id: storeId, displayName: storeId, description: null, status: 'UNKNOWN' });
        }
      }

      return { status: 'success', stores };
    } catch (error) {
      if (isTimeout(error)) {
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error listing Memory Stores');
      return errorResponse(`Error listing Memory Stores: ${errorMessage(error)}`);
    }
  });

  app.post('/api/delete-memory-store', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, STORE_FIELDS);
    if (fields === null) {
      return errorResponse(STORE_FIELDS_MESSAGE);
    }

    const endpoint = `${MEMORY_API_BASE}/Stores/${fields.memory_store_id}`;
    try {
      const result = await twilioRequest({
        method: 'delete',
        url: endpoint,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
      });

      if (result.statusCode === 200 || result.statusCode === 204) {
        return { status: 'success', message: 'Memory Store deleted successfully' };
      }

      if (result.statusCode === 202) {
        const statusUrl = readString(result.json, 'statusUrl');
        if (!statusUrl) {
          app.log.error({ response: result.text }, '202 response missing statusUrl');
          return errorResponse('Deletion accepted but no status URL returned', {
            response: result.text,
          });
        }
        return {
          status: 'accepted',
          message: 'Memory Store deletion request accepted',
          status_url: statusUrl,
        };
      }

      app.log.error(
        { endpoint, status: result.statusCode, response: result.text },
        'Failed to delete Memory Store'
      );
      return errorResponse(`Failed to delete Memory Store: ${result.statusCode} - ${result.text}`, {
        endpoint,
        response: result.text,
        status_code: result.statusCode,
      });
    } catch (error) {
      if (isTimeout(error)) {
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error deleting Memory Store');
      return errorResponse(`Error deleting Memory Store: ${errorMessage(error)}`);
    }
  });

  app.post('/api/verify-memory-store', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, STORE_FIELDS);
    if (fields === null) {
      return errorResponse(STORE_FIELDS_MESSAGE);
    }

    const endpoint = `${MEMORY_API_BASE}/Stores/${fields.memory_store_id}`;
    try {
      const result = await twilioRequest({
        method: 'get',
        url: endpoint,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
      });

      if (result.statusCode === 200) {
        const storeStatus = (readString(result.json, 'status') ?? '').toUpperCase();
        if (storeStatus === 'ACTIVE') {
          return {
            status: 'success',
            store_status: storeStatus,
            message: 'Memory Store is active',
          };
        }
        return {
          status: 'pending',
          store_status: storeStatus,
          message: `Memory Store status: ${storeStatus}`,
        };
      }

      app.log.error(
        { endpoint, status: result.statusCode, response: result.text },
        'Failed to verify Memory Store'
      );
      return errorResponse(`Failed to verify Memory Store: ${result.statusCode} - ${result.text}`, {
        endpoint,
        response: result.text,
        status_code: result.statusCode,
      });
    } catch (error) {
      if (isTimeout(error)) {
        app.log.error('Timeout verifying Memory Store');
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error verifying Memory Store');
      return errorResponse(`Error verifying Memory Store: ${errorMessage(error)}`);
    }
  });
}

function toStoreSummary(json: unknown): MemoryStoreSummary {
  return {
    id: readString(json, 'id'),
    displayName: readString(json, 'displayName'),
    description: readString(json, 'description'),
    status: readString(json, 'status'),
  };
}
