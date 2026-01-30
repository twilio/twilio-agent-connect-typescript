import {
  OperatorResultEvent,
  OperatorResultEventSchema,
  OperatorResult,
  OperatorProcessingResult,
  ConversationIntelligenceConfig,
} from '../types/index';
import { MemoryClient } from '../clients/memory';
import { Logger, createLogger } from './logger';

/**
 * Extract profile IDs from operator result execution details
 *
 * @param operatorResult - The operator result to extract profile IDs from
 * @returns Array of profile IDs found in participants
 */
function extractProfileIds(operatorResult: OperatorResult): string[] {
  const profileIds: string[] = [];

  if (operatorResult.executionDetails?.participants) {
    for (const participant of operatorResult.executionDetails.participants) {
      if (participant.profileId) {
        profileIds.push(participant.profileId);
      }
    }
  }

  return profileIds;
}

/**
 * Generate content string from operator result
 *
 * @param operatorResult - The operator result to generate content from
 * @returns Content string or undefined if result is empty
 */
function generateContent(operatorResult: OperatorResult): string | undefined {
  const result = operatorResult.result;

  if (result === null || result === undefined) {
    return undefined;
  }

  if (typeof result === 'string') {
    return result.trim() || undefined;
  }

  // For objects/arrays, stringify them
  const jsonString = JSON.stringify(result);
  return jsonString === '{}' || jsonString === '[]' ? undefined : jsonString;
}

/**
 * Parse observations content from JSON result
 *
 * Expects format: { "observations": ["obs1", "obs2", ...] }
 *
 * @param jsonContent - JSON string to parse
 * @returns Array of observation strings
 */
function parseObservationsContent(jsonContent: string): string[] {
  try {
    const parsed = JSON.parse(jsonContent) as unknown;

    if (typeof parsed === 'object' && parsed !== null && 'observations' in parsed) {
      const observations = (parsed as { observations: unknown }).observations;
      if (Array.isArray(observations)) {
        return observations.filter(
          (obs): obs is string => typeof obs === 'string' && obs.trim() !== ''
        );
      }
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Parse summaries content from JSON result
 *
 * Expects format: { "summaries": ["summary1", "summary2", ...] }
 *
 * @param jsonContent - JSON string to parse
 * @returns Array of summary strings
 */
function parseSummariesContent(jsonContent: string): string[] {
  try {
    const parsed = JSON.parse(jsonContent) as unknown;

    if (typeof parsed === 'object' && parsed !== null && 'summaries' in parsed) {
      const summaries = (parsed as { summaries: unknown }).summaries;
      if (Array.isArray(summaries)) {
        return summaries.filter((s): s is string => typeof s === 'string' && s.trim() !== '');
      }
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Processor for Conversation Intelligence operator result webhooks
 *
 * Processes operator results from CI and creates observations or summaries
 * in the Memory service based on the operator configuration.
 */
export class OperatorResultProcessor {
  private readonly memoryClient: MemoryClient;
  private readonly config: ConversationIntelligenceConfig;
  private readonly logger: Logger;

  constructor(memoryClient: MemoryClient, config: ConversationIntelligenceConfig, logger?: Logger) {
    this.memoryClient = memoryClient;
    this.config = config;
    this.logger = logger ?? createLogger({ name: 'cintel-processor' });
  }

  /**
   * Process an operator result event webhook payload
   *
   * @param payload - The raw webhook payload
   * @returns Processing result indicating success/failure and details
   */
  public async processEvent(payload: unknown): Promise<OperatorProcessingResult> {
    // Validate the payload
    const parseResult = OperatorResultEventSchema.safeParse(payload);

    if (!parseResult.success) {
      this.logger.warn(
        { validation_errors: parseResult.error.errors },
        'Invalid operator result event payload'
      );
      return {
        success: false,
        skipped: false,
        error: `Invalid payload: ${parseResult.error.message}`,
        createdCount: 0,
      };
    }

    const event = parseResult.data;

    // Check if this event is from the configured CI configuration
    if (event.intelligenceConfiguration.id !== this.config.configurationId) {
      this.logger.debug(
        {
          received_config_id: event.intelligenceConfiguration.id,
          expected_config_id: this.config.configurationId,
        },
        'Skipping event from different CI configuration'
      );
      return {
        success: true,
        skipped: true,
        skipReason: `Event from different CI configuration: ${event.intelligenceConfiguration.id}`,
        createdCount: 0,
      };
    }

    // Process each operator result
    const results: OperatorProcessingResult[] = [];

    for (const operatorResult of event.operatorResults) {
      const result = await this.processOperatorResult(event, operatorResult);
      results.push(result);
    }

    // Aggregate results
    const successCount = results.filter(r => r.success && !r.skipped).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const errorCount = results.filter(r => !r.success).length;
    const totalCreated = results.reduce((sum, r) => sum + r.createdCount, 0);

    // Determine overall event type
    const eventTypes = results
      .filter(r => r.success && !r.skipped && r.eventType)
      .map(r => r.eventType);
    const uniqueEventTypes = [...new Set(eventTypes)];
    const eventType =
      uniqueEventTypes.length === 1
        ? uniqueEventTypes[0]
        : uniqueEventTypes.length > 1
          ? 'mixed'
          : undefined;

    if (errorCount > 0) {
      const errors = results.filter(r => !r.success).map(r => r.error);
      return {
        success: false,
        eventType,
        skipped: false,
        error: `${errorCount} operator(s) failed: ${errors.join('; ')}`,
        createdCount: totalCreated,
      };
    }

    if (skippedCount === results.length) {
      return {
        success: true,
        skipped: true,
        skipReason: 'All operator results were skipped',
        createdCount: 0,
      };
    }

    this.logger.info(
      {
        conversation_id: event.conversationId,
        success_count: successCount,
        skipped_count: skippedCount,
        created_count: totalCreated,
        event_type: eventType,
      },
      'Processed operator result event'
    );

    return {
      success: true,
      eventType,
      skipped: false,
      createdCount: totalCreated,
    };
  }

  /**
   * Process an individual operator result
   */
  private async processOperatorResult(
    event: OperatorResultEvent,
    operatorResult: OperatorResult
  ): Promise<OperatorProcessingResult> {
    const operatorSid = operatorResult.operator.id;

    // Check if this is a configured operator
    const isObservationOperator = this.config.observationOperatorSid === operatorSid;
    const isSummaryOperator = this.config.summaryOperatorSid === operatorSid;

    if (!isObservationOperator && !isSummaryOperator) {
      this.logger.debug(
        {
          operator_sid: operatorSid,
          observation_operator_sid: this.config.observationOperatorSid,
          summary_operator_sid: this.config.summaryOperatorSid,
        },
        'Skipping unconfigured operator'
      );
      return {
        success: true,
        skipped: true,
        skipReason: `Operator ${operatorSid} is not configured for processing`,
        createdCount: 0,
      };
    }

    // Generate content from operator result
    const content = generateContent(operatorResult);

    if (!content) {
      this.logger.debug(
        { operator_sid: operatorSid },
        'Skipping operator result with empty content'
      );
      return {
        success: true,
        skipped: true,
        skipReason: 'Operator result has empty content',
        createdCount: 0,
      };
    }

    // Extract profile IDs from execution details
    const profileIds = extractProfileIds(operatorResult);

    if (profileIds.length === 0) {
      this.logger.warn(
        { operator_sid: operatorSid, conversation_id: event.conversationId },
        'No profile IDs found in operator result'
      );
      return {
        success: true,
        skipped: true,
        skipReason: 'No profile IDs found in operator result execution details',
        createdCount: 0,
      };
    }

    // Check for memory store ID
    if (!event.memoryStoreId) {
      this.logger.warn({ conversation_id: event.conversationId }, 'No memory store ID in event');
      return {
        success: false,
        skipped: false,
        error: 'No memory store ID provided in event',
        createdCount: 0,
      };
    }

    // Process based on operator type
    if (isObservationOperator) {
      return this.processObservationEvent(event, operatorResult, content, profileIds);
    } else {
      return this.processSummaryEvent(event, operatorResult, content, profileIds);
    }
  }

  /**
   * Process an observation operator result
   */
  private async processObservationEvent(
    event: OperatorResultEvent,
    operatorResult: OperatorResult,
    content: string,
    profileIds: string[]
  ): Promise<OperatorProcessingResult> {
    // Parse observations from JSON content
    const observations = parseObservationsContent(content);

    if (observations.length === 0) {
      this.logger.debug(
        { operator_sid: operatorResult.operator.id },
        'No observations found in content'
      );
      return {
        success: true,
        eventType: 'observation',
        skipped: true,
        skipReason: 'No observations found in operator result content',
        createdCount: 0,
      };
    }

    let createdCount = 0;

    // Create observations for each profile
    for (const profileId of profileIds) {
      for (const observation of observations) {
        try {
          await this.memoryClient.createObservation(
            event.memoryStoreId!,
            profileId,
            observation,
            'conversation-intelligence',
            [event.conversationId],
            operatorResult.dateCreated
          );
          createdCount++;

          this.logger.debug(
            {
              profile_id: profileId,
              conversation_id: event.conversationId,
              observation_preview: observation.substring(0, 100),
            },
            'Created observation'
          );
        } catch (error) {
          this.logger.error(
            {
              err: error,
              profile_id: profileId,
              conversation_id: event.conversationId,
            },
            'Failed to create observation'
          );
          return {
            success: false,
            eventType: 'observation',
            skipped: false,
            error: `Failed to create observation: ${error instanceof Error ? error.message : String(error)}`,
            createdCount,
          };
        }
      }
    }

    return {
      success: true,
      eventType: 'observation',
      skipped: false,
      createdCount,
    };
  }

  /**
   * Process a summary operator result
   */
  private async processSummaryEvent(
    event: OperatorResultEvent,
    operatorResult: OperatorResult,
    content: string,
    profileIds: string[]
  ): Promise<OperatorProcessingResult> {
    // Parse summaries from JSON content
    const summaries = parseSummariesContent(content);

    if (summaries.length === 0) {
      this.logger.debug(
        { operator_sid: operatorResult.operator.id },
        'No summaries found in content'
      );
      return {
        success: true,
        eventType: 'summary',
        skipped: true,
        skipReason: 'No summaries found in operator result content',
        createdCount: 0,
      };
    }

    let createdCount = 0;

    // Create summaries for each profile
    for (const profileId of profileIds) {
      try {
        const summaryItems = summaries.map(summaryContent => ({
          content: summaryContent,
          conversationId: event.conversationId,
          occurredAt: operatorResult.dateCreated,
          source: 'conversation-intelligence',
        }));

        await this.memoryClient.createConversationSummaries(
          event.memoryStoreId!,
          profileId,
          summaryItems
        );
        createdCount += summaries.length;

        this.logger.debug(
          {
            profile_id: profileId,
            conversation_id: event.conversationId,
            summary_count: summaries.length,
          },
          'Created conversation summaries'
        );
      } catch (error) {
        this.logger.error(
          {
            err: error,
            profile_id: profileId,
            conversation_id: event.conversationId,
          },
          'Failed to create conversation summaries'
        );
        return {
          success: false,
          eventType: 'summary',
          skipped: false,
          error: `Failed to create summaries: ${error instanceof Error ? error.message : String(error)}`,
          createdCount,
        };
      }
    }

    return {
      success: true,
      eventType: 'summary',
      skipped: false,
      createdCount,
    };
  }
}
