/**
 * Image Adapters
 *
 * Framework-specific image optimization adapters for SurfaceRenderer.
 * Enables Next.js Image, Astro Image, etc. while keeping surface
 * definitions framework-agnostic.
 *
 * @module @pwfabric/runtime/adapters
 *
 * @example
 * ```tsx
 * import { SurfaceRenderer } from '@pwfabric/runtime'
 * import { NextImageAdapter } from '@pwfabric/runtime/adapters'
 *
 * function MyPage() {
 *   return (
 *     <SurfaceRenderer
 *       surface={mySurface}
 *       imageAdapter={NextImageAdapter}
 *     />
 *   )
 * }
 * ```
 */

// Types
export type { ImageAdapter, ImageAdapterProps } from './types.js'

// Adapters
export { DefaultImageAdapter } from './default-image.js'
export { NextImageAdapter } from './next-image.js'
