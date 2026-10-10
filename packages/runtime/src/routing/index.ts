/**
 * Routing Capability Module
 *
 * Route matching, navigation, and URL parameter resolution
 *
 * Exports:
 * - Types: RouteDefinition, RouteMatch, NavigationTarget, RoutingCapability, etc.
 * - Implementations: DefaultRoutingCapability
 * - Factory functions: createRoutingCapability
 *
 * @module @pwfabric/runtime/routing
 */

// Types
export type {
  RouteDefinition,
  RouteGuard,
  RouteGuardContext,
  RouteMatchResult,
  RouteMatch,
  NavigationTarget,
  NavigationResult,
  NavigationFailureReason,
  NavigationListener,
  RoutingCapability,
} from './types.js'

// Implementations
export { DefaultRoutingCapability, createRoutingCapability } from './router.js'
