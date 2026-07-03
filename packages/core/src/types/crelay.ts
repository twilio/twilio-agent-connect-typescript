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
  url: z.url(),

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
 * Custom parameters passed via TwiML
 * Can contain any key-value pairs with unknown values
 */
export const CustomParametersSchema = z.record(z.string(), z.unknown());

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
  customParameters: z.record(z.string(), z.unknown()).optional(),
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

// =========================================================================
// TwiML customization layer
// =========================================================================

/**
 * Twilio uses the same four-value enum for several attributes that control
 * what caller input (DTMF, speech, both, neither) triggers a given behavior.
 */
export const InterruptModeSchema = z.enum(['none', 'dtmf', 'speech', 'any']);
export type InterruptMode = z.infer<typeof InterruptModeSchema>;

/**
 * A single `<Language>` child for multi-language ConversationRelay setups.
 *
 * Maps to the `<Language>` element documented at
 * https://www.twilio.com/docs/voice/twiml/connect/conversationrelay#language-element
 *
 * Distinct from {@link LanguageAttributes} (the Twilio-SDK-shaped type used by
 * `connectConversationRelay`): this is the customization-facing model used in
 * {@link TwiMLOptions}, mirroring the Python SDK's `LanguageConfig`.
 */
export const LanguageConfigSchema = z.object({
  /**
   * Language code, e.g. 'es-MX'. Can be 'multi' for automatic language
   * detection (requires ElevenLabs TTS and Deepgram STT).
   */
  code: z.string(),
  /** TTS voice name for this language */
  voice: z.string().optional(),
  /** TTS provider, e.g. 'google' */
  ttsProvider: z.string().optional(),
  /** Transcription provider, e.g. 'deepgram' */
  transcriptionProvider: z.string().optional(),
  /** Speech model for STT. Choices vary by transcriptionProvider. */
  speechModel: z.string().optional(),
});

export type LanguageConfig = z.infer<typeof LanguageConfigSchema>;

/**
 * Options for the TwiML inside `<ConversationRelay>` (plus the
 * `<Connect action>` URL).
 *
 * Fields map to the attributes documented at
 * https://www.twilio.com/docs/voice/twiml/connect/conversationrelay . All
 * fields are optional. `VoiceChannel.handleIncomingCall` merges these values
 * over TAC defaults per-field — only fields explicitly present on the object
 * override lower layers (see `VoiceChannel`'s overlay logic).
 *
 * This is the customization-facing counterpart to {@link ConversationRelayConfig}
 * (which is the Twilio-SDK-shaped emit model and carries the required `url`).
 * Mirrors the Python SDK's `TwiMLOptions`.
 */
export const TwiMLOptionsSchema = z
  .object({
    /** Custom parameters to pass to ConversationRelay as `<Parameter>` children */
    customParameters: CustomParametersSchema.optional(),
    /** Initial greeting message for the caller */
    welcomeGreeting: z.string().optional(),
    /**
     * What caller input can interrupt the welcome greeting.
     * Defaults to 'any' on Twilio.
     */
    welcomeGreetingInterruptible: InterruptModeSchema.optional(),
    /** URL for Twilio to request when the call ends (`<Connect action>`) */
    actionUrl: z.string().optional(),
    /**
     * Conversation Service SID. When set, ConversationRelay will manage
     * conversation creation and participants.
     */
    conversationConfiguration: z.string().optional(),
    /**
     * ConversationRelay WebSocket URL (the `<ConversationRelay url=...>`
     * attribute). Leave unset (the default) to use the URL the channel derives
     * from `TACConfig.voicePublicDomain` + `voiceWebsocketPath`. Set it only for
     * a per-call URL — e.g. an affinity-routed host that appends a token to the
     * upgrade URL — typically from an `onInboundCallTwiml` customizer. Like every
     * other field, it layers customizer > defaultTwimlOptions > TAC default.
     */
    websocketUrl: z.string().optional(),

    // Language, TTS, STT
    /**
     * Language for both STT and TTS, e.g. 'en-US'. Equivalent to setting both
     * ttsLanguage and transcriptionLanguage.
     */
    language: z.string().optional(),
    /** TTS language code; overrides `language` for TTS. */
    ttsLanguage: z.string().optional(),
    /**
     * STT language code; overrides `language` for transcription. Can be
     * 'multi' for automatic language detection (Deepgram only).
     */
    transcriptionLanguage: z.string().optional(),
    /** TTS voice name (choices vary by ttsProvider) */
    voice: z.string().optional(),
    /** TTS provider: 'Google', 'Amazon', or 'ElevenLabs'. Defaults to 'ElevenLabs'. */
    ttsProvider: z.string().optional(),
    /**
     * STT provider: 'Google' or 'Deepgram'. Defaults to 'Deepgram' (or 'Google'
     * for accounts that used ConversationRelay before 2025-09-12).
     */
    transcriptionProvider: z.string().optional(),
    /** Speech model for STT. Choices vary by transcriptionProvider. */
    speechModel: z.string().optional(),
    /**
     * Text normalization for ElevenLabs TTS. Defaults to 'off'. 'auto' behaves
     * like 'off' for ConversationRelay calls.
     */
    elevenlabsTextNormalization: z.enum(['on', 'auto', 'off']).optional(),

    // Turn detection / interruption
    /**
     * Confidence required to finish a turn. Only applies with Deepgram + flux
     * speech model. Twilio enforces the accepted range — see ConversationRelay docs.
     */
    eotThreshold: z.number().optional(),
    /**
     * Send unfinalized prompts and eager end-of-turn events (last=false). Only
     * applies with Deepgram + flux speech model.
     */
    partialPrompts: z.boolean().optional(),
    /**
     * Use Deepgram Smart Format for transcription output. Defaults to true when
     * transcriptionProvider='Deepgram'.
     */
    deepgramSmartFormat: z.boolean().optional(),
    /**
     * Silence (ms) after speech before finalizing the prompt. Integer
     * milliseconds or the literal 'auto' (the platform default). Twilio enforces
     * the accepted range — see ConversationRelay docs.
     */
    speechTimeout: z.union([z.number().int(), z.literal('auto')]).optional(),
    /**
     * What caller input interrupts TTS playback. Boolean accepted for backward
     * compat: true='any', false='none'. Defaults to 'any'.
     */
    interruptible: z.union([InterruptModeSchema, z.boolean()]).optional(),
    /** How easily caller speech triggers an interrupt. Defaults to 'high'. */
    interruptSensitivity: z.enum(['high', 'medium', 'low']).optional(),
    /**
     * What caller input gets reported while the agent is speaking (independent
     * of whether playback is interrupted). Defaults to 'none' since May 2025.
     */
    reportInputDuringAgentSpeech: InterruptModeSchema.optional(),
    /**
     * Filter short conversational feedback ('yeah', 'uh-huh', …) so it doesn't
     * interrupt the agent. Defaults to false.
     */
    ignoreBackchannel: z.boolean().optional(),
    /**
     * Allow text tokens from the next talk cycle to interrupt the current one.
     * Defaults to false.
     */
    preemptible: z.boolean().optional(),
    /** Emit DTMF keypress events over the WebSocket. */
    dtmfDetection: z.boolean().optional(),

    // Recognition hints / events / debug / intelligence
    /**
     * Comma-separated words/phrases likely to appear in speech. Capitalize
     * proper nouns.
     */
    hints: z.string().optional(),
    /** Space-separated event subscriptions, e.g. 'speaker-events tokens-played'. */
    events: z.string().optional(),
    /**
     * Debug subscription, e.g. 'debugging'. Note: 'speaker-events' and
     * 'tokens-played' have moved to the `events` attribute — only use them here
     * for backward compatibility.
     */
    debug: z.string().optional(),
    /**
     * Conversation Intelligence (classic) Service SID or unique name for
     * persisting transcripts and running Language Operators.
     */
    intelligenceService: z.string().optional(),

    // Nested <Language> children
    /** Additional `<Language>` children for multi-language support */
    languages: z.array(LanguageConfigSchema).optional(),

    /**
     * Escape hatch for ConversationRelay attributes not yet typed on this model.
     * Keys are emitted as-is on `<ConversationRelay>`; Twilio's SDK converts
     * snake_case to camelCase, lowercases bools to 'true'/'false', and
     * stringifies numbers. Prefer a typed field when one exists — use `extra`
     * only for newly-added Twilio attributes not yet in this SDK.
     */
    extra: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
  })
  // Forbid unknown keys so a typo in a field name fails loudly rather than
  // being silently dropped from the emitted TwiML.
  .strict()
  // Fail fast when `extra` includes a key that has a typed field on this model.
  // Without this, the user's value would be silently dropped by the TwiML
  // serializer in favor of the typed default — a footgun.
  .superRefine((value, ctx) => {
    if (!value.extra) return;
    const typed = new Set(Object.keys(TwiMLOptionsShape).filter(k => k !== 'extra'));
    const shadowed = Object.keys(value.extra)
      .filter(k => typed.has(k))
      .sort();
    if (shadowed.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['extra'],
        message:
          `TwiMLOptions.extra keys [${shadowed.join(', ')}] shadow typed fields. ` +
          'Set the typed field directly instead of using `extra`.',
      });
    }
  });

/**
 * @internal Field names of {@link TwiMLOptionsSchema}, used by the shadow-guard
 * refinement above. Declared separately because `.strict().superRefine(...)`
 * erases the object shape on the schema instance.
 */
const TwiMLOptionsShape = {
  customParameters: true,
  welcomeGreeting: true,
  welcomeGreetingInterruptible: true,
  actionUrl: true,
  conversationConfiguration: true,
  websocketUrl: true,
  language: true,
  ttsLanguage: true,
  transcriptionLanguage: true,
  voice: true,
  ttsProvider: true,
  transcriptionProvider: true,
  speechModel: true,
  elevenlabsTextNormalization: true,
  eotThreshold: true,
  partialPrompts: true,
  deepgramSmartFormat: true,
  speechTimeout: true,
  interruptible: true,
  interruptSensitivity: true,
  reportInputDuringAgentSpeech: true,
  ignoreBackchannel: true,
  preemptible: true,
  dtmfDetection: true,
  hints: true,
  events: true,
  debug: true,
  intelligenceService: true,
  languages: true,
  extra: true,
} as const;

export type TwiMLOptions = z.infer<typeof TwiMLOptionsSchema>;

/**
 * Framework-neutral view of the Twilio TwiML webhook form.
 *
 * Populated by `TACServer` from the incoming Twilio webhook, then passed to a
 * customizer registered via `VoiceChannel.onInboundCallTwiml(...)` so the
 * application can produce per-call {@link TwiMLOptions} overrides without
 * depending on Fastify types. Mirrors the Python SDK's `TwiMLRequest`.
 */
export const TwiMLRequestSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  callSid: z.string().optional(),
  callerCountry: z.string().optional(),
  callerState: z.string().optional(),
  callerCity: z.string().optional(),
  direction: z.string().optional(),
  /**
   * Any other fields from the Twilio webhook not captured above. Values are
   * always strings here (webhook form fields are url-encoded), unlike
   * TwiMLOptions.extra which accepts string | boolean | number for emitted
   * TwiML attributes.
   */
  extra: z.record(z.string(), z.string()).default({}),
});

export type TwiMLRequest = z.infer<typeof TwiMLRequestSchema>;

/**
 * Map from Twilio webhook form field names to {@link TwiMLRequest} keys.
 * Fields not in this map are bucketed into `extra` by {@link twiMLRequestFromForm}.
 */
const TWIML_REQUEST_FORM_ALIASES: Record<string, keyof Omit<TwiMLRequest, 'extra'>> = {
  From: 'from',
  To: 'to',
  CallSid: 'callSid',
  CallerCountry: 'callerCountry',
  CallerState: 'callerState',
  CallerCity: 'callerCity',
  Direction: 'direction',
};

/**
 * Build a {@link TwiMLRequest} from a raw Twilio form dict, bucketing unknown
 * keys into `extra`. Mirrors the Python SDK's `TwiMLRequest.from_form`.
 */
export function twiMLRequestFromForm(form: Record<string, string>): TwiMLRequest {
  const known: Record<string, string> = {};
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    const alias = TWIML_REQUEST_FORM_ALIASES[key];
    if (alias) {
      known[alias] = value;
    } else {
      extra[key] = value;
    }
  }
  return TwiMLRequestSchema.parse({ ...known, extra });
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

// =========================================================================
// Outbound Voice Conversation Types
// =========================================================================

/**
 * Options for initiating an outbound voice conversation.
 *
 * The caller identity is always TAC's configured `config.phoneNumber`.
 * Multi-number deployments should run one TAC instance per line.
 *
 * TwiML for the outbound call is built by merging per-field, highest precedence
 * first:
 *   1. This call's `twimlOptions` (per-call overrides)
 *   2. `VoiceChannelConfig.defaultTwimlOptions` (channel-wide defaults)
 *   3. TAC defaults (welcome greeting, conversationConfiguration, actionUrl
 *      resolved via Studio handoff if configured, else derived from
 *      `TACConfig.voicePublicDomain` + `voiceActionPath`)
 *
 * Fields you don't set at a layer fall through to lower layers — so
 * `twimlOptions: { voice: 'es-MX-Neural2-A' }` on this call overrides only
 * `voice`; `language`, `interruptible`, etc. from the channel config still apply.
 */
export interface InitiateVoiceConversationOptions {
  to: string;
  /**
   * Public WebSocket URL for ConversationRelay (e.g. 'wss://your-domain.ngrok.app/ws').
   * Optional — defaults to the URL derived from `TACConfig.voicePublicDomain` +
   * `voiceWebsocketPath`. Pass it here only to override the URL for a specific call.
   */
  websocketUrl?: string | undefined;
  /**
   * Per-call overrides for the TwiML inside `<ConversationRelay>`. Merged over
   * `VoiceChannelConfig.defaultTwimlOptions` and TAC defaults.
   */
  twimlOptions?: TwiMLOptions | undefined;
}

export const InitiateVoiceConversationOptionsSchema: z.ZodType<InitiateVoiceConversationOptions> = z
  .object({
    to: z.string().min(1, 'Recipient phone number is required'),
    websocketUrl: z.url().optional(),
    twimlOptions: TwiMLOptionsSchema.optional(),
  })
  // Reject removed flat fields (welcomeGreeting, actionUrl, customParameters,
  // conversationRelayConfig) so callers upgrading from older TAC versions get
  // a clear error instead of having their values silently dropped.
  .strict();
