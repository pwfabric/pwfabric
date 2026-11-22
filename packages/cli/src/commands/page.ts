/**
 * `pwf page add <key>` — a new page: `app/surfaces/<key>.receipt.json`
 * (empty, or a pattern applied as pattern-format §4 says), its key at the end
 * of `pwpack.json` `app.surfaceOrder`, and — only when the plan lists its
 * pages — an entry in `app/plan.json` `surfaces`. A key that is taken, one a
 * served folder would hide, or a page whose addresses break the address
 * rules (envelope §2.3) is refused before anything is written.
 */
import { existsSync } from 'node:fs'
import { addressTable, localesOf, receiptPathOf } from '@pwfabric/contracts'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { guard, stringFlag, stringFlags, UsageError } from './lib/flags.js'
import { CommandFailure } from './lib/failure.js'
import { cacheDir, resolveFrom } from './lib/project.js'
import { pinsOf, writeIdentityFile, type PackPin } from './lib/identity.js'
import { inFolder, PLAN_FILE, readAppIdentity, readJsonObject, receiptRel, surfaceOrderOf, writeJsonFile, type JsonObject } from './lib/app-files.js'
import { applyPattern, parseSlotValue } from './lib/pattern-apply.js'

/** A page key (pwpack-format §2.5): segments of lower-case words joined by `-` or `.`, joined by `/`. */
export const PAGE_KEY = /^[a-z0-9]+(?:[-.][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-.][a-z0-9]+)*)*$/
/** Folders of the served app: a page whose first segment is one would be that folder under path routing. */
const SERVED_FOLDERS = ['assets', 'blocks', 'engines', 'shims', 'pwpack']

export interface FoundPattern {
  readonly pattern: JsonObject
  /** Where it was found: `atoms/patterns/<name>.json`, or `<pack id>@<version>`. */
  readonly from: string
}

/**
 * The pattern `ref` names: `<name>`, or `<pack id>/<name>` for one pack's.
 * Looked up in the folder's own `atoms/patterns/` first, then in each pinned
 * pack's cached build (`atoms/patterns/<name>.json`, or rootless
 * `patterns/<name>.json`). A name two packs ship is ambiguous.
 */
export async function findPattern(root: string, pins: readonly PackPin[], ref: string): Promise<FoundPattern> {
  const slash = ref.lastIndexOf('/')
  const name = slash >= 0 ? ref.slice(slash + 1) : ref
  const packId = slash >= 0 ? ref.slice(0, slash) : undefined
  if (!/^[a-z0-9-]+$/.test(name)) throw new UsageError(`--pattern "${ref}" is not a pattern name ([a-z0-9-]), optionally after its pack id`)
  const found: FoundPattern[] = []
  if (packId === undefined) {
    const own = await readJsonObject(root, `atoms/patterns/${name}.json`)
    if (own) return { pattern: own, from: `atoms/patterns/${name}.json` }
  }
  for (const pin of pins) {
    if (packId !== undefined && pin.id !== packId) continue
    let dir: string
    try {
      dir = cacheDir(root, pin.id, pin.version)
    } catch {
      continue
    }
    for (const rel of [`atoms/patterns/${name}.json`, `patterns/${name}.json`]) {
      if (!existsSync(inFolder(dir, rel))) continue
      const pattern = await readJsonObject(dir, rel)
      if (pattern) found.push({ pattern, from: `${pin.id}@${pin.version}` })
      break
    }
  }
  if (found.length === 0) {
    throw new CommandFailure('PATTERN_NOT_FOUND', `no pattern "${name}" in atoms/patterns/ or in a pinned pack${packId ? ` named ${packId}` : ''} (is the pack added? pwf add <pack>)`)
  }
  if (found.length > 1) {
    throw new CommandFailure('PATTERN_AMBIGUOUS', `"${name}" is a pattern of ${found.map((f) => f.from).join(' and ')}; name the pack: --pattern <pack id>/${name}`)
  }
  return found[0] as FoundPattern
}

/** `--path de=preise` (repeatable) as `{ de: "preise" }`. */
function pathFlags(values: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of values) {
    const eq = v.indexOf('=')
    const lang = eq > 0 ? v.slice(0, eq) : ''
    const seg = v.slice(eq + 1).replace(/^\/+|\/+$/g, '')
    if (!lang || !PAGE_KEY.test(seg)) throw new UsageError(`--path "${v}" is not <lang>=<segments> (lower-case words joined by - or ., segments by /)`)
    if (out[lang] !== undefined) throw new UsageError(`--path names ${lang} twice`)
    out[lang] = seg
  }
  return out
}

function idPrefix(key: string): string {
  return (key.split('/').pop() ?? key).replace(/[^a-z0-9-]/g, '-')
}

export interface PageAdded {
  readonly key: string
  readonly receipt: string
  readonly pattern?: string
  readonly planUpdated: boolean
}

export interface PageAddOptions {
  readonly key: string
  readonly title?: string
  readonly pattern?: string
  readonly slots?: ReadonlyMap<string, unknown>
  readonly id?: string
  readonly path?: Readonly<Record<string, string>>
  readonly layout?: boolean
}

export async function addPage(root: string, options: PageAddOptions): Promise<PageAdded> {
  const { key } = options
  if (!PAGE_KEY.test(key)) throw new UsageError(`"${key}" is not a page key: lower-case words joined by - or . (a folder with /), e.g. pricing, docs/intro`)
  if (SERVED_FOLDERS.includes(key.split('/')[0] as string)) {
    throw new CommandFailure('PAGE_KEY_RESERVED', `"${key}" is named like a folder of the served app (${SERVED_FOLDERS.join(', ')}); choose another key`)
  }
  const { identity, app } = await readAppIdentity(root, 'pwf page add')
  const order = surfaceOrderOf(app)
  const special = [app['entry'], app['notFound'], app['signIn']].filter((k): k is string => typeof k === 'string')
  const rel = receiptRel(key)
  if (order.includes(key) || special.includes(key) || existsSync(inFolder(root, rel))) {
    throw new CommandFailure('PAGE_EXISTS', `the page "${key}" exists already (${rel})`)
  }

  const plan = (await readJsonObject(root, PLAN_FILE)) ?? {}
  const locales = localesOf(plan)
  const path = options.path ?? {}
  if (Object.keys(path).length > 0 && !locales) throw new UsageError('--path is for an app with locales (pwf locale add <lang>); a single-language app addresses a page by its key')
  for (const l of locales?.locales ?? []) if (key.endsWith(`.${l}`)) throw new CommandFailure('APP_ADDRESS_CONFLICT', `the page key "${key}" ends in ".${l}", the name of a per-locale receipt`)
  if (locales) {
    const keys = [...order, key]
    const entry = typeof app['entry'] === 'string' ? app['entry'] : (order[0] ?? key)
    const paths = new Map<string, Readonly<Record<string, string>> | undefined>()
    for (const k of order) paths.set(k, receiptPathOf(await readJsonObject(root, receiptRel(k)).catch(() => undefined)))
    paths.set(key, path)
    const problems = addressTable(locales, keys, entry, (k) => paths.get(k)).problems
    if (problems.length > 0) throw new CommandFailure('APP_ADDRESS_CONFLICT', `the page "${key}" cannot be added: ${problems.join('; ')}`)
  }

  let blocks: unknown[] = []
  let capabilities: JsonObject[] = []
  let from: string | undefined
  if (options.pattern !== undefined) {
    const found = await findPattern(root, pinsOf(identity as { packs?: PackPin[] }), options.pattern)
    const applied = applyPattern(found.pattern, options.id ?? idPrefix(key), options.slots ?? new Map())
    blocks = applied.blocks
    capabilities = applied.capabilities
    from = `${String(found.pattern['name'])} from ${found.from}`
  }
  const receipt: JsonObject = {}
  if (options.title !== undefined) receipt['title'] = options.title
  if (Object.keys(path).length > 0) receipt['path'] = path
  if (options.layout === false) receipt['layout'] = false
  receipt['blocks'] = blocks
  if (capabilities.length > 0) receipt['capabilities'] = capabilities

  await writeJsonFile(root, rel, receipt)
  identity['app'] = { ...app, surfaceOrder: [...order, key] }
  await writeIdentityFile(root, identity)
  let planUpdated = false
  if (Array.isArray(plan['surfaces'])) {
    const name = options.title ?? key
    plan['surfaces'] = [
      ...plan['surfaces'],
      { key, name, isEntry: false, purpose: `The ${name} page`, keyContent: [], linksTo: [], usesCapabilities: [], usesMedia: [], usesCustomBlocks: [], status: 'applied' },
    ]
    await writeJsonFile(root, PLAN_FILE, plan)
    planUpdated = true
  }
  return { key, receipt: rel, ...(from ? { pattern: from } : {}), planUpdated }
}

export async function runPage(args: ParsedArgs, io: CommandIO): Promise<number> {
  const [verb, key, extra] = args.positionals
  if (verb !== 'add') throw new UsageError(verb === undefined ? 'missing "add"' : `unknown subcommand "${verb}"`)
  if (key === undefined) throw new UsageError('missing <key>')
  if (extra !== undefined) throw new UsageError(`unexpected argument "${extra}"`)
  const layout = args.flags['layout']
  if (layout !== undefined && layout !== 'false' && layout !== 'true' && layout !== true) throw new UsageError('--layout takes false (or true, the default)')
  const slots = new Map(stringFlags(args, 'slot').map(parseSlotValue))
  const pattern = stringFlag(args, 'pattern')
  if (slots.size > 0 && pattern === undefined) throw new UsageError('--slot fills a pattern; give --pattern too')
  const title = stringFlag(args, 'title')
  const id = stringFlag(args, 'id')
  const root = resolveFrom(io.cwd, stringFlag(args, 'dir'))
  const added = await addPage(root, {
    key,
    ...(title !== undefined ? { title } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(id !== undefined ? { id } : {}),
    slots,
    path: pathFlags(stringFlags(args, 'path')),
    layout: layout !== 'false',
  })
  io.out(`Added page ${added.key}`)
  io.out(`  wrote ${added.receipt}${added.pattern ? ` (the pattern ${added.pattern})` : ''}`)
  io.out(`  added to pwpack.json app.surfaceOrder${added.planUpdated ? ` and ${PLAN_FILE} surfaces` : ''}`)
  return 0
}

export const page: Command = {
  name: 'page',
  summary: 'Add a page to the app: its receipt (empty, or from a pattern) and its place in the page order',
  usage: `pwf page add <key> [--title <text>] [--pattern <name|pack id/name>] [--slot NAME=value]...
              [--id <prefix>] [--path <lang>=<segments>]... [--layout false] [--dir <app>]

  <key>            the page key: lower-case words joined by - or ., folders by /
                   (pricing, docs/intro); its address and its receipt's path
  --title <text>   the page's title
  --pattern <ref>  a pattern atom to build the page from: <name> (the app's own
                   atoms/patterns/, then its pinned packs), or <pack id>/<name>
  --slot NAME=value
                   a value for one of the pattern's slots (repeat for each);
                   JSON when it reads as a list, object, number, boolean or null
  --id <prefix>    the pattern's id prefix ({{ID}}; default: the key's last segment)
  --path <lang>=<segments>
                   the page's address in one locale (receipt "path"); repeat per
                   locale, for an app with locales only
  --layout false   draw the page without the app's layout (receipt "layout": false)
  --dir <path>     the app folder (default: the current folder)

Writes app/surfaces/<key>.receipt.json and appends <key> to pwpack.json
app.surfaceOrder; when app/plan.json lists its pages ("surfaces"), an entry
for the new page too (status applied). A pattern is applied as
pattern-format §4 says: every slot needs a value (PATTERN_SLOT_MISSING lists
each with its description — none is invented), and its wiring goes into the
page's platform/persistence and platform/entities capabilities. Refused,
writing nothing: a key that exists (PAGE_EXISTS), one named like a folder of
the served app (PAGE_KEY_RESERVED), and addresses that break the rules of
envelope §2.3 (APP_ADDRESS_CONFLICT: a path another page has, a locale
prefix, a key ending in .<lang>).`,
  run: (args, io) => guard('page', io, () => runPage(args, io)),
}
