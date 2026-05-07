import { z } from 'zod';

/**
 * Structured payload generated during a handoff.
 *
 * Contains conversation context and developer-defined attributes
 * for routing to the target system (e.g., Flex TaskRouter).
 *
 * Serialized with camelCase aliases (conversationId/storeId/profileId)
 * for the Studio Executions wire format.
 */
export const HandoffPayloadSchema = z.object({
  conversationId: z.string(),
  storeId: z.string(),
  profileId: z.string(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});

export type HandoffPayload = z.infer<typeof HandoffPayloadSchema>;

/**
 * ConversationRelay WebSocket ``end`` message carrying a handoff payload.
 *
 * ``handoffData`` is a JSON *string* (not a nested object) — ConversationRelay
 * forwards it verbatim in the POST body to the ``<Connect action>`` URL.
 */
export const PendingHandoffDataSchema = z.object({
  type: z.literal('end').default('end'),
  handoffData: z.string(),
});

export type PendingHandoffData = z.infer<typeof PendingHandoffDataSchema>;
