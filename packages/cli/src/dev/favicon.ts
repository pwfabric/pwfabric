/**
 * THE APP'S ICON (`appearance` `brand.favicon`, appearance §1): judged the
 * same by `pwf validate` and `pwf build`.
 *
 * @module @pwfabric/cli/dev/favicon
 */

/** The file types a browser takes for an icon, by extension: the `<link rel="icon">`'s `type`. */
const ICON_TYPES: Readonly<Record<string, string>> = {
  ico: 'image/x-icon',
  png: 'image/png',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
}

/** The media type of an icon at `href`, from its extension; undefined for one it does not name. */
export function faviconTypeOf(href: string): string | undefined {
  const ext = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(href)?.[1]?.toLowerCase()
  return ext ? ICON_TYPES[ext] : undefined
}

/**
 * `brand.favicon` as the documents link it, or why it cannot be: an absolute
 * https address as written (an http icon on an https page is mixed content,
 * which the browser blocks); a media file of the app (`media/<file>`) as
 * served, `pwpack/media/<file>`; a public file (`public/favicon.ico`, or
 * `favicon.ico`) at the app's root. A file the app does not have, or any
 * other form, is `FAVICON_INVALID`. Undefined, both: the app names no icon.
 */
export function faviconOf(raw: unknown, files: ReadonlyMap<string, Uint8Array>): { href?: string; problem?: string } {
  if (raw === undefined) return {}
  const value = typeof raw === 'string' ? raw.trim() : ''
  // An address the head carries: visible ASCII, no whitespace or control character.
  if (/^https:\/\/[\x21-\x7e]+$/i.test(value)) return { href: value }
  const file = value.replace(/^\.?\//, '')
  if (/^media\/(?!.*(?:^|\/)\.\.?(?:\/|$))[^\s?#]+$/.test(file) && files.has(file)) return { href: `pwpack/${file}` }
  // A public file (`public/favicon.ico`, or as served: `favicon.ico`) is served at the app's root.
  const served = file.replace(/^public\//, '')
  if (/^[^\s?#]+$/.test(served) && !served.split('/').some((seg) => seg === '..' || seg === '.') && files.has(`public/${served}`)) return { href: served }
  // The served form of an app's media file is the build's, not the app's.
  if (/^pwpack\/media\//.test(file)) {
    return { problem: `brand.favicon is "${value}", the address the build serves the file at: write ${file.slice('pwpack/'.length)}, the app's own file` }
  }
  return { problem: `brand.favicon is "${value}": it is an https address or a file of the app (media/<file>, or a file of public/), and the app has no such file` }
}
