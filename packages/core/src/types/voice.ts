import { z } from 'zod';

/**
 * Voice server configuration for built-in Fastify setup
 */
export const VoiceServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().positive().default(3000),
  path: z.string().default('/twiml'),
  webhookPath: z.string().default('/voice'),
});

export type VoiceServerConfig = z.infer<typeof VoiceServerConfigSchema>;

/**
 * Custom parameters passed via TwiML
 */
export const CustomParametersSchema = z.object({
  conversation_id: z.string().optional(),
  profile_id: z.string().optional(),
  customer_participant_id: z.string().optional(),
  ai_agent_participant_id: z.string().optional(),
});

export type CustomParameters = z.infer<typeof CustomParametersSchema>;

/**
 * WebSocket setup message from ConversationRelay
 */
export const SetupMessageSchema = z.object({
  type: z.literal('setup'),
  sessionId: z.string(),
  callSid: z.string(),
  parentCallSid: z.string().optional(),
  from: z.string(),
  to: z.string(),
  forwardedFrom: z.string().optional(),
  callerName: z.string().optional(),
  direction: z.string(),
  callType: z.string(),
  callStatus: z.string(),
  accountSid: z.string(),
  customParameters: z.record(z.unknown()).optional(),
});

export type SetupMessage = z.infer<typeof SetupMessageSchema>;

/**
 * WebSocket prompt message (user speech)
 */
export const PromptMessageSchema = z.object({
  type: z.literal('prompt'),
  voicePrompt: z.string(),
  lang: z.string().optional(),
  last: z.boolean().optional(),
  agentSpeaking: z.string().optional(),
});

export type PromptMessage = z.infer<typeof PromptMessageSchema>;

/**
 * WebSocket interrupt message (user interruption)
 */
export const InterruptMessageSchema = z.object({
  type: z.literal('interrupt'),
  reason: z.string().optional(),
  transcript: z.string().optional(),
});

export type InterruptMessage = z.infer<typeof InterruptMessageSchema>;

/**
 * Union of all WebSocket message types
 */
export const WebSocketMessageSchema = z.union([
  SetupMessageSchema,
  PromptMessageSchema,
  InterruptMessageSchema,
]);

export type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;

/**
 * Response message to send back via WebSocket
 */
export const VoiceResponseSchema = z.object({
  type: z.literal('text'),
  token: z.string(),
  last: z.boolean().optional().default(true),
});

export type VoiceResponse = z.infer<typeof VoiceResponseSchema>;

/**
 * TwiML generation helpers
 */
export interface TwiMLOptions {
  websocketUrl: string;
  customParameters?: CustomParameters;
  /** Welcome greeting to play when call connects */
  welcomeGreeting?: string | undefined;
}

/**
 * Voice channel specific events
 */
export interface VoiceChannelEvents {
  setup: SetupMessage;
  prompt: PromptMessage;
  interrupt: InterruptMessage;
  error: Error;
}

/**
 * ConversationRelay callback payload from Twilio webhook
 */
export const ConversationRelayCallbackPayloadSchema = z.object({
  AccountSid: z.string(),
  CallSid: z.string(),
  CallStatus: z.string(), // 'in-progress', 'completed', 'busy', 'no-answer', 'failed'
  From: z.string(),
  To: z.string(),
  Direction: z.string().optional(),
  SessionId: z.string().optional(),
  SessionStatus: z.string().optional(),
  SessionDuration: z.string().optional(),
  HandoffData: z.string().optional(), // JSON string
});

export type ConversationRelayCallbackPayload = z.infer<
  typeof ConversationRelayCallbackPayloadSchema
>;

/**
 * Handoff data for Flex escalation
 */
export const HandoffDataSchema = z.object({
  reason: z.string(),
  call_summary: z.string(),
  sentiment: z.string(),
});

export type HandoffData = z.infer<typeof HandoffDataSchema>;
