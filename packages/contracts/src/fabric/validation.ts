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

import type { z } from 'zod'
import type { fabricValidationResultSchema, validationIssueSchema, validationIssueSeverity } from './validation.schema.js'

// ============================================================
// VALIDATION ISSUE
// ============================================================

export type ValidationIssueSeverity = z.infer<typeof validationIssueSeverity>

export type ValidationIssue = z.infer<typeof validationIssueSchema>

// ============================================================
// VALIDATION RESULT
// ============================================================

/** API validation response shape (errors[] + warnings[]). Distinct from core/result.ts ValidationResult<T>. */
export type FabricValidationResult = z.infer<typeof fabricValidationResultSchema>
