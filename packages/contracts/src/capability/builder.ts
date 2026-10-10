/**
 * Capability Builder
 *
 * PHASE0-WS3: Fluent API for building capabilities
 *
 * Lives in the contracts package so that capability authors depend only on
 * the Apache-2.0 contract surface. `@pwfabric/core`
 * re-exports these names unchanged.
 *
 * @module @pwfabric/contracts/capability/builder
 */

import type { CapabilityId, DomainId } from '../core/ids.js'
import type { SemanticVersion } from '../core/version.js'
import type { Capability, CapabilityMetadata, CapabilityState } from '../fabric/capability.js'
import type { ConfigSchema } from '../fabric/config-schema.js'
import type { Contract } from '../fabric/contract.js'
import type { ExecutionContext } from '../fabric/execution.js'
import { capabilityId } from '../core/ids.js'
import { parseVersion, INITIAL_VERSION } from '../core/version.js'

// ============================================================
// CAPABILITY IMPLEMENTATION
// ============================================================

/**
 * Simple capability implementation
 */
class SimpleCapability<TInput, TOutput> implements Capability<CapabilityId, TInput, TOutput> {
  readonly id: CapabilityId
  readonly version: SemanticVersion
  readonly contract: Contract<TInput, TOutput>
  readonly dependencies: readonly CapabilityId[]
  readonly metadata: CapabilityMetadata
  readonly configSchema?: ConfigSchema | undefined

  private readonly executor: (input: TInput, context: ExecutionContext) => Promise<TOutput>

  constructor(config: {
    id: CapabilityId
    version: SemanticVersion
    contract: Contract<TInput, TOutput>
    dependencies: readonly CapabilityId[]
    metadata: CapabilityMetadata
    configSchema?: ConfigSchema | undefined
    execute: (input: TInput, context: ExecutionContext) => Promise<TOutput>
  }) {
    this.id = config.id
    this.version = config.version
    this.contract = config.contract
    this.dependencies = config.dependencies
    this.metadata = config.metadata
    if (config.configSchema !== undefined) {
      this.configSchema = config.configSchema
    }
    this.executor = config.execute
  }

  execute(input: TInput, context: ExecutionContext): Promise<TOutput> {
    return this.executor(input, context)
  }
}

// ============================================================
// CAPABILITY BUILDER
// ============================================================

/**
 * Capability builder for fluent API
 */
export class CapabilityBuilder<TInput = unknown, TOutput = unknown> {
  private _id = ''
  private _version = '0.1.0'
  private _name = ''
  private _description?: string
  private _state: CapabilityState = 'draft'
  private _domain?: DomainId
  private _tags?: readonly string[]
  private _timeout?: number
  private _retryable?: boolean
  private _idempotent?: boolean
  private _dependencies: CapabilityId[] = []
  private _contract?: Contract<TInput, TOutput>
  private _configSchema?: ConfigSchema
  private _executor?: (input: TInput, context: ExecutionContext) => Promise<TOutput>

  /**
   * Set the capability ID
   */
  id(id: string): this {
    this._id = id
    return this
  }

  /**
   * Set the capability version
   */
  version(version: string): this {
    this._version = version
    return this
  }

  /**
   * Set the capability name
   */
  name(name: string): this {
    this._name = name
    return this
  }

  /**
   * Set the capability description
   */
  description(description: string): this {
    this._description = description
    return this
  }

  /**
   * Set the capability state
   */
  state(state: CapabilityState): this {
    this._state = state
    return this
  }

  /**
   * Set the capability domain
   */
  domain(domain: DomainId): this {
    this._domain = domain
    return this
  }

  /**
   * Set the capability tags
   */
  tags(tags: readonly string[]): this {
    this._tags = tags
    return this
  }

  /**
   * Set the capability timeout
   */
  timeout(ms: number): this {
    this._timeout = ms
    return this
  }

  /**
   * Mark the capability as retryable
   */
  retryable(value = true): this {
    this._retryable = value
    return this
  }

  /**
   * Mark the capability as idempotent
   */
  idempotent(value = true): this {
    this._idempotent = value
    return this
  }

  /**
   * Add a dependency
   */
  dependsOn(id: string | CapabilityId): this {
    this._dependencies.push(typeof id === 'string' ? capabilityId(id) : id)
    return this
  }

  /**
   * Set the contract
   */
  contract<I, O>(contract: Contract<I, O>): CapabilityBuilder<I, O> {
    const builder = this as unknown as CapabilityBuilder<I, O>
    builder._contract = contract
    return builder
  }

  /**
   * Set the configuration schema
   */
  configSchema(schema: ConfigSchema): this {
    this._configSchema = schema
    return this
  }

  /**
   * Set the executor function
   */
  execute(fn: (input: TInput, context: ExecutionContext) => Promise<TOutput>): this {
    this._executor = fn
    return this
  }

  /**
   * Build the capability
   */
  build(): Capability<CapabilityId, TInput, TOutput> {
    if (!this._id) {
      throw new Error('Capability ID is required')
    }
    if (!this._name) {
      throw new Error('Capability name is required')
    }
    if (!this._contract) {
      throw new Error('Capability contract is required')
    }
    if (!this._executor) {
      throw new Error('Capability executor is required')
    }

    const metadata: CapabilityMetadata = {
      name: this._name,
      state: this._state,
    }
    if (this._description !== undefined) {
      ;(metadata as { description?: string }).description = this._description
    }
    if (this._domain !== undefined) {
      ;(metadata as { domain?: DomainId }).domain = this._domain
    }
    if (this._tags !== undefined) {
      ;(metadata as { tags?: readonly string[] }).tags = this._tags
    }
    if (this._timeout !== undefined) {
      ;(metadata as { timeout?: number }).timeout = this._timeout
    }
    if (this._retryable !== undefined) {
      ;(metadata as { retryable?: boolean }).retryable = this._retryable
    }
    if (this._idempotent !== undefined) {
      ;(metadata as { idempotent?: boolean }).idempotent = this._idempotent
    }

    return new SimpleCapability<TInput, TOutput>({
      id: capabilityId(this._id),
      version: parseVersion(this._version) ?? INITIAL_VERSION,
      contract: this._contract,
      dependencies: this._dependencies,
      metadata,
      ...(this._configSchema !== undefined ? { configSchema: this._configSchema } : {}),
      execute: this._executor,
    })
  }
}

/**
 * Create a new capability builder
 */
export function defineCapability<TInput = unknown, TOutput = unknown>(): CapabilityBuilder<
  TInput,
  TOutput
> {
  return new CapabilityBuilder<TInput, TOutput>()
}
