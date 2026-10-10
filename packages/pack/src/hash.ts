/**
 * Content identity of a pack.
 *
 * @module @pwfabric/pack/hash
 */
import { createHash } from 'node:crypto'
import type { PackFolder } from './types.js'
import { sortedPaths } from './paths.js'
import { isPackContentPath } from './content.js'

/** Lower-case hex sha256 of `data`. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * The pack's content hash: `sha256:` + sha256 over one line per file of the
 * pack content (`packContent`: an author's tooling does not count),
 * `<path>\0<sha256-hex of the bytes>\n`, lines in byte order of the path.
 *
 * Depends only on the pack content's paths and bytes — not on archive
 * framing, compression, platform, zlib build or tooling beside the pack — so
 * the same pack hashes the same whether it was read from its source folder
 * or from any archive layout `readPwpack` accepts.
 */
export function hashPack(pack: PackFolder): string {
  const h = createHash('sha256')
  for (const path of sortedPaths(pack.files.keys())) {
    if (!isPackContentPath(path)) continue
    h.update(`${path}\0${sha256Hex(pack.files.get(path) as Uint8Array)}\n`, 'utf8')
  }
  return `sha256:${h.digest('hex')}`
}

/**
 * The archive hash existing producers record as `contentHash`: `sha256:` +
 * sha256 of the compressed archive bytes. It changes whenever the archive
 * framing does (wrapper directory, mtimes, gzip level, OS byte), so two
 * archives of the same folder can differ here while {@link hashPack} agrees.
 */
export function legacyContentHash(archive: Uint8Array): string {
  return `sha256:${sha256Hex(archive)}`
}
