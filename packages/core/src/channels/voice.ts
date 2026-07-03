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
} from '../types/index';
import type { InitiateVoiceConversationResult } from '../types/conversation';
import { BaseChannel, BaseChannelEvents, BaseChannelOptions } from './base';
import type { TAC } from '../lib/tac';
import { TACMemoryResponse } from '../lib/tac-memory-response';
import { maskAddress } from '../util/log-redaction';
import { studioVoiceHandoffUrl } from '../util/handoff-urls';

/** Fixed default welcome greeting applied when no layer sets one. */
const DEFAULT_WELCOME_GREETING = 'Hello! How can I assist you today?';

/**
 * Configuration for the Voice channel.
 *
 * TwiML configuration layers (highest precedence first):
 *
 *   Inbound calls (`handleIncomingCall`):
 *     1. Output of the customizer registered via
 *        `VoiceChannel.onInboundCallTwiml(...)` [optional]
 *     2. `defaultTwimlOptions`                  [optional]
 *     3. TAC defaults
 *
 *   Outbound calls (`initiateOutboundConversation`):
 *     1. `InitiateVoiceConversationOptions.twimlOptions` [optional]
 *     2. `defaultTwimlOptions`                           [optional]
 *     3. TAC defaults
 *
 * All layers merge per-field — only fields a layer explicitly sets override
 * lower layers. Arrays (`languages`) and nested objects (`customParameters`,
 * `extra`) replace wholesale when set.
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
}

/**
 * Callback that produces per-call overrides for the TwiML inside
 * `<ConversationRelay>` on inbound calls. Receives a framework-neutral
 * {@link TwiMLRequest} and returns {@link TwiMLOptions}.
 */
export type InboundCallTwimlHandler = (req: TwiMLRequest) => Promise<TwiMLOptions>;

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
   * Process webhook - Voice channel doesn't use traditional webhooks,
   * but this method is required by the base class
   */
  public processWebhook(_payload: unknown): Promise<void> {
    this.logger.warn('processWebhook called but Voice channel uses WebSocket connections');
    return Promise.resolve();
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
   * Handle WebSocket disconnection
   */
  private async handleWebSocketDisconnect(conversationId: ConversationId): Promise<void> {
    this.cancelStreamTask(conversationId);
    this.webSocketConnections.delete(conversationId);
    this.promptQueues.delete(conversationId);

    if (this.voiceCallbacks.onWebSocketDisconnected) {
      this.voiceCallbacks.onWebSocketDisconnected({ conversationId });
    }

    // End conversation (endConversation is async in BaseChannel)
    await this.endConversation(conversationId);
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
      // Index assignment across a heterogeneous record; validated upstream by Zod.
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

      // Place the outbound call with inline TwiML
      const client = this.getTwilioClient();
      const call = await client.calls.create({
        to: validated.to,
        from: fromNumber,
        twiml,
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
   * Handle ConversationRelay callback from Twilio
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

    if (payload.CallStatus === 'completed') {
      const conversationId = this.callSidToConversationId.get(payload.CallSid);
      if (conversationId) {
        this.callSidToConversationId.delete(payload.CallSid);
        await this.endConversation(conversationId);
      }
    }

    return { status: 200, content: 'OK', contentType: 'text/plain' };
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
    // shadow-guard already rejects keys that collide with typed fields, so we
    // can pass everything through as-is — except `url`, which is not a
    // TwiMLOptions field (so the shadow-guard can't see it) but IS the resolved
    // WebSocket endpoint. Let `extra.url` win here and it would silently point
    // the call at the wrong socket; the intended per-call override is
    // `websocketUrl`.
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
   * Extract conversation ID - Not applicable for Voice channel
   */
  protected extractConversationId(_payload: unknown): ConversationId | null {
    // Voice channel doesn't use traditional webhooks
    return null;
  }

  /**
   * Extract profile ID - Not applicable for Voice channel
   */
  protected extractProfileId(_payload: unknown): ProfileId | null {
    // Voice channel doesn't use traditional webhooks
    return null;
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
