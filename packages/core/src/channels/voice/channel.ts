import type { WebSocket } from 'ws';
import Twilio from 'twilio';
import {
  ChannelType,
  ConversationId,
  ConversationSession,
  ProfileId,
  CustomParameters,
  ConversationRelayConfig,
  ConversationRelayCallbackPayload,
  InitiateVoiceConversationOptions,
  VoiceTwiMLOptionsConversationRelay,
  TwiMLRequest,
  ConversationWebhookPayload,
  CallEventKind,
  CallStatusEvent,
  AmdEvent,
  RecordingEvent,
  callStatusEventFromForm,
  amdEventFromForm,
  recordingEventFromForm,
} from '../../types/index';
import type { InitiateVoiceConversationResult } from '../../types/conversation';
import { BaseChannel, BaseChannelEvents, BaseChannelOptions } from '../base';
import type { ConversationClient } from '../../clients/conversation';
import type { TAC } from '../../lib/tac';
import type { TACConfig } from '../../lib/config';
import type { Logger } from '../../lib/logger';
import type { TACMemoryResponse } from '../../lib/tac-memory-response';
import { ConversationRelayProviderConfig } from './conversation-relay/config';
import type { ConversationRelayProviderConfigOptions } from './conversation-relay/config';
import { ConversationRelayProvider } from './conversation-relay/provider';
import type { StreamTask } from './conversation-relay/provider';
import type { VoiceProvider } from './provider';
import { VoiceProviderConfig } from './provider';

/**
 * Callback that produces per-call overrides for the TwiML inside
 * `<ConversationRelay>` on inbound calls. Receives a framework-neutral
 * {@link TwiMLRequest} and returns {@link VoiceTwiMLOptionsConversationRelay}.
 *
 * Stays typed against the ConversationRelay subtype rather than the
 * provider-agnostic base ({@link VoiceProvider.handleIncomingCall} is widened
 * to the base, this consumer-facing surface is not): the base has only
 * optional shared fields, so TypeScript's object-literal freshness check
 * rejects the documented inline form `async () => ({ voice: '...' })` for
 * having no properties in common with it. It widens once a second
 * inbound-capable provider exists.
 */
export type InboundCallTwimlHandler = (
  req: TwiMLRequest
) => Promise<VoiceTwiMLOptionsConversationRelay>;

/** Handler for Twilio `statusCallback` webhooks. */
export type CallStatusHandler = (event: CallStatusEvent) => Promise<void> | void;

/** Handler for Twilio `asyncAmdStatusCallback` webhooks. */
export type AmdHandler = (event: AmdEvent) => Promise<void> | void;

/** Handler for Twilio `recordingStatusCallback` webhooks. */
export type RecordingHandler = (event: RecordingEvent) => Promise<void> | void;

/**
 * Voice channel event callbacks extending base callbacks
 */
export interface VoiceChannelEvents extends BaseChannelEvents {
  onSetup?: (data: {
    callSid: string;
    from: string;
    to: string;
    customParameters: Record<string, unknown> | undefined;
  }) => void;
  onPrompt?: (data: {
    conversationId: ConversationId;
    transcript: string;
    userMemory?: TACMemoryResponse;
    session?: ConversationSession;
    abortSignal: AbortSignal;
  }) => Promise<void> | void;
  onInterrupt?: (data: {
    conversationId: ConversationId;
    utteranceUntilInterrupt: string | undefined;
    durationUntilInterruptMs: number | undefined;
  }) => void;
  /**
   * Fired once the session and WebSocket registration exist — in orchestrated
   * mode possibly before the first prompt, since the lookup starts at setup.
   */
  onWebSocketConnected?: (data: { conversationId: ConversationId }) => void;
  onWebSocketDisconnected?: (data: { conversationId: ConversationId }) => void;
}

/**
 * Voice Channel for handling voice-based conversations over a WebSocket.
 *
 * The real-time media transport lives on a {@link VoiceProvider} — by default
 * {@link ConversationRelayProvider}. `VoiceChannel` keeps the Calls-API
 * lifecycle (call events, hangup), conversation bookkeeping and webhook
 * processing, and delegates everything transport-shaped to the provider.
 */
export class VoiceChannel extends BaseChannel {
  private readonly provider: VoiceProvider;
  private readonly voiceCallbacks: VoiceChannelEvents;
  private twilioClient: ReturnType<typeof Twilio> | undefined;
  private onInboundCallTwimlHandler: InboundCallTwimlHandler | undefined;
  private onCallStatusHandler: CallStatusHandler | undefined;
  private onAmdHandler: AmdHandler | undefined;
  private onRecordingHandler: RecordingHandler | undefined;

  /**
   * @param tac - The owning {@link TAC} instance.
   * @param options - Either a {@link VoiceProviderConfig} selecting the media
   *   provider, or a plain object — shorthand for
   *   {@link ConversationRelayProviderConfig}, which is what TAC builds when no
   *   provider config is given.
   */
  constructor(tac: TAC, options?: VoiceProviderConfig | ConversationRelayProviderConfigOptions) {
    super(tac, VoiceChannel.toBaseOptions(options));
    this.voiceCallbacks = {};
    this.provider = VoiceChannel.toProviderConfig(options).createProvider(this, this.config);
  }

  /**
   * The {@link BaseChannelOptions} to hand `BaseChannel`. A provider config
   * replays the options it retained (with its resolved `memoryMode`, which is
   * writable after construction); a plain options object is passed through. Both
   * paths therefore honour `dedupCapacity` and friends identically.
   */
  private static toBaseOptions(
    options?: VoiceProviderConfig | ConversationRelayProviderConfigOptions
  ): BaseChannelOptions | undefined {
    if (options === undefined) {
      return undefined;
    }
    if (options instanceof VoiceProviderConfig) {
      return { ...options.channelOptions, memoryMode: options.memoryMode };
    }
    return options;
  }

  /**
   * Resolve the provider config: an explicit {@link VoiceProviderConfig} as-is,
   * anything else wrapped as a {@link ConversationRelayProviderConfig}.
   */
  private static toProviderConfig(
    options?: VoiceProviderConfig | ConversationRelayProviderConfigOptions
  ): VoiceProviderConfig {
    return options instanceof VoiceProviderConfig
      ? options
      : new ConversationRelayProviderConfig(options);
  }

  /**
   * Register a callback that produces per-call overrides for the TwiML inside
   * `<ConversationRelay>` on inbound calls.
   *
   * The callback receives a framework-neutral {@link TwiMLRequest} (parsed from
   * the Twilio webhook form) and returns
   * {@link VoiceTwiMLOptionsConversationRelay}. Fields the
   * callback explicitly sets override `defaultTwimlOptions` and TAC defaults;
   * unset fields fall through.
   *
   * @example
   * ```typescript
   * voiceChannel.onInboundCallTwiml(async req => {
   *   if (req.callerCountry === 'MX') {
   *     return { language: 'es-MX', welcomeGreeting: '¡Hola!' };
   *   }
   *   return {};
   * });
   * ```
   *
   * Outbound calls don't use this — pass per-call TwiML via
   * `InitiateVoiceConversationOptions.twimlOptions` directly.
   */
  public onInboundCallTwiml(callback: InboundCallTwimlHandler): void {
    this.onInboundCallTwimlHandler = callback;
  }

  /**
   * Register a handler for Twilio `statusCallback` webhooks.
   *
   * This is the Calls-API status callback (call disposition), not the
   * ConversationRelay session callback — see
   * {@link handleConversationRelayCallback}.
   *
   * Registering does two things: it stores the handler, and it makes later
   * outbound calls pass `statusCallback` to `calls.create`. With no handler
   * registered TAC omits that parameter, so Twilio has nowhere to post and the
   * event never arrives.
   *
   * Twilio reports only the terminal event by default, which covers every
   * disposition; set `CallOptions.statusCallbackEvent` for ringing/answered.
   *
   * @example
   * ```typescript
   * voiceChannel.onCallStatus(async event => {
   *   if (event.isUnreached) {
   *     // queue a retry
   *   }
   * });
   * ```
   */
  public onCallStatus(callback: CallStatusHandler): void {
    this.onCallStatusHandler = callback;
  }

  /**
   * Register a handler for Twilio `asyncAmdStatusCallback` webhooks.
   *
   * Registering makes later outbound calls pass `asyncAmdStatusCallback` to
   * `calls.create`; without a handler TAC omits it and Twilio has nowhere to
   * post the result. It does not enable detection — that's per-call, via
   * `CallOptions.machineDetection` and `asyncAmd`, both of which are required
   * for this to fire (at most once per call).
   *
   * @example
   * ```typescript
   * voiceChannel.onAmd(async event => {
   *   if (event.isMachine) {
   *     await voiceChannel.endCall(event.callSid); // voicemail → hang up
   *   }
   * });
   * ```
   */
  public onAmd(callback: AmdHandler): void {
    this.onAmdHandler = callback;
  }

  /**
   * Register a handler for Twilio `recordingStatusCallback` webhooks.
   *
   * Registering makes later outbound calls pass `recordingStatusCallback` to
   * `calls.create`; without a handler TAC omits it and Twilio has nowhere to
   * post. It does not start recording — that's `CallOptions.record`, which is
   * required for this to fire.
   *
   * @example
   * ```typescript
   * voiceChannel.onRecording(async event => {
   *   if (event.recordingStatus === 'completed') {
   *     // store event.recordingUrl
   *   }
   * });
   * ```
   */
  public onRecording(callback: RecordingHandler): void {
    this.onRecordingHandler = callback;
  }

  // =========================================================================
  // Provider-facing surface
  //
  // `BaseChannel`'s state is `protected`, and a `VoiceProvider` is not a
  // subclass of `VoiceChannel`, so relocated transport logic genuinely cannot
  // reach it. These forwarders open exactly what a provider needs and nothing
  // more; they are `@internal` and are not exported from the package root.
  // =========================================================================

  /**
   * The registered call-event handlers, for a `VoiceProvider` deciding which
   * callback URLs to derive. A provider is not a subclass of `VoiceChannel`,
   * so the `private` fields are genuinely out of reach without this.
   *
   * @internal
   */
  public getCallEventHandlers(): {
    status: CallStatusHandler | undefined;
    amd: AmdHandler | undefined;
    recording: RecordingHandler | undefined;
  } {
    return {
      status: this.onCallStatusHandler,
      amd: this.onAmdHandler,
      recording: this.onRecordingHandler,
    };
  }

  /**
   * This channel's `TACConfig`, for a `VoiceProvider` deriving default URLs.
   * `BaseChannel.config` is `protected`, and a provider is not a subclass.
   *
   * @internal
   */
  public getTacConfig(): TACConfig {
    return this.config;
  }

  /**
   * This channel's logger, so a provider's relocated logic keeps logging under
   * the same name it did when it lived on `VoiceChannel`.
   *
   * @internal
   */
  public getLoggerInternal(): Logger {
    return this.logger;
  }

  /**
   * The Conversation Orchestrator client, or `null` in ConversationRelay-only
   * mode.
   *
   * @internal
   */
  public getConversationClientInternal(): ConversationClient | null {
    return this.conversationClient;
  }

  /**
   * The lazily built Twilio REST client, for a provider placing outbound calls.
   *
   * @internal
   */
  public getTwilioClientInternal(): ReturnType<typeof Twilio> {
    return this.getTwilioClient();
  }

  /**
   * Whether Conversation Orchestrator is configured. Providers branch on this
   * to decide who owns conversation cleanup.
   *
   * @internal
   */
  public isOrchestratorEnabledInternal(): boolean {
    return this.tac.isOrchestratorEnabled();
  }

  /**
   * Voice event callbacks registered via {@link on}, for a provider to fire.
   *
   * @internal
   */
  public getVoiceCallbacks(): VoiceChannelEvents {
    return this.voiceCallbacks;
  }

  /**
   * The inbound-TwiML customizer registered via {@link onInboundCallTwiml}, for
   * a provider building the inbound response.
   *
   * @internal
   */
  public getInboundCallTwimlHandler(): InboundCallTwimlHandler | undefined {
    return this.onInboundCallTwimlHandler;
  }

  /**
   * Start tracking a conversation session. Forwards to
   * `BaseChannel.startConversation`.
   *
   * @internal
   */
  public startConversationInternal(
    conversationId: ConversationId,
    profileId?: ProfileId
  ): ConversationSession {
    return this.startConversation(conversationId, profileId);
  }

  /**
   * End a tracked conversation session. Forwards to
   * `BaseChannel.endConversation`.
   *
   * @internal
   */
  public endConversationInternal(conversationId: ConversationId): Promise<void> {
    return this.endConversation(conversationId);
  }

  /**
   * Retrieve memory when `memoryMode` calls for it. Forwards to
   * `BaseChannel.retrieveMemoryIfEnabled`.
   *
   * @internal
   */
  public retrieveMemoryInternal(
    session: ConversationSession,
    query?: string
  ): Promise<TACMemoryResponse | undefined> {
    return this.retrieveMemoryIfEnabled(session, query);
  }

  /**
   * Report an error through the channel's `onError` callback and logger.
   * Forwards to `BaseChannel.handleError`.
   *
   * @internal
   */
  public handleErrorInternal(error: Error, context?: Record<string, unknown>): void {
    this.handleError(error, context);
  }

  private getTwilioClient(): ReturnType<typeof Twilio> {
    if (!this.twilioClient) {
      this.twilioClient = Twilio(this.config.apiKey, this.config.apiSecret, {
        accountSid: this.config.accountSid,
      });
    }
    return this.twilioClient;
  }

  public get channelType(): ChannelType {
    return 'voice';
  }

  /**
   * Register event callbacks (override for Voice-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  public override on(event: string, callback: (...args: any[]) => void): void {
    switch (event) {
      case 'setup':
        this.voiceCallbacks.onSetup = callback;
        break;
      case 'prompt':
        this.voiceCallbacks.onPrompt = callback;
        break;
      case 'interrupt':
        this.voiceCallbacks.onInterrupt = callback;
        break;
      case 'webSocketConnected':
        this.voiceCallbacks.onWebSocketConnected = callback;
        break;
      case 'webSocketDisconnected':
        this.voiceCallbacks.onWebSocketDisconnected = callback;
        break;
      default:
        // Delegate to parent for base events
        super.on(event, callback);
        break;
    }
  }

  /**
   * Process conversation webhooks for cleanup.
   *
   * Voice channel processes CONVERSATION_UPDATED events:
   * - CLOSED status: Clean up local session state
   *
   * Note: Conversation tracking uses instance-local memory. In multi-instance
   * deployments, webhooks may route to a different instance, preventing cleanup.
   *
   * @param payload - Raw webhook event data from Twilio
   * @param idempotencyToken - Optional Twilio idempotency token from request headers
   */
  public async processWebhook(payload: unknown, idempotencyToken?: string): Promise<void> {
    try {
      const result = this.preprocessWebhook(payload, idempotencyToken);
      if (!result) {
        return;
      }

      const { webhookData, eventType, conversationId } = result;

      switch (eventType) {
        case 'CONVERSATION_UPDATED':
          this.logger.debug(
            { conversation_id: conversationId, status: webhookData.data?.status },
            'Handling CONVERSATION_UPDATED'
          );
          await this.handleConversationUpdated(webhookData);
          break;

        default:
          this.logger.debug(
            {
              event_type: eventType,
              raw_event_type: webhookData.eventType,
              conversation_id: conversationId,
            },
            'Unhandled event type - this event will be ignored'
          );
      }

      this.logger.debug({ event_type: eventType }, 'Webhook processing completed');
    } catch (error) {
      // Remove the token so retries are not blocked
      if (idempotencyToken) {
        this.removeWebhookToken(idempotencyToken);
      }
      this.handleError(error instanceof Error ? error : new Error(String(error)), { payload });
    }
  }

  /**
   * Handle conversation updated event
   */
  private async handleConversationUpdated(payload: ConversationWebhookPayload): Promise<void> {
    const conversationId = this.extractConversationId(payload);

    if (!conversationId) {
      throw new Error('Missing conversation ID in conversation.updated event');
    }

    // Check if conversation is closed
    if (payload.data?.status === 'CLOSED') {
      this.logger.debug(
        { conversation_id: conversationId, status: payload.data.status },
        'Conversation closed, cleaning up'
      );
      await this.endConversation(conversationId);
    } else if (payload.data?.status === 'INACTIVE') {
      // "once" mode: drop the cache so the next message re-fetches.
      this.invalidateCachedMemory(conversationId);
    }
  }

  /**
   * Get active WebSocket connection for a conversation
   */
  public getWebsocket(conversationId: ConversationId): WebSocket | null {
    return this.provider.getWebSocket(conversationId);
  }

  /**
   * Hand one WebSocket connection to the active provider, which drives its
   * lifecycle from accept to disconnect.
   *
   * @param ws - The accepted WebSocket, from ConversationRelay or whatever
   *   transport the active provider serves.
   */
  public handleWebSocketConnection(ws: WebSocket): void {
    // A provider may serve the socket synchronously or await an upstream
    // handshake first. Owning the returned promise here keeps an async
    // provider from producing an unhandled rejection.
    const result = this.provider.handleWebSocket(ws);
    if (result instanceof Promise) {
      void result.catch((err: unknown) => {
        this.logger.error({ err }, 'WebSocket handler error');
      });
    }
  }

  /**
   * Send voice response via WebSocket
   */
  public sendResponse(
    conversationId: ConversationId,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.provider.sendResponse(conversationId, message, metadata);
  }

  /**
   * Send a streaming voice response through the active provider's transport,
   * token by token. Delegates to the active provider — see
   * {@link ConversationRelayProvider.sendStreamingResponse} for the token
   * protocol and abort semantics.
   *
   * @param conversationId - Conversation whose transport receives the tokens.
   * @param stream - Async iterable of text chunks to relay as they arrive.
   * @param options - Additional per-call inputs.
   * @param options.signal - Aborts the stream mid-flight, e.g. when the caller
   *   interrupts.
   * @returns The accumulated full response text.
   */
  public async sendStreamingResponse(
    conversationId: ConversationId,
    stream: AsyncIterable<string>,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    return this.provider.sendStreamingResponse(conversationId, stream, options);
  }

  // =========================================================================
  // Incoming Call Handling
  // =========================================================================

  /**
   * Generate the response for an incoming voice call. Delegates to the active
   * provider — see {@link ConversationRelayProvider.handleIncomingCall} for the
   * full TwiML merge/precedence rules (only meaningful for that provider; a
   * provider with no inbound story declines instead).
   *
   * @param twimlRequest - Parsed Twilio webhook fields. Passed to the customizer
   *   registered via {@link onInboundCallTwiml}, if one is configured.
   * @param options - Additional per-call inputs.
   * @param options.hostTwimlOptions - Per-call TwiML supplied by a custom
   *   in-process host (e.g. an affinity-routed deployment injecting a per-call
   *   `websocketUrl`). Typed against the ConversationRelay subtype for the same
   *   reason as {@link InboundCallTwimlHandler}.
   * @returns TwiML XML string for call connection.
   */
  public async handleIncomingCall(
    twimlRequest?: TwiMLRequest,
    options?: { hostTwimlOptions?: VoiceTwiMLOptionsConversationRelay }
  ): Promise<string> {
    return this.provider.handleIncomingCall(twimlRequest, options);
  }

  // =========================================================================
  // Outbound Call Handling
  // =========================================================================

  /**
   * Initiate an outbound voice conversation. Delegates to the active provider —
   * see {@link ConversationRelayProvider.initiateOutboundConversation} for the
   * TwiML and Calls-API merge/precedence rules.
   *
   * Only {@link ConversationRelayProvider} places outbound calls today; any
   * other provider declines.
   *
   * @param options - Destination, per-call TwiML and Calls-API overrides.
   * @returns The placed call's `callSid`.
   */
  public async initiateOutboundConversation(
    options: InitiateVoiceConversationOptions
  ): Promise<InitiateVoiceConversationResult> {
    return this.provider.initiateOutboundConversation(options);
  }

  // =========================================================================
  // ConversationRelay Callback Handling
  // =========================================================================

  /**
   * Handle ConversationRelay callback from Twilio. Cleans up on call completion
   * in voice-only mode; in orchestrated mode the CO webhook owns cleanup.
   *
   * @param payload - Callback payload from Twilio
   * @returns Response with status, content, and content type
   * @throws {Error} if this channel's provider is not ConversationRelay-based.
   */
  public async handleConversationRelayCallback(
    payload: ConversationRelayCallbackPayload
  ): Promise<{ status: number; content: string; contentType: string }> {
    // Forced narrowing: the shipped signature here is incompatible with the
    // base's `handleTwilioProviderCallback`, and can't change before PR 5,
    // which owns reconciling this and the stream-task narrowings below.
    return this.requireConversationRelayProvider(
      'ConversationRelay callbacks'
    ).handleConversationRelayCallback(payload);
  }

  // =========================================================================
  // Call Event Handling (status callback, async AMD, recording)
  // =========================================================================

  /**
   * Whether a call-webhook payload belongs to the configured account.
   *
   * Twilio signature validation already gates the route; this is defense in
   * depth. A payload with no `AccountSid` is allowed through.
   *
   * Subaccounts: events carry the SID the call was placed on, so configure TAC
   * with that account or its events get dropped here.
   */
  private callEventAccountOk(form: Record<string, string>): boolean {
    const accountSid = form['AccountSid'];
    if (accountSid && accountSid !== this.config.accountSid) {
      this.logger.warn(
        { expected: this.config.accountSid, received: accountSid },
        'Call event AccountSid mismatch, ignoring'
      );
      return false;
    }
    return true;
  }

  /**
   * Parse a call-event webhook form and dispatch it to its handler.
   *
   * Returns 400 when the payload can't be parsed (no `CallSid`) or the handler
   * throws — better than handing Twilio a 200 for an event that wasn't
   * processed. Everything else, including no handler registered and an
   * account mismatch, is a 200 no-op.
   */
  private async dispatchCallEvent<T>(
    kind: CallEventKind,
    form: Record<string, string>,
    handler: ((event: T) => Promise<void> | void) | undefined,
    parse: (form: Record<string, string>) => T,
    logFields: (event: T) => Record<string, unknown>
  ): Promise<{ status: number; content: string; contentType: string }> {
    const ok = { status: 200, content: 'OK', contentType: 'text/plain' };
    if (!handler || !this.callEventAccountOk(form)) {
      return ok;
    }

    try {
      const event = parse(form);
      this.logger.debug(logFields(event), `Call ${kind} event received`);
      await handler(event);
    } catch (error) {
      this.logger.error({ err: error, kind }, 'Failed to process call event callback');
      return { status: 400, content: 'Bad Request', contentType: 'text/plain' };
    }
    return ok;
  }

  /**
   * Handle a Twilio `statusCallback` webhook.
   *
   * The developer routes the request here (`TACServer` does this automatically
   * for its `/status` call-event route). Parsed into a {@link CallStatusEvent}
   * and dispatched to the {@link onCallStatus} handler. No-op if no handler is
   * registered.
   *
   * @param form - Raw form data from the webhook request.
   */
  public async handleCallStatusEvent(
    form: Record<string, string>
  ): Promise<{ status: number; content: string; contentType: string }> {
    return this.dispatchCallEvent(
      'status',
      form,
      this.onCallStatusHandler,
      callStatusEventFromForm,
      event => ({ call_sid: event.callSid, call_status: event.callStatus })
    );
  }

  /**
   * Handle a Twilio `asyncAmdStatusCallback` webhook.
   *
   * The developer routes the request here (`TACServer` does this automatically
   * for its `/amd` call-event route). Parsed into an {@link AmdEvent} and
   * dispatched to the {@link onAmd} handler. No-op if no handler is registered.
   *
   * @param form - Raw form data from the webhook request.
   */
  public async handleAmdEvent(
    form: Record<string, string>
  ): Promise<{ status: number; content: string; contentType: string }> {
    return this.dispatchCallEvent('amd', form, this.onAmdHandler, amdEventFromForm, event => ({
      call_sid: event.callSid,
      answered_by: event.answeredBy,
    }));
  }

  /**
   * Handle a Twilio `recordingStatusCallback` webhook.
   *
   * The developer routes the request here (`TACServer` does this automatically
   * for its `/recording` call-event route). Parsed into a
   * {@link RecordingEvent} and dispatched to the {@link onRecording} handler.
   * No-op if no handler is registered.
   *
   * @param form - Raw form data from the webhook request.
   */
  public async handleRecordingEvent(
    form: Record<string, string>
  ): Promise<{ status: number; content: string; contentType: string }> {
    return this.dispatchCallEvent(
      'recording',
      form,
      this.onRecordingHandler,
      recordingEventFromForm,
      event => ({ call_sid: event.callSid, recording_status: event.recordingStatus })
    );
  }

  /**
   * Hang up a call and clean up its ConversationRelay session.
   *
   * Works on `callSid` alone, whether or not a session exists yet. No-ops the
   * session cleanup if none is tracked.
   *
   * Does not throw — hanging up an already-ended call is routine (the callee
   * hangs up while AMD is still resolving), and handlers shouldn't have to
   * guard against it.
   *
   * @param callSid - Twilio Call SID (from a call event, the outbound result, or
   *   `ConversationSession.callSid`).
   * @returns True if Twilio accepted the hangup, false if it failed (logged).
   *   Session cleanup runs either way.
   */
  public async endCall(callSid: string): Promise<boolean> {
    const client = this.getTwilioClient();
    let hungUp = true;
    try {
      await client.calls(callSid).update({ status: 'completed' });
    } catch (error) {
      hungUp = false;
      this.logger.error({ err: error, call_sid: callSid }, 'Failed to hang up call');
    }

    const session = this.getConversationSessionByCallSid(callSid);
    if (session) {
      await this.endConversation(session.conversationId as ConversationId);
    }
    return hungUp;
  }

  /**
   * Look up the active voice session for a Twilio Call SID.
   *
   * Out-of-band code holding a CallSid — a dashboard route, an operator action,
   * a call-event handler — can't reach the session-facing methods, which are
   * keyed by conversation id: the Orchestrator conversation id in orchestrator
   * mode, the CallSid only in ConversationRelay-only mode.
   *
   * Relay-only mode creates the session on the first prompt; orchestrated
   * mode creates it when the lookup started at setup finishes, so it may
   * exist before the caller speaks — including before `onAmd` fires. Treat it
   * as racy and hang up with {@link endCall}, which needs no session.
   *
   * At the other end, orchestrator mode keeps the session until Conversation
   * Orchestrator's CLOSED webhook, so it outlives the call and `onCallStatus` /
   * `onRecording` do resolve. Relay-only mode tears down on the
   * ConversationRelay callback instead, which races them.
   *
   * @example
   * ```typescript
   * async function nudge(callSid: string): Promise<void> {
   *   const session = voiceChannel.getConversationSessionByCallSid(callSid);
   *   if (session) {
   *     await voiceChannel.sendResponse(session.conversationId, 'Still there?');
   *   }
   * }
   * ```
   *
   * @param callSid - Twilio Call SID, e.g. from
   *   `InitiateVoiceConversationResult.callSid` or a call event.
   * @returns The session, or `undefined` — not created yet, the call ended, or
   *   it landed on another instance (see the horizontal-scaling note in
   *   CLAUDE.md).
   */
  public getConversationSessionByCallSid(callSid: string): ConversationSession | undefined {
    for (const session of this.activeConversations.values()) {
      if (session.callSid === callSid) {
        return session;
      }
    }
    return undefined;
  }

  // =========================================================================
  // Stream Task Management
  //
  // Stream tasks are ConversationRelay's text-token machinery and live on
  // `ConversationRelayProvider`, alongside the transport that consumes their
  // AbortSignal. These forwarders keep the channel-level API intact.
  // =========================================================================

  /**
   * Narrow `provider` to the ConversationRelay implementation for the
   * ConversationRelay-only forwarders on this channel.
   *
   * Unreachable today — `ConversationRelayProvider` is the only provider — and
   * PR 5 owns reconciling these narrowings alongside the one in
   * {@link VoiceChannel.handleConversationRelayCallback}.
   *
   * @throws {Error} if this channel's provider is not ConversationRelay-based.
   */
  private requireConversationRelayProvider(capability: string): ConversationRelayProvider {
    if (!(this.provider instanceof ConversationRelayProvider)) {
      throw new Error(`${this.provider.constructor.name} does not support ${capability}.`);
    }
    return this.provider;
  }

  /**
   * Start tracking a streaming task for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns The stream task with its AbortController
   */
  public startStreamTask(conversationId: ConversationId): StreamTask {
    return this.requireConversationRelayProvider('stream tasks').startStreamTask(conversationId);
  }

  /**
   * Cancel an active streaming task
   *
   * @param conversationId - The conversation ID
   * @returns true if a task was cancelled, false otherwise
   */
  public cancelStreamTask(conversationId: ConversationId): boolean {
    return this.requireConversationRelayProvider('stream tasks').cancelStreamTask(conversationId);
  }

  /**
   * Complete a streaming task (remove from tracking)
   *
   * @param conversationId - The conversation ID
   */
  public completeStreamTask(conversationId: ConversationId): void {
    this.requireConversationRelayProvider('stream tasks').completeStreamTask(conversationId);
  }

  /**
   * Check if a stream task is active
   *
   * @param conversationId - The conversation ID
   * @returns true if an active task exists
   */
  public hasActiveStreamTask(conversationId: ConversationId): boolean {
    return this.requireConversationRelayProvider('stream tasks').hasActiveStreamTask(
      conversationId
    );
  }

  // =========================================================================
  // ConversationRelay TwiML Generation
  // =========================================================================

  /**
   * Generate TwiML to connect a call to ConversationRelay. Delegates to
   * {@link ConversationRelayProvider.connectConversationRelay}, which validates
   * the configuration with Zod before generating TwiML.
   *
   * @param config - ConversationRelay configuration (url, transcription, TTS, etc.)
   * @param options - Optional settings for parameters and the Connect verb
   * @returns TwiML XML string
   * @throws {Error} if config validation fails, or if this channel's provider is
   *   not ConversationRelay-based.
   */
  public connectConversationRelay(
    config: ConversationRelayConfig,
    options?: { parameters?: CustomParameters; actionUrl?: string }
  ): string {
    return this.requireConversationRelayProvider(
      'ConversationRelay TwiML generation'
    ).connectConversationRelay(config, options);
  }

  /**
   * Cleanup channel state on shutdown
   *
   * Note: WebSocket connections are managed by the server and closed there.
   * This method only cleans up internal channel state.
   */
  public override shutdown(): void {
    this.provider.shutdown();
    super.shutdown();
  }
}
