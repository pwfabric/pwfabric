/**
 * `pwf font add <family> --from <path|https-url|npm:<package>>` — put a font
 * family's WOFF2 files into the app (`media/fonts/`), its licence text beside
 * them, record them in `media/provenance.json`, and declare them in the
 * theme's `fonts` (appearance §3.3). Fonts are the app's own files: nothing
 * is fetched at build time, only when this command runs. Running it again
 * changes nothing that is already there.
 *
 * @module @pwfabric/cli/commands/font
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { readTar } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { guard, stringFlag, stringFlags, UsageError } from './lib/flags.js'
import { CommandFailure } from './lib/failure.js'
import { resolveFrom } from './lib/project.js'
import { isWoff2 } from '../dev/font-file.js'
import { findTheme, themeAtomOf, type ThemeAtom } from '../dev/theme.js'
import type { Fetch } from '../phiwebs/oauth.js'

/** A font file may be at most 500 KB (appearance §3.3). */
const FONT_FILE_MAX = 512_000
/** The npm registry a `npm:` source is resolved through. */
export const NPM_REGISTRY = 'https://registry.npmjs.org'
/** The subsets taken from a package that splits a family by script. */
const SUBSETS = ['latin', 'latin-ext']

/** One file to put into the app. */
interface FontFace {
  /** Its name under media/fonts/. */
  readonly name: string
  readonly bytes: Uint8Array
  readonly weight: number | string
  readonly style: 'normal' | 'italic'
  readonly unicodeRange?: string
}

/** What a source gives: the faces, a licence text, and where they came from. */
interface FontSource {
  readonly faces: FontFace[]
  readonly licence?: { readonly name: string; readonly bytes: Uint8Array }
  readonly origin: string
  readonly license?: string
  /** The family's generic family, from the package's metadata (Fontsource `category`). */
  readonly category?: string
}

export interface FontAddOptions {
  /** The app folder. */
  readonly root: string
  readonly family: string
  /** A local `.woff2` file or folder, an `https://` address, or `npm:<package>[@<version>]`. */
  readonly from: string
  /** The weights to take (`400`, `"100 900"`); default 400. */
  readonly weights?: readonly string[]
  /** The styles to take; default normal. */
  readonly styles?: readonly ('normal' | 'italic')[]
  readonly fallback?: string
  readonly fetch?: Fetch
  /** The clock provenance records (`createdAt`). */
  readonly now?: () => Date
}

export interface FontAddResult {
  readonly family: string
  /** media/fonts/… paths written (new or changed). */
  readonly written: string[]
  /** media/fonts/… paths already there with the same bytes. */
  readonly kept: string[]
  /** Whether the theme's `fonts` changed. */
  readonly declared: boolean
  /** The file the theme's `fonts` are in: the app's own theme atom its appearance uses, else app/definitions/appearance.json. */
  readonly declaredIn: string
  /** The family's declared fallback, when it has one. */
  readonly fallback?: string
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font'
const safeName = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '')

/** A weight as the theme writes it: a number, or a variable range `"100 900"`. */
function weightOf(raw: string): number | string {
  const t = raw.trim().replace(/\s+/g, ' ')
  const inRange = (n: string): boolean => /^[1-9]\d{0,3}$/.test(n) && Number(n) <= 1000
  if (inRange(t)) return Number(t)
  const [lo, hi, more] = t.split(' ')
  if (lo !== undefined && hi !== undefined && more === undefined && inRange(lo) && inRange(hi) && Number(lo) <= Number(hi)) return t
  throw new UsageError(`--weight "${raw}" is not a weight from 1 to 1000 or a range like "100 900"`)
}

/** The generic family a Fontsource `category` stands for. */
const CATEGORY_FALLBACK: Readonly<Record<string, string>> = { 'sans-serif': 'sans-serif', serif: 'serif', monospace: 'monospace', handwriting: 'cursive' }

function styleOf(raw: string): 'normal' | 'italic' {
  if (raw === 'normal' || raw === 'italic') return raw
  throw new UsageError(`--style "${raw}" is not normal or italic`)
}

/** A licence text by its name: LICENSE, LICENCE, OFL, COPYING (any extension). */
const LICENCE_NAME = /^(?:licen[cs]e|ofl|copying)(?:[._-].*)?$/i

/** Faces from a local `.woff2` file or a folder of them, with a licence text found beside them. */
async function fromPath(path: string, family: string, weight: number | string, style: 'normal' | 'italic'): Promise<FontSource> {
  const info = await stat(path).catch(() => null)
  if (!info) throw new CommandFailure('FONT_SOURCE_MISSING', `${path} does not exist`)
  const dir = info.isDirectory() ? path : resolve(path, '..')
  const names = info.isDirectory() ? (await readdir(path)).filter((n) => n.toLowerCase().endsWith('.woff2')).sort() : [basename(path)]
  if (names.length === 0) throw new CommandFailure('FONT_SOURCE_EMPTY', `${path} holds no .woff2 file`)
  const faces: FontFace[] = []
  for (const n of names) {
    const own = n.replace(/\.woff2$/i, '')
    // In a folder of several faces, each file's name says its weight and style when it can (inter-700-italic).
    const named = names.length > 1 ? /(?:^|[-_])([1-9]00)(?:[-_]|$)/.exec(own)?.[1] : undefined
    const italic = names.length > 1 && /italic/i.test(own)
    faces.push({
      name: `${safeName(own.toLowerCase().startsWith(slug(family)) ? own : `${slug(family)}-${own}`)}.woff2`,
      bytes: new Uint8Array(await readFile(join(dir, n))),
      weight: named ? Number(named) : weight,
      style: italic ? 'italic' : style,
    })
  }
  const licenceName = (await readdir(dir)).find((n) => LICENCE_NAME.test(n))
  return {
    faces,
    ...(licenceName ? { licence: { name: licenceName, bytes: new Uint8Array(await readFile(join(dir, licenceName))) } } : {}),
    origin: path,
  }
}

/** One face downloaded from an `https://` address. */
async function fromUrl(url: string, family: string, weight: number | string, style: 'normal' | 'italic', fetchFn: Fetch): Promise<FontSource> {
  if (!/^https:\/\//i.test(url)) throw new UsageError('--from takes a local path, an https:// address or npm:<package>')
  const res = await fetchFn(url)
  if (!res.ok) throw new CommandFailure('FONT_DOWNLOAD_FAILED', `${url} answered ${res.status}`)
  const name = safeName(decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'font.woff2'))
  return { faces: [{ name: name.startsWith(slug(family)) ? name : `${slug(family)}-${name}`, bytes: new Uint8Array(await res.arrayBuffer()), weight, style }], origin: url }
}

/** The `unicode-range` of each file a package's CSS declares, by file name. */
function unicodeRangesOf(files: ReadonlyMap<string, Uint8Array>): Map<string, string> {
  const out = new Map<string, string>()
  const decoder = new TextDecoder()
  for (const [path, bytes] of files) {
    if (!path.endsWith('.css')) continue
    for (const block of decoder.decode(bytes).split('@font-face').slice(1)) {
      const file = /url\(["']?[^)"']*?([^/)"']+\.woff2)["']?\)/.exec(block)?.[1]
      const range = /unicode-range:\s*([^;}]+)/.exec(block)?.[1]?.trim()
      if (file && range && !out.has(file)) out.set(file, range.replace(/\s*,\s*/g, ', '))
    }
  }
  return out
}

/**
 * The faces of an npm font package (a Fontsource package, which ships its
 * files as `files/<id>-<subset>-<weight>-<style>.woff2`, or
 * `<id>-<subset>-wght-<style>.woff2` for a variable family): the requested
 * weights and styles, in the latin and latin-ext subsets, each with the
 * `unicode-range` its CSS gives, and the package's licence text.
 */
async function fromNpm(
  spec: string,
  family: string,
  weights: readonly (number | string)[],
  styles: readonly ('normal' | 'italic')[],
  fetchFn: Fetch
): Promise<FontSource> {
  const at = spec.lastIndexOf('@')
  const [pkg, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, 'latest']
  if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(pkg)) throw new UsageError(`npm:${spec} does not name an npm package`)
  const metaUrl = `${NPM_REGISTRY}/${pkg.replace('/', '%2f')}/${encodeURIComponent(version)}`
  const meta = await fetchFn(metaUrl)
  if (!meta.ok) throw new CommandFailure('FONT_PACKAGE_NOT_FOUND', `the npm registry has no ${pkg}@${version} (${meta.status})`)
  const doc = (await meta.json()) as { version?: string; license?: unknown; dist?: { tarball?: string } }
  const tarball = doc.dist?.tarball
  if (!tarball || !/^https:\/\//.test(tarball)) throw new CommandFailure('FONT_PACKAGE_NOT_FOUND', `${pkg}@${version} names no tarball`)
  const tgz = await fetchFn(tarball)
  if (!tgz.ok) throw new CommandFailure('FONT_DOWNLOAD_FAILED', `${tarball} answered ${tgz.status}`)
  const entries = readTar(gunzipSync(new Uint8Array(await tgz.arrayBuffer())), { maxEntries: 20_000, maxEntryBytes: 20_000_000, maxTotalBytes: 400_000_000 })
  const files = new Map<string, Uint8Array>()
  for (const e of entries) if (e.type === 'file') files.set(e.name.replace(/^package\//, ''), e.data)
  const ranges = unicodeRangesOf(files)
  let metadata: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(new TextDecoder().decode(files.get('metadata.json') ?? new Uint8Array()) || '{}') as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>
  } catch {
    // no metadata: no category, the default variable range
  }
  const wght = (metadata['variable'] as { wght?: { min?: unknown; max?: unknown } } | undefined)?.wght
  const variableRange = wght && /^\d+$/.test(String(wght.min)) && /^\d+$/.test(String(wght.max)) ? `${String(wght.min)} ${String(wght.max)}` : '100 900'
  const category = typeof metadata['category'] === 'string' ? metadata['category'] : undefined
  const faces: FontFace[] = []
  const wanted = new Set(weights.map((w) => String(w)))
  for (const [path, bytes] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const m = /(?:^|\/)([a-z0-9-]+?)-(latin-ext|latin)-(\d00|wght)-(normal|italic)\.woff2$/.exec(path)
    if (!m) continue
    const [, , subset, w, style] = m as unknown as [string, string, string, string, 'normal' | 'italic']
    if (!SUBSETS.includes(subset) || !styles.includes(style)) continue
    const weight: number | string = w === 'wght' ? variableRange : Number(w)
    if (w !== 'wght' && !wanted.has(w)) continue
    const name = basename(path)
    faces.push({ name: `${slug(family)}-${subset}-${w}-${style}.woff2`, bytes, weight, style, ...(ranges.has(name) ? { unicodeRange: ranges.get(name) as string } : {}) })
  }
  if (faces.length === 0) {
    throw new CommandFailure('FONT_SOURCE_EMPTY', `${pkg}@${doc.version ?? version} has no latin or latin-ext .woff2 file of weight ${[...wanted].join(', ')} and style ${styles.join(', ')}`)
  }
  const licencePath = [...files.keys()].find((p) => !p.includes('/') && LICENCE_NAME.test(p))
  return {
    faces,
    ...(licencePath ? { licence: { name: licencePath, bytes: files.get(licencePath) as Uint8Array } } : {}),
    origin: `npm:${pkg}@${doc.version ?? version}`,
    ...(typeof doc.license === 'string' ? { license: doc.license } : {}),
    ...(category ? { category } : {}),
  }
}

/**
 * Where the app's theme tokens are written: the app's own `ui-appearance`
 * atom (`atoms/appearance/<theme>/manifest.json`) its appearance.json names
 * by `use`; undefined when there is none (appearance.json itself).
 */
async function themeHome(root: string, appearance: Record<string, unknown>): Promise<{ path: string; rel: string; doc: Record<string, unknown> } | undefined> {
  const config = appearance['config'] && typeof appearance['config'] === 'object' ? (appearance['config'] as Record<string, unknown>) : appearance
  const use = config['use']
  if (typeof use !== 'string' || !use.trim()) return undefined
  const dir = join(root, 'atoms', 'appearance')
  const themes: ThemeAtom[] = []
  const docs = new Map<string, Record<string, unknown>>()
  for (const name of existsSync(dir) ? (await readdir(dir)).sort() : []) {
    const doc = await readJsonFile(join(dir, name, 'manifest.json')).catch(() => ({}))
    const theme = themeAtomOf(name, doc, name)
    if (theme) {
      themes.push(theme)
      docs.set(name, doc)
    }
  }
  const hit = findTheme(use, themes)
  if (!hit) return undefined
  return { path: join(dir, hit.id, 'manifest.json'), rel: `atoms/appearance/${hit.id}/manifest.json`, doc: docs.get(hit.id) as Record<string, unknown> }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((x, i) => x === b[i])

/** Reads a JSON file, `{}` when it is not there. */
async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {}
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Adds a family's files to the app and declares them (see the module note). */
export async function fontAdd(options: FontAddOptions): Promise<FontAddResult> {
  const family = options.family.trim()
  if (!family || /["';{}<>\\,]/.test(family)) throw new UsageError(`"${options.family}" is not a font family name`)
  const weights = (options.weights?.length ? options.weights : ['400']).map(weightOf)
  const styles = options.styles?.length ? [...options.styles] : (['normal'] as const)
  const fetchFn = options.fetch ?? fetch
  const from = options.from
  let source: FontSource
  if (from.startsWith('npm:')) source = await fromNpm(from.slice(4), family, weights, styles, fetchFn)
  else if (/^https?:\/\//i.test(from)) source = await fromUrl(from, family, weights[0] as number | string, styles[0] as 'normal' | 'italic', fetchFn)
  else source = await fromPath(resolve(options.root, from), family, weights[0] as number | string, styles[0] as 'normal' | 'italic')

  for (const face of source.faces) {
    if (!isWoff2(face.bytes)) throw new CommandFailure('FONT_FILE_INVALID', `${face.name} from ${source.origin} is not WOFF2 (its bytes do not start with wOF2)`)
    if (face.bytes.byteLength > FONT_FILE_MAX) throw new CommandFailure('FONT_FILE_INVALID', `${face.name} is ${face.bytes.byteLength} bytes, more than the 500 KB a font file may be`)
  }

  const fontsDir = join(options.root, 'media', 'fonts')
  await mkdir(fontsDir, { recursive: true })
  const written: string[] = []
  const kept: string[] = []
  const put = async (name: string, bytes: Uint8Array): Promise<void> => {
    const path = join(fontsDir, name)
    const rel = `media/fonts/${name}`
    if (existsSync(path) && sameBytes(new Uint8Array(await readFile(path)), bytes)) kept.push(rel)
    else {
      await writeFile(path, bytes)
      written.push(rel)
    }
  }
  for (const face of source.faces) await put(face.name, face.bytes)
  // A licence text is served as it is beside the fonts; .txt needs no provenance.
  if (source.licence) await put(`${slug(family)}-${safeName(source.licence.name).replace(/\.(md|txt)$/i, '')}.txt`, source.licence.bytes)

  // Provenance: each font file, where it came from, its hash and licence.
  const provenancePath = join(options.root, 'media', 'provenance.json')
  const provenance = await readJsonFile(provenancePath)
  const items = Array.isArray(provenance['items']) ? [...(provenance['items'] as Record<string, unknown>[])] : []
  let provenanceChanged = false
  const createdAt = (options.now ?? (() => new Date()))().toISOString()
  for (const face of source.faces) {
    const path = `media/fonts/${face.name}`
    const hash = `sha256:${createHash('sha256').update(face.bytes).digest('hex')}`
    const at = items.findIndex((i) => i && i['path'] === path)
    if (at >= 0 && items[at]?.['hash'] === hash) continue
    const entry = { path, hash, source: 'provided', createdAt, ...(source.license ? { license: source.license } : {}), origin: source.origin }
    if (at >= 0) items[at] = entry
    else items.push(entry)
    provenanceChanged = true
  }
  if (provenanceChanged) {
    await writeFile(provenancePath, `${JSON.stringify({ formatVersion: provenance['formatVersion'] ?? '1.0', ...provenance, items }, null, 2)}\n`)
  }

  // The theme's fonts: the family once, each file once.
  const appearancePath = join(options.root, 'app', 'definitions', 'appearance.json')
  const appearance = await readJsonFile(appearancePath)
  const home = await themeHome(options.root, appearance)
  const holder = home ? home.doc : appearance['config'] && typeof appearance['config'] === 'object' ? (appearance['config'] as Record<string, unknown>) : appearance
  const theme = holder['theme'] && typeof holder['theme'] === 'object' ? { ...(holder['theme'] as Record<string, unknown>) } : {}
  const fonts = Array.isArray(theme['fonts']) ? [...(theme['fonts'] as Record<string, unknown>[])] : []
  let at = fonts.findIndex((f) => typeof f?.['family'] === 'string' && (f['family'] as string).toLowerCase() === family.toLowerCase())
  const before = JSON.stringify(fonts)
  // Without --fallback, the package's category says it (a serif family stands in as serif).
  const fallback = options.fallback ?? (source.category ? CATEGORY_FALLBACK[source.category] : undefined)
  if (at < 0) {
    fonts.push({ family, ...(fallback ? { fallback } : {}), files: [] })
    at = fonts.length - 1
  }
  const entry = { ...(fonts[at] as Record<string, unknown>) }
  const files = Array.isArray(entry['files']) ? [...(entry['files'] as Record<string, unknown>[])] : []
  for (const face of source.faces) {
    const src = `media/fonts/${face.name}`
    if (files.some((f) => f?.['src'] === src)) continue
    files.push({ src, weight: face.weight, ...(face.style !== 'normal' ? { style: face.style } : {}), ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}) })
  }
  entry['files'] = files
  if (fallback && entry['fallback'] === undefined) entry['fallback'] = fallback
  fonts[at] = entry
  const declared = JSON.stringify(fonts) !== before
  if (declared) {
    theme['fonts'] = fonts
    holder['theme'] = theme
    if (home) await writeFile(home.path, `${JSON.stringify(home.doc, null, 2)}\n`)
    else {
      await mkdir(join(options.root, 'app', 'definitions'), { recursive: true })
      await writeFile(appearancePath, `${JSON.stringify(appearance, null, 2)}\n`)
    }
  }
  const declaredFallback = typeof entry['fallback'] === 'string' ? entry['fallback'] : undefined
  return { family, written, kept, declared, declaredIn: home ? home.rel : 'app/definitions/appearance.json', ...(declaredFallback ? { fallback: declaredFallback } : {}) }
}

async function runFont(args: ParsedArgs, io: CommandIO): Promise<number> {
  const [sub, family, extra] = args.positionals
  if (sub !== 'add') throw new UsageError(sub === undefined ? 'missing "add"' : `unknown subcommand "${sub}"`)
  if (!family) throw new UsageError('missing <family>')
  if (extra !== undefined) throw new UsageError(`unexpected argument "${extra}" (quote a family name with spaces)`)
  const from = stringFlag(args, 'from')
  if (!from) throw new UsageError('missing --from <path|https-url|npm:<package>>')
  const fallback = stringFlag(args, 'fallback')
  const result = await fontAdd({
    root: resolveFrom(io.cwd, stringFlag(args, 'dir')),
    family,
    from,
    weights: stringFlags(args, 'weight').flatMap((w) => w.split(',')),
    styles: stringFlags(args, 'style').flatMap((s) => s.split(',')).map(styleOf),
    ...(fallback ? { fallback } : {}),
  })
  for (const f of result.written) io.out(`  wrote ${f}`)
  for (const f of result.kept) io.out(`  kept ${f} (unchanged)`)
  io.out(result.declared ? `Declared ${result.family} in ${result.declaredIn} theme.fonts` : `${result.family} was already declared; nothing changed there`)
  io.out('')
  io.out(`Next: name it first in a font stack (theme.typography.fontFamily "${result.family}, ${result.fallback ?? 'sans-serif'}"), then`)
  io.out('  pwf validate')
  return 0
}

export const fontCommand: Command = {
  name: 'font',
  summary: "Add a font family's woff2 files to the app and declare them in its theme",
  usage: `pwf font add <family> --from <path|https-url|npm:<package>[@<version>]> [--weight <w>]… [--style normal|italic]… [--fallback <generic>] [--dir <project>]

  <family>          the family name the typography tokens use ("Inter")
  --from <path>     a .woff2 file, or a folder of them (a licence text beside them is copied too)
  --from <https>    one .woff2 file to download
  --from npm:<pkg>  a font package from the npm registry (a Fontsource package):
                    its latin and latin-ext files of the weights and styles asked for
  --weight <w>      400 (default), 700, … (1 to 1000) or a variable range "100 900"; repeatable
  --style <s>       normal (default) or italic; repeatable
  --fallback <g>    the generic family drawn until the file arrives (sans-serif, serif, monospace, …);
                    without it, the package's category when it names one

Copies the files into media/fonts/, records them in media/provenance.json and
declares them in the theme's fonts (appearance §3.3): in the app's own theme
atom (atoms/appearance/<theme>/manifest.json) when app/definitions/
appearance.json uses it, else in appearance.json theme.fonts.
Nothing is fetched when the app builds: fonts are the app's own files. Running
the command again changes nothing that is already there.`,
  run: (args, io) => guard('font', io, () => runFont(args, io)),
}
