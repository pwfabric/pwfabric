/**
 * Validation as the commands report it: the pack library's findings plus
 * the project's pins checked against its local cache.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  blockPropsCatalog,
  checkBlockIds,
  checkBlockProps,
  checkAmbiguousBlockTypes,
  checkBlockTypes,
  checkDefaultCopy,
  checkErrorsAsText,
  checkRowFields,
  connectionFieldSets,
  definedBlockTypes,
  hashPack,
  validatePack,
  type BlockSource,
  type PackFolder,
  type PackIssue,
  type PackValidation,
  type PageReceipt,
} from '@pwfabric/pack'
import { assemblePage, isTitleTemplate, pluralProblems, PROVIDER_LABEL_METHODS, RENDERER_MESSAGE_IDS, RUNNER_MESSAGE_IDS } from '@pwfabric/runner'
import { layoutSlotProblems, localesOf, PAGE_SLOT_TYPE } from '@pwfabric/contracts'
import { cacheDir, cacheRelDir, readCachedPack } from './project.js'
import { engineVersion, pinsOf } from './identity.js'
import { faviconOf } from '../../dev/favicon.js'
import { appearanceConfigOf } from '../../dev/theme.js'
import { bodyFontOf, fontAssetsOf, themeFontsOf, unreadableMetricsMessage } from '../../dev/fonts.js'
import { engineRangeDiagnostics, isRecord, jsonOf, loadSources, type LoadedSources } from '../../dev/sources.js'
import { servedPageKeys } from '../../dev/envelope.js'
import { readAuth, readEntities, readReceipt, readSeed, surfaceKeys, type AuthDeclaration } from '../../host/definitions.js'

/**
 * Checks every `packs[]` pin against `.pwf/packs/<id>@<version>/`.
 * A build that is not cached is an error (`PIN_NOT_CACHED`: `pwf add` it), as `pwf build` makes it;
 * a cached build whose content hash differs from the pin is an error
 * (`PIN_HASH_MISMATCH`).
 */
export async function checkPins(root: string, identity: PackValidation['identity']): Promise<PackIssue[]> {
  const issues: PackIssue[] = []
  for (const pin of pinsOf(identity)) {
    let dir: string
    try {
      dir = cacheDir(root, pin.id, pin.version)
    } catch (e) {
      issues.push({ severity: 'error', code: 'PIN_INVALID', path: 'pwpack.json', message: (e as Error).message })
      continue
    }
    const rel = cacheRelDir(pin.id, pin.version)
    if (!existsSync(dir)) {
      // An error, as `pwf build` makes it (PACK_NOT_CACHED), with the same fix.
      issues.push({
        severity: 'error',
        code: 'PIN_NOT_CACHED',
        path: rel,
        message: `${pin.id}@${pin.version} is pinned in pwpack.json but is not in ${rel}/ — run \`pwf add ${pin.id}@${pin.version}\` (or recreate the app with \`pwf create\`) to put it there`,
      })
      continue
    }
    const actual = hashPack(await readCachedPack(dir))
    if (actual !== pin.hash) {
      issues.push({
        severity: 'error',
        code: 'PIN_HASH_MISMATCH',
        path: rel,
        message: `${pin.id}@${pin.version} is pinned at ${pin.hash} but the cached build hashes ${actual}`,
      })
    }
  }
  return issues
}

/**
 * Reads every `app/data/<typeId>.json(l)` seed file with the same reader
 * `pwf dev` uses, so a file the dev host would reject is an error here
 * (`SEED_INVALID`) instead of a 500 on the first record request.
 */
export function checkSeeds(root: string): PackIssue[] {
  const dir = join(root, 'app', 'data')
  if (!existsSync(dir)) return []
  const issues: PackIssue[] = []
  const typeIds = new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'))
      .map((f) => f.replace(/\.jsonl?$/, '')),
  )
  for (const typeId of typeIds) {
    try {
      readSeed(root, typeId)
    } catch (e) {
      issues.push({ severity: 'error', code: 'SEED_INVALID', path: `app/data/${typeId}`, message: (e as Error).message })
    }
  }
  return issues
}

const ENTITIES_SHAPE = '{ "entities": [ { "typeId": "…", "fields": [ { "name": "…", "type": "text", "required": true } ] } ] }'

/**
 * `app/definitions/entities.json` as `pwf dev` reads it: an entry without a
 * `typeId`, or a field without a `name`, is dropped there without a word, and the
 * page that writes to it fails in the browser with "Entity type … is not
 * registered". Here each is an error (`ENTITY_INVALID`), and so is a page that
 * binds an entity type the file does not declare (`ENTITY_UNDECLARED`).
 */
export function checkEntities(root: string): PackIssue[] {
  const issues: PackIssue[] = []
  const path = 'app/definitions/entities.json'
  const file = join(root, path)
  if (existsSync(file)) {
    let raw: unknown
    try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
      return [{ severity: 'error', code: 'ENTITY_INVALID', path, message: `not valid JSON: ${(e as Error).message}` }]
    }
    const list = raw && typeof raw === 'object' && Array.isArray((raw as { entities?: unknown }).entities)
      ? ((raw as { entities: unknown[] }).entities)
      : null
    if (!list) issues.push({ severity: 'error', code: 'ENTITY_INVALID', path, message: `must be ${ENTITIES_SHAPE}` })
    for (const [i, e] of (list ?? []).entries()) {
      const entry = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
      if (typeof entry.typeId !== 'string' || !entry.typeId) {
        issues.push({ severity: 'error', code: 'ENTITY_INVALID', path, message: `entities[${i}] has no "typeId" (it has: ${Object.keys(entry).join(', ') || 'nothing'}); expected ${ENTITIES_SHAPE}` })
      }
      for (const [j, f] of (Array.isArray(entry.fields) ? entry.fields : []).entries()) {
        const field = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
        if (typeof field.name !== 'string' || !field.name) {
          issues.push({ severity: 'error', code: 'ENTITY_INVALID', path, message: `entities[${i}].fields[${j}] has no "name" (it has: ${Object.keys(field).join(', ') || 'nothing'})` })
        }
      }
    }
  }
  const declared = new Set(readEntities(root).map((e) => e.typeId))
  for (const key of surfaceKeys(root)) {
    const used = new Set<string>()
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk)
      if (!v || typeof v !== 'object') return
      for (const [k, x] of Object.entries(v)) {
        if (k === 'entityType' && typeof x === 'string' && x) used.add(x)
        else walk(x)
      }
    }
    try { walk(readReceipt(root, key)) } catch { continue }
    for (const type of used) {
      if (!declared.has(type)) {
        issues.push({ severity: 'error', code: 'ENTITY_UNDECLARED', path: `app/surfaces/${key}.receipt.json`, message: `uses entity type "${type}", which ${path} does not declare` })
      }
    }
  }
  return issues
}

/** The members a `statusKeys` may name (data-protocol §4.2). */
export const STATUS_KEY_MEMBERS: readonly string[] = ['loading', 'success', 'error', 'reason', 'fields', 'detail']

/**
 * STATUS_KEY_UNKNOWN (a warning): a form binding's or a `write` action's
 * `statusKeys` names a member the runtime never writes, so whatever the page
 * binds to that state key never changes. The usual one is 2.2's `message`,
 * gone in 3.0: the failure is a code in `reason`, and the page writes its own
 * words for it.
 */
export function checkStatusKeys(root: string): PackIssue[] {
  const issues: PackIssue[] = []
  const known = new Set(STATUS_KEY_MEMBERS)
  for (const key of surfaceKeys(root)) {
    let receipt: unknown
    try { receipt = readReceipt(root, key) } catch { continue }
    const path = `app/surfaces/${key}.receipt.json`
    const walk = (v: unknown, at: string): void => {
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`))
      if (!isObj(v)) return
      for (const [k, x] of Object.entries(v)) {
        if (k === 'statusKeys' && isObj(x)) {
          for (const member of Object.keys(x)) {
            if (known.has(member)) continue
            const hint = member === 'message'
              ? '; 3.0 has no message: bind reason (a code) and write the words in the page'
              : ''
            issues.push({
              severity: 'warning',
              code: 'STATUS_KEY_UNKNOWN',
              path,
              message: `${at ? `${at}.` : ''}statusKeys.${member} is never written (a statusKeys names ${STATUS_KEY_MEMBERS.join(', ')})${hint}`,
            })
          }
        } else walk(x, at ? `${at}.${k}` : k)
      }
    }
    walk(receipt, '')
  }
  return issues
}

/** Names the page scope already gives: the visitor's identity (`me`, `__auth`) and every `__…` key. */
const RESERVED_ROOT = /^(?:me|__.*)$/

/**
 * SOURCE_ID_RESERVED (an error): a data source may not take a name the page
 * scope already gives. `{{me.name}}` is the visitor (session-protocol
 * "Identity on the page"); a source called `me` would never be read.
 */
export function checkReservedSources(root: string): PackIssue[] {
  const issues: PackIssue[] = []
  for (const key of surfaceKeys(root)) {
    let receipt: unknown
    try { receipt = readReceipt(root, key) } catch { continue }
    const caps = (receipt as { capabilities?: unknown } | undefined)?.capabilities
    for (const cap of Array.isArray(caps) ? caps : []) {
      const sources = (cap as { config?: { dataSources?: unknown } } | null)?.config?.dataSources
      for (const source of Array.isArray(sources) ? sources : []) {
        const id = (source as { id?: unknown } | null)?.id
        if (typeof id === 'string' && RESERVED_ROOT.test(id)) {
          issues.push({ severity: 'error', code: 'SOURCE_ID_RESERVED', path: `app/surfaces/${key}.receipt.json`, message: `data source "${id}" takes a name the page scope already gives (me, __auth, __…); rename it` })
        }
      }
    }
  }
  return issues
}

const normName = (s: string): string => s.toLowerCase().replace(/[\s_-]/g, '')

/**
 * Every model the app declares must be named by an `access` rule
 * (`ACCESS_RULE_MISSING`, an error).
 *
 * A host that publishes an app serves only what the rules grant: a model no
 * rule names is closed, and an app with no `access` block serves its pages and
 * no records. `pwf dev` is more forgiving (an app with no rule at all stays
 * open there), so without this check an author would find out only after
 * publishing. Public data needs an explicit `public` rule.
 */
export function checkAccess(root: string): PackIssue[] {
  const entities = readEntities(root)
  if (entities.length === 0) return []
  const path = 'app/definitions/auth.json'
  let auth: AuthDeclaration | undefined
  try {
    auth = readAuth(root)
  } catch {
    return [] // not valid JSON: reported by the pack validation
  }
  const rules = auth?.access.rules ?? []
  const named = new Set(rules.map((r) => normName(r.model)))
  const issues: PackIssue[] = []
  for (const e of entities) {
    if (named.has(normName(e.typeId)) || (e.displayName && named.has(normName(e.displayName)))) continue
    const where = rules.length === 0 ? `${path} has no access rules` : `no rule in ${path} access.rules names it`
    issues.push({
      severity: 'error',
      code: 'ACCESS_RULE_MISSING',
      path,
      message:
        `model "${e.typeId}" has no access rule (${where}), so a published app serves its records to nobody. ` +
        `Add one to access.rules, e.g. { "subject": "public", "model": "${e.typeId}", "rule": "read" } for public data, ` +
        `or { "subject": "member", "model": "${e.typeId}", "rule": "create, read own" } for each visitor's own records`,
    })
  }
  return issues
}

function readJsonFile(path: string): unknown {
  try {
    const text = readFileSync(path, 'utf8')
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
  } catch {
    return undefined
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The runner's message ids this app can reach — the screens and labels the
 * runner draws for it, from what it declares:
 *
 *  - `notFound.*` unless `pwpack.json` `app.notFound` names its own page;
 *  - with a way in (`auth.json` methods, or an issuer): `auth.error.*` when a
 *    sign-in round trip can send the visitor back with `?auth_error=` (a
 *    provider method or an issuer; a password-only door never does), and the runner's own
 *    sign-in screen (`gate.*`) unless `app.signIn` names the app's — its
 *    password fields with a password method, one
 *    `gate.provider.<method>` per provider, `gate.title` only when the plan
 *    has no title; the account control's `account.*` when `navigation.json`
 *    declares `account`, else the fallback pill (`pill.*`); `bridge.*` for an
 *    external issuer; `session.*` with a password method, whichever screen
 *    signs in (the app's own screen signs in through the runner's door too);
 *  - the renderer's `ui.retry` (a block whose module failed to load is a
 *    retry button) on every app with a page. Its `ui.loading` is never drawn
 *    by the runner, which paints at once.
 */
export function reachableMessageIds(root: string): string[] {
  const pwpack = readJsonFile(join(root, 'pwpack.json'))
  const app = isObj(pwpack) && isObj(pwpack['app']) ? pwpack['app'] : {}
  const plan = readJsonFile(join(root, 'app', 'plan.json'))
  const navigation = readJsonFile(join(root, 'app', 'definitions', 'navigation.json'))
  let auth: AuthDeclaration | undefined
  try {
    auth = readAuth(root)
  } catch {
    auth = undefined
  }
  const named = (v: unknown): boolean => typeof v === 'string' && v.length > 0
  const ids = new Set<string>()
  const all = (prefix: string): void => {
    for (const id of RUNNER_MESSAGE_IDS) if (id.startsWith(prefix)) ids.add(id)
  }
  if (!named(app['notFound'])) all('notFound.')
  // A way in: an issuer, or at least one method. An auth.json that only
  // carries access rules signs nobody in, so the runner draws none of these.
  const door = auth !== undefined && (auth.topology === 'external' ? auth.issuer !== undefined : auth.methods.length > 0)
  if (auth && door) {
    const password = auth.topology === 'app' && auth.methods.includes('password')
    const providers = auth.methods.filter((m) => m !== 'password')
    // `?auth_error=` comes back from a provider or an issuer only.
    if (providers.length > 0 || auth.topology === 'external') all('auth.error.')
    // The password door's answers are the runner's to word whichever screen
    // asked: its own gate, or the app's sign-in screen through `auth:signIn`.
    if (password) all('session.')
    if (!named(app['signIn'])) {
      if (!(isObj(plan) && named(plan['title']))) ids.add('gate.title')
      // The wall's sentence only on the wall; the on-demand dialog has none.
      ids.add(auth.required ? 'gate.body' : 'gate.close')
      ids.add('gate.signIn')
      if (password) {
        for (const id of ['gate.email', 'gate.password'] as const) ids.add(id)
        // Sign-up is offered only by a door that takes anyone.
        if (auth.registration === 'open') {
          for (const id of ['gate.name', 'gate.register', 'gate.toRegister', 'gate.toSignIn'] as const) ids.add(id)
        }
      }
      if (password && providers.length > 0) ids.add('gate.or')
      for (const m of providers) if ((PROVIDER_LABEL_METHODS as readonly string[]).includes(m)) ids.add(`gate.provider.${m}`)
    }
    const account = isObj(navigation) && isObj(navigation['account']) ? navigation['account'] : undefined
    if (account) {
      for (const id of ['account.signIn', 'account.signOut', 'account.greeting'] as const) ids.add(id)
      if (named(account['profileHref'])) ids.add('account.profile')
    } else if (!named(app['signIn'])) all('pill.')
    if (auth.topology === 'external') all('bridge.')
  }
  const pages = isObj(app) && Array.isArray(app['surfaceOrder']) && app['surfaceOrder'].length > 0
  const renderer: string[] = pages ? RENDERER_MESSAGE_IDS.filter((id) => id === 'ui.retry') : []
  return [...RUNNER_MESSAGE_IDS.filter((id) => ids.has(id)), ...renderer]
}

/**
 * MESSAGES_MISSING: the runner message ids this app can reach
 * ({@link reachableMessageIds}) that `plan.json` `messages` does not set — an
 * ERROR, whatever the app's language. The engine writes no visitor word
 * (3.0.1): the visitor reads nothing where each one goes, and a control is
 * named by the bare id.
 */
export function checkMessages(root: string): PackIssue[] {
  // A pack (no `app` member) is not opened as an app: no visitor reaches a
  // runner message through it, so it has none to set.
  const pwpack = readJsonFile(join(root, 'pwpack.json'))
  if (!isObj(pwpack) || !isObj(pwpack['app'])) return []
  // An app with no plan sets no words: every id it can reach is missing.
  const plan = readJsonFile(join(root, 'app', 'plan.json'))
  // An app with locales keeps its words per locale (envelope §2.3): the
  // default locale's catalogue is the one every id must be in.
  const locales = localesOf(plan)
  const catalogueOf = (lang: string): Record<string, unknown> => {
    const doc = readJsonFile(join(root, 'app', 'messages', `${lang}.json`))
    return isObj(doc) ? doc : {}
  }
  const messages = locales ? catalogueOf(locales.defaultLocale) : isObj(plan) && isObj(plan['messages']) ? plan['messages'] : {}
  const wordFiles: [string, Record<string, unknown>][] = locales
    ? locales.locales.map((l) => [`app/messages/${l}.json`, catalogueOf(l)])
    : [['app/plan.json', messages]]
  // A plural the runner cannot pick is written as its text (envelope §2.1): the build's code and words.
  const plurals: PackIssue[] = []
  for (const [path, words] of wordFiles) {
    for (const [id, text] of Object.entries(words)) {
      if (typeof text !== 'string') continue
      for (const problem of pluralProblems(text)) plurals.push({ severity: 'error', code: 'MESSAGES_INVALID', path, message: `messages["${id}"]: ${problem}` })
    }
  }
  const missing = reachableMessageIds(root).filter((id) => !(typeof messages[id] === 'string' && messages[id] !== ''))
  if (missing.length === 0) return plurals
  return [
    ...plurals,
    {
      severity: 'error',
      code: 'MESSAGES_MISSING',
      path: locales ? `app/messages/${locales.defaultLocale}.json` : 'app/plan.json',
      message:
        `the app can show ${missing.length} runner message${missing.length === 1 ? '' : 's'} it does not set in messages, ` +
        `and the engine writes no words of its own, so the visitor reads nothing there: ${missing.join(', ')}`,
    },
  ]
}

/**
 * The app's icon (`app/definitions/appearance.json` `brand.favicon`): the
 * build's rule and words (`FAVICON_INVALID`, dev/favicon.ts).
 */
export function checkFavicon(root: string, pack: PackFolder): PackIssue[] {
  const appearance = readJsonFile(join(root, 'app', 'definitions', 'appearance.json'))
  const brand = isObj(appearance) ? appearance['brand'] : undefined
  const { problem } = faviconOf(isObj(brand) ? brand['favicon'] : undefined, pack.files)
  return problem ? [{ severity: 'error', code: 'FAVICON_INVALID', path: 'app/definitions/appearance.json', message: problem }] : []
}

/**
 * The app's font files whose metrics cannot be read (`FONT_METRICS_UNREADABLE`,
 * a warning, as `pwf build` gives it): their family is drawn with a plain
 * stand-in, and the text may move when the font arrives.
 */
export function checkFontMetrics(root: string, pack: PackFolder): PackIssue[] {
  const doc = readJsonFile(join(root, 'app', 'definitions', 'appearance.json'))
  if (!isObj(doc)) return []
  const config = appearanceConfigOf(doc) as Record<string, unknown> | undefined
  return fontAssetsOf(themeFontsOf(config), pack.files, bodyFontOf(config)).unreadable.map((u) => ({
    severity: 'warning',
    code: 'FONT_METRICS_UNREADABLE',
    path: u.src ?? 'app/definitions/appearance.json',
    message: unreadableMetricsMessage(u),
  }))
}

/**
 * The app's title template (`app/plan.json` `titleTemplate`, receipt §1.1):
 * exactly one `%s`, and `%%` for a `%` (`PLAN_TITLE_TEMPLATE_INVALID`, the
 * build's code and words).
 */
export function checkTitleTemplate(root: string): PackIssue[] {
  const plan = readJsonFile(join(root, 'app', 'plan.json'))
  const raw = isObj(plan) ? plan['titleTemplate'] : undefined
  if (raw === undefined || isTitleTemplate(raw)) return []
  return [
    {
      severity: 'error',
      code: 'PLAN_TITLE_TEMPLATE_INVALID',
      path: 'app/plan.json',
      message: `plan.json "titleTemplate" is ${JSON.stringify(raw)}: it holds exactly one %s, which the page's title replaces, and writes a % as %%`,
    },
  ]
}

/**
 * Block props in the folder's receipts (`app/surfaces/*.receipt.json`) that do not fit the blocks' manifests
 * (`BLOCK_PROP_UNKNOWN`, `BLOCK_PROP_ENUM`, `BLOCK_PROP_TYPE`,
 * `BLOCK_PROP_NOT_BINDABLE`; warnings, as the
 * runtime renders them anyway). Block types resolve as `pwf dev` resolves them:
 * the app's own blocks first, then its pinned packs from `.pwf/packs/` in pin
 * order. A pack that is not cached contributes nothing (its pin is reported).
 */
export async function checkProps(root: string, identity: PackValidation['identity']): Promise<PackIssue[]> {
  return propIssues(await atomSources(root, identity))
}

function propIssues(sources: readonly BlockSource[]): PackIssue[] {
  const app = sources[0]
  if (!app) return []
  const catalog = blockPropsCatalog(sources)
  return [...checkBlockProps(app.folder, catalog), ...checkDefaultCopy(app.folder, catalog), ...checkErrorsAsText(app.folder, catalog)]
}

/**
 * The folders atoms resolve from, as `pwf dev` resolves them: the app first,
 * then its pinned packs from `.pwf/packs/` in pin order (each labelled with
 * its cache path). Empty without an identity or a readable app.
 */
async function atomSources(root: string, identity: PackValidation['identity']): Promise<BlockSource[]> {
  if (!identity) return []
  const sources = await loadSources(root)
  if (!sources.app) return []
  return blockSourcesOf(sources)
}

function blockSourcesOf(sources: LoadedSources): BlockSource[] {
  if (!sources.app) return []
  return [
    { folder: sources.app.folder, atoms: sources.app.validation.atoms },
    ...sources.packs.map((s) => ({ folder: s.folder, atoms: s.validation.atoms, label: s.label })),
  ]
}

/**
 * The pages `pwf build` serves, judged as it judges them: a block type that
 * neither the app nor a pinned pack defines (`UNKNOWN_BLOCK_TYPE`) and a block
 * id used twice on one page (`BLOCK_ID_DUPLICATE`), both errors, with the
 * build's own code and words (@pwfabric/pack `checkBlockTypes`,
 * `checkBlockIds`). Block types are not judged while a pinned pack could not
 * be read: its blocks are unknown here, and its pin is already reported.
 */
export function checkPages(loaded: LoadedSources): PackIssue[] {
  const { app, identity } = loaded
  if (!app || !identity?.app) return []
  const pages: PageReceipt[] = []
  for (const key of servedPageKeys(identity.app).keys) {
    const path = `app/surfaces/${key}.receipt.json`
    const receipt = jsonOf(app.folder, path)
    // A missing or unreadable receipt is the pack validation's finding.
    if (isRecord(receipt) && Array.isArray(receipt['blocks'])) pages.push({ key, path, receipt })
    // ...and its receipt for each locale that has one (envelope §2.3), judged the same way.
    for (const lang of localesOf(jsonOf(app.folder, 'app/plan.json'))?.locales ?? []) {
      const own = `app/surfaces/${key}.${lang}.receipt.json`
      const doc = jsonOf(app.folder, own)
      if (isRecord(doc) && Array.isArray(doc['blocks'])) pages.push({ key, path: own, receipt: doc })
    }
  }
  // The layout (receipt §4), when it is one: each page is judged as drawn in it.
  const layoutPath = 'app/layout.receipt.json'
  const layoutDoc = jsonOf(app.folder, layoutPath)
  const layout = isRecord(layoutDoc) && Array.isArray(layoutDoc['blocks']) && layoutSlotProblems(layoutDoc).length === 0 ? layoutDoc : undefined
  type Receipt = Parameters<typeof assemblePage>[1]
  const issues: PackIssue[] = []
  for (const page of pages) {
    const drawn = layout
      ? assemblePage(layout as unknown as Receipt, page.receipt as unknown as Receipt, { key: page.key, entry: identity.app.entry })
      : { receipt: page.receipt, problems: [] }
    issues.push(...checkBlockIds({ path: page.path, receipt: drawn.receipt }))
    for (const problem of drawn.problems) {
      if (problem.kind === 'source') issues.push({ severity: 'error', code: 'SOURCE_ID_DUPLICATE', path: page.path, message: `${problem.message} (${layoutPath})` })
    }
  }
  const allPacksRead = loaded.packs.length === (identity.packs ?? []).length
  if (allPacksRead) {
    const known = definedBlockTypes(blockSourcesOf(loaded))
    const judged: PageReceipt[] = layout ? [...pages, { key: 'layout', path: layoutPath, receipt: layout }] : pages
    issues.push(...checkBlockTypes(judged, (type) => type === PAGE_SLOT_TYPE || known.has(type)))
    // A type two blocks answer to by a short name is the build's error too.
    issues.push(...checkAmbiguousBlockTypes(judged, blockSourcesOf(loaded)))
  }
  return issues
}

/**
 * `validatePack` plus {@link checkPins}, {@link checkSeeds}, {@link checkEntities},
 * {@link checkAccess}, {@link checkPages}, {@link checkProps} and the pack library's `checkRowFields`
 * (`FIELD_UNKNOWN` warnings: a receipt reading a row field its data source's rows
 * do not have; a connector-served source is known from the engine that serves
 * its connection, the app's own or a pinned pack's), as one result.
 */
export async function validateProject(root: string, pack: PackFolder): Promise<PackValidation> {
  const result = validatePack(pack)
  const pinIssues = await checkPins(root, result.identity)
  const loaded = result.identity ? await loadSources(root) : null
  const sources = loaded ? blockSourcesOf(loaded) : []
  const fieldIssues = checkRowFields(pack, connectionFieldSets(pack, sources))
  const engineIssues: PackIssue[] = loaded
    ? engineRangeDiagnostics(loaded, engineVersion()).map((d) => ({ severity: 'error', code: d.code, message: d.message, ...(d.path ? { path: d.path } : {}) }))
    : []
  const issues = [...result.issues, ...pinIssues, ...engineIssues, ...checkSeeds(root), ...checkEntities(root), ...checkAccess(root), ...checkMessages(root), ...checkTitleTemplate(root), ...checkFavicon(root, pack), ...checkFontMetrics(root, pack), ...checkReservedSources(root), ...checkStatusKeys(root), ...(loaded ? checkPages(loaded) : []), ...propIssues(sources), ...fieldIssues]
  return { ...result, issues, ok: !issues.some((i) => i.severity === 'error') }
}

// Printing lives in ./issues.ts (light: `guard` uses it); re-exported for the commands.
export { countLine, printIssues } from './issues.js'
