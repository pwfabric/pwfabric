/**
 * Form → Entity Declarative Bridge
 *
 * Attaches a form-to-entity bridge to the SurfaceEventBus.
 * When a specified form emits 'form:submit', writes to the data source the
 * binding names — our own store or anyone else's endpoint.
 *
 * Requires `platform/entities` capability (platform/input retired;
 * form submissions now flow exclusively through entity_records).
 *
 * @module @pwfabric/runtime/forms/form-entity-bridge
 */

import type { SurfaceEventBus } from '@pwfabric/contracts'
import type { EntityMutationResult, EntityOperationError } from '../entity/types.js'
import { writeFailureDetail, writeFailureFields, writeFailureReason } from './form-write-target.js'

// Re-export Unsubscribe from contracts for convenience
export type { Unsubscribe } from '@pwfabric/contracts'

export interface FormEntityBridgeConfig {
  /** The form block ID to listen for. */
  formId: string
  /**
   * The DATA SOURCE this form writes to.
   *
   * It used to be `entityType` — a platform model — which is why "why can we
   * not POST to our own endpoint?" was a question with no answer: the form's
   * only expressible destination was our store. A source has an address, and
   * our store's address is one of them.
   *
   * The read half already worked this way; this is the write half catching up.
   */
  sourceId: string
  /** How to write. Defaults to POST — the only shape a form has ever had. */
  method?: 'POST' | 'PUT' | 'PATCH'
  /**
   * Optional mapping from form values to entity data.
   * If omitted, form values are passed as-is.
   */
  mapping?: (values: Record<string, unknown>) => Record<string, unknown>
  /** Called on successful entity creation. */
  onSuccess?: (result: EntityMutationResult & { success: true }) => void
  /** Called when entity creation fails. */
  onError?: (error: EntityOperationError) => void
  /**
   * Optional path to navigate to after success.
   * Uses window.location.assign (client-side only).
   *
   * It may carry expressions (`/confirmation?id={{result.id}}`), resolved
   * after the write against the page scope plus `result`, the record the
   * write returned (data-protocol §4.4) — see `resolveRedirect` below.
   */
  successRedirect?: string
  /**
   * Surface-state keys the bridge drives across the create lifecycle, so the
   * UI reflects the REAL API result (not an optimistic onSubmitAction):
   * `loading` true while the create is in flight, then `success` OR `error`.
   * Each is a boolean set via setState; gate blocks with if:{{state.<key>}}.
   */
  statusKeys?: {
    loading?: string
    success?: string
    error?: string
    /**
     * Where WHY goes on failure — a code the page writes its own words for:
     * `validation`, `unauthenticated`, `forbidden`, `server`, `network` or
     * `error` (writeFailureReason). The engine writes no sentence. Cleared
     * (`''`) when an attempt starts and on success, so a toast bound to it
     * never shows yesterday's refusal.
     */
    reason?: string
    /**
     * Where the field names a refusal named go (`['email']`) — what a form
     * highlights. Cleared (`[]`) like `reason`.
     */
    fields?: string
    /**
     * Where the writer's OWN WORDS go on failure — the server's status, code
     * and message (`403 FORBIDDEN: You may not create Order records.`). For
     * the developer: a page branches on `reason`, it does not show this.
     * Cleared like `reason`.
     */
    detail?: string
  }
}

/**
 * Where a form's submission is actually sent.
 *
 * One method, because a form has one job. The host decides what a source id
 * means — the entity facade for a platform-backed source, an HTTP call for a
 * rest one — which is what lets the same declaration serve both without the
 * bridge knowing the difference.
 */
export interface FormWriter {
  write(
    sourceId: string,
    values: Record<string, unknown>,
    method: 'POST' | 'PUT' | 'PATCH'
  ): Promise<EntityMutationResult>
}

/**
 * Attaches a form-to-entity bridge to the SurfaceEventBus.
 * When the specified form emits 'form:submit', writes to the source the
 * binding names.
 *
 * Requires `platform/entities` capability active (platform/input retired).
 *
 * @returns Unsubscribe function — call on surface unmount.
 */
export function attachFormEntityBridge(
  bus: SurfaceEventBus,
  writer: FormWriter,
  config: FormEntityBridgeConfig,
  /**
   * Completes what the form block gathered before it is mapped and written —
   * the host adds the named controls `FormData` cannot see (a control drawn
   * from buttons has no native field; see forms/named-control-values).
   */
  completeValues?: (formId: string, values: Record<string, unknown>) => Record<string, unknown>,
  /**
   * Resolves `successRedirect` against the page scope plus `result` (the
   * written record) and writes it in the router's form. Without it the
   * address is followed as written.
   */
  resolveRedirect?: (template: string, result: Record<string, unknown>) => string | undefined
): () => void {
  // Drive a surface-state boolean via setState on the bus → handleEvent
  // (DataBoundInner) applies it. Lets the UI reflect the REAL create lifecycle.
  const sk = config.statusKeys
  const setState = (surfaceId: string, blockId: string | undefined, key: string, value: unknown): void => {
    bus.emit({
      type: 'capability:form-status',
      surfaceId,
      ...(blockId ? { blockId } : {}),
      payload: { action: { type: 'setState', key, value } },
      timestamp: Date.now(),
    })
  }

  return bus.on('form:submit', async (descriptor) => {
    // Only handle events for the configured form
    if (descriptor.blockId !== config.formId) return

    const gathered = (descriptor.payload?.values as Record<string, unknown>) ?? {}
    const rawValues = completeValues ? completeValues(config.formId, gathered) : gathered
    const mapped = config.mapping ? config.mapping(rawValues) : rawValues

    // Lifecycle start: loading on, clear any prior success/error so the UI is
    // accurate for THIS attempt.
    if (sk?.loading) setState(descriptor.surfaceId, descriptor.blockId, sk.loading, true)
    if (sk?.success) setState(descriptor.surfaceId, descriptor.blockId, sk.success, false)
    if (sk?.error) setState(descriptor.surfaceId, descriptor.blockId, sk.error, false)
    if (sk?.reason) setState(descriptor.surfaceId, descriptor.blockId, sk.reason, '')
    if (sk?.fields) setState(descriptor.surfaceId, descriptor.blockId, sk.fields, [])
    if (sk?.detail) setState(descriptor.surfaceId, descriptor.blockId, sk.detail, '')

    const result = await writer.write(config.sourceId, mapped, config.method ?? 'POST')

    // Loading off regardless of outcome.
    if (sk?.loading) setState(descriptor.surfaceId, descriptor.blockId, sk.loading, false)

    if (result.success) {
      config.onSuccess?.(result)
      // Success is bound to the API result (not optimistic).
      if (sk?.success) setState(descriptor.surfaceId, descriptor.blockId, sk.success, true)
      // Reactive read half: re-fetch data sources so an entity-backed list
      // (dataSource kind:'entity') reflects the just-created record.
      bus.emit({
        type: 'entity:created',
        surfaceId: descriptor.surfaceId,
        ...(descriptor.blockId ? { blockId: descriptor.blockId } : {}),
        // Keyed by the SOURCE, because that is what a reader re-fetches. It
        // used to be the entity type, which only a platform-backed list could
        // match.
        payload: { action: { type: 'refreshAll' }, sourceId: config.sourceId },
        timestamp: Date.now(),
      })
      if (config.successRedirect) {
        const written = { ...((result.data ?? {}) as Record<string, unknown>), id: result.id }
        const target = resolveRedirect ? resolveRedirect(config.successRedirect, written) : config.successRedirect
        // Client-side navigation — safe to call in browser context. A target
        // that resolved to nothing (a refused `javascript:` from data) stays.
        if (target && typeof window !== 'undefined') {
          window.location.assign(target)
        }
      }
    } else {
      config.onError?.(result.error)
      // Failure is bound to the API result: why, which fields, and the detail.
      if (sk?.error) setState(descriptor.surfaceId, descriptor.blockId, sk.error, true)
      if (sk?.reason) setState(descriptor.surfaceId, descriptor.blockId, sk.reason, writeFailureReason(result.error))
      if (sk?.fields) setState(descriptor.surfaceId, descriptor.blockId, sk.fields, writeFailureFields(result.error))
      if (sk?.detail) setState(descriptor.surfaceId, descriptor.blockId, sk.detail, writeFailureDetail(result.error))
    }
  })
}
