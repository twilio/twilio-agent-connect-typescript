import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import { HandoffData, HandoffDataSchema } from '../types/voice';
import { createLogger } from '../lib/logger';

const logger = createLogger({ name: 'tac-flex' });

/**
 * Result of Flex handoff logic
 */
export interface FlexHandoffResult {
  success: boolean;
  status: number;
  content: string;
  contentType: string;
}

/**
 * Handle Flex handoff logic for Twilio webhook
 *
 * Generates TwiML to enqueue a call to a Twilio Flex workflow for human agent handoff.
 *
 * @param formData - Form data from webhook request containing HandoffData and CallStatus
 * @param flexWorkflowSid - Flex TaskRouter workflow SID (starts with WW)
 * @returns Result with status, content (TwiML or error), and content type
 */
export function handleFlexHandoffLogic(
  formData: Record<string, string>,
  flexWorkflowSid: string | undefined
): FlexHandoffResult {
  if (!flexWorkflowSid) {
    logger.error('No Flex workflow SID configured');
    return {
      success: false,
      status: 400,
      content: 'Invalid handoff data',
      contentType: 'text/plain',
    };
  }

  const response = new VoiceResponse();
  const handoffDataRaw = formData['HandoffData'] || '';

  if (handoffDataRaw) {
    // Parse and validate handoff data
    let handoffData: HandoffData;
    try {
      handoffData = HandoffDataSchema.parse(JSON.parse(handoffDataRaw));
    } catch (error) {
      logger.error({ err: error }, 'Invalid handoff data');
      return {
        success: false,
        status: 400,
        content: 'Invalid handoff data',
        contentType: 'text/plain',
      };
    }

    // Generate TwiML with enqueue to Flex workflow
    const enqueue = response.enqueue({
      workflowSid: flexWorkflowSid,
    });

    enqueue.task(
      {
        priority: 5,
      },
      JSON.stringify(handoffData)
    );

    logger.debug(
      { workflow_sid: flexWorkflowSid, handoff_data: handoffData },
      'Generated Flex handoff TwiML'
    );

    return {
      success: true,
      status: 200,
      content: response.toString(),
      contentType: 'application/xml',
    };
  } else {
    // No handoff data - check call status
    if (formData['CallStatus'] === 'completed') {
      return {
        success: true,
        status: 200,
        content: 'Call Completed',
        contentType: 'application/xml',
      };
    } else {
      return {
        success: false,
        status: 400,
        content: 'Handoff Data is Missing',
        contentType: 'application/xml',
      };
    }
  }
}
