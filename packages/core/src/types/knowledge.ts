import { z } from 'zod';

/**
 * Knowledge base status enum
 */
export const KnowledgeBaseStatusSchema = z.enum([
  'QUEUED',
  'PROVISIONING',
  'ACTIVE',
  'FAILED',
  'DELETING',
]);

export type KnowledgeBaseStatus = z.infer<typeof KnowledgeBaseStatusSchema>;

/**
 * Knowledge base metadata (from GET endpoint)
 */
export const KnowledgeBaseSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  status: KnowledgeBaseStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});

export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;

/**
 * Search result chunk (from POST search endpoint)
 */
export const KnowledgeChunkResultSchema = z.object({
  content: z.string(),
  knowledgeId: z.string(),
  createdAt: z.string(),
  score: z.number().optional(),
});

export type KnowledgeChunkResult = z.infer<typeof KnowledgeChunkResultSchema>;

/**
 * Search response wrapper
 */
export const KnowledgeSearchResponseSchema = z.object({
  chunks: z.array(KnowledgeChunkResultSchema),
});

export type KnowledgeSearchResponse = z.infer<typeof KnowledgeSearchResponseSchema>;
