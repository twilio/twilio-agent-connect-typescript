import { z } from 'zod';
import type VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';

/**
 * ConversationRelay API Types
 *
 * Zod schemas are the single source of truth for runtime validation. Types are
 * inferred from schemas via z.infer. Compile-time drift guards (type assertions
 * against VoiceResponse.ConversationRelayAttributes / LanguageAttributes) ensure
 * that if the Twilio SDK types change, `npm run typecheck` will fail immediately.
 *
 * @see https://www.twilio.com/docs/voice/conversationrelay
 * @see https://www.twilio.com/docs/voice/conversationrelay/conversationrelay-noun
 */

/**
 * Language configuration for multi-language ConversationRelay support
 * @see https://www.twilio.com/docs/voice/conversationrelay/conversationrelay-noun#language-attributes
 */
export const LanguageAttributesSchema = z.object({
  /** Language code (e.g., 'en-US', 'es-ES', 'en-AU') */
  code: z.string(),
  /** TTS provider for this language */
  ttsProvider: z.string().optional(),
  /** TTS voice for this language */
  voice: z.string().optional(),
  /** TTS language (may differ from code) */
  ttsLanguage: z.string().optional(),
  /** Transcription provider for this language */
  transcriptionProvider: z.string().optional(),
  /** Speech model for transcription */
  speechModel: z.string().optional(),
  /** Transcription language (may differ from code) */
  transcriptionLanguage: z.string().optional(),
});

export type LanguageAttributes = z.infer<typeof LanguageAttributesSchema>;

/**
 * ConversationRelay attributes for TwiML configuration
 * @see https://www.twilio.com/docs/voice/conversationrelay/conversationrelay-noun
 */
export const ConversationRelayAttributesSchema = z.object({
  /** WebSocket URL for ConversationRelay (required) */
  url: z.string().url(),

  // Welcome greeting settings
  /** Initial greeting to play when call connects */
  welcomeGreeting: z.string().optional(),
  /** Whether welcome greeting can be interrupted */
  welcomeGreetingInterruptible: z.enum(['any', 'speech', 'none']).optional(),

  // Transcription settings
  /** Transcription provider (e.g., 'Deepgram', 'Google') */
  transcriptionProvider: z.string().optional(),
  /** Language for transcription (e.g., 'en-US') */
  transcriptionLanguage: z.string().optional(),
  /** Speech model for transcription (e.g., 'nova-3-general') */
  speechModel: z.string().optional(),

  // TTS settings
  /** Text-to-speech provider (e.g., 'Google', 'ElevenLabs') */
  ttsProvider: z.string().optional(),
  /** Language for TTS (e.g., 'en-US') */
  ttsLanguage: z.string().optional(),
  /** Voice identifier for TTS (e.g., 'en-US-Journey-O') */
  voice: z.string().optional(),
  /** ElevenLabs text normalization setting */
  elevenlabsTextNormalization: z.string().optional(),

  // Interaction settings
  /** When agent speech can be interrupted */
  interruptible: z.enum(['any', 'speech', 'none']).optional(),
  /** Interrupt detection sensitivity */
  interruptSensitivity: z.enum(['low', 'medium', 'high']).optional(),
  /** Enable DTMF tone detection */
  dtmfDetection: z.boolean().optional(),
  /** Recognition hints for domain-specific vocabulary */
  hints: z.string().optional(),
  /** Whether prompts should be reported when TTS is playing and interrupt is disabled */
  reportInputDuringAgentSpeech: z.boolean().optional(),

  // Advanced settings
  /** Enable partial prompts (streaming) */
  partialPrompts: z.boolean().optional(),
  /** Enable profanity filtering */
  profanityFilter: z.boolean().optional(),
  /** Allow preemption of agent speech */
  preemptible: z.boolean().optional(),
  /** Default language code */
  language: z.string().optional(),
  /** Debug options for troubleshooting (string per SDK, not boolean) */
  debug: z.string().optional(),

  // Intelligence service
  /** Conversational Intelligence Service ID or unique name */
  intelligenceService: z.string().optional(),

  // Conversation orchestrator
  /** Twilio Conversation Orchestrator configuration ID */
  conversationConfiguration: z.string().optional(),
});

export type ConversationRelayAttributes = z.infer<typeof ConversationRelayAttributesSchema>;

/**
 * @internal Compile-time SDK drift guards — do not use directly.
 * If the Twilio SDK updates VoiceResponse.ConversationRelayAttributes or
 * VoiceResponse.LanguageAttributes, these checks will fail during typecheck,
 * signaling that our Zod schemas need to be updated to match.
 */
export type _SDKDriftGuards = {
  langCompat: LanguageAttributes extends VoiceResponse.LanguageAttributes ? true : never;
  langKeys: keyof VoiceResponse.LanguageAttributes extends keyof LanguageAttributes ? true : never;
  crelayCompat: ConversationRelayAttributes extends VoiceResponse.ConversationRelayAttributes
    ? true
    : never;
  crelayKeys: keyof VoiceResponse.ConversationRelayAttributes extends keyof ConversationRelayAttributes
    ? true
    : never;
};

/**
 * Custom parameters passed via TwiML <Parameter> elements.
 * Values must be primitives — TwiML parameters are string-valued.
 */
export const CustomParametersSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

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
  utteranceUntilInterrupt: z.string().optional(),
  durationUntilInterruptMs: z.number().int().nonnegative().optional(),
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
 * Text Token Message to send back via WebSocket
 * @see https://www.twilio.com/docs/voice/conversationrelay/websocket-messages#text-tokens-message
 */
export const TextTokenMessageSchema = z.object({
  type: z.literal('text'),
  token: z.string(),
  last: z.boolean().optional().default(true),
});

export type TextTokenMessage = z.infer<typeof TextTokenMessageSchema>;

/**
 * Extended ConversationRelay configuration that includes child elements.
 * Includes all ConversationRelayAttributes fields plus support for languages array.
 *
 * Note: The type is defined as an explicit interface and the schema is annotated
 * with z.ZodType<ConversationRelayConfig> to prevent TypeScript's type inference
 * from collapsing to `any` when resolving complex Zod generics with many optional
 * fields (especially under exactOptionalPropertyTypes).
 */
export interface ConversationRelayConfig extends ConversationRelayAttributes {
  /** Optional language configurations as child <Language> elements */
  languages?: LanguageAttributes[] | undefined;
}

export const ConversationRelayConfigSchema: z.ZodType<ConversationRelayConfig> =
  ConversationRelayAttributesSchema.extend({
    /** Optional language configurations as child <Language> elements */
    languages: z.array(LanguageAttributesSchema).optional(),
  });

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
 *
 * Sent when a ConversationRelay session ends or transitions state.
 * Includes standard voice webhook parameters plus ConversationRelay-specific fields.
 *
 * @see https://www.twilio.com/docs/voice/twiml#request-parameters
 * @see https://www.twilio.com/docs/voice/conversationrelay/conversationrelay-noun#statuscallback
 */
export const ConversationRelayCallbackPayloadSchema = z.object({
  // Core Twilio identifiers (required)
  AccountSid: z.string(),
  CallSid: z.string(),

  /** Call status with strict type checking for all valid Twilio call states */
  CallStatus: z.enum([
    'queued',
    'initiated',
    'ringing',
    'in-progress',
    'completed',
    'busy',
    'no-answer',
    'failed',
    'canceled',
  ]),

  // Call participants (required)
  From: z.string(),
  To: z.string(),

  /** Direction of the call */
  Direction: z.enum(['inbound', 'outbound-api', 'outbound-dial']),

  // Standard voice webhook parameters (optional)
  ApiVersion: z.string().optional(),
  ForwardedFrom: z.string().optional(),
  CallerName: z.string().optional(),
  ParentCallSid: z.string().optional(),
  ApplicationSid: z.string().optional(),

  // ConversationRelay session information (optional)
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

// =========================================================================
// Outbound Voice Conversation Types
// =========================================================================

/**
 * Options for initiating an outbound voice conversation
 */
export interface InitiateVoiceConversationOptions {
  to: string;
  from?: string | undefined;
  conversationRelayConfig: ConversationRelayConfig;
  actionUrl?: string | undefined;
}

export const InitiateVoiceConversationOptionsSchema: z.ZodType<InitiateVoiceConversationOptions> =
  z.object({
    to: z.string().min(1, 'Recipient phone number is required'),
    from: z.string().optional(),
    conversationRelayConfig: ConversationRelayConfigSchema,
    actionUrl: z.string().url().optional(),
  });
