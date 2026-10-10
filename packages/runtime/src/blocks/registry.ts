/**
 * Block Registry
 *
 * CP7: Central registry for block type definitions
 *
 * @module @pwfabric/core/blocks/registry
 */

import type { BlockDefinition, BlockCategory } from '@pwfabric/core'
// legacy first-party `BlockDefinition` imports moved
// to the `__test-fixtures__/block-fixtures.ts` module so this
// production registry file no longer pulls the 45 hardcoded blocks
// into its bundle. Block authoring is canonical in
// `pwpack-source/<pack>/.../component.tsx`; the runtime registry is
// populated per world via `getBlockRegistryForWorld` (browser) or
// `assembleCanonicalRegistry({installedBlocksOverride})` (server).
// Tests that need a populated singleton must explicitly import
// `populateTestBlocks` from the fixtures module.

// ============================================================
// BLOCK REGISTRY CLASS
// ============================================================

/**
 * Block Registry
 *
 * Manages registration and retrieval of block definitions.
 */
export class BlockRegistry {
  private readonly definitions = new Map<string, BlockDefinition>()

  /**
   * Register a block definition
   *
   * @param definition - Block definition to register
   * @throws Error if block type already registered
   */
  register(definition: BlockDefinition): void {
    if (this.definitions.has(definition.type)) {
      throw new Error(`Block type "${definition.type}" is already registered`)
    }
    this.definitions.set(definition.type, definition)
  }

  /**
   * Get a block definition by type
   *
   * @param type - Block type identifier
   * @returns Block definition or undefined
   */
  get(type: string): BlockDefinition | undefined {
    return this.definitions.get(type)
  }

  /**
   * Check if a block type is registered
   *
   * @param type - Block type identifier
   * @returns True if registered
   */
  has(type: string): boolean {
    return this.definitions.has(type)
  }

  /**
   * Get all registered block definitions
   *
   * @returns Array of all block definitions
   */
  list(): readonly BlockDefinition[] {
    return Array.from(this.definitions.values())
  }

  /**
   * Get block definitions by category
   *
   * @param category - Block category
   * @returns Array of block definitions in category
   */
  getByCategory(category: BlockCategory): readonly BlockDefinition[] {
    return this.list().filter((def) => def.category === category)
  }

  /**
   * Get all registered block types
   *
   * @returns Array of block type identifiers
   */
  types(): readonly string[] {
    return Array.from(this.definitions.keys())
  }

  /**
   * Unregister a block definition
   *
   * @param type - Block type identifier
   * @returns True if block was unregistered
   */
  unregister(type: string): boolean {
    return this.definitions.delete(type)
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.definitions.clear()
  }
}

// ============================================================
// REGISTRY SINGLETON
// ============================================================

/**
 * the default block registry is empty. Per-world content
 * comes through the dynamic install pipeline — see
 * `getBlockRegistryForWorld` (browser) / `loadInstalledBlocksForWorld`
 * (server). The empty singleton is kept for legacy callers that just
 * type-check against `BlockRegistry`; production code paths must NOT
 * depend on it being pre-populated.
 */
function createDefaultRegistry(): BlockRegistry {
  return new BlockRegistry()
}

/**
 * Default block registry singleton (intentionally empty post-).
 */
export const blockRegistry = createDefaultRegistry()

/**
 * Get the default block registry
 *
 * @returns The default block registry instance
 */
export function getBlockRegistry(): BlockRegistry {
  return blockRegistry
}

/**
 * Create a new block registry
 *
 * @param populate - Whether to populate with default blocks
 * @returns New block registry instance
 */
export function createBlockRegistry(populate = false): BlockRegistry {
  if (populate) {
    return createDefaultRegistry()
  }
  return new BlockRegistry()
}
