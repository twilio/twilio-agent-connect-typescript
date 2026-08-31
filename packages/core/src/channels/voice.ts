import { WebSocket } from 'ws';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import Twilio from 'twilio';
import {
  ChannelType,
  ConversationId,
  ConversationSession,
  ProfileId,
  WebSocketMessageSchema,
  PromptMessage,
  InterruptMessage,
  TextTokenMessage,
  CustomParameters,
  ConversationRelayConfig,
  ConversationRelayConfigSchema,
  ConversationRelayCallbackPayload,
  InitiateVoiceConversationOptions,
  InitiateVoiceConversationOptionsSchema,
  TwiMLOptions,
  TwiMLRequest,
  ConversationWebhookPayload,
  CallOptions,
  CallEventKind,
  CallStatusEvent,
  AmdEvent,
  RecordingEvent,
  CallOptionsSchema,
  callOptionsToCreateParams,
  callStatusEventFromForm,
  amdEventFromForm,
  recordingEventFromForm,
} from '../types/index';
import type { InitiateVoiceConversationResult } from '../types/conversation';
import { BaseChannel, BaseChannelEvents, BaseChannelOptions } from './base';
import type { TAC } from '../lib/tac';
import { TACMemoryResponse } from '../lib/tac-memory-response';
import { maskAddress, redactTwimlParameters } from '../util/log-redaction';
import { studioVoiceHandoffUrl } from '../util/handoff-urls';

/** Fixed default welcome greeting applied when no layer sets one. */
const DEFAULT_WELCOME_GREETING = 'Hello! How can I assist you today?';

/**
 * Configuration for the Voice channel.
 *
 * `defaultTwimlOptions` is one of several TwiML layers that merge per-field;
 * see `handleIncomingCall` (inbound) and `initiateOutboundConversation`
 * (outbound) for the full precedence order.
 */
export interface VoiceChannelConfig extends BaseChannelOptions {
  /**
   * Static `TwiMLOptions` applied to every call (inbound and outbound).
   * Controls the TwiML inside `<ConversationRelay>` — voice, language,
   * transcription provider, welcomeGreeting, `<Language>` children, etc. Use
   * this when the same ConversationRelay configuration is correct for every call.
   *
   * Per-call inbound customization is registered via
   * `VoiceChannel.onInboundCallTwiml(...)` (not on this config).
   *
   * Note: `customParameters` and `languages` replace wholesale when a
   * higher-priority layer sets them.
   */
  defaultTwimlOptions?: TwiMLOptions;

  /**
   * Static {@link CallOptions} applied to every outbound call — the
   * `calls.create` parameters, including the call-event callback URLs. This is
   * the layer to use for a custom server or non-default routes: URLs set here
   * override the ones TAC would derive from `voicePublicDomain` +
   * `voiceCallEventPath`.
   */
  defaultCallOptions?: CallOptions;
}

/**
 * Callback that produces per-call overrides for the TwiML inside
 * `<ConversationRelay>` on inbound calls. Receives a framework-neutral
 * {@link TwiMLRequest} and returns {@link TwiMLOptions}.
 */
export type InboundCallTwimlHandler = (req: TwiMLRequest) => Promise<TwiMLOptions>;

/** Handler for Twilio `statusCallback` webhooks. */
export type CallStatusHandler = (event: CallStatusEvent) => Promise<void> | void;

/** Handler for Twilio `asyncAmdStatusCallback` webhooks. */
export type AmdHandler = (event: AmdEvent) => Promise<void> | void;

/** Handler for Twilio `recordingStatusCallback` webhooks. */
export type RecordingHandler = (event: RecordingEvent) => Promise<void> | void;

/**
 * Stringify a custom-parameter value for emission as a `<Parameter value=...>`.
 * Parameter values are scalars in practice; objects are JSON-encoded rather
 * than producing '[object Object]'.
 */
function stringifyParameterValue(value: unknown): string {
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  // string | number | boolean | bigint | symbol — all safely stringifiable.
  return String(value as string | number | boolean | bigint);
}

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
  onWebSocketConnected?: (data: { conversationId: ConversationId }) => void;
  onWebSocketDisconnected?: (data: { conversationId: ConversationId }) => void;
}

/**
 * Voice Channel implementation for Twilio ConversationRelay
 *
 * Handles voice conversations through WebSocket connections.
 * Manages real-time audio streaming and conversation state.
 */
export interface StreamTask {
  controller: AbortController;
  hasSentTokens: boolean;
}

export class VoiceChannel extends BaseChannel {
  private readonly webSocketConnections: Map<ConversationId, WebSocket>;
  private readonly voiceCallbacks: VoiceChannelEvents;
  private readonly streamTasks: Map<ConversationId, StreamTask>;
  private readonly promptQueues: Map<ConversationId, Promise<void>>;
  private readonly initializationRetries: Map<string, number>;
  private readonly callSidToConversationId: Map<string, ConversationId>;
  private readonly MAX_INITIALIZATION_RETRIES = 3;
  private twilioClient: ReturnType<typeof Twilio> | undefined;
  private readonly voiceConfig: VoiceChannelConfig;
  private onInboundCallTwimlHandler: InboundCallTwimlHandler | undefined;
  private onCallStatusHandler: CallStatusHandler | undefined;
  private onAmdHandler: AmdHandler | undefined;
  private onRecordingHandler: RecordingHandler | undefined;

  constructor(tac: TAC, options?: VoiceChannelConfig) {
    super(tac, options);
    this.voiceConfig = options ?? {};
    this.webSocketConnections = new Map();
    this.voiceCallbacks = {};
    this.streamTasks = new Map();
    this.promptQueues = new Map();
    this.initializationRetries = new Map();
    this.callSidToConversationId = new Map();
  }

  /**
   * Register a callback that produces per-call overrides for the TwiML inside
   * `<ConversationRelay>` on inbound calls.
   *
   * The callback receives a framework-neutral {@link TwiMLRequest} (parsed from
   * the Twilio webhook form) and returns {@link TwiMLOptions}. Fields the
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

  /**
   * Resolve the public WebSocket URL from `TACConfig.voicePublicDomain` +
   * `TACConfig.voiceWebsocketPath`. Throws if `voicePublicDomain` isn't set.
   */
  private resolveWebsocketUrl(action: string): string {
    if (this.config.voicePublicDomain) {
      return `wss://${this.config.voicePublicDomain}${this.config.voiceWebsocketPath}`;
    }
    throw new Error(
      `${action} needs a WebSocket URL. Set TWILIO_VOICE_PUBLIC_DOMAIN ` +
        '(or TACConfig.voicePublicDomain).'
    );
  }

  /**
   * Resolve the default `<Connect action=...>` cleanup URL.
   *
   * Returns undefined if `voicePublicDomain` isn't set; that's fine because
   * actionUrl has higher-priority layers (customizer, twimlOptions, Studio
   * handoff) above this fallback.
   */
  private resolveDefaultActionUrl(): string | undefined {
    if (this.config.voicePublicDomain) {
      return `https://${this.config.voicePublicDomain}${this.config.voiceActionPath}`;
    }
    return undefined;
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
    return this.webSocketConnections.get(conversationId) || null;
  }

  /**
   * Handle WebSocket connection from ConversationRelay
   */
  public handleWebSocketConnection(ws: WebSocket): void {
    let conversationId: ConversationId | null = null;
    let callSid: string | null = null;
    let fromNumber: string | null = null;
    let initializationFailed = false;

    ws.on('message', (data: Buffer) => {
      (async (): Promise<void> => {
        try {
          const messageData = JSON.parse(data.toString()) as unknown;
          const result = WebSocketMessageSchema.safeParse(messageData);

          if (!result.success) {
            this.logger.debug(
              {
                validation_errors: result.error.issues.map(issue => ({
                  path: issue.path.join('.'),
                  message: issue.message,
                })),
              },
              'Invalid or unrecognized WebSocket message, skipping'
            );
            return;
          }

          const message = result.data;

          switch (message.type) {
            case 'setup':
              callSid = message.callSid;
              fromNumber = message.from;
              if (this.voiceCallbacks.onSetup) {
                this.voiceCallbacks.onSetup({
                  callSid,
                  from: message.from,
                  to: message.to,
                  customParameters: message.customParameters,
                });
              }
              break;

            case 'prompt':
              if (!conversationId && callSid) {
                // Check retry limit before attempting initialization
                const retryCount = this.initializationRetries.get(callSid) ?? 0;
                if (retryCount >= this.MAX_INITIALIZATION_RETRIES) {
                  throw new Error(
                    `Cannot process prompt - conversation initialization failed after ${retryCount} attempts for callSid ${callSid}`
                  );
                }

                try {
                  if (initializationFailed) {
                    this.logger.info(
                      { call_sid: callSid, retry_count: retryCount },
                      'Retrying conversation initialization after previous failure'
                    );
                  }

                  if (!this.tac.isOrchestratorEnabled()) {
                    // Voice-only mode: use callSid as conversationId directly
                    conversationId = callSid as ConversationId;
                    this.webSocketConnections.set(conversationId, ws);
                    this.callSidToConversationId.set(callSid, conversationId);
                    const session = this.startConversation(conversationId);
                    // Relay-only: conversationId === callSid.
                    session.callSid = callSid;

                    if (fromNumber) {
                      session.authorInfo = { address: fromNumber };
                    }
                  } else {
                    // Orchestrated mode: poll for conversation created by CO
                    if (!this.conversationClient) {
                      throw new Error('Conversation client is required in orchestrated mode');
                    }

                    const POLL_ATTEMPTS = 5;
                    const POLL_DELAY_MS = 500;
                    let conversations: Awaited<
                      ReturnType<typeof this.conversationClient.listConversations>
                    > = [];

                    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
                      conversations = await this.conversationClient.listConversations({
                        channelId: callSid,
                      });
                      if (conversations.length === 1) break;
                      if (attempt < POLL_ATTEMPTS - 1) {
                        this.logger.debug(
                          { call_sid: callSid, attempt: attempt + 1, found: conversations.length },
                          'Conversation not ready yet, polling again'
                        );
                        await new Promise(resolve => setTimeout(resolve, POLL_DELAY_MS));
                      }
                    }

                    if (conversations.length !== 1) {
                      throw new Error(
                        `Expected exactly 1 conversation for callSid ${callSid}, ` +
                          `but found ${conversations.length} after ${POLL_ATTEMPTS} attempts`
                      );
                    }

                    const conversation = conversations[0]!;
                    conversationId = conversation.id as ConversationId;

                    const participants =
                      await this.conversationClient.listParticipants(conversationId);

                    const customerParticipant = participants.find(p => p.type === 'CUSTOMER');
                    const customerAddress =
                      customerParticipant?.addresses?.find(a => a.channel === 'VOICE')?.address ??
                      fromNumber ??
                      undefined;
                    const profileId: ProfileId | undefined = customerParticipant?.profileId
                      ? (customerParticipant.profileId as ProfileId)
                      : undefined;

                    this.webSocketConnections.set(conversationId, ws);
                    this.callSidToConversationId.set(callSid, conversationId);
                    const session = this.startConversation(conversationId, profileId);
                    // In orchestrator mode conversationId is the Orchestrator
                    // conversation id, so record the CallSid so out-of-band call
                    // webhooks can reach this session (resolved via
                    // getConversationSessionByCallSid).
                    session.callSid = callSid;

                    if (customerAddress) {
                      session.authorInfo = {
                        address: customerAddress,
                      };
                    }
                  }

                  if (this.voiceCallbacks.onWebSocketConnected) {
                    this.voiceCallbacks.onWebSocketConnected({ conversationId });
                  }

                  // Success! Clear retry count and failed flag
                  initializationFailed = false;
                  this.initializationRetries.delete(callSid);
                  this.logger.info(
                    { conversation_id: conversationId, call_sid: callSid },
                    'Conversation initialization succeeded'
                  );
                } catch (err) {
                  initializationFailed = true;
                  this.initializationRetries.set(callSid, retryCount + 1);
                  this.logger.error(
                    { err, call_sid: callSid, retry_count: retryCount + 1 },
                    'Conversation initialization failed'
                  );
                  throw err;
                }
              }

              if (conversationId) {
                const previousPrompt = this.promptQueues.get(conversationId) ?? Promise.resolve();
                const currentPrompt = previousPrompt
                  .then(() => this.handlePromptMessage(conversationId!, message))
                  .catch((err: unknown) => {
                    this.handleError(err instanceof Error ? err : new Error(String(err)), {
                      conversationId,
                      message: data.toString(),
                    });
                  });
                this.promptQueues.set(conversationId, currentPrompt);
              } else {
                this.logger.warn('Received prompt before conversation initialized');
              }
              break;

            case 'interrupt':
              if (conversationId) {
                this.handleInterruptMessage(conversationId, message);
              }
              break;

            default:
              this.logger.debug(
                {
                  conversation_id: conversationId,
                  message_type: (messageData as Record<string, unknown>)?.type,
                },
                'Unhandled WebSocket event type'
              );
              break;
          }
        } catch (error) {
          this.handleError(error instanceof Error ? error : new Error(String(error)), {
            conversationId,
            callSid,
            message: data.toString(),
          });
        }
      })().catch((err: unknown) => {
        this.logger.error({ err }, 'Unhandled error in WebSocket message handler');
      });
    });

    ws.on('close', () => {
      if (conversationId) {
        void this.handleWebSocketDisconnect(conversationId).catch((err: unknown) => {
          this.logger.error(
            { err, conversation_id: conversationId },
            'WebSocket disconnect handler error'
          );
        });
      }
      if (callSid) {
        this.initializationRetries.delete(callSid);
        this.callSidToConversationId.delete(callSid);
      }
    });

    ws.on('error', (error: Error) => {
      this.handleError(error, { conversationId });
    });
  }

  /**
   * Handle WebSocket prompt message (user speech)
   */
  private async handlePromptMessage(
    conversationId: ConversationId,
    message: PromptMessage
  ): Promise<void> {
    const transcript = message.voicePrompt;

    // Start a new stream task so the AbortSignal is available to handlers.
    // startStreamTask() cancels any existing task internally.
    const streamTask = this.startStreamTask(conversationId);

    // Get session for memory retrieval
    const session = this.getConversationSession(conversationId);

    // Retrieve memory if enabled via memoryMode
    const userMemory = session
      ? await this.retrieveMemoryIfEnabled(session, transcript)
      : undefined;

    if (this.voiceCallbacks.onPrompt) {
      await this.voiceCallbacks.onPrompt({
        conversationId,
        transcript,
        abortSignal: streamTask.controller.signal,
        ...(userMemory !== undefined && { userMemory }),
        ...(session !== undefined && { session }),
      });
    }
  }

  /**
   * Handle WebSocket interrupt message
   */
  private handleInterruptMessage(conversationId: ConversationId, message: InterruptMessage): void {
    const { utteranceUntilInterrupt, durationUntilInterruptMs } = message;

    // Check whether tokens were sent before cancelling (cancel deletes the entry)
    const streamTask = this.streamTasks.get(conversationId);
    const wasStreaming = streamTask?.hasSentTokens ?? false;

    // Cancel any in-flight stream task on interrupt
    const cancelled = this.cancelStreamTask(conversationId);
    if (cancelled) {
      this.logger.info(
        { conversation_id: conversationId },
        'Cancelled stream task due to interrupt'
      );
    }

    // Finalize the interrupted token stream so ConversationRelay stops
    // waiting for more tokens. Only needed when tokens were actually sent;
    // sending last:true without a preceding stream creates a spurious empty turn.
    if (cancelled && wasStreaming) {
      const ws = this.webSocketConnections.get(conversationId);
      if (ws?.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'text', token: '', last: true }));
        } catch (err) {
          this.logger.debug(
            { conversation_id: conversationId, err },
            'WebSocket closed before sending stream finalization'
          );
        }
      }
    }

    if (this.voiceCallbacks.onInterrupt) {
      this.voiceCallbacks.onInterrupt({
        conversationId,
        utteranceUntilInterrupt,
        durationUntilInterruptMs,
      });
    }
  }

  /**
   * Handle WebSocket disconnection. In orchestrated mode the conversation stays
   * tracked until the CLOSED webhook (so a follow-up call can reuse it); in
   * voice-only mode there is no such webhook, so it ends here.
   */
  private async handleWebSocketDisconnect(conversationId: ConversationId): Promise<void> {
    this.cancelStreamTask(conversationId);
    this.webSocketConnections.delete(conversationId);
    this.promptQueues.delete(conversationId);

    if (this.voiceCallbacks.onWebSocketDisconnected) {
      this.voiceCallbacks.onWebSocketDisconnected({ conversationId });
    }

    if (!this.tac.isOrchestratorEnabled()) {
      await this.endConversation(conversationId);
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
    try {
      const ws = this.webSocketConnections.get(conversationId);

      if (ws?.readyState !== WebSocket.OPEN) {
        throw new Error(`No active WebSocket connection for conversation ${conversationId}`);
      }

      const response: TextTokenMessage = {
        type: 'text',
        token: message,
        last: true,
      };

      ws.send(JSON.stringify(response));

      // If a handoff is pending, send the WS "end" message now that the
      // LLM's final response has been delivered to the caller.
      const session = this.getConversationSession(conversationId);
      if (session?.pendingHandoffData) {
        try {
          ws.send(JSON.stringify(session.pendingHandoffData));
          delete session.pendingHandoffData;
        } catch (err) {
          this.logger.warn(
            { err, conversation_id: conversationId },
            'WebSocket closed before sending handoff end message; caller will not be transferred'
          );
        }
      }

      return Promise.resolve();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message,
        metadata,
      });
      throw error;
    }
  }

  /**
   * Send a streaming voice response via WebSocket, token by token.
   *
   * Each chunk from the iterable is sent as a text token message with last: false.
   * After the iterable completes, a final empty marker with last: true is sent
   * only if at least one token was emitted. If the AbortSignal fires (e.g., user
   * interrupted), iteration stops and no final marker is sent (the interrupt
   * handler sends the finalization instead).
   *
   * @returns The accumulated full response text.
   */
  public async sendStreamingResponse(
    conversationId: ConversationId,
    stream: AsyncIterable<string>,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    const ws = this.webSocketConnections.get(conversationId);

    if (ws?.readyState !== WebSocket.OPEN) {
      throw new Error(`No active WebSocket connection for conversation ${conversationId}`);
    }

    const activeTask = this.streamTasks.get(conversationId);
    const signal = options?.signal ?? activeTask?.controller.signal;
    let fullResponse = '';
    let hasSentTokens = false;

    if (signal?.aborted) {
      return fullResponse;
    }

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          break;
        }

        if (ws.readyState !== WebSocket.OPEN) {
          this.logger.info(
            { conversation_id: conversationId },
            'WebSocket closed during streaming'
          );
          break;
        }

        fullResponse += chunk;
        const tokenMessage: TextTokenMessage = {
          type: 'text',
          token: chunk,
          last: false,
        };
        ws.send(JSON.stringify(tokenMessage));
        hasSentTokens = true;
        if (activeTask) {
          activeTask.hasSentTokens = true;
        }
      }

      if (!signal?.aborted && hasSentTokens && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'text', token: '', last: true }));
      }
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
      });
      throw error;
    } finally {
      // Only clean up if we still own the active stream task.
      // A new prompt may have replaced it while we were unwinding.
      if (activeTask && this.streamTasks.get(conversationId) === activeTask) {
        this.completeStreamTask(conversationId);
      }
    }

    return fullResponse;
  }

  // =========================================================================
  // Incoming Call Handling
  // =========================================================================

  /**
   * Generate the TwiML response for an incoming voice call.
   *
   * ConversationRelay automatically handles conversation creation and
   * participant management via the `conversationConfiguration` parameter.
   *
   * The WebSocket URL and default session-cleanup action URL are derived from
   * `TACConfig.voicePublicDomain` + `TACConfig.voiceWebsocketPath` /
   * `voiceActionPath`.
   *
   * TwiML fields are merged per-field, highest precedence first:
   *   1. Output of the customizer registered via
   *      `VoiceChannel.onInboundCallTwiml(...)` if configured and `twimlRequest`
   *      is given. (Application-owned.)
   *   2. `VoiceChannelConfig.defaultTwimlOptions` — per-channel defaults.
   *   3. `hostTwimlOptions` — per-call transport facts supplied by the host (the
   *      code owning the route), e.g. a per-call `websocketUrl` with an affinity
   *      token.
   *   4. TAC defaults: a fixed default welcomeGreeting, `conversationConfiguration`
   *      from `TACConfig`, `actionUrl` resolved via Studio handoff (when
   *      `studioHandoffFlowSid` is configured), else derived from
   *      `TACConfig.voicePublicDomain` + `voiceActionPath`, and the `websocketUrl`
   *      derived from `TACConfig.voicePublicDomain` + `voiceWebsocketPath`.
   *
   * Fields not set at a layer fall through to lower layers. Arrays (`languages`)
   * and nested objects (`customParameters`) replace wholesale when set at a
   * higher-priority layer. `websocketUrl` falls back to the `TACConfig`-derived
   * URL if unset at every layer.
   *
   * @param twimlRequest - Parsed Twilio webhook fields. Passed to the customizer
   *   if one is configured on the channel.
   * @param options - Additional per-call inputs.
   * @param options.hostTwimlOptions - Per-call TwiML supplied by a custom
   *   in-process host (e.g. an affinity-routed deployment injecting a per-call
   *   `websocketUrl`), layered below `defaultTwimlOptions` and the application
   *   customizer but above the TAC defaults.
   * @returns TwiML XML string for call connection.
   */
  public async handleIncomingCall(
    twimlRequest?: TwiMLRequest,
    options?: { hostTwimlOptions?: TwiMLOptions }
  ): Promise<string> {
    let customized: TwiMLOptions | undefined;
    if (this.onInboundCallTwimlHandler && twimlRequest) {
      customized = await this.onInboundCallTwimlHandler(twimlRequest);
    }

    const merged = this.buildTwimlOptions(options?.hostTwimlOptions, customized);
    const websocketUrl = merged.websocketUrl ?? this.resolveWebsocketUrl('handleIncomingCall');
    return this.generateTwiml(websocketUrl, merged);
  }

  /**
   * Layer TwiML options, lowest precedence first: TAC defaults → `host`
   * (calling host's per-call values) → channel `defaultTwimlOptions` → `perCall`
   * (application customizer output for inbound, or
   * `InitiateVoiceConversationOptions.twimlOptions` for outbound).
   */
  private buildTwimlOptions(
    host: TwiMLOptions | undefined,
    perCall: TwiMLOptions | undefined
  ): TwiMLOptions {
    const merged: TwiMLOptions = {
      welcomeGreeting: DEFAULT_WELCOME_GREETING,
      ...(this.tac.isOrchestratorEnabled() && this.config.conversationConfigurationId !== undefined
        ? { conversationConfiguration: this.config.conversationConfigurationId }
        : {}),
    };
    const resolvedActionUrl = this.resolveActionUrl(host, perCall);
    if (resolvedActionUrl !== undefined) {
      merged.actionUrl = resolvedActionUrl;
    }
    if (host) {
      this.overlayFields(merged, host);
    }
    if (this.voiceConfig.defaultTwimlOptions) {
      this.overlayFields(merged, this.voiceConfig.defaultTwimlOptions);
    }
    if (perCall) {
      this.overlayFields(merged, perCall);
    }
    return merged;
  }

  /**
   * Apply fields explicitly present on `source` onto `target`.
   *
   * Nested objects (`customParameters`), arrays (`languages`), and dicts
   * (`extra`) replace wholesale — there's no per-key merging.
   *
   * `actionUrl` is skipped here on purpose — it's resolved once via
   * `resolveActionUrl` looking at every layer at once, and that resolved value
   * is written into `target` before this overlay runs. Letting it through here
   * would let a higher-priority layer that didn't set actionUrl silently clobber
   * a lower layer that did.
   *
   * "Explicitly present" is detected via key presence (`key in source`), which
   * mirrors Python's `model_fields_set`: a key set to `undefined` is still
   * "present" and overrides lower layers, while an absent key falls through.
   */
  private overlayFields(target: TwiMLOptions, source: TwiMLOptions): void {
    for (const key of Object.keys(source) as (keyof TwiMLOptions)[]) {
      if (key === 'actionUrl') {
        continue;
      }
      // Index assignment across a heterogeneous record; both sides are TwiMLOptions.
      (target as Record<string, unknown>)[key] = (source as Record<string, unknown>)[key];
    }
  }

  /**
   * Resolve the TwiML `<Connect action=...>` URL.
   *
   * Precedence (highest to lowest):
   *   1. application customizer
   *   2. channel `defaultTwimlOptions`
   *   3. `host` (calling host's per-call options)
   *   4. Studio handoff (when `studioHandoffFlowSid` is configured)
   *   5. Channel default — derived from `TACConfig.voicePublicDomain` +
   *      `TACConfig.voiceActionPath`.
   *
   * User-expressed intent (Studio handoff is configured explicitly on
   * `TACConfig`) beats the SDK's generated cleanup default.
   *
   * Explicit `actionUrl: undefined` on a layer (key present, value undefined)
   * suppresses `<Connect action=...>` entirely — all lower layers are skipped.
   * `actionUrl` left absent (key not present) falls through to the next layer.
   */
  private resolveActionUrl(
    host: TwiMLOptions | undefined,
    customized: TwiMLOptions | undefined
  ): string | undefined {
    if (customized && 'actionUrl' in customized) {
      return customized.actionUrl;
    }
    if (
      this.voiceConfig.defaultTwimlOptions &&
      'actionUrl' in this.voiceConfig.defaultTwimlOptions
    ) {
      return this.voiceConfig.defaultTwimlOptions.actionUrl;
    }
    if (host && 'actionUrl' in host) {
      return host.actionUrl;
    }
    if (this.config.studioHandoffFlowSid) {
      return studioVoiceHandoffUrl(this.config.accountSid, this.config.studioHandoffFlowSid);
    }
    return this.resolveDefaultActionUrl();
  }

  // =========================================================================
  // Outbound Call Handling
  // =========================================================================

  /**
   * Overlay `perCall` onto `VoiceChannelConfig.defaultCallOptions`.
   *
   * Per-field via key presence, the same convention {@link overlayFields} uses
   * for TwiML options — so a per-call `{ machineDetection: undefined }`
   * explicitly clears the channel default rather than falling through to it.
   *
   * The result is always validated, for two reasons: a combination only
   * reachable by layering — per-call clearing `machineDetection` while the
   * default set `asyncAmd` — must still fail instead of reaching Twilio, and
   * `VoiceChannelConfig` is a plain interface, so `defaultCallOptions` has had
   * no runtime validation of its own.
   */
  private mergeCallOptions(perCall: CallOptions | undefined): CallOptions | undefined {
    const defaults = this.voiceConfig.defaultCallOptions;
    if (!defaults && !perCall) {
      return undefined;
    }

    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(defaults ?? {})) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
    for (const key of Object.keys(perCall ?? {})) {
      merged[key] = (perCall as Record<string, unknown>)[key];
    }
    return CallOptionsSchema.parse(merged);
  }

  /**
   * Build the extra arguments for `client.calls.create`.
   *
   * Layers, highest precedence first: this call's `callOptions`,
   * `VoiceChannelConfig.defaultCallOptions`, then callback URLs derived from
   * `voicePublicDomain` + `voiceCallEventPath`.
   *
   * A URL is derived only when its handler is registered. That's a deliberate
   * deviation from `websocketUrl` / `actionUrl`, which derive unconditionally:
   * those are load-bearing, so a wrong one fails loudly on the first call,
   * whereas an unwanted call-event URL fails as silent 11200 alerts for a
   * feature nobody asked for. Set the URLs in `defaultCallOptions` when TAC
   * isn't serving the routes.
   */
  private buildCallParams(callOptions: CallOptions | undefined): Record<string, unknown> {
    const merged = this.mergeCallOptions(callOptions);
    const params = merged ? callOptionsToCreateParams(merged) : {};

    const wiring: [CallEventKind, string, unknown][] = [
      ['status', 'statusCallback', this.onCallStatusHandler],
      ['amd', 'asyncAmdStatusCallback', this.onAmdHandler],
      ['recording', 'recordingStatusCallback', this.onRecordingHandler],
    ];
    for (const [kind, param, handler] of wiring) {
      if (!handler) continue;
      const url = this.config.callEventUrl(kind);
      // An explicit URL from either options layer is never overwritten.
      if (url !== undefined && params[param] === undefined) {
        params[param] = url;
      }
    }

    return params;
  }

  /**
   * Initiate an outbound voice conversation
   *
   * Places an outbound call with inline TwiML that connects to ConversationRelay.
   * The conversationConfiguration attribute tells CO to create and manage the
   * conversation during passive hydration. The session is initialized lazily
   * on the first prompt when the conversation is discovered by callSid.
   *
   * TwiML fields are merged per-field, highest precedence first:
   *   1. `options.twimlOptions` — per-call overrides
   *   2. `VoiceChannelConfig.defaultTwimlOptions` — channel-wide defaults
   *   3. TAC defaults: welcome greeting, `conversationConfiguration` from
   *      `TACConfig`, and `actionUrl` from Studio handoff (if configured), else
   *      derived from `TACConfig.voicePublicDomain` + `voiceActionPath`.
   *
   * Calls-API parameters merge the same way:
   *   1. `options.callOptions` — per-call overrides
   *   2. `VoiceChannelConfig.defaultCallOptions` — channel-wide defaults
   *   3. Callback URLs derived from `TACConfig.voicePublicDomain` +
   *      `voiceCallEventPath`, for handlers that are registered
   *
   * The WebSocket URL is derived from `TACConfig.voicePublicDomain` +
   * `TACConfig.voiceWebsocketPath`, unless overridden per-call via
   * `options.websocketUrl`.
   */
  public async initiateOutboundConversation(
    options: InitiateVoiceConversationOptions
  ): Promise<InitiateVoiceConversationResult> {
    const validated = InitiateVoiceConversationOptionsSchema.parse(options);
    const fromNumber = this.config.phoneNumber;

    this.logger.info(
      { to: validated.to, from: fromNumber },
      'Initiating outbound voice conversation'
    );

    try {
      // Outbound has no inbound customizer and no host layer; the per-call
      // override is options.twimlOptions.
      const merged = this.buildTwimlOptions(undefined, validated.twimlOptions);

      // `options.websocketUrl` is the dedicated per-call outbound override and
      // wins over any websocketUrl that came through the layered twimlOptions
      // merge; both fall back to the TACConfig-derived URL.
      const websocketUrl =
        validated.websocketUrl ??
        merged.websocketUrl ??
        this.resolveWebsocketUrl('initiateOutboundConversation');
      const twiml = this.generateTwiml(websocketUrl, merged);
      const callParams = this.buildCallParams(validated.callOptions);

      // The inline TwiML handed to Twilio, useful for debugging the
      // <Connect action> handoff target. customParameters values are masked —
      // they're arbitrary developer data (profile IDs, caller names), unlike
      // the WS/action URLs and conversation config.
      this.logger.debug(
        { twiml: redactTwimlParameters(twiml), to: maskAddress(validated.to) },
        'Outbound call TwiML'
      );

      // Place the outbound call with inline TwiML
      const client = this.getTwilioClient();
      const call = await client.calls.create({
        to: validated.to,
        from: fromNumber,
        twiml,
        ...callParams,
      });

      this.logger.info(
        { call_sid: call.sid, to: maskAddress(validated.to) },
        'Outbound voice call placed'
      );

      return { callSid: call.sid };
    } catch (error) {
      this.logger.error(
        { err: error, to: maskAddress(validated.to) },
        'Failed to initiate outbound call'
      );
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        to: validated.to,
      });
      throw error;
    }
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
   */
  public async handleConversationRelayCallback(
    payload: ConversationRelayCallbackPayload
  ): Promise<{ status: number; content: string; contentType: string }> {
    this.logger.debug(
      { call_sid: payload.CallSid, call_status: payload.CallStatus },
      'ConversationRelay callback received'
    );

    if (payload.AccountSid !== this.config.accountSid) {
      this.logger.warn(
        { expected: this.config.accountSid, received: payload.AccountSid },
        'ConversationRelay callback AccountSid mismatch, ignoring'
      );
      return { status: 403, content: 'Forbidden', contentType: 'text/plain' };
    }

    if (payload.CallStatus === 'completed' && !this.tac.isOrchestratorEnabled()) {
      const conversationId = this.callSidToConversationId.get(payload.CallSid);
      if (conversationId) {
        this.callSidToConversationId.delete(payload.CallSid);
        await this.endConversation(conversationId);
      }
    }

    return { status: 200, content: 'OK', contentType: 'text/plain' };
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
   * Works on `callSid` alone, in any mode and before a session exists, so it's
   * safe from a call-event handler that fires before the first prompt. Session
   * cleanup no-ops if no tracked session matches.
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
   * Sessions are created on the caller's first prompt, not at WebSocket setup,
   * so this returns `undefined` for a call that connected but hasn't been spoken
   * into. That includes `onAmd` under `machineDetection: 'Enable'`, which fires
   * before the first prompt by design — hang up with {@link endCall}, which
   * needs no session.
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
   * @returns The session, or `undefined` — no first prompt yet, the call ended,
   *   or it landed on another instance (see the horizontal-scaling note in
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
  // =========================================================================

  /**
   * Start tracking a streaming task for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns The stream task with its AbortController
   */
  public startStreamTask(conversationId: ConversationId): StreamTask {
    // Cancel any existing task
    this.cancelStreamTask(conversationId);

    const task: StreamTask = { controller: new AbortController(), hasSentTokens: false };
    this.streamTasks.set(conversationId, task);

    this.logger.debug({ conversation_id: conversationId }, 'Started stream task');
    return task;
  }

  /**
   * Cancel an active streaming task
   *
   * @param conversationId - The conversation ID
   * @returns true if a task was cancelled, false otherwise
   */
  public cancelStreamTask(conversationId: ConversationId): boolean {
    const task = this.streamTasks.get(conversationId);
    if (task) {
      task.controller.abort();
      this.streamTasks.delete(conversationId);
      this.logger.debug({ conversation_id: conversationId }, 'Cancelled stream task');
      return true;
    }
    return false;
  }

  /**
   * Complete a streaming task (remove from tracking)
   *
   * @param conversationId - The conversation ID
   */
  public completeStreamTask(conversationId: ConversationId): void {
    this.streamTasks.delete(conversationId);
    this.logger.debug({ conversation_id: conversationId }, 'Completed stream task');
  }

  /**
   * Check if a stream task is active
   *
   * @param conversationId - The conversation ID
   * @returns true if an active task exists
   */
  public hasActiveStreamTask(conversationId: ConversationId): boolean {
    const task = this.streamTasks.get(conversationId);
    return task !== undefined && !task.controller.signal.aborted;
  }

  // =========================================================================
  // ConversationRelay TwiML Generation
  // =========================================================================

  /**
   * Field names on {@link TwiMLOptions} that map directly to `<ConversationRelay>`
   * attributes (camelCase, emitted as-is). Excludes the fields handled specially
   * by {@link generateTwiml}: websocketUrl (resolved through the layered merge and
   * emitted as the `url` attribute), actionUrl, languages, customParameters, extra.
   */
  private static readonly RELAY_ATTR_FIELDS: readonly (keyof TwiMLOptions)[] = [
    'welcomeGreeting',
    'welcomeGreetingInterruptible',
    'conversationConfiguration',
    'language',
    'ttsLanguage',
    'transcriptionLanguage',
    'voice',
    'ttsProvider',
    'transcriptionProvider',
    'speechModel',
    'elevenlabsTextNormalization',
    'eotThreshold',
    'partialPrompts',
    'deepgramSmartFormat',
    'speechTimeout',
    'interruptible',
    'interruptSensitivity',
    'reportInputDuringAgentSpeech',
    'ignoreBackchannel',
    'preemptible',
    'dtmfDetection',
    'hints',
    'events',
    'debug',
    'intelligenceService',
  ];

  /**
   * Generate TwiML XML for ConversationRelay from a merged {@link TwiMLOptions}.
   *
   * This is the low-level emitter used by `handleIncomingCall` and
   * `initiateOutboundConversation` after layering. It mirrors the Python SDK's
   * `generate_twiml`. The WebSocket URL may be passed as `websocketUrl` or via
   * `options.websocketUrl` (the explicit argument wins when both are given), so a
   * channel-less caller can pass everything in one object.
   *
   * @param websocketUrl - Public WebSocket URL (e.g. 'wss://example.ngrok.app/ws').
   *   Optional if `options.websocketUrl` is set.
   * @param options - Merged TwiMLOptions to emit.
   * @returns TwiML XML string ready to return to Twilio.
   * @throws {Error} if no WebSocket URL is provided via either source.
   */
  private generateTwiml(websocketUrl: string | undefined, options: TwiMLOptions): string {
    const resolvedWebsocketUrl = websocketUrl || options.websocketUrl;
    if (!resolvedWebsocketUrl) {
      throw new Error(
        'generateTwiml requires a WebSocket URL — pass it explicitly or set options.websocketUrl.'
      );
    }

    const response = new VoiceResponse();

    // <Connect action=...> — actionUrl undefined means no action attribute.
    const connect = response.connect(options.actionUrl ? { action: options.actionUrl } : {});

    // Build ConversationRelay attributes. Keys on TwiMLOptions are already
    // camelCase; the Twilio SDK serializes booleans/numbers as TwiML attribute
    // values.
    const relayAttrs: Record<string, unknown> = { url: resolvedWebsocketUrl };
    for (const field of VoiceChannel.RELAY_ATTR_FIELDS) {
      let value = options[field];
      if (value === undefined) {
        continue;
      }
      // Twilio accepts true/false on `interruptible` for backward-compat but the
      // documented enum is none|dtmf|speech|any. Normalize so we emit canonical
      // values regardless of the SDK's bool serialization.
      if (field === 'interruptible' && typeof value === 'boolean') {
        value = value ? 'any' : 'none';
      }
      relayAttrs[field] = value;
    }

    // `extra` is the escape hatch for attributes not yet typed. The schema's
    // shadow-guard rejects keys colliding with typed fields, so pass them
    // through as-is — except `url`: it's not a TwiMLOptions field (invisible to
    // the shadow-guard) but IS the resolved WebSocket endpoint, so letting
    // `extra.url` through would silently point the call at the wrong socket.
    if (options.extra) {
      for (const [key, value] of Object.entries(options.extra)) {
        if (key === 'url') {
          this.logger.warn(
            'Ignoring `url` in TwiMLOptions.extra; set `websocketUrl` to override the ConversationRelay URL.'
          );
          continue;
        }
        relayAttrs[key] = value;
      }
    }

    const relay = connect.conversationRelay(
      relayAttrs as Parameters<typeof connect.conversationRelay>[0]
    );

    // Emit <Language> children, if any.
    if (options.languages && options.languages.length > 0) {
      for (const lang of options.languages) {
        const langAttrs = this.filterUnsetValues(lang);
        relay.language(langAttrs as Parameters<typeof relay.language>[0]);
      }
    }

    // Emit custom parameters as <Parameter> children, skipping null/undefined.
    if (options.customParameters) {
      for (const [name, value] of Object.entries(options.customParameters)) {
        if (value !== null && value !== undefined) {
          relay.parameter({ name, value: stringifyParameterValue(value) });
        }
      }
    }

    return response.toString();
  }

  /**
   * Generate TwiML to connect a call to ConversationRelay.
   * Validates configuration with Zod before generating TwiML.
   *
   * @param config - ConversationRelay configuration (url, transcription, TTS, etc.)
   * @param options - Optional settings for parameters and the Connect verb
   * @returns TwiML XML string
   * @throws {Error} if config validation fails
   */
  public connectConversationRelay(
    config: ConversationRelayConfig,
    options?: { parameters?: CustomParameters; actionUrl?: string }
  ): string {
    // Validate configuration with Zod schema (consistent with project pattern)
    const validationResult = ConversationRelayConfigSchema.safeParse(config);

    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Invalid ConversationRelay configuration: ${errorMessage}`);
    }

    const validatedConfig = validationResult.data;

    // Extract languages array (child elements, not attributes)
    const { languages, ...conversationRelayAttributes } = validatedConfig;

    // Filter out undefined values to keep TwiML clean
    const filteredConfig = this.filterUnsetValues(conversationRelayAttributes);

    // Build TwiML using SDK
    const response = new VoiceResponse();
    const connect = response.connect(options?.actionUrl ? { action: options.actionUrl } : {});
    const relay = connect.conversationRelay(filteredConfig);

    // Add language configurations as child <Language> elements
    if (languages && languages.length > 0) {
      for (const lang of languages) {
        // Filter out undefined values to satisfy exactOptionalPropertyTypes
        // Type assertion is safe here because we've already validated with Zod
        const filteredLang = this.filterUnsetValues(lang);
        relay.language(filteredLang as Parameters<typeof relay.language>[0]);
      }
    }

    // Add custom parameters as child <Parameter> elements
    if (options?.parameters) {
      for (const [name, value] of Object.entries(options.parameters)) {
        relay.parameter({ name, value: String(value) });
      }
    }

    return response.toString();
  }

  /**
   * Filter out undefined values from configuration object.
   * Keeps null, false, 0, and empty strings as they are valid values.
   */
  private filterUnsetValues(config: Record<string, unknown>): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  /**
   * Cleanup channel state on shutdown
   *
   * Note: WebSocket connections are managed by the server and closed there.
   * This method only cleans up internal channel state.
   */
  public override shutdown(): void {
    this.streamTasks.clear();
    this.webSocketConnections.clear();
    this.promptQueues.clear();
    this.initializationRetries.clear();
    this.callSidToConversationId.clear();
    super.shutdown();
  }
}
