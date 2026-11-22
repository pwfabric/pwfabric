/**
 * `pwf media add <file|https-url>` — puts an image into the folder's
 * `media/`, records where it came from in `media/provenance.json`
 * (pwpack-format §1.3) and, in an app, declares it in `app/media/<key>.json`.
 *
 * The bytes decide the type (PNG, JPEG, GIF, WebP, AVIF, SVG), not the name;
 * an SVG with script in it is refused (§1.4's rule for markup an app serves).
 * Running it again with the same bytes changes nothing but what the flags
 * set; other bytes under a name already taken are refused.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { DEFAULT_LIMITS, MEDIA_PROVENANCE_FILE, readMediaProvenance, sha256Hex, svgUnsafeReason } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, UsageError } from './lib/flags.js'
import { CommandFailure } from './lib/failure.js'
import { readIdentityFile } from './lib/identity.js'
import { resolveFrom } from './lib/project.js'
import { fileExists, inFolder, isObject, readJsonObject, writeJsonFile, type JsonObject } from './lib/app-files.js'
import { formatOfExtension, IMAGE_TYPES, sniffImage } from './lib/image-type.js'
import type { Fetch } from '../phiwebs/oauth.js'

/** The largest file `pwf media add` takes: the largest entry a .pwpack may hold. */
export const MEDIA_MAX_BYTES = DEFAULT_LIMITS.maxEntryBytes

/** A media file name: one segment, letters, digits, `.`, `_`, `-`, starting with a letter or digit. */
const MEDIA_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const PROVENANCE_SOURCES = ['generated', 'uploaded', 'provided'] as const

export interface MediaDeps {
  readonly fetch?: Fetch
  readonly now?: () => Date
}

export interface MediaAdded {
  /** `media/<name>`. */
  readonly path: string
  readonly bytes: number
  readonly mime: string
  readonly hash: string
  /** What changed: the bytes, the provenance entry, the declaration (each false when it already said so). */
  readonly wroteFile: boolean
  readonly wroteProvenance: boolean
  /** `app/media/<key>.json`, in an app. */
  readonly declaration?: { readonly path: string; readonly written: boolean }
}

export interface MediaAddOptions {
  readonly source: string
  readonly name?: string
  readonly alt?: string
  /** An https URL (provenance `origin`) or one of generated, uploaded, provided (provenance `source`). */
  readonly from?: string
  readonly licence?: string
  readonly decorative?: boolean
}

/**
 * The address as pwf records and prints it: origin and path only. A query or
 * fragment is dropped (a signed address carries its token there), and the
 * caller refuses one with a user name or password before it gets here.
 */
export function recordedUrl(url: URL): URL {
  return new URL(`${url.origin}${url.pathname}`)
}

/** Downloads `url`; `shown` is the address the messages name (never the query). */
async function fetchBytes(url: string, shown: string, fetchImpl: Fetch): Promise<Uint8Array> {
  let res: Response
  try {
    res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) })
  } catch (e) {
    throw new CommandFailure('MEDIA_DOWNLOAD_FAILED', `cannot download ${shown}: ${(e as Error).name}`)
  }
  if (!res.ok) throw new CommandFailure('MEDIA_DOWNLOAD_FAILED', `${shown} answered HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MEDIA_MAX_BYTES) throw tooLarge(shown, declared)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length > MEDIA_MAX_BYTES) throw tooLarge(shown, bytes.length)
  return bytes
}

function tooLarge(what: string, size: number): CommandFailure {
  return new CommandFailure('MEDIA_TOO_LARGE', `${what} is ${size} bytes; a media file may be at most ${MEDIA_MAX_BYTES} bytes (the largest entry a .pwpack holds)`)
}

function nameFromUrl(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/** Adds one image to the folder at `root` (see the module header). */
export async function addMedia(root: string, cwd: string, options: MediaAddOptions, deps: MediaDeps = {}): Promise<MediaAdded> {
  const identity = await readIdentityFile(root)
  const isUrl = /^https?:\/\//i.test(options.source)
  let url: URL | undefined
  let bytes: Uint8Array
  if (isUrl) {
    const asked = new URL(options.source)
    if (asked.username || asked.password) throw new UsageError('the address carries a user name or password; pwf does not send or record credentials in an address')
    url = recordedUrl(asked)
    if (asked.protocol !== 'https:') throw new UsageError(`${url.href} is not https; download it over https or save it and add the file`)
    bytes = await fetchBytes(asked.href, url.href, deps.fetch ?? fetch)
  } else {
    const path = resolveFrom(cwd, options.source)
    const read = await readFile(path).catch(() => null)
    if (read === null) throw new CommandFailure('MEDIA_SOURCE_MISSING', `no such file: ${path}`)
    if (read.length > MEDIA_MAX_BYTES) throw tooLarge(path, read.length)
    bytes = new Uint8Array(read)
  }

  const format = sniffImage(bytes)
  if (!format) throw new CommandFailure('MEDIA_TYPE_UNSUPPORTED', `${url?.href ?? options.source} is not a PNG, JPEG, GIF, WebP, AVIF or SVG image`)
  const type = IMAGE_TYPES[format] as (typeof IMAGE_TYPES)[string]
  let name = options.name ?? (url ? nameFromUrl(url) : basename(options.source))
  const ext = extname(name)
  if (!ext) name = `${name}${type.ext}`
  else if (formatOfExtension(ext) !== format) {
    throw new CommandFailure('MEDIA_TYPE_MISMATCH', `${name} is named as ${ext.slice(1).toUpperCase()}, and its bytes are ${format.toUpperCase()}; name it ${basename(name, ext)}${type.ext}`)
  }
  if (!MEDIA_NAME.test(name) || name === 'provenance.json') {
    throw new UsageError(`"${name}" is not a media file name: letters, digits, ".", "_" and "-", starting with a letter or digit (give one with --name)`)
  }
  if (format === 'svg') {
    const problem = svgUnsafeReason(bytes)
    if (problem) throw new CommandFailure('MEDIA_SVG_UNSAFE', `${name} is not added: it ${problem}. An app's files carry no script and reach nothing outside themselves; save it as a plain SVG (an SVG optimiser writes one) and add it again`)
  }

  const rel = `media/${name}`
  const hash = `sha256:${sha256Hex(bytes)}`
  const existing = await readFile(inFolder(root, rel)).catch(() => null)
  if (existing && `sha256:${sha256Hex(new Uint8Array(existing))}` !== hash) {
    throw new CommandFailure('MEDIA_NAME_TAKEN', `${rel} holds another file; give this one another name with --name`)
  }

  // The provenance entry: kept where it says the same, created or updated otherwise.
  const provenance = readMediaProvenance({ files: new Map(fileExists(root, MEDIA_PROVENANCE_FILE) ? [[MEDIA_PROVENANCE_FILE, new Uint8Array(await readFile(inFolder(root, MEDIA_PROVENANCE_FILE)))]] : []) })
  if (provenance.state === 'invalid') {
    throw new CommandFailure('MEDIA_PROVENANCE_INVALID', `${MEDIA_PROVENANCE_FILE} is not valid (${provenance.issues.join('; ')}); fix it first`)
  }
  const doc: JsonObject = provenance.state === 'valid' ? ((await readJsonObject(root, MEDIA_PROVENANCE_FILE)) as JsonObject) : { items: [] }
  const items = (Array.isArray(doc['items']) ? doc['items'] : []).filter(isObject)
  const at = items.findIndex((i) => i['path'] === rel)
  const before = at >= 0 ? (items[at] as JsonObject) : undefined
  const from = options.from
  const sourceWord = from !== undefined && (PROVENANCE_SOURCES as readonly string[]).includes(from) ? from : undefined
  const origin = from !== undefined && sourceWord === undefined ? from : url?.href
  const sameBytes = before?.['hash'] === hash
  const entry: JsonObject = {
    path: rel,
    hash,
    source: sourceWord ?? (sameBytes && typeof before?.['source'] === 'string' ? before['source'] : 'uploaded'),
    createdAt: sameBytes && typeof before?.['createdAt'] === 'string' ? before['createdAt'] : (deps.now?.() ?? new Date()).toISOString(),
  }
  for (const key of ['model'] as const) if (sameBytes && before?.[key] !== undefined) entry[key] = before[key]
  const license = options.licence ?? (sameBytes ? before?.['license'] : undefined)
  if (license !== undefined) entry['license'] = license
  const keptOrigin = origin ?? (sameBytes ? before?.['origin'] : undefined)
  if (keptOrigin !== undefined) entry['origin'] = keptOrigin
  const wroteProvenance = JSON.stringify(before) !== JSON.stringify(entry)
  if (at >= 0) items[at] = entry
  else items.push(entry)

  if (!existing) {
    await mkdir(inFolder(root, 'media'), { recursive: true })
    await writeFile(inFolder(root, rel), bytes)
  }
  if (wroteProvenance) await writeJsonFile(root, MEDIA_PROVENANCE_FILE, { ...doc, items })

  let declaration: MediaAdded['declaration']
  if (isObject(identity['app'])) {
    const key = basename(name, extname(name))
    const declRel = `app/media/${key}.json`
    const was = await readJsonObject(root, declRel)
    if (was && typeof was['file'] === 'string' && was['file'] !== rel) {
      throw new CommandFailure('MEDIA_KEY_TAKEN', `${declRel} declares ${was['file']}; give this file another name with --name`)
    }
    const next: JsonObject = { ...(was ?? { kind: 'image', origin: sourceWord === 'generated' ? 'generated' : sourceWord === 'provided' ? 'provided' : 'uploaded' }), file: rel }
    if (options.alt !== undefined) next['purpose'] = options.alt
    if (options.decorative) next['decorative'] = true
    const written = JSON.stringify(was) !== JSON.stringify(next)
    if (written) await writeJsonFile(root, declRel, next)
    declaration = { path: declRel, written }
  }
  return { path: rel, bytes: bytes.length, mime: type.mime, hash, wroteFile: !existing, wroteProvenance, ...(declaration ? { declaration } : {}) }
}

function validFrom(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if ((PROVENANCE_SOURCES as readonly string[]).includes(value)) return value
  let u: URL | undefined
  try {
    u = new URL(value)
  } catch {
    // not a URL
  }
  if (u && (u.protocol === 'https:' || u.protocol === 'http:')) {
    if (u.username || u.password) throw new UsageError('--source carries a user name or password; give the address without them')
    return recordedUrl(u).href
  }
  throw new UsageError(
    `--source takes the address the file came from (http(s)://…) or one of ${PROVENANCE_SOURCES.join(', ')}; media/provenance.json has no field for other text (put credits in --alt or the app's own words)`
  )
}

export async function runMedia(args: ParsedArgs, io: CommandIO, deps: MediaDeps = {}): Promise<number> {
  const [verb, source, extra] = args.positionals
  if (verb !== 'add') throw new UsageError(verb === undefined ? 'missing "add"' : `unknown subcommand "${verb}"`)
  if (source === undefined) throw new UsageError('missing <file|https-url>')
  if (extra !== undefined) throw new UsageError(`unexpected argument "${extra}"`)
  const root = resolveFrom(io.cwd, stringFlag(args, 'dir'))
  const licence = stringFlag(args, 'licence') ?? stringFlag(args, 'license')
  const name = stringFlag(args, 'name')
  const alt = stringFlag(args, 'alt')
  const from = validFrom(stringFlag(args, 'source'))
  const added = await addMedia(root, io.cwd, {
    source,
    ...(name !== undefined ? { name } : {}),
    ...(alt !== undefined ? { alt } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(licence !== undefined ? { licence } : {}),
    decorative: boolFlag(args, 'decorative'),
  }, deps)
  if (boolFlag(args, 'json')) {
    io.out(JSON.stringify(added, null, 2))
    return 0
  }
  const changed = added.wroteFile || added.wroteProvenance || added.declaration?.written === true
  io.out(`${changed ? 'Added' : 'Unchanged'} ${added.path} (${added.mime}, ${added.bytes} bytes)`)
  io.out(`  provenance  ${MEDIA_PROVENANCE_FILE}${added.wroteProvenance ? '' : ' (unchanged)'}`)
  if (added.declaration) io.out(`  declared    ${added.declaration.path}${added.declaration.written ? '' : ' (unchanged)'}`)
  io.out(`  address     pwpack/media/${added.path.slice('media/'.length)} (what a receipt's image prop names)`)
  return 0
}

export const media: Command = {
  name: 'media',
  summary: 'Add an image to media/, with its provenance and (in an app) its declaration',
  usage: `pwf media add <file|https-url> [--name <file>] [--alt <text>] [--source <url|generated|uploaded|provided>]
              [--licence <id>] [--decorative] [--dir <project>] [--json]

  <file>         an image on disk
  <https-url>    an image to download (https only; nothing is sent but the GET)
  --name <file>  the name under media/ (default: the file's or the URL's own;
                 an extension is added when it has none)
  --alt <text>   what the image shows, written as the declaration's purpose
  --source <..>  where it came from: an address (provenance "origin"; a
                 download records its URL by itself) or one of generated,
                 uploaded (default), provided (provenance "source")
  --licence <id> the licence it may be used under (an SPDX id or free text)
  --decorative   the image is ambience, not content (declaration "decorative")
  --dir <path>   the app or pack folder (default: the current folder)

The bytes decide the type: PNG, JPEG, GIF, WebP, AVIF or SVG, and the name's
extension must agree (MEDIA_TYPE_MISMATCH). An SVG must be a plain picture
(MEDIA_SVG_UNSAFE, never rewritten): it is parsed, and a DOCTYPE or entity,
a processing instruction, an element outside the SVG picture elements
(script, foreignObject, image, feImage, any prefixed element), an on…
attribute, an href that is not #id, a url(…) that is not url(#id), an
animation of href or on…, or CSS with expression(, @import or an escape is
refused — the screen pwf validate applies to media/ and public/ SVGs. At most ${MEDIA_MAX_BYTES} bytes
(MEDIA_TOO_LARGE).

Writes media/<name>, its entry in media/provenance.json ({ path, hash,
source, createdAt, license?, origin? }, pwpack-format §1.3; an address is
recorded and printed as origin and path only: its query and fragment, where
a signed address keeps its token, are dropped, and an address with a user
name or password is refused) and, in an app,
app/media/<key>.json ({ kind: "image", origin, file, purpose? }); a receipt
names the image as pwpack/media/<name>. The same bytes again change nothing
but what the flags set (createdAt is kept); other bytes under a name already
taken are refused (MEDIA_NAME_TAKEN).`,
  run: (args, io) => guard('media', io, () => runMedia(args, io)),
}
