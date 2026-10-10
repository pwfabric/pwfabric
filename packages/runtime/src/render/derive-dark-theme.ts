/**
 * Derive a dark theme variant from a light SurfaceTheme.
 *
 * A colour palette is a preset the end user edits — not a reason to ship a
 * separate appearance atom. The dark variant is DERIVED from the light palette
 * rather than authored twice.
 *
 * The implementation lives in `@pwfabric/contracts`
 * (`fabric/appearance-cascade`), because the derivation can run at WRITE
 * time: an authoring tool may bake the result into
 * `appearance.config.darkTheme` so the author can see and edit the dark palette
 * instead of it being invisible render-time magic. Render still derives as the
 * fallback for surfaces that carry no baked variant.
 *
 * @module @pwfabric/runtime/render/derive-dark-theme
 */

export { deriveDarkTheme } from '@pwfabric/contracts'
