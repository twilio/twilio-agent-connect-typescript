/**
 * Feature: ConversationRelay TwiML customization
 *
 * Two layers (highest precedence first):
 *
 * 1. Per-call customizer — register on the channel via
 *    `voiceChannel.onInboundCallTwiml(...)`. A callback that receives a
 *    TwiMLRequest (parsed Twilio webhook fields: From, To, CallerCountry, …)
 *    and returns ConversationRelay TwiML overrides. Inbound only. For outbound,
 *    pass per-call overrides on InitiateVoiceConversationOptions.twimlOptions.
 * 2. `VoiceChannelConfig.defaultTwimlOptions` — static TwiML applied to every
 *    call (inbound and outbound).
 *
 * Layers merge per-field: the customizer overrides only the fields it
 * explicitly sets; everything else falls through to `defaultTwimlOptions` and
 * then to TAC defaults (websocket URL, action URL, conversationConfiguration).
 *
 * The WebSocket and action URLs are derived from TACConfig.voicePublicDomain
 * (TWILIO_VOICE_PUBLIC_DOMAIN) — no need to plumb host headers through.
 */

import { config } from 'dotenv';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  TACServer,
  type TwiMLRequest,
  type ConversationRelayOptions,
  type ConversationId,
  type ProfileId,
  type ChannelType,
  type ConversationSession,
  type TACMemoryResponse,
} from 'twilio-agent-connect';

config();

const tac = await TAC.create({ config: TACConfig.fromEnv() });

const voiceChannel = new VoiceChannel(tac, {
  // Channel-wide defaults — apply to every call (inbound + outbound).
  defaultTwimlOptions: {
    welcomeGreeting: 'Hello! This is a default greeting.',
    interruptible: 'speech',
    // Escape hatch for ConversationRelay attributes TAC hasn't typed yet:
    // extra: { newRelayAttribute: 'value' },
  },
});

// Per-call overrides for inbound calls. Only the fields you set here override
// the channel default; the rest fall through.
function customizeTwiml(req: TwiMLRequest): ConversationRelayOptions {
  if (req.callerCountry === 'MX') {
    return {
      language: 'es-MX',
      welcomeGreeting: '¡Hola! ¿En qué puedo ayudarte?',
    };
  }
  if (req.callerCountry === 'FR') {
    return {
      language: 'fr-FR',
      welcomeGreeting: 'Bonjour ! Comment puis-je vous aider ?',
    };
  }
  return {}; // fall through to defaultTwimlOptions
}

voiceChannel.onInboundCallTwiml(customizeTwiml);
tac.registerChannel(voiceChannel);

tac.onMessageReady(
  (params: {
    conversationId: ConversationId;
    profileId: ProfileId | undefined;
    message: string;
    author: string;
    memory: TACMemoryResponse | undefined;
    session: ConversationSession;
    channel: ChannelType;
  }): string => `You said: ${params.message}`
);

const server = new TACServer(tac, { voice: { host: '0.0.0.0', port: 8000 } });
await server.start();
