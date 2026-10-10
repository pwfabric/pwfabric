/**
 * Fabric Kernel
 *
 * Runtime kernel for fabric orchestration
 *
 * The Fabric Kernel is the core runtime that manages capability
 * registration, dependency resolution, and execution lifecycle.
 *
 * @module @pwfabric/runtime/kernel
 */

import type {
  Fabric,
  FabricConfig,
  FabricState,
  FabricMetadata,
  FabricSnapshot,
  FabricId,
  CapabilityId,
  Capability,
  RegistrationResult,
  Resolution,
  ExecutionResult,
  ExecutionOptions,
  ExecutionError,
  SemanticVersion,
  Timestamp,
  EventBus,
} from '@pwfabric/contracts'
import {
  fabricId,
  parseVersion,
  INITIAL_VERSION,
  VALID_TRANSITIONS,
  DEFAULT_FABRIC_CONFIG,
  executionOk,
  executionErr,
} from '@pwfabric/contracts'

import { createRegistry, type CapabilityRegistry } from './registry.js'
import { createValidator, type ContractValidator, isValidationSuccess } from './validator.js'
import { createEventBus, createFabricEvent } from './bus.js'
import { createExecutionContext } from './execution-context.js'

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Build FabricMetadata from partial input
 */
function buildFabricMetadata(input?: Partial<FabricMetadata>): FabricMetadata {
  const result: {
    name: string
    description?: string
    tags?: readonly string[]
    environment?: string
  } = {
    name: input?.name ?? 'PWFabric',
  }
  if (input?.description !== undefined) {
    result.description = input.description
  }
  if (input?.tags !== undefined) {
    result.tags = input.tags
  }
  if (input?.environment !== undefined) {
    result.environment = input.environment
  }
  return result
}

// ============================================================
// FABRIC KERNEL IMPLEMENTATION
// ============================================================

/**
 * Fabric kernel implementation
 */
export class FabricKernel implements Fabric {
  readonly id: FabricId
  readonly version: SemanticVersion
  readonly metadata: FabricMetadata
  readonly createdAt: Timestamp

  private _state: FabricState = 'initializing'
  private readonly registry: CapabilityRegistry
  private readonly validator: ContractValidator
  private readonly eventBus: EventBus
  private readonly config: Required<FabricConfig>

  constructor(options: FabricConfig = {}) {
    this.id = fabricId(options.id ?? `fabric_${Date.now()}`)
    this.version = options.version
      ? (parseVersion(options.version) ?? INITIAL_VERSION)
      : INITIAL_VERSION

    // Build metadata with only defined properties
    this.metadata = buildFabricMetadata(options.metadata)

    this.createdAt = Date.now()

    // Build config
    this.config = {
      ...DEFAULT_FABRIC_CONFIG,
      ...options,
    } as Required<FabricConfig>

    this.registry = createRegistry()
    this.validator = createValidator()
    this.eventBus = createEventBus()

    // Transition to ready
    this.transitionState('ready')

    // Emit creation event
    this.eventBus.emit(
      createFabricEvent('fabric.created', {
        source: { fabricId: this.id },
        fabricId: this.id,
        version: `${this.version.major}.${this.version.minor}.${this.version.patch}`,
      })
    )
  }

  get state(): FabricState {
    return this._state
  }

  register<C extends Capability>(capability: C): RegistrationResult<C> {
    // Validate capability
    const validationResult = this.validator.validateCapability(capability)
    if (!isValidationSuccess(validationResult)) {
      return {
        success: false,
        error: {
          type: 'invalid_contract',
          id: capability.id,
          message: 'Capability validation failed',
        },
      }
    }

    // Register with registry
    const result = this.registry.register(capability)

    if (result.success) {
      this.eventBus.emit(
        createFabricEvent('capability.registered', {
          source: { fabricId: this.id, capabilityId: capability.id },
          capabilityId: capability.id,
          version: `${capability.version.major}.${capability.version.minor}.${capability.version.patch}`,
        })
      )
    }

    return result
  }

  resolve<C extends Capability>(id: CapabilityId): Resolution<C> {
    return this.registry.resolve<C>(id)
  }

  has(id: CapabilityId): boolean {
    return this.registry.has(id)
  }

  capabilities(): readonly CapabilityId[] {
    return this.registry.list()
  }

  async execute<TInput, TOutput>(
    id: CapabilityId,
    input: TInput,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult<TOutput>> {
    // Resolve capability
    const resolution = this.resolve(id)
    if (!resolution.found) {
      const error: ExecutionError = {
        type: 'capability_not_found',
        message: `Capability ${id} not found`,
        capabilityId: id,
      }
      return executionErr(error)
    }

    const capability = resolution.capability as Capability<CapabilityId, TInput, TOutput>

    // Validate input
    const inputValidation = capability.contract.validateInput(input)
    if (!inputValidation.success) {
      const error: ExecutionError = {
        type: 'validation_error',
        message: 'Input validation failed',
        capabilityId: id,
        cause: inputValidation.error,
      }
      return executionErr(error)
    }

    // Create execution context
    const timeout = options.timeout ?? this.config.defaultTimeout
    const contextOptions: Parameters<typeof createExecutionContext>[0] = {
      fabricId: this.id,
      timeout,
      invoker: async <I, O>(capId: CapabilityId, inp: I) => {
        return this.execute<I, O>(capId, inp, { timeout })
      },
    }
    if (options.contextData) {
      contextOptions.data = options.contextData
    }
    const context = createExecutionContext(contextOptions)

    // Emit execution started event
    this.eventBus.emit(
      createFabricEvent('capability.invoked', {
        source: { fabricId: this.id, capabilityId: id },
        capabilityId: id,
        traceId: context.traceId,
      })
    )

    const startTime = Date.now()

    try {
      // Execute with timeout
      const result = await Promise.race([
        capability.execute(inputValidation.data, context),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Execution timeout')), timeout)
        ),
      ])

      // Validate output
      const outputValidation = capability.contract.validateOutput(result)
      if (!outputValidation.success) {
        const error: ExecutionError = {
          type: 'contract_violation',
          message: 'Output validation failed',
          capabilityId: id,
          cause: outputValidation.error,
        }
        return executionErr(error)
      }

      const duration = Date.now() - startTime

      // Emit completion event
      this.eventBus.emit(
        createFabricEvent('capability.completed', {
          source: { fabricId: this.id, capabilityId: id },
          capabilityId: id,
          traceId: context.traceId,
          duration,
        })
      )

      return executionOk(outputValidation.data as TOutput)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      const executionError: ExecutionError = {
        type:
          error instanceof Error && error.message === 'Execution timeout'
            ? 'timeout'
            : 'execution_error',
        message: errorMessage,
        capabilityId: id,
        cause: error,
      }

      // Emit failure event
      this.eventBus.emit(
        createFabricEvent('capability.failed', {
          source: { fabricId: this.id, capabilityId: id },
          capabilityId: id,
          traceId: context.traceId,
          error: errorMessage,
        })
      )

      return executionErr(executionError)
    }
  }

  async start(): Promise<void> {
    this.transitionState('running')
    this.eventBus.emit(
      createFabricEvent('fabric.started', {
        source: { fabricId: this.id },
        fabricId: this.id,
      })
    )
  }

  async shutdown(): Promise<void> {
    this.transitionState('stopping')

    // Wait for any pending operations (in a real implementation)
    await new Promise((resolve) => setTimeout(resolve, 10))

    this.transitionState('stopped')
    this.eventBus.emit(
      createFabricEvent('fabric.stopped', {
        source: { fabricId: this.id },
        fabricId: this.id,
        reason: 'graceful_shutdown',
      })
    )
  }

  /**
   * Get a snapshot of the fabric state
   */
  getSnapshot(): FabricSnapshot {
    return {
      id: this.id,
      version: this.version,
      state: this._state,
      metadata: this.metadata,
      capabilities: this.registry.list(),
      timestamp: Date.now(),
    }
  }

  /**
   * Get the event bus for subscribing to events
   */
  getEventBus(): EventBus {
    return this.eventBus
  }

  private transitionState(newState: FabricState): void {
    const validTransitions = VALID_TRANSITIONS[this._state]
    if (!validTransitions.includes(newState)) {
      throw new Error(
        `Invalid state transition from ${this._state} to ${newState}. Valid transitions: ${validTransitions.join(', ')}`
      )
    }
    this._state = newState
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create a new Fabric instance
 */
export function createFabric(options?: FabricConfig): FabricKernel {
  return new FabricKernel(options)
}
