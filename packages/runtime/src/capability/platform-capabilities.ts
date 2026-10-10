/**
 * Platform Capability Definitions
 *
 * Canonical capability taxonomy.
 * - persistence replaces data + state (merged)
 * - interaction replaces behaviors (Tier 2)
 * - entities is the canonical form write path
 *
 * platform/auth phantom capability removed — real auth
 * enforcement lives in JWT middleware (requireAuthenticated()), not
 * the capability system.
 *
 * platform/input retired — form submissions flow through
 * platform/entities (entity_records), hard cutover, no fallback.
 *
 * Active capabilities: persistence, entities, navigation, interaction.
 *
 * @module @pwfabric/runtime/capability/platform-capabilities
 */

import {
  defineCapability,
  defineContract,
  defineConfigSchema,
  anySchema,
} from '@pwfabric/core'
import type { Capability } from '@pwfabric/contracts'
import type { CapabilityRegistry } from '../registry.js'
import { createDataService } from '../data/manager.js'

// ============================================================
// PASSTHROUGH CONTRACT
// ============================================================

/**
 * A passthrough contract for declaration-only capabilities.
 * Accepts any input and produces any output with no validation.
 * Used by: persistence, navigation, interaction, entities.
 */
const passthroughContract = defineContract()
  .id('platform/passthrough')
  .name('Platform Passthrough')
  .description('Passthrough contract for platform capability declarations')
  .state('stable')
  .input(anySchema())
  .output(anySchema())
  .build()

// ============================================================
// CONFIG SCHEMAS
// ============================================================

/**
 * persistenceConfigSchema merges former dataConfigSchema and stateConfigSchema.
 * data fields: defaultCacheTtl, maxRetries, timeout
 * state fields: persistenceEnabled, storageKey
 */
const persistenceConfigSchema = defineConfigSchema()
  .field('defaultCacheTtl', (f) =>
    f
      .number()
      .default(300)
      .label('Default Cache TTL')
      .description('Default cache time-to-live in seconds')
      .min(0)
      .max(86400)
  )
  .field('maxRetries', (f) =>
    f
      .number()
      .default(3)
      .label('Max Retries')
      .description('Maximum number of retry attempts for failed requests')
      .min(0)
      .max(10)
  )
  .field('timeout', (f) =>
    f
      .number()
      .default(5000)
      .label('Request Timeout')
      .description('Request timeout in milliseconds')
      .min(1000)
      .max(30000)
  )
  .field('persistenceEnabled', (f) =>
    f
      .boolean()
      .default(true)
      .label('Enable Persistence')
      .description('Persist state to local storage')
  )
  .field('storageKey', (f) =>
    f
      .string()
      .default('pwfabric-state')
      .label('Storage Key')
      .description('Local storage key prefix for persisted state')
  )
  .build()

const navigationConfigSchema = defineConfigSchema()
  .field('basePath', (f) =>
    f.string().default('/').label('Base Path').description('Base path prefix for all routes')
  )
  .field('trailingSlash', (f) =>
    f.boolean().default(false).label('Trailing Slash').description('Append trailing slash to URLs')
  )
  .build()

const interactionConfigSchema = defineConfigSchema()
  .field('executionMode', (f) =>
    f
      .select([
        {
          value: 'sync',
          label: 'Synchronous',
          description: 'Actions block the event chain until complete',
        },
        {
          value: 'async',
          label: 'Asynchronous',
          description: 'Actions run in background without blocking',
        },
      ])
      .default('async')
      .label('Execution Mode')
      .description('How behavior actions are executed when a trigger fires')
  )
  .field('maxConcurrent', (f) =>
    f
      .number()
      .default(5)
      .label('Max Concurrent')
      .description('Maximum number of behaviors that can execute simultaneously')
      .min(1)
      .max(20)
  )
  .field('errorPolicy', (f) =>
    f
      .select([
        { value: 'ignore', label: 'Ignore', description: 'Silently swallow errors' },
        {
          value: 'log',
          label: 'Log',
          description: 'Log errors to console without stopping execution',
        },
        { value: 'halt', label: 'Halt', description: 'Stop the behavior chain on first error' },
      ])
      .default('log')
      .label('Error Policy')
      .description('How errors in behavior actions are handled')
  )
  .field('debugMode', (f) =>
    f
      .boolean()
      .default(false)
      .label('Debug Mode')
      .description('Emit detailed trace events for behavior execution')
  )
  .build()

// ============================================================
// PLATFORM CAPABILITY DEFINITIONS
// ============================================================

/**
 * Persistence capability
 *
 * Merges former data + state capabilities.
 * Provides data fetching, mutation, persistence operations, and
 * client-side state management with optional local storage persistence.
 */
export const persistenceCapability = defineCapability()
  .id('platform/persistence')
  .name('Data & State Persistence')
  .description('Data fetching, mutation, persistence operations, and client-side state management')
  .version('1.0.0')
  .state('stable')
  .tags(['data', 'state', 'persistence', 'api'])
  .contract(passthroughContract)
  .configSchema(persistenceConfigSchema)
  .execute(async (config) => {
    const cfg = config as Record<string, unknown> | undefined
    return createDataService({
      ...(cfg?.defaultCacheTtl != null ? { defaultCacheTtl: cfg.defaultCacheTtl as number } : {}),
      ...(cfg?.maxRetries != null ? { maxRetries: cfg.maxRetries as number } : {}),
      ...(cfg?.timeout != null ? { timeout: cfg.timeout as number } : {}),
    })
  })
  .build()

/**
 * Navigation capability
 *
 * Provides multi-page surface navigation, base path configuration, and route handling.
 * Renamed from routingCapability (platform/routing) to avoid confusion with framework-level routing.
 */
export const navigationCapability = defineCapability()
  .id('platform/navigation')
  .name('Navigation')
  .description('Multi-page surface navigation, base path configuration, and route handling')
  .version('1.0.0')
  .state('stable')
  .tags(['navigation', 'routing', 'url'])
  .contract(passthroughContract)
  .configSchema(navigationConfigSchema)
  .execute(async (input) => {
    const data = input as Record<string, unknown> | undefined
    const path = (data?.path as string) ?? '/'
    const config = (data?.config as Record<string, unknown>) ?? {}
    const basePath = (config.basePath as string) ?? '/'
    const trailingSlash = (config.trailingSlash as boolean) ?? false
    let resolvedPath = path.startsWith(basePath) ? path : `${basePath}${path}`.replace(/\/+/g, '/')
    if (trailingSlash && !resolvedPath.endsWith('/')) resolvedPath += '/'
    else if (!trailingSlash && resolvedPath.length > 1 && resolvedPath.endsWith('/'))
      resolvedPath = resolvedPath.slice(0, -1)
    return { resolvedPath, params: {} }
  })
  .build()

/**
 * Interaction capability
 *
 * Replaces former behaviors capability.
 * Provides event-driven interaction rules for dynamic surfaces.
 */
export const interactionCapability = defineCapability()
  .id('platform/interaction')
  .name('Interaction Rules')
  .description(
    'Event-driven interaction rules — attach triggers and actions to surface events for interactive, dynamic surfaces'
  )
  .version('1.0.0')
  .state('stable')
  .tags(['interaction', 'events', 'automation'])
  .contract(passthroughContract)
  .configSchema(interactionConfigSchema)
  .execute(async () => ({ success: true }))
  .build()

/**
 * Entities capability — NEW Tier 1 capability.
 *
 * Schema-driven entity definitions, CRUD store, and connector abstraction.
 */
export const entitiesCapability = defineCapability()
  .id('platform/entities')
  .name('Entity System')
  .description('Schema-driven entity definitions, CRUD store, connector abstraction')
  .version('1.0.0')
  .state('stable')
  .tags(['entities', 'schema', 'crud'])
  .contract(passthroughContract)
  .configSchema(
    defineConfigSchema()
      .field('enableLifecycleHooks', (f) =>
        f
          .boolean()
          .default(true)
          .label('Enable Lifecycle Hooks')
          .description('Enable entity lifecycle hook callbacks')
      )
      .field('enableEventBridge', (f) =>
        f
          .boolean()
          .default(false)
          .label('Enable Event Bridge')
          .description('Emit entity events to the platform event bridge')
      )
      .build()
  )
  .execute(async () => ({ success: true }))
  .build()

// ============================================================
// AGGREGATE EXPORTS
// ============================================================

/**
 * All platform capabilities as an array.
 *
 * SOURCE OF TRUTH — derive all other lists from this array (see index.ts).
 * platform/auth removed (phantom capability).
 * routing renamed to navigation.
 * platform/input removed — form writes flow through platform/entities.
 */
export const platformCapabilities: readonly Capability[] = [
  persistenceCapability,
  entitiesCapability,
  navigationCapability,
  interactionCapability,
] as const

/**
 * Register all platform capabilities with a registry
 *
 * @param registry - The capability registry to register with
 * @returns An object with successfully registered IDs and any errors
 */
export function registerPlatformCapabilities(registry: CapabilityRegistry): {
  registered: readonly string[]
  errors: readonly { id: string; error: string }[]
} {
  const registered: string[] = []
  const errors: { id: string; error: string }[] = []

  for (const capability of platformCapabilities) {
    const result = registry.register(capability)
    if (result.success) {
      registered.push(capability.id)
    } else {
      errors.push({
        id: capability.id,
        error: result.error.type,
      })
    }
  }

  return { registered, errors }
}
