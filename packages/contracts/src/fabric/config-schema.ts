/**
 * ConfigSchema Types
 *
 * Typed configuration schema for capabilities.
 * ConfigSchema is the administration interface — it declares what
 * settings a capability accepts, their types, defaults, and constraints.
 *
 * @module @pwfabric/contracts/fabric/config-schema
 */

import type { ValidationResult } from '../core/result.js'

// ============================================================
// FIELD TYPES
// ============================================================

/**
 * Supported config field types for UI rendering and validation
 */
export type ConfigFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multi-select'
  | 'url'
  | 'email'
  | 'json'

/**
 * Option for select / multi-select fields
 */
export interface ConfigFieldOption {
  readonly value: string
  readonly label: string
  readonly description?: string
}

/**
 * Numeric and string constraints for field validation
 */
export interface ConfigFieldConstraints {
  readonly min?: number
  readonly max?: number
  readonly pattern?: string
  readonly patternMessage?: string
}

// ============================================================
// FIELD DEFINITION
// ============================================================

/**
 * A single configuration field definition.
 *
 * Provides enough information for both validation and UI rendering:
 * - `type` determines the input control
 * - `required` + `constraints` drive validation
 * - `label` + `description` + `group` drive UI layout
 * - `sensitive` masks the value in the UI
 */
export interface ConfigFieldDefinition {
  readonly key: string
  readonly type: ConfigFieldType
  readonly required: boolean
  readonly defaultValue?: unknown
  readonly label: string
  readonly description?: string
  readonly group?: string
  readonly order?: number
  readonly sensitive?: boolean
  readonly options?: readonly ConfigFieldOption[]
  readonly constraints?: ConfigFieldConstraints
}

// ============================================================
// CONFIG SCHEMA INTERFACE
// ============================================================

/**
 * ConfigSchema — the administration interface for a Capability.
 *
 * Just as a Contract defines execution (input/output),
 * ConfigSchema defines administration (what settings are accepted).
 */
export interface ConfigSchema<TConfig = Record<string, unknown>> {
  readonly fields: readonly ConfigFieldDefinition[]
  validate(data: unknown): ValidationResult<TConfig>
  applyDefaults(partial: Partial<TConfig>): TConfig
}
