/**
 * ConfigSchema Builder
 *
 * Fluent API for building typed configuration schemas.
 *
 * Usage:
 * ```ts
 * const schema = defineConfigSchema<MyConfig>()
 *   .field('trackingId', f => f.string().required().label('Tracking ID'))
 *   .field('anonymize', f => f.boolean().default(false).label('Anonymize IPs'))
 *   .build()
 * ```
 *
 * @module @pwfabric/core/config-schema-builder
 */

import type {
  ConfigFieldConstraints,
  ConfigFieldDefinition,
  ConfigFieldOption,
  ConfigFieldType,
  ConfigSchema,
  ValidationResult,
} from '@pwfabric/contracts'
import { validationOk, validationErr, validationError } from '@pwfabric/contracts'

// ============================================================
// FIELD BUILDER
// ============================================================

export class FieldBuilder {
  private _type: ConfigFieldType = 'string'
  private _required = false
  private _defaultValue?: unknown
  private _label = ''
  private _description?: string
  private _sensitive?: boolean
  private _options?: ConfigFieldOption[]
  private _constraints?: ConfigFieldConstraints

  string(): this {
    this._type = 'string'
    return this
  }

  number(): this {
    this._type = 'number'
    return this
  }

  boolean(): this {
    this._type = 'boolean'
    return this
  }

  select(options: readonly (string | ConfigFieldOption)[]): this {
    this._type = 'select'
    this._options = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
    return this
  }

  multiSelect(options: readonly (string | ConfigFieldOption)[]): this {
    this._type = 'multi-select'
    this._options = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
    return this
  }

  url(): this {
    this._type = 'url'
    return this
  }

  email(): this {
    this._type = 'email'
    return this
  }

  json(): this {
    this._type = 'json'
    return this
  }

  required(): this {
    this._required = true
    return this
  }

  default(value: unknown): this {
    this._defaultValue = value
    return this
  }

  label(s: string): this {
    this._label = s
    return this
  }

  description(s: string): this {
    this._description = s
    return this
  }

  sensitive(): this {
    this._sensitive = true
    return this
  }

  min(n: number): this {
    this._constraints = { ...this._constraints, min: n }
    return this
  }

  max(n: number): this {
    this._constraints = { ...this._constraints, max: n }
    return this
  }

  pattern(s: string, msg?: string): this {
    this._constraints = { ...this._constraints, pattern: s }
    if (msg) {
      this._constraints = { ...this._constraints, patternMessage: msg }
    }
    return this
  }

  /** @internal */
  _build(key: string, group: string | undefined, order: number): ConfigFieldDefinition {
    const def: ConfigFieldDefinition = {
      key,
      type: this._type,
      required: this._required,
      label: this._label || key,
      ...(this._defaultValue !== undefined ? { defaultValue: this._defaultValue } : {}),
      ...(this._description !== undefined ? { description: this._description } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(order !== 0 ? { order } : {}),
      ...(this._sensitive === true ? { sensitive: true } : {}),
      ...(this._options !== undefined ? { options: this._options } : {}),
      ...(this._constraints !== undefined ? { constraints: this._constraints } : {}),
    }
    return def
  }
}

// ============================================================
// SCHEMA BUILDER
// ============================================================

interface PendingField {
  key: string
  factory: (f: FieldBuilder) => FieldBuilder
  group?: string
}

export class ConfigSchemaBuilder<TConfig = Record<string, unknown>> {
  private _fields: PendingField[] = []

  field(key: string, factory: (f: FieldBuilder) => FieldBuilder): this {
    this._fields.push({ key, factory })
    return this
  }

  group(name: string, groupFn: (g: ConfigSchemaGroupBuilder) => void): this {
    const gb = new ConfigSchemaGroupBuilder(name)
    groupFn(gb)
    this._fields.push(...gb._getFields())
    return this
  }

  build(): ConfigSchema<TConfig> {
    const fields: ConfigFieldDefinition[] = this._fields.map((pf, idx) => {
      const fb = new FieldBuilder()
      pf.factory(fb)
      return fb._build(pf.key, pf.group, idx)
    })
    return new SimpleConfigSchema<TConfig>(fields)
  }
}

class ConfigSchemaGroupBuilder {
  private _fields: PendingField[] = []
  private readonly _name: string

  constructor(name: string) {
    this._name = name
  }

  field(key: string, factory: (f: FieldBuilder) => FieldBuilder): this {
    this._fields.push({ key, factory, group: this._name })
    return this
  }

  /** @internal */
  _getFields(): PendingField[] {
    return this._fields
  }
}

// ============================================================
// SIMPLE CONFIG SCHEMA IMPLEMENTATION
// ============================================================

export class SimpleConfigSchema<
  TConfig = Record<string, unknown>,
> implements ConfigSchema<TConfig> {
  readonly fields: readonly ConfigFieldDefinition[]

  constructor(fields: ConfigFieldDefinition[]) {
    this.fields = fields
  }

  validate(data: unknown): ValidationResult<TConfig> {
    const errors: { path: string[]; message: string; code: string }[] = []
    const record = (typeof data === 'object' && data !== null ? data : {}) as Record<
      string,
      unknown
    >

    for (const field of this.fields) {
      const value = record[field.key]

      if (value === undefined || value === null || value === '') {
        if (field.required && field.defaultValue === undefined) {
          errors.push(validationError([field.key], `${field.label} is required`, 'required'))
        }
        continue
      }

      // Type validation
      const typeError = this.validateType(field, value)
      if (typeError) {
        errors.push(validationError([field.key], typeError, 'type'))
        continue
      }

      // Constraint validation
      if (field.constraints) {
        const constraintError = this.validateConstraints(field, value)
        if (constraintError) {
          errors.push(validationError([field.key], constraintError, 'constraint'))
        }
      }
    }

    if (errors.length > 0) {
      return validationErr(errors)
    }
    return validationOk(record as TConfig)
  }

  applyDefaults(partial: Partial<TConfig>): TConfig {
    const result = { ...partial } as Record<string, unknown>
    for (const field of this.fields) {
      if (result[field.key] === undefined && field.defaultValue !== undefined) {
        result[field.key] = field.defaultValue
      }
    }
    return result as TConfig
  }

  private validateType(field: ConfigFieldDefinition, value: unknown): string | null {
    switch (field.type) {
      case 'string':
      case 'url':
      case 'email':
      case 'json':
        if (typeof value !== 'string') {
          return `${field.label} must be a string`
        }
        break
      case 'number':
        if (typeof value !== 'number') {
          return `${field.label} must be a number`
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          return `${field.label} must be a boolean`
        }
        break
      case 'select':
        if (typeof value !== 'string') {
          return `${field.label} must be a string`
        }
        if (field.options && !field.options.some((o) => o.value === value)) {
          return `${field.label} must be one of: ${field.options.map((o) => o.value).join(', ')}`
        }
        break
      case 'multi-select':
        if (!Array.isArray(value)) {
          return `${field.label} must be an array`
        }
        if (field.options) {
          const valid = new Set(field.options.map((o) => o.value))
          for (const v of value) {
            if (typeof v !== 'string' || !valid.has(v)) {
              return `${field.label} contains invalid option: ${String(v)}`
            }
          }
        }
        break
    }
    return null
  }

  private validateConstraints(field: ConfigFieldDefinition, value: unknown): string | null {
    const c = field.constraints
    if (!c) return null

    if (typeof value === 'number') {
      if (c.min !== undefined && value < c.min) {
        return `${field.label} must be at least ${String(c.min)}`
      }
      if (c.max !== undefined && value > c.max) {
        return `${field.label} must be at most ${String(c.max)}`
      }
    }

    if (typeof value === 'string' && c.pattern) {
      if (!new RegExp(c.pattern).test(value)) {
        return c.patternMessage ?? `${field.label} does not match the required pattern`
      }
    }

    return null
  }
}

// ============================================================
// ENTRY POINT
// ============================================================

export function defineConfigSchema<
  TConfig = Record<string, unknown>,
>(): ConfigSchemaBuilder<TConfig> {
  return new ConfigSchemaBuilder<TConfig>()
}
