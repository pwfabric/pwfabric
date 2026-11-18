/**
 * Surface Document Zod Schemas
 *
 * SurfaceDocument Canonical Type System
 * Validation Ownership — API as Single Source of Truth
 * Surface Architecture Consolidation (theme+layout+styleVariables →
 *          ui-appearance atom ref; dataSources+initialState → platform/persistence
 *          capability config)
 *
 * These schemas live in contracts so they can be shared by an API
 * (authoritative enforcement), a client SDK (early feedback) and MCP servers
 * (offline fallback).
 *
 * @module @pwfabric/contracts/fabric/surface-schema
 */

import type { z } from 'zod'
import type { surfaceActionSchema, surfaceBehaviorSchema, surfaceDocumentSchema } from './surface-schema.schema.js'

// ============================================================
// BLOCK SNAPSHOT SCHEMA
// ============================================================

/**
 * Recursive Zod schema for a block snapshot.
 *
 * Uses z.lazy() to handle the recursive children field.
 * The type annotation is ZodType<any> because the recursive
 * definition makes TypeScript inference impractical.
 */
// ============================================================

// ============================================================

// ============================================================

export type SurfaceActionDecl = z.infer<typeof surfaceActionSchema>

export type SurfaceBehaviorDecl = z.infer<typeof surfaceBehaviorSchema>

// ============================================================
// CAPABILITY BINDING SCHEMA
// ============================================================

// ============================================================

export type SurfaceDocumentInput = z.infer<typeof surfaceDocumentSchema>

// ============================================================
// DUPLICATE BLOCK IDS (opt-in validator — the document schema is a contract)
// ============================================================

/** One block id that appears more than once in a surface, with every path it sits at. */
export interface DuplicateBlockId {
  readonly id: string
  /** Zod-style paths, e.g. `['blocks', 2, 'id']` or `['blocks', 1, 'children', 0, 'id']`. */
  readonly paths: readonly (string | number)[][]
}

/**
 * Walk a block tree (children included) and name every id that is used by
 * more than one block, in first-seen order.
 *
 * WHY A SEPARATE FUNCTION. Two blocks sharing an id render twice (React keys
 * on it) — the same band shows up twice. `surfaceDocumentSchema` is a
 * published contract: tightening it would make every stored document
 * that happens to carry a repeat fail to parse on read. So the schema stays,
 * and a caller that WRITES a document (publish, validate, import)
 * opts into this check — or into `surfaceDocumentStrictSchema` below.
 */
export function findDuplicateBlockIds(blocks: unknown): DuplicateBlockId[] {
  const seen = new Map<string, (string | number)[][]>()
  const walk = (list: unknown, path: (string | number)[]): void => {
    if (!Array.isArray(list)) return
    list.forEach((block, index) => {
      if (!block || typeof block !== 'object') return
      const b = block as { id?: unknown; children?: unknown }
      if (typeof b.id === 'string' && b.id !== '') {
        const paths = seen.get(b.id) ?? []
        paths.push([...path, index, 'id'])
        seen.set(b.id, paths)
      }
      walk(b.children, [...path, index, 'children'])
    })
  }
  walk(blocks, ['blocks'])
  const out: DuplicateBlockId[] = []
  for (const [id, paths] of seen) if (paths.length > 1) out.push({ id, paths })
  return out
}

/** Throw when any block id repeats within the tree; the message names each repeated id. */
export function assertUniqueBlockIds(blocks: unknown): void {
  const dups = findDuplicateBlockIds(blocks)
  if (dups.length === 0) return
  throw new Error(
    `Duplicate block id${dups.length > 1 ? 's' : ''}: ${dups.map((d) => `'${d.id}' x${d.paths.length}`).join(', ')}`
  )
}

