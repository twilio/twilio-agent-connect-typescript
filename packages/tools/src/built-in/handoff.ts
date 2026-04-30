/**
 * Handoff tool for the Twilio Agent Connect.
 *
 * Generic Studio-backed handoff that routes a conversation to a human agent.
 * Produces a structured HandoffPayload and delivers it as a Twilio Studio
 * Execution (voice via `<Connect action>`, digital channels via direct POST).
 */

import axios, { AxiosError } from 'axios';
import {
  ConversationSession,
  HandoffPayload,
  PendingHandoffData,
  TAC,
  studioExecutionsUrl,
  studioVoiceHandoffUrl,
} from '@twilio/tac-core';
import { TACTool, defineTool } from '../lib/builder';

// Re-export URL helpers for backward compatibility with the Python factory surface.
export { studioExecutionsUrl, studioVoiceHandoffUrl };

/**
 * Build a HandoffPayload from session context and attributes.
 *
 * Useful for custom handoff tools that want TAC's payload shape without
 * the Studio-specific delivery in `postStudioHandoff`.
 */
export function buildHandoffPayload(
  session: ConversationSession,
  memoryStoreId: string,
  attributes: Record<string, unknown>
): HandoffPayload {
  return {
    conversationId: session.conversationId,
    storeId: memoryStoreId,
    profileId: session.profileId ?? '',
    attributes,
  };
}

/**
 * POST a handoff payload to a Twilio Studio Flow Executions endpoint.
 *
 * Emits the Twilio Studio Executions API wire format: form-encoded
 * `To` / `From` / `Parameters` fields with HTTP Basic auth.
 * `Parameters` is a JSON string keyed under `HandoffData` so Studio
 * can reference it via `{{flow.data.HandoffData.*}}`.
 */
export async function postStudioHandoff(
  payload: HandoffPayload,
  session: ConversationSession,
  options: {
    handoffUrl: string;
    fromAddress: string;
    apiKey: string;
    apiSecret: string;
  }
): Promise<void> {
  const { handoffUrl, fromAddress, apiKey, apiSecret } = options;
  const toAddress = session.authorInfo?.address ?? '';

  const form = new URLSearchParams();
  form.append('To', toAddress);
  form.append('From', fromAddress);
  form.append('Parameters', JSON.stringify({ HandoffData: payload }));

  await axios.post(handoffUrl, form.toString(), {
    timeout: 10_000,
    auth: { username: apiKey, password: apiSecret },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

/**
 * Result returned by the handoff tool.
 */
export interface HandoffResult {
  status: 'handoff_initiated' | 'handoff_failed';
  channel: string;
  error?: string;
}

interface HandoffParams {
  reason: string;
}

const DEFAULT_HANDOFF_TOOL_NAME = 'handoff';
const DEFAULT_HANDOFF_TOOL_DESCRIPTION =
  'Hand off the conversation to a human agent. ' +
  'Use this when the customer requests a human, or when you ' +
  'cannot adequately handle the request.';

/**
 * Create a handoff tool that delivers in the Twilio Studio Executions API shape.
 *
 * The returned tool exposes only `handoff({ reason })` to the LLM. All other
 * dependencies (TAC instance, session, static attributes) are captured in the
 * closure.
 *
 * On digital channels, the tool POSTs to the Studio Flow Executions endpoint
 * derived from `tac.getConfig().studioHandoffFlowSid`. For voice channels,
 * the payload is stored on the session and the voice channel automatically
 * sends the WS `end` message with `handoffData` after the LLM's final
 * response is delivered.
 *
 * The tool also sets the conversation to INACTIVE and clears status callbacks
 * to prevent further webhook events from being routed to TAC.
 *
 * **Not available in voice-only mode.** This tool requires Conversation
 * Orchestrator for conversation state management and Conversation Memory for
 * the handoff payload. In voice-only mode, implement your own handoff by
 * setting `session.pendingHandoffData` directly — the voice channel will
 * send the WS `end` message with your payload, and your `<Connect action>`
 * URL handler can route the call accordingly.
 *
 * @throws Error if `tac.getConfig().studioHandoffFlowSid` is unset. The
 *   factory is Studio-specific; a missing SID is misconfiguration, not a
 *   soft fallback.
 */
export function createStudioHandoffTool(
  tac: TAC,
  session: ConversationSession,
  options: {
    attributes?: Record<string, unknown>;
    name?: string;
    description?: string;
  } = {}
): TACTool<HandoffParams, HandoffResult> {
  const config = tac.getConfig();
  if (!config.studioHandoffFlowSid) {
    throw new Error(
      'createStudioHandoffTool requires tac.getConfig().studioHandoffFlowSid ' +
        '(set TWILIO_STUDIO_HANDOFF_FLOW_SID in your environment).'
    );
  }
  const flowSid = config.studioHandoffFlowSid;

  const staticAttributes = options.attributes ?? {};
  const toolName = options.name ?? DEFAULT_HANDOFF_TOOL_NAME;
  const toolDescription = options.description ?? DEFAULT_HANDOFF_TOOL_DESCRIPTION;

  return defineTool<HandoffParams, HandoffResult>(
    toolName,
    toolDescription,
    {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'The reason for handing off to a human agent',
        },
      },
      required: ['reason'],
      description: 'Hand off the conversation to a human agent',
    },
    async (params: HandoffParams): Promise<HandoffResult> => {
      const attributes = { ...staticAttributes, reason: params.reason };

      const coClient = tac.getConversationClient();
      if (!coClient) {
        throw new Error(
          'Handoff requires Conversation Orchestrator (not available in voice-only mode)'
        );
      }
      const memoryStoreId = tac.getMemoryStoreId();
      if (!memoryStoreId) {
        throw new Error('Memory store ID is not available (required for handoff)');
      }

      const payload = buildHandoffPayload(session, memoryStoreId, attributes);

      // 1. Set conversation to INACTIVE to trigger the CO-generated
      // conversation summary that Flex fetches on pickup. Downstream
      // (Studio/Flex) flips it back to ACTIVE on pickup and CLOSED on hangup —
      // we don't close it ourselves.
      try {
        await coClient.updateConversation(session.conversationId, 'INACTIVE');
      } catch (err) {
        tac.logger.warn(
          { err, conversation_id: session.conversationId },
          'Failed to set conversation INACTIVE during handoff'
        );
      }

      // 2. Clear statusCallbacks so TAC stops receiving webhook events for
      // this conversation (Flex/human agent will handle it from here).
      try {
        await coClient.clearStatusCallbacks(session.conversationId);
      } catch (err) {
        tac.logger.warn(
          { err, conversation_id: session.conversationId },
          'Failed to clear status callbacks during handoff'
        );
      }

      // 3. Deliver handoff payload.
      if (session.channel === 'voice') {
        // Voice: store on session for deferred delivery. The voice channel
        // sends the WS "end" message after the LLM's final response so the
        // caller hears a goodbye before transfer. handoffData is a JSON
        // *string* — ConversationRelay forwards it verbatim in the POST body
        // to the action URL.
        const pending: PendingHandoffData = {
          type: 'end',
          handoffData: JSON.stringify(payload),
        };
        session.pendingHandoffData = pending;
      } else {
        // Digital channels: POST handoff payload to the Studio Flow Executions
        // endpoint. If the POST fails (network, 4xx, 5xx, timeout), return
        // handoff_failed so the LLM can tell the user instead of claiming
        // success.
        try {
          await postStudioHandoff(payload, session, {
            handoffUrl: studioExecutionsUrl(flowSid),
            fromAddress: config.phoneNumber,
            apiKey: config.apiKey,
            apiSecret: config.apiSecret,
          });
        } catch (err) {
          const message =
            err instanceof AxiosError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          tac.logger.error(
            { err, conversation_id: session.conversationId },
            'Failed to deliver handoff payload'
          );
          return {
            status: 'handoff_failed',
            channel: session.channel,
            error: message,
          };
        }
      }

      return { status: 'handoff_initiated', channel: session.channel };
    }
  );
}
