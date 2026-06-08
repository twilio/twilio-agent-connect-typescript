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
 * Twilio uses the same four-value enum for several attributes that control
 * what caller input (DTMF, speech, both, neither) triggers a given behavior.
 */
export const InterruptModeSchema = z.enum(['none', 'dtmf', 'speech', 'any']);
export type InterruptMode = z.infer<typeof InterruptModeSchema>;

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
  /** What caller input can interrupt the welcome greeting. Defaults to 'any' on Twilio. */
  welcomeGreetingInterruptible: InterruptModeSchema.optional(),

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
  /**
   * What caller input interrupts TTS playback. Defaults to 'any'.
   * (Python's TwiMLOptions also accepts a boolean for backward compat; the
   * Twilio SDK's TS types only permit the string enum, so we expose the enum.)
   */
  interruptible: InterruptModeSchema.optional(),
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
 * Custom parameters passed via TwiML
 * Can contain any key-value pairs with unknown values
 */
export const CustomParametersSchema = z.record(z.unknown());

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
 * Extra-attribute escape hatch for ConversationRelay attributes not yet typed
 * on {@link ConversationRelayAttributes}.
 *
 * Keys are emitted as-is on `<ConversationRelay>`; the Twilio SDK lowercases
 * bools to 'true'/'false' and stringifies ints. Prefer a typed field when one
 * exists — `extra` is rejected at validation time if a key shadows a typed
 * field (see {@link ConversationRelayConfigSchema}).
 */
export const ConversationRelayExtraSchema = z.record(
  z.union([z.string(), z.boolean(), z.number()])
);
export type ConversationRelayExtra = z.infer<typeof ConversationRelayExtraSchema>;

/**
 * Extended ConversationRelay configuration that includes child elements and
 * the additional attributes Python's TwiMLOptions exposes that the Twilio TS
 * SDK does not yet type (emitted via a runtime-safe passthrough).
 *
 * Includes all ConversationRelayAttributes fields plus support for a languages
 * array, the extra escape hatch, and the not-yet-in-SDK attributes.
 *
 * Note: The type is defined as an explicit interface and the schema is annotated
 * with z.ZodType<ConversationRelayConfig> to prevent TypeScript's type inference
 * from collapsing to `any` when resolving complex Zod generics with many optional
 * fields (especially under exactOptionalPropertyTypes).
 */
export interface ConversationRelayConfig extends ConversationRelayAttributes {
  /** Optional language configurations as child <Language> elements */
  languages?: LanguageAttributes[] | undefined;

  // Attributes Python types on TwiMLOptions but the Twilio TS SDK does not yet
  // list on VoiceResponse.ConversationRelayAttributes. Emitted via passthrough.
  /** Confidence required to finish a turn (Deepgram + flux speech model only). */
  eotThreshold?: number | undefined;
  /** Use Deepgram Smart Format for transcription output. */
  deepgramSmartFormat?: boolean | undefined;
  /**
   * Silence (ms) after speech before finalizing the prompt — integer
   * milliseconds or the literal 'auto' (the platform default).
   */
  speechTimeout?: number | 'auto' | undefined;
  /** Filter short conversational feedback ('yeah', 'uh-huh', …) from interrupts. */
  ignoreBackchannel?: boolean | undefined;
  /** Space-separated event subscriptions, e.g. 'speaker-events tokens-played'. */
  events?: string | undefined;

  /**
   * URL for Twilio to request when the call ends (`<Connect action=...>`).
   * Resolved once across all layers — see VoiceChannel's action URL precedence.
   * Not a `<ConversationRelay>` attribute; consumed by the enclosing `<Connect>`.
   */
  actionUrl?: string | undefined;

  /**
   * Custom parameters emitted as `<Parameter>` children of `<ConversationRelay>`.
   * Replaces wholesale when set by a higher-priority layer.
   */
  customParameters?: CustomParameters | undefined;

  /** Escape hatch for ConversationRelay attributes not typed above. */
  extra?: ConversationRelayExtra | undefined;
}

/** Keys on ConversationRelayConfig that are handled outside the attribute loop. */
const CRELAY_NON_ATTRIBUTE_KEYS = ['languages', 'extra', 'actionUrl', 'customParameters'] as const;

/**
 * Every typed `<ConversationRelay>` attribute key — the SDK-aligned attributes
 * plus the not-yet-in-SDK attributes we add on the extended config. Used to
 * detect `extra` keys that shadow a typed field.
 */
const CRELAY_TYPED_ATTRIBUTE_KEYS: readonly string[] = [
  ...Object.keys(ConversationRelayAttributesSchema.shape),
  'eotThreshold',
  'deepgramSmartFormat',
  'speechTimeout',
  'ignoreBackchannel',
  'events',
];

/** Reject `extra` keys that shadow a typed `<ConversationRelay>` attribute. */
function refineNoExtraShadowing(
  config: { extra?: ConversationRelayExtra | undefined },
  ctx: z.RefinementCtx
): void {
  // Fail fast when `extra` includes a key that has a typed field — without this
  // the value would be silently dropped by the TwiML serializer in favor of the
  // typed default. Mirrors Python's validator.
  if (!config.extra) return;
  const typed = new Set(
    Object.keys(config).filter(k => !CRELAY_NON_ATTRIBUTE_KEYS.includes(k as never))
  );
  // Include all declared attribute keys, not just the ones currently set.
  for (const k of CRELAY_TYPED_ATTRIBUTE_KEYS) typed.add(k);
  const shadowed = Object.keys(config.extra)
    .filter(k => typed.has(k))
    .sort();
  if (shadowed.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['extra'],
      message:
        `extra keys ${JSON.stringify(shadowed)} shadow typed fields. ` +
        'Set the typed field directly instead of using extra.',
    });
  }
}

const ConversationRelayConfigShape = {
  /** Optional language configurations as child <Language> elements */
  languages: z.array(LanguageAttributesSchema).optional(),
  eotThreshold: z.number().optional(),
  deepgramSmartFormat: z.boolean().optional(),
  speechTimeout: z.union([z.number().int(), z.literal('auto')]).optional(),
  ignoreBackchannel: z.boolean().optional(),
  events: z.string().optional(),
  actionUrl: z.string().url().optional(),
  customParameters: CustomParametersSchema.optional(),
  extra: ConversationRelayExtraSchema.optional(),
};

export const ConversationRelayConfigSchema: z.ZodType<ConversationRelayConfig> =
  ConversationRelayAttributesSchema.extend(ConversationRelayConfigShape).superRefine(
    refineNoExtraShadowing
  );

/**
 * Layering input for the TwiML inside `<ConversationRelay>` — the same surface
 * as {@link ConversationRelayConfig} but with `url` omitted, since the channel
 * resolves the WebSocket URL from TACConfig. Used for
 * `VoiceChannelConfig.defaultTwimlOptions`, the inbound customizer return value,
 * and `InitiateVoiceConversationOptions.twimlOptions`. Mirrors Python's
 * `TwiMLOptions`.
 */
export type ConversationRelayOptions = Omit<ConversationRelayConfig, 'url'>;

export const ConversationRelayOptionsSchema: z.ZodType<ConversationRelayOptions> =
  ConversationRelayAttributesSchema.omit({ url: true })
    .extend(ConversationRelayConfigShape)
    .superRefine(refineNoExtraShadowing);

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
});

export type ConversationRelayCallbackPayload = z.infer<
  typeof ConversationRelayCallbackPayloadSchema
>;

/**
 * Framework-neutral view of the Twilio TwiML webhook form.
 *
 * Populated by TACServer from the incoming Twilio webhook, then passed to a
 * customizer registered via `VoiceChannel.onInboundCallTwiml(...)` so the
 * application can produce per-call TwiML overrides without depending on
 * Fastify types.
 */
export interface TwiMLRequest {
  from?: string | undefined;
  to?: string | undefined;
  callSid?: string | undefined;
  callerCountry?: string | undefined;
  callerState?: string | undefined;
  callerCity?: string | undefined;
  direction?: string | undefined;
  /** Any other fields from the Twilio webhook not captured above (always strings). */
  extra: Record<string, string>;
}

/** Map of TwiMLRequest field -> the Twilio webhook form key it reads from. */
const TWIML_REQUEST_FIELD_KEYS: Record<Exclude<keyof TwiMLRequest, 'extra'>, string> = {
  from: 'From',
  to: 'To',
  callSid: 'CallSid',
  callerCountry: 'CallerCountry',
  callerState: 'CallerState',
  callerCity: 'CallerCity',
  direction: 'Direction',
};

/**
 * Build a TwiMLRequest from a raw Twilio form dict, bucketing unknown keys
 * into `extra`. Mirrors Python's `TwiMLRequest.from_form`.
 */
export function twimlRequestFromForm(form: Record<string, string>): TwiMLRequest {
  const knownByKey = new Map(
    Object.entries(TWIML_REQUEST_FIELD_KEYS).map(([field, key]) => [key, field])
  );
  const request: TwiMLRequest = { extra: {} };
  for (const [key, value] of Object.entries(form)) {
    const field = knownByKey.get(key);
    if (field) {
      (request as unknown as Record<string, unknown>)[field] = value;
    } else {
      request.extra[key] = value;
    }
  }
  return request;
}

/** Async or sync callback that produces per-call inbound TwiML overrides. */
export type InboundCallTwiMLHandler = (
  request: TwiMLRequest
) => Promise<ConversationRelayOptions> | ConversationRelayOptions;

// =========================================================================
// Outbound Voice Conversation Types
// =========================================================================

/**
 * Options for initiating an outbound voice conversation.
 *
 * TwiML for the outbound call is built by merging per-field, highest precedence
 * first: this call's `twimlOptions`, then the channel's `defaultTwimlOptions`,
 * then TAC defaults (welcome greeting, conversationConfiguration, action URL).
 */
export interface InitiateVoiceConversationOptions {
  to: string;
  from?: string | undefined;
  /**
   * Public WebSocket URL override (e.g. `wss://your-domain.ngrok.app/ws`).
   * Optional — defaults to the URL derived from TACConfig.voicePublicDomain +
   * voiceWebsocketPath. Pass it here only to override for a specific call.
   */
  websocketUrl?: string | undefined;
  /** Per-call overrides for the TwiML inside `<ConversationRelay>`. */
  twimlOptions?: ConversationRelayOptions | undefined;
}

export const InitiateVoiceConversationOptionsSchema: z.ZodType<InitiateVoiceConversationOptions> =
  z.object({
    to: z.string().min(1, 'Recipient phone number is required'),
    from: z.string().optional(),
    websocketUrl: z.string().optional(),
    twimlOptions: ConversationRelayOptionsSchema.optional(),
  });
