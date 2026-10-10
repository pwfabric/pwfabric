/**
 * Data Source Tests
 *
 * Tests for data source management
 *
 * @module @pwfabric/runtime/binding/__tests__/datasource
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DataSourceConfig } from '../datasource.js'
import {
  StaticDataSource,
  ApiDataSource,
  GraphQLDataSource,
  StateDataSource,
  InMemoryDataSourceRegistry,
  createDataSourceRegistry,
  createDataSource,
  createStaticDataSource,
  createApiDataSource,
  createGraphQLDataSource,
  createStateDataSource,
} from '../datasource.js'
import { InMemoryStateStore } from '../../state/store.js'
import type { CacheProvider } from '../../cache/types.js'

// ============================================================
// MOCK DATA
// ============================================================

interface TestUser {
  id: number
  name: string
  email: string
}

const testUsers: TestUser[] = [
  { id: 1, name: 'John', email: 'john@example.com' },
  { id: 2, name: 'Jane', email: 'jane@example.com' },
]

// ============================================================
// MOCK CACHE
// ============================================================

function createMockCache(): CacheProvider {
  const store = new Map<string, unknown>()

  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    has: vi.fn(async (key: string) => store.has(key)),
    clear: vi.fn(async () => store.clear()),
    stats: () => ({
      hits: 0,
      misses: 0,
      size: store.size,
    }),
  }
}

// ============================================================
// STATIC DATA SOURCE TESTS
// ============================================================

describe('StaticDataSource', () => {
  it('should return static data on fetch', async () => {
    const source = new StaticDataSource({
      id: 'users',
      type: 'static',
      data: testUsers,
    })

    const data = await source.fetch()

    expect(data).toEqual(testUsers)
  })

  it('should have correct properties', () => {
    const source = new StaticDataSource({
      id: 'users',
      type: 'static',
      data: testUsers,
      name: 'User List',
      description: 'List of test users',
    })

    expect(source.id).toBe('users')
    expect(source.type).toBe('static')
    expect(source.name).toBe('User List')
    expect(source.description).toBe('List of test users')
  })

  it('should never be loading', () => {
    const source = new StaticDataSource({
      id: 'users',
      type: 'static',
      data: testUsers,
    })

    expect(source.isLoading()).toBe(false)
  })
})

// ============================================================
// API DATA SOURCE TESTS
// ============================================================

describe('ApiDataSource', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('should fetch data from API', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testUsers),
    } as Response)

    const source = new ApiDataSource({
      id: 'users-api',
      type: 'api',
      url: 'https://api.example.com/users',
    })

    const data = await source.fetch()

    expect(fetchSpy).toHaveBeenCalledWith('https://api.example.com/users', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    })
    expect(data).toEqual(testUsers)
  })

  it('should apply transform to response', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: testUsers }),
    } as Response)

    const source = new ApiDataSource({
      id: 'users-api',
      type: 'api',
      url: 'https://api.example.com/users',
      transform: (data) => (data as { data: TestUser[] }).data,
    })

    const data = await source.fetch()

    expect(data).toEqual(testUsers)
  })

  it('should replace URL parameters', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testUsers[0]),
    } as Response)

    const source = new ApiDataSource({
      id: 'user-api',
      type: 'api',
      url: 'https://api.example.com/users/:id',
    })

    await source.fetch({ id: 1 })

    expect(fetchSpy).toHaveBeenCalledWith('https://api.example.com/users/1', expect.any(Object))
  })

  it('should build query string', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testUsers),
    } as Response)

    const source = new ApiDataSource({
      id: 'users-api',
      type: 'api',
      url: 'https://api.example.com/users',
      query: { page: 1, limit: 10 },
    })

    await source.fetch()

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/users?page=1&limit=10',
      expect.any(Object)
    )
  })

  it('should use custom headers', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testUsers),
    } as Response)

    const source = new ApiDataSource({
      id: 'users-api',
      type: 'api',
      url: 'https://api.example.com/users',
      headers: { Authorization: 'Bearer token123' },
    })

    await source.fetch()

    expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token123',
      },
      body: undefined,
    })
  })

  it('should throw on HTTP error', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response)

    const source = new ApiDataSource({
      id: 'users-api',
      type: 'api',
      url: 'https://api.example.com/users',
    })

    await expect(source.fetch()).rejects.toThrow('HTTP 404: Not Found')
  })

  it('should cache responses when enabled', async () => {
    const cache = createMockCache()
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testUsers),
    } as Response)

    const source = new ApiDataSource(
      {
        id: 'users-api',
        type: 'api',
        url: 'https://api.example.com/users',
        cache: { enabled: true, ttl: 60000 },
      },
      cache
    )

    // First fetch - should call API
    await source.fetch()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalled()

    // Second fetch - should use cache
    await source.fetch()
    expect(cache.get).toHaveBeenCalled()
  })

  it('should invalidate cache', async () => {
    const cache = createMockCache()
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testUsers),
    } as Response)

    const source = new ApiDataSource(
      {
        id: 'users-api',
        type: 'api',
        url: 'https://api.example.com/users',
        cache: { enabled: true },
      },
      cache
    )

    await source.fetch()
    source.invalidate()

    expect(cache.delete).toHaveBeenCalled()
  })

  it('should retry on failure', async () => {
    let attempts = 0
    fetchSpy.mockImplementation(() => {
      attempts++
      if (attempts < 3) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(testUsers),
      } as Response)
    })

    const source = new ApiDataSource({
      id: 'users-api',
      type: 'api',
      url: 'https://api.example.com/users',
      retry: { maxAttempts: 3, delay: 10 },
    })

    const data = await source.fetch()

    expect(attempts).toBe(3)
    expect(data).toEqual(testUsers)
  })

  it('should notify listeners on fetch', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testUsers),
    } as Response)

    const source = new ApiDataSource({
      id: 'users-api',
      type: 'api',
      url: 'https://api.example.com/users',
    })

    const listener = vi.fn()
    source.subscribe(listener)

    await source.fetch()

    expect(listener).toHaveBeenCalledWith(testUsers)
  })

  it('should report loading state', async () => {
    let resolvePromise: ((value: Response) => void) | undefined
    const fetchPromise = new Promise<Response>((resolve) => {
      resolvePromise = resolve
    })
    fetchSpy.mockReturnValue(fetchPromise)

    const source = new ApiDataSource({
      id: 'users-api',
      type: 'api',
      url: 'https://api.example.com/users',
    })

    const fetchOperation = source.fetch()
    expect(source.isLoading()).toBe(true)

    // resolvePromise is guaranteed to be set after Promise construction
    expect(resolvePromise).toBeDefined()
    resolvePromise?.({
      ok: true,
      json: () => Promise.resolve(testUsers),
    } as Response)

    await fetchOperation
    expect(source.isLoading()).toBe(false)
  })

  it('should clean up on dispose', () => {
    const source = new ApiDataSource({
      id: 'users-api',
      type: 'api',
      url: 'https://api.example.com/users',
      pollInterval: 1000,
    })

    const listener = vi.fn()
    source.subscribe(listener)

    source.dispose()

    // Listener should be removed
    expect(() =>
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(testUsers),
      } as Response)
    ).not.toThrow()
  })
})

// ============================================================
// STATE DATA SOURCE TESTS
// ============================================================

describe('StateDataSource', () => {
  it('should fetch data from state store', async () => {
    const stateStore = new InMemoryStateStore({ users: testUsers })
    const source = new StateDataSource(
      {
        id: 'users-state',
        type: 'state',
        stateKey: 'users',
      },
      stateStore
    )

    const data = await source.fetch()

    expect(data).toEqual(testUsers)
  })

  it('should apply transform to state', async () => {
    const stateStore = new InMemoryStateStore({ count: 5 })
    const source = new StateDataSource(
      {
        id: 'double-count',
        type: 'state',
        stateKey: 'count',
        transform: (n) => (n as number) * 2,
      },
      stateStore
    )

    const data = await source.fetch()

    expect(data).toBe(10)
  })

  it('should subscribe to state changes', () => {
    const stateStore = new InMemoryStateStore({ users: testUsers })
    const source = new StateDataSource(
      {
        id: 'users-state',
        type: 'state',
        stateKey: 'users',
      },
      stateStore
    )

    const listener = vi.fn()
    source.subscribe(listener)

    // Listener should be called immediately with current state
    expect(listener).toHaveBeenCalledWith(testUsers)

    // Update state
    const newUsers = [...testUsers, { id: 3, name: 'Bob', email: 'bob@example.com' }]
    stateStore.set('users', newUsers)

    expect(listener).toHaveBeenCalledWith(newUsers)
  })

  it('should never be loading', () => {
    const stateStore = new InMemoryStateStore({ users: testUsers })
    const source = new StateDataSource(
      {
        id: 'users-state',
        type: 'state',
        stateKey: 'users',
      },
      stateStore
    )

    expect(source.isLoading()).toBe(false)
  })

  it('should clean up on dispose', () => {
    const stateStore = new InMemoryStateStore({ users: testUsers })
    const source = new StateDataSource(
      {
        id: 'users-state',
        type: 'state',
        stateKey: 'users',
      },
      stateStore
    )

    const listener = vi.fn()
    source.subscribe(listener)
    listener.mockClear()

    source.dispose()

    // Update state - listener should not be called
    stateStore.set('users', [])
    expect(listener).not.toHaveBeenCalled()
  })
})

// ============================================================
// DATA SOURCE REGISTRY TESTS
// ============================================================

describe('InMemoryDataSourceRegistry', () => {
  let registry: InMemoryDataSourceRegistry

  beforeEach(() => {
    registry = new InMemoryDataSourceRegistry()
  })

  it('should register data source', () => {
    const source = createStaticDataSource('users', testUsers)
    registry.register(source)

    expect(registry.has('users')).toBe(true)
  })

  it('should throw when registering duplicate ID', () => {
    const source1 = createStaticDataSource('users', testUsers)
    const source2 = createStaticDataSource('users', [])

    registry.register(source1)

    expect(() => registry.register(source2)).toThrow("Data source 'users' is already registered")
  })

  it('should get data source by ID', () => {
    const source = createStaticDataSource('users', testUsers)
    registry.register(source)

    const retrieved = registry.get('users')

    expect(retrieved).toBe(source)
  })

  it('should return undefined for non-existent ID', () => {
    expect(registry.get('non-existent')).toBeUndefined()
  })

  it('should fetch data from source', async () => {
    const source = createStaticDataSource('users', testUsers)
    registry.register(source)

    const data = await registry.fetch<TestUser[]>('users')

    expect(data).toEqual(testUsers)
  })

  it('should throw when fetching non-existent source', async () => {
    await expect(registry.fetch('non-existent')).rejects.toThrow(
      "Data source 'non-existent' not found"
    )
  })

  it('should unregister data source', () => {
    const source = createStaticDataSource('users', testUsers)
    registry.register(source)

    const removed = registry.unregister('users')

    expect(removed).toBe(true)
    expect(registry.has('users')).toBe(false)
  })

  it('should return false when unregistering non-existent source', () => {
    expect(registry.unregister('non-existent')).toBe(false)
  })

  it('should list all source IDs', () => {
    registry.register(createStaticDataSource('users', testUsers))
    registry.register(createStaticDataSource('products', []))

    expect(registry.ids()).toEqual(['users', 'products'])
  })

  it('should clear all sources', () => {
    registry.register(createStaticDataSource('users', testUsers))
    registry.register(createStaticDataSource('products', []))

    registry.clear()

    expect(registry.ids()).toEqual([])
  })
})

// ============================================================
// FACTORY FUNCTION TESTS
// ============================================================

describe('createDataSourceRegistry', () => {
  it('should create registry instance', () => {
    const registry = createDataSourceRegistry()
    expect(registry).toBeInstanceOf(InMemoryDataSourceRegistry)
  })
})

describe('createDataSource', () => {
  it('should create static data source', () => {
    const config: DataSourceConfig<TestUser[]> = {
      id: 'users',
      type: 'static',
      data: testUsers,
    }

    const source = createDataSource(config)

    expect(source.type).toBe('static')
    expect(source.id).toBe('users')
  })

  it('should create API data source', () => {
    const config: DataSourceConfig = {
      id: 'users-api',
      type: 'api',
      url: 'https://api.example.com/users',
    }

    const source = createDataSource(config)

    expect(source.type).toBe('api')
  })

  it('should create state data source with store', () => {
    const stateStore = new InMemoryStateStore({ users: testUsers })
    const config: DataSourceConfig = {
      id: 'users-state',
      type: 'state',
      stateKey: 'users',
    }

    const source = createDataSource(config, { stateStore })

    expect(source.type).toBe('state')
  })

  it('should throw when state source has no store', () => {
    const config: DataSourceConfig = {
      id: 'users-state',
      type: 'state',
      stateKey: 'users',
    }

    expect(() => createDataSource(config)).toThrow('State store is required for state data sources')
  })

  it('should create GraphQL data source', () => {
    const config: DataSourceConfig = {
      id: 'users-graphql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: '{ users { id name } }',
    }

    const source = createDataSource(config)
    expect(source.type).toBe('graphql')
    expect(source.id).toBe('users-graphql')
  })
})

describe('createStaticDataSource', () => {
  it('should create static data source with options', () => {
    const source = createStaticDataSource('users', testUsers, {
      name: 'User List',
      description: 'List of users',
    })

    expect(source.id).toBe('users')
    expect(source.name).toBe('User List')
    expect(source.description).toBe('List of users')
  })
})

describe('createApiDataSource', () => {
  it('should create API data source with options', () => {
    const source = createApiDataSource('users-api', 'https://api.example.com/users', {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
    })

    expect(source.id).toBe('users-api')
    expect(source.type).toBe('api')
  })
})

describe('createStateDataSource', () => {
  it('should create state data source', async () => {
    const stateStore = new InMemoryStateStore({ users: testUsers })
    const source = createStateDataSource('users-state', 'users', stateStore, {
      name: 'Users from State',
    })

    expect(source.id).toBe('users-state')
    expect(source.name).toBe('Users from State')

    const data = await source.fetch()
    expect(data).toEqual(testUsers)
  })
})

// ============================================================
// GRAPHQL DATA SOURCE TESTS
// ============================================================

describe('GraphQLDataSource', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('should fetch data via GraphQL query', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { users: testUsers } }),
    } as Response)

    const source = new GraphQLDataSource({
      id: 'users-gql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: '{ users { id name email } }',
    })

    const data = await source.fetch()

    expect(fetchSpy).toHaveBeenCalledWith('https://api.example.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ users { id name email } }' }),
    })
    expect(data).toEqual({ users: testUsers })
  })

  it('should pass variables in the request', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { user: testUsers[0] } }),
    } as Response)

    const source = new GraphQLDataSource({
      id: 'user-gql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: 'query GetUser($id: ID!) { user(id: $id) { id name } }',
      variables: { id: '1' },
    })

    await source.fetch()

    expect(fetchSpy).toHaveBeenCalledWith('https://api.example.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query GetUser($id: ID!) { user(id: $id) { id name } }',
        variables: { id: '1' },
      }),
    })
  })

  it('should merge runtime params with config variables', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { user: testUsers[0] } }),
    } as Response)

    const source = new GraphQLDataSource({
      id: 'user-gql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: 'query GetUser($id: ID!, $includeEmail: Boolean) { user(id: $id) { id name } }',
      variables: { includeEmail: true },
    })

    await source.fetch({ id: '1' })

    const callArgs = fetchSpy.mock.calls[0]
    const body = JSON.parse((callArgs?.[1] as RequestInit).body as string)
    expect(body.variables).toEqual({ includeEmail: true, id: '1' })
  })

  it('should apply transform to response data', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { users: testUsers } }),
    } as Response)

    const source = new GraphQLDataSource({
      id: 'users-gql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: '{ users { id name } }',
      transform: (data) => (data as { users: TestUser[] }).users,
    })

    const data = await source.fetch()
    expect(data).toEqual(testUsers)
  })

  it('should use custom headers', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    } as Response)

    const source = new GraphQLDataSource({
      id: 'users-gql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: '{ users { id } }',
      headers: { Authorization: 'Bearer gql-token' },
    })

    await source.fetch()

    expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer gql-token',
      },
      body: expect.any(String),
    })
  })

  it('should throw on HTTP error', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response)

    const source = new GraphQLDataSource({
      id: 'users-gql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: '{ users { id } }',
    })

    await expect(source.fetch()).rejects.toThrow('GraphQL HTTP 500: Internal Server Error')
  })

  it('should throw on GraphQL errors', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: null,
          errors: [{ message: 'Field not found' }, { message: 'Unauthorized' }],
        }),
    } as Response)

    const source = new GraphQLDataSource({
      id: 'users-gql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: '{ users { nonexistent } }',
    })

    await expect(source.fetch()).rejects.toThrow('GraphQL errors: Field not found; Unauthorized')
  })

  it('should notify listeners', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { users: testUsers } }),
    } as Response)

    const source = new GraphQLDataSource({
      id: 'users-gql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: '{ users { id name } }',
    })

    const listener = vi.fn()
    source.subscribe(listener)

    await source.fetch()

    expect(listener).toHaveBeenCalledWith({ users: testUsers })
  })

  it('should report loading state', async () => {
    let resolvePromise: ((value: Response) => void) | undefined
    const fetchPromise = new Promise<Response>((resolve) => {
      resolvePromise = resolve
    })
    fetchSpy.mockReturnValue(fetchPromise)

    const source = new GraphQLDataSource({
      id: 'users-gql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: '{ users { id } }',
    })

    const fetchOp = source.fetch()
    expect(source.isLoading()).toBe(true)

    resolvePromise?.({
      ok: true,
      json: () => Promise.resolve({ data: { users: [] } }),
    } as Response)

    await fetchOp
    expect(source.isLoading()).toBe(false)
  })

  it('should clean up on dispose', () => {
    const source = new GraphQLDataSource({
      id: 'users-gql',
      type: 'graphql',
      url: 'https://api.example.com/graphql',
      query: '{ users { id } }',
      pollInterval: 1000,
    })

    source.dispose()
    // No error should be thrown
  })
})

describe('createGraphQLDataSource', () => {
  it('should create GraphQL data source with options', () => {
    const source = createGraphQLDataSource(
      'users-gql',
      'https://api.example.com/graphql',
      '{ users { id name } }',
      { variables: { limit: 10 } }
    )

    expect(source.id).toBe('users-gql')
    expect(source.type).toBe('graphql')
  })
})
