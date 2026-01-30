import { z } from 'zod';

/**
 * Conversation Intelligence Types
 *
 * These types represent the webhook payloads and configuration for
 * processing Conversation Intelligence operator results.
 */

/**
 * Participant in operator execution (e.g., CUSTOMER, AGENT)
 */
export const CintelParticipantSchema = z.object({
  type: z.string(),
  profileId: z.string().optional(),
  mediaParticipantId: z.string().optional(),
});

export type CintelParticipant = z.infer<typeof CintelParticipantSchema>;

/**
 * Execution details for an operator result
 */
export const ExecutionDetailsSchema = z.object({
  participants: z.array(CintelParticipantSchema).optional(),
});

export type ExecutionDetails = z.infer<typeof ExecutionDetailsSchema>;

/**
 * Operator metadata
 */
export const OperatorSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
});

export type Operator = z.infer<typeof OperatorSchema>;

/**
 * Individual operator result from Conversation Intelligence
 */
export const OperatorResultSchema = z.object({
  id: z.string(),
  operator: OperatorSchema,
  outputFormat: z.string(),
  result: z.unknown(),
  dateCreated: z.string(),
  referenceIds: z.array(z.string()).optional().default([]),
  executionDetails: ExecutionDetailsSchema.optional(),
});

export type OperatorResult = z.infer<typeof OperatorResultSchema>;

/**
 * Intelligence configuration metadata
 */
export const IntelligenceConfigurationSchema = z.object({
  id: z.string(),
  friendlyName: z.string().optional(),
});

export type IntelligenceConfiguration = z.infer<typeof IntelligenceConfigurationSchema>;

/**
 * Full webhook payload for operator result events
 */
export const OperatorResultEventSchema = z.object({
  accountId: z.string(),
  conversationId: z.string(),
  memoryStoreId: z.string().optional(),
  intelligenceConfiguration: IntelligenceConfigurationSchema,
  operatorResults: z.array(OperatorResultSchema),
});

export type OperatorResultEvent = z.infer<typeof OperatorResultEventSchema>;

/**
 * Result of processing an operator result event
 */
export const OperatorProcessingResultSchema = z.object({
  success: z.boolean(),
  eventType: z.string().optional(),
  skipped: z.boolean().default(false),
  skipReason: z.string().optional(),
  error: z.string().optional(),
  createdCount: z.number().default(0),
});

export type OperatorProcessingResult = z.infer<typeof OperatorProcessingResultSchema>;

/**
 * Conversation Intelligence configuration for TAC
 */
export const ConversationIntelligenceConfigSchema = z.object({
  configurationId: z.string(),
  observationOperatorSid: z.string().optional(),
  summaryOperatorSid: z.string().optional(),
});

export type ConversationIntelligenceConfig = z.infer<typeof ConversationIntelligenceConfigSchema>;

/**
 * Summary item for batch creation
 */
export const ConversationSummaryItemSchema = z.object({
  content: z.string(),
  conversationId: z.string(),
  occurredAt: z.string(),
  source: z.string().optional(),
});

export type ConversationSummaryItem = z.infer<typeof ConversationSummaryItemSchema>;
