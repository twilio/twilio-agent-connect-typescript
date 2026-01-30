/**
 * Order management and pricing tools for OpenAI Agents SDK.
 */

import { tool } from '@openai/agents';
import { z } from 'zod';
import type { TAC, ConversationSession } from '@twilio/tac-core';
import { COMPANY_INFO, INTERNET_PLANS } from './business-data';

/**
 * Get all available internet plans with their details
 */
export const getAvailablePlans = tool({
  name: 'get_available_plans',
  description: 'Get all available internet plans with their details',
  parameters: z.object({}),
  execute: (): string => {
    const plansList: string[] = [];

    for (const [speed, plan] of Object.entries(INTERNET_PLANS)) {
      // Skip duplicate entries (1gig, gigabit are aliases for 1000)
      if (speed === '1gig' || speed === 'gigabit') {
        continue;
      }

      plansList.push(`- ${plan.name} (${speed} Mbps): ${plan.price} - ${plan.description}`);
    }

    return 'Available Internet Plans:\n' + plansList.join('\n');
  },
});

/**
 * Get pricing for internet plan upgrade
 */
export const lookUpOrderPrice = tool({
  name: 'look_up_order_price',
  description: 'Get pricing for internet plan upgrade',
  parameters: z.object({
    planSpeed: z.string().describe('Target internet speed (e.g., "1000 Mbps", "500 Mbps")'),
  }),
  execute: (input): string => {
    const { planSpeed } = input;
    // Extract speed number from input
    const speedNum = planSpeed.replace(/\D/g, '');

    if (!speedNum) {
      // Handle text inputs like "gigabit"
      const planKey = planSpeed.toLowerCase().replace(/\s+/g, '').replace('mbps', '');
      const plan = INTERNET_PLANS[planKey];
      if (plan) {
        return `The ${plan.name} plan is ${plan.price} for ${planSpeed} speeds.`;
      }
    }

    const plan = INTERNET_PLANS[speedNum];
    if (plan) {
      return `The ${plan.name} plan (${speedNum} Mbps) is ${plan.price}.`;
    }

    return `Pricing for ${planSpeed} plans: Contact customer service for custom enterprise pricing at ${COMPANY_INFO.phone}.`;
  },
});

/**
 * Check if there was a recent internet outage in a specific zip code
 */
export const lookUpOutage = tool({
  name: 'look_up_outage',
  description: 'Check if there was a recent internet outage in a specific zip code',
  parameters: z.object({
    zipCode: z.string().describe('The zip code to check for outages (e.g., "94103", "10001")'),
  }),
  execute: (input): string => {
    const { zipCode } = input;
    // Hardcoded to return no outage for now
    const hasOutage = false;

    if (hasOutage) {
      return `Yes, we detected a recent internet outage in the ${zipCode} area. Our team has resolved the issue and service should be fully restored.`;
    }

    return `Good news! There are no reported outages in the ${zipCode} area. Your service should be operating normally.`;
  },
});

/**
 * Run diagnostics to check if customer's router is compatible with their internet plan
 */
export const runDiagnostic = tool({
  name: 'run_diagnostic',
  description:
    "Run diagnostics to check if customer's router is compatible with their internet plan",
  parameters: z.object({
    internetPlan: z
      .string()
      .describe('Customer\'s internet plan speed (e.g., "300", "500", "1000")'),
    routerModel: z
      .string()
      .describe('Customer\'s router model (e.g., "OWL-R2021", "OWL-R2019", "OWL-X5")'),
  }),
  execute: (input): string => {
    const { internetPlan, routerModel } = input;
    // Hardcoded diagnostic result for now
    const diagnosticResult = 'ROUTER_NEEDS_UPGRADE';

    if (diagnosticResult === 'ROUTER_NEEDS_UPGRADE') {
      return `Diagnostic complete: Your ${routerModel} router needs an upgrade to support your ${internetPlan} Mbps plan. The current router is limiting your speeds. We recommend upgrading to our OWL-X5 router for optimal performance.`;
    } else if (diagnosticResult === 'ROUTER_COMPATIBLE') {
      return `Diagnostic complete: Your ${routerModel} router is fully compatible with your ${internetPlan} Mbps plan. No upgrade needed.`;
    }

    return 'Diagnostic complete: Unable to determine router compatibility. Please contact support.';
  },
});

/**
 * Look up available discounts for customer
 */
export const lookUpDiscounts = tool({
  name: 'look_up_discounts',
  description: 'Look up available discounts for customer',
  parameters: z.object({
    customerType: z.string().describe('Customer loyalty tier (loyal, premium, new)'),
  }),
  execute: (input): string => {
    const { customerType } = input;
    const discounts: string[] = [];

    // Competitor retention offer (always available for retention)
    if (customerType === 'loyal' || customerType === 'premium') {
      discounts.push('20% off first 6 months (retention offer)');
    } else {
      discounts.push('10% off first 3 months (new customer offer)');
    }

    if (discounts.length > 0) {
      return `Available discounts: ${discounts.join(', ')}. I can apply the best combination for you!`;
    }

    return 'Let me check for any current promotions that might apply to your account.';
  },
});

/**
 * Create confirm_order tool with injected TAC context.
 *
 * Sends SMS confirmation to customer using Twilio REST API.
 * Gets customer phone from conversation participants.
 */
export function createConfirmOrderTool(tac: TAC, context: ConversationSession) {
  return tool({
    name: 'confirm_order',
    description: 'Confirm order and process the upgrade',
    parameters: z.object({
      orderDetails: z.string().describe('Details of the order to confirm'),
    }),
    execute: async (input): Promise<string> => {
      const { orderDetails } = input;
      console.log(`[TOOL:CONFIRM] Called with order_details: ${orderDetails.substring(0, 50)}...`);

      try {
        // Get participants from conversation
        const participants = await tac
          .getConversationClient()
          .listParticipants(context.conversation_id);

        // Find customer participant with SMS address
        let customerPhone: string | null = null;
        for (const participant of participants) {
          if (participant.type === 'CUSTOMER') {
            for (const address of participant.addresses) {
              customerPhone = address.address; // Phone number in E.164 format
              break;
            }
            if (customerPhone) {
              break;
            }
          }
        }

        if (!customerPhone) {
          console.error('[TOOL:CONFIRM] Unable to derive customer phone number');
          return 'Unable to send confirmation - customer phone number not found.';
        }

        console.log(
          `[TOOL:CONFIRM] Derived phone number ${customerPhone} for customer confirmation`
        );
        console.log(`[TOOL:CONFIRM] Sending SMS to: ${customerPhone}`);

        // Send SMS using Twilio client directly
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;
        if (!accountSid || !authToken || !fromNumber) {
          return 'Unable to send confirmation - Twilio credentials not configured.';
        }
        const { default: Twilio } = await import('twilio');
        const client = Twilio(accountSid, authToken);

        const message = await client.messages.create({
          body: orderDetails,
          from: fromNumber,
          to: customerPhone,
        });

        console.log(`[TOOL:CONFIRM] SMS sent successfully, SID: ${message.sid}`);
        return `Order confirmation sent via SMS! You should receive it shortly with order details${orderDetails ? `: ${orderDetails}` : ''}.`;
      } catch (error) {
        console.error('[TOOL:CONFIRM] Failed to send SMS:', error);
        return `Failed to send order confirmation via SMS: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
}

/**
 * Create a Flex escalation tool with injected session context.
 * Stores escalation data in session metadata for the channel to handle.
 */
export function createFlexEscalationTool(session: ConversationSession | null) {
  return tool({
    name: 'flex_escalate_to_human',
    description: 'Escalate the conversation to a human agent in Flex with optional reason',
    parameters: z.object({
      reason: z
        .string()
        .describe(
          'The reason for escalation (e.g., "User requested human help", "Technical issue")'
        ),
    }),
    execute: (input): { status: string; reason: string } => {
      const { reason } = input;

      // Create handoff data for post-response processing
      const handoffData = {
        reason: 'handoff',
        call_summary: reason,
        sentiment: 'neutral',
      };

      console.log(
        `[TOOL:FLEX_ESCALATE] Marking conversation for escalation: ${JSON.stringify(handoffData)}`
      );

      // Store escalation data in session metadata for post-response processing
      if (session) {
        if (!session.metadata) {
          session.metadata = {};
        }
        session.metadata.pending_handoff = {
          handoff_data: JSON.stringify(handoffData),
        };
      }

      return { status: 'escalated', reason };
    },
  });
}
