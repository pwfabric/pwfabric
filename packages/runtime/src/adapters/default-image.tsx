/**
 * Default Image Adapter
 *
 * Renders images using native HTML img element.
 * This is the fallback adapter used when no framework-specific
 * adapter is provided.
 *
 * @module @pwfabric/runtime/adapters/default-image
 */

import * as React from 'react'
import type { ImageAdapter, ImageAdapterProps } from './types.js'

/**
 * Convert CSS unit value to string
 */
function cssUnit(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return `${value}px`
  return value
}

/**
 * Default image adapter using native img element
 *
 * Provides basic image rendering with CSS-based styling.
 * Supports lazy loading via the native loading attribute.
 *
 * @example
 * ```tsx
 * <SurfaceRenderer
 *   surface={mySurface}
 *   imageAdapter={DefaultImageAdapter}
 * />
 * ```
 */
export const DefaultImageAdapter: ImageAdapter = ({
  src,
  alt,
  width,
  height,
  loading,
  objectFit,
  aspectRatio,
  borderRadius,
  className,
  style,
  blockId,
}: ImageAdapterProps): React.ReactElement => {
  const computedStyle: React.CSSProperties = {
    width: cssUnit(width) ?? '100%',
    height: cssUnit(height) ?? 'auto',
    objectFit: objectFit ?? 'cover',
    aspectRatio,
    borderRadius: cssUnit(borderRadius),
    ...style,
  }

  return (
    <img
      id={blockId}
      src={src || '/placeholder.png'}
      alt={alt ?? ''}
      style={computedStyle}
      className={className}
      loading={loading ?? 'lazy'}
      data-block-type="image"
    />
  )
}
