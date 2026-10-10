/**
 * Capability Builder Tests
 *
 * Tests for fluent capability builder API
 *
 * @module @pwfabric/contracts/__tests__/capability-builder
 */

import { describe, it, expect } from 'vitest'
import { CapabilityBuilder, defineCapability } from '../capability/index.js'
import { contractId, type DomainId, type FabricId } from '../core/ids.js'
import { INITIAL_VERSION } from '../core/version.js'
import type { Contract } from '../fabric/contract.js'
import type { ExecutionContext } from '../fabric/execution.js'
import type { Result } from '../core/result.js'

/**
 * Minimal contract fixture. The builder only stores the contract it is
 * given, so no schema or validation behaviour is needed here.
 */
function stubContract<TInput = unknown, TOutput = unknown>(
  id: string,
  name: string
): Contract<TInput, TOutput> {
  return {
    id: contractId(id),
    version: INITIAL_VERSION,
    metadata: { name, state: 'draft' },
  } as unknown as Contract<TInput, TOutput>
}

// Mock execution context
const mockContext: ExecutionContext = {
  traceId: 'trace-123',
  spanId: 'span-456',
  fabricId: 'fabric/test' as FabricId,
  startedAt: Date.now(),
  data: {},
  logger: {
    debug: (): void => undefined,
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
  },
  invoke: async (): Promise<Result<unknown>> => ({ success: true, data: {} }),
  child: () => mockContext,
}

describe('CapabilityBuilder', () => {
  const testContract = stubContract<{ input: string }, { output: string }>(
    'test/contract',
    'Test Contract'
  )

  describe('build', () => {
    it('should build a minimal capability', () => {
      const capability = defineCapability()
        .id('test/capability')
        .name('Test Capability')
        .contract(testContract)
        .execute(async () => ({ output: 'result' }))
        .build()

      expect(capability.id).toBe('test/capability')
      expect(capability.metadata.name).toBe('Test Capability')
      expect(capability.metadata.state).toBe('draft')
    })

    it('should throw if ID is missing', () => {
      expect(() => {
        defineCapability()
          .name('Test')
          .contract(testContract)
          .execute(async () => ({}))
          .build()
      }).toThrow('Capability ID is required')
    })

    it('should throw if name is missing', () => {
      expect(() => {
        defineCapability()
          .id('test/capability')
          .contract(testContract)
          .execute(async () => ({}))
          .build()
      }).toThrow('Capability name is required')
    })

    it('should throw if contract is missing', () => {
      expect(() => {
        defineCapability()
          .id('test/capability')
          .name('Test')
          .execute(async () => ({}))
          .build()
      }).toThrow('Capability contract is required')
    })

    it('should throw if executor is missing', () => {
      expect(() => {
        defineCapability().id('test/capability').name('Test').contract(testContract).build()
      }).toThrow('Capability executor is required')
    })
  })

  describe('metadata', () => {
    it('should set all metadata properties', () => {
      const capability = defineCapability()
        .id('auth/login')
        .name('Login')
        .description('Authenticates a user')
        .state('stable')
        .domain('auth/core' as DomainId)
        .tags(['identity', 'security'])
        .timeout(5000)
        .retryable()
        .idempotent()
        .contract(testContract)
        .execute(async () => ({ output: 'token' }))
        .build()

      expect(capability.metadata.name).toBe('Login')
      expect(capability.metadata.description).toBe('Authenticates a user')
      expect(capability.metadata.state).toBe('stable')
      expect(capability.metadata.domain).toBe('auth/core')
      expect(capability.metadata.tags).toContain('identity')
      expect(capability.metadata.tags).toContain('security')
      expect(capability.metadata.timeout).toBe(5000)
      expect(capability.metadata.retryable).toBe(true)
      expect(capability.metadata.idempotent).toBe(true)
    })

    it('should allow setting retryable to false', () => {
      const capability = defineCapability()
        .id('test/non-retryable')
        .name('Non-retryable')
        .retryable(false)
        .contract(testContract)
        .execute(async () => ({ output: 'result' }))
        .build()

      expect(capability.metadata.retryable).toBe(false)
    })

    it('should allow setting idempotent to false', () => {
      const capability = defineCapability()
        .id('test/non-idempotent')
        .name('Non-idempotent')
        .idempotent(false)
        .contract(testContract)
        .execute(async () => ({ output: 'result' }))
        .build()

      expect(capability.metadata.idempotent).toBe(false)
    })
  })

  describe('version', () => {
    it('should set version', () => {
      const capability = defineCapability()
        .id('test/versioned')
        .name('Versioned')
        .version('2.3.4')
        .contract(testContract)
        .execute(async () => ({ output: 'result' }))
        .build()

      expect(capability.version.major).toBe(2)
      expect(capability.version.minor).toBe(3)
      expect(capability.version.patch).toBe(4)
    })

    it('should use default version for invalid version string', () => {
      const capability = defineCapability()
        .id('test/invalid-version')
        .name('Invalid Version')
        .version('invalid')
        .contract(testContract)
        .execute(async () => ({ output: 'result' }))
        .build()

      // Should fall back to INITIAL_VERSION (0.1.0)
      expect(capability.version.major).toBe(0)
      expect(capability.version.minor).toBe(1)
      expect(capability.version.patch).toBe(0)
    })
  })

  describe('dependencies', () => {
    it('should add dependencies with dependsOn', () => {
      const capability = defineCapability()
        .id('test/dependent')
        .name('Dependent')
        .dependsOn('auth/validate')
        .dependsOn('db/connection')
        .contract(testContract)
        .execute(async () => ({ output: 'result' }))
        .build()

      expect(capability.dependencies).toContain('auth/validate')
      expect(capability.dependencies).toContain('db/connection')
    })

    it('should have empty dependencies by default', () => {
      const capability = defineCapability()
        .id('test/no-deps')
        .name('No Dependencies')
        .contract(testContract)
        .execute(async () => ({ output: 'result' }))
        .build()

      expect(capability.dependencies).toEqual([])
    })
  })

  describe('execute', () => {
    it('should execute the capability', async () => {
      const capability = defineCapability<{ name: string }, { greeting: string }>()
        .id('greet/hello')
        .name('Hello')
        .contract(testContract)
        .execute(async (input) => ({ greeting: `Hello, ${input.name}!` }))
        .build()

      const result = await capability.execute({ name: 'World' }, mockContext)

      expect(result.greeting).toBe('Hello, World!')
    })

    it('should receive execution context', async () => {
      let receivedContext: ExecutionContext | null = null

      const capability = defineCapability()
        .id('test/context')
        .name('Context Test')
        .contract(testContract)
        .execute(async (_, ctx) => {
          receivedContext = ctx
          return { output: 'done' }
        })
        .build()

      await capability.execute({ input: 'test' }, mockContext)

      expect(receivedContext).toBe(mockContext)
      expect(receivedContext?.traceId).toBe('trace-123')
    })

    it('should handle async operations', async () => {
      const capability = defineCapability()
        .id('test/async')
        .name('Async Test')
        .contract(testContract)
        .execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return { output: 'async result' }
        })
        .build()

      const result = await capability.execute({ input: 'test' }, mockContext)

      expect(result.output).toBe('async result')
    })
  })

  describe('contract binding', () => {
    it('should bind to the provided contract', () => {
      const capability = defineCapability()
        .id('test/bound')
        .name('Bound')
        .contract(testContract)
        .execute(async () => ({ output: 'result' }))
        .build()

      expect(capability.contract).toBe(testContract)
    })
  })
})

describe('defineCapability', () => {
  it('should return a new CapabilityBuilder', () => {
    const builder = defineCapability()

    expect(builder).toBeInstanceOf(CapabilityBuilder)
  })

  it('should allow chained method calls', () => {
    const contract = stubContract('chained/contract', 'Chained Contract')

    const capability = defineCapability()
      .id('chained/capability')
      .name('Chained')
      .version('1.0.0')
      .description('Built with chaining')
      .state('alpha')
      .tags(['test'])
      .timeout(3000)
      .retryable()
      .contract(contract)
      .execute(async () => ({}))
      .build()

    expect(capability.id).toBe('chained/capability')
    expect(capability.metadata.state).toBe('alpha')
    expect(capability.metadata.timeout).toBe(3000)
  })
})
