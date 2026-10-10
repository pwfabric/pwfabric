/**
 * BehaviorSurfaceProvider
 *
 * React provider that wraps a surface render session with a
 * stable `SurfaceEventBus` instance and the real `surfaceId`.
 *
 * When `entityFormBindings` are supplied and an EntityFacade
 * is available via EntityFacadeContext, automatically attaches form→entity
 * bridges on mount and tears them down on unmount.
 *
 * All block children receive both values via context so they can emit events
 * that carry a meaningful surface ID without prop-drilling.
 *
 * Lifecycle:
 * - Emits `surface:load` on mount
 * - Emits `surface:unload` on unmount
 * - Re-creates the bus (and re-emits lifecycle events) when `surfaceId` changes
 *
 * @module @pwfabric/runtime/render/BehaviorSurfaceProvider
 */

import * as React from 'react'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import type { SurfaceEventDescriptor } from '@pwfabric/contracts'
import { SurfaceEventContext } from './surface-event-context.js'
import { SurfaceIdContext } from './surface-id-context.js'
import { createSurfaceEventBus } from './surface-event-bus.js'
import { useEntityFacade } from './entity-facade-context.js'
import { useOptionalDataService } from '../data/DataCapabilityProvider.js'
import { useSurfaceData } from './surface-data-context.js'
import { attachFormEntityBridge } from '../forms/form-entity-bridge.js'
import type { FormWriter } from '../forms/form-entity-bridge.js'
import { resolveFormWriteTarget, toFormWriteError } from '../forms/form-write-target.js'
import type { SurfaceDataSourceDefinition } from './data-binding-types.js'
import type { FormEntityBridgeConfig } from '../forms/form-entity-bridge.js'
import { completeNamedControlValues } from '../forms/named-control-values.js'
import type { Block } from '@pwfabric/core'

export interface BehaviorSurfaceProviderProps {
  /** The ID of the surface being rendered */
  readonly surfaceId: string
  /** Block render tree */
  readonly children: React.ReactNode
  /**
   * Declarative form→entity bridge configurations extracted
   * from `surface.capabilities` (platform/entities config.formBindings).
   * When provided and EntityFacade is available, bridges are auto-attached on
   * mount and torn down on unmount.
   */
  readonly entityFormBindings?: readonly FormEntityBridgeConfig[]
  /**
   * The read sources, so a form's `sourceId` can be resolved to a destination.
   * A source that names an entity type writes through the facade; anything
   * else is an address and writes over HTTP.
   */
  readonly dataSources?: readonly SurfaceDataSourceDefinition[]
  /**
   * The surface renderer's single event handler. Subscribed to the bus via the
   * global `*` wildcard so EVERY block-emitted event (with its full payload,
   * incl. a declarative `action`) reaches the action dispatcher + host
   * notification — the canonical path replacing the retired legacy
   * `context.onEvent` shim that blocks used to call directly.
   */
  readonly onEvent?: (event: SurfaceEventDescriptor) => void
  /**
   * The rendered (resolved) block tree, so a form's submission can be
   * completed with the named controls inside it that `FormData` cannot see —
   * read from page state by their `stateKey`.
   */
  readonly blocks?: readonly Block[]
}

/**
 * Wraps a surface render tree with a scoped `SurfaceEventBus` and `surfaceId`.
 *
 * Place this as the outermost wrapper inside `SurfaceRenderer` so every block
 * in the tree can call `useSurfaceEvents()` and `useSurfaceId()`.
 */
export function BehaviorSurfaceProvider({
  surfaceId,
  children,
  entityFormBindings,
  dataSources,
  onEvent,
  blocks,
}: BehaviorSurfaceProviderProps): React.ReactElement {
  // Canonical event path: the renderer's handler is subscribed to the global `*`
  // wildcard. Every block emits through the bus (useSurfaceEvents) → this handler
  // dispatches declarative actions (setState/refresh) + forwards to the host.
  // A ref keeps the subscription stable while always calling the latest handler.
  const onEventRef = React.useRef(onEvent)
  onEventRef.current = onEvent

  // Re-create the bus when surfaceId changes so sibling surfaces stay isolated.
  //
  // The `*` subscription is attached HERE, at construction, rather than in an
  // effect. `bus.emit` is synchronous and unbuffered: an event emitted while
  // `handlers.get('*')` is empty is dropped and never replayed. React runs
  // effects CHILD-FIRST, so a subscription owned by this provider would attach
  // only after every block's own mount effect had already run — meaning any
  // block that emits from its mount effect had its event silently swallowed,
  // deterministically. The same gap opened, more narrowly, for interactions
  // landing between a commit and its passive-effect flush, which is what made
  // `dispatch-actions.dom` / `entity-list-reactive-repro.dom` flaky.
  //
  // Subscribing during render is safe here because the bus is constructed in
  // this same factory: nothing outside observes it before we return, so there
  // is no external mutation and re-running the factory yields an independent
  // bus. No explicit teardown is needed either — the handler is reachable only
  // through the bus, so a discarded bus takes its listener with it.
  const bus = React.useMemo(() => {
    const created = createSurfaceEventBus()
    created.on('*', (event) => onEventRef.current?.(event))
    return created
  }, [surfaceId])

  React.useEffect(() => {
    bus.emit({ type: SURFACE_EVENTS.SURFACE_LOAD, surfaceId, timestamp: Date.now() })
    return () => {
      bus.emit({ type: SURFACE_EVENTS.SURFACE_UNLOAD, surfaceId, timestamp: Date.now() })
    }
  }, [bus, surfaceId])

  // auto-wire form→entity bridges when EntityFacade is available.
  //
  // Attached during render, for the same reason the `*` handler above is: a
  // bridge that subscribes from an effect is not listening yet while the blocks
  // it serves are already interactive, and `bus.emit` drops what nobody is
  // listening for. A form submitted in that window lost its create outright —
  // the residual flake in `entity-list-reactive-repro.dom` after the `*` fix,
  // where the wildcard handler saw `form:submit` but the bridge never did.
  //
  // Previous bridges are torn down before new ones attach, so re-running this
  // (deps change, or a StrictMode double render) never stacks duplicates.
  const entityFacade = useEntityFacade()
  // OPTIONAL, because this provider also mounts on the behaviours-only path
  // where no data machinery exists. A form pointed at a rest source there has
  // nowhere to write, and says so, rather than the whole surface failing to
  // render.
  const dataService = useOptionalDataService()

  // What the page has bound RIGHT NOW, read at write time through a ref so a
  // fresh fetch never re-attaches the bridges. Null outside the data-bound
  // path, where no record can have loaded and every write is a create.
  const surfaceData = useSurfaceData()
  const surfaceDataRef = React.useRef(surfaceData)
  surfaceDataRef.current = surfaceData

  /**
   * THE ONE PLACE THAT KNOWS WHAT A SOURCE ID MEANS.
   *
   * The bridge does not, deliberately — that is what lets one declaration
   * serve our own store and a third party's endpoint without the form knowing
   * which it is talking to.
   *
   * THE VERB FOLLOWS THE RECORD. A binding that says `PATCH` can only update
   * a record the source has loaded; with none loaded the honest write is a
   * create. Otherwise a Profile form would PATCH the collection path, the API
   * would answer 404 "Route not found", and the visitor would read "check the
   * highlighted fields".
   */
  const writer = React.useMemo<FormWriter>(() => {
    const byId = new Map((dataSources ?? []).map((s) => [s.id, s]))
    return {
      async write(sourceId, values, method) {
        const source = byId.get(sourceId)
        const target = resolveFormWriteTarget(method, surfaceDataRef.current?.[sourceId])
        if (source?.kind === 'entity' && source.entityType && entityFacade) {
          const entityType = source.entityType as never
          return target.recordId
            ? entityFacade.store.update(entityType, target.recordId as never, values)
            : entityFacade.store.create(entityType, values)
        }
        if (!source) {
          return {
            success: false,
            error: {
              type: 'not_found',
              message: `This form writes to "${sourceId}", which this page does not declare.`,
            },
          }
        }
        if (!dataService) {
          return {
            success: false,
            error: {
              type: 'connector',
              message: `This form writes to "${sourceId}", but this page has no data layer to write through.`,
            },
          }
        }
        const res = await dataService.fetchData(sourceId, {
          method: target.method,
          body: values,
          ...(target.recordId !== undefined ? { recordId: target.recordId } : {}),
        })
        if (!res.success) return { success: false, error: toFormWriteError(res.error) }
        const written = res.data as Record<string, unknown> | null
        const id = written && typeof written === 'object' ? written['id'] : undefined
        return {
          success: true,
          data: (written ?? {}) as never,
          id: (typeof id === 'string' || typeof id === 'number' ? String(id) : target.recordId ?? sourceId) as never,
        }
      },
    }
  }, [dataSources, entityFacade, dataService])

  // Read at submit time through a ref, like the bound data, so a re-render
  // never re-attaches the bridges.
  const blocksRef = React.useRef(blocks)
  blocksRef.current = blocks
  const completeValues = React.useCallback(
    (formId: string, values: Record<string, unknown>): Record<string, unknown> => {
      const tree = blocksRef.current
      const state = surfaceDataRef.current?.['state']
      if (!tree || !state || typeof state !== 'object') return values
      return completeNamedControlValues(tree, formId, values, state as Record<string, unknown>)
    },
    []
  )

  const bridgeUnsubsRef = React.useRef<readonly (() => void)[]>([])
  React.useMemo(() => {
    bridgeUnsubsRef.current.forEach((u) => u())
    bridgeUnsubsRef.current = entityFormBindings?.length
      ? entityFormBindings.map((cfg) => attachFormEntityBridge(bus, writer, cfg, completeValues))
      : []
  }, [writer, bus, entityFormBindings, completeValues])

  // Detach on unmount. Keyed on nothing so it runs once per mount; the memo
  // above owns teardown for every other transition.
  React.useEffect(() => {
    return () => {
      bridgeUnsubsRef.current.forEach((u) => u())
      bridgeUnsubsRef.current = []
    }
  }, [])

  return (
    <SurfaceEventContext.Provider value={bus}>
      <SurfaceIdContext.Provider value={surfaceId}>{children}</SurfaceIdContext.Provider>
    </SurfaceEventContext.Provider>
  )
}
