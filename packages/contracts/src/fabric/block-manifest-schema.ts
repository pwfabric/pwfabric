/**
 * Block Manifest Schema
 *
 * Validation Ownership — API as Single Source of Truth
 *
 * Zod schema for pwfabric.manifest.json validation.
 * Exported from contracts so API, MCP servers, and SDK share
 * the same schema definition. MCP servers use this for offline fallback.
 *
 * @module @pwfabric/contracts/fabric/block-manifest-schema
 */

import { z } from 'zod'

export const blockManifestSchema = z.object({
  manifestVersion: z.literal(1),
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(128, 'Name must be at most 128 characters')
    .regex(
      /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9-]*$/,
      'Name must be lowercase kebab-case, optionally scoped (@scope/name)'
    ),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Version must be valid semver (e.g., 1.0.0)'),
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
  // `bundle` artifact type removed in favor of the unified pwpack
  // model (any artifact is a pwpack with content type block | starter |
  // capability — listing type is always `pwfpack`).
  type: z.enum(['block', 'starter', 'capability']),
  provides: z
    .object({
      blocks: z.array(z.string()).optional(),
      starters: z.array(z.string()).optional(),
      capabilities: z.array(z.string()).optional(),
    })
    .optional(),
  requires: z
    .object({
      blocks: z.array(z.string()).optional(),
      capabilities: z.array(z.string()).optional(),
    })
    .optional(),
  entryPoints: z.object({
    main: z.string(),
    renderer: z.string().optional(),
    editor: z.string().optional(),
    server: z.string().optional(),
  }),
  author: z
    .object({
      name: z.string(),
      email: z.string().email().optional(),
      url: z.string().url().optional(),
    })
    .optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  repository: z.string().optional(),
})

export type BlockManifest = z.infer<typeof blockManifestSchema>
