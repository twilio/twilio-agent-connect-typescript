import {
  TACConfigData,
  ConversationSession,
  ConversationId,
  ProfileId,
  ProfileResponse,
  ChannelType,
  OperatorProcessingResult,
} from '../types';
import { TACMemoryResponse } from './tac-memory-response';
import { TACConfig } from './config';
import { MemoryClient } from '../clients/memory';
import { ConversationClient } from '../clients/conversation';
import { KnowledgeClient } from '../clients/knowledge';
import { BaseChannel } from '../channels/base';
import { Logger, createLogger } from './logger';
import { OperatorResultProcessor } from './operator-result-processor';

export interface TACOptions {
  config?: TACConfig | TACConfigData;
  logger?: Logger;
}

/**
 * Callback function signatures for TAC events
 */
export type MessageReadyCallback = (params: {
  conversationId: ConversationId;
  profileId: ProfileId | undefined;
  message: string;
  author: string;
  memory: TACMemoryResponse | undefined;
  session: ConversationSession;
  channel: ChannelType;
}) => Promise<string | null | void> | string | null | void;

export type InterruptCallback = (params: {
  conversationId: ConversationId;
  reason: string;
  transcript: string | undefined;
  session: ConversationSession;
}) => Promise<void> | void;

export type HandoffCallback = (params: {
  conversationId: ConversationId;
  profileId: ProfileId | undefined;
  reason: string;
  session: ConversationSession;
}) => Promise<void> | void;

export type ConversationEndedCallback = (params: {
  session: ConversationSession;
}) => Promise<void> | void;

/**
 * Main Twilio Agent Connect class
 *
 * Central orchestrator that manages configuration, channels, callbacks,
 * and coordinates between memory, conversations, and LLM integrations.
 */
export class TAC {
  private static readonly FACTORY_TOKEN = Symbol('TAC.create');

  private readonly config: TACConfig;
  public readonly logger: Logger;
  private memoryClient!: MemoryClient;
  private knowledgeClient!: KnowledgeClient;
  private readonly conversationClient: ConversationClient;
  private readonly channels: Map<ChannelType, BaseChannel>;
  private cintelProcessor?: OperatorResultProcessor;

  private memoryStoreId!: string;

  /**
   * V1 Conversations service SID sourced from `conversationsV1Bridge.serviceId`
   * on the configuration. Forwarded by the chat channel as
   * `channelSettings.chatService` on Actions API requests.
   *
   * TODO(conv-orch): Remove once the Actions API resolves the V1 Chat service SID
   * server-side. Confirmed this should not be required client-side; until the
   * server-side fix ships, CHAT sends fail with
   *   "chatService attribute is required for CHAT channel"
   * unless we pass it on channelSettings.chatService. When the server-side fix
   * lands, drop this attribute plus ActionChannelSettings.chatService and the
   * chat channel's chatServiceSid plumbing.
   */
  public conversationsV1ServiceSid: string | undefined;

  // Callback registrations
  private messageReadyCallback?: MessageReadyCallback;
  private interruptCallback?: InterruptCallback;
  private handoffCallback?: HandoffCallback;
  private conversationEndedCallback?: ConversationEndedCallback;

  private constructor(token: symbol, options: TACOptions = {}) {
    if (token !== TAC.FACTORY_TOKEN) {
      throw new Error('TAC constructor is private. Use TAC.create() instead of new TAC().');
    }
    // Handle config resolution:
    // - If it's already a TACConfig instance, use it
    // - If it's data, create a new TACConfig
    // - If not provided, load from environment variables
    const finalConfig = options.config
      ? options.config instanceof TACConfig
        ? options.config
        : new TACConfig(options.config)
      : TACConfig.fromEnv();
    const finalLogger = options.logger ?? createLogger({ name: 'tac' });

    this.config = finalConfig;
    this.logger = finalLogger;
    this.channels = new Map();
    this.conversationClient = new ConversationClient(
      this.config,
      this.logger.child({ component: 'conversation' })
    );
  }

  public static async create(options: TACOptions = {}): Promise<TAC> {
    const tac = new TAC(TAC.FACTORY_TOKEN, options);

    try {
      const conversationConfig = await tac.conversationClient.getConfiguration(
        tac.config.conversationConfigurationId
      );

      tac.memoryStoreId = conversationConfig.memoryStoreId;
      // TODO(conv-orch): Remove once the Actions API resolves the V1 Chat service SID
      // server-side — see the conversationsV1ServiceSid field comment above.
      tac.conversationsV1ServiceSid =
        conversationConfig.conversationsV1Bridge?.serviceId ?? undefined;
      tac.memoryClient = new MemoryClient(tac.config, tac.logger.child({ component: 'memory' }));

      tac.knowledgeClient = new KnowledgeClient(
        tac.config,
        tac.logger.child({ component: 'knowledge' })
      );

      if (tac.config.cintelConfigurationId) {
        tac.cintelProcessor = new OperatorResultProcessor(
          tac.memoryClient,
          {
            configurationId: tac.config.cintelConfigurationId,
            observationOperatorSid: tac.config.cintelObservationOperatorSid,
            summaryOperatorSid: tac.config.cintelSummaryOperatorSid,
          },
          tac.logger.child({ component: 'cintel' })
        );
      }

      return tac;
    } catch (error) {
      tac.logger.error({ err: error }, 'TAC initialization failed');
      throw error;
    }
  }

  /**
   * Register a channel with the framework
   */
  public registerChannel(channel: BaseChannel): void {
    this.logger.info({ channel: channel.channelType }, 'Registering channel');

    // Remove existing channel of same type
    const existingChannel = this.channels.get(channel.channelType);
    if (existingChannel) {
      this.logger.info({ channel: channel.channelType }, 'Replacing existing channel registration');
      existingChannel.shutdown();
    }

    this.channels.set(channel.channelType, channel);

    // Set up channel event listeners
    this.setupChannelEventListeners(channel);

    this.logger.info({ channel: channel.channelType }, 'Channel registration complete');
  }

  /**
   * Set up event listeners for a channel
   */
  private setupChannelEventListeners(channel: BaseChannel): void {
    // Handle channel errors directly
    channel.on(
      'error',
      ({ error, context }: { error: Error; context?: Record<string, unknown> }) => {
        this.logger.error({ err: error, ...context }, 'Channel error');
      }
    );

    // Handle message received events for SMS channels
    channel.on(
      'messageReceived',
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async callback
      async (data: {
        conversationId: ConversationId;
        profileId: ProfileId | undefined;
        message: string;
        author: string;
        userMemory: TACMemoryResponse | undefined;
      }): Promise<void> => {
        await this.handleMessageReady({ ...data, channelType: channel.channelType });
      }
    );

    // Handle voice prompt events
    channel.on(
      'prompt',
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async callback
      async ({
        conversationId,
        transcript,
        userMemory,
        session,
      }: {
        conversationId: ConversationId;
        transcript: string;
        userMemory?: TACMemoryResponse;
        session?: ConversationSession;
      }): Promise<void> => {
        // Use session from event if available, otherwise get from channel
        const eventSession = session || channel.getConversationSession(conversationId);
        if (eventSession) {
          await this.handleMessageReady({
            conversationId,
            profileId: eventSession.profileId ? (eventSession.profileId as ProfileId) : undefined,
            message: transcript,
            author: 'user',
            userMemory,
            channelType: channel.channelType,
          });
        }
      }
    );

    // Handle voice interrupt events
    channel.on(
      'interrupt',
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async event handler
      async ({
        conversationId,
        reason,
        transcript,
      }: {
        conversationId: ConversationId;
        reason: string;
        transcript: string | undefined;
      }) => {
        const session = channel.getConversationSession(conversationId);
        if (session && this.interruptCallback) {
          try {
            await this.interruptCallback({
              conversationId,
              reason,
              transcript: transcript ?? undefined,
              session,
            });
          } catch (error) {
            this.logger.error(
              { err: error, conversation_id: conversationId },
              'Interrupt callback error'
            );
          }
        }
      }
    );

    // Handle conversation ended events
    channel.on(
      'conversationEnded',
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async event handler
      async ({ session }: { session: ConversationSession }) => {
        if (this.conversationEndedCallback) {
          try {
            await this.conversationEndedCallback({ session });
          } catch (error) {
            this.logger.error(
              { err: error, conversation_id: session.conversationId },
              'Conversation ended callback error'
            );
          }
        }
      }
    );
  }

  /**
   * Handle message ready event from channels
   */
  private async handleMessageReady(data: {
    conversationId: ConversationId;
    profileId: ProfileId | undefined;
    message: string;
    author: string;
    userMemory: TACMemoryResponse | undefined;
    channelType: ChannelType;
  }): Promise<void> {
    this.logger.debug(
      {
        conversation_id: data.conversationId,
        profile_id: data.profileId,
        author: data.author,
        message_length: data.message.length,
        channel: data.channelType,
        operation: 'handle_message_ready',
      },
      'Handling message ready'
    );

    if (!this.messageReadyCallback) {
      this.logger.warn('No message ready callback registered');
      return;
    }

    try {
      // Use the channel type passed from the event handler, not lookup by conversation ID
      // This ensures voice prompts use voice channel even if SMS also has this conversation
      const channel = this.channels.get(data.channelType);
      if (!channel) {
        throw new Error(`No channel found for type ${data.channelType}`);
      }

      this.logger.debug(
        { conversation_id: data.conversationId, channel: channel.channelType },
        'Using channel for message'
      );

      const session = channel.getConversationSession(data.conversationId);
      if (!session) {
        throw new Error(`No session found for conversation ${data.conversationId}`);
      }

      // Get memory if not already provided and profile ID exists
      let memory = data.userMemory;
      if (!memory && data.profileId) {
        this.logger.debug(
          { profile_id: data.profileId, operation: 'memory_retrieval' },
          'Retrieving memory for profile'
        );
        try {
          const memoryResponse = await this.memoryClient.retrieveMemories(
            this.memoryStoreId,
            data.profileId
          );
          memory = new TACMemoryResponse(memoryResponse);
          this.logger.debug({ profile_id: data.profileId }, 'Memory retrieved');
        } catch (error) {
          this.logger.warn({ err: error, profile_id: data.profileId }, 'Failed to retrieve memory');
        }
      }

      // Execute callback
      this.logger.debug(
        { conversation_id: data.conversationId },
        'Executing message ready callback'
      );
      try {
        const response = await this.messageReadyCallback({
          conversationId: data.conversationId,
          profileId: data.profileId,
          message: data.message,
          author: data.author,
          memory: memory ?? undefined,
          session,
          channel: channel.channelType,
        });
        this.logger.debug(
          { conversation_id: data.conversationId },
          'Message ready callback completed'
        );

        // Auto-send if callback returned a string
        if (typeof response === 'string') {
          if (response === '') {
            this.logger.warn(
              { conversation_id: data.conversationId },
              'Callback returned empty string, skipping auto-send'
            );
          } else {
            try {
              await channel.sendResponse(data.conversationId, response);
            } catch (sendError) {
              this.logger.error(
                { err: sendError, conversation_id: data.conversationId },
                'Failed to auto-send callback response'
              );
            }
          }
        }
      } catch (error) {
        this.logger.error(
          { err: error, conversation_id: data.conversationId },
          'Message ready callback error'
        );
      }

      this.logger.debug({ conversation_id: data.conversationId }, 'Message handling completed');
    } catch (error) {
      this.logger.error(
        { err: error, conversation_id: data.conversationId },
        'Message handling error'
      );
    }
  }

  /**
   * Register callback for when messages are ready to be processed.
   * Return a string to auto-send, or null/void for manual handling.
   */
  public onMessageReady(callback: MessageReadyCallback): void {
    this.messageReadyCallback = callback;
  }

  /**
   * Register callback for when user interrupts (voice channel)
   */
  public onInterrupt(callback: InterruptCallback): void {
    this.interruptCallback = callback;
  }

  /**
   * Register callback for human handoff
   */
  public onHandoff(callback: HandoffCallback): void {
    this.handoffCallback = callback;
  }

  /**
   * Register callback for when a conversation ends.
   *
   * The callback is triggered by channels when a conversation is closed
   * (e.g., SMS conversation status changed to CLOSED, or voice WebSocket
   * disconnected). The callback receives the full ConversationSession before
   * it is cleaned up.
   */
  public onConversationEnded(callback: ConversationEndedCallback): void {
    this.conversationEndedCallback = callback;
  }

  /**
   * Trigger handoff callback
   */
  public async triggerHandoff(conversationId: ConversationId, reason: string): Promise<void> {
    if (!this.handoffCallback) {
      this.logger.warn({ conversation_id: conversationId }, 'No handoff callback registered');
      return;
    }

    const channel = this.getChannelByConversationId(conversationId);
    const session = channel?.getConversationSession(conversationId);

    if (!session) {
      throw new Error(`No session found for conversation ${conversationId}`);
    }

    try {
      await this.handoffCallback({
        conversationId,
        profileId: session.profileId ? (session.profileId as ProfileId) : undefined,
        reason,
        session,
      });
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, 'Handoff callback error');
    }
  }

  /**
   * Get channel by conversation ID
   */
  private getChannelByConversationId(conversationId: ConversationId): BaseChannel | undefined {
    for (const channel of this.channels.values()) {
      if (channel.isConversationActive(conversationId)) {
        return channel;
      }
    }
    return undefined;
  }

  /**
   * Get registered channel by type
   */
  public getChannel<T extends BaseChannel>(channelType: ChannelType): T | undefined {
    return this.channels.get(channelType) as T | undefined;
  }

  /**
   * Get configuration
   */
  public getConfig(): TACConfig {
    return this.config;
  }

  /**
   * Get memory client for advanced memory operations
   */
  public getMemoryClient(): MemoryClient {
    return this.memoryClient;
  }

  /**
   * Get knowledge client for knowledge base operations
   */
  public getKnowledgeClient(): KnowledgeClient {
    return this.knowledgeClient;
  }

  /**
   * Get conversation client for advanced conversation operations
   */
  public getConversationClient(): ConversationClient {
    return this.conversationClient;
  }

  /**
   * Check if Conversation Intelligence processing is enabled
   *
   * @returns true if CI processor is initialized, false otherwise
   */
  public isCintelEnabled(): boolean {
    return this.cintelProcessor !== undefined;
  }

  /**
   * Process a Conversation Intelligence operator result webhook event
   *
   * @param payload - The raw webhook payload from CI
   * @returns Promise containing the processing result
   * @throws Error if CI processor is not initialized
   */
  public async processCintelEvent(payload: unknown): Promise<OperatorProcessingResult> {
    if (!this.cintelProcessor) {
      throw new Error(
        'Conversation Intelligence processor is not initialized. ' +
          'Ensure cintelConfigurationId is provided in TAC configuration.'
      );
    }
    return this.cintelProcessor.processEvent(payload);
  }

  /**
   * Retrieve memories from Memory API with automatic fallback to Conversations API
   *
   * @param session - Conversation session context
   * @param query - Optional semantic search query
   * @returns Promise containing TACMemoryResponse wrapper providing unified access to memory data.
   *
   * Attempts to retrieve from Memory API first:
   * - observations, summaries, and communications available
   * - communications include author name and type
   *
   * Falls back to Conversations API on error:
   * - observations and summaries are empty arrays
   * - communications have basic fields only (no author name/type)
   */
  public async retrieveMemory(
    session: ConversationSession,
    query?: string
  ): Promise<TACMemoryResponse> {
    try {
      // If profileId is missing, try to lookup profile using address
      if (!session.profileId) {
        // Check if authorInfo and address are available
        if (!session.authorInfo || !session.authorInfo.address) {
          throw new Error(
            'profileId is required for memory retrieval but was not found in ' +
              'conversation context. Additionally, authorInfo.address is not available ' +
              'for profile lookup. Ensure either profileId or authorInfo.address is ' +
              'provided when creating the ConversationSession.'
          );
        }

        // Determine identity type based on address format
        // Email addresses contain '@', phone numbers start with '+'
        const address = session.authorInfo.address;
        let identityType: 'email' | 'phone';
        if (address.includes('@')) {
          identityType = 'email';
        } else if (address.startsWith('+')) {
          identityType = 'phone';
        } else {
          throw new Error(
            `Unsupported authorInfo.address format '${address}'. ` +
              "Expected an email address containing '@' or a phone number starting with '+'."
          );
        }
        this.logger.debug(
          { identityType, address, channel: session.channel },
          'profileId not found, attempting to lookup profile'
        );

        // Lookup profile using appropriate identity type
        const lookupResponse = await this.memoryClient.lookupProfile(
          this.memoryStoreId,
          identityType,
          session.authorInfo.address
        );

        // Check if any profiles were found
        if (!lookupResponse.profiles || lookupResponse.profiles.length === 0) {
          throw new Error(
            `No profile found for ${identityType} ${session.authorInfo.address}. ` +
              'Profile lookup returned no results. Ensure the identity ' +
              'is registered in the identity resolution system.'
          );
        }

        // Use the first profile ID
        session.profileId = lookupResponse.profiles[0];
      }

      // At this point, profileId is guaranteed to be defined (either provided or looked up)
      const memoryResponse = await this.memoryClient.retrieveMemories(
        this.memoryStoreId,
        session.profileId!,
        { query }
      );
      return new TACMemoryResponse(memoryResponse);
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Failed to retrieve memory from Memory API, falling back to Conversations API'
      );

      try {
        const communications = await this.conversationClient.listCommunications(
          session.conversationId
        );

        return new TACMemoryResponse(communications);
      } catch (fallbackError) {
        this.logger.error({ err: fallbackError }, 'Failed to retrieve communications');
        throw fallbackError;
      }
    }
  }

  /**
   * Fetch profile information with traits
   *
   * @param profileId - Profile ID to fetch
   * @returns Promise containing profile response or undefined if not available
   */
  public async fetchProfile(profileId: string): Promise<ProfileResponse | undefined> {
    if (!profileId) {
      this.logger.warn('profile_id is required for profile fetching but was not provided');
      return undefined;
    }

    try {
      const traitGroups = this.config.traitGroups;
      const profileResponse = await this.memoryClient.getProfile(
        this.memoryStoreId,
        profileId,
        traitGroups
      );
      return profileResponse;
    } catch (error) {
      this.logger.error({ err: error }, `Failed to fetch profile for ${profileId}`);
      return undefined;
    }
  }

  /**
   * Shutdown TAC and cleanup resources
   */
  public shutdown(): void {
    for (const channel of this.channels.values()) {
      this.logger.debug({ channel: channel.channelType }, 'Shutting down channel');
      channel.shutdown();
    }

    this.channels.clear();
    this.logger.info('TAC shutdown complete');
  }
}
