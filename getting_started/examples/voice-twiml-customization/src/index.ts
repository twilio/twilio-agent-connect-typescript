/**
 * Feature: ConversationRelay TwiML customization
 *
 * Two layers (highest precedence first):
 *
 *   1. Per-call customizer — register on the channel via
 *      `voiceChannel.onInboundCallTwiml(...)`. Async callable that receives a
 *      TwiMLRequest (parsed Twilio webhook fields: from, to, callerCountry, …).
 *      Inbound only. For outbound, pass per-call twimlOptions on
 *      InitiateVoiceConversationOptions.
 *   2. `VoiceChannelConfig.defaultTwimlOptions` — static TwiMLOptions applied to
 *      every call (inbound and outbound).
 *
 * Layers merge per-field: the customizer overrides only the fields it explicitly
 * sets; everything else falls through to `defaultTwimlOptions` and then to TAC
 * defaults (websocket URL, action URL, conversationConfiguration).
 *
 * This example shows both layers together — channel-wide defaults plus a
 * country-based customizer that overrides language/voice/greeting for specific
 * callers.
 *
 * Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY,
 * TWILIO_API_SECRET, TWILIO_PHONE_NUMBER, TWILIO_VOICE_PUBLIC_DOMAIN
 */

import { config } from 'dotenv';
import { TAC, TACConfig, VoiceChannel, TACServer } from 'twilio-agent-connect';
import type { TwiMLRequest, TwiMLOptions } from 'twilio-agent-connect';

config({ path: '../.env' });

const tac = await TAC.create({ config: TACConfig.fromEnv() });

tac.onMessageReady(async ({ message }) => `You said: ${message}`);

/**
 * Per-call overrides for inbound calls. Only the fields you set here override
 * the channel default; the rest fall through.
 */
async function customizeTwiml(req: TwiMLRequest): Promise<TwiMLOptions> {
  if (req.callerCountry === 'MX') {
    return { language: 'es-MX', welcomeGreeting: '¡Hola! ¿En qué puedo ayudarte?' };
  }
  if (req.callerCountry === 'FR') {
    return { language: 'fr-FR', welcomeGreeting: 'Bonjour ! Comment puis-je vous aider ?' };
  }
  // `websocketUrl` is a normal per-call field too: an affinity-routed host can
  // append a per-call token to the upgrade URL. Leave it unset to fall back to
  // the URL derived from TACConfig.voicePublicDomain + voiceWebsocketPath.
  // return { websocketUrl: `wss://${host}/ws?agent_session_id=${req.callSid}` };
  return {}; // fall through to defaultTwimlOptions
}

const voiceChannel = new VoiceChannel(tac, {
  // Channel-wide defaults — apply to every call (inbound + outbound).
  defaultTwimlOptions: {
    welcomeGreeting: 'Hello! This is a default greeting.',
    interruptible: 'speech',
    // Escape hatch for ConversationRelay attributes TAC hasn't typed yet:
    // extra: { newRelayAttribute: 'value' },
  },
});

// Register the per-call inbound customizer.
voiceChannel.onInboundCallTwiml(customizeTwiml);

tac.registerChannel(voiceChannel);

const server = new TACServer(tac);

await server.start();
