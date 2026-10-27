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
  TwilioProviderCallbackResponse,
  InitiateVoiceConversationOptions,
  VoiceTwiMLOptionsConversationRelay,
  TwiMLRequest,
  ConversationWebhookPayload,
  ConversationParticipant,
  ConversationResponse,
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
import { warnDeprecated } from '../../lib/deprecation';
import { trackEvent } from '../../lib/analytics';
import type { Logger } from '../../lib/logger';
import type { TACMemoryResponse } from '../../lib/tac-memory-response';
import { ConversationRelayProviderConfig } from './conversation-relay/config';
import type { ConversationRelayProviderConfigOptions } from './conversation-relay/config';
import { ConversationRelayProvider } from './conversation-relay/provider';
import type { StreamTask } from './conversation-relay/provider';
import type { VoiceProvider } from './provider';
import { VoiceProviderConfig } from './provider';
import { elapsedMs, parseIso8601 } from '../../util/timestamps';

/**
 * Channel name Conversation Orchestrator uses for voice participants. Not the
 * provider's `channelName`, which is a transport label.
 */
const CO_VOICE_CHANNEL = 'VOICE';

/** Participant types that represent TAC's own agent. */
const AGENT_TYPES = new Set(['AGENT', 'AI_AGENT']);

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
 * Handler for a call's WebSocket teardown. Receives the live session just
 * before it is discarded — see {@link VoiceChannel.onCallEnded}.
 */
export type CallEndedHandler = (session: ConversationSession) => Promise<void> | void;

/** One ConversationRelay keypress, as delivered to a {@link DtmfHandler}. */
export interface DtmfEvent {
  /**
   * Undefined only when the keypress beat conversation setup: `dtmf` before
   * ConversationRelay's `setup`, or an orchestrated-mode lookup that failed.
   */
  conversationId: ConversationId | undefined;
  /** Undefined only before ConversationRelay's `setup` message. */
  callSid: string | undefined;
  /** The key pressed: `0`-`9`, `*`, `#`, or `A`-`D`. */
  digit: string;
  /** Present whenever `conversationId` is. */
  session?: ConversationSession;
}

/** Handler for ConversationRelay `dtmf` messages (caller keypresses). */
export type DtmfHandler = (event: DtmfEvent) => Promise<void> | void;

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
  /** Caller keypress. See {@link VoiceChannel.onDtmf}. */
  onDtmf?: DtmfHandler;
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
  private onCallEndedHandler: CallEndedHandler | undefined;
  /**
   * Live sessions by conversation id. Instance-local by design: a call is
   * pinned to the process holding its WebSocket.
   */
  private readonly activeConversations: Map<ConversationId, ConversationSession>;
  /**
   * Live calls whose conversation CO already closed mid-call: their
   * `onConversationEnded` has fired, so teardown doesn't fire it again.
   */
  private readonly closedWhileLive: Set<string>;

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
    this.activeConversations = new Map();
    this.closedWhileLive = new Set();
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
   * {@link handleTwilioProviderCallback}.
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

  /**
   * Register a handler for DTMF keypresses, called once per key in order.
   *
   * Requires `dtmfDetection: true` on the ConversationRelay config — without it
   * Twilio sends nothing and this never fires. Digits aren't buffered, so
   * accumulating a multi-digit entry is the handler's job.
   *
   * A keypress initializes the conversation just as a prompt does, since a
   * caller can type without ever speaking; if that fails the digit still
   * arrives, with `conversationId` and `session` undefined. Keypresses don't
   * cancel in-flight streaming on their own — that's a separate `interrupt`
   * message, sent when `interruptible` includes `dtmf`.
   *
   * @example
   * ```typescript
   * const digits = new Map<string, string>();
   *
   * voiceChannel.onDtmf(({ conversationId, digit }) => {
   *   if (!conversationId) return;
   *   digits.set(conversationId, (digits.get(conversationId) ?? '') + digit);
   * });
   * ```
   */
  public onDtmf(callback: DtmfHandler): void {
    this.voiceCallbacks.onDtmf = callback;
  }

  /**
   * Register a handler for a call's WebSocket teardown.
   *
   * Fires once per call, always, on the instance that held the call. It
   * receives the live session just before it is discarded, so it is the only
   * place late-call in-memory state — the transcript, `callSid`, anything you
   * put on `metadata` — is still reachable.
   *
   * Not the same as `onConversationEnded` (fires when the *conversation*
   * closes, on any instance; on an orchestrated call, from a session rebuilt
   * from Conversation Orchestrator, identity only) or {@link onCallStatus} (a
   * Twilio Calls-API webhook, no session). Handler errors are logged and
   * swallowed.
   *
   * @example
   * ```typescript
   * voiceChannel.onCallEnded(async session => {
   *   await archive(session.callSid, session.metadata.transcript ?? []);
   * });
   * ```
   */
  public onCallEnded(callback: CallEndedHandler): void {
    this.onCallEndedHandler = callback;
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
   * Start tracking a call's session. Forwards to {@link startConversation}.
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
   * Release a finished call's session and fire the end-of-call hooks.
   * Forwards to {@link releaseSession}.
   *
   * @internal
   */
  public releaseSessionInternal(
    conversationId: ConversationId
  ): Promise<ConversationSession | undefined> {
    return this.releaseSession(conversationId);
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
      case 'dtmf':
        this.voiceCallbacks.onDtmf = callback;
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
   * Process Conversation Orchestrator webhooks.
   *
   * Voice channel processes these events:
   *
   * - **PARTICIPANT_ADDED**: report "Conversation Started" when the customer
   *   joins on voice (orchestrated ConversationRelay only).
   * - **CLOSED** (CONVERSATION_UPDATED): fire `onConversationEnded`. The call's
   *   session is normally already released (the WebSocket closed when the
   *   caller hung up), so this rebuilds it from Conversation Orchestrator —
   *   which is also what makes the hook fire on whichever instance received the
   *   webhook rather than only on the one that held the call. If this instance
   *   still holds the call's session (the call is live), the hook fires now
   *   instead, with a snapshot of that live session, and the session stays
   *   until the call's own teardown — which still fires {@link onCallEnded}. A
   *   single call can then produce a second `onConversationEnded`, under a
   *   different conversation id, when Conversation Orchestrator later closes
   *   the conversation it started for the call's remaining traffic. It also
   *   reports "Conversation Ended", with CO's duration, from the payload alone
   *   and once across channels; only a registered handler costs the lookup.
   * - **INACTIVE**: invalidate cached memory, if this instance holds the
   *   session. A call is pinned to one instance for its lifetime, so an
   *   INACTIVE landing elsewhere has no cache to clear and is ignored.
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
        case 'PARTICIPANT_ADDED':
          // Only with a CO conversation behind calls; otherwise the session
          // reports the start and counting this too would double it.
          if (this.provider.conversationClosedByOrchestrator) {
            this.trackConversationStarted(webhookData.data);
          }
          break;

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

    if (payload.data?.configurationId !== this.config.conversationConfigurationId) {
      return;
    }

    const status = payload.data?.status;
    if (status === 'CLOSED') {
      if (!this.provider.conversationClosedByOrchestrator) {
        // This provider has no Conversation Orchestrator conversation behind
        // its calls; onConversationEnded already fired at teardown and firing
        // again here would double it.
        return;
      }
      const createdAt = payload.data?.createdAt;
      const updatedAt = payload.data?.updatedAt;
      await this.handleConversationClosed(
        conversationId,
        elapsedMs(
          typeof createdAt === 'string' ? createdAt : undefined,
          typeof updatedAt === 'string' ? updatedAt : undefined
        )
      );
    } else if (status === 'INACTIVE' && this.memoryMode === 'once') {
      const session = this.activeConversations.get(conversationId);
      // Memory is updated by Conversation Orchestrator on the INACTIVE
      // transition, so the cached copy is stale from here on.
      if (session?.cachedMemory !== undefined) {
        session.cachedMemory = undefined;
        this.logger.debug(
          { conversation_id: conversationId },
          'Invalidated cached memory on INACTIVE status'
        );
      }
    }
  }

  // =========================================================================
  // Session lifecycle
  // =========================================================================

  /**
   * Get the live session this instance holds for a conversation.
   */
  public override getConversationSession(
    conversationId: ConversationId
  ): ConversationSession | undefined {
    return this.activeConversations.get(conversationId);
  }

  /**
   * Whether this instance holds a live session for a conversation.
   */
  public override isConversationActive(conversationId: ConversationId): boolean {
    return this.activeConversations.has(conversationId);
  }

  /**
   * Track a new session for a call, or return the existing one.
   */
  protected startConversation(
    conversationId: ConversationId,
    profileId?: ProfileId
  ): ConversationSession {
    const existing = this.activeConversations.get(conversationId);
    if (existing) {
      this.logger.debug(
        { conversation_id: conversationId, profile_id: existing.profileId },
        'Conversation already active'
      );
      return existing;
    }

    const session: ConversationSession = {
      conversationId,
      profileId,
      channel: this.channelType,
      startedAt: new Date(),
      metadata: {},
    };

    this.activeConversations.set(conversationId, session);

    this.logger.debug(
      { conversation_id: conversationId, profile_id: profileId, channel: this.channelType },
      'Conversation started'
    );

    if (this.callbacks.onConversationStarted) {
      this.callbacks.onConversationStarted({ session });
    }

    // With a CO conversation behind the call, CO's PARTICIPANT_ADDED reports
    // the start instead — see trackConversationStarted.
    if (!this.provider.conversationClosedByOrchestrator) {
      trackEvent('Conversation Started', {
        account_sid: this.config.accountSid,
        channel: this.channelType,
        conversation_id: conversationId,
        has_profile_id: !!profileId,
      });
    }

    return session;
  }

  /**
   * Free a finished call's session and fire the end-of-call hooks.
   *
   * Called from every teardown path and idempotent, so a second call is a
   * no-op returning `undefined`. Always fires {@link onCallEnded}. Also fires
   * `onConversationEnded` unless a Conversation Orchestrator CLOSED webhook will
   * do that later (see `VoiceProvider.conversationClosedByOrchestrator`).
   * Nothing is kept for that CLOSED: it gets a session rebuilt from
   * Conversation Orchestrator.
   */
  protected async releaseSession(
    conversationId: ConversationId
  ): Promise<ConversationSession | undefined> {
    const session = this.activeConversations.get(conversationId);
    if (!session) {
      return undefined;
    }
    this.activeConversations.delete(conversationId);

    // Measured before the callbacks below, which are application-owned: they
    // are awaited and may do network I/O or mutate the session, and neither
    // their latency nor their edits belong in the reported duration.
    const durationMs = Date.now() - session.startedAt.getTime();
    const orchestrated = this.provider.conversationClosedByOrchestrator;

    if (this.onCallEndedHandler) {
      try {
        await this.onCallEndedHandler(session);
      } catch (error) {
        this.logger.error(
          { err: error, conversation_id: conversationId },
          'Error in call ended callback'
        );
      }
    }

    if (orchestrated) {
      // CO closed this conversation mid-call, if at all; its hook fired then.
      this.closedWhileLive.delete(conversationId);
    } else {
      await this.triggerConversationEnded(session);
      // Only when no CO conversation sits behind the call (relay-only, Media
      // Streams): otherwise CO's CLOSED reports the end, with CO's duration.
      trackEvent('Conversation Ended', {
        account_sid: this.config.accountSid,
        channel: this.channelType,
        conversation_id: conversationId,
        duration_ms: durationMs,
      });
    }

    this.logger.debug(
      { conversation_id: conversationId, channel: this.channelType },
      'Released voice session'
    );
    return session;
  }

  /**
   * Fire `onConversationEnded` for a CLOSED webhook.
   *
   * The call has normally ended by now (the socket closed when the caller hung
   * up, or {@link endCall} hung it up), and its session went with it. The hook
   * gets a session rebuilt from Conversation Orchestrator, identity only,
   * which is what lets it fire on whichever instance received the webhook. The
   * call's live state (transcript, `metadata`) reached {@link onCallEnded} at
   * teardown.
   *
   * If this instance still holds the session, the call is live: CO closed the
   * conversation mid-call (a closed timeout during a long hold, or the app
   * closing it). The hook fires now, from a snapshot, and the session stays for
   * the call's own teardown to release — which is what keeps `onCallEnded`
   * firing and the rest of the call working. The call then carries on under
   * the closed conversation's id; CO starts a new conversation for its later
   * traffic, whose own CLOSED arrives here later and takes the rebuild path.
   *
   * The hook is at-least-once: a duplicate CLOSED delivery that isn't deduped
   * by its idempotency token fires it again, same as `onMessageReady`.
   */
  private async handleConversationClosed(
    conversationId: ConversationId,
    durationMs: number | undefined
  ): Promise<void> {
    const live = this.activeConversations.get(conversationId);
    if (live) {
      this.logger.warn(
        { conversation_id: conversationId, call_sid: live.callSid },
        "Conversation closed while its call is still live; the call continues under the closed conversation's id"
      );
      this.closedWhileLive.add(conversationId);
      this.trackConversationEnded(conversationId, durationMs);
      await this.triggerConversationEnded(this.detachedSnapshot(live));
      return;
    }

    this.trackConversationEnded(conversationId, durationMs);
    if (!this.hasConversationEndedHandler()) {
      return;
    }
    const session = await this.rebuildSession(conversationId, undefined, { shared: true });
    if (!session) {
      return;
    }
    await this.triggerConversationEnded(session);
  }

  /**
   * A copy of a live call's session that shares no mutable state with it.
   *
   * `onConversationEnded` may keep or edit what it's given while the call
   * carries on, so the callback-visible data — `metadata` and the nested
   * objects — is cloned. A value that can't be cloned (an app-owned handle, a
   * class instance whose methods a clone would lose) is shared rather than
   * failing the hook.
   */
  private detachedSnapshot(live: ConversationSession): ConversationSession {
    const conversationId = live.conversationId;
    const detached = <T>(value: T, what: string): T => {
      if (value === null || typeof value !== 'object') {
        return value;
      }
      const proto = Object.getPrototypeOf(value) as unknown;
      if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
        return value;
      }
      try {
        return structuredClone(value);
      } catch (error) {
        this.logger.debug(
          { conversation_id: conversationId, value: what, err: error },
          "Sharing a value that can't be copied into the CLOSED snapshot"
        );
        return value;
      }
    };

    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(live.metadata)) {
      metadata[key] = detached(value, `metadata[${JSON.stringify(key)}]`);
    }
    const snapshot: ConversationSession = {
      ...live,
      startedAt: new Date(live.startedAt.getTime()),
      metadata,
    };
    if (live.profile !== undefined) snapshot.profile = detached(live.profile, 'profile');
    if (live.authorInfo !== undefined) {
      snapshot.authorInfo = detached(live.authorInfo, 'authorInfo');
    }
    if (live.aiAgentInfo !== undefined) {
      snapshot.aiAgentInfo = detached(live.aiAgentInfo, 'aiAgentInfo');
    }
    if (live.pendingHandoffData !== undefined) {
      snapshot.pendingHandoffData = detached(live.pendingHandoffData, 'pendingHandoffData');
    }
    return snapshot;
  }

  /**
   * The participant representing TAC's agent at `address` on voice: one that
   * owns the address AND has an agent type. A HUMAN_AGENT at that address is
   * someone else.
   */
  private static findVoiceAgent(
    participants: ConversationParticipant[],
    address: string
  ): ConversationParticipant | undefined {
    return participants.find(
      p =>
        p.type !== undefined &&
        AGENT_TYPES.has(p.type) &&
        p.addresses.some(a => a.channel === CO_VOICE_CHANNEL && a.address === address)
    );
  }

  /**
   * Reconstruct a session from Conversation Orchestrator.
   *
   * Carries identity only — conversation id, `callSid`, profile, both
   * participants. Live in-memory state (transcript, metadata) isn't available
   * here; it reaches {@link onCallEnded}. `callSid` defaults to a VOICE
   * participant address's `channelId` — the customer's if present, else the
   * agent's, else any other participant's. Returns `undefined` if no
   * participant is on the voice channel, which is how another channel's CLOSED
   * is filtered out.
   *
   * `shared` (the CLOSED path) shares the participant lookup with the other
   * channels handling the same webhook; other callers need fresh participants.
   */
  private async rebuildSession(
    conversationId: ConversationId,
    callSid: string | undefined,
    options?: { shared?: boolean }
  ): Promise<ConversationSession | undefined> {
    const client = this.conversationClient;
    if (!client) {
      return undefined;
    }

    let participants: ConversationParticipant[];
    try {
      participants = options?.shared
        ? await this.tac.listParticipantsShared(conversationId)
        : await client.listParticipants(conversationId);
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: conversationId },
        'Failed to list participants while rebuilding a voice session'
      );
      return undefined;
    }

    const onVoice = (p: ConversationParticipant): boolean =>
      p.addresses.some(a => a.channel === CO_VOICE_CHANNEL);
    if (!participants.some(onVoice)) {
      return undefined;
    }

    // A conversation grouped across channels may list another channel's
    // customer first; the caller is the CUSTOMER on VOICE.
    const customer = participants.find(p => p.type === 'CUSTOMER' && onVoice(p));
    // TAC may own several numbers; the agent is whichever one this call used.
    let agent: ConversationParticipant | undefined;
    for (const number of this.config.phoneNumbers) {
      agent = VoiceChannel.findVoiceAgent(participants, number);
      if (agent) break;
    }

    let resolvedCallSid = callSid;
    if (resolvedCallSid === undefined) {
      // CO's conversation webhooks carry no channel ids; the call a voice
      // participant is on is recorded on its VOICE address. Prefer the
      // customer's, then the agent's, then anyone else's.
      const ordered = [
        ...[customer, agent].filter((p): p is ConversationParticipant => p !== undefined),
        ...participants.filter(p => p !== customer && p !== agent),
      ];
      resolvedCallSid =
        ordered.flatMap(p => p.addresses).find(a => a.channel === CO_VOICE_CHANNEL && a.channelId)
          ?.channelId ?? undefined;
      if (resolvedCallSid === undefined) {
        this.logger.debug(
          { conversation_id: conversationId },
          'Rebuilt voice session has no callSid'
        );
      }
    }

    const session: ConversationSession = {
      conversationId,
      channel: this.channelType,
      startedAt: new Date(),
      metadata: {},
    };
    if (resolvedCallSid !== undefined) session.callSid = resolvedCallSid;
    if (customer?.profileId) session.profileId = customer.profileId;

    const customerAddress = customer?.addresses.find(a => a.channel === CO_VOICE_CHANNEL)?.address;
    if (customer && customerAddress) {
      session.authorInfo = { address: customerAddress, participantId: customer.id };
    }
    if (agent) {
      session.aiAgentInfo = {
        address:
          agent.addresses.find(a => a.channel === CO_VOICE_CHANNEL)?.address ??
          this.config.phoneNumber,
        participantId: agent.id,
      };
    }
    return session;
  }

  /**
   * This channel's participants are recorded by Conversation Orchestrator as
   * VOICE, whatever the provider's transport label.
   *
   * @internal
   */
  protected override get coChannel(): string {
    return CO_VOICE_CHANNEL;
  }

  /** @internal */
  protected override isOwnCoAddress(address: string): boolean {
    return this.config.phoneNumbers.includes(address);
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
    // Socket-open half of the Websocket Connected/Disconnected pair. Tracked
    // here rather than in a provider so every transport is covered; no
    // conversation identifier exists yet at this point.
    trackEvent('Websocket Connected', {
      account_sid: this.config.accountSid,
      channel: 'voice',
      provider: this.provider.providerId,
      orchestrator_enabled: this.config.isOrchestratorEnabled(),
    });

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
  public async sendResponse(
    conversationIdOrSession: ConversationId | ConversationSession,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const conversationId =
      typeof conversationIdOrSession === 'string'
        ? conversationIdOrSession
        : (conversationIdOrSession.conversationId as ConversationId);
    await this.provider.sendResponse(conversationId, message, metadata);
    trackEvent('Response Sent', {
      account_sid: this.config.accountSid,
      channel: 'voice',
      conversation_id: conversationId,
      response_type: 'full',
      provider: this.provider.providerId,
      orchestrator_enabled: this.config.isOrchestratorEnabled(),
    });
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
    const fullResponse = await this.provider.sendStreamingResponse(conversationId, stream, options);

    // Empty means nothing reached the caller — an immediate abort, say — so
    // there is no response to report.
    if (fullResponse) {
      trackEvent('Response Sent', {
        account_sid: this.config.accountSid,
        channel: 'voice',
        conversation_id: conversationId,
        response_type: 'streaming',
        provider: this.provider.providerId,
        orchestrator_enabled: this.config.isOrchestratorEnabled(),
      });
    }

    return fullResponse;
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
   * {@link ConversationRelayProvider} and `OpenAIRealtimeProvider` place
   * outbound calls; any other provider declines.
   *
   * @param options - Destination, per-call TwiML and Calls-API overrides.
   *   `OpenAIRealtimeProvider` additionally accepts a per-call `sessionConfig`.
   *   Each provider validates against its own schema and rejects the other's.
   * @returns The placed call's `callSid`.
   */
  public async initiateOutboundConversation(
    options: InitiateVoiceConversationOptions
  ): Promise<InitiateVoiceConversationResult> {
    return this.provider.initiateOutboundConversation(options);
  }

  // =========================================================================
  // Provider Callback Handling
  // =========================================================================

  /**
   * Handle the provider's own out-of-band lifecycle webhook from Twilio.
   *
   * Not every provider has one; those that don't inherit a plain 200
   * acknowledgement. ConversationRelay posts here when a session ends, and
   * cleans up on call completion in voice-only mode — in orchestrated mode the
   * CO webhook owns cleanup.
   *
   * @param payload - Raw callback payload from Twilio; the provider validates it.
   * @returns Response with status, content, and content type
   */
  public async handleTwilioProviderCallback(
    payload: Record<string, unknown>
  ): Promise<TwilioProviderCallbackResponse> {
    return this.provider.handleTwilioProviderCallback(payload);
  }

  /**
   * @deprecated Use {@link VoiceChannel.handleTwilioProviderCallback} instead.
   */
  public async handleConversationRelayCallback(
    payload: ConversationRelayCallbackPayload
  ): Promise<TwilioProviderCallbackResponse> {
    warnDeprecated('handleConversationRelayCallback', 'handleTwilioProviderCallback');
    return this.handleTwilioProviderCallback(payload);
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
   * The session is released as on any hangup: {@link onCallEnded} fires now.
   * On an orchestrated call `onConversationEnded` fires later, when
   * Conversation Orchestrator's CLOSED webhook arrives; otherwise it fires now
   * too.
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
      await this.releaseSession(session.conversationId as ConversationId);
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
   * At the other end the session is released as soon as the call's WebSocket
   * closes, in every mode — so out-of-band events that arrive after the hangup
   * (`onCallStatus`, `onRecording`) generally find nothing here. Read
   * late-call state from the session {@link onCallEnded} hands you instead.
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
   *   it landed on another instance. For the last case,
   *   {@link resolveConversationSessionByCallSid} falls back to Conversation
   *   Orchestrator.
   */
  public getConversationSessionByCallSid(callSid: string): ConversationSession | undefined {
    for (const session of this.activeConversations.values()) {
      if (session.callSid === callSid) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Look up a call's session on any instance, falling back to Conversation
   * Orchestrator when this instance doesn't hold the call.
   *
   * Out-of-band call events (`onCallStatus`, `onAmd`, `onRecording`) carry
   * only a CallSid and, without `TACConfig.instancePublicDomain`, can reach any
   * replica. This returns the live session when the call is held here — same
   * as {@link getConversationSessionByCallSid} — and otherwise, for a
   * ConversationRelay call in orchestrator mode, a session rebuilt from
   * Conversation Orchestrator.
   *
   * A rebuilt session carries identity only (conversation id, `callSid`,
   * profile, both participants), is not tracked, and can't be used with
   * {@link sendResponse}: the call's WebSocket is on another instance. If CO
   * holds several conversations for the call (it starts a new one when a
   * conversation closes mid-call), the active one wins, else the newest — this
   * rule applies only to the rebuild path. On the instance holding the call,
   * the live session is returned as-is, so after a mid-call close it still
   * carries the closed conversation's id while other instances return the new
   * one; correlate by `callSid` if you need a stable key.
   *
   * To tell live from rebuilt, check
   * `voiceChannel.getWebsocket(session.conversationId) !== null` — true only
   * for a session live on this instance. A rebuilt session's `startedAt` is
   * the rebuild time, not the call's, and its `metadata` is always empty.
   *
   * Cost: on a local miss this makes up to two Conversation Orchestrator
   * requests (list conversations, then participants). Prefer
   * {@link getConversationSessionByCallSid} on hot paths, or when
   * `TACConfig.instancePublicDomain` already routes call events to the
   * instance holding the call.
   *
   * @example
   * ```typescript
   * voiceChannel.onCallStatus(async event => {
   *   const session = await voiceChannel.resolveConversationSessionByCallSid(event.callSid);
   *   if (session) {
   *     auditLog(session.conversationId, session.profileId, event.callStatus);
   *   }
   * });
   * ```
   *
   * @param callSid - Twilio Call SID, e.g. from a call event.
   * @returns The live or rebuilt session, or `undefined` — relay-only or Media
   *   Streams mode (no CO conversation behind the call), CO knows no
   *   conversation for it, or the lookup failed (logged).
   */
  public async resolveConversationSessionByCallSid(
    callSid: string
  ): Promise<ConversationSession | undefined> {
    const local = this.getConversationSessionByCallSid(callSid);
    if (local) {
      return local;
    }

    const client = this.conversationClient;
    if (!client || !this.provider.conversationClosedByOrchestrator) {
      return undefined;
    }

    let conversations: ConversationResponse[];
    try {
      conversations = await client.listConversations({ channelId: callSid });
    } catch (error) {
      this.logger.error(
        { err: error, call_sid: callSid },
        'Failed to look up the conversation for a call'
      );
      return undefined;
    }
    if (conversations.length === 0) {
      return undefined;
    }

    const active = conversations.filter(c => c.status === 'ACTIVE');
    const candidates = active.length > 0 ? active : conversations;
    // A missing or unparseable createdAt sorts first, so a conversation with
    // good data always wins over one without.
    const createdAt = (c: ConversationResponse): number =>
      parseIso8601(c.createdAt) ?? Number.NEGATIVE_INFINITY;
    const chosen = candidates.reduce((best, c) => (createdAt(c) > createdAt(best) ? c : best));
    return this.rebuildSession(chosen.id as ConversationId, callSid);
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
   * Throws whenever a consumer supplies a non-ConversationRelay provider, which
   * is the point of the guard. The provider callback used to narrow here too; it
   * now rides {@link VoiceProvider.handleTwilioProviderCallback}'s
   * base-compatible signature instead, which is the eventual shape for these
   * forwarders.
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
    this.activeConversations.clear();
    this.closedWhileLive.clear();
    super.shutdown();
  }
}
