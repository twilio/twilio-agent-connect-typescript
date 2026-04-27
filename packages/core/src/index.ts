/**
 * Twilio Agent Connect - Core Package
 *
 * This is the main entry point for the Twilio Agent Connect.
 * It provides the core functionality for building intelligent agents
 * that integrate with Twilio's communication infrastructure.
 */

// Main TAC class
export { TAC } from './lib/tac';
export type {
  MessageReadyCallback,
  InterruptCallback,
  HandoffCallback,
  ConversationEndedCallback,
  TACOptions,
} from './lib/tac';

// Configuration management
export { TACConfig } from './lib/config';

// Logger
export { createLogger } from './lib/logger';
export type { Logger } from './lib/logger';

// API clients
export { BaseClient } from './clients/base';
export { MemoryClient } from './clients/memory';
export { ConversationClient } from './clients/conversation';
export { KnowledgeClient } from './clients/knowledge';

// Channel implementations
export { BaseChannel } from './channels/base';
export type { BaseChannelEvents } from './channels/base';

export { MessagingChannel } from './channels/messaging';
export type {
  MessagingChannelConfig,
  MessagingChannelEvents,
  MessagingWebhookPayload,
} from './channels/messaging';

export { SMSChannel } from './channels/sms';

export { ChatChannel } from './channels/chat';
export type {
  ChatChannelConfig,
  InitiateChatConversationOptions,
} from './channels/chat';

export { VoiceChannel } from './channels/voice';
export type { VoiceChannelEvents, StreamTask } from './channels/voice';

// Utility functions
export { handleFlexHandoffLogic } from './util/flex';
export type { FlexHandoffResult } from './util/flex';

// Conversation Intelligence processor
export { OperatorResultProcessor } from './lib/operator-result-processor';

// TAC Memory Response wrapper
export { TACMemoryResponse } from './lib/tac-memory-response';

// Re-export types for convenience
export * from './types/index';
