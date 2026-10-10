/**
 * compileAtom — the single atom compiler.
 *
 * Source files in, one ES module out: a block's `component.tsx` (or a
 * capability's `handler.ts`, or a connector/provider engine) plus the
 * companion files it imports, bundled with esbuild into one ESM module the
 * runtime loads. The host-provided imports — the list in
 * `@pwfabric/core` (`BLOCK_HOST_IMPORTS`) — stay external;
 * the host's import map supplies them at load time.
 *
 * IN MEMORY ONLY. Every file comes from the caller's `files` map; an esbuild
 * plugin resolves and loads from that map and nothing else. There are no disk
 * writes, no disk reads of user paths and no network. A relative import that
 * climbs out of the tree is a diagnostic, not a read of whatever sits there.
 *
 * THE SEAM. The compiler returns data — bytes, hash, diagnostics. Storing the
 * bundle, recording it against an atom, licence checks and caching are the
 * caller's job, never this package's.
 *
 * DETERMINISM. Same input + same compiler version + same esbuild version →
 * identical `code` and `hash`. Both versions are returned so a caller can
 * record them beside the hash.
 *
 * @module @pwfabric/compiler/compile
 */
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import * as esbuild from 'esbuild'
import { atomKindMeta, type AtomKind } from '@pwfabric/contracts'
import { blockBundleExternals } from '@pwfabric/core'
import { joinVirtual, normalizeVirtualPath, PathEscapeError, resolveCandidates } from './paths.js'
import { buildWrapperSource, isValidEngineName, isValidSourceBase } from './wrappers.js'
import { COMPILER_VERSION, ESBUILD_VERSION } from './version.js'

// ============================================================
// CONTRACT
// ============================================================

/** Default cap on one compiled bundle; the caller may raise or lower it. */
export const MAX_ATOM_BUNDLE_BYTES = 500 * 1024

/** esbuild language targets the compiler accepts. */
export type CompileTarget =
  | 'es2018'
  | 'es2019'
  | 'es2020'
  | 'es2021'
  | 'es2022'
  | 'es2023'
  | 'es2024'
  | 'esnext'

/** Machine-readable reason for a diagnostic. */
export type DiagnosticCode =
  /** Bad call shape: missing entry, empty source, a kind that is not bundled. */
  | 'INVALID_INPUT'
  /** A file key or a relative import resolves outside the source tree. */
  | 'PATH_ESCAPE'
  /** A bare import that is not a host import. */
  | 'NON_HOST_IMPORT'
  /** A subpath of a host import — compiled external, but the host import map only resolves exact specifiers. */
  | 'HOST_SUBPATH_IMPORT'
  /** A relative import that names no file in the tree. */
  | 'UNRESOLVED_IMPORT'
  /** A relative import that names a file the caller did not declare as a companion. */
  | 'NOT_A_COMPANION'
  /** A file type the compiler has no loader for. */
  | 'UNSUPPORTED_FILE'
  /** A syntax or type-strip error reported by esbuild itself. */
  | 'ESBUILD_FAILED'
  /** The bundle is larger than `maxBytes`. */
  | 'BUNDLE_TOO_LARGE'

export interface Diagnostic {
  readonly severity: 'error' | 'warning'
  readonly code: DiagnosticCode
  readonly message: string
  /** Virtual path of the file the diagnostic points at, when esbuild knows it. */
  readonly file?: string
  readonly line?: number
  readonly column?: number
}

export interface CompileInput {
  /**
   * The source tree: POSIX path relative to a virtual root → file content.
   * Backslashes are normalised; absolute or root-escaping keys are refused.
   */
  readonly files: Readonly<Record<string, string | Uint8Array>>
  /**
   * The entry's path in `files`. For `identity` kinds (block, capability) it is
   * the atom's own source (`blocks/<cat>/<name>/component.tsx`). For
   * `sibling-generated` kinds (connector, provider) it is the wrapper path the
   * contract derives (`resolveSiblingEntry(...).wrapperPath`); the compiler
   * generates that file, and the engine source must be in `files`.
   */
  readonly entry: string
  /**
   * Paths in `files` the entry may reach through relative imports (shared lib
   * code, `_shared-*` siblings, an engine source). Omitted → every file in
   * `files` may be reached. Given → importing any other file is a
   * `NOT_A_COMPANION` error. `collectCompanions()` computes this list.
   */
  readonly companions?: readonly string[]
  /** Atom kind; drives the entry wrapper. Default `'block'`. */
  readonly kind?: AtomKind
  /** `sibling-generated` kinds only: the engine's base name (connector `<Name>`, provider `<domain>`). */
  readonly engineName?: string
  /** Default `'es2022'`. */
  readonly target?: CompileTarget
  /** Default `true`. */
  readonly minify?: boolean
  /** Produce a source map in `map`. Default `false`. */
  readonly sourcemap?: boolean
  /** Bundle size cap in bytes. Default {@link MAX_ATOM_BUNDLE_BYTES}. */
  readonly maxBytes?: number
}

export interface CompileResult {
  readonly ok: boolean
  /** The ES module. Empty when `ok` is false. */
  readonly code: string
  /** Source map JSON, when `sourcemap` was requested and the compile succeeded. */
  readonly map?: string
  /** `sha256:<hex>` of the UTF-8 bytes of `code`. Empty when `ok` is false. */
  readonly hash: string
  /** Byte length of `code`. */
  readonly size: number
  readonly diagnostics: readonly Diagnostic[]
  /** Host imports the module imports, sorted. These are what the host must provide to load it. */
  readonly externals: readonly string[]
  readonly compilerVersion: string
  readonly esbuildVersion: string
}

// ============================================================
// LOADERS
// ============================================================

const LOADERS: Readonly<Record<string, esbuild.Loader>> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
  '.json': 'json',
}

const NAMESPACE = 'pwfabric-atom'
const OUTFILE = 'bundle.mjs'

// ============================================================
// COMPILER
// ============================================================

/** Compile one atom. Never throws for bad input — every problem is a diagnostic. */
export async function compileAtom(input: CompileInput): Promise<CompileResult> {
  const diagnostics: Diagnostic[] = []
  const fail = (extra?: Diagnostic): CompileResult => {
    if (extra) diagnostics.push(extra)
    return result({ ok: false, code: '', hash: '', size: 0, diagnostics, externals: [] })
  }

  // ── normalise the tree ─────────────────────────────────────────
  const files = new Map<string, string | Uint8Array>()
  for (const [rawKey, content] of Object.entries(input.files)) {
    try {
      files.set(normalizeVirtualPath(rawKey), content)
    } catch (e) {
      if (e instanceof PathEscapeError) return fail(error('PATH_ESCAPE', `file key '${rawKey}' resolves outside the source tree`))
      throw e
    }
  }

  let entry: string
  let allowed: Set<string> | null = null
  try {
    entry = normalizeVirtualPath(input.entry)
    if (input.companions) allowed = new Set(input.companions.map(normalizeVirtualPath))
  } catch (e) {
    if (e instanceof PathEscapeError) return fail(error('PATH_ESCAPE', `${e.message}`))
    throw e
  }

  // ── entry wrapper, by kind ─────────────────────────────────────
  const kind: AtomKind = input.kind ?? 'block'
  const meta = atomKindMeta(kind)
  if (!meta.bundled) return fail(error('INVALID_INPUT', `Atom kind "${kind}" is not a bundled kind`))

  let esbuildEntry: string
  const ext = posix.extname(entry)
  if (meta.entry === 'identity') {
    const source = files.get(entry)
    if (source === undefined) return fail(error('INVALID_INPUT', `entry '${entry}' is not in the source tree`))
    if (source.length === 0) return fail(error('INVALID_INPUT', `Atom source for "${entry}" is empty`))
    const sourceBase = posix.basename(entry, ext)
    // The basename is written into the generated wrapper; it must be a plain name.
    if (!isValidSourceBase(sourceBase)) {
      return fail(error('INVALID_INPUT', `entry basename ${JSON.stringify(sourceBase)} may only contain letters, digits, '_', '-' and '.'`))
    }
    const wrapperPath = posix.join(posix.dirname(entry), `_bundle-entry${ext}`)
    if (files.has(wrapperPath)) {
      return fail(error('INVALID_INPUT', `'${wrapperPath}' is reserved for the generated entry wrapper`))
    }
    files.set(wrapperPath, buildWrapperSource(kind, { sourceBase }))
    allowed?.add(entry)
    esbuildEntry = wrapperPath
  } else if (meta.entry === 'sibling-generated') {
    if (!input.engineName) return fail(error('INVALID_INPUT', `Atom "${entry}" (${kind}) needs engineName`))
    // The engine name is written into the generated wrapper; it must be a plain name.
    if (!isValidEngineName(input.engineName)) {
      return fail(error('INVALID_INPUT', `engineName ${JSON.stringify(input.engineName)} may only contain letters, digits, '_' and '-'`))
    }
    if (files.has(entry)) {
      return fail(error('INVALID_INPUT', `'${entry}' is generated by the compiler for ${kind} atoms; it must not be in the source tree`))
    }
    files.set(entry, buildWrapperSource(kind, { engineName: input.engineName }))
    esbuildEntry = entry
  } else {
    return fail(error('INVALID_INPUT', `Atom kind "${kind}" has no bundleable entry`))
  }
  allowed?.add(esbuildEntry)

  // ── bundle ─────────────────────────────────────────────────────
  const hostImports = new Set(blockBundleExternals())
  const plugin = virtualTreePlugin(files, allowed, hostImports)

  let built: esbuild.BuildResult<{ write: false; metafile: true }>
  try {
    built = await esbuild.build({
      entryPoints: [esbuildEntry],
      outfile: OUTFILE,
      write: false,
      metafile: true,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: input.target ?? 'es2022',
      minify: input.minify ?? true,
      treeShaking: true,
      sourcemap: input.sourcemap ? 'external' : false,
      jsx: 'automatic',
      logLevel: 'silent',
      plugins: [plugin],
    })
  } catch (e) {
    const failure = e as Partial<esbuild.BuildFailure>
    if (!Array.isArray(failure.errors)) throw e
    diagnostics.push(...failure.errors.map((m) => fromMessage(m, 'error')))
    diagnostics.push(...(failure.warnings ?? []).map((m) => fromMessage(m, 'warning')))
    return fail()
  }
  diagnostics.push(...built.warnings.map((m) => fromMessage(m, 'warning')))

  const out = built.outputFiles.find((f) => f.path.endsWith('.mjs'))
  const mapFile = built.outputFiles.find((f) => f.path.endsWith('.mjs.map'))
  /* c8 ignore next -- esbuild always emits the bundle when the build succeeds */
  if (!out) return fail(error('ESBUILD_FAILED', 'esbuild produced no output'))

  const maxBytes = input.maxBytes ?? MAX_ATOM_BUNDLE_BYTES
  if (out.contents.length > maxBytes) {
    return fail(error('BUNDLE_TOO_LARGE', `Atom "${entry}" bundle ${out.contents.length} bytes exceeds limit ${maxBytes}`))
  }

  const externals = new Set<string>()
  for (const output of Object.values(built.metafile.outputs)) {
    for (const imp of output.imports) if (imp.external) externals.add(imp.path)
  }

  return result({
    ok: true,
    code: out.text,
    ...(mapFile ? { map: mapFile.text } : {}),
    hash: `sha256:${createHash('sha256').update(out.contents).digest('hex')}`,
    size: out.contents.length,
    diagnostics,
    externals: [...externals].sort(),
  })
}

// ============================================================
// THE VIRTUAL TREE
// ============================================================

/**
 * Resolves every import against the in-memory tree. Bare host imports are
 * external; every other bare import, every unresolvable or escaping relative
 * import and every undeclared companion is an error carrying its code in
 * `detail`, so all of them are reported in one pass.
 */
function virtualTreePlugin(
  files: ReadonlyMap<string, string | Uint8Array>,
  allowed: ReadonlySet<string> | null,
  hostImports: ReadonlySet<string>
): esbuild.Plugin {
  const reject = (code: DiagnosticCode, text: string): esbuild.OnResolveResult => ({
    errors: [{ text, detail: code }],
  })
  return {
    name: 'pwfabric-virtual-tree',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const spec = args.path
        if (args.kind === 'entry-point') return { path: spec, namespace: NAMESPACE }

        if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) {
          return reject('PATH_ESCAPE', `absolute import '${spec}' is not allowed; import relative to the file`)
        }
        if (spec.startsWith('.')) {
          let joined: string
          try {
            joined = joinVirtual(args.importer, spec)
          } catch {
            return reject('PATH_ESCAPE', `relative import '${spec}' resolves outside the source tree`)
          }
          const hit = resolveCandidates(joined).find((c) => files.has(c))
          if (!hit) return reject('UNRESOLVED_IMPORT', `cannot resolve '${spec}' from '${args.importer}'`)
          if (allowed && !allowed.has(hit)) {
            return reject('NOT_A_COMPANION', `'${spec}' resolves to '${hit}', which is not a declared companion of this atom`)
          }
          return { path: hit, namespace: NAMESPACE }
        }

        if (hostImports.has(spec)) return { path: spec, external: true }
        const hostRoot = [...hostImports].find((h) => spec.startsWith(`${h}/`))
        if (hostRoot) {
          return {
            path: spec,
            external: true,
            warnings: [
              {
                text: `'${spec}' is a subpath of the host import '${hostRoot}'; it stays external, but a host import map resolves exact specifiers only, so the host must map it explicitly`,
                detail: 'HOST_SUBPATH_IMPORT',
              },
            ],
          }
        }
        return reject(
          'NON_HOST_IMPORT',
          `'${spec}' is not a host import. A bare import must be one the host provides (${[...hostImports].sort().join(', ')}); bundle anything else as a companion file`
        )
      })

      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
        const loader = LOADERS[posix.extname(args.path)]
        if (!loader) {
          return { errors: [{ text: `no loader for '${args.path}' (supported: ${Object.keys(LOADERS).join(', ')})`, detail: 'UNSUPPORTED_FILE' }] }
        }
        return { contents: files.get(args.path) as string | Uint8Array, loader }
      })
    },
  }
}

// ============================================================
// HELPERS
// ============================================================

function error(code: DiagnosticCode, message: string): Diagnostic {
  return { severity: 'error', code, message }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<DiagnosticCode>([
  'INVALID_INPUT',
  'PATH_ESCAPE',
  'NON_HOST_IMPORT',
  'HOST_SUBPATH_IMPORT',
  'UNRESOLVED_IMPORT',
  'NOT_A_COMPANION',
  'UNSUPPORTED_FILE',
  'ESBUILD_FAILED',
  'BUNDLE_TOO_LARGE',
])

function fromMessage(m: esbuild.Message, severity: Diagnostic['severity']): Diagnostic {
  const code: DiagnosticCode =
    typeof m.detail === 'string' && KNOWN_CODES.has(m.detail) ? (m.detail as DiagnosticCode) : 'ESBUILD_FAILED'
  const loc = m.location
  return {
    severity,
    code,
    message: m.text,
    ...(loc ? { file: loc.file.replace(`${NAMESPACE}:`, ''), line: loc.line, column: loc.column } : {}),
  }
}

function result(
  r: Omit<CompileResult, 'compilerVersion' | 'esbuildVersion'>
): CompileResult {
  return { ...r, compilerVersion: COMPILER_VERSION, esbuildVersion: ESBUILD_VERSION }
}
