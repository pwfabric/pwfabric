/**
 * The pack content: the part of a folder that belongs to the pack. A source
 * folder also holds the author's tooling (`package.json`, `tsconfig.json`,
 * `scripts/`, `test/`, `vitest.config.ts` …); none of it is the pack, and
 * none of it may change the pack's identity.
 *
 * @module @pwfabric/pack/content
 */
import type { PackFolder } from './types.js'

/** Root files that are pack content besides `pwpack.json`: the pack's own documentation and terms. */
export const PACK_DOC_FILES: ReadonlySet<string> = new Set(['LICENSE', 'NOTICE', 'README.md'])

/** Root directories of the canonical folder. */
export const PACK_ROOT_DIRS: ReadonlySet<string> = new Set(['app', 'atoms', 'media'])

/**
 * Root directories of the legacy rootless layout: the atom families of
 * `classifyPackPath` (and its shared-code root `lib`). Root `test/` is not
 * among them — in a source folder it is the author's tooling; a pack that
 * ships its tests keeps them under `atoms/test/`.
 */
export const ROOTLESS_FAMILY_DIRS: ReadonlySet<string> = new Set([
  'blocks',
  'capabilities',
  'connectors',
  'providers',
  'appearance',
  'patterns',
  'icons',
  'surfaces',
  'auth',
  'lib',
])

/** True when `path` (a safe pack path) is pack content. */
export function isPackContentPath(path: string): boolean {
  const slash = path.indexOf('/')
  if (slash === -1) return path === 'pwpack.json' || PACK_DOC_FILES.has(path)
  const top = path.slice(0, slash)
  return PACK_ROOT_DIRS.has(top) || ROOTLESS_FAMILY_DIRS.has(top)
}

/**
 * The pack content of a folder: `pwpack.json`, `LICENSE`, `NOTICE` and
 * `README.md` at the root; everything under `app/`, `atoms/` and `media/`;
 * and, for the legacy rootless layout, everything under a root atom-family
 * directory (`blocks/`, `capabilities/`, `connectors/`, `providers/`,
 * `appearance/`, `patterns/`, `icons/`, `surfaces/`, `auth/`, `lib/`).
 * Everything else is dropped. Bytes are shared, not copied.
 *
 * The content hash (`hashPack`) is computed over this, so a pack hashes the
 * same whether it was read from its source folder or from its archive.
 */
export function packContent(folder: PackFolder): PackFolder {
  const files = new Map<string, Uint8Array>()
  for (const [path, bytes] of folder.files) if (isPackContentPath(path)) files.set(path, bytes)
  return { files }
}
