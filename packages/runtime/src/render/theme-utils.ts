/**
 * Surface Theme Utilities
 *
 * Surface Theme Engine — converts SurfaceTheme to CSS custom properties.
 *
 * The implementation MOVED to `@pwfabric/contracts`
 * (`fabric/appearance-cascade`) shared with the theme exporter (export
 * `theme.css`) and the authoring studio (bake the dark variant at write time) need the same
 * transform, and `contracts` is the only leaf all three can reach. This module
 * stays as the runtime-facing name so existing import paths keep working.
 *
 * @module @pwfabric/runtime/render/theme-utils
 */

export { surfaceThemeToCSS } from '@pwfabric/contracts'
