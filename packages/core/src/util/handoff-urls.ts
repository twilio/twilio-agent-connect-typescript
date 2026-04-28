/**
 * URL builders for Twilio Studio handoff.
 *
 * Shared between the tools package (digital handoff POSTs) and the server
 * package (voice `<Connect action>` URL).
 */

/**
 * Build the Twilio Studio Flow Executions URL for a given Flow SID.
 *
 * Used for digital (messaging/chat) handoff — POST the handoff payload
 * to this URL to start a Studio flow execution.
 */
export function studioExecutionsUrl(flowSid: string): string {
  return `https://studio.twilio.com/v2/Flows/${flowSid}/Executions`;
}

/**
 * Build the Twilio Studio Flow voice webhook URL for a given Flow SID.
 *
 * Used as the `<Connect action=...>` URL in TwiML for voice handoff,
 * so that when ConversationRelay ends the session Twilio triggers the
 * Studio flow for an incoming call.
 */
export function studioVoiceHandoffUrl(accountSid: string, flowSid: string): string {
  return `https://webhooks.twilio.com/v1/Accounts/${accountSid}/Flows/${flowSid}?Trigger=incomingCall`;
}
