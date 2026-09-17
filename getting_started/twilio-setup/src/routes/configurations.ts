/**
 * Conversation Orchestrator configuration routes: create, list and delete.
 */

import type { FastifyInstance } from 'fastify';
import { TIMED_OUT, errorResponse, type WizardResponse } from '../envelope';
import {
  CONVERSATION_API_BASE,
  asRecord,
  isTimeout,
  readString,
  twilioRequest,
} from '../twilio-api';
import { errorMessage, readField, requireFields } from '../validation';

const DISPLAY_NAME_MAX_LENGTH = 32;
const DESCRIPTION_MAX_LENGTH = 128;

/** displayName doubles as a URL path segment, so the character set is restricted. */
const URL_SAFE_DISPLAY_NAME = /^[A-Za-z0-9._~-]+$/;

export function configurationRoutes(app: FastifyInstance): void {
  app.post('/api/create-conversation-configuration', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, [
      'api_key',
      'api_secret',
      'memory_store_id',
      'twilio_phone',
      'ngrok_domain',
    ]);
    // These two are trimmed before the presence check, so whitespace-only counts as
    // absent here even though it counts as present for the fields above.
    const displayName = (readField(request.body, 'configuration_display_name') ?? '').trim();
    const description = (readField(request.body, 'configuration_description') ?? '').trim();

    if (fields === null || !displayName) {
      return errorResponse(
        'Missing required fields: api_key, api_secret, memory_store_id, ' +
          'twilio_phone, ngrok_domain, configuration_display_name'
      );
    }

    if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      return errorResponse('Display name must not exceed 32 characters', {
        details: `Current length: ${displayName.length}`,
      });
    }

    if (!URL_SAFE_DISPLAY_NAME.test(displayName)) {
      return errorResponse(
        'Display name must be URL-safe: only letters, numbers, ' +
          'dot (.), underscore (_), tilde (~), and hyphen (-) are allowed',
        { details: `Invalid display name: ${displayName}` }
      );
    }

    if (description && description.length > DESCRIPTION_MAX_LENGTH) {
      return errorResponse('Description must not exceed 128 characters', {
        details: `Current length: ${description.length}`,
      });
    }

    const twilioPhone = fields.twilio_phone;
    const payload: Record<string, unknown> = {
      displayName,
      conversationGroupingType: 'GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE',
      memoryStoreId: fields.memory_store_id,
      channelSettings: {
        SMS: {
          statusTimeouts: { inactive: 2, closed: 3 },
          captureRules: [
            { from: '*', to: twilioPhone },
            { from: twilioPhone, to: '*' },
          ],
        },
        RCS: {
          statusTimeouts: { inactive: 10, closed: 15 },
          captureRules: [
            { from: '*', to: twilioPhone },
            { from: twilioPhone, to: '*' },
          ],
        },
        VOICE: {
          statusTimeouts: { inactive: 5, closed: 30 },
          captureRules: [{ from: '*', to: twilioPhone, metadata: { callType: 'PSTN' } }],
        },
      },
      statusCallbacks: [{ url: `https://${fields.ngrok_domain}/webhook`, method: 'POST' }],
    };
    // Omitted entirely rather than defaulted when blank.
    if (description) {
      payload.description = description;
    }

    const endpoint = `${CONVERSATION_API_BASE}/Configurations`;
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
        app.log.info('Conversation Orchestrator configuration created successfully');
        app.log.debug(
          {
            requestDisplayName: displayName,
            responseDisplayName: readString(result.json, 'displayName'),
          },
          'Configuration display name echo'
        );
        return {
          status: 'success',
          conversation_configuration_id: id,
          message: `Conversation Orchestrator configuration created: ${id}`,
        };
      }

      if (result.statusCode === 202) {
        const statusUrl = readString(result.json, 'statusUrl');
        app.log.info(
          { statusUrl, displayName },
          'Conversation Orchestrator configuration creation accepted (async)'
        );
        return {
          status: 'accepted',
          status_url: statusUrl,
          message: 'Configuration creation accepted for processing',
        };
      }

      app.log.error(
        { endpoint, payload, status: result.statusCode, response: result.text },
        'Failed to create Conversation Orchestrator configuration'
      );
      return errorResponse(
        'Failed to create Conversation Orchestrator configuration: ' +
          `${result.statusCode} - ${result.text}`,
        { endpoint, payload, response: result.text, status_code: result.statusCode }
      );
    } catch (error) {
      if (isTimeout(error)) {
        app.log.error('Timeout creating Conversation Orchestrator configuration');
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error creating Conversation Orchestrator configuration');
      return errorResponse(
        `Error creating Conversation Orchestrator configuration: ${errorMessage(error)}`
      );
    }
  });

  app.post('/api/list-conversation-configurations', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, ['api_key', 'api_secret']);
    if (fields === null) {
      return errorResponse('Missing required fields: api_key, api_secret');
    }

    const endpoint = `${CONVERSATION_API_BASE}/Configurations`;
    try {
      const result = await twilioRequest({
        method: 'get',
        url: endpoint,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
      });

      if (result.statusCode === 200) {
        const raw = asRecord(result.json).configurations;
        const configurations = (Array.isArray(raw) ? raw : []).map(entry => {
          const config = asRecord(entry);
          return {
            id: config.id ?? null,
            displayName: config.displayName ?? null,
            description: config.description ?? null,
            createdAt: config.createdAt ?? null,
            memoryStoreId: config.memoryStoreId ?? null,
          };
        });
        return { status: 'success', configurations };
      }

      app.log.error(
        { endpoint, status: result.statusCode, response: result.text },
        'Failed to list Conversation Orchestrator configurations'
      );
      return errorResponse(`Failed to list configurations: ${result.statusCode} - ${result.text}`, {
        response: result.text,
        status_code: result.statusCode,
      });
    } catch (error) {
      if (isTimeout(error)) {
        app.log.error('Timeout listing Conversation Orchestrator configurations');
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error listing Conversation Orchestrator configurations');
      return errorResponse(`Error listing configurations: ${errorMessage(error)}`);
    }
  });

  app.post('/api/delete-conversation-configuration', async (request): Promise<WizardResponse> => {
    const fields = requireFields(request.body, ['api_key', 'api_secret', 'configuration_id']);
    if (fields === null) {
      return errorResponse('Missing required fields: api_key, api_secret, configuration_id');
    }

    const configurationId = fields.configuration_id;
    const endpoint = `${CONVERSATION_API_BASE}/Configurations/${configurationId}`;
    try {
      const result = await twilioRequest({
        method: 'delete',
        url: endpoint,
        apiKey: fields.api_key,
        apiSecret: fields.api_secret,
      });

      if (result.statusCode === 200 || result.statusCode === 204) {
        app.log.info({ configurationId }, 'Deleted Conversation Orchestrator configuration');
        return {
          status: 'success',
          message: `Configuration ${configurationId} deleted successfully`,
        };
      }

      if (result.statusCode === 202) {
        const statusUrl = readString(result.json, 'statusUrl');
        app.log.info(
          { configurationId, statusUrl },
          'Conversation Orchestrator configuration deletion accepted (async)'
        );
        return {
          status: 'accepted',
          message: `Configuration ${configurationId} deletion accepted for processing`,
          status_url: statusUrl,
        };
      }

      app.log.error(
        { endpoint, status: result.statusCode, response: result.text },
        'Failed to delete Conversation Orchestrator configuration'
      );
      return errorResponse(
        `Failed to delete configuration: ${result.statusCode} - ${result.text}`,
        { response: result.text, status_code: result.statusCode }
      );
    } catch (error) {
      if (isTimeout(error)) {
        app.log.error('Timeout deleting Conversation Orchestrator configuration');
        return errorResponse(TIMED_OUT);
      }
      app.log.error({ err: error }, 'Error deleting Conversation Orchestrator configuration');
      return errorResponse(`Error deleting configuration: ${errorMessage(error)}`);
    }
  });
}
