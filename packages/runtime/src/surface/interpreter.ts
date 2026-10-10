/**
 * Surface JSON Interpreter
 *
 * Parse and validate Surface JSON definitions
 *
 * The interpreter converts Surface JSON into a validated Surface object
 * that can be rendered by the renderer.
 *
 * @module @pwfabric/runtime/surface/interpreter
 */

import type { SurfaceId, CapabilityId } from '@pwfabric/contracts'
import { surfaceId, capabilityId, parseVersion } from '@pwfabric/contracts'
import type { SurfaceJSON, LayoutJSON, BindingJSON, RenderContext } from './types.js'
import { createRenderContext } from './types.js'
import { validateLayout } from './layout.js'
import {
  manifestPropFindings,
  validateLayoutProps,
  type BlockPropsValidationOptions,
  type ManifestPropFinding,
} from './validation.js'
import type { EnvironmentType } from '@pwfabric/contracts'

// ============================================================
// INTERPRETATION TYPES
// ============================================================

/**
 * Interpreted surface
 */
export interface InterpretedSurface {
  readonly id: SurfaceId
  readonly version: string
  readonly environment: EnvironmentType
  readonly metadata: {
    readonly name: string
    readonly description?: string
    readonly tags?: readonly string[]
  }
  readonly bindings: Map<string, CapabilityId>
  readonly layout: LayoutJSON
}

/**
 * Interpretation result
 */
export type InterpretationResult =
  | {
      readonly success: true
      readonly surface: InterpretedSurface
      /**
       * Manifest findings when `validation.manifests` was supplied.
       * Warnings only: the surface is interpreted all the same.
       */
      readonly warnings?: readonly ManifestPropFinding[]
    }
  | { readonly success: false; readonly errors: readonly string[] }

// ============================================================
// SCHEMA VALIDATION
// ============================================================

/**
 * Validate Surface JSON structure
 */
function validateSurfaceJSON(json: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!json || typeof json !== 'object') {
    return { valid: false, errors: ['Surface JSON must be an object'] }
  }

  const obj = json as Record<string, unknown>

  // Required fields
  if (typeof obj.id !== 'string' || !obj.id) {
    errors.push('Surface must have a string id')
  }

  if (typeof obj.version !== 'string' || !obj.version) {
    errors.push('Surface must have a string version')
  }

  if (typeof obj.environment !== 'string' || !obj.environment) {
    errors.push('Surface must have a string environment')
  }

  // Validate environment
  const validEnvironments = ['web', 'api', 'cli', 'worker', 'edge', 'node', 'native', 'test']
  if (obj.environment && !validEnvironments.includes(obj.environment as string)) {
    errors.push(
      `Invalid environment: ${obj.environment}. Must be one of: ${validEnvironments.join(', ')}`
    )
  }

  // Validate layout
  if (!obj.layout || typeof obj.layout !== 'object') {
    errors.push('Surface must have a layout object')
  } else {
    const layoutResult = validateLayout(obj.layout as LayoutJSON)
    if (!layoutResult.valid) {
      errors.push(...layoutResult.errors.map((e) => `layout: ${e}`))
    }
  }

  // Validate bindings if present
  if (obj.bindings !== undefined) {
    if (!Array.isArray(obj.bindings)) {
      errors.push('bindings must be an array')
    } else {
      for (let i = 0; i < obj.bindings.length; i++) {
        const binding = obj.bindings[i] as Record<string, unknown>
        if (typeof binding.capability !== 'string') {
          errors.push(`bindings[${i}]: capability must be a string`)
        }
      }
    }
  }

  // Validate metadata if present
  if (obj.metadata !== undefined && typeof obj.metadata !== 'object') {
    errors.push('metadata must be an object')
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// INTERPRETER
// ============================================================

/**
 * Options for surface interpretation
 */
export interface InterpretSurfaceOptions {
  /**
   * Block props validation options.
   * Set to false to disable prop validation entirely.
   */
  readonly validation?: BlockPropsValidationOptions | false
}

/**
 * Interpret a Surface JSON definition
 */
export function interpretSurface(
  json: SurfaceJSON,
  options: InterpretSurfaceOptions = {}
): InterpretationResult {
  // Validate structure
  const validation = validateSurfaceJSON(json)
  if (!validation.valid) {
    return { success: false, errors: validation.errors }
  }

  // Parse version
  const version = parseVersion(json.version)
  if (!version) {
    return { success: false, errors: [`Invalid version format: ${json.version}`] }
  }

  // Validate block props if not disabled
  if (options.validation !== false) {
    const propIssues = validateLayoutProps(json.layout, options.validation ?? {})
    if (propIssues.length > 0) {
      const propErrors = propIssues.flatMap((issue) =>
        issue.errors.map((e) => `${issue.path} (${issue.type}): ${e}`)
      )
      return { success: false, errors: propErrors }
    }
  }

  // Build bindings map
  const bindings = new Map<string, CapabilityId>()
  if (json.bindings) {
    for (const binding of json.bindings) {
      const alias = binding.alias ?? binding.capability
      bindings.set(alias, capabilityId(binding.capability))
    }
  }

  // Build metadata with only defined properties
  const metadata: InterpretedSurface['metadata'] = {
    name: json.metadata?.name ?? json.id,
  }
  if (json.metadata?.description !== undefined) {
    ;(metadata as { description?: string }).description = json.metadata.description
  }
  if (json.metadata?.tags !== undefined) {
    ;(metadata as { tags?: readonly string[] }).tags = json.metadata.tags
  }

  // Build interpreted surface
  const surface: InterpretedSurface = {
    id: surfaceId(json.id),
    version: json.version,
    environment: json.environment as EnvironmentType,
    metadata,
    bindings,
    layout: json.layout,
  }

  const manifests = options.validation !== false ? options.validation?.manifests : undefined
  if (manifests) {
    const warnings = manifestPropFindings(json.layout, manifests)
    if (warnings.length > 0) return { success: true, surface, warnings }
  }
  return { success: true, surface }
}

/**
 * Parse Surface JSON from a string
 */
export function parseSurfaceJSON(jsonString: string): InterpretationResult {
  try {
    const json = JSON.parse(jsonString) as SurfaceJSON
    return interpretSurface(json)
  } catch (e) {
    return { success: false, errors: [`Invalid JSON: ${e}`] }
  }
}

// ============================================================
// SURFACE BUILDER
// ============================================================

/**
 * Surface builder for programmatic construction
 */
export class SurfaceBuilder {
  private _id: string
  private _version = '1.0.0'
  private _environment: EnvironmentType = 'web'
  private _metadata: { name?: string; description?: string; tags?: string[] } = {}
  private _bindings: BindingJSON[] = []
  private _layout: LayoutJSON | null = null
  private _validationOptions: BlockPropsValidationOptions | false = {}

  constructor(id: string) {
    this._id = id
  }

  version(v: string): this {
    this._version = v
    return this
  }

  environment(env: EnvironmentType): this {
    this._environment = env
    return this
  }

  name(n: string): this {
    this._metadata.name = n
    return this
  }

  description(d: string): this {
    this._metadata.description = d
    return this
  }

  tags(...t: string[]): this {
    this._metadata.tags = t
    return this
  }

  bind(capability: string, alias?: string): this {
    const binding: BindingJSON = alias ? { capability, alias } : { capability }
    this._bindings.push(binding)
    return this
  }

  layout(l: LayoutJSON): this {
    this._layout = l
    return this
  }

  /**
   * Configure block props validation.
   * Pass false to disable validation entirely.
   */
  validation(options: BlockPropsValidationOptions | false): this {
    this._validationOptions = options
    return this
  }

  build(): InterpretationResult {
    if (!this._layout) {
      return { success: false, errors: ['Surface must have a layout'] }
    }

    const json: SurfaceJSON = {
      id: this._id,
      version: this._version,
      environment: this._environment,
      metadata: this._metadata,
      bindings: this._bindings,
      layout: this._layout,
    }

    return interpretSurface(json, { validation: this._validationOptions })
  }
}

/**
 * Create a surface builder
 */
export function surface(id: string): SurfaceBuilder {
  return new SurfaceBuilder(id)
}

// ============================================================
// RENDER CONTEXT CREATION
// ============================================================

/**
 * Create a render context for an interpreted surface
 */
export function createSurfaceContext(
  surface: InterpretedSurface,
  data?: Record<string, unknown>
): RenderContext {
  return createRenderContext({
    surfaceId: surface.id,
    bindings: surface.bindings,
    data: data ?? {},
  })
}
