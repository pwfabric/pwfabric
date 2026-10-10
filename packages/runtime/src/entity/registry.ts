/**
 * Entity Registry
 *
 * Registration and lookup of entity definitions with Zod-based validation.
 *
 * @module @pwfabric/runtime/entity/registry
 */

import type {
  EntityTypeId,
  EntityDefinition,
  EntityValidationResult,
  EntityValidationError,
} from './types.js'

// ============================================================
// ENTITY REGISTRY INTERFACE
// ============================================================

/**
 * Registry for entity type definitions
 */
export interface EntityRegistry {
  /**
   * Register an entity definition
   * @throws Error if definition with the same id is already registered
   */
  register(definition: EntityDefinition): void

  /**
   * Get an entity definition by id
   */
  get(id: EntityTypeId): EntityDefinition | undefined

  /**
   * Check if an entity definition is registered
   */
  has(id: EntityTypeId): boolean

  /**
   * List all registered entity type ids
   */
  list(): readonly EntityTypeId[]

  /**
   * Validate data against an entity definition's Zod schema
   */
  validate(id: EntityTypeId, data: unknown): EntityValidationResult

  /**
   * Remove an entity definition
   */
  unregister(id: EntityTypeId): boolean

  /**
   * Remove all entity definitions
   */
  clear(): void
}

// ============================================================
// IN-MEMORY ENTITY REGISTRY
// ============================================================

/**
 * In-memory implementation of EntityRegistry
 */
export class InMemoryEntityRegistry implements EntityRegistry {
  private readonly definitions = new Map<EntityTypeId, EntityDefinition>()

  register(definition: EntityDefinition): void {
    if (!definition.id) {
      throw new Error('Entity definition must have an id')
    }

    if (!definition.name) {
      throw new Error('Entity definition must have a name')
    }

    if (!definition.schema) {
      throw new Error('Entity definition must have a schema')
    }

    if (!definition.primaryKey) {
      throw new Error('Entity definition must have a primaryKey')
    }

    if (this.definitions.has(definition.id)) {
      throw new Error(`Entity type '${definition.id}' is already registered`)
    }

    this.definitions.set(definition.id, definition)
  }

  get(id: EntityTypeId): EntityDefinition | undefined {
    return this.definitions.get(id)
  }

  has(id: EntityTypeId): boolean {
    return this.definitions.has(id)
  }

  list(): readonly EntityTypeId[] {
    return Array.from(this.definitions.keys())
  }

  validate(id: EntityTypeId, data: unknown): EntityValidationResult {
    const definition = this.definitions.get(id)
    if (!definition) {
      return {
        valid: false,
        errors: [
          {
            field: '_entity',
            message: `Entity type '${id}' is not registered`,
            code: 'entity_not_found',
          },
        ],
      }
    }

    const result = definition.schema.safeParse(data)

    if (result.success) {
      return {
        valid: true,
        data: result.data as Record<string, unknown>,
      }
    }

    const errors: EntityValidationError[] = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '_root',
      message: issue.message,
      code: issue.code,
    }))

    return {
      valid: false,
      errors,
    }
  }

  unregister(id: EntityTypeId): boolean {
    return this.definitions.delete(id)
  }

  clear(): void {
    this.definitions.clear()
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create an entity registry
 */
export function createEntityRegistry(): EntityRegistry {
  return new InMemoryEntityRegistry()
}
