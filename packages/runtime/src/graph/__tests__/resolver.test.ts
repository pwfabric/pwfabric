/**
 * Graph Resolver Tests
 *
 * Tests for Microsoft Graph data resolution
 *
 * @module @pwfabric/runtime/graph/__tests__/resolver
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RuntimeGraphResolver, createGraphResolver } from '../resolver.js'
import type { AuthProvider } from '../../auth/provider.js'
import type { GraphQuery, GraphUser } from '../types.js'

// Mock AuthProvider
function createMockAuthProvider(token?: string): AuthProvider {
  return {
    type: 'msal',
    config: { type: 'msal', clientId: 'test' },
    initialize: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getSession: vi.fn(),
    acquireTokenSilent: vi.fn(async () => {
      if (token) {
        return {
          success: true,
          token: {
            accessToken: token,
            expiresAt: Date.now() + 3600000,
            scopes: [],
          },
        }
      }
      return {
        success: false,
        error: { type: 'token_expired', message: 'No token' },
      }
    }),
    isAuthenticated: vi.fn(() => !!token),
    getUser: vi.fn(),
  } as unknown as AuthProvider
}

// Mock fetch response
function createMockResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    headers: new Headers(),
  } as Response
}

describe('RuntimeGraphResolver', () => {
  let authProvider: AuthProvider
  let resolver: RuntimeGraphResolver

  beforeEach(() => {
    authProvider = createMockAuthProvider('test-token')
    resolver = new RuntimeGraphResolver(authProvider)
  })

  describe('query', () => {
    it('should execute a Graph query', async () => {
      const mockUser: GraphUser = {
        id: 'user-123',
        displayName: 'Test User',
        mail: 'test@example.com',
      }

      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue(createMockResponse(mockUser))

      const query: GraphQuery = {
        resource: 'me',
      }

      const result = await resolver.query<GraphUser>(query)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('user-123')
      }
    })

    it('should build query with select and expand', async () => {
      vi.spyOn(
        resolver as unknown as { fetch: (url: string) => Promise<Response> },
        'fetch'
      ).mockImplementation(async (url: string) => {
        expect(url).toContain('$select=id,displayName')
        expect(url).toContain('$expand=manager')
        return createMockResponse({ id: '123' })
      })

      const query: GraphQuery = {
        resource: 'users',
        id: '123',
        select: ['id', 'displayName'],
        expand: ['manager'],
      }

      await resolver.query(query)
    })
  })

  describe('get', () => {
    it('should get a single resource', async () => {
      const mockUser = { id: 'user-123', displayName: 'Test' }

      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue(createMockResponse(mockUser))

      const result = await resolver.get<GraphUser>('users/user-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('user-123')
      }
    })

    it('should handle auth errors', async () => {
      const noAuthProvider = createMockAuthProvider()
      const noAuthResolver = new RuntimeGraphResolver(noAuthProvider)

      const result = await noAuthResolver.get('me')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('auth_error')
      }
    })

    it('should handle 404 errors', async () => {
      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue(createMockResponse({ error: { message: 'Not found' } }, 404))

      const result = await resolver.get('users/non-existent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })

    it('should handle 403 forbidden errors', async () => {
      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue(createMockResponse({ error: { message: 'Forbidden' } }, 403))

      const result = await resolver.get('admin/resource')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('forbidden')
      }
    })

    it('should handle 429 rate limit errors', async () => {
      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue(createMockResponse({ error: { message: 'Rate limited' } }, 429))

      const result = await resolver.get('me')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('rate_limited')
      }
    })
  })

  describe('list', () => {
    it('should list resources', async () => {
      const mockUsers = {
        value: [
          { id: '1', displayName: 'User 1' },
          { id: '2', displayName: 'User 2' },
        ],
      }

      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue(createMockResponse(mockUsers))

      const result = await resolver.list<GraphUser>('users')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(2)
      }
    })

    it('should handle pagination with nextLink', async () => {
      const mockResponse = {
        value: [{ id: '1' }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=xxx',
      }

      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue(createMockResponse(mockResponse))

      const result = await resolver.list<GraphUser>('users')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.nextLink).toBeDefined()
      }
    })

    it('should apply query parameters', async () => {
      vi.spyOn(
        resolver as unknown as { fetch: (url: string) => Promise<Response> },
        'fetch'
      ).mockImplementation(async (url: string) => {
        expect(url).toContain('$filter=department%20eq%20%27Engineering%27')
        expect(url).toContain('$top=10')
        return createMockResponse({ value: [] })
      })

      await resolver.list('users', {
        filter: "department eq 'Engineering'",
        top: 10,
      })
    })
  })

  describe('batch', () => {
    it('should execute batch requests', async () => {
      const mockBatchResponse = {
        responses: [
          { id: '1', status: 200, body: { displayName: 'User 1' } },
          { id: '2', status: 200, body: { displayName: 'User 2' } },
        ],
      }

      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue(createMockResponse(mockBatchResponse))

      const result = await resolver.batch([
        { id: '1', method: 'GET', url: '/users/user1' },
        { id: '2', method: 'GET', url: '/users/user2' },
      ])

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.responses).toHaveLength(2)
      }
    })
  })

  describe('me', () => {
    it('should get current user', async () => {
      const mockUser = { id: 'me', displayName: 'Current User' }

      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue(createMockResponse(mockUser))

      const result = await resolver.me<GraphUser>()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('me')
      }
    })
  })

  describe('network errors', () => {
    it('should handle network errors', async () => {
      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockRejectedValue(new Error('Network error'))

      const result = await resolver.get('me')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('network_error')
      }
    })
  })

  describe('handleError edge cases', () => {
    it('should classify 401 HTTP response as auth_error', async () => {
      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue(createMockResponse({ error: { message: 'Unauthorized' } }, 401))

      const result = await resolver.get('me')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('auth_error')
        expect(result.error.statusCode).toBe(401)
      }
    })

    it('should use HTTP status message when response.json throws', async () => {
      vi.spyOn(
        resolver as unknown as { fetch: () => Promise<Response> },
        'fetch'
      ).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON')
        },
        headers: new Headers(),
      } as Response)

      const result = await resolver.get('me')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('server_error')
        expect(result.error.message).toBe('HTTP 500')
      }
    })
  })
})

describe('createGraphResolver', () => {
  it('should create resolver with auth provider', () => {
    const authProvider = createMockAuthProvider('token')
    const resolver = createGraphResolver(authProvider)

    expect(resolver).toBeInstanceOf(RuntimeGraphResolver)
  })

  it('should create resolver with custom config', () => {
    const authProvider = createMockAuthProvider('token')
    const resolver = createGraphResolver(authProvider, {
      baseUrl: 'https://custom.graph.microsoft.com',
      version: 'beta',
      timeout: 60000,
    })

    expect(resolver).toBeInstanceOf(RuntimeGraphResolver)
  })
})
