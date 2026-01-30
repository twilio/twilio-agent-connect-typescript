import {
  TACConfigData,
  ConversationSession,
  ConversationId,
  ProfileId,
  MemoryRetrievalResponse,
  ProfileResponse,
  ChannelType,
  OperatorProcessingResult,
} from '../types/index';
import { TACConfig } from './config';
import { MemoryClient } from '../clients/memory';
import { ConversationClient } from '../clients/conversation';
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
  memory: MemoryRetrievalResponse | undefined;
  session: ConversationSession;
  channel: ChannelType;
}) => Promise<void> | void;

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

/**
 * Main Twilio Agent Connect class
 *
 * Central orchestrator that manages configuration, channels, callbacks,
 * and coordinates between memory, conversations, and LLM integrations.
 */
export class TAC {
  private readonly config: TACConfig;
  public readonly logger: Logger;
  private readonly memoryClient?: MemoryClient;
  private readonly conversationClient: ConversationClient;
  private readonly channels: Map<ChannelType, BaseChannel>;
  private readonly cintelProcessor?: OperatorResultProcessor;

  // Callback registrations
  private messageReadyCallback?: MessageReadyCallback;
  private interruptCallback?: InterruptCallback;
  private handoffCallback?: HandoffCallback;

  constructor(options: TACOptions = {}) {
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

    // Initialize Memory client only if all memory credentials are provided
    if (this.config.memoryStoreId && this.config.memoryApiKey && this.config.memoryApiToken) {
      this.memoryClient = new MemoryClient(this.config, this.logger.child({ component: 'memory' }));
      this.logger.info('Memory client initialized');
    } else {
      this.logger.info('Memory client not initialized (credentials not provided)');
    }

    // Initialize Conversation Intelligence processor if configured
    if (this.memoryClient && this.config.cintelConfigurationId) {
      this.cintelProcessor = new OperatorResultProcessor(
        this.memoryClient,
        {
          configurationId: this.config.cintelConfigurationId,
          observationOperatorSid: this.config.cintelObservationOperatorSid,
          summaryOperatorSid: this.config.cintelSummaryOperatorSid,
        },
        this.logger.child({ component: 'cintel' })
      );
      this.logger.info('Conversation Intelligence processor initialized');
    }

    this.conversationClient = new ConversationClient(
      this.config,
      this.logger.child({ component: 'conversation' })
    );
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
        userMemory: MemoryRetrievalResponse | undefined;
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
      }: {
        conversationId: ConversationId;
        transcript: string;
      }): Promise<void> => {
        const session = channel.getConversationSession(conversationId);
        if (session) {
          await this.handleMessageReady({
            conversationId,
            profileId: session.profile_id ? (session.profile_id as ProfileId) : undefined,
            message: transcript,
            author: 'user', // Voice transcripts are always from user
            userMemory: undefined,
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
  }

  /**
   * Handle message ready event from channels
   */
  private async handleMessageReady(data: {
    conversationId: ConversationId;
    profileId: ProfileId | undefined;
    message: string;
    author: string;
    userMemory: MemoryRetrievalResponse | undefined;
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

      // Get memory if not already provided, profile ID exists, and memory client is initialized
      let memory = data.userMemory;
      if (!memory && data.profileId && this.memoryClient && this.config.memoryStoreId) {
        this.logger.debug(
          { profile_id: data.profileId, operation: 'memory_retrieval' },
          'Retrieving memory for profile'
        );
        try {
          memory = await this.memoryClient.retrieveMemories(
            this.config.memoryStoreId,
            data.profileId
          );
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
        await this.messageReadyCallback({
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
   * Register callback for when messages are ready to be processed
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
        profileId: session.profile_id ? (session.profile_id as ProfileId) : undefined,
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
   * Returns undefined if memory credentials are not configured
   */
  public getMemoryClient(): MemoryClient | undefined {
    return this.memoryClient;
  }

  /**
   * Get conversation client for advanced conversation operations
   */
  public getConversationClient(): ConversationClient {
    return this.conversationClient;
  }

  /**
   * Check if Twilio Memory functionality is enabled
   *
   * @returns true if memory client is initialized, false otherwise
   */
  public isMemoryEnabled(): boolean {
    return this.memoryClient !== undefined;
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
          'Ensure both memory credentials and cintelConfigurationId are provided.'
      );
    }
    return this.cintelProcessor.processEvent(payload);
  }

  /**
   * Retrieve memories from Memory API or fallback to Conversations API
   *
   * @param session - Conversation session context
   * @param query - Optional semantic search query
   * @returns Promise containing memory retrieval response
   */
  public async retrieveMemory(
    session: ConversationSession,
    query?: string
  ): Promise<MemoryRetrievalResponse> {
    // If Memory API is configured
    if (this.memoryClient && this.config.memoryStoreId) {
      // If profile_id is missing, try to lookup profile using phone number
      if (!session.profile_id) {
        this.logger.debug('profile_id not found, attempting to lookup profile using phone number');

        // Check if author_info and address are available
        if (!session.author_info || !session.author_info.address) {
          throw new Error(
            'profile_id is required for memory retrieval but was not found in ' +
              'conversation context. Additionally, author_info.address is not available ' +
              'for profile lookup. Ensure either profile_id or author_info.address is ' +
              'provided when creating the ConversationSession.'
          );
        }

        try {
          // Lookup profile using phone number
          const lookupResponse = await this.memoryClient.lookupProfile(
            this.config.memoryStoreId,
            'phone',
            session.author_info.address
          );

          // Check if any profiles were found
          if (!lookupResponse.profiles || lookupResponse.profiles.length === 0) {
            throw new Error(
              `No profile found for phone number ${session.author_info.address}. ` +
                'Profile lookup returned no results. Ensure the phone number ' +
                'is registered in the identity resolution system.'
            );
          }

          // Use the first profile ID
          session.profile_id = lookupResponse.profiles[0];
        } catch (error) {
          this.logger.error(
            { err: error },
            `Failed to lookup profile for ${session.author_info.address}`
          );
          throw error;
        }
      }

      try {
        // At this point, profile_id is guaranteed to be defined (either provided or looked up)
        const memory = await this.memoryClient.retrieveMemories(
          this.config.memoryStoreId,
          session.profile_id!,
          { query }
        );
        return memory;
      } catch (error) {
        this.logger.error({ err: error }, 'Failed to retrieve memory');
        throw error;
      }
    } else {
      // Fallback to Conversations API
      this.logger.info('Twilio Memory not configured, falling back to Conversations API');

      try {
        const communications = await this.conversationClient.listCommunications(
          session.conversation_id
        );

        // Return MemoryRetrievalResponse with only communications populated
        return {
          observations: [],
          summaries: [],
          communications,
        };
      } catch (error) {
        this.logger.error({ err: error }, 'Failed to retrieve communications');
        throw error;
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
    // Check if memory client is initialized
    if (!this.memoryClient || !this.config.memoryStoreId) {
      this.logger.warn(
        'Memory client is not initialized. Cannot fetch profile. ' +
          'Provide memory credentials when creating TAC to enable profile fetching.'
      );
      return undefined;
    }

    // Validate profile_id
    if (!profileId) {
      this.logger.warn('profile_id is required for profile fetching but was not provided');
      return undefined;
    }

    try {
      // Get trait_groups from config if provided
      const traitGroups = this.config.traitGroups;

      // Fetch profile
      const profileResponse = await this.memoryClient.getProfile(
        this.config.memoryStoreId,
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
