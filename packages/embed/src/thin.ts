/**
 * Thin mode loader.
 *
 * Fetches a published surface + its render grants from a host API the same
 * way a host application's public surface route does, then normalises the
 * result into the shape `render-core` consumes.
 *
 * The host API serves `GET /api/surfaces/by-slug/:tenant/:slug` (and
 * `GET /api/surfaces/:id/published`). Host API clients are not part of this
 * engine, so this issues the HTTP call with `fetch` and applies the same
 * post-processing a host applies:
 *   - `definition.rootBlock.children` (or `definition.blocks`) → runtime blocks,
 *     merging each block's stored `layout.span` with `DEFAULT_BLOCK_LAYOUT.span`.
 *   - `response.renderGrants[]` → `DynamicBlockDescriptor[]` (publisher
 *     'workspace', unverified) — byte-identical to the host's `mappedDescriptors`.
 *   - `definition.theme` / `styleVariables` → an `appearance` ref.
 *   - `definition.capabilities` normalised with `required: false` default.
 *
 * @module @pwfabric/embed/thin
 */

import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import type {
  DynamicBlockDescriptor,
  SurfaceRenderGrant,
  SurfaceTheme,
  SurfaceCapabilityRequirement,
} from '@pwfabric/contracts'
import type { RenderableSurface } from '@pwfabric/runtime'
import { isCapability } from '@pwfabric/runtime/capability'

// ============================================================
// TYPES
// ============================================================

export interface ThinAuth {
  /** Bearer token; injected as `Authorization` on the surface fetch and on
   *  any REST data sources (matching the host's `ms_access_token` behaviour). */
  readonly accessToken?: string
  /** Send credentials (cookies) with the request. */
  readonly includeCredentials?: boolean
}

export interface LoadThinOptions {
  /** API origin, e.g. `https://api.example.com`. */
  readonly apiBaseUrl: string
  /** Optional auth. */
  readonly auth?: ThinAuth
  /** Custom fetch (test injection / non-browser runtime). */
  readonly fetchImpl?: typeof fetch
}

/**
 * A surface reference: either a `surfaceId` (by-id) or a tenant+surface slug
 * pair (by-slug, the host's path).
 */
export type ThinSurfaceRef =
  | { readonly surfaceId: string }
  | { readonly tenantSlug: string; readonly surfaceSlug: string }

export interface LoadThinResult {
  readonly surface: RenderableSurface
  readonly dynamicBlocks: readonly DynamicBlockDescriptor[]
  readonly surfaceId?: string
  readonly worldId?: string
  /** Surface-level layout hints from the API (maxWidth/gap/padding). */
  readonly layout?: { maxWidth?: number; gap?: number; padding?: number }
}

// ============================================================
// API RESPONSE SHAPES (loose — mirror the host's local interfaces)
// ============================================================

interface ApiBlockNode {
  id: string
  type: string
  version?: string
  props?: Record<string, unknown>
  layout?: Block['layout']
  style?: Record<string, string>
  children?: ApiBlockNode[]
}

interface IncomingCapability {
  capability: string
  required?: boolean
  config?: Record<string, unknown>
}

interface SurfaceFetchData {
  surfaceId: string
  worldId: string
  definition: {
    rootBlock?: ApiBlockNode
    blocks?: ApiBlockNode[]
    dataSources?: unknown[]
    state?: Record<string, unknown>
    styleVariables?: Record<string, string>
    theme?: SurfaceTheme
    capabilities?: IncomingCapability[]
  }
  layout?: { maxWidth?: number; gap?: number; padding?: number } | null
  renderGrants?: SurfaceRenderGrant[]
}

// ============================================================
// BLOCK CONVERSION (mirror of the host's toRuntimeBlock)
// ============================================================

function toRuntimeBlock(node: ApiBlockNode): Block {
  const storedLayout = node.layout
  const mergedLayout: Block['layout'] = storedLayout
    ? {
        ...storedLayout,
        span: { ...DEFAULT_BLOCK_LAYOUT.span, ...storedLayout.span },
      }
    : DEFAULT_BLOCK_LAYOUT

  const base = {
    id: node.id,
    type: node.type,
    props: node.props ?? {},
    layout: mergedLayout,
    ...(node.style ? { style: node.style } : {}),
  }

  if (node.children && node.children.length > 0) {
    return { ...base, children: node.children.map(toRuntimeBlock) }
  }
  return base
}

/**
 * Map render grants → dynamic block descriptors. Byte-identical to the host's
 * `mappedDescriptors` memo: publisher 'workspace', unverified, a minimal
 * marketplace-category definition.
 */
export function grantsToDescriptors(
  grants: readonly SurfaceRenderGrant[]
): DynamicBlockDescriptor[] {
  if (grants.length === 0) return []
  return grants.map((grant) => ({
    blockType: grant.blockType,
    moduleUrl: grant.moduleUrl,
    integrity: grant.integrity,
    publisher: 'workspace',
    publisherVerified: false,
    definition: {
      name: grant.artifactName,
      category: 'marketplace',
      defaultProps: {},
      canHaveChildren: false,
    },
  }))
}

// ============================================================
// LOADER
// ============================================================

function buildSurfaceUrl(apiBaseUrl: string, ref: ThinSurfaceRef): string {
  const base = apiBaseUrl.replace(/\/+$/, '')
  if ('surfaceId' in ref) {
    return `${base}/api/surfaces/${encodeURIComponent(ref.surfaceId)}/published`
  }
  return `${base}/api/surfaces/by-slug/${encodeURIComponent(ref.tenantSlug)}/${encodeURIComponent(
    ref.surfaceSlug
  )}`
}

/**
 * The API wraps payloads as `{ data, error }` (an `ApiResponse` envelope). Some
 * endpoints return the bare object. Normalise both.
 */
function unwrap(json: unknown): SurfaceFetchData {
  const obj = json as { data?: SurfaceFetchData; error?: { code?: string } }
  if (obj && obj.error) {
    throw new Error(`[pwfabric-embed] surface fetch error: ${obj.error.code ?? 'UNKNOWN'}`)
  }
  if (obj && obj.data) return obj.data
  return json as SurfaceFetchData
}

/**
 * Fetch + normalise a published surface and its render grants.
 */
export async function loadThin(
  ref: ThinSurfaceRef,
  options: LoadThinOptions
): Promise<LoadThinResult> {
  const doFetch = options.fetchImpl ?? fetch
  const url = buildSurfaceUrl(options.apiBaseUrl, ref)

  const headers: Record<string, string> = { accept: 'application/json' }
  const token = options.auth?.accessToken
  if (token) headers.authorization = `Bearer ${token}`

  const init: RequestInit = { method: 'GET', headers }
  if (options.auth?.includeCredentials) init.credentials = 'include'

  const res = await doFetch(url, init)
  if (!res.ok) {
    throw new Error(`[pwfabric-embed] surface fetch failed: ${res.status} ${res.statusText}`)
  }
  const data = unwrap(await res.json())
  const def = data.definition ?? {}

  // Blocks: rootBlock.children OR blocks[], normalised like the host.
  let blocks: Block[] = []
  if (def.rootBlock) {
    blocks = (def.rootBlock.children ?? []).map(toRuntimeBlock)
  } else if (def.blocks) {
    blocks = def.blocks.map(toRuntimeBlock)
  }

  // Capabilities normalised with required:false default (host parity).
  const capabilities: SurfaceCapabilityRequirement[] = (def.capabilities ?? []).map((c) => ({
    capability: c.capability,
    required: c.required ?? false,
    ...(c.config !== undefined ? { config: c.config } : {}),
  }))

  // Inject Authorization into REST data sources, matching the host's authedSources.
  if (token && Array.isArray(def.dataSources)) {
    const authed = def.dataSources.map((ds) => {
      const d = ds as { kind?: string; headers?: Record<string, string> }
      return d.kind === 'rest'
        ? { ...d, headers: { ...d.headers, Authorization: `Bearer ${token}` } }
        : d
    })
    // Thread data sources through the persistence capability config so the
    // DataBoundSurfaceRenderer picks them up (consolidated shape).
    // Either spelling: a short-form entry that goes unrecognised here does not
    // just get missed, it gets DUPLICATED — the branch below adds a second
    // persistence capability alongside the one already there.
    const existing = capabilities.find((c) => isCapability(c, 'platform/persistence'))
    if (existing) {
      ;(existing as { config?: Record<string, unknown> }).config = {
        ...(existing.config ?? {}),
        dataSources: authed,
        ...(def.state ? { initialState: def.state } : {}),
      }
    } else {
      capabilities.push({
        capability: 'platform/persistence',
        required: false,
        config: { dataSources: authed, ...(def.state ? { initialState: def.state } : {}) },
      })
    }
  }

  // Appearance ref: wrap theme + styleVariables (consolidated shape).
  // Config only — the `use` atom id retired with the appearance engine
  //a theme is data, nothing is resolved by reference.
  const appearance: RenderableSurface['appearance'] | undefined =
    def.theme || def.styleVariables
      ? {
          config: {
            ...(def.theme ? { theme: def.theme } : {}),
            ...(def.styleVariables ? { styleVariables: def.styleVariables } : {}),
          },
        }
      : undefined

  const surface: RenderableSurface = {
    blocks,
    ...(appearance ? { appearance } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    id: data.surfaceId,
  }

  return {
    surface,
    dynamicBlocks: grantsToDescriptors(data.renderGrants ?? []),
    surfaceId: data.surfaceId,
    worldId: data.worldId,
    ...(data.layout ? { layout: data.layout } : {}),
  }
}
