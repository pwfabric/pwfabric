/**
 * The derived manifest: what a build computes from the folder, never what a
 * person writes.
 *
 * @module @pwfabric/pack/manifest
 */
import { classifyAtom, safeParsePwpackIdentity, type AtomRef, type PwpackManifest } from '@pwfabric/contracts'
import { PackError, type PackFolder } from './types.js'
import { compareBytes, sortedPaths } from './paths.js'
import { legacyContentHash, sha256Hex } from './hash.js'

/** The identity file at the root of a pack folder. */
export const IDENTITY_FILE = 'pwpack.json'

/** One classified file: its atom, and the directory that holds the atom. */
export interface AtomOccurrence {
  readonly ref: AtomRef
  /** Atom directory: the path minus its file name. Files of one atom share it. */
  readonly dir: string
}

/** Every file that classifies as an atom, in byte order of the path. */
export function atomOccurrences(pack: PackFolder): AtomOccurrence[] {
  const out: AtomOccurrence[] = []
  for (const path of sortedPaths(pack.files.keys())) {
    const atom = classifyAtom(path)
    if (!atom) continue
    out.push({
      ref: { kind: atom.kind, id: atom.id, relPath: path, contentHash: sha256Hex(pack.files.get(path) as Uint8Array) },
      dir: path.slice(0, path.lastIndexOf('/') + 1),
    })
  }
  return out
}

/**
 * The pack's atoms, one per `kind:id`, as `PwpackManifest.atoms` carries them.
 *
 * Classification is the contracts' `classifyAtom`, so the canonical
 * (`atoms/blocks/…`) and legacy rootless (`blocks/…`) layouts both count.
 * When several files classify as the same atom, the first in byte order of
 * the path wins (so an `auth/AuthProvider.knowledge.json` is the auth atom,
 * not `AuthProvider.tsx`). `relPath` is the path as it is in this pack;
 * `contentHash` is the bare hex sha256 of that file. Sorted by kind, then
 * id, in byte order.
 */
export function deriveAtoms(pack: PackFolder): AtomRef[] {
  const byKey = new Map<string, AtomRef>()
  for (const { ref } of atomOccurrences(pack)) {
    const key = `${ref.kind}:${ref.id}`
    if (!byKey.has(key)) byKey.set(key, ref)
  }
  return [...byKey.values()].sort((a, b) => compareBytes(a.kind, b.kind) || compareBytes(a.id, b.id))
}

/** `pwpack.json` as an object, or `null` when it is absent or not a JSON object. */
export function readIdentityJson(pack: PackFolder): Record<string, unknown> | null {
  const bytes = pack.files.get(IDENTITY_FILE)
  if (!bytes) return null
  try {
    const value: unknown = JSON.parse(stripBom(new TextDecoder().decode(bytes)))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Text without a leading byte-order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export interface DeriveManifestOptions {
  /** The `.pwpack` bytes the manifest describes; `contentHash` and `storageRef` are taken from them. */
  readonly archive: Uint8Array
  /** Overrides `pwpack.json` `id`. */
  readonly id?: string
  /** Overrides `pwpack.json` `version`. */
  readonly version?: string
}

/**
 * A full `PwpackManifest` for a pack and its archive.
 *
 * `id` / `version` come from the options or `pwpack.json`; `license` from
 * `pwpack.json` when it parses. `contentHash` is {@link legacyContentHash} of
 * the archive and `storageRef` is `pwpacks/<slug>/<version>/<first 12 hex>.tgz`
 * with `slug` = the id without its leading `@`, `/` turned into `-` — the
 * values existing publishers record. Throws `IDENTITY_REQUIRED` when no id or
 * version can be found.
 */
export function deriveManifest(pack: PackFolder, options: DeriveManifestOptions): PwpackManifest {
  const raw = readIdentityJson(pack)
  const id = options.id ?? (typeof raw?.['id'] === 'string' ? raw['id'] : undefined)
  const version = options.version ?? (typeof raw?.['version'] === 'string' ? raw['version'] : undefined)
  if (!id || !version) {
    throw new PackError('IDENTITY_REQUIRED', 'a manifest needs an id and a version (from pwpack.json or the options)')
  }
  const parsed = raw ? safeParsePwpackIdentity(raw) : null
  const license = parsed?.ok ? parsed.value.license : undefined
  const contentHash = legacyContentHash(options.archive)
  const slug = id.replace(/^@/, '').replace(/\//g, '-')
  return {
    id,
    version,
    atoms: deriveAtoms(pack),
    contentHash,
    storageRef: `pwpacks/${slug}/${version}/${contentHash.slice('sha256:'.length, 'sha256:'.length + 12)}.tgz`,
    ...(license ? { license } : {}),
  }
}
