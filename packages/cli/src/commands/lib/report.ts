/**
 * Validation as the commands report it: the pack library's findings plus
 * the project's pins checked against its local cache.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  blockPropsCatalog,
  checkBlockProps,
  checkDefaultCopy,
  checkErrorsAsText,
  checkRowFields,
  connectionFieldSets,
  hashPack,
  validatePack,
  type BlockSource,
  type PackFolder,
  type PackIssue,
  type PackValidation,
} from '@pwfabric/pack'
import { PROVIDER_LABEL_METHODS, RUNNER_MESSAGE_IDS, type RunnerMessageId } from '@pwfabric/runner'
import type { CommandIO } from '../types.js'
import { cacheDir, cacheRelDir, readCachedPack } from './project.js'
import { pinsOf } from './identity.js'
import { loadSources } from '../../dev/sources.js'
import { readAuth, readEntities, readReceipt, readSeed, surfaceKeys, type AuthDeclaration } from '../../host/definitions.js'

/**
 * Checks every `packs[]` pin against `.pwf/packs/<id>@<version>/`.
 * A build that is not cached is a warning (`PIN_NOT_CACHED`: `pwf add` it);
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
      issues.push({
        severity: 'warning',
        code: 'PIN_NOT_CACHED',
        path: rel,
        message: `${pin.id}@${pin.version} is pinned but not in ${rel}; run \`pwf add <its .pwpack or folder>\``,
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
 *  - with a way in (`auth.json` methods, or an issuer): `auth.error.*`, and the runner's own
 *    sign-in screen (`gate.*`) unless `app.signIn` names the app's — its
 *    password fields and `session.*` with a password method, one
 *    `gate.provider.<method>` per provider, `gate.title` only when the plan
 *    has no title; the account control's `account.*` when `navigation.json`
 *    declares `account`, else the fallback pill (`pill.*`); `bridge.*` for an
 *    external issuer.
 */
export function reachableMessageIds(root: string): RunnerMessageId[] {
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
    all('auth.error.')
    const password = auth.topology === 'app' && auth.methods.includes('password')
    const providers = auth.methods.filter((m) => m !== 'password')
    if (!named(app['signIn'])) {
      if (!(isObj(plan) && named(plan['title']))) ids.add('gate.title')
      for (const id of ['gate.body', 'gate.close', 'gate.signIn'] as const) ids.add(id)
      if (password) {
        for (const id of ['gate.email', 'gate.password', 'gate.name', 'gate.register', 'gate.toRegister', 'gate.toSignIn'] as const) ids.add(id)
        all('session.')
      }
      if (password && providers.length > 0) ids.add('gate.or')
      for (const m of providers) if ((PROVIDER_LABEL_METHODS as readonly string[]).includes(m)) ids.add(`gate.provider.${m}`)
    }
    const account = isObj(navigation) && isObj(navigation['account']) ? navigation['account'] : undefined
    if (account) {
      for (const id of ['account.signIn', 'account.signOut', 'account.greeting'] as const) ids.add(id)
      if (named(account['profileHref'])) ids.add('account.profile')
    } else all('pill.')
    if (auth.topology === 'external') all('bridge.')
  }
  return RUNNER_MESSAGE_IDS.filter((id) => ids.has(id))
}

/**
 * MESSAGES_MISSING: the runner message ids this app can reach
 * ({@link reachableMessageIds}) that `plan.json` `messages` does not set. The
 * visitor reads the engine's neutral English fallback for each — an error
 * when the app's `locale` is not English, a warning otherwise.
 */
export function checkMessages(root: string): PackIssue[] {
  const plan = readJsonFile(join(root, 'app', 'plan.json'))
  if (!isObj(plan)) return []
  const messages = isObj(plan['messages']) ? plan['messages'] : {}
  const missing = reachableMessageIds(root).filter((id) => !(typeof messages[id] === 'string' && messages[id] !== ''))
  if (missing.length === 0) return []
  const locale = typeof plan['locale'] === 'string' ? plan['locale'].trim() : ''
  const english = locale === '' || /^en(?:[-_]|$)/i.test(locale)
  return [
    {
      severity: english ? 'warning' : 'error',
      code: 'MESSAGES_MISSING',
      path: 'app/plan.json',
      message:
        `the app can show ${missing.length} runner message${missing.length === 1 ? '' : 's'} it does not set in messages, ` +
        `so the visitor reads the engine's English fallback${english ? '' : ` in a ${locale} app`}: ${missing.join(', ')}`,
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
  return [
    { folder: sources.app.folder, atoms: sources.app.validation.atoms },
    ...sources.packs.map((s) => ({ folder: s.folder, atoms: s.validation.atoms, label: s.label })),
  ]
}


/**
 * `validatePack` plus {@link checkPins}, {@link checkSeeds}, {@link checkEntities},
 * {@link checkAccess}, {@link checkProps} and the pack library's `checkRowFields`
 * (`FIELD_UNKNOWN` warnings: a receipt reading a row field its data source's rows
 * do not have; a connector-served source is known from the engine that serves
 * its connection, the app's own or a pinned pack's), as one result.
 */
export async function validateProject(root: string, pack: PackFolder): Promise<PackValidation> {
  const result = validatePack(pack)
  const pinIssues = await checkPins(root, result.identity)
  const sources = await atomSources(root, result.identity)
  const fieldIssues = checkRowFields(pack, connectionFieldSets(pack, sources))
  const issues = [...result.issues, ...pinIssues, ...checkSeeds(root), ...checkEntities(root), ...checkAccess(root), ...checkMessages(root), ...propIssues(sources), ...fieldIssues]
  return { ...result, issues, ok: !issues.some((i) => i.severity === 'error') }
}

const SEVERITIES = ['error', 'warning', 'info'] as const
const HEADINGS = { error: 'Errors', warning: 'Warnings', info: 'Notes' } as const

/** Prints issues grouped by severity, errors first. Prints nothing for an empty list. */
export function printIssues(io: CommandIO, issues: readonly PackIssue[]): void {
  for (const severity of SEVERITIES) {
    const group = issues.filter((i) => i.severity === severity)
    if (group.length === 0) continue
    const write = severity === 'error' ? io.err.bind(io) : io.out.bind(io)
    write(`${HEADINGS[severity]} (${group.length}):`)
    for (const issue of group) write(`  ${issue.code}${issue.path ? ` ${issue.path}` : ''}: ${issue.message}`)
  }
}

/** `n errors, n warnings` for a summary line. */
export function countLine(issues: readonly PackIssue[]): string {
  const n = (s: PackIssue['severity']): number => issues.filter((i) => i.severity === s).length
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
  return `${plural(n('error'), 'error')}, ${plural(n('warning'), 'warning')}`
}
