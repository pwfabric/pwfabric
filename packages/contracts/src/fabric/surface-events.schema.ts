/**
 * The zod schemas of `surface-events.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'

/**
 * Zod payload schemas for known event types.
 * Used for dev-mode validation only — no runtime enforcement in prod.
 */
export const SURFACE_EVENT_PAYLOAD_SCHEMAS = {
  'form:submit': z.object({
    values: z.record(z.string(), z.any()),
    formId: z.string(),
    timestamp: z.number(),
  }),
  'form:change': z.object({
    field: z.string(),
    value: z.any().optional(),
    formId: z.string(),
  }),
  'input:change': z.object({
    value: z.any().optional(),
    inputId: z.string(),
    validationResult: z
      .object({
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  'entity:created': z.object({
    entityType: z.string(),
    instanceId: z.string(),
    data: z.record(z.string(), z.any()),
    timestamp: z.number(),
  }),
  'entity:updated': z.object({
    entityType: z.string(),
    instanceId: z.string(),
    data: z.record(z.string(), z.any()),
    changeset: z.record(z.string(), z.any()).optional(),
    timestamp: z.number(),
  }),
  'entity:deleted': z.object({
    entityType: z.string(),
    instanceId: z.string(),
    timestamp: z.number(),
  }),
} as const
