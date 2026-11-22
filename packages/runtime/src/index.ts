/**
 * @pwfabric/runtime
 *
 * Runtime and execution engine for the PWFabric platform.
 *
 * Runtime spine implementation
 * Surface rendering pipeline, layout system, primitives
 * Binding engine, auth, cache, graph resolver
 *
 * @module @pwfabric/runtime
 */

// Re-export contracts for convenience
export * from '@pwfabric/contracts'

// Fabric kernel
export { FabricKernel, createFabric } from './kernel.js'

// Capability registry
export { type CapabilityRegistry, InMemoryCapabilityRegistry, createRegistry } from './registry.js'

// Contract validator
export {
  type ContractValidator,
  RuntimeContractValidator,
  createValidator,
  isValidationSuccess,
  isValidationFailure,
  formatValidationErrors,
} from './validator.js'

// Event bus
export { InMemoryEventBus, createEventBus, createFabricEvent } from './bus.js'

// Execution context
export {
  type InvocationHandler,
  RuntimeExecutionContext,
  ConsoleExecutionLogger,
  NoOpExecutionLogger,
  createExecutionContext,
  generateTraceId,
  generateSpanId,
  type CreateExecutionContextOptions,
} from './execution-context.js'

// Legacy exports (for backward compatibility)
export * from './context.js'
export * from './executor.js'

// Surface rendering pipeline
export * from './surface/index.js'

// Binding, cache. The Microsoft Graph resolver is `@pwfabric/runtime/graph`:
// no page draws through it, and this root is what every visitor's page carries
// (embed.js exposes it whole to blocks).
export * from './binding/index.js'
export * from './cache/index.js'

// Auth is intentionally NOT part of the default export: it holds the
// MSAL/API-key providers, and pulling them into the default barrel would make
// every consumer of `.` — including `@pwfabric/embed`'s browser-facing IIFE
// build — carry them along. Available explicitly via `@pwfabric/runtime/auth`.

// State and forms capabilities
export * from './state/index.js'
export * from './forms/index.js'

// Entity system
export * from './entity/index.js'

// Connector engine loading + registry (platform-side
// execution of CONNECTOR/PROVIDER atom engines)
export * from './connectors/index.js'
export { SurfaceConnectionsContext, useSurfaceConnections } from './render/index.js'

// Surface renderer (avoiding duplicates with surface/index.js)
export type {
  BlockComponentProps,
  BlockComponent,
  BlockComponentRegistry,
  CapabilityProvider,
  BlockContext,
  ConsentAnswers,
  ConsentStore,
  SurfaceEventType,
  SurfaceEvent,
  SurfaceRendererProps,
  BlockRendererProps,
  RenderableSurface,
  CapabilityType,
  ImageAdapter,
  ImageAdapterProps,
  SurfaceDataSourceKind,
  SurfaceDataSourceDefinition,
  SurfaceActionType,
  SurfaceAction,
  BlockActionProp,
  AuthAction,
  AuthActionType,
  SurfaceAuthState,
  SurfaceAuthUser,
  SurfaceAuthHost,
  DataBoundSurface,
  DataBoundSurfaceRendererProps,
} from './render/index.js'

// Capability Gate (Entitlement enforcement)
export type {
  EntitlementContextValue,
  EntitlementProviderProps,
  GatedBlockPlaceholderProps,
} from './render/index.js'
export { EntitlementProvider, useEntitlements, GatedBlockPlaceholder } from './render/index.js'

// Dynamic Artifact Loading
export type {
  DynamicBlockWrapperProps,
  DynamicArtifactContextValue,
  DynamicArtifactProviderProps,
} from './render/index.js'
export {
  BlockModuleLoader,
  DynamicBlockWrapper,
  DynamicArtifactProvider,
  preloadDynamicBlocks,
  useDynamicBlocks,
  useDynamicStarters,
} from './render/index.js'

// Block Error Boundary (crash isolation)
export { BlockErrorBoundary } from './render/index.js'
export { dataSourceCacheKey } from './render/index.js'
export type { SurfaceDataCache, LinkHref } from './render/index.js'

// Surface event protocol
export { createSurfaceEventBus } from './render/index.js'
export { SurfaceEventContext } from './render/index.js'
export { useSurfaceEvents } from './render/index.js'

// BehaviorSurfaceProvider — runtime surface wiring
export type { BehaviorSurfaceProviderProps } from './render/index.js'
export { BehaviorSurfaceProvider } from './render/index.js'
export { SurfaceIdContext } from './render/index.js'
export { useSurfaceId } from './render/index.js'

// Shell × body: SPLIT shell selection (URL-projected), and the shell/body
// classification the renderer lays out by.
export type {
  ShellSelectionStore,
  ShellSelectionOptions,
  ShellSelectionProviderProps,
  SurfaceAddress,
} from './render/index.js'
export type { LiteralProps } from './render/index.js'
export { documentAddress, SurfaceAddressContext } from './render/index.js'

// The app's words: a block's own words (`ui.*` ids) read through useAppMessage
export type { AppMessages, MessageVars } from './render/index.js'
export {
  AppLocaleContext,
  AppMessagesContext,
  useAppMessage,
  useAppMessages,
  formatMessage,
  messageOf,
  pluralProblems,
  appMessagesOf,
} from './render/index.js'
export {
  ShellSelectionContext,
  ShellSelectionProvider,
  createShellSelectionStore,
  useShellSelection,
} from './render/index.js'

// Image Adapters
export { DefaultImageAdapter, NextImageAdapter } from './adapters/index.js'
export {
  SurfaceRenderer as BlockSurfaceRenderer,
  BlockRenderer,
  getBlockIds,
  findBlockById,
  updateBlockById,
  DataBoundSurfaceRenderer,
  surfaceNeedsDataBinding,
  blockActionsOf,
  resolveEndpoint,
  resolveBlockExpressions,
  literalPropsOf,
  // What the renderer applies to every block's props, given or loaded
  // (render/block-props.ts). A host drawing blocks through the renderer does
  // not call it; it is here for one that draws a block by hand.
  blockPropsForRender,
  resolveString,
  isHrefKey,
  isLinkMember,
  isExpressionLink,
  isMediaLink,
  mediaLinkOf,
  surfaceThemeToCSS,
} from './render/index.js'
// legacy first-party `*Block` component re-exports +
// `defaultBlockComponents` map retired. Production rendering loads
// components from CDN bundles via `BlockModuleLoader`; the static
// component registry no longer ships from this package.

// Capability system (definitions, type mapping, validation)
export * from './capability/index.js'

// Data, routing, i18n capabilities. SEO tags are written at build (the shell's
// head) and by the runner on navigation, so the SEO generator is
// `@pwfabric/runtime/seo`; the analytics tracker is `@pwfabric/runtime/analytics`
// and the performance reporter `@pwfabric/runtime/perf`. None is on a visitor's
// page, which carries this root whole (embed.js exposes it to blocks).
export * from './data/index.js'
export * from './routing/index.js'
export * from './i18n/index.js'

// Accessibility (a11y) module
export type { AnnouncementLevel, LiveRegionConfig } from './a11y/index.js'
export { LiveRegionAnnouncer, createAnnouncer } from './a11y/index.js'
export type { FocusTrapConfig } from './a11y/index.js'
export {
  FocusTrapManager,
  FocusRestorer,
  createSkipLink,
  createFocusTrap,
  createFocusRestorer,
} from './a11y/index.js'
export type { ArrowDirection, KeyboardNavConfig } from './a11y/index.js'
export {
  KeyboardNavigationManager,
  RovingTabIndex,
  createKeyboardNav,
  createRovingTabIndex,
} from './a11y/index.js'
export type { ContrastResult } from './a11y/index.js'
export {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  checkContrast,
  meetsWCAG,
} from './a11y/index.js'

// tenant-scoped pack atom registry hook
export {
  useInstalledAtoms,
  type InstalledAtomDescriptor,
  type InstalledAtomKind,
  type InstalledAtomsState,
  type InstalledAtomsFetcher,
  type AtomManifestPayload,
  type AtomBlockDefinitionMetadata,
} from './hooks/useInstalledAtoms.js'

// The engine names no tenant: a host's tenant model (plan, entitlements,
// storage, installations) belongs to the host.
//
// What the engine offers is the mechanism without the vocabulary: `EntitlementProvider`
// and `useEntitlements` in ./render/capability-gate.tsx still enforce a claim
// set, typed structurally as `EntitlementClaims`.

// canonical home for block infrastructure (registry,
// composition rules, rule engine, contexts, hooks, default block
// components, schemas, 45 first-party block defs). Subpath import
// `@pwfabric/runtime/blocks` is the recommended consumer entry; the root
// re-exports above (SurfaceEventContext / useSurfaceEvents /
// SurfaceIdContext / useSurfaceId / defaultBlockComponents / 21 block
// components) now resolve via `runtime/render/*` → `runtime/blocks/*`
// preserving React-context identity.
