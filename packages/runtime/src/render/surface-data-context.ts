/**
 * Surface Data Context
 *
 * What the data-bound renderer has CURRENTLY bound, keyed by source id — the
 * same object block expressions resolve `{{<sourceId>}}` against, offered to
 * the providers that sit between the data layer and the blocks.
 *
 * The form writer needs it: a binding that says `PATCH` can only name a
 * record the page has loaded, and until this context existed the writer
 * could not see one — so it patched the collection path and the API said
 * 404. `null` outside the data-bound path (behaviours-only surfaces, plain
 * `SurfaceRenderer`), where there is nothing bound to consult.
 *
 * @module @pwfabric/runtime/render/surface-data-context
 */

import { createContext, useContext } from 'react'

export type SurfaceData = Readonly<Record<string, unknown>>

export const SurfaceDataContext = createContext<SurfaceData | null>(null)

export function useSurfaceData(): SurfaceData | null {
  return useContext(SurfaceDataContext)
}
