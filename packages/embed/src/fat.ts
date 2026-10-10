/**
 * Fat mode renderer — fully offline.
 *
 * Renders a surface with NO API and NO auth. The surface JSON, its block
 * bundle descriptors, and its appearance are all provided inline by the
 * caller. Capabilities default to the offline stubs (in-memory entity facade,
 * inert navigation), so a surface that declares capabilities still renders.
 *
 * Offline block loading: `DynamicBlockDescriptor.moduleUrl` may be a `data:`
 * URL (or any URL the host can `fetch`). The runtime's `BlockModuleLoader`
 * fetches the bytes, SHA-256-verifies them against `descriptor.integrity`,
 * and `import()`s the resulting Blob URL — all client-side, no server. As long
 * as the descriptors carry inline `data:` module URLs + correct integrity
 * hashes, the whole render is self-contained.
 *
 * @module @pwfabric/embed/fat
 */

import { mountSurface, type SurfaceMountHandle } from './render-core.js'
import { createOfflineEntityFacade, createOfflineNavigationProvider } from './capabilities-stub.js'
import { isCapability } from '@pwfabric/runtime/capability'
import type { RenderCoreOptions } from './render-core.js'
import type {
  EntityFacade,
  CapabilityProvider,
  RenderableSurface,
  SurfaceConnectionsValue,
  DataServiceConfig,
  SurfaceDataCache,
} from '@pwfabric/runtime'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'

// ============================================================
// TYPES
// ============================================================

export interface RenderFatOptions {
  /** The surface to render (inline JSON). */
  readonly surface: RenderableSurface

  /**
   * Block bundle descriptors. `moduleUrl` is typically a `data:text/javascript`
   * URL for full offline self-containment; integrity must match the bytes.
   */
  readonly blocks?: readonly DynamicBlockDescriptor[]

  /**
   * Capability providers. When omitted, offline stubs are auto-supplied for
   * any capability the surface declares (entities → in-memory facade,
   * navigation → inert provider).
   */
  readonly capabilities?: CapabilityProvider[]

  /** Override the auto-created offline entity facade. */
  readonly entityFacade?: EntityFacade

  /**
   * Connector/provider engine registry + configured
   * connections. The runner builds this from the export's shipped engine
   * bundles + the PKCE auth token, so connector panels (chat-panel etc.) run
   * against real engines. Threaded to the data-bound renderer, which exposes it
   * via `SurfaceConnectionsContext`.
   */
  readonly connections?: SurfaceConnectionsValue
  /**
   * How the data layer authenticates its requests.
   *
   * Carries the resolver a pwapp runner supplies for the VISITOR's own
   * session: a source that names an `authProviderRef` gets an
   * `Authorization: Bearer` header for it. Declared here because fat mode is
   * how a published app renders, and a published app behind a sign-in has to
   * fetch its own records as the person who signed in.
   */
  readonly dataServiceConfig?: DataServiceConfig
  readonly loadingStrategy?: 'gate' | 'immediate'
  readonly dataCache?: SurfaceDataCache

  /** Inline appearance ref; overrides `surface.appearance` when given. */
  readonly appearance?: RenderableSurface['appearance']

  /**
   * Hydrate existing server-rendered markup in `target` instead of a fresh
   * client-only mount. See `MountSurfaceOptions.hydrate`.
   */
  readonly hydrate?: boolean

  // Passthrough render options.
  readonly theme?: RenderCoreOptions['theme']
  readonly viewport?: RenderCoreOptions['viewport']
  readonly interactionMode?: RenderCoreOptions['interactionMode']
  readonly basePath?: RenderCoreOptions['basePath']
  readonly imageAdapter?: RenderCoreOptions['imageAdapter']
  readonly components?: RenderCoreOptions['components']
  readonly onEvent?: RenderCoreOptions['onEvent']
  readonly gap?: RenderCoreOptions['gap']
  readonly padding?: RenderCoreOptions['padding']
  /** See `RenderCoreOptions.placeholderMissingBlocks` — preview hosts only. */
  readonly placeholderMissingBlocks?: RenderCoreOptions['placeholderMissingBlocks']
}

/**
 * The handle fat mode returns. `update` re-renders new fat options into the
 * SAME root, through the same option translation the first mount used — so a
 * host holding fat options (blocks, appearance override, offline stubs) never
 * has to rebuild the core options by hand.
 */
export interface FatMountHandle extends SurfaceMountHandle {
  update(opts: RenderFatOptions): void
}

// ============================================================
// HELPERS
// ============================================================

function surfaceDeclares(surface: RenderableSurface, capability: string): boolean {
  // Compare CANONICALLY. A receipt may spell a capability short (`entities`)
  // or long (`platform/entities`); a raw `===` misses the short form and this
  // path builds neither the offline navigation provider nor the entity facade —
  // the panel silently stays empty. The three sibling call sites use
  // `isCapability` too.
  return (surface.capabilities ?? []).some((c: { capability?: string }) => isCapability(c, capability))
}

/**
 * Build the capability list + entity facade for an offline render, supplying
 * stubs for any declared capability the caller didn't provide.
 */
export function resolveOfflineCapabilities(opts: RenderFatOptions): {
  capabilities: CapabilityProvider[]
  entityFacade: EntityFacade | undefined
} {
  const capabilities: CapabilityProvider[] = [...(opts.capabilities ?? [])]

  // Navigation stub when declared and not already supplied.
  if (
    surfaceDeclares(opts.surface, 'platform/navigation') &&
    !capabilities.some((c) => c.type === 'navigation')
  ) {
    capabilities.push(
      createOfflineNavigationProvider(opts.basePath ? { basePath: opts.basePath } : {})
    )
  }

  // Entity facade: explicit > auto-created (when entities declared).
  let entityFacade = opts.entityFacade
  if (!entityFacade && surfaceDeclares(opts.surface, 'platform/entities')) {
    entityFacade = createOfflineEntityFacade()
  }

  return { capabilities, entityFacade }
}

// ============================================================
// RENDER
// ============================================================

/**
 * Translate fat options into the shared core options: offline capability
 * stubs, the appearance override folded into the surface, every passthrough.
 */
export function fatCoreOptions(opts: RenderFatOptions): RenderCoreOptions {
  const { capabilities, entityFacade } = resolveOfflineCapabilities(opts)

  // `appearance` is a distinct, top-level override — RenderCoreOptions has no
  // separate appearance channel, so the ONLY way it reaches SurfaceRenderer
  // is via `surface.appearance`. Merge it in here (rather than relying on the
  // caller to have baked it into the surface already) so `opts.appearance`
  // actually does what its doc comment says instead of being silently dropped.
  const surface = opts.appearance ? { ...opts.surface, appearance: opts.appearance } : opts.surface

  return {
    surface,
    ...(opts.blocks ? { dynamicBlocks: opts.blocks } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(entityFacade ? { entityFacade } : {}),
    ...(opts.connections ? { connections: opts.connections } : {}),
    // A HAND-COPIED LIST. `RenderFatOptions` declares this and
    // `RenderCoreOptions` accepts it; this line is the copy between them.
    // Without it a pwapp visitor signs in, the gate lifts, and every data
    // request still goes out anonymous — `getAccessToken` is never called
    // because the DataService has no config.
    ...(opts.dataServiceConfig ? { dataServiceConfig: opts.dataServiceConfig } : {}),
    ...(opts.loadingStrategy !== undefined ? { loadingStrategy: opts.loadingStrategy } : {}),
    ...(opts.dataCache !== undefined ? { dataCache: opts.dataCache } : {}),
    ...(opts.theme !== undefined ? { theme: opts.theme } : {}),
    ...(opts.viewport !== undefined ? { viewport: opts.viewport } : {}),
    ...(opts.interactionMode !== undefined ? { interactionMode: opts.interactionMode } : {}),
    ...(opts.basePath !== undefined ? { basePath: opts.basePath } : {}),
    ...(opts.imageAdapter !== undefined ? { imageAdapter: opts.imageAdapter } : {}),
    ...(opts.components !== undefined ? { components: opts.components } : {}),
    ...(opts.onEvent !== undefined ? { onEvent: opts.onEvent } : {}),
    ...(opts.gap !== undefined ? { gap: opts.gap } : {}),
    ...(opts.padding !== undefined ? { padding: opts.padding } : {}),
    ...(opts.placeholderMissingBlocks !== undefined
      ? { placeholderMissingBlocks: opts.placeholderMissingBlocks }
      : {}),
  }
}

/**
 * Render a surface fully offline into `target`.
 */
export function renderFat(
  target: HTMLElement | string,
  opts: RenderFatOptions
): FatMountHandle {
  const core = fatCoreOptions(opts)
  const handle = mountSurface(target, core, opts.hydrate ? { hydrate: true } : undefined)
  // The offline entity facade the first mount created holds the page's
  // in-memory records. An update that supplies none keeps that one instead of
  // starting from an empty store on every edit.
  const firstFacade = core.entityFacade
  return {
    container: handle.container,
    unmount: () => handle.unmount(),
    render: (next) => handle.render(next),
    update(next: RenderFatOptions) {
      const withFacade = !next.entityFacade && firstFacade ? { ...next, entityFacade: firstFacade } : next
      handle.render(fatCoreOptions(withFacade))
    },
  }
}
