/**
 * The image files `pwf media add` takes, told by their bytes, not by their
 * name: the formats a pwapp names by type (pwapp-format §2.4, the icon link's
 * `type`) — PNG, JPEG, GIF, WebP, AVIF and SVG. A file whose extension says
 * one format and whose bytes say another is refused, as is anything else.
 */

export interface ImageType {
  /** The extension the file is written with, lower case, with its dot. */
  readonly ext: string
  readonly mime: string
}

export const IMAGE_TYPES: Readonly<Record<string, ImageType>> = {
  png: { ext: '.png', mime: 'image/png' },
  jpeg: { ext: '.jpg', mime: 'image/jpeg' },
  gif: { ext: '.gif', mime: 'image/gif' },
  webp: { ext: '.webp', mime: 'image/webp' },
  avif: { ext: '.avif', mime: 'image/avif' },
  svg: { ext: '.svg', mime: 'image/svg+xml' },
}

/** The extensions each format may be named with. */
const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  png: ['.png'],
  jpeg: ['.jpg', '.jpeg'],
  gif: ['.gif'],
  webp: ['.webp'],
  avif: ['.avif'],
  svg: ['.svg'],
}

const ascii = (bytes: Uint8Array, from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to))

/** The image format of `bytes` (a key of {@link IMAGE_TYPES}), or undefined when it is none of them. */
export function sniffImage(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return 'gif'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp'
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 12))) return 'avif'
  // SVG is text: an <svg> root, after an optional BOM, XML declaration, comments and doctype.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, '')
  const rest = head.replace(/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*/i, '')
  if (/^<svg[\s>]/i.test(rest)) return 'svg'
  return undefined
}

/** The format an extension names (`.JPG` → `jpeg`), or undefined. */
export function formatOfExtension(ext: string): string | undefined {
  const lower = ext.toLowerCase()
  return Object.keys(EXTENSIONS).find((f) => (EXTENSIONS[f] as readonly string[]).includes(lower))
}

/**
 * What makes an SVG unsafe to serve as the app's own file — the rule
 * pwpack-format §1.4 gives every markup file an app serves: a `<script>`
 * element, an `on…` attribute in any tag, or a `javascript:` URL, compared
 * in lower case. Also refused: `<foreignObject>`, which embeds HTML (and
 * so the same three) where no image needs it. Undefined when none is there.
 */
export function svgProblem(bytes: Uint8Array): string | undefined {
  const text = new TextDecoder().decode(bytes).toLowerCase()
  if (text.includes('<script')) return 'it holds a <script> element'
  if (/<[^>]*\son[a-z0-9_-]*\s*=/.test(text)) return 'it holds an on… event attribute'
  if (/javascript\s*:/.test(text)) return 'it holds a javascript: URL'
  if (text.includes('<foreignobject')) return 'it holds a <foreignObject>, which embeds HTML'
  return undefined
}
