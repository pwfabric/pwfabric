/**
 * Contract Builder
 *
 * PHASE0-WS3: Fluent API for building contracts
 *
 * @module @pwfabric/core/contract-builder
 */

import type {
  Contract,
  ContractId,
  ContractMetadata,
  ContractState,
  ContractError,
  Schema,
  ValidationResult,
  SerializedContract,
  SemanticVersion,
} from '@pwfabric/contracts'
import {
  contractId,
  parseVersion,
  INITIAL_VERSION,
  ok,
  err,
  validationError,
} from '@pwfabric/contracts'

// ============================================================
// SIMPLE SCHEMA IMPLEMENTATION
// ============================================================

/**
 * Minimal schema implementation backed by a validator function.
 */
class SimpleSchema<T> implements Schema<T> {
  readonly definition
  private readonly validator: (data: unknown) => ValidationResult<T>

  constructor(
    definition: Schema<T>['definition'],
    validator: (data: unknown) => ValidationResult<T>
  ) {
    this.definition = definition
    this.validator = validator
  }

  validate(data: unknown): ValidationResult<T> {
    return this.validator(data)
  }

  parse(data: unknown): T {
    const result = this.validate(data)
    if (result.success) {
      return result.data
    }
    throw new Error(`Validation failed: ${JSON.stringify(result.error)}`)
  }

  safeParse(data: unknown): ValidationResult<T> {
    return this.validate(data)
  }

  toJsonSchema(): Record<string, unknown> {
    return { type: 'object' }
  }
}

/**
 * Create a schema that accepts any value
 */
export function anySchema<T = unknown>(): Schema<T> {
  return new SimpleSchema<T>({ type: 'unknown' }, (data) => ok(data as T))
}

/**
 * Create a schema that validates an object
 */
export function objectSchema<T extends Record<string, unknown>>(): Schema<T> {
  return new SimpleSchema<T>({ type: 'object', properties: {}, required: [] }, (data) => {
    if (typeof data !== 'object' || data === null) {
      return err([validationError([], 'Expected object', 'type_error')])
    }
    return ok(data as T)
  })
}

// ============================================================
// CONTRACT IMPLEMENTATION
// ============================================================

/**
 * Simple contract implementation
 */
class SimpleContract<TInput, TOutput, TError = ContractError> implements Contract<
  TInput,
  TOutput,
  TError
> {
  readonly id: ContractId
  readonly version: SemanticVersion
  readonly metadata: ContractMetadata
  readonly input: Schema<TInput>
  readonly output: Schema<TOutput>
  readonly errors: readonly Schema<TError>[]

  constructor(config: {
    id: ContractId
    version: SemanticVersion
    metadata: ContractMetadata
    input: Schema<TInput>
    output: Schema<TOutput>
    errors?: readonly Schema<TError>[]
  }) {
    this.id = config.id
    this.version = config.version
    this.metadata = config.metadata
    this.input = config.input
    this.output = config.output
    this.errors = config.errors ?? []
  }

  validateInput(data: unknown): ValidationResult<TInput> {
    return this.input.validate(data)
  }

  validateOutput(data: unknown): ValidationResult<TOutput> {
    return this.output.validate(data)
  }

  validateError(data: unknown): ValidationResult<TError> {
    for (const schema of this.errors) {
      const result = schema.validate(data)
      if (result.success) {
        return result
      }
    }
    return err([validationError([], 'Unknown error type', 'unknown_error')])
  }

  serialize(): SerializedContract {
    return {
      id: this.id,
      version: `${this.version.major}.${this.version.minor}.${this.version.patch}`,
      metadata: this.metadata,
      input: {
        version: '1.0.0',
        definition: this.input.definition,
        jsonSchema: this.input.toJsonSchema(),
      },
      output: {
        version: '1.0.0',
        definition: this.output.definition,
        jsonSchema: this.output.toJsonSchema(),
      },
      errors: this.errors.map((e) => ({
        version: '1.0.0',
        definition: e.definition,
        jsonSchema: e.toJsonSchema(),
      })),
    }
  }
}

// ============================================================
// CONTRACT BUILDER
// ============================================================

/**
 * Contract builder for fluent API
 */
export class ContractBuilder<TInput = unknown, TOutput = unknown> {
  private _id = ''
  private _version = '0.1.0'
  private _name = ''
  private _description?: string
  private _state: ContractState = 'draft'
  private _tags?: readonly string[]
  private _inputSchema: Schema<TInput> = anySchema<TInput>()
  private _outputSchema: Schema<TOutput> = anySchema<TOutput>()

  /**
   * Set the contract ID
   */
  id(id: string): this {
    this._id = id
    return this
  }

  /**
   * Set the contract version
   */
  version(version: string): this {
    this._version = version
    return this
  }

  /**
   * Set the contract name
   */
  name(name: string): this {
    this._name = name
    return this
  }

  /**
   * Set the contract description
   */
  description(description: string): this {
    this._description = description
    return this
  }

  /**
   * Set the contract state
   */
  state(state: ContractState): this {
    this._state = state
    return this
  }

  /**
   * Set the contract tags
   */
  tags(tags: readonly string[]): this {
    this._tags = tags
    return this
  }

  /**
   * Set the input schema
   */
  input<T>(schema: Schema<T>): ContractBuilder<T, TOutput> {
    const builder = this as unknown as ContractBuilder<T, TOutput>
    builder._inputSchema = schema as unknown as Schema<T>
    return builder
  }

  /**
   * Set the output schema
   */
  output<T>(schema: Schema<T>): ContractBuilder<TInput, T> {
    const builder = this as unknown as ContractBuilder<TInput, T>
    builder._outputSchema = schema as unknown as Schema<T>
    return builder
  }

  /**
   * Build the contract
   */
  build(): Contract<TInput, TOutput> {
    if (!this._id) {
      throw new Error('Contract ID is required')
    }
    if (!this._name) {
      throw new Error('Contract name is required')
    }

    const metadata: ContractMetadata = {
      name: this._name,
      state: this._state,
    }
    if (this._description !== undefined) {
      ;(metadata as { description?: string }).description = this._description
    }
    if (this._tags !== undefined) {
      ;(metadata as { tags?: readonly string[] }).tags = this._tags
    }

    return new SimpleContract<TInput, TOutput>({
      id: contractId(this._id),
      version: parseVersion(this._version) ?? INITIAL_VERSION,
      metadata,
      input: this._inputSchema,
      output: this._outputSchema,
    })
  }
}

/**
 * Create a new contract builder
 */
export function defineContract<TInput = unknown, TOutput = unknown>(): ContractBuilder<
  TInput,
  TOutput
> {
  return new ContractBuilder<TInput, TOutput>()
}
