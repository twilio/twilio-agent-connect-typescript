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
  ConversationRelayOptions,
  ConversationRelayCallbackPayload,
  InitiateVoiceConversationOptions,
  InitiateVoiceConversationOptionsSchema,
  InboundCallTwiMLHandler,
  TwiMLRequest,
} from '../types/index';
import { studioVoiceHandoffUrl } from '../util/handoff-urls';
import type { InitiateVoiceConversationResult } from '../types/conversation';
import { BaseChannel, BaseChannelEvents } from './base';
import type { TAC } from '../lib/tac';
import { TACMemoryResponse } from '../lib/tac-memory-response';

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

/** Default welcome greeting applied to every call when no layer overrides it. */
export const DEFAULT_WELCOME_GREETING = 'Hello! How can I assist you today?';

/**
 * Stringify a custom-parameter value for a `<Parameter value=...>` attribute.
 * Primitives stringify directly; objects/arrays are JSON-encoded so we never
 * emit "[object Object]". Mirrors Python's `str(value)` for the common cases.
 */
function stringifyParameterValue(value: unknown): string {
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  // value is string | number | boolean | bigint | symbol here
  return String(value as string | number | boolean);
}

/**
 * Configuration for the Voice channel.
 *
 * TwiML configuration layers (highest precedence first):
 *
 *   Inbound calls (`handleIncomingCall`):
 *     1. Output of the customizer registered via `onInboundCallTwiml(...)`
 *     2. `defaultTwimlOptions`
 *     3. TAC defaults
 *
 *   Outbound calls (`initiateOutboundConversation`):
 *     1. `InitiateVoiceConversationOptions.twimlOptions`
 *     2. `defaultTwimlOptions`
 *     3. TAC defaults
 *
 * Layers merge per-field — only keys a layer explicitly sets override lower
 * layers. Lists (`languages`) and nested objects (`extra`) replace wholesale.
 */
export interface VoiceChannelConfig {
  /**
   * Static TwiML applied to every call (inbound and outbound). Controls the
   * TwiML inside `<ConversationRelay>` — voice, language, transcription
   * provider, welcomeGreeting, `<Language>` children, etc. Per-call inbound
   * customization is registered via `onInboundCallTwiml(...)`.
   */
  defaultTwimlOptions?: ConversationRelayOptions | undefined;
}

export class VoiceChannel extends BaseChannel {
  private readonly webSocketConnections: Map<ConversationId, WebSocket>;
  private readonly voiceCallbacks: VoiceChannelEvents;
  private readonly streamTasks: Map<ConversationId, StreamTask>;
  private readonly promptQueues: Map<ConversationId, Promise<void>>;
  private readonly initializationRetries: Map<string, number>;
  private readonly MAX_INITIALIZATION_RETRIES = 3;
  private twilioClient: ReturnType<typeof Twilio> | undefined;
  private readonly voiceConfig: VoiceChannelConfig;
  private onInboundCallTwimlHandler: InboundCallTwiMLHandler | undefined;

  constructor(tac: TAC, config: VoiceChannelConfig = {}) {
    super(tac);
    this.webSocketConnections = new Map();
    this.voiceCallbacks = {};
    this.streamTasks = new Map();
    this.promptQueues = new Map();
    this.initializationRetries = new Map();
    this.voiceConfig = config;
  }

  /**
   * Register a callback that produces per-call overrides for the TwiML inside
   * `<ConversationRelay>` on inbound calls.
   *
   * The callback receives a framework-neutral {@link TwiMLRequest} (parsed from
   * the Twilio webhook form) and returns a ConversationRelayConfig. Keys the
   * callback explicitly sets override `defaultTwimlOptions` and TAC defaults;
   * unset keys fall through.
   *
   * Outbound calls don't use this — pass per-call TwiML via
   * `InitiateVoiceConversationOptions.twimlOptions` instead.
   */
  public onInboundCallTwiml(callback: InboundCallTwiMLHandler): void {
    this.onInboundCallTwimlHandler = callback;
  }

  /**
   * Resolve the public WebSocket URL from TACConfig.voicePublicDomain +
   * voiceWebsocketPath. Throws if voicePublicDomain isn't set.
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
   * Resolve the default `<Connect action=...>` cleanup URL. Returns undefined
   * if voicePublicDomain isn't set — fine, because action_url has
   * higher-priority layers (customizer, twimlOptions, Studio handoff).
   */
  private resolveDefaultActionUrl(): string | undefined {
    if (this.config.voicePublicDomain) {
      return `https://${this.config.voicePublicDomain}${this.config.voiceActionPath}`;
    }
    return undefined;
  }

  /**
   * Layer TwiML options: TAC defaults -> channel `defaultTwimlOptions` ->
   * `perCall` (customizer output for inbound, or twimlOptions for outbound).
   * Mirrors Python's `_build_twiml_options`.
   *
   * Returns the merged `<ConversationRelay>` config (with `url` set) plus the
   * separately-resolved `actionUrl` for the enclosing `<Connect>`.
   */
  private buildTwimlOptions(
    websocketUrl: string,
    perCall: ConversationRelayOptions | undefined
  ): { config: ConversationRelayConfig; actionUrl: string | undefined } {
    const merged: ConversationRelayConfig = {
      url: websocketUrl,
      welcomeGreeting: DEFAULT_WELCOME_GREETING,
    };
    const conversationConfiguration = this.config.conversationConfigurationId;
    if (conversationConfiguration) {
      merged.conversationConfiguration = conversationConfiguration;
    }
    const actionUrl = this.resolveActionUrl(perCall);

    if (this.voiceConfig.defaultTwimlOptions) {
      this.overlayFields(merged, this.voiceConfig.defaultTwimlOptions);
    }
    if (perCall) {
      this.overlayFields(merged, perCall);
    }
    return { config: merged, actionUrl };
  }

  /**
   * Apply keys explicitly present on `source` onto `target`. Lists
   * (`languages`) and nested objects (`extra`) replace wholesale.
   *
   * `actionUrl`/`url` are skipped — `url` is owned by the caller and the action
   * URL is resolved once across all layers via {@link resolveActionUrl}.
   */
  private overlayFields(target: ConversationRelayConfig, source: ConversationRelayOptions): void {
    for (const [key, value] of Object.entries(source)) {
      if (key === 'actionUrl' || key === 'url') continue;
      if (value === undefined) continue;
      (target as unknown as Record<string, unknown>)[key] = value;
    }
  }

  /**
   * Resolve the TwiML `<Connect action=...>` URL. Precedence (highest first):
   *   1. customizer / per-call twimlOptions (`actionUrl` key present)
   *   2. channel `defaultTwimlOptions.actionUrl`
   *   3. Studio handoff (when studioHandoffFlowSid is configured)
   *   4. Channel default derived from voicePublicDomain + voiceActionPath.
   *
   * An explicit `actionUrl: undefined`... has no representation in JS object
   * spreads (the key is simply absent), so unlike Python there is no
   * "explicitly suppress" sentinel — omit the key to fall through.
   */
  private resolveActionUrl(perCall: ConversationRelayOptions | undefined): string | undefined {
    if (perCall && 'actionUrl' in perCall && perCall.actionUrl !== undefined) {
      return perCall.actionUrl;
    }
    const channelDefault = this.voiceConfig.defaultTwimlOptions;
    if (channelDefault && 'actionUrl' in channelDefault && channelDefault.actionUrl !== undefined) {
      return channelDefault.actionUrl;
    }
    if (this.config.studioHandoffFlowSid) {
      return studioVoiceHandoffUrl(this.config.accountSid, this.config.studioHandoffFlowSid);
    }
    return this.resolveDefaultActionUrl();
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
                raw_message: messageData,
                validation_errors: result.error.errors.map(error => ({
                  path: error.path.join('.'),
                  message: error.message,
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

                  // Poll for the conversation — CO may not have created it yet
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
                  const session = this.startConversation(conversationId, profileId);

                  if (customerAddress) {
                    session.authorInfo = {
                      address: customerAddress,
                    };
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
                { conversation_id: conversationId, message: messageData },
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

    // Automatic memory retrieval (matching passive voice behavior)
    let userMemory: TACMemoryResponse | undefined;
    if (session) {
      try {
        userMemory = await this.tac.retrieveMemory(session, transcript);
        this.logger.debug({ conversation_id: conversationId }, 'Retrieved memory for active voice');
      } catch (error) {
        this.logger.warn(
          { err: error, conversation_id: conversationId },
          'Failed to retrieve memory for active voice'
        );
      }
    }

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
   * Handle incoming voice call — generate TwiML to connect to ConversationRelay.
   *
   * The WebSocket URL and default session-cleanup action URL are derived from
   * TACConfig.voicePublicDomain + voiceWebsocketPath / voiceActionPath.
   *
   * TwiML fields are merged per-field, highest precedence first:
   *   1. Output of the customizer registered via `onInboundCallTwiml(...)` (if
   *      configured and `twimlRequest` is given).
   *   2. `VoiceChannelConfig.defaultTwimlOptions` — per-channel defaults.
   *   3. TAC defaults: default welcomeGreeting, conversationConfiguration from
   *      TACConfig, and the action URL (Studio handoff if configured, else
   *      derived from voicePublicDomain + voiceActionPath).
   *
   * @param twimlRequest - Parsed Twilio webhook fields, passed to the customizer.
   * @returns TwiML XML string with ConversationRelay configuration.
   * @throws {Error} if the WebSocket URL can't be resolved (voicePublicDomain unset).
   */
  public async handleIncomingCall(twimlRequest?: TwiMLRequest): Promise<string> {
    const websocketUrl = this.resolveWebsocketUrl('handleIncomingCall');

    let customized: ConversationRelayOptions | undefined;
    if (this.onInboundCallTwimlHandler && twimlRequest) {
      customized = await this.onInboundCallTwimlHandler(twimlRequest);
    }

    const { config, actionUrl } = this.buildTwimlOptions(websocketUrl, customized);
    return this.connectConversationRelay(config, actionUrl ? { actionUrl } : undefined);
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
   * The WebSocket URL is derived from TACConfig.voicePublicDomain +
   * voiceWebsocketPath, unless overridden per-call via `options.websocketUrl`.
   *
   * TwiML fields are merged per-field, highest precedence first:
   *   1. `options.twimlOptions` — per-call overrides
   *   2. `VoiceChannelConfig.defaultTwimlOptions` — channel-wide defaults
   *   3. TAC defaults (welcome greeting, conversationConfiguration, action URL).
   */
  public async initiateOutboundConversation(
    options: InitiateVoiceConversationOptions
  ): Promise<InitiateVoiceConversationResult> {
    const validated = InitiateVoiceConversationOptionsSchema.parse(options);
    const fromNumber = validated.from ?? this.config.phoneNumber;
    const websocketUrl =
      validated.websocketUrl ?? this.resolveWebsocketUrl('initiateOutboundConversation');

    this.logger.info(
      { to: validated.to, from: fromNumber },
      'Initiating outbound voice conversation'
    );

    try {
      // Same layering as handleIncomingCall, minus the customizer (there is no
      // inbound TwiMLRequest for outbound calls).
      const { config, actionUrl } = this.buildTwimlOptions(websocketUrl, validated.twimlOptions);
      const twiml = this.connectConversationRelay(config, actionUrl ? { actionUrl } : undefined);

      // Place the outbound call with inline TwiML
      const client = this.getTwilioClient();
      const call = await client.calls.create({
        to: validated.to,
        from: fromNumber,
        twiml,
      });

      this.logger.info({ call_sid: call.sid, to: validated.to }, 'Outbound voice call placed');

      return { callSid: call.sid };
    } catch (error) {
      this.logger.error({ err: error, to: validated.to }, 'Failed to initiate outbound call');
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
  public handleConversationRelayCallback(
    payload: ConversationRelayCallbackPayload
  ): Promise<{ status: number; content: string; contentType: string }> {
    this.logger.debug(
      { call_sid: payload.CallSid, call_status: payload.CallStatus },
      'ConversationRelay callback received'
    );

    return Promise.resolve({ status: 200, content: 'OK', contentType: 'text/plain' });
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

    // Pull out the keys handled outside the <ConversationRelay> attribute set:
    //   - languages / customParameters -> child elements
    //   - extra -> escape-hatch attributes merged back in
    //   - actionUrl -> belongs on the enclosing <Connect>
    const { languages, customParameters, extra, actionUrl, ...conversationRelayAttributes } =
      validatedConfig;

    // The Twilio SDK's TS types don't list every ConversationRelay attribute we
    // accept (e.g. eotThreshold, events); the runtime XML builder serializes
    // any keys it's given, so merge them (plus `extra`) and assert the type.
    const attributes = {
      ...this.filterUnsetValues(conversationRelayAttributes),
      ...(extra ?? {}),
    };

    // Build TwiML using SDK. actionUrl from the config is overridden by an
    // explicit options.actionUrl (resolved by the channel's layering).
    const resolvedActionUrl = options?.actionUrl ?? actionUrl;
    const response = new VoiceResponse();
    const connect = response.connect(resolvedActionUrl ? { action: resolvedActionUrl } : {});
    const relay = connect.conversationRelay(
      attributes as Parameters<typeof connect.conversationRelay>[0]
    );

    // Add language configurations as child <Language> elements
    if (languages && languages.length > 0) {
      for (const lang of languages) {
        // Filter out undefined values to satisfy exactOptionalPropertyTypes
        // Type assertion is safe here because we've already validated with Zod
        const filteredLang = this.filterUnsetValues(lang);
        relay.language(filteredLang as Parameters<typeof relay.language>[0]);
      }
    }

    // Add custom parameters as child <Parameter> elements. Config-level
    // customParameters and the explicit options.parameters are both emitted.
    const parameterSources = [customParameters, options?.parameters];
    for (const source of parameterSources) {
      if (!source) continue;
      for (const [name, value] of Object.entries(source)) {
        if (value === undefined || value === null) continue;
        relay.parameter({ name, value: stringifyParameterValue(value) });
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
    super.shutdown();
  }
}
