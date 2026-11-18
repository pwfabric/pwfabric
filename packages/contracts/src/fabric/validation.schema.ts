/**
 * The zod schemas of `validation.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'

export const validationIssueSeverity = z.enum(['error', 'warning'])

export const validationIssueSchema = z.object({
  severity: validationIssueSeverity,
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  suggestion: z.string().optional(),
})

export const fabricValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(validationIssueSchema),
  warnings: z.array(validationIssueSchema),
})
