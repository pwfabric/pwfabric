/**
 * Contract Builder Tests
 *
 * Tests for fluent contract builder API
 *
 * @module @pwfabric/core/__tests__/contract-builder
 */

import { describe, it, expect } from 'vitest'
import { ContractBuilder, defineContract, anySchema, objectSchema } from '../contract-builder.js'

describe('ContractBuilder', () => {
  describe('build', () => {
    it('should build a minimal contract', () => {
      const contract = new ContractBuilder().id('test/contract').name('Test Contract').build()

      expect(contract.id).toBe('test/contract')
      expect(contract.metadata.name).toBe('Test Contract')
      expect(contract.metadata.state).toBe('draft')
    })

    it('should throw if ID is missing', () => {
      expect(() => {
        new ContractBuilder().name('Test').build()
      }).toThrow('Contract ID is required')
    })

    it('should throw if name is missing', () => {
      expect(() => {
        new ContractBuilder().id('test/contract').build()
      }).toThrow('Contract name is required')
    })

    it('should set all metadata properties', () => {
      const contract = defineContract()
        .id('auth/login')
        .name('Login Contract')
        .description('Authenticates a user')
        .state('stable')
        .tags(['auth', 'security'])
        .build()

      expect(contract.metadata.name).toBe('Login Contract')
      expect(contract.metadata.description).toBe('Authenticates a user')
      expect(contract.metadata.state).toBe('stable')
      expect(contract.metadata.tags).toContain('auth')
      expect(contract.metadata.tags).toContain('security')
    })

    it('should set version', () => {
      const contract = defineContract()
        .id('test/versioned')
        .name('Versioned Contract')
        .version('2.3.4')
        .build()

      expect(contract.version.major).toBe(2)
      expect(contract.version.minor).toBe(3)
      expect(contract.version.patch).toBe(4)
    })

    it('should use default version for invalid version string', () => {
      const contract = defineContract()
        .id('test/invalid-version')
        .name('Invalid Version Contract')
        .version('invalid')
        .build()

      // Should fall back to INITIAL_VERSION (0.1.0)
      expect(contract.version.major).toBe(0)
      expect(contract.version.minor).toBe(1)
      expect(contract.version.patch).toBe(0)
    })
  })

  describe('input schema', () => {
    it('should set custom input schema', () => {
      const inputSchema = objectSchema<{ email: string }>()

      const contract = defineContract().id('auth/login').name('Login').input(inputSchema).build()

      expect(contract.input).toBe(inputSchema)
    })

    it('should validate input data', () => {
      const contract = defineContract()
        .id('test/validation')
        .name('Validation Test')
        .input(objectSchema<{ name: string }>())
        .build()

      const result = contract.validateInput({ name: 'test' })

      expect(result.success).toBe(true)
    })

    it('should reject invalid input', () => {
      const contract = defineContract()
        .id('test/validation')
        .name('Validation Test')
        .input(objectSchema<{ name: string }>())
        .build()

      const result = contract.validateInput('not an object')

      expect(result.success).toBe(false)
    })
  })

  describe('output schema', () => {
    it('should set custom output schema', () => {
      const outputSchema = objectSchema<{ token: string }>()

      const contract = defineContract().id('auth/login').name('Login').output(outputSchema).build()

      expect(contract.output).toBe(outputSchema)
    })

    it('should validate output data', () => {
      const contract = defineContract()
        .id('test/output')
        .name('Output Test')
        .output(objectSchema<{ result: boolean }>())
        .build()

      const result = contract.validateOutput({ result: true })

      expect(result.success).toBe(true)
    })
  })

  describe('serialize', () => {
    it('should serialize contract to JSON-compatible format', () => {
      const contract = defineContract()
        .id('test/serialize')
        .name('Serializable Contract')
        .version('1.2.3')
        .description('A test contract')
        .build()

      const serialized = contract.serialize()

      expect(serialized.id).toBe('test/serialize')
      expect(serialized.version).toBe('1.2.3')
      expect(serialized.metadata.name).toBe('Serializable Contract')
      expect(serialized.metadata.description).toBe('A test contract')
      expect(serialized.input).toBeDefined()
      expect(serialized.output).toBeDefined()
      expect(serialized.errors).toEqual([])
    })
  })

  describe('validateError', () => {
    it('should return error for unknown error type when no error schemas', () => {
      const contract = defineContract().id('test/errors').name('Error Test').build()

      const result = contract.validateError({ code: 'UNKNOWN' })

      expect(result.success).toBe(false)
    })
  })
})

describe('defineContract', () => {
  it('should return a new ContractBuilder', () => {
    const builder = defineContract()

    expect(builder).toBeInstanceOf(ContractBuilder)
  })

  it('should allow chained method calls', () => {
    const contract = defineContract()
      .id('chained/contract')
      .name('Chained')
      .version('1.0.0')
      .description('Built with chaining')
      .state('alpha')
      .tags(['test'])
      .build()

    expect(contract.id).toBe('chained/contract')
    expect(contract.metadata.state).toBe('alpha')
  })
})

describe('anySchema', () => {
  it('should accept any value', () => {
    const schema = anySchema()

    expect(schema.validate('string').success).toBe(true)
    expect(schema.validate(123).success).toBe(true)
    expect(schema.validate({ obj: true }).success).toBe(true)
    expect(schema.validate(null).success).toBe(true)
    expect(schema.validate(undefined).success).toBe(true)
  })

  it('should have unknown type definition', () => {
    const schema = anySchema()

    expect(schema.definition.type).toBe('unknown')
  })
})

describe('objectSchema', () => {
  it('should accept objects', () => {
    const schema = objectSchema()

    expect(schema.validate({}).success).toBe(true)
    expect(schema.validate({ key: 'value' }).success).toBe(true)
  })

  it('should reject non-objects', () => {
    const schema = objectSchema()

    expect(schema.validate('string').success).toBe(false)
    expect(schema.validate(123).success).toBe(false)
    expect(schema.validate(null).success).toBe(false)
  })

  it('should parse valid objects', () => {
    const schema = objectSchema<{ name: string }>()

    const result = schema.parse({ name: 'test' })

    expect(result).toEqual({ name: 'test' })
  })

  it('should throw on parse of invalid data', () => {
    const schema = objectSchema()

    expect(() => schema.parse('not an object')).toThrow()
  })

  it('should have object type definition', () => {
    const schema = objectSchema()

    expect(schema.definition.type).toBe('object')
  })
})
