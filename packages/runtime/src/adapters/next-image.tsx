/**
 * Next.js Image Adapter
 *
 * Renders images using Next.js Image component for automatic
 * optimization, responsive images, and modern image formats.
 *
 * NOTE: This adapter requires `next` as a peer dependency.
 * Only import this adapter in Next.js applications.
 *
 * @module @pwfabric/runtime/adapters/next-image
 */

'use client'

import * as React from 'react'
import type { ImageAdapter, ImageAdapterProps } from './types.js'

// Interface for Next.js Image component props
interface NextImageComponentProps {
  src: string
  alt: string
  width?: number
  height?: number
  fill?: boolean
  priority?: boolean
  placeholder?: 'blur' | 'empty'
  blurDataURL?: string
  style?: React.CSSProperties
  className?: string
  id?: string
}

// Lazy load next/image component to avoid SSG issues
let NextImageComponent: React.ComponentType<NextImageComponentProps> | null = null

function getNextImage(): React.ComponentType<NextImageComponentProps> {
  if (NextImageComponent === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    NextImageComponent = require('next/image')
      .default as React.ComponentType<NextImageComponentProps>
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return NextImageComponent!
}

/**
 * Convert CSS unit value to number if possible
 */
function toNumericSize(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return value
  // Try to parse numeric strings (e.g., "100" or "100px")
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? undefined : parsed
}

/**
 * Convert CSS unit value to string
 */
function cssUnit(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return `${value}px`
  return value
}

/**
 * Next.js Image adapter for optimized image delivery
 *
 * Leverages Next.js Image component features:
 * - Automatic image optimization
 * - Responsive image generation
 * - Modern format support (WebP, AVIF)
 * - Lazy loading with native browser support
 * - Priority loading for LCP images
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
export const NextImageAdapter: ImageAdapter = ({
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
  placeholder,
  blurDataURL,
  blockId,
}: ImageAdapterProps): React.ReactElement => {
  const numericWidth = toNumericSize(width)
  const numericHeight = toNumericSize(height)

  // Use fill mode if no explicit dimensions provided
  const useFillMode = numericWidth === undefined && numericHeight === undefined

  const computedStyle: React.CSSProperties = {
    objectFit: objectFit ?? 'cover',
    aspectRatio,
    borderRadius: cssUnit(borderRadius),
    ...(numericWidth !== undefined && numericHeight !== undefined
      ? { width: `${numericWidth}px`, height: `${numericHeight}px`, maxWidth: '100%' }
      : {}),
    ...style,
  }

  // Wrapper style for fill mode
  const wrapperStyle: React.CSSProperties | undefined = useFillMode
    ? {
        position: 'relative',
        width: cssUnit(width) ?? '100%',
        height: cssUnit(height) ?? 'auto',
        aspectRatio: aspectRatio ?? (numericHeight && numericWidth ? undefined : '16/9'),
      }
    : undefined

  // Build NextImage props
  interface NextImagePropsType {
    src: string
    alt: string
    width?: number
    height?: number
    fill?: boolean
    priority?: boolean
    placeholder?: 'blur' | 'empty'
    blurDataURL?: string
    style?: React.CSSProperties
    className?: string
    id?: string
  }

  const nextImageProps: NextImagePropsType = {
    src: src || '/placeholder.png',
    alt: alt ?? '',
    fill: useFillMode,
    priority: loading === 'eager',
    style: computedStyle,
  }

  // Add optional props only if they have values
  if (blockId !== undefined) nextImageProps.id = blockId
  if (!useFillMode && numericWidth !== undefined) nextImageProps.width = numericWidth
  if (!useFillMode && numericHeight !== undefined) nextImageProps.height = numericHeight
  if (placeholder !== undefined) nextImageProps.placeholder = placeholder
  if (blurDataURL !== undefined) nextImageProps.blurDataURL = blurDataURL
  if (className !== undefined) nextImageProps.className = className

  const NextImage = getNextImage()
  const imageElement = React.createElement(NextImage, nextImageProps)

  // Wrap in container for fill mode
  if (useFillMode) {
    return (
      <div style={wrapperStyle} data-block-type="image">
        {imageElement}
      </div>
    )
  }

  return imageElement
}
