/**
 * Typed Output Factories
 *
 * Typed wrappers for BaseSurfaceOutput.data.
 * These do NOT modify @pwfabric/contracts. They extend the contract types
 * with narrowed data fields and provide factory functions that validate.
 *
 * @module @pwfabric/runtime/surface/output
 */

import { z } from 'zod'
import type { WebSurfaceOutput, ApiSurfaceOutput, CliSurfaceOutput } from '@pwfabric/contracts'

// ============================================================
// TYPED OUTPUT INTERFACES
// ============================================================

/**
 * Web output with narrowed data type
 */
export interface TypedWebOutput extends WebSurfaceOutput {
  readonly data: {
    readonly html: string
    readonly css?: string
    readonly head?: string
  }
}

/**
 * API output with narrowed data type
 */
export interface TypedApiOutput extends ApiSurfaceOutput {
  readonly data: {
    readonly json: unknown
    readonly status: number
  }
}

/**
 * CLI output with narrowed data type
 */
export interface TypedCliOutput extends CliSurfaceOutput {
  readonly data: {
    readonly formatted: string
    readonly raw?: unknown
  }
}

// ============================================================
// ZOD SCHEMAS
// ============================================================

const webOutputDataSchema = z.object({
  html: z.string(),
  css: z.string().optional(),
  head: z.string().optional(),
})

const apiOutputDataSchema = z.object({
  json: z.unknown(),
  status: z.number().int().min(100).max(599),
})

const cliOutputDataSchema = z.object({
  formatted: z.string(),
  raw: z.unknown().optional(),
})

// ============================================================
// VALIDATION RESULT
// ============================================================

/**
 * Result of creating a typed output
 */
export type OutputFactoryResult<T> =
  | { readonly success: true; readonly output: T }
  | { readonly success: false; readonly errors: readonly string[] }

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Create a validated TypedWebOutput.
 *
 * Validates the data shape and returns a typed output or errors.
 */
export function createWebOutput(options: {
  readonly data: { readonly html: string; readonly css?: string; readonly head?: string }
  readonly component?: unknown
  readonly html?: string
}): OutputFactoryResult<TypedWebOutput> {
  const dataResult = webOutputDataSchema.safeParse(options.data)

  if (!dataResult.success) {
    return {
      success: false,
      errors: dataResult.error.issues.map((i) => `data.${i.path.join('.')}: ${i.message}`),
    }
  }

  const data: TypedWebOutput['data'] = {
    html: dataResult.data.html,
    ...(dataResult.data.css !== undefined ? { css: dataResult.data.css } : {}),
    ...(dataResult.data.head !== undefined ? { head: dataResult.data.head } : {}),
  }

  const output: TypedWebOutput = {
    type: 'web',
    data,
    ...(options.component !== undefined ? { component: options.component } : {}),
    ...(options.html !== undefined ? { html: options.html } : {}),
  }

  return { success: true, output }
}

/**
 * Create a validated TypedApiOutput.
 *
 * Validates the data shape and returns a typed output or errors.
 */
export function createApiOutput(options: {
  readonly data: { readonly json: unknown; readonly status: number }
  readonly status: number
  readonly headers?: Record<string, string>
  readonly body?: unknown
}): OutputFactoryResult<TypedApiOutput> {
  const dataResult = apiOutputDataSchema.safeParse(options.data)

  if (!dataResult.success) {
    return {
      success: false,
      errors: dataResult.error.issues.map((i) => `data.${i.path.join('.')}: ${i.message}`),
    }
  }

  const data: TypedApiOutput['data'] = {
    json: dataResult.data.json,
    status: dataResult.data.status,
  }

  const output: TypedApiOutput = {
    type: 'api',
    data,
    status: options.status,
    body: options.body ?? null,
    ...(options.headers ? { headers: options.headers } : {}),
  }

  return { success: true, output }
}

/**
 * Create a validated TypedCliOutput.
 *
 * Validates the data shape and returns a typed output or errors.
 */
export function createCliOutput(options: {
  readonly data: { readonly formatted: string; readonly raw?: unknown }
  readonly exitCode: number
  readonly stdout?: string
  readonly stderr?: string
}): OutputFactoryResult<TypedCliOutput> {
  const dataResult = cliOutputDataSchema.safeParse(options.data)

  if (!dataResult.success) {
    return {
      success: false,
      errors: dataResult.error.issues.map((i) => `data.${i.path.join('.')}: ${i.message}`),
    }
  }

  const output: TypedCliOutput = {
    type: 'cli',
    data: dataResult.data,
    exitCode: options.exitCode,
    ...(options.stdout !== undefined && { stdout: options.stdout }),
    ...(options.stderr !== undefined && { stderr: options.stderr }),
  }

  return { success: true, output }
}
