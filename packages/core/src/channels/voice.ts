import { WebSocket } from 'ws';
import {
  ChannelType,
  ConversationId,
  ProfileId,
  WebSocketMessageSchema,
  SetupMessage,
  PromptMessage,
  InterruptMessage,
  VoiceResponse,
  CustomParameters,
  TwiMLOptions,
  ConversationRelayCallbackPayload,
  isConversationId,
  isProfileId,
} from '../types/index';
import { BaseChannel, BaseChannelEvents } from './base';
import type { TAC } from '../lib/tac';

/**
 * Voice channel event callbacks extending base callbacks
 */
export interface VoiceChannelEvents extends BaseChannelEvents {
  onSetup?: (data: {
    conversationId: ConversationId;
    profileId: ProfileId | undefined;
    callSid: string;
    from: string;
    to: string;
    customParameters: CustomParameters | undefined;
  }) => void;
  onPrompt?: (data: { conversationId: ConversationId; transcript: string }) => void;
  onInterrupt?: (data: {
    conversationId: ConversationId;
    reason: string;
    transcript: string | undefined;
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
export class VoiceChannel extends BaseChannel {
  private readonly webSocketConnections: Map<ConversationId, WebSocket>;
  private readonly callSidToConversationId: Map<string, ConversationId>;
  private readonly voiceCallbacks: VoiceChannelEvents;
  private readonly streamTasks: Map<ConversationId, AbortController>;

  constructor(tac: TAC) {
    super(tac);
    this.webSocketConnections = new Map();
    this.callSidToConversationId = new Map();
    this.voiceCallbacks = {};
    this.streamTasks = new Map();
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

    ws.on('message', (data: Buffer) => {
      try {
        const messageText = data.toString();
        const messageData = JSON.parse(messageText) as unknown;

        this.logger.debug({ raw_message: messageData }, 'Received WebSocket message');

        // Validate message structure
        const validatedMessage = WebSocketMessageSchema.safeParse(messageData);

        if (!validatedMessage.success) {
          this.logger.error(
            { validation_errors: validatedMessage.error.errors, raw_message: messageData },
            'Invalid WebSocket message'
          );
          return;
        }

        const message = validatedMessage.data;

        switch (message.type) {
          case 'setup':
            conversationId = this.handleSetupMessage(ws, message);
            break;

          case 'prompt':
            if (conversationId) {
              this.handlePromptMessage(conversationId, message);
            }
            break;

          case 'interrupt':
            if (conversationId) {
              this.handleInterruptMessage(conversationId, message);
            }
            break;

          default:
            this.logger.warn(
              { conversation_id: conversationId, message: messageData },
              'Unhandled WebSocket event type'
            );
            break;
        }
      } catch (error) {
        this.handleError(error instanceof Error ? error : new Error(String(error)), {
          conversationId,
          message: data.toString(),
        });
      }
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
    });

    ws.on('error', (error: Error) => {
      this.handleError(error, { conversationId });
    });
  }

  /**
   * Handle WebSocket setup message
   */
  private handleSetupMessage(ws: WebSocket, message: SetupMessage): ConversationId {
    const { callSid, from, to, customParameters } = message;

    // Extract conversation ID and profile ID from custom parameters
    let conversationId: ConversationId;
    let profileId: ProfileId | undefined;

    if (
      customParameters?.conversation_id &&
      typeof customParameters.conversation_id === 'string' &&
      isConversationId(customParameters.conversation_id)
    ) {
      conversationId = customParameters.conversation_id;
    } else {
      // Generate conversation ID from call SID if not provided
      conversationId = callSid as ConversationId;
    }

    if (
      customParameters?.profile_id &&
      typeof customParameters.profile_id === 'string' &&
      isProfileId(customParameters.profile_id)
    ) {
      profileId = customParameters.profile_id;
    }

    // Store WebSocket connection
    this.webSocketConnections.set(conversationId, ws);
    this.callSidToConversationId.set(callSid, conversationId);

    // Start conversation session
    const session = this.startConversation(conversationId, profileId);

    // Populate author_info with caller's phone number for profile lookup
    session.author_info = {
      address: from,
    };

    // Invoke setup callback
    if (this.voiceCallbacks.onSetup) {
      this.voiceCallbacks.onSetup({
        conversationId,
        profileId: profileId ?? undefined,
        callSid,
        from,
        to,
        customParameters: customParameters ?? undefined,
      });
    }

    if (this.voiceCallbacks.onWebSocketConnected) {
      this.voiceCallbacks.onWebSocketConnected({ conversationId });
    }

    return conversationId;
  }

  /**
   * Handle WebSocket prompt message (user speech)
   */
  private handlePromptMessage(conversationId: ConversationId, message: PromptMessage): void {
    const transcript = message.voicePrompt;

    // Cancel any existing stream task before processing new prompt
    this.cancelStreamTask(conversationId);

    if (this.voiceCallbacks.onPrompt) {
      this.voiceCallbacks.onPrompt({
        conversationId,
        transcript,
      });
    }
  }

  /**
   * Handle WebSocket interrupt message
   */
  private handleInterruptMessage(conversationId: ConversationId, message: InterruptMessage): void {
    const { reason, transcript } = message;

    // Cancel any in-flight stream task on interrupt
    const cancelled = this.cancelStreamTask(conversationId);
    if (cancelled) {
      this.logger.info(
        { conversation_id: conversationId },
        'Cancelled stream task due to interrupt'
      );
    }

    if (this.voiceCallbacks.onInterrupt) {
      this.voiceCallbacks.onInterrupt({
        conversationId,
        reason: reason ?? 'unknown',
        transcript: transcript ?? undefined,
      });
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  private async handleWebSocketDisconnect(conversationId: ConversationId): Promise<void> {
    this.webSocketConnections.delete(conversationId);

    // Find and remove call SID mapping
    for (const [callSid, cId] of this.callSidToConversationId.entries()) {
      if (cId === conversationId) {
        this.callSidToConversationId.delete(callSid);
        break;
      }
    }

    if (this.voiceCallbacks.onWebSocketDisconnected) {
      this.voiceCallbacks.onWebSocketDisconnected({ conversationId });
    }

    // End conversation
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

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error(`No active WebSocket connection for conversation ${conversationId}`);
      }

      const response: VoiceResponse = {
        type: 'text',
        token: message,
        last: true,
      };

      ws.send(JSON.stringify(response));
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

  // =========================================================================
  // Incoming Call Handling (with conversation creation)
  // =========================================================================

  /**
   * Handle incoming voice call - create conversation, add participants, generate TwiML
   *
   * @param options - Options for handling the incoming call
   * @returns TwiML XML string with ConversationRelay configuration
   */
  public async handleIncomingCall(options: {
    websocketUrl: string;
    toNumber: string;
    fromNumber: string;
    callSid?: string;
    actionUrl?: string;
    welcomeGreeting?: string;
  }): Promise<string> {
    const {
      websocketUrl,
      toNumber,
      fromNumber,
      callSid,
      actionUrl,
      welcomeGreeting = 'Hello! How can I assist you today?',
    } = options;

    // Create timestamp for conversation name
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
    const conversationName = `tac-voice-${fromNumber}-${timestamp}`;

    // Get conversation client
    const conversationClient = this.tac.getConversationClient();

    // Create conversation
    const conversation = await conversationClient.createConversation(conversationName);
    const conversationId = conversation.id;

    this.logger.debug(
      { conversation_id: conversationId, call_sid: callSid },
      'Created conversation for voice call'
    );

    // Add customer participant (caller)
    const customerParticipant = await conversationClient.addParticipant(
      conversationId,
      [{ channel: 'VOICE', address: fromNumber, channelId: callSid }],
      'CUSTOMER'
    );
    const profileId = customerParticipant.profileId || '';
    const customerParticipantId = customerParticipant.id;

    // Add AI agent participant (Twilio number)
    const aiAgentParticipant = await conversationClient.addParticipant(
      conversationId,
      [{ channel: 'VOICE', address: toNumber, channelId: callSid }],
      'AI_AGENT'
    );
    const aiAgentParticipantId = aiAgentParticipant.id;

    // Build action attribute if provided
    const actionAttr = actionUrl ? ` action="${actionUrl}"` : '';

    // Generate TwiML with custom parameters
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect${actionAttr}>
        <ConversationRelay url="${websocketUrl}" welcomeGreeting="${welcomeGreeting}">
            <Parameter name="conversation_id" value="${conversationId}" />
            <Parameter name="profile_id" value="${profileId}" />
            <Parameter name="customer_participant_id" value="${customerParticipantId}" />
            <Parameter name="ai_agent_participant_id" value="${aiAgentParticipantId}" />
        </ConversationRelay>
    </Connect>
</Response>`;
  }

  // =========================================================================
  // ConversationRelay Callback Handling
  // =========================================================================

  /**
   * Handle ConversationRelay callback from Twilio
   *
   * @param payload - Callback payload from Twilio
   * @param handoffHandler - Optional handler for handoff requests
   * @returns Response with status, content, and content type
   */
  public async handleConversationRelayCallback(
    payload: ConversationRelayCallbackPayload,
    handoffHandler?: (payload: ConversationRelayCallbackPayload) => Promise<string>
  ): Promise<{ status: number; content: string; contentType: string }> {
    this.logger.debug(
      { call_sid: payload.CallSid, call_status: payload.CallStatus },
      'ConversationRelay callback received'
    );

    // Check for handoff condition: call in-progress with handoff data
    if (payload.CallStatus === 'in-progress' && payload.HandoffData) {
      if (handoffHandler) {
        try {
          const response = await handoffHandler(payload);
          return { status: 200, content: response, contentType: 'application/xml' };
        } catch (error) {
          this.logger.error({ err: error }, 'Handoff handler failed');
          return { status: 500, content: 'Handoff handler error', contentType: 'text/plain' };
        }
      }
      return { status: 501, content: 'No handoff handler registered', contentType: 'text/plain' };
    }

    // On call completion, close associated conversations
    if (payload.CallStatus === 'completed') {
      await this.closeConversationsForCall(payload.CallSid);
    }

    return { status: 200, content: 'OK', contentType: 'text/plain' };
  }

  /**
   * Close all conversations associated with a call
   */
  private async closeConversationsForCall(callSid: string): Promise<void> {
    try {
      const conversationClient = this.tac.getConversationClient();
      const conversations = await conversationClient.listConversations({ channelId: callSid });

      this.logger.info(
        { call_sid: callSid, count: conversations.length },
        'Closing conversations for completed call'
      );

      for (const conversation of conversations) {
        try {
          await conversationClient.updateConversation(conversation.id, 'CLOSED');
          this.logger.debug({ conversation_id: conversation.id }, 'Closed conversation');
        } catch (error) {
          this.logger.error(
            { err: error, conversation_id: conversation.id },
            'Failed to close conversation'
          );
        }
      }
    } catch (error) {
      this.logger.error({ err: error, call_sid: callSid }, 'Failed to list conversations for call');
    }
  }

  // =========================================================================
  // Stream Task Management
  // =========================================================================

  /**
   * Start tracking a streaming task for a conversation
   *
   * @param conversationId - The conversation ID
   * @returns AbortController for the task
   */
  public startStreamTask(conversationId: ConversationId): AbortController {
    // Cancel any existing task
    this.cancelStreamTask(conversationId);

    const controller = new AbortController();
    this.streamTasks.set(conversationId, controller);

    this.logger.debug({ conversation_id: conversationId }, 'Started stream task');
    return controller;
  }

  /**
   * Cancel an active streaming task
   *
   * @param conversationId - The conversation ID
   * @returns true if a task was cancelled, false otherwise
   */
  public cancelStreamTask(conversationId: ConversationId): boolean {
    const controller = this.streamTasks.get(conversationId);
    if (controller) {
      controller.abort();
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
    const controller = this.streamTasks.get(conversationId);
    return controller !== undefined && !controller.signal.aborted;
  }

  // =========================================================================
  // TwiML Generation (legacy, without conversation creation)
  // =========================================================================

  /**
   * Generate TwiML for incoming calls
   */
  public generateTwiML(options: TwiMLOptions): string {
    const { websocketUrl, customParameters, welcomeGreeting } = options;

    let customParamsXml = '';
    if (customParameters) {
      for (const [key, value] of Object.entries(customParameters)) {
        if (value !== undefined) {
          customParamsXml += `<Parameter name="${key}" value="${value}" />`;
        }
      }
    }

    // Build welcomeGreeting attribute if provided
    const greetingAttr = welcomeGreeting ? ` welcomeGreeting="${welcomeGreeting}"` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${websocketUrl}"${greetingAttr}>
      ${customParamsXml}
    </ConversationRelay>
  </Connect>
</Response>`;
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
    this.callSidToConversationId.clear();
    super.shutdown();
  }
}
