import { z } from 'zod';
import type VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import type { CallListInstanceCreateOptions } from 'twilio/lib/rest/api/v2010/account/call.js';

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
    /**
     * URL for Twilio to request when the call ends (`<Connect action>`). Set to
     * a non-empty URL, or leave unset. An explicit `undefined` suppresses the
     * action entirely (see `VoiceChannel`'s actionUrl resolution); an empty
     * string is rejected so it can't silently drop the action.
     */
    actionUrl: z.string().min(1, 'actionUrl must not be empty').optional(),
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
     * upgrade URL — typically from an `onInboundCallTwiml` customizer. Layers
     * per-field like every other field. Must be non-empty when set.
     */
    websocketUrl: z.string().min(1, 'websocketUrl must not be empty').optional(),

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
// Call Events (status callback, async AMD, recording status)
// =========================================================================

/**
 * Split a Twilio webhook form into aliased fields and everything else.
 *
 * Unknown keys — including fields that belong to a different call event — are
 * bucketed rather than dropped, so a handler can still reach them via `extra`.
 */
function splitCallEventForm(
  form: Record<string, string>,
  aliases: Record<string, string>
): { known: Record<string, string>; extra: Record<string, string> } {
  const known: Record<string, string> = {};
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    const alias = aliases[key];
    if (alias) {
      known[alias] = value;
    } else {
      extra[key] = value;
    }
  }
  return { known, extra };
}

/**
 * Fields shared by the three Twilio call-webhook events.
 *
 * `callSid` is the correlation key across every surface — it matches
 * `ConversationSession.callSid` and the SID from
 * `initiateOutboundConversation`. It's required: every real call webhook
 * carries one, and defaulting it would hand handlers an empty SID to act on
 * (`endCall('')` is a Twilio 404). Missing or blank fails validation, which the
 * channel turns into a 400.
 */
const CallEventBaseShape = {
  callSid: z.string().min(1, 'CallSid is required'),
  accountSid: z.string().optional(),
  /** Any other Twilio webhook fields not surfaced above. */
  extra: z.record(z.string(), z.string()).default({}),
};

const CALL_EVENT_BASE_ALIASES = {
  CallSid: 'callSid',
  AccountSid: 'accountSid',
} as const;

/**
 * Call statuses that mean the call ended without reaching the callee — i.e.
 * worth a retry.
 */
const UNREACHED_CALL_STATUSES: readonly string[] = ['busy', 'no-answer', 'failed', 'canceled'];

/**
 * A Twilio `statusCallback` webhook — call progress and disposition.
 *
 * By default Twilio sends only the terminal event, which covers every
 * disposition (`completed` / `busy` / `no-answer` / `failed` / `canceled`); set
 * `CallOptions.statusCallbackEvent` for the intermediate ones. Register a
 * handler via `VoiceChannel.onCallStatus`.
 *
 * `isUnreached` is computed at parse time so application code doesn't have to
 * match disposition strings itself.
 */
export const CallStatusEventSchema = z
  .object({
    ...CallEventBaseShape,
    callStatus: z.string().optional(),
    callDuration: z.string().optional(),
    sipResponseCode: z.string().optional(),
  })
  .transform(event => ({
    ...event,
    /** Call ended without reaching the callee — i.e. worth a retry. */
    isUnreached: UNREACHED_CALL_STATUSES.includes(event.callStatus ?? ''),
  }));

export type CallStatusEvent = z.infer<typeof CallStatusEventSchema>;

const CALL_STATUS_EVENT_ALIASES: Record<string, string> = {
  ...CALL_EVENT_BASE_ALIASES,
  CallStatus: 'callStatus',
  CallDuration: 'callDuration',
  SipResponseCode: 'sipResponseCode',
};

/** Build a {@link CallStatusEvent} from a raw Twilio webhook form. */
export function callStatusEventFromForm(form: Record<string, string>): CallStatusEvent {
  const { known, extra } = splitCallEventForm(form, CALL_STATUS_EVENT_ALIASES);
  return CallStatusEventSchema.parse({ ...known, extra });
}

/**
 * A Twilio `asyncAmdStatusCallback` webhook — answering machine detection.
 *
 * Fires at most once per call, and only when the call set both
 * `CallOptions.machineDetection` and `asyncAmd`.
 *
 * `answeredBy` is mode-dependent — `machine_start` under `'Enable'`,
 * `machine_end_beep` / `machine_end_silence` / `machine_end_other` under
 * `'DetectMessageEnd'`, plus `human` / `fax` / `unknown` in both. Use
 * `isMachine` rather than matching those yourself. Register a handler via
 * `VoiceChannel.onAmd`.
 */
export const AmdEventSchema = z
  .object({
    ...CallEventBaseShape,
    answeredBy: z.string().optional(),
    machineDetectionDuration: z.string().optional(),
  })
  .transform(event => ({
    ...event,
    /**
     * A machine answered — any `machine_*` value, either mode. `unknown`
     * (detection timed out) is false, so a call is never hung up on a guess.
     */
    isMachine: (event.answeredBy ?? '').startsWith('machine'),
  }));

export type AmdEvent = z.infer<typeof AmdEventSchema>;

const AMD_EVENT_ALIASES: Record<string, string> = {
  ...CALL_EVENT_BASE_ALIASES,
  AnsweredBy: 'answeredBy',
  MachineDetectionDuration: 'machineDetectionDuration',
};

/** Build an {@link AmdEvent} from a raw Twilio webhook form. */
export function amdEventFromForm(form: Record<string, string>): AmdEvent {
  const { known, extra } = splitCallEventForm(form, AMD_EVENT_ALIASES);
  return AmdEventSchema.parse({ ...known, extra });
}

/**
 * A Twilio `recordingStatusCallback` webhook — a recording became available.
 *
 * Fires when the recording is ready (`recordingUrl` accessible), only when
 * recording is enabled. Register a handler via `VoiceChannel.onRecording`.
 */
export const RecordingEventSchema = z.object({
  ...CallEventBaseShape,
  recordingSid: z.string().optional(),
  recordingUrl: z.string().optional(),
  recordingStatus: z.string().optional(),
  recordingDuration: z.string().optional(),
});

export type RecordingEvent = z.infer<typeof RecordingEventSchema>;

const RECORDING_EVENT_ALIASES: Record<string, string> = {
  ...CALL_EVENT_BASE_ALIASES,
  RecordingSid: 'recordingSid',
  RecordingUrl: 'recordingUrl',
  RecordingStatus: 'recordingStatus',
  RecordingDuration: 'recordingDuration',
};

/** Build a {@link RecordingEvent} from a raw Twilio webhook form. */
export function recordingEventFromForm(form: Record<string, string>): RecordingEvent {
  const { known, extra } = splitCallEventForm(form, RECORDING_EVENT_ALIASES);
  return RecordingEventSchema.parse({ ...known, extra });
}

// =========================================================================
// Calls API parameters (calls.create passthrough)
// =========================================================================

/**
 * Every parameter `client.calls.create()` accepts, as of the pinned Twilio SDK.
 *
 * Unlike Python's `inspect.signature`, TypeScript has no runtime view of a
 * function's accepted keys, so the set is listed here and pinned to the SDK by
 * {@link _CallsCreateDriftGuards} at typecheck time. It's needed at runtime
 * because the Node SDK builds its request body from an explicit whitelist —
 * an unrecognized key is **silently dropped**, not an error, so without this a
 * typo would look like it worked.
 */
const CALLS_CREATE_PARAMS = [
  'applicationSid',
  'asyncAmd',
  'asyncAmdStatusCallback',
  'asyncAmdStatusCallbackMethod',
  'byoc',
  'callerId',
  'callReason',
  'callToken',
  'clientNotificationUrl',
  'fallbackMethod',
  'fallbackUrl',
  'from',
  'machineDetection',
  'machineDetectionSilenceTimeout',
  'machineDetectionSpeechEndThreshold',
  'machineDetectionSpeechThreshold',
  'machineDetectionTimeout',
  'method',
  'record',
  'recordingChannels',
  'recordingStatusCallback',
  'recordingStatusCallbackEvent',
  'recordingStatusCallbackMethod',
  'recordingTrack',
  'sendDigits',
  'sipAuthPassword',
  'sipAuthUsername',
  'statusCallback',
  'statusCallbackEvent',
  'statusCallbackMethod',
  'timeLimit',
  'timeout',
  'to',
  'trim',
  'twiml',
  'url',
] as const;

/**
 * `calls.create` parameters TAC owns — it builds the call and its TwiML, so a
 * caller setting these would either be overwritten or break the call.
 */
const RESERVED_CALL_PARAMS = ['to', 'from', 'twiml', 'url', 'applicationSid'] as const;

type ReservedCallParam = (typeof RESERVED_CALL_PARAMS)[number];

/**
 * The `calls.create` parameters TAC types explicitly — the ones outbound
 * ConversationRelay reaches for. Everything else the SDK accepts is still
 * forwarded, typed by the SDK itself via {@link CallOptions}.
 */
export interface TypedCallOptions {
  /**
   * Enables AMD. `'Enable'` reports as soon as it can tell human from machine
   * (to hang up on voicemail); `'DetectMessageEnd'` waits out the greeting (to
   * leave a message). Required, together with `asyncAmd`, for `onAmd` to fire.
   */
  machineDetection?: 'Enable' | 'DetectMessageEnd' | undefined;
  /**
   * Detect in the background. Required for `onAmd`: with it off, `AnsweredBy`
   * comes back on the TwiML request, which inline TwiML can't receive.
   *
   * Twilio's API types this as a string; a boolean is serialized for you.
   */
  asyncAmd?: boolean | string | undefined;
  asyncAmdStatusCallback?: string | undefined;
  asyncAmdStatusCallbackMethod?: string | undefined;
  machineDetectionTimeout?: number | undefined;
  machineDetectionSpeechThreshold?: number | undefined;
  machineDetectionSpeechEndThreshold?: number | undefined;
  machineDetectionSilenceTimeout?: number | undefined;

  /** Required for `onRecording`. */
  record?: boolean | undefined;
  recordingStatusCallback?: string | undefined;
  recordingStatusCallbackEvent?: string[] | undefined;
  recordingChannels?: string | undefined;
  recordingTrack?: string | undefined;

  statusCallback?: string | undefined;
  /**
   * Lifecycle events to report. Omitted, Twilio sends only `'completed'` —
   * which covers busy/canceled/failed/no-answer. Set it for ringing/answered.
   */
  statusCallbackEvent?: string[] | undefined;
  statusCallbackMethod?: string | undefined;
  /** Seconds to ring before giving up. Twilio defaults to 60. */
  timeout?: number | undefined;
}

/**
 * Parameters for Twilio's `client.calls.create()`.
 *
 * {@link TypedCallOptions} covers the ones outbound ConversationRelay reaches
 * for; any other parameter `calls.create()` accepts is forwarded too, typed by
 * the Twilio SDK. TAC-owned parameters (`to`, `from`, `twiml`, `url`,
 * `applicationSid`) are excluded — TAC builds the call and its TwiML.
 *
 * Unknown keys are rejected at validation, so a typo fails at
 * `initiateOutboundConversation` rather than being silently dropped by the SDK.
 *
 * @example
 * ```typescript
 * const callOptions: CallOptions = {
 *   machineDetection: 'Enable',
 *   asyncAmd: true,
 *   record: true,
 * };
 * ```
 */
export type CallOptions = TypedCallOptions &
  Omit<CallListInstanceCreateOptions, ReservedCallParam | keyof TypedCallOptions>;

/**
 * @internal Fails typecheck unless instantiated with `true`. A conditional type
 * that merely resolves to `never` is not an error on its own, so the assertion
 * has to be a constraint violation to be load-bearing.
 */
type _AssertTrue<T extends true> = T;

/**
 * @internal Compile-time SDK drift guards — do not use directly.
 * If the Twilio SDK adds, removes, or renames a `calls.create` parameter these
 * checks fail during `npm run typecheck`, signaling that
 * {@link CALLS_CREATE_PARAMS} needs updating. Without the `complete` direction a
 * newly added SDK parameter would be rejected at runtime as unknown.
 */
export type _CallsCreateDriftGuards = {
  known: _AssertTrue<
    (typeof CALLS_CREATE_PARAMS)[number] extends keyof CallListInstanceCreateOptions ? true : false
  >;
  complete: _AssertTrue<
    keyof CallListInstanceCreateOptions extends (typeof CALLS_CREATE_PARAMS)[number] ? true : false
  >;
  typedAreRealParams: _AssertTrue<
    keyof TypedCallOptions extends keyof CallListInstanceCreateOptions ? true : false
  >;
  reservedAreRealParams: _AssertTrue<
    ReservedCallParam extends keyof CallListInstanceCreateOptions ? true : false
  >;
};

const ACCEPTED_CALL_PARAMS: ReadonlySet<string> = new Set(CALLS_CREATE_PARAMS);

/**
 * Whether an `asyncAmd` value actually turns background detection on.
 *
 * Accepts the boolean TAC serializes for callers and the string Twilio's API
 * types the parameter as, so `'false'` reads as off rather than as a non-empty
 * (therefore truthy) string.
 */
function isAsyncAmdEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

/**
 * Runtime validation for {@link CallOptions}.
 *
 * Loose rather than strict so untyped-but-real Calls API parameters pass
 * through; `superRefine` then rejects TAC-owned and unknown keys explicitly so
 * the message says which mistake was made.
 */
const CallOptionsObjectSchema = z
  .looseObject({
    machineDetection: z.enum(['Enable', 'DetectMessageEnd']).optional(),
    asyncAmd: z.union([z.boolean(), z.string()]).optional(),
    asyncAmdStatusCallback: z.string().optional(),
    asyncAmdStatusCallbackMethod: z.string().optional(),
    machineDetectionTimeout: z.number().int().optional(),
    machineDetectionSpeechThreshold: z.number().int().optional(),
    machineDetectionSpeechEndThreshold: z.number().int().optional(),
    machineDetectionSilenceTimeout: z.number().int().optional(),

    record: z.boolean().optional(),
    recordingStatusCallback: z.string().optional(),
    recordingStatusCallbackEvent: z.array(z.string()).optional(),
    recordingChannels: z.string().optional(),
    recordingTrack: z.string().optional(),

    statusCallback: z.string().optional(),
    statusCallbackEvent: z.array(z.string()).optional(),
    statusCallbackMethod: z.string().optional(),
    timeout: z.number().int().optional(),
  })
  .superRefine((value, ctx) => {
    const supplied = Object.keys(value);

    const conflict = supplied.filter(key =>
      (RESERVED_CALL_PARAMS as readonly string[]).includes(key)
    );
    if (conflict.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message:
          `callOptions may not set TAC-owned call parameters: ${conflict.sort().join(', ')}. ` +
          'TAC builds the call and its TwiML.',
      });
    }

    const unknown = supplied.filter(key => !ACCEPTED_CALL_PARAMS.has(key));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message:
          "callOptions has parameters Twilio's calls.create() does not accept: " +
          `${unknown.sort().join(', ')}. Check for a typo, or upgrade the twilio package.`,
      });
    }

    // AMD needs both flags. machineDetection turns detection on; asyncAmd
    // delivers AnsweredBy to a callback. Without asyncAmd, Twilio returns it on
    // the TwiML request instead — unreachable, since TAC sends inline TwiML.
    //
    // asyncAmd is checked by value, not truthiness: Twilio's API types it as a
    // string, and `Boolean('false')` is true — so a plain truthiness test would
    // wave through `asyncAmd: 'false'` and silently deliver no AMD event.
    if (Boolean(value.machineDetection) !== isAsyncAmdEnabled(value.asyncAmd)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'AMD requires both machineDetection and asyncAmd; got ' +
          `machineDetection=${JSON.stringify(value.machineDetection)}, ` +
          `asyncAmd=${JSON.stringify(value.asyncAmd)}.`,
      });
    }
  });

/**
 * Validates {@link CallOptions}. The parsed value is re-widened to `CallOptions`
 * because the loose object's inferred index signature would otherwise erase the
 * SDK-derived parameter types.
 */
export const CallOptionsSchema: z.ZodType<CallOptions, unknown> = CallOptionsObjectSchema.transform(
  value => value as CallOptions
);

/**
 * Serialize {@link CallOptions} into the argument object for
 * `client.calls.create()`, dropping unset keys.
 *
 * `asyncAmd` is coerced to a string because Twilio's SDK types it as one,
 * unlike `record`.
 */
export function callOptionsToCreateParams(options: CallOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    params[key] = key === 'asyncAmd' && typeof value === 'boolean' ? String(value) : value;
  }
  return params;
}

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
  /**
   * Parameters for Twilio's `calls.create()` — AMD, recording, status
   * callbacks, timeout (see {@link CallOptions}). Callback URLs auto-wire when
   * the matching handler is registered; an explicit URL wins.
   */
  callOptions?: CallOptions | undefined;
}

export const InitiateVoiceConversationOptionsSchema: z.ZodType<InitiateVoiceConversationOptions> = z
  .object({
    to: z.string().min(1, 'Recipient phone number is required'),
    websocketUrl: z.url().optional(),
    twimlOptions: TwiMLOptionsSchema.optional(),
    callOptions: CallOptionsSchema.optional(),
  })
  // Reject removed flat fields (welcomeGreeting, actionUrl, customParameters,
  // conversationRelayConfig) so callers upgrading from older TAC versions get
  // a clear error instead of having their values silently dropped.
  .strict();
