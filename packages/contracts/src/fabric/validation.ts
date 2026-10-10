/**
 * Validation Contract Types
 *
 * Validation Ownership — API as Single Source of Truth
 *
 * Shared Zod schemas and TypeScript types for validation results.
 * Used by API (authoritative), SDK (client-side early feedback),
 * and MCP servers (offline fallback).
 *
 * @module @pwfabric/contracts/fabric/validation
 */

import { z } from 'zod'

// ============================================================
// VALIDATION ISSUE
// ============================================================

export const validationIssueSeverity = z.enum(['error', 'warning'])
export type ValidationIssueSeverity = z.infer<typeof validationIssueSeverity>

export const validationIssueSchema = z.object({
  severity: validationIssueSeverity,
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  suggestion: z.string().optional(),
})

export type ValidationIssue = z.infer<typeof validationIssueSchema>

// ============================================================
// VALIDATION RESULT
// ============================================================

export const fabricValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(validationIssueSchema),
  warnings: z.array(validationIssueSchema),
})

/** API validation response shape (errors[] + warnings[]). Distinct from core/result.ts ValidationResult<T>. */
export type FabricValidationResult = z.infer<typeof fabricValidationResultSchema>
