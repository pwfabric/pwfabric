/**
 * Surface Definition
 *
 * PHASE0-WS1: Presentation adapters for capabilities
 *
 * A Surface is a presentation adapter that consumes capabilities
 * and exposes them to a specific environment (UI, API, CLI, etc.).
 *
 * INVARIANTS:
 * - A Surface does NOT define business logic
 * - A Surface adapts capability inputs/outputs to environment-specific formats
 * - A Surface is bound to exactly one environment type
 * - A Surface depends on capabilities through their contracts only
 * - Multiple Surfaces can consume the same capability
 *
 * @module @pwfabric/contracts/fabric/surface
 */

import type { CapabilityId, SurfaceId } from '../core/ids.js'
import type { SemanticVersion } from '../core/version.js'
import type { Capability } from './capability.js'

// ============================================================
// ENVIRONMENT TYPES
// ============================================================

/**
 * Supported environment types
 */
export type EnvironmentType =
  | 'web' // Browser-based UI
  | 'api' // HTTP API
  | 'cli' // Command-line interface
  | 'worker' // Web Worker / Service Worker
  | 'edge' // Edge runtime (Cloudflare Workers, etc.)
  | 'node' // Node.js server
  | 'native' // Native mobile/desktop
  | 'test' // Test environment

/**
 * Environment descriptor with additional context
 */
export interface EnvironmentDescriptor {
  readonly type: EnvironmentType
  readonly platform?: string
  readonly version?: string
  readonly features?: readonly string[]
}

// ============================================================
// SURFACE METADATA
// ============================================================

/**
 * Surface metadata
 */
export interface SurfaceMetadata {
  readonly name: string
  readonly description?: string
  readonly tags?: readonly string[]
}

// ============================================================
// CAPABILITY BINDING
// ============================================================

/**
 * Binding configuration for a capability on a surface
 */
export interface CapabilityBinding {
  readonly capabilityId: CapabilityId
  readonly alias?: string
  readonly transform?: BindingTransform
}

/**
 * Transform configuration for input/output
 */
export interface BindingTransform {
  readonly input?: TransformDescriptor
  readonly output?: TransformDescriptor
}

/**
 * Transform descriptor
 */
export interface TransformDescriptor {
  readonly type: 'map' | 'filter' | 'pick' | 'omit' | 'custom'
  readonly config?: Record<string, unknown>
}

// ============================================================
// SURFACE BINDING RESULT
// ============================================================

/**
 * Result of binding a capability to a surface
 */
export interface SurfaceBinding<C extends Capability> {
  readonly capabilityId: CapabilityId
  readonly capability: C
  readonly alias?: string
}

// ============================================================
// SURFACE CONTEXT
// ============================================================

/**
 * Context provided to surface rendering
 */
export interface SurfaceContext<TEnv extends EnvironmentType = EnvironmentType> {
  readonly environment: TEnv
  readonly bindings: readonly CapabilityBinding[]
  readonly data?: Record<string, unknown>
}

// ============================================================
// SURFACE OUTPUT
// ============================================================

/**
 * Output type varies by environment
 */
export type SurfaceOutput<TEnv extends EnvironmentType> = TEnv extends 'web'
  ? WebSurfaceOutput
  : TEnv extends 'api'
    ? ApiSurfaceOutput
    : TEnv extends 'cli'
      ? CliSurfaceOutput
      : BaseSurfaceOutput

/**
 * Base surface output
 */
export interface BaseSurfaceOutput {
  readonly type: string
  readonly data: unknown
}

/**
 * Web surface output (React component, HTML, etc.)
 */
export interface WebSurfaceOutput extends BaseSurfaceOutput {
  readonly type: 'web'
  readonly component?: unknown
  readonly html?: string
}

/**
 * API surface output (HTTP response shape)
 */
export interface ApiSurfaceOutput extends BaseSurfaceOutput {
  readonly type: 'api'
  readonly status: number
  readonly headers?: Record<string, string>
  readonly body: unknown
}

/**
 * CLI surface output
 */
export interface CliSurfaceOutput extends BaseSurfaceOutput {
  readonly type: 'cli'
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode: number
}

// ============================================================
// SURFACE INTERFACE
// ============================================================

/**
 * Surface interface
 *
 * Type Parameter:
 * - TEnv: The environment type this surface targets
 */
export interface Surface<TEnv extends EnvironmentType = EnvironmentType> {
  /**
   * Unique surface identifier
   */
  readonly id: SurfaceId

  /**
   * Surface version
   */
  readonly version: SemanticVersion

  /**
   * Target environment
   */
  readonly environment: TEnv

  /**
   * Surface metadata
   */
  readonly metadata: SurfaceMetadata

  /**
   * Bound capabilities
   */
  readonly capabilities: readonly CapabilityBinding[]

  /**
   * Bind a capability to this surface
   */
  bind<C extends Capability>(capability: C, config?: Partial<CapabilityBinding>): SurfaceBinding<C>

  /**
   * Render the surface output
   */
  render(context: SurfaceContext<TEnv>): Promise<SurfaceOutput<TEnv>>
}

// ============================================================
// SURFACE DESCRIPTOR
// ============================================================

/**
 * Surface descriptor for creation
 */
export interface SurfaceDescriptor<TEnv extends EnvironmentType = EnvironmentType> {
  readonly id: string
  readonly version: string
  readonly environment: TEnv
  readonly metadata: SurfaceMetadata
  readonly capabilities?: readonly CapabilityBinding[]
}
