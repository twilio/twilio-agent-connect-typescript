import { WebSocket } from 'ws';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import type { ConversationClient } from '../../../clients/conversation';
import type { TACConfig } from '../../../lib/config';
import type { Logger } from '../../../lib/logger';
import {
  CallOptions,
  CallOptionsSchema,
  ConversationId,
  ConversationRelayCallbackPayloadSchema,
  ConversationRelayConfig,
  ConversationRelayConfigSchema,
  CustomParameters,
  DtmfMessage,
  InitiateVoiceConversationOptions,
  InitiateVoiceConversationOptionsSchema,
  InterruptMessage,
  ProfileId,
  PromptMessage,
  TextTokenMessage,
  TwilioProviderCallbackResponse,
  TwiMLRequest,
  VoiceTwiMLOptions,
  VoiceTwiMLOptionsConversationRelay,
  VoiceTwiMLOptionsConversationRelaySchema,
  WebSocketMessageSchema,
  callOptionsToCreateParams,
} from '../../../types/index';
import type { InitiateVoiceConversationResult } from '../../../types/conversation';
import { maskAddress, redactTwimlParameters } from '../../../util/log-redaction';
import type { VoiceChannel } from '../channel';
import { VoiceProvider } from '../provider';
import { trackEvent } from '../../../lib/analytics';
import { filterUnsetValues } from '../twiml';
import type { ConversationRelayProviderConfig } from './config';
import { TwiMLBuilderConversationRelay } from './twiml';

/** Poll window from call-connect: 10 attempts, 250ms doubling to a 1.5s cap (~11s). */
const POLL_ATTEMPTS = 10;
const POLL_BASE_DELAY_MS = 250;
const POLL_MAX_DELAY_MS = 1500;

/**
 * A single in-flight streaming response, with the {@link AbortController} that
 * cancels it and whether any token has been written to the transport yet.
 */
export interface StreamTask {
  controller: AbortController;
  hasSentTokens: boolean;
}

/**
 * Twilio ConversationRelay: Twilio handles ASR/TTS and exchanges JSON
 * `setup`/`prompt`/`interrupt` messages over one WebSocket.
 *
 * This is the default provider {@link VoiceChannel} builds when none is passed
 * explicitly.
 */
export class ConversationRelayProvider extends VoiceProvider {
  /**
   * The owning channel's logger, so relocated ConversationRelay logic keeps
   * logging exactly as it did when it lived on `VoiceChannel`.
   */
  protected override readonly logger: Logger;

  /** In-flight streaming responses, keyed by conversation. */
  protected readonly streamTasks: Map<ConversationId, StreamTask>;

  private readonly config: ConversationRelayProviderConfig;
  private readonly tacConfig: TACConfig;
  private readonly twimlBuilder: TwiMLBuilderConversationRelay;
  private readonly webSocketConnections: Map<ConversationId, WebSocket>;
  private readonly promptQueues: Map<ConversationId, Promise<void>>;
  private readonly initializationRetries: Map<string, number>;
  private readonly callSidToConversationId: Map<string, ConversationId>;
  private readonly MAX_INITIALIZATION_RETRIES = 3;

  constructor(
    channel: VoiceChannel,
    tacConfig: TACConfig,
    config: ConversationRelayProviderConfig
  ) {
    super(channel);
    this.logger = channel.getLoggerInternal();
    this.config = config;
    this.tacConfig = tacConfig;
    this.twimlBuilder = new TwiMLBuilderConversationRelay(tacConfig, config, this.logger);
    this.streamTasks = new Map();
    this.webSocketConnections = new Map();
    this.promptQueues = new Map();
    this.initializationRetries = new Map();
    this.callSidToConversationId = new Map();
  }

  public override get channelName(): string {
    return 'VOICE';
  }

  /**
   * Get active WebSocket connection for a conversation
   */
  public override getWebSocket(conversationId: ConversationId): WebSocket | null {
    return this.webSocketConnections.get(conversationId) || null;
  }

  /**
   * Poll Conversation Orchestrator for the conversation ConversationRelay
   * created for `callSid`, then register the local session and WebSocket.
   * Runs in the background from `setup`, so those can exist before the
   * caller speaks.
   */
  private async initializeOrchestratedConversation(
    callSid: string,
    fromNumber: string | null,
    ws: WebSocket
  ): Promise<ConversationId> {
    const conversationClient = this.channel.getConversationClientInternal();
    if (!conversationClient) {
      throw new Error('Conversation client is required in orchestrated mode');
    }

    let conversations: Awaited<ReturnType<ConversationClient['listConversations']>> = [];

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      // ACTIVE only: a stale conversation on the same CallSid would break the
      // "exactly 1" check below.
      conversations = await conversationClient.listConversations({
        channelId: callSid,
        status: ['ACTIVE'],
      });
      if (conversations.length === 1) break;
      if (attempt < POLL_ATTEMPTS - 1) {
        this.logger.debug(
          { call_sid: callSid, attempt: attempt + 1, found: conversations.length },
          'Conversation not ready yet, polling again'
        );
        const delayMs = Math.min(POLL_BASE_DELAY_MS * 2 ** attempt, POLL_MAX_DELAY_MS);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    if (conversations.length !== 1) {
      throw new Error(
        `Expected exactly 1 conversation for callSid ${callSid}, ` +
          `but found ${conversations.length} after ${POLL_ATTEMPTS} attempts`
      );
    }

    const conversation = conversations[0]!;
    const conversationId = conversation.id as ConversationId;

    const participants = await conversationClient.listParticipants(conversationId);

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
    const session = this.channel.startConversationInternal(conversationId, profileId);
    // conversationId is the Orchestrator's, so record the CallSid too —
    // out-of-band call webhooks resolve via getConversationSessionByCallSid.
    session.callSid = callSid;

    if (customerAddress) {
      session.authorInfo = {
        address: customerAddress,
      };
    }

    const voiceCallbacks = this.channel.getVoiceCallbacks();
    if (voiceCallbacks.onWebSocketConnected) {
      voiceCallbacks.onWebSocketConnected({ conversationId });
    }

    return conversationId;
  }

  /**
   * Handle WebSocket connection from ConversationRelay
   */
  public override handleWebSocket(ws: WebSocket): void {
    let conversationId: ConversationId | null = null;
    let callSid: string | null = null;
    let fromNumber: string | null = null;
    let initializationFailed = false;
    // Background conversation lookup started on `setup`; cleared once claimed,
    // by the first message that needs a conversation or by the close handler.
    let initPromise: Promise<ConversationId> | null = null;

    /**
     * Resolve this connection's conversation, creating it on first use.
     *
     * Shared by `prompt` and `dtmf` because either can be the first message
     * that needs a conversation — a caller can press a digit before speaking,
     * and until the session and WebSocket are registered a handler has no way
     * to respond. Returns null when `setup` hasn't arrived yet (no callSid);
     * rejects when initialization fails, after recording the attempt so a
     * later message can retry up to MAX_INITIALIZATION_RETRIES.
     */
    const ensureConversation = async (): Promise<ConversationId | null> => {
      if (conversationId) {
        return conversationId;
      }
      const sid = callSid;
      if (!sid) {
        return null;
      }

      // Check retry limit before attempting initialization
      const retryCount = this.initializationRetries.get(sid) ?? 0;
      if (retryCount >= this.MAX_INITIALIZATION_RETRIES) {
        throw new Error(
          `Cannot process message - conversation initialization failed after ${retryCount} attempts for callSid ${sid}`
        );
      }

      try {
        if (initializationFailed) {
          this.logger.info(
            { call_sid: sid, retry_count: retryCount },
            'Retrying conversation initialization after previous failure'
          );
        }

        if (!this.channel.isOrchestratorEnabledInternal()) {
          // Voice-only mode: use callSid as conversationId directly
          conversationId = sid as ConversationId;
          this.webSocketConnections.set(conversationId, ws);
          this.callSidToConversationId.set(sid, conversationId);
          const session = this.channel.startConversationInternal(conversationId);
          // Relay-only: conversationId === callSid.
          session.callSid = sid;

          if (fromNumber) {
            session.authorInfo = { address: fromNumber };
          }

          const voiceCallbacks = this.channel.getVoiceCallbacks();
          if (voiceCallbacks.onWebSocketConnected) {
            voiceCallbacks.onWebSocketConnected({ conversationId });
          }
        } else {
          // Await the lookup from `setup` — usually already done.
          // Stays visible to the close handler while awaited, so a
          // hangup mid-lookup still cleans up; cleared after so a
          // retry starts fresh and `close` uses conversationId.
          initPromise ??= this.initializeOrchestratedConversation(sid, fromNumber, ws);
          try {
            conversationId = await initPromise;
          } finally {
            initPromise = null;
          }
        }

        // Success! Clear retry count and failed flag
        initializationFailed = false;
        this.initializationRetries.delete(sid);
        this.logger.info(
          { conversation_id: conversationId, call_sid: sid },
          'Conversation initialization succeeded'
        );

        trackEvent('Conversation Initialized', {
          account_sid: this.tacConfig.accountSid,
          channel: 'voice',
          conversation_id: conversationId,
        });

        return conversationId;
      } catch (err) {
        initializationFailed = true;
        this.initializationRetries.set(sid, retryCount + 1);
        this.logger.error(
          { err, call_sid: sid, retry_count: retryCount + 1 },
          'Conversation initialization failed'
        );
        throw err;
      }
    };

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

              // ConversationRelay creates the conversation at call-connect, so
              // start the lookup now and let it overlap the wait for the
              // caller's first utterance instead of delaying it.
              if (this.channel.isOrchestratorEnabledInternal()) {
                this.logger.debug(
                  { call_sid: callSid },
                  'Starting background conversation initialization'
                );
                initPromise = this.initializeOrchestratedConversation(callSid, fromNumber, ws);
                // Marks it handled; whoever claims it still sees the rejection.
                void initPromise.catch(() => undefined);
              }

              {
                const voiceCallbacks = this.channel.getVoiceCallbacks();
                if (voiceCallbacks.onSetup) {
                  voiceCallbacks.onSetup({
                    callSid,
                    from: message.from,
                    to: message.to,
                    customParameters: message.customParameters,
                  });
                }
              }
              break;

            case 'prompt':
              await ensureConversation();

              if (conversationId) {
                const previousPrompt = this.promptQueues.get(conversationId) ?? Promise.resolve();
                const currentPrompt = previousPrompt
                  .then(() => this.handlePromptMessage(conversationId!, message))
                  .catch((err: unknown) => {
                    this.channel.handleErrorInternal(
                      err instanceof Error ? err : new Error(String(err)),
                      {
                        conversationId,
                        message: data.toString(),
                      }
                    );
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

            case 'dtmf':
              // A keypress can be the caller's first input, so initialize the
              // conversation the same way a prompt does — without it the handler
              // has no session and no WebSocket to respond on. Unlike a prompt, a
              // failure here is logged rather than thrown: the digit is still
              // worth delivering, just without a conversation.
              try {
                await ensureConversation();
              } catch (err) {
                this.logger.warn(
                  { err, call_sid: callSid },
                  'Conversation initialization failed on DTMF keypress, delivering digit without a conversation'
                );
              }

              await this.handleDtmfMessage(conversationId, callSid, message);
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
          this.channel.handleErrorInternal(
            error instanceof Error ? error : new Error(String(error)),
            {
              conversationId,
              callSid,
              message: data.toString(),
            }
          );
        }
      })().catch((err: unknown) => {
        this.logger.error({ err }, 'Unhandled error in WebSocket message handler');
      });
    });

    ws.on('close', () => {
      // Call ended before any prompt claimed the lookup. A promise can't be
      // cancelled, so adopt what it registers and tear that down, or the
      // WebSocket registration leaks. The conversation stays tracked (CLOSED).
      const pendingInit = initPromise;
      initPromise = null;
      if (pendingInit && !conversationId) {
        void pendingInit
          .then(async adoptedId => {
            await this.handleWebSocketDisconnect(adoptedId);
            if (callSid) this.callSidToConversationId.delete(callSid);
          })
          // No prompt ever arrived to surface a lookup failure, so log here.
          .catch((err: unknown) => {
            this.logger.error(
              { err, call_sid: callSid },
              'Background conversation initialization failed after the call ended'
            );
          });
      }

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
      this.channel.handleErrorInternal(error, { conversationId });
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
    const session = this.channel.getConversationSession(conversationId);

    // Retrieve memory if enabled via memoryMode
    const userMemory = session
      ? await this.channel.retrieveMemoryInternal(session, transcript)
      : undefined;

    const voiceCallbacks = this.channel.getVoiceCallbacks();
    if (voiceCallbacks.onPrompt) {
      await voiceCallbacks.onPrompt({
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

    const voiceCallbacks = this.channel.getVoiceCallbacks();
    if (voiceCallbacks.onInterrupt) {
      voiceCallbacks.onInterrupt({
        conversationId,
        utteranceUntilInterrupt,
        durationUntilInterruptMs,
      });
    }

    trackEvent('Voice Interrupt', {
      account_sid: this.tacConfig.accountSid,
      channel: 'voice',
      conversation_id: conversationId,
      ...(durationUntilInterruptMs !== undefined && {
        duration_until_interrupt_ms: durationUntilInterruptMs,
      }),
    });
  }

  /**
   * Handle WebSocket DTMF message (caller keypress)
   */
  private async handleDtmfMessage(
    conversationId: ConversationId | null,
    callSid: string | null,
    message: DtmfMessage
  ): Promise<void> {
    const { digit } = message;

    // Never log the digit itself — callers type account numbers and PINs on the
    // keypad, and nothing downstream scrubs it.
    this.logger.debug({ conversation_id: conversationId, call_sid: callSid }, 'DTMF keypress');

    const voiceCallbacks = this.channel.getVoiceCallbacks();
    if (!voiceCallbacks.onDtmf) {
      return;
    }

    const session = conversationId
      ? this.channel.getConversationSession(conversationId)
      : undefined;

    await voiceCallbacks.onDtmf({
      conversationId: conversationId ?? undefined,
      callSid: callSid ?? undefined,
      digit,
      ...(session !== undefined && { session }),
    });
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

    const voiceCallbacks = this.channel.getVoiceCallbacks();
    if (voiceCallbacks.onWebSocketDisconnected) {
      voiceCallbacks.onWebSocketDisconnected({ conversationId });
    }

    trackEvent('Websocket Disconnected', {
      account_sid: this.tacConfig.accountSid,
      channel: 'voice',
      conversation_id: conversationId,
    });

    if (!this.channel.isOrchestratorEnabledInternal()) {
      await this.channel.endConversationInternal(conversationId);
    }
  }

  /**
   * Send voice response via WebSocket
   */
  public override sendResponse(
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
      const session = this.channel.getConversationSession(conversationId);
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
      this.channel.handleErrorInternal(error instanceof Error ? error : new Error(String(error)), {
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
  public override async sendStreamingResponse(
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
      this.channel.handleErrorInternal(error instanceof Error ? error : new Error(String(error)), {
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
  // Stream Task Management
  //
  // ConversationRelay-specific: these track the AbortController for a text
  // token stream. Full-duplex audio transports have no equivalent, so this
  // stays off `VoiceProvider`.
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
   *   2. `ConversationRelayProviderConfig.defaultTwimlOptions` — per-channel
   *      defaults.
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
   * @throws {Error} if either options layer isn't a
   *   {@link VoiceTwiMLOptionsConversationRelay}.
   */
  public override async handleIncomingCall(
    twimlRequest?: TwiMLRequest,
    options?: { hostTwimlOptions?: VoiceTwiMLOptions }
  ): Promise<string> {
    const host = this.narrowTwimlOptions(options?.hostTwimlOptions, 'options.hostTwimlOptions');

    const onInboundCallTwimlHandler = this.channel.getInboundCallTwimlHandler();
    let customized: VoiceTwiMLOptionsConversationRelay | undefined;
    if (onInboundCallTwimlHandler && twimlRequest) {
      customized = this.narrowTwimlOptions(
        await onInboundCallTwimlHandler(twimlRequest),
        'the onInboundCallTwiml customizer output'
      );
    }

    return this.twimlBuilder.build('handleIncomingCall', {
      host,
      perCall: customized,
    });
  }

  /**
   * Narrow provider-agnostic {@link VoiceTwiMLOptions} to this provider's
   * concrete shape. `VoiceProvider.handleIncomingCall` is typed against the
   * base so every provider can accept its own TwiML options, so the
   * ConversationRelay shape has to be established at runtime.
   *
   * @param value - Options from a caller or the application customizer.
   * @param label - What produced `value`, for the error message.
   */
  private narrowTwimlOptions(
    value: VoiceTwiMLOptions | undefined,
    label: string
  ): VoiceTwiMLOptionsConversationRelay | undefined {
    if (value === undefined) {
      return undefined;
    }
    const parsed = VoiceTwiMLOptionsConversationRelaySchema.safeParse(value);
    if (!parsed.success) {
      const errorMessage = parsed.error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(
        `ConversationRelayProvider.handleIncomingCall requires ${label} to be a ` +
          `VoiceTwiMLOptionsConversationRelay: ${errorMessage}`
      );
    }
    return parsed.data;
  }

  // =========================================================================
  // Outbound Call Handling
  // =========================================================================

  /**
   * Overlay `perCall` onto `ConversationRelayProviderConfig.defaultCallOptions`.
   *
   * Per-field via key presence, the same convention `TwiMLBuilderBase.overlayFields`
   * uses for TwiML options — so a per-call `{ machineDetection: undefined }`
   * explicitly clears the channel default rather than falling through to it.
   *
   * The result is always validated, for two reasons: a combination only
   * reachable by layering — per-call clearing `machineDetection` while the
   * default set `asyncAmd` — must still fail instead of reaching Twilio, and
   * `ConversationRelayProviderConfigOptions` is a plain interface, so
   * `defaultCallOptions` has had no runtime validation of its own.
   */
  private mergeCallOptions(perCall: CallOptions | undefined): CallOptions | undefined {
    const defaults = this.config.defaultCallOptions;
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
   * `ConversationRelayProviderConfig.defaultCallOptions`, then callback URLs
   * derived from `voicePublicDomain` + `voiceCallEventPath`.
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

    return this.applyCallEventCallbacks(params);
  }

  /**
   * Initiate an outbound voice conversation
   *
   * Places an outbound call with inline TwiML that connects to ConversationRelay.
   * The conversationConfiguration attribute tells CO to create and manage the
   * conversation during passive hydration. The session is initialized when the
   * background callSid lookup started at WebSocket setup finds it.
   *
   * TwiML fields are merged per-field, highest precedence first:
   *   1. `options.twimlOptions` — per-call overrides
   *   2. `ConversationRelayProviderConfig.defaultTwimlOptions` — channel-wide
   *      defaults
   *   3. TAC defaults: welcome greeting, `conversationConfiguration` from
   *      `TACConfig`, and `actionUrl` from Studio handoff (if configured), else
   *      derived from `TACConfig.voicePublicDomain` + `voiceActionPath`.
   *
   * Calls-API parameters merge the same way:
   *   1. `options.callOptions` — per-call overrides
   *   2. `ConversationRelayProviderConfig.defaultCallOptions` — channel-wide
   *      defaults
   *   3. Callback URLs derived from `TACConfig.voicePublicDomain` +
   *      `voiceCallEventPath`, for handlers that are registered
   *
   * The WebSocket URL is derived from `TACConfig.voicePublicDomain` +
   * `TACConfig.voiceWebsocketPath`, unless overridden per-call via
   * `options.websocketUrl`.
   */
  public override async initiateOutboundConversation(
    options: InitiateVoiceConversationOptions
  ): Promise<InitiateVoiceConversationResult> {
    const validated = InitiateVoiceConversationOptionsSchema.parse(options);
    const fromNumber = this.tacConfig.phoneNumber;

    this.logger.info(
      { to: validated.to, from: fromNumber },
      'Initiating outbound voice conversation'
    );

    try {
      // Outbound has no inbound customizer and no host layer; the per-call
      // override is options.twimlOptions. `options.websocketUrl` is the
      // dedicated per-call outbound override and wins over any websocketUrl
      // that came through the layered twimlOptions merge; both fall back to the
      // TACConfig-derived URL.
      const twiml = this.twimlBuilder.build('initiateOutboundConversation', {
        perCall: validated.twimlOptions,
        websocketUrl: validated.websocketUrl,
      });
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
      const client = this.channel.getTwilioClientInternal();
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
      this.channel.handleErrorInternal(error instanceof Error ? error : new Error(String(error)), {
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
   * @param rawPayload - Callback payload from Twilio
   * @returns Response with status, content, and content type
   */
  public override async handleTwilioProviderCallback(
    rawPayload: Record<string, unknown>
  ): Promise<TwilioProviderCallbackResponse> {
    const parsed = ConversationRelayCallbackPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.logger.warn(
        { errors: parsed.error.issues },
        'Invalid ConversationRelay callback payload'
      );
      return { status: 400, content: 'Invalid payload', contentType: 'text/plain' };
    }
    const payload = parsed.data;

    this.logger.debug(
      { call_sid: payload.CallSid, call_status: payload.CallStatus },
      'ConversationRelay callback received'
    );

    if (payload.AccountSid !== this.tacConfig.accountSid) {
      this.logger.warn(
        { expected: this.tacConfig.accountSid, received: payload.AccountSid },
        'ConversationRelay callback AccountSid mismatch, ignoring'
      );
      return { status: 403, content: 'Forbidden', contentType: 'text/plain' };
    }

    if (payload.CallStatus === 'completed' && !this.channel.isOrchestratorEnabledInternal()) {
      const conversationId = this.callSidToConversationId.get(payload.CallSid);
      if (conversationId) {
        this.callSidToConversationId.delete(payload.CallSid);
        await this.channel.endConversationInternal(conversationId);
      }
    }

    return { status: 200, content: 'OK', contentType: 'text/plain' };
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
    const filteredConfig = filterUnsetValues(conversationRelayAttributes);

    // Build TwiML using SDK
    const response = new VoiceResponse();
    const connect = response.connect(options?.actionUrl ? { action: options.actionUrl } : {});
    const relay = connect.conversationRelay(filteredConfig);

    // Add language configurations as child <Language> elements
    if (languages && languages.length > 0) {
      for (const lang of languages) {
        // Filter out undefined values to satisfy exactOptionalPropertyTypes
        // Type assertion is safe here because we've already validated with Zod
        const filteredLang = filterUnsetValues(lang);
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
   * Drop this provider's ConversationRelay transport state on channel shutdown.
   *
   * Note: WebSocket connections are managed by the server and closed there.
   * This method only cleans up internal provider state.
   */
  public override shutdown(): void {
    super.shutdown();
    this.streamTasks.clear();
    this.webSocketConnections.clear();
    this.promptQueues.clear();
    this.initializationRetries.clear();
    this.callSidToConversationId.clear();
  }
}
