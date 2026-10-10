/**
 * PWFabric — Executable Proof
 *
 * This file demonstrates that the Fabric architecture is not just an idea - it runs.
 *
 * It shows:
 * 1. A contract definition
 * 2. A capability implementation
 * 3. Fabric creation and capability registration
 * 4. Capability execution with validation
 * 5. Verifiable state change
 *
 * Run with: npx tsx examples/proof.ts
 *
 * @module @pwfabric/runtime/examples/proof
 */

/* eslint-disable no-console */

import {
  createFabric,
  type Capability,
  type Contract,
  type CapabilityId,
  type SemanticVersion,
  type CapabilityMetadata,
  type ContractMetadata,
  type ExecutionContext,
  type ValidationResult,
  type Schema,
  type SerializedContract,
  capabilityId,
  contractId,
  ok,
  err,
  validationError,
} from '../src/index.js'

// ============================================================
// STEP 1: DEFINE A CONTRACT
// ============================================================

console.log('=== PWFabric Executable Proof ===\n')
console.log('STEP 1: Defining a contract...')

/**
 * Simple schema that validates greeting input
 */
class GreetingInputSchema implements Schema<{ name: string }> {
  readonly definition = {
    type: 'object' as const,
    properties: {
      name: { type: 'string' as const },
    },
    required: ['name'],
  }

  validate(data: unknown): ValidationResult<{ name: string }> {
    if (typeof data !== 'object' || data === null) {
      return err([validationError([], 'Expected object', 'type_error')])
    }
    const obj = data as Record<string, unknown>
    if (typeof obj.name !== 'string') {
      return err([validationError(['name'], 'Name must be a string', 'type_error')])
    }
    if (obj.name.length === 0) {
      return err([validationError(['name'], 'Name cannot be empty', 'validation_error')])
    }
    return ok({ name: obj.name })
  }

  parse(data: unknown): { name: string } {
    const result = this.validate(data)
    if (result.success) return result.data
    throw new Error('Validation failed')
  }

  safeParse(data: unknown): ValidationResult<{ name: string }> {
    return this.validate(data)
  }

  toJsonSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }
  }
}

/**
 * Simple schema that validates greeting output
 */
class GreetingOutputSchema implements Schema<{ message: string; timestamp: number }> {
  readonly definition = {
    type: 'object' as const,
    properties: {
      message: { type: 'string' as const },
      timestamp: { type: 'number' as const },
    },
    required: ['message', 'timestamp'],
  }

  validate(data: unknown): ValidationResult<{ message: string; timestamp: number }> {
    if (typeof data !== 'object' || data === null) {
      return err([validationError([], 'Expected object', 'type_error')])
    }
    const obj = data as Record<string, unknown>
    if (typeof obj.message !== 'string') {
      return err([validationError(['message'], 'Message must be a string', 'type_error')])
    }
    if (typeof obj.timestamp !== 'number') {
      return err([validationError(['timestamp'], 'Timestamp must be a number', 'type_error')])
    }
    return ok({ message: obj.message, timestamp: obj.timestamp })
  }

  parse(data: unknown): { message: string; timestamp: number } {
    const result = this.validate(data)
    if (result.success) return result.data
    throw new Error('Validation failed')
  }

  safeParse(data: unknown): ValidationResult<{ message: string; timestamp: number }> {
    return this.validate(data)
  }

  toJsonSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        message: { type: 'string' },
        timestamp: { type: 'number' },
      },
      required: ['message', 'timestamp'],
    }
  }
}

/**
 * The greeting contract
 */
const greetingContract: Contract<{ name: string }, { message: string; timestamp: number }> = {
  id: contractId('greeting/say-hello'),
  version: { major: 1, minor: 0, patch: 0 } as SemanticVersion,
  metadata: {
    name: 'Say Hello',
    description: 'A simple greeting contract',
    state: 'stable',
  } as ContractMetadata,
  input: new GreetingInputSchema(),
  output: new GreetingOutputSchema(),
  errors: [],

  validateInput(data: unknown) {
    return this.input.validate(data)
  },

  validateOutput(data: unknown) {
    return this.output.validate(data)
  },

  validateError(_data: unknown) {
    return err([validationError([], 'No errors defined', 'unknown_error')])
  },

  serialize(): SerializedContract {
    return {
      id: this.id,
      version: '1.0.0',
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
      errors: [],
    }
  },
}

console.log(`  Contract ID: ${greetingContract.id}`)
console.log(
  `  Contract Version: ${greetingContract.version.major}.${greetingContract.version.minor}.${greetingContract.version.patch}`
)
console.log('  Contract defined successfully!\n')

// ============================================================
// STEP 2: IMPLEMENT A CAPABILITY
// ============================================================

console.log('STEP 2: Implementing a capability...')

/**
 * Track execution count as state
 */
let executionCount = 0

/**
 * The greeting capability
 */
const greetingCapability: Capability<
  CapabilityId,
  { name: string },
  { message: string; timestamp: number }
> = {
  id: capabilityId('greeting/say-hello'),
  version: { major: 1, minor: 0, patch: 0 } as SemanticVersion,
  contract: greetingContract,
  dependencies: [],
  metadata: {
    name: 'Say Hello Capability',
    description: 'Generates a greeting message',
    state: 'stable',
  } as CapabilityMetadata,

  async execute(
    input: { name: string },
    context: ExecutionContext
  ): Promise<{ message: string; timestamp: number }> {
    context.logger.info(`Executing greeting for: ${input.name}`)

    // Increment execution count (demonstrating state change)
    executionCount++

    // Generate greeting
    const message = `Hello, ${input.name}! Welcome to PWFabric.`
    const timestamp = Date.now()

    context.logger.info(`Generated greeting: ${message}`)

    return { message, timestamp }
  },
}

console.log(`  Capability ID: ${greetingCapability.id}`)
console.log(
  `  Capability Version: ${greetingCapability.version.major}.${greetingCapability.version.minor}.${greetingCapability.version.patch}`
)
console.log('  Capability implemented successfully!\n')

// ============================================================
// STEP 3: CREATE FABRIC AND REGISTER CAPABILITY
// ============================================================

console.log('STEP 3: Creating fabric and registering capability...')

const fabric = createFabric({
  id: 'proof-fabric',
  version: '0.1.0',
  metadata: {
    name: 'Proof of Concept Fabric',
    description: 'Demonstrates the PWFabric runtime',
  },
})

console.log(`  Fabric ID: ${fabric.id}`)
console.log(`  Fabric State: ${fabric.state}`)

const registrationResult = fabric.register(greetingCapability)
if (registrationResult.success) {
  console.log(`  Capability registered: ${greetingCapability.id}`)
} else {
  console.error('  Registration failed:', registrationResult.error)
  process.exit(1)
}

console.log(`  Total capabilities: ${fabric.capabilities().length}`)
console.log('  Fabric ready!\n')

// ============================================================
// STEP 4: EXECUTE CAPABILITY
// ============================================================

console.log('STEP 4: Executing capability...')
console.log(`  Initial execution count: ${executionCount}`)

async function runProof(): Promise<void> {
  // Start the fabric
  await fabric.start()
  console.log(`  Fabric state after start: ${fabric.state}`)

  // Execute the capability
  const result = await fabric.execute<{ name: string }, { message: string; timestamp: number }>(
    capabilityId('greeting/say-hello'),
    { name: 'Proof' }
  )

  if (result.success) {
    console.log('\n  Execution successful!')
    console.log(`  Message: ${result.data.message}`)
    console.log(`  Timestamp: ${new Date(result.data.timestamp).toISOString()}`)
  } else {
    console.error('\n  Execution failed:', result.error)
    process.exit(1)
  }

  // ============================================================
  // STEP 5: VERIFY STATE CHANGE
  // ============================================================

  console.log('\nSTEP 5: Verifying state change...')
  console.log(`  Final execution count: ${executionCount}`)

  if (executionCount === 1) {
    console.log('  State change verified: execution count incremented from 0 to 1')
  } else {
    console.error('  State change verification failed!')
    process.exit(1)
  }

  // Execute again to demonstrate repeatability
  const result2 = await fabric.execute<{ name: string }, { message: string; timestamp: number }>(
    capabilityId('greeting/say-hello'),
    { name: 'Engineer' }
  )

  if (result2.success) {
    console.log(`\n  Second execution successful!`)
    console.log(`  Message: ${result2.data.message}`)
    console.log(`  Final execution count: ${executionCount}`)
  }

  // Test validation (with invalid input)
  console.log('\nSTEP 6: Testing contract validation...')
  const invalidResult = await fabric.execute<
    { name: string },
    { message: string; timestamp: number }
  >(
    capabilityId('greeting/say-hello'),
    { name: '' } // Empty name should fail validation
  )

  if (!invalidResult.success) {
    console.log('  Validation correctly rejected empty name')
    console.log(`  Error type: ${invalidResult.error.type}`)
  } else {
    console.error('  Validation should have failed!')
    process.exit(1)
  }

  // Shutdown
  await fabric.shutdown()
  console.log(`\n  Fabric state after shutdown: ${fabric.state}`)

  // ============================================================
  // PROOF COMPLETE
  // ============================================================

  console.log('\n=== PROOF COMPLETE ===')
  console.log('\nThe PWFabric runtime has demonstrated:')
  console.log('  1. Contract definition with typed input/output schemas')
  console.log('  2. Capability implementation with contract binding')
  console.log('  3. Fabric creation and capability registration')
  console.log('  4. Capability execution with input validation')
  console.log('  5. Verifiable state change (execution counter)')
  console.log('  6. Contract validation (empty name rejection)')
  console.log('\nFabric is not an idea. It runs.')
}

runProof().catch((error) => {
  console.error('Proof failed:', error)
  process.exit(1)
})
