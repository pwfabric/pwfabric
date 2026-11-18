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

import type { z } from 'zod'
import type { blockManifestSchema } from './block-manifest-schema.schema.js'

export type BlockManifest = z.infer<typeof blockManifestSchema>
