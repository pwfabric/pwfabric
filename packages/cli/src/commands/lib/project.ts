/**
 * The project folder as the commands see it: which files belong to the pack,
 * where the local pack cache lives, and how a pack source (folder or archive)
 * is opened.
 *
 * A project is a pwpack folder plus things that are never packed: the `.pwf/`
 * cache (installed pack builds), the `.gitignore` next to it, and anything
 * else outside the pack content (`packContent`: `pwpack.json`, `LICENSE`,
 * `NOTICE`, `README.md`, `app/`, `atoms/`, `media/`).
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  DEFAULT_IGNORED_NAMES,
  isSafePackPath,
  readFolder,
  readPwpack,
  type PackFolder,
} from '@pwfabric/pack'

/** The project-local working directory (pack cache, build output of other commands). */
export const PWF_DIR = '.pwf'
/** Installed pack builds, one folder per `<id>@<version>`. */
export const PACK_CACHE_DIR = `${PWF_DIR}/packs`
/** The note `create` writes into `atoms/`. Pack content (documentation, `DOC_FILE`), so it travels with the pack. */
export const ATOMS_README = 'atoms/README.md'

/** Names skipped at any depth when a project is read: the defaults plus the cache and VCS ignore file. */
export const PROJECT_IGNORED_NAMES: ReadonlySet<string> = new Set([...DEFAULT_IGNORED_NAMES, PWF_DIR, '.gitignore'])

/**
 * Reads a project folder into memory, without the cache. The author's tooling
 * (`package.json`, `scripts/`, …) is still in it — validation reports on it;
 * `packContent` is what is packed, installed and hashed.
 */
export async function readProject(dir: string): Promise<PackFolder> {
  const read = await readFolder(dir, { ignore: PROJECT_IGNORED_NAMES })
  // A dot entry at the root (`.editorconfig`, `.vscode/`, …) is never pack
  // content; it is the author's environment and is not reported on.
  return { files: new Map([...read.files].filter(([path]) => !path.startsWith('.'))) }
}

/**
 * Opens a pack source: a folder (read like a project, so its own `.pwf/`
 * cache never travels) or a `.pwpack` / `.tgz` archive.
 */
export async function readPackSource(path: string): Promise<PackFolder> {
  const st = await stat(path).catch(() => null)
  if (!st) throw new Error(`no such file or folder: ${path}`)
  if (st.isDirectory()) return readProject(path)
  return readPwpack(new Uint8Array(await readFile(path)))
}

/**
 * Relative folder of one pack build in the cache: `.pwf/packs/<id>@<version>`.
 * A scoped id (`@pwpack/acme/cards`) nests the way npm scopes do. Throws when
 * the id or version could escape the cache.
 */
export function cacheRelDir(id: string, version: string): string {
  const rel = `${id}@${version}`
  if (!isSafePackPath(rel) || /[<>:"|?*]/.test(rel)) throw new Error(`pack id "${id}" with version "${version}" is not usable as a cache folder name`)
  return `${PACK_CACHE_DIR}/${rel}`
}

/** Absolute folder of one pack build in a project's cache. */
export function cacheDir(root: string, id: string, version: string): string {
  return join(root, ...cacheRelDir(id, version).split('/'))
}

/** Reads a cached pack build exactly as it was written: nothing is skipped. */
export async function readCachedPack(dir: string): Promise<PackFolder> {
  return readFolder(dir, { ignore: new Set() })
}

/** Writes a pack folder to disk, replacing whatever was there. */
export async function writePackFolder(dir: string, pack: PackFolder): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  for (const [path, bytes] of pack.files) {
    const target = join(dir, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
}

/** Resolves a user-given path against the command's working directory. */
export function resolveFrom(cwd: string, path: string | undefined): string {
  return resolve(cwd, path ?? '.')
}
