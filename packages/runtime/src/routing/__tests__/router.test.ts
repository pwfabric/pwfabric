/**
 * Routing Capability Tests
 *
 * Tests for route matching, navigation, and parameter resolution
 *
 * @module @pwfabric/runtime/routing/__tests__/router
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DefaultRoutingCapability, createRoutingCapability } from '../router.js'
import type { RouteGuard } from '../types.js'

describe('DefaultRoutingCapability', () => {
  let router: DefaultRoutingCapability

  beforeEach(() => {
    router = new DefaultRoutingCapability()
  })

  // ============================================================
  // ROUTE REGISTRATION
  // ============================================================

  describe('addRoute', () => {
    it('should register a route', () => {
      router.addRoute({
        id: 'home',
        pattern: '/',
        surfaceId: 'home-surface',
      })

      expect(router.getRouteIds()).toContain('home')
    })

    it('should throw when registering a duplicate route', () => {
      router.addRoute({ id: 'home', pattern: '/', surfaceId: 'home' })

      expect(() => router.addRoute({ id: 'home', pattern: '/other', surfaceId: 'other' })).toThrow(
        "Route 'home' is already registered"
      )
    })

    it('should register multiple routes', () => {
      router.addRoute({ id: 'home', pattern: '/', surfaceId: 'home' })
      router.addRoute({ id: 'about', pattern: '/about', surfaceId: 'about' })
      router.addRoute({ id: 'contact', pattern: '/contact', surfaceId: 'contact' })

      expect(router.getRouteIds()).toHaveLength(3)
    })
  })

  describe('removeRoute', () => {
    it('should remove an existing route', () => {
      router.addRoute({ id: 'home', pattern: '/', surfaceId: 'home' })

      expect(router.removeRoute('home')).toBe(true)
      expect(router.getRouteIds()).toHaveLength(0)
    })

    it('should return false for unknown route', () => {
      expect(router.removeRoute('nonexistent')).toBe(false)
    })
  })

  // ============================================================
  // ROUTE MATCHING
  // ============================================================

  describe('matchRoute', () => {
    it('should match exact paths', () => {
      router.addRoute({ id: 'home', pattern: '/', surfaceId: 'home' })
      router.addRoute({ id: 'about', pattern: '/about', surfaceId: 'about' })

      const result = router.matchRoute('/')
      expect(result.matched).toBe(true)
      if (result.matched) {
        expect(result.match.route.id).toBe('home')
      }

      const aboutResult = router.matchRoute('/about')
      expect(aboutResult.matched).toBe(true)
      if (aboutResult.matched) {
        expect(aboutResult.match.route.id).toBe('about')
      }
    })

    it('should match parameterized paths', () => {
      router.addRoute({
        id: 'user-profile',
        pattern: '/users/:userId',
        surfaceId: 'user-profile',
      })

      const result = router.matchRoute('/users/123')

      expect(result.matched).toBe(true)
      if (result.matched) {
        expect(result.match.route.id).toBe('user-profile')
        expect(result.match.params.userId).toBe('123')
      }
    })

    it('should match paths with multiple parameters', () => {
      router.addRoute({
        id: 'user-post',
        pattern: '/users/:userId/posts/:postId',
        surfaceId: 'user-post',
      })

      const result = router.matchRoute('/users/42/posts/99')

      expect(result.matched).toBe(true)
      if (result.matched) {
        expect(result.match.params.userId).toBe('42')
        expect(result.match.params.postId).toBe('99')
      }
    })

    it('should match wildcard paths', () => {
      router.addRoute({
        id: 'catch-all',
        pattern: '/docs/*',
        surfaceId: 'docs',
      })

      const result = router.matchRoute('/docs/getting-started/install')

      expect(result.matched).toBe(true)
      if (result.matched) {
        expect(result.match.route.id).toBe('catch-all')
      }
    })

    it('should extract query parameters', () => {
      router.addRoute({ id: 'search', pattern: '/search', surfaceId: 'search' })

      const result = router.matchRoute('/search?q=hello&page=2')

      expect(result.matched).toBe(true)
      if (result.matched) {
        expect(result.match.query.q).toBe('hello')
        expect(result.match.query.page).toBe('2')
      }
    })

    it('should extract hash fragment', () => {
      router.addRoute({ id: 'page', pattern: '/page', surfaceId: 'page' })

      const result = router.matchRoute('/page#section-1')

      expect(result.matched).toBe(true)
      if (result.matched) {
        expect(result.match.hash).toBe('section-1')
      }
    })

    it('should return no match for unregistered paths', () => {
      router.addRoute({ id: 'home', pattern: '/', surfaceId: 'home' })

      const result = router.matchRoute('/nonexistent')

      expect(result.matched).toBe(false)
      if (!result.matched) {
        expect(result.reason).toContain('No route matches')
      }
    })

    it('should handle encoded parameters', () => {
      router.addRoute({
        id: 'item',
        pattern: '/items/:name',
        surfaceId: 'item',
      })

      const result = router.matchRoute('/items/hello%20world')

      expect(result.matched).toBe(true)
      if (result.matched) {
        expect(result.match.params.name).toBe('hello world')
      }
    })
  })

  // ============================================================
  // NAVIGATION
  // ============================================================

  describe('navigate', () => {
    beforeEach(() => {
      router.addRoute({ id: 'home', pattern: '/', surfaceId: 'home' })
      router.addRoute({ id: 'about', pattern: '/about', surfaceId: 'about' })
      router.addRoute({
        id: 'user',
        pattern: '/users/:userId',
        surfaceId: 'user-profile',
      })
    })

    it('should navigate to a valid path', async () => {
      const result = await router.navigate({ path: '/about' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.match.route.id).toBe('about')
      }
    })

    it('should update current route after navigation', async () => {
      await router.navigate({ path: '/' })
      expect(router.getCurrentRoute()?.route.id).toBe('home')

      await router.navigate({ path: '/about' })
      expect(router.getCurrentRoute()?.route.id).toBe('about')
    })

    it('should fail for unmatched paths', async () => {
      const result = await router.navigate({ path: '/nonexistent' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toBe('no_match')
      }
    })

    it('should fail when navigating to the same route', async () => {
      await router.navigate({ path: '/about' })
      const result = await router.navigate({ path: '/about' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toBe('same_route')
      }
    })

    it('should add entries to navigation history', async () => {
      await router.navigate({ path: '/' })
      await router.navigate({ path: '/about' })
      await router.navigate({ path: '/users/1' })

      const history = router.getHistory()
      expect(history).toHaveLength(3)
      expect(history[0]?.route.id).toBe('home')
      expect(history[1]?.route.id).toBe('about')
      expect(history[2]?.route.id).toBe('user')
    })

    it('should replace history when replace option is set', async () => {
      await router.navigate({ path: '/' })
      await router.navigate({ path: '/about' })
      await router.navigate({ path: '/users/1', replace: true })

      const history = router.getHistory()
      expect(history).toHaveLength(2)
      expect(history[1]?.route.id).toBe('user')
    })

    it('should notify listeners on navigation', async () => {
      const listener = vi.fn()
      router.onNavigate(listener)

      await router.navigate({ path: '/' })
      await router.navigate({ path: '/about' })

      expect(listener).toHaveBeenCalledTimes(2)

      // Second call should have 'from' set
      const secondCall = listener.mock.calls[1]
      expect(secondCall?.[0].route.id).toBe('about')
      expect(secondCall?.[1]?.route.id).toBe('home')
    })

    it('should unsubscribe listeners correctly', async () => {
      const listener = vi.fn()
      const unsubscribe = router.onNavigate(listener)

      await router.navigate({ path: '/' })
      unsubscribe()
      await router.navigate({ path: '/about' })

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should handle query parameters in navigation', async () => {
      const result = await router.navigate({
        path: '/about',
        query: { ref: 'nav' },
      })

      expect(result.success).toBe(true)
      // The full path with query should still match /about
    })

    it('should execute route guards', async () => {
      const guard: RouteGuard = {
        name: 'auth-guard',
        canActivate: vi.fn().mockReturnValue(true),
      }

      router.addRoute({
        id: 'protected',
        pattern: '/protected',
        surfaceId: 'protected',
        guards: [guard],
      })

      await router.navigate({ path: '/protected' })

      expect(guard.canActivate).toHaveBeenCalledTimes(1)
    })

    it('should reject navigation when guard returns false', async () => {
      const guard: RouteGuard = {
        name: 'deny-guard',
        canActivate: () => false,
      }

      router.addRoute({
        id: 'denied',
        pattern: '/denied',
        surfaceId: 'denied',
        guards: [guard],
      })

      const result = await router.navigate({ path: '/denied' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toBe('guard_rejected')
      }
    })

    it('should handle async guards', async () => {
      const guard: RouteGuard = {
        name: 'async-guard',
        canActivate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return true
        },
      }

      router.addRoute({
        id: 'async-protected',
        pattern: '/async',
        surfaceId: 'async',
        guards: [guard],
      })

      const result = await router.navigate({ path: '/async' })

      expect(result.success).toBe(true)
    })
  })

  // ============================================================
  // RESOLVE PARAMS
  // ============================================================

  describe('resolveParams', () => {
    it('should replace parameters in a pattern', () => {
      const result = router.resolveParams('/users/:userId/posts/:postId', {
        userId: '42',
        postId: '99',
      })

      expect(result).toBe('/users/42/posts/99')
    })

    it('should encode special characters', () => {
      const result = router.resolveParams('/items/:name', {
        name: 'hello world',
      })

      expect(result).toBe('/items/hello%20world')
    })

    it('should leave unmatched parameters in pattern', () => {
      const result = router.resolveParams('/users/:userId', {})

      expect(result).toBe('/users/:userId')
    })
  })

  // ============================================================
  // CLEAR
  // ============================================================

  describe('clear', () => {
    it('should clear all routes and state', async () => {
      router.addRoute({ id: 'home', pattern: '/', surfaceId: 'home' })
      await router.navigate({ path: '/' })

      router.clear()

      expect(router.getRouteIds()).toHaveLength(0)
      expect(router.getCurrentRoute()).toBeUndefined()
      expect(router.getHistory()).toHaveLength(0)
    })
  })
})

describe('createRoutingCapability', () => {
  it('should create a DefaultRoutingCapability instance', () => {
    const router = createRoutingCapability()
    expect(router).toBeInstanceOf(DefaultRoutingCapability)
  })

  it('should accept options', () => {
    const router = createRoutingCapability({ maxHistorySize: 10 })
    expect(router).toBeInstanceOf(DefaultRoutingCapability)
  })
})
