/**
 * Image Adapter Types
 *
 * Standardized interface for framework-specific image optimizations.
 * Enables Next.js Image, Astro Image, etc. while keeping surface
 * definitions framework-agnostic.
 *
 * @module @pwfabric/runtime/adapters/types
 */

import type { CSSProperties, ComponentType } from 'react'

/**
 * Props passed to image adapter components
 *
 * These props are extracted from ImageBlock's block props and
 * normalized for adapter consumption. Adapters can use or ignore
 * specific props based on their framework capabilities.
 */
export interface ImageAdapterProps {
  /** Image source URL */
  readonly src: string
  /** Alt text for accessibility */
  readonly alt: string
  /** Image width (number for pixels, string for CSS units) */
  readonly width?: number | string
  /** Image height (number for pixels, string for CSS units) */
  readonly height?: number | string
  /** Loading strategy */
  readonly loading?: 'lazy' | 'eager'
  /** CSS object-fit property */
  readonly objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'
  /** CSS aspect-ratio property */
  readonly aspectRatio?: string
  /** Border radius (number for pixels, string for CSS units) */
  readonly borderRadius?: number | string
  /** Additional CSS class names */
  readonly className?: string
  /** Inline styles */
  readonly style?: CSSProperties

  // Framework-specific hints (adapters may use these)

  /** Marks image as priority/above-the-fold (derived from loading === 'eager') */
  readonly priority?: boolean
  /** Placeholder type for blur-up effect */
  readonly placeholder?: 'blur' | 'empty'
  /** Base64 blur data URL for placeholder */
  readonly blurDataURL?: string
  /** Block ID for data attributes */
  readonly blockId?: string
}

/**
 * Image adapter component type
 *
 * Any React component that accepts ImageAdapterProps can be used
 * as an image adapter.
 *
 * @example
 * ```tsx
 * const MyAdapter: ImageAdapter = ({ src, alt, width, height }) => (
 *   <img src={src} alt={alt} width={width} height={height} />
 * )
 * ```
 */
export type ImageAdapter = ComponentType<ImageAdapterProps>
