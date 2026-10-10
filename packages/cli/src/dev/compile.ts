/**
 * Compiling the atoms an app runs on — its own and those of every pinned
 * pack — with the engine's compiler, and remembering the output by content
 * hash so a rebuild only compiles what changed.
 *
 * The cache key of an atom is everything its output depends on: the compiler
 * and esbuild versions, the atom's kind and entry, and the bytes of the files
 * the compile can reach (the entry plus the shared companions it imports).
 * Change one block and only that block — or the blocks sharing the changed
 * companion — compile again.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import {
  COMPILER_VERSION,
  ESBUILD_VERSION,
  collectCompanions,
  compileAtom,
  type CompileResult,
} from '@pwfabric/compiler'
import { atomKindMeta, resolveSiblingEntry, type AtomKind, type AtomRef } from '@pwfabric/contracts'
import type { AssembleDiagnostic } from './diagnostics.js'
import { isRecord, jsonOf, type SourcePack } from './sources.js'

/** Kinds that carry a compiled module. */
export const COMPILED_KINDS: ReadonlySet<AtomKind> = new Set<AtomKind>(['block', 'capability', 'connector', 'provider'])

/** One atom after the compile step. */
export interface CompiledAtom {
  readonly source: SourcePack
  readonly kind: AtomKind
  readonly id: string
  /** Path of the atom's file inside its source folder. */
  readonly relPath: string
  /** `sha256:<hex>` of that file. */
  readonly sourceHash: string
  /**
   * `compiled` — a module was produced; `precompiled` — the pack shipped one;
   * `declared` — an engine that is data, nothing to compile; `failed`.
   */
  readonly status: 'compiled' | 'precompiled' | 'declared' | 'failed'
  readonly code?: string
  /** `sha256:<hex>` of `code`. */
  readonly hash?: string
  readonly diagnostics: readonly AssembleDiagnostic[]
  readonly fromCache: boolean
  /** The atom's manifest (`manifest.json` next to it, or the knowledge file itself). */
  readonly manifest?: Record<string, unknown>
}

/** What the cache stores per key. */
export interface CachedCompile {
  readonly ok: boolean
  readonly code: string
  readonly hash: string
  readonly diagnostics: CompileResult['diagnostics']
}

export interface CompileCache {
  get(key: string): Promise<CachedCompile | undefined>
  set(key: string, value: CachedCompile): Promise<void>
}

/**
 * A cache in `dir` (one JSON file per key) with an in-memory layer in front.
 * Disk failures are not build failures: a cache that cannot be read or
 * written just compiles again.
 */
export function createCompileCache(dir: string | null): CompileCache {
  const memory = new Map<string, CachedCompile>()
  return {
    async get(key) {
      const hit = memory.get(key)
      if (hit) return hit
      if (!dir) return undefined
      try {
        const value = JSON.parse(await readFile(join(dir, `${key}.json`), 'utf8')) as CachedCompile
        if (typeof value?.code !== 'string' || typeof value.ok !== 'boolean' || !Array.isArray(value.diagnostics)) return undefined
        memory.set(key, value)
        return value
      } catch {
        return undefined
      }
    },
    async set(key, value) {
      memory.set(key, value)
      if (!dir) return
      try {
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, `${key}.json`), JSON.stringify(value))
      } catch {
        // A read-only or full disk only costs the next build a recompile.
      }
    },
  }
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The root under which a source keeps its atoms: `atoms/` in the canonical layout, `` in the rootless one. */
export function atomRootOf(source: SourcePack): string {
  return [...source.folder.files.keys()].some((p) => p.startsWith('atoms/')) ? 'atoms/' : ''
}

/** The compiler's view of a source: atom files keyed by their path below the atom root. */
export function compileTreeOf(source: SourcePack): Record<string, Uint8Array> {
  const root = atomRootOf(source)
  const tree: Record<string, Uint8Array> = {}
  for (const [path, bytes] of source.folder.files) {
    if (root) {
      if (path.startsWith(root)) tree[path.slice(root.length)] = bytes
    } else if (path !== 'pwpack.json' && !path.startsWith('app/')) {
      tree[path] = bytes
    }
  }
  return tree
}

function manifestOf(source: SourcePack, ref: AtomRef): Record<string, unknown> | undefined {
  const own = ref.relPath.endsWith('.json') ? ref.relPath : posix.join(posix.dirname(ref.relPath), 'manifest.json')
  const value = jsonOf(source.folder, own)
  return isRecord(value) ? value : undefined
}

function keyOf(parts: unknown): string {
  return sha256(JSON.stringify(parts))
}

function fileHashes(tree: Readonly<Record<string, Uint8Array>>, paths: readonly string[]): [string, string][] {
  return [...new Set(paths)].sort().map((p) => [p, tree[p] ? sha256(tree[p] as Uint8Array) : '-'])
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
  return out
}

interface AtomJob {
  readonly source: SourcePack
  readonly ref: AtomRef
  readonly tree: Readonly<Record<string, Uint8Array>>
  readonly root: string
}

async function compileOne(job: AtomJob, cache: CompileCache): Promise<CompiledAtom> {
  const { source, ref, tree, root } = job
  const bytes = source.folder.files.get(ref.relPath) as Uint8Array
  const manifest = manifestOf(source, ref)
  const base = {
    source,
    kind: ref.kind,
    id: ref.id,
    relPath: ref.relPath,
    sourceHash: `sha256:${ref.contentHash || sha256(bytes)}`,
    ...(manifest ? { manifest } : {}),
  }
  const at = (virtual: string | undefined): string | undefined => {
    if (virtual === undefined) return undefined
    const p = `${root}${virtual}`
    return source.label ? `${source.label}/${p}` : p
  }
  const virtual = ref.relPath.slice(root.length)
  const label = at(virtual) as string
  const diagnostics: AssembleDiagnostic[] = []
  const meta = atomKindMeta(ref.kind)

  // A pack may ship an already-compiled block (`bundle.mjs`).
  if (meta.precompiledFallback && ref.relPath.endsWith('.mjs')) {
    return {
      ...base,
      status: 'precompiled',
      code: new TextDecoder().decode(bytes),
      hash: `sha256:${sha256(bytes)}`,
      diagnostics,
      fromCache: false,
    }
  }

  let entry: string
  let engineName: string | undefined
  let reach: string[]
  let companions: string[] | undefined
  if (meta.entry === 'identity') {
    entry = virtual
    const scan = collectCompanions(tree, entry)
    for (const v of scan.violations) {
      diagnostics.push({ severity: 'warning', code: 'SCREEN', message: v, path: label })
    }
    companions = [...scan.companions]
    reach = [entry, ...companions]
  } else {
    const sibling = resolveSiblingEntry(ref.kind, virtual)
    if (!sibling || !tree[sibling.enginePath]) {
      // No engine source beside the knowledge file: the engine is data (a
      // declaration) or the atom is knowledge only. Nothing to compile.
      return { ...base, status: 'declared', diagnostics, fromCache: false }
    }
    entry = sibling.wrapperPath
    engineName = posix.basename(sibling.enginePath, '.ts')
    // An engine may import neighbours that are not companions; key on the whole tree.
    reach = Object.keys(tree)
  }

  const key = keyOf([
    COMPILER_VERSION,
    ESBUILD_VERSION,
    ref.kind,
    entry,
    engineName ?? null,
    companions ?? null,
    fileHashes(tree, reach),
  ])
  let result = await cache.get(key)
  const fromCache = result !== undefined
  if (!result) {
    const compiled = await compileAtom({
      files: tree,
      entry,
      kind: ref.kind,
      ...(engineName !== undefined ? { engineName } : {}),
      ...(companions !== undefined ? { companions } : {}),
    })
    result = { ok: compiled.ok, code: compiled.code, hash: compiled.hash, diagnostics: compiled.diagnostics }
    await cache.set(key, result)
  }
  for (const d of result.diagnostics) {
    diagnostics.push({
      severity: d.severity,
      code: d.code,
      message: d.message,
      path: at(d.file) ?? label,
      ...(d.line !== undefined ? { line: d.line } : {}),
      ...(d.column !== undefined ? { column: d.column } : {}),
    })
  }
  if (!result.ok) return { ...base, status: 'failed', diagnostics, fromCache }
  return { ...base, status: 'compiled', code: result.code, hash: result.hash, diagnostics, fromCache }
}

/** Compiles every compiled-kind atom of every source. */
export async function compileSources(
  sources: readonly SourcePack[],
  cache: CompileCache,
  concurrency = 8
): Promise<CompiledAtom[]> {
  const jobs: AtomJob[] = []
  for (const source of sources) {
    const tree = compileTreeOf(source)
    const root = atomRootOf(source)
    for (const ref of source.validation.atoms) {
      if (!COMPILED_KINDS.has(ref.kind)) continue
      if (!ref.relPath.startsWith(root)) continue
      jobs.push({ source, ref, tree, root })
    }
  }
  return mapLimit(jobs, concurrency, (job) => compileOne(job, cache))
}
