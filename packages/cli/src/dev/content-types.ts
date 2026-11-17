/**
 * The file types the local servers (`pwf dev`, `pwf run`) serve, by extension
 * — ONE table, so the two cannot disagree on what is a file and what is a page.
 *
 * It decides two things. The `content-type` a file is answered with: a media
 * file an app links to (a receipt's PDF, an export's CSV) must open as what it
 * is, not as `application/octet-stream`. And which request paths are PAGES: a
 * path whose extension is not listed here is answered with the shell, so a
 * file type missing from this table came back as the app's `index.html` — an
 * export link opened the app instead of the file.
 *
 * @module @pwfabric/cli/dev/content-types
 */
import { extname } from 'node:path'

export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
}

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Whether a request path names a page rather than a file: its last segment
 * does not end in an extension these servers serve. A page id may carry a dot
 * (`layout.two-pane`), so "has no extension" is not the test — only a known
 * file type makes a path a file, and a missing file stays a 404.
 */
export function isPagePath(rel: string): boolean {
  return !(extname(rel).toLowerCase() in CONTENT_TYPES)
}
