/**
 * Routing Capability Types
 *
 * Route matching, navigation, and URL parameter resolution
 *
 * @module @pwfabric/runtime/routing/types
 */

// ============================================================
// ROUTE DEFINITION
// ============================================================

/**
 * Route definition for mapping URLs to surfaces
 */
export interface RouteDefinition {
  /** Unique route identifier */
  readonly id: string

  /** URL pattern (supports :param and * wildcard) */
  readonly pattern: string

  /** Surface ID this route maps to */
  readonly surfaceId: string

  /** Human-readable name */
  readonly name?: string

  /** Route metadata */
  readonly metadata?: Readonly<Record<string, unknown>>

  /** Navigation guards for this route */
  readonly guards?: readonly RouteGuard[]

  /** Child routes (for nested routing) */
  readonly children?: readonly RouteDefinition[]
}

/**
 * Route guard function
 */
export interface RouteGuard {
  readonly name: string
  canActivate(context: RouteGuardContext): boolean | Promise<boolean>
}

/**
 * Context provided to route guards
 */
export interface RouteGuardContext {
  readonly from: RouteMatch | undefined
  readonly to: RouteMatch
  readonly params: Readonly<Record<string, string>>
}

// ============================================================
// ROUTE MATCH
// ============================================================

/**
 * Result of matching a URL against routes
 */
export type RouteMatchResult =
  | { readonly matched: true; readonly match: RouteMatch }
  | { readonly matched: false; readonly reason: string }

/**
 * A successfully matched route
 */
export interface RouteMatch {
  /** The matched route definition */
  readonly route: RouteDefinition

  /** Extracted URL parameters */
  readonly params: Readonly<Record<string, string>>

  /** Query parameters */
  readonly query: Readonly<Record<string, string>>

  /** The full matched path */
  readonly path: string

  /** Hash fragment (without #) */
  readonly hash: string
}

// ============================================================
// NAVIGATION
// ============================================================

/**
 * Navigation target
 */
export interface NavigationTarget {
  /** Path to navigate to */
  readonly path: string

  /** Query parameters */
  readonly query?: Readonly<Record<string, string>>

  /** Hash fragment */
  readonly hash?: string

  /** Whether to replace current history entry */
  readonly replace?: boolean

  /** Navigation state data */
  readonly state?: unknown
}

/**
 * Navigation result
 */
export type NavigationResult =
  | { readonly success: true; readonly match: RouteMatch }
  | { readonly success: false; readonly reason: NavigationFailureReason }

/**
 * Reasons navigation can fail
 */
export type NavigationFailureReason = 'no_match' | 'guard_rejected' | 'same_route' | 'aborted'

/**
 * Listener for navigation events
 */
export type NavigationListener = (to: RouteMatch, from: RouteMatch | undefined) => void

// ============================================================
// ROUTING CAPABILITY INTERFACE
// ============================================================

/**
 * Routing capability interface for managing routes and navigation
 */
export interface RoutingCapability {
  /** Register a route definition */
  addRoute(route: RouteDefinition): void

  /** Remove a route by ID */
  removeRoute(routeId: string): boolean

  /** Match a URL path against registered routes */
  matchRoute(path: string): RouteMatchResult

  /** Navigate to a target */
  navigate(target: NavigationTarget): Promise<NavigationResult>

  /** Resolve parameters from a route pattern and values */
  resolveParams(pattern: string, params: Record<string, string>): string

  /** Get the current route match */
  getCurrentRoute(): RouteMatch | undefined

  /** Get navigation history */
  getHistory(): readonly RouteMatch[]

  /** Subscribe to navigation events */
  onNavigate(listener: NavigationListener): () => void

  /** Get all registered route IDs */
  getRouteIds(): readonly string[]

  /** Clear all routes */
  clear(): void
}
