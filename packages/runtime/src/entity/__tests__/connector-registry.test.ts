/**
 * Connector Registry Tests
 *
 * Tests for connector registration, per-entity binding, and resolution.
 *
 * @module @pwfabric/runtime/entity/__tests__/connector-registry
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryConnectorRegistry, createConnectorRegistry } from '../connector.js'
import { StaticConnector } from '../connectors/static.js'
import type { EntityTypeId } from '../types.js'

// ============================================================
// TESTS
// ============================================================

describe('InMemoryConnectorRegistry', () => {
  let registry: InMemoryConnectorRegistry

  beforeEach(() => {
    registry = new InMemoryConnectorRegistry()
  })

  describe('register', () => {
    it('should register a connector', () => {
      const connector = new StaticConnector('test-connector')

      registry.register(connector)

      expect(registry.has('test-connector')).toBe(true)
    })

    it('should throw if connector has no name', () => {
      const connector = new StaticConnector('')

      expect(() => registry.register(connector)).toThrow('Connector must have a name')
    })

    it('should throw if connector name is already registered', () => {
      const connector = new StaticConnector('test-connector')
      registry.register(connector)

      expect(() => registry.register(connector)).toThrow(
        "Connector 'test-connector' is already registered"
      )
    })
  })

  describe('get', () => {
    it('should return registered connector', () => {
      const connector = new StaticConnector('my-connector')
      registry.register(connector)

      const result = registry.get('my-connector')

      expect(result).toBe(connector)
    })

    it('should return undefined for unregistered connector', () => {
      expect(registry.get('nonexistent')).toBeUndefined()
    })
  })

  describe('has', () => {
    it('should return true for registered connector', () => {
      registry.register(new StaticConnector('my-connector'))

      expect(registry.has('my-connector')).toBe(true)
    })

    it('should return false for unregistered connector', () => {
      expect(registry.has('nonexistent')).toBe(false)
    })
  })

  describe('bind', () => {
    it('should bind entity type to connector', () => {
      const connector = new StaticConnector('my-connector')
      registry.register(connector)

      registry.bind('product' as EntityTypeId, 'my-connector')

      const resolved = registry.resolve('product' as EntityTypeId)
      expect(resolved).toBe(connector)
    })

    it('should throw if connector name is not registered', () => {
      expect(() => registry.bind('product' as EntityTypeId, 'nonexistent')).toThrow(
        "Connector 'nonexistent' is not registered"
      )
    })

    it('should allow rebinding entity type to different connector', () => {
      const connector1 = new StaticConnector('connector-1')
      const connector2 = new StaticConnector('connector-2')
      registry.register(connector1)
      registry.register(connector2)

      registry.bind('product' as EntityTypeId, 'connector-1')
      registry.bind('product' as EntityTypeId, 'connector-2')

      const resolved = registry.resolve('product' as EntityTypeId)
      expect(resolved).toBe(connector2)
    })
  })

  describe('resolve', () => {
    it('should resolve bound connector', () => {
      const connector = new StaticConnector('my-connector')
      registry.register(connector)
      registry.bind('product' as EntityTypeId, 'my-connector')

      const resolved = registry.resolve('product' as EntityTypeId)

      expect(resolved).toBe(connector)
    })

    it('should fall back to default connector when no binding exists', () => {
      const connector = new StaticConnector('default-connector')
      registry.register(connector)
      registry.setDefault('default-connector')

      const resolved = registry.resolve('product' as EntityTypeId)

      expect(resolved).toBe(connector)
    })

    it('should prefer entity-specific binding over default', () => {
      const defaultConnector = new StaticConnector('default-connector')
      const specificConnector = new StaticConnector('specific-connector')
      registry.register(defaultConnector)
      registry.register(specificConnector)
      registry.setDefault('default-connector')
      registry.bind('product' as EntityTypeId, 'specific-connector')

      const resolved = registry.resolve('product' as EntityTypeId)

      expect(resolved).toBe(specificConnector)
    })

    it('should return undefined when no binding and no default', () => {
      const resolved = registry.resolve('product' as EntityTypeId)

      expect(resolved).toBeUndefined()
    })
  })

  describe('setDefault', () => {
    it('should set default connector', () => {
      const connector = new StaticConnector('default-connector')
      registry.register(connector)

      registry.setDefault('default-connector')

      const resolved = registry.resolve('any_type' as EntityTypeId)
      expect(resolved).toBe(connector)
    })

    it('should throw if connector is not registered', () => {
      expect(() => registry.setDefault('nonexistent')).toThrow(
        "Connector 'nonexistent' is not registered"
      )
    })
  })

  describe('list', () => {
    it('should return all registered connector names', () => {
      registry.register(new StaticConnector('connector-a'))
      registry.register(new StaticConnector('connector-b'))

      const names = registry.list()

      expect(names).toHaveLength(2)
      expect(names).toContain('connector-a')
      expect(names).toContain('connector-b')
    })

    it('should return empty array when no connectors registered', () => {
      expect(registry.list()).toEqual([])
    })
  })

  describe('unregister', () => {
    it('should remove a registered connector', () => {
      registry.register(new StaticConnector('my-connector'))

      const removed = registry.unregister('my-connector')

      expect(removed).toBe(true)
      expect(registry.has('my-connector')).toBe(false)
    })

    it('should return false for unregistered connector', () => {
      const removed = registry.unregister('nonexistent')

      expect(removed).toBe(false)
    })

    it('should remove bindings when connector is unregistered', () => {
      const connector = new StaticConnector('my-connector')
      registry.register(connector)
      registry.bind('product' as EntityTypeId, 'my-connector')

      registry.unregister('my-connector')

      expect(registry.resolve('product' as EntityTypeId)).toBeUndefined()
    })

    it('should clear default when default connector is unregistered', () => {
      const connector = new StaticConnector('default-connector')
      registry.register(connector)
      registry.setDefault('default-connector')

      registry.unregister('default-connector')

      expect(registry.resolve('any_type' as EntityTypeId)).toBeUndefined()
    })
  })

  describe('clear', () => {
    it('should remove all connectors and bindings', () => {
      registry.register(new StaticConnector('connector-a'))
      registry.register(new StaticConnector('connector-b'))
      registry.bind('product' as EntityTypeId, 'connector-a')
      registry.setDefault('connector-b')

      registry.clear()

      expect(registry.list()).toEqual([])
      expect(registry.resolve('product' as EntityTypeId)).toBeUndefined()
    })
  })
})

describe('createConnectorRegistry', () => {
  it('should create an InMemoryConnectorRegistry instance', () => {
    const registry = createConnectorRegistry()

    expect(registry).toBeInstanceOf(InMemoryConnectorRegistry)
  })
})
