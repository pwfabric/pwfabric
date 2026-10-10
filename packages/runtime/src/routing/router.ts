/**
 * Routing Capability Implementation
 *
 * Route matching, navigation, and parameter resolution
 *
 * @module @pwfabric/runtime/routing/router
 */

import type {
  RoutingCapability,
  RouteDefinition,
  RouteMatch,
  RouteMatchResult,
  NavigationTarget,
  NavigationResult,
  NavigationListener,
} from './types.js'

// ============================================================
// COMPILED ROUTE
// ============================================================

interface CompiledRoute {
  definition: RouteDefinition
  regex: RegExp
  paramNames: string[]
}

// ============================================================
// DEFAULT ROUTING CAPABILITY
// ============================================================

/**
 * Default routing capability implementation
 */
export class DefaultRoutingCapability implements RoutingCapability {
  private readonly routes = new Map<string, CompiledRoute>()
  private readonly listeners = new Set<NavigationListener>()
  private readonly navigationHistory: RouteMatch[] = []
  private currentRoute: RouteMatch | undefined = undefined
  private readonly maxHistorySize: number

  constructor(options?: { maxHistorySize?: number }) {
    this.maxHistorySize = options?.maxHistorySize ?? 50
  }

  addRoute(route: RouteDefinition): void {
    if (this.routes.has(route.id)) {
      throw new Error(`Route '${route.id}' is already registered`)
    }
    const compiled = this.compileRoute(route)
    this.routes.set(route.id, compiled)
  }

  removeRoute(routeId: string): boolean {
    return this.routes.delete(routeId)
  }

  matchRoute(path: string): RouteMatchResult {
    const { pathname, query, hash } = this.parsePath(path)

    for (const compiled of this.routes.values()) {
      const match = this.tryMatch(compiled, pathname, query, hash)
      if (match) {
        return { matched: true, match }
      }
    }

    return { matched: false, reason: `No route matches path: ${path}` }
  }

  async navigate(target: NavigationTarget): Promise<NavigationResult> {
    const fullPath = this.buildPath(target)
    const matchResult = this.matchRoute(fullPath)

    if (!matchResult.matched) {
      return { success: false, reason: 'no_match' }
    }

    const match = matchResult.match

    // Check if navigating to the same route
    if (
      this.currentRoute &&
      this.currentRoute.route.id === match.route.id &&
      this.currentRoute.path === match.path
    ) {
      return { success: false, reason: 'same_route' }
    }

    // Execute guards
    if (match.route.guards && match.route.guards.length > 0) {
      for (const guard of match.route.guards) {
        const canActivate = await guard.canActivate({
          from: this.currentRoute,
          to: match,
          params: match.params,
        })
        if (!canActivate) {
          return { success: false, reason: 'guard_rejected' }
        }
      }
    }

    // Update current route
    const previousRoute = this.currentRoute
    this.currentRoute = match

    // Add to history
    if (!target.replace) {
      this.navigationHistory.push(match)
      while (this.navigationHistory.length > this.maxHistorySize) {
        this.navigationHistory.shift()
      }
    } else if (this.navigationHistory.length > 0) {
      this.navigationHistory[this.navigationHistory.length - 1] = match
    } else {
      this.navigationHistory.push(match)
    }

    // Notify listeners
    this.notifyListeners(match, previousRoute)

    return { success: true, match }
  }

  resolveParams(pattern: string, params: Record<string, string>): string {
    let resolved = pattern
    for (const [key, value] of Object.entries(params)) {
      resolved = resolved.replace(`:${key}`, encodeURIComponent(value))
    }
    return resolved
  }

  getCurrentRoute(): RouteMatch | undefined {
    return this.currentRoute
  }

  getHistory(): readonly RouteMatch[] {
    return [...this.navigationHistory]
  }

  onNavigate(listener: NavigationListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getRouteIds(): readonly string[] {
    return Array.from(this.routes.keys())
  }

  clear(): void {
    this.routes.clear()
    this.listeners.clear()
    this.navigationHistory.length = 0
    this.currentRoute = undefined
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  private compileRoute(route: RouteDefinition): CompiledRoute {
    const paramNames: string[] = []

    // Convert pattern to regex
    // :param -> named capture group
    // * -> wildcard capture
    let regexStr = route.pattern
      .replace(/\/:(\w+)/g, (_match, paramName: string) => {
        paramNames.push(paramName)
        return '/([^/]+)'
      })
      .replace(/\*$/, '(.*)')

    // Ensure exact match (anchor start and end)
    regexStr = `^${regexStr}$`

    return {
      definition: route,
      regex: new RegExp(regexStr),
      paramNames,
    }
  }

  private tryMatch(
    compiled: CompiledRoute,
    pathname: string,
    query: Record<string, string>,
    hash: string
  ): RouteMatch | null {
    const match = pathname.match(compiled.regex)
    if (!match) return null

    const params: Record<string, string> = {}
    for (let i = 0; i < compiled.paramNames.length; i++) {
      const name = compiled.paramNames[i]
      const value = match[i + 1]
      if (name && value !== undefined) {
        params[name] = decodeURIComponent(value)
      }
    }

    return {
      route: compiled.definition,
      params,
      query,
      path: pathname,
      hash,
    }
  }

  private parsePath(path: string): {
    pathname: string
    query: Record<string, string>
    hash: string
  } {
    let pathname = path
    let hash = ''
    const query: Record<string, string> = {}

    // Extract hash
    const hashIndex = pathname.indexOf('#')
    if (hashIndex >= 0) {
      hash = pathname.slice(hashIndex + 1)
      pathname = pathname.slice(0, hashIndex)
    }

    // Extract query
    const queryIndex = pathname.indexOf('?')
    if (queryIndex >= 0) {
      const queryString = pathname.slice(queryIndex + 1)
      pathname = pathname.slice(0, queryIndex)

      for (const pair of queryString.split('&')) {
        const [key, value] = pair.split('=')
        if (key) {
          query[decodeURIComponent(key)] = value ? decodeURIComponent(value) : ''
        }
      }
    }

    // Normalize pathname
    if (!pathname.startsWith('/')) {
      pathname = '/' + pathname
    }

    return { pathname, query, hash }
  }

  private buildPath(target: NavigationTarget): string {
    let path = target.path

    if (target.query && Object.keys(target.query).length > 0) {
      const queryParts = Object.entries(target.query).map(
        ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      )
      path += '?' + queryParts.join('&')
    }

    if (target.hash) {
      path += '#' + target.hash
    }

    return path
  }

  private notifyListeners(to: RouteMatch, from: RouteMatch | undefined): void {
    for (const listener of this.listeners) {
      try {
        listener(to, from)
      } catch {
        // Swallow listener errors
      }
    }
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create a routing capability instance
 */
export function createRoutingCapability(options?: { maxHistorySize?: number }): RoutingCapability {
  return new DefaultRoutingCapability(options)
}
