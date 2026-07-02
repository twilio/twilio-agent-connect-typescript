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
  ConversationWebhookPayload,
} from '../types/index';
import type { InitiateVoiceConversationResult } from '../types/conversation';
import { BaseChannel, BaseChannelEvents, BaseChannelOptions } from './base';
import type { TAC } from '../lib/tac';
import { TACMemoryResponse } from '../lib/tac-memory-response';
import { maskAddress } from '../util/log-redaction';

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

  constructor(tac: TAC, options?: BaseChannelOptions) {
    super(tac, options);
    this.webSocketConnections = new Map();
    this.voiceCallbacks = {};
    this.streamTasks = new Map();
    this.promptQueues = new Map();
    this.initializationRetries = new Map();
    this.callSidToConversationId = new Map();
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
      // Invalidate cached memory ("once" mode) when the conversation becomes
      // inactive. Memory is updated by Conversation Orchestrator on the
      // INACTIVE transition, so the next message re-fetches fresh memory.
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
   * Handle incoming voice call - generate TwiML to connect to ConversationRelay
   *
   * ConversationRelay will create the conversation automatically. The conversation
   * will be initialized on the first prompt using the callSid.
   *
   * @param options - Options for handling the incoming call
   * @returns TwiML XML string with ConversationRelay configuration
   */
  public handleIncomingCall(options: {
    actionUrl?: string;
    conversationRelayConfig: ConversationRelayConfig;
  }): string {
    const { actionUrl, conversationRelayConfig } = options;
    const conversationConfiguration = this.tac.isOrchestratorEnabled()
      ? (conversationRelayConfig.conversationConfiguration ??
        this.config.conversationConfigurationId)
      : undefined;
    return this.connectConversationRelay(
      {
        ...conversationRelayConfig,
        ...(conversationConfiguration !== undefined && { conversationConfiguration }),
      },
      actionUrl ? { actionUrl } : undefined
    );
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
   * `conversationRelayConfig.url` must be the publicly accessible WebSocket
   * endpoint (e.g., `wss://your-domain.ngrok.app/ws`). Unlike inbound calls
   * where TACServer sets this automatically, outbound calls require it
   * explicitly since there is no incoming HTTP request to derive the host from.
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
      const conversationConfiguration = this.tac.isOrchestratorEnabled()
        ? (validated.conversationRelayConfig.conversationConfiguration ??
          this.config.conversationConfigurationId)
        : undefined;
      const twiml = this.connectConversationRelay(
        {
          ...validated.conversationRelayConfig,
          ...(conversationConfiguration !== undefined && { conversationConfiguration }),
        },
        {
          ...(validated.actionUrl ? { actionUrl: validated.actionUrl } : {}),
        }
      );

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
