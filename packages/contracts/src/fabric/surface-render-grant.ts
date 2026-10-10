/**
 * Surface Render Grant Contract Type
 *
 * Surface Render Grant
 *
 * A surface-scoped read credential that authorises the runtime to load a
 * specific block artifact for a specific surface. Issued by the API and
 * consumed by the renderer — never stored, never reused across surfaces.
 *
 * Deliberately separate from DynamicBlockDescriptor (entitlement vocabulary).
 * DynamicBlockDescriptor belongs to the marketplace/entitlement flow;
 * SurfaceRenderGrant belongs to the per-request render authorisation flow.
 *
 * @module @pwfabric/contracts/fabric/surface-render-grant
 */

// ============================================================
// INTERFACE
// ============================================================

/**
 * A surface-scoped render credential for a single block artifact.
 *
 * All fields are required. The type intentionally omits `publisher`,
 * `publisherVerified`, and `definition` — those belong exclusively to
 * DynamicBlockDescriptor and must not appear here.
 */
export interface SurfaceRenderGrant {
  surfaceId: string
  blockType: string
  artifactName: string
  artifactVersion: string
  moduleUrl: string
  integrity: string
  expiresAt: number
}

// ============================================================
// RUNTIME CONSTANT — canonical field list
// ============================================================

/**
 * Ordered list of all fields that constitute a SurfaceRenderGrant.
 * Useful for runtime validation, serialisation, and schema generation.
 * Kept in sync with the interface above.
 */
export const SURFACE_RENDER_GRANT_KEYS: readonly string[] = [
  'surfaceId',
  'blockType',
  'artifactName',
  'artifactVersion',
  'moduleUrl',
  'integrity',
  'expiresAt',
] as const

// ============================================================
// TYPE GUARD
// ============================================================

/**
 * Runtime type guard for SurfaceRenderGrant.
 *
 * Returns `true` only when:
 * - `value` is a non-null object
 * - All seven required fields are present with correct primitive types
 * - None of the DynamicBlockDescriptor-exclusive fields (`publisher`,
 *   `publisherVerified`, `definition`) are present
 */
export function isSurfaceRenderGrant(value: unknown): value is SurfaceRenderGrant {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const obj = value as Record<string, unknown>

  // All seven required fields must be present with correct types
  if (typeof obj['surfaceId'] !== 'string') return false
  if (typeof obj['blockType'] !== 'string') return false
  if (typeof obj['artifactName'] !== 'string') return false
  if (typeof obj['artifactVersion'] !== 'string') return false
  if (typeof obj['moduleUrl'] !== 'string') return false
  if (typeof obj['integrity'] !== 'string') return false
  if (typeof obj['expiresAt'] !== 'number') return false

  // DynamicBlockDescriptor-exclusive fields must NOT be present
  if ('publisher' in obj) return false
  if ('publisherVerified' in obj) return false
  if ('definition' in obj) return false

  return true
}
