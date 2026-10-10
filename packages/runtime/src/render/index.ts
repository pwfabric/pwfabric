/**
 * Surface Renderer Module
 *
 * Phase 2A.1: Surface-to-React rendering infrastructure
 *
 * @module @pwfabric/runtime/render
 */

// Types
export type {
  BlockComponentProps,
  BlockComponent,
  BlockComponentRegistry,
  CapabilityProvider,
  BlockContext,
  SurfaceEventType,
  SurfaceEvent,
  SurfaceRendererProps,
  BlockRendererProps,
  RenderResult,
  RenderableSurface,
  CapabilityType,
  ImageAdapter,
  ImageAdapterProps,
  BlockWrapperProps,
  BlockWrapperRenderArgs,
  BlockInteractionMode,
} from './types.js'

// Components
export {
  SurfaceRenderer,
  BlockRenderer,
  getBlockIds,
  findBlockById,
  updateBlockById,
} from './renderer.js'

// legacy first-party `*Block` component re-exports +
// `defaultBlockComponents` retired. Components flow through the install
// pipeline (pwpack publish → CDN bundle → BlockModuleLoader); the static
// re-exports that lived here are gone.

// Theme utilities
export { surfaceThemeToCSS } from './theme-utils.js'
export { deriveDarkTheme } from './derive-dark-theme.js'

// Responsive utilities
export {
  resolveResponsiveValue,
  resolveSpanAtBreakpoint,
  getColumnsAtBreakpoint,
  getBreakpointForWidth,
  resolveBlockLayout,
  resolveMeasureStyle,
  resolveSurfaceRootStyle,
  useViewport,
} from './responsive.js'

// Per-breakpoint visibility (hideOn/showOn) CSS generation
export {
  collectVisibilityCss,
  blockVisibilityCss,
  resolveHiddenBreakpoints,
} from './visibility-css.js'

// Interaction-state (hover/active/focus) CSS generation
export { collectStatesCss, blockStatesCss } from './states-css.js'

// Conditional-state (aria/data/disabled/checked/:has) CSS generation
export {
  collectConditionalStatesCss,
  blockConditionalStatesCss,
} from './conditional-states-css.js'

// Surface keyframe registry (appearance.config.keyframes) CSS generation
export { buildKeyframesCss } from './keyframes-css.js'

// Per-prop responsive style (block.style breakpoint maps) CSS generation
export {
  collectResponsiveStyleCss,
  blockResponsiveStyleCss,
} from './responsive-style-css.js'

// Group-hover (block.groupRoot + descendant block.groupStates) CSS generation
export { collectGroupStatesCss, blockGroupStatesCss } from './group-states-css.js'

// Shared scoped-CSS helpers (used by the per-block collectors above)
export {
  cssEscapeId,
  camelToKebab,
  blockIdAttr,
  blockSelector,
  collectScopedCss,
} from './scoped-css.js'

// Dark theme variant CSS generation + resolver
export { buildDarkThemeCss } from './dark-theme-css.js'
export { resolveAppearanceDarkVars, resolveAppearanceKeyframes } from './appearance-resolver.js'

// Data-bound rendering
export type {
  SurfaceDataSourceKind,
  SurfaceDataSourceDefinition,
  SurfaceActionType,
  SurfaceAction,
  BlockActionProp,
  DataBoundSurface,
  DataBoundSurfaceRendererProps,
} from './data-binding-types.js'

export { DataBoundSurfaceRenderer, surfaceNeedsDataBinding, blockActionsOf } from './DataBoundSurfaceRenderer.js'
export { resolveEndpoint, encodeEndpointValue } from './endpoint.js'
export { dataSourceCacheKey } from './data-cache.js'
export type { SurfaceDataCache } from './data-cache.js'
export { resolveBlockExpressions, resolveString } from './resolve-expressions.js'

// Block Error Boundary (crash isolation)
export { BlockErrorBoundary } from './BlockErrorBoundary.js'

// Capability Gate (Entitlement enforcement)
export type {
  EntitlementContextValue,
  EntitlementProviderProps,
  GatedBlockPlaceholderProps,
} from './capability-gate.js'
export { EntitlementProvider, useEntitlements, GatedBlockPlaceholder } from './capability-gate.js'

// Dynamic Artifact Loading
export { BlockModuleLoader } from './dynamic-block-loader.js'
export type { DynamicBlockWrapperProps } from './DynamicBlockWrapper.js'
export { DynamicBlockWrapper } from './DynamicBlockWrapper.js'
export type {
  DynamicArtifactContextValue,
  DynamicArtifactProviderProps,
} from './dynamic-artifact-context.js'
export {
  DynamicArtifactProvider,
  preloadDynamicBlocks,
  useDynamicBlocks,
  useDynamicStarters,
} from './dynamic-artifact-context.js'

// Surface event protocol
export { createSurfaceEventBus } from './surface-event-bus.js'
export { SurfaceEventContext } from './surface-event-context.js'
export { useSurfaceEvents } from './hooks/useSurfaceEvents.js'

// BehaviorSurfaceProvider — runtime surface wiring
export type { BehaviorSurfaceProviderProps } from './BehaviorSurfaceProvider.js'
export { BehaviorSurfaceProvider } from './BehaviorSurfaceProvider.js'
export { SurfaceIdContext } from './surface-id-context.js'
export { useSurfaceId } from './hooks/useSurfaceId.js'

// EntityFacade → Surface Renderer integration
export { EntityFacadeContext, useEntityFacade } from './entity-facade-context.js'

// What the data-bound path has currently bound, by source id (form writer reads it)
export { SurfaceDataContext, useSurfaceData } from './surface-data-context.js'
export type { SurfaceData } from './surface-data-context.js'

// Connections context (world connections + engine registry)
export { SurfaceConnectionsContext, useSurfaceConnections } from './connections-context.js'

// Shell × body: SPLIT shell selection, projected onto the URL so a selected
// record can be linked to and the Back button undoes the selection.
export type { ShellSelectionStore, ShellSelectionOptions, ShellSelectionProviderProps } from './shell-selection.js'
export {
  ShellSelectionContext,
  ShellSelectionProvider,
  createShellSelectionStore,
  useShellSelection,
} from './shell-selection.js'
