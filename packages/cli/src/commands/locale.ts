/**
 * `pwf locale add <lang>` and `pwf locale status` — an app's languages
 * (envelope §2.3).
 *
 * `add` puts a language in `app/plan.json` `locales` and gives it a
 * catalogue, `app/messages/<lang>.json`, with every id of the default
 * locale's and empty strings to fill in. The first `add` on a single-language
 * app converts it: its `locale` becomes `defaultLocale`, and its flat
 * `messages` move to `app/messages/<default>.json`. Nothing is written when
 * the new language would break the address rules (a page key that starts with
 * its prefix, two locales with one prefix).
 *
 * `status` says, per locale, which of the default's ids its catalogue lacks
 * or leaves empty, and which pages have a receipt of their own in it.
 */
import { readdir } from 'node:fs/promises'
import { addressTable, localePrefix, localesOf, localesProblems, receiptPathOf } from '@pwfabric/contracts'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, UsageError } from './lib/flags.js'
import { CommandFailure } from './lib/failure.js'
import { resolveFrom } from './lib/project.js'
import {
  fileExists,
  inFolder,
  isObject,
  MESSAGES_DIR,
  PLAN_FILE,
  readAppIdentity,
  readJsonObject,
  receiptRel,
  surfaceOrderOf,
  writeJsonFile,
  type JsonObject,
} from './lib/app-files.js'

/** A BCP 47 tag as far as an address needs one (the rule `localesProblems` applies). */
const LOCALE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

const catalogueRel = (lang: string): string => `${MESSAGES_DIR}/${lang}.json`

/** The plan with `locales` and `defaultLocale` placed right after `locale` (or first). */
function withLocales(plan: JsonObject, locales: string[], defaultLocale: string): JsonObject {
  const out: JsonObject = {}
  const put = (): void => {
    out['locales'] = locales
    out['defaultLocale'] = defaultLocale
  }
  let placed = false
  for (const [key, value] of Object.entries(plan)) {
    if (key === 'locales' || key === 'defaultLocale' || key === 'messages') continue
    out[key] = value
    if (key === 'locale') {
      put()
      placed = true
    }
  }
  if (!placed) {
    const rest = { ...out }
    for (const k of Object.keys(out)) delete out[k]
    put()
    Object.assign(out, rest)
  }
  return out
}

/** Strings only: a catalogue as the runner reads it. */
function stringsOf(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (isObject(value)) for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v
  return out
}

export interface LocaleAdded {
  readonly locale: string
  readonly locales: readonly string[]
  readonly defaultLocale: string
  /** The single-language app was converted by this call. */
  readonly converted: boolean
  /** Catalogue files written (created or given the ids they lacked). */
  readonly wrote: readonly string[]
  /** The locale was declared already and its catalogue had every id. */
  readonly unchanged: boolean
}

export async function addLocale(root: string, lang: string, defaultFlag?: string): Promise<LocaleAdded> {
  if (!LOCALE_TAG.test(lang)) throw new UsageError(`"${lang}" is not a BCP 47 language tag (en, de, pt-BR)`)
  const { app } = await readAppIdentity(root, 'pwf locale add')
  const plan = (await readJsonObject(root, PLAN_FILE)) ?? {}
  const problems = localesProblems(plan)
  if (problems.length > 0) throw new CommandFailure('APP_LOCALES_INVALID', `${PLAN_FILE}: ${problems.join('; ')}; fix it first`)

  const declared = localesOf(plan)
  let converted = false
  let defaultLocale: string
  let locales: string[]
  const wrote: string[] = []
  let defaults: Record<string, string>
  if (!declared) {
    const current = typeof plan['locale'] === 'string' ? plan['locale'] : defaultFlag
    if (current === undefined) {
      throw new UsageError(`${PLAN_FILE} has no "locale", so the language the app is written in is not known; pass --default <lang>`)
    }
    if (defaultFlag !== undefined && defaultFlag !== current) {
      throw new UsageError(`${PLAN_FILE} says the app is written in "${current}"; --default "${defaultFlag}" disagrees`)
    }
    if (!LOCALE_TAG.test(current)) throw new CommandFailure('APP_LOCALES_INVALID', `${PLAN_FILE} locale "${current}" is not a BCP 47 tag`)
    defaultLocale = current
    locales = current === lang ? [current] : [current, lang]
    converted = true
    defaults = stringsOf(plan['messages'])
    if (fileExists(root, catalogueRel(defaultLocale))) {
      throw new CommandFailure('APP_FILE_INVALID', `${catalogueRel(defaultLocale)} exists already; the flat messages of ${PLAN_FILE} would replace it`)
    }
  } else {
    defaultLocale = declared.defaultLocale
    locales = declared.locales.includes(lang) ? [...declared.locales] : [...declared.locales, lang]
    defaults = stringsOf(await readJsonObject(root, catalogueRel(defaultLocale)))
  }

  // The address rules with the new language, before anything is written.
  const keys = surfaceOrderOf(app)
  const entry = typeof app['entry'] === 'string' ? app['entry'] : (keys[0] ?? '')
  const paths = new Map<string, Readonly<Record<string, string>> | undefined>()
  for (const key of keys) paths.set(key, receiptPathOf(await readJsonObject(root, receiptRel(key)).catch(() => undefined)))
  const next = withLocales(plan, locales, defaultLocale)
  const check = [...localesProblems(next), ...addressTable({ locales, defaultLocale }, keys, entry, (k) => paths.get(k)).problems]
  if (check.length > 0) {
    throw new CommandFailure('APP_ADDRESS_CONFLICT', `"${lang}" cannot be added: ${check.join('; ')}`)
  }

  const planChanged = JSON.stringify(next) !== JSON.stringify(plan)
  if (converted) {
    await writeJsonFile(root, catalogueRel(defaultLocale), defaults)
    wrote.push(catalogueRel(defaultLocale))
  }
  if (lang !== defaultLocale) {
    const rel = catalogueRel(lang)
    const had = await readJsonObject(root, rel)
    const filled: JsonObject = { ...(had ?? {}) }
    for (const id of Object.keys(defaults)) if (!(id in filled)) filled[id] = ''
    if (!had || Object.keys(filled).length !== Object.keys(had).length) {
      await writeJsonFile(root, rel, filled)
      wrote.push(rel)
    }
  }
  if (planChanged) await writeJsonFile(root, PLAN_FILE, next)
  return { locale: lang, locales, defaultLocale, converted, wrote, unchanged: !planChanged && wrote.length === 0 }
}

export interface LocaleState {
  readonly locale: string
  readonly isDefault: boolean
  readonly prefix: string
  /** `app/messages/<lang>.json` exists. */
  readonly catalogue: boolean
  /** Ids of the default locale's catalogue this one does not set. */
  readonly missing: readonly string[]
  /** Ids this catalogue sets to "". */
  readonly empty: readonly string[]
  /** Page keys with a receipt of their own in this locale (`<key>.<lang>.receipt.json`). */
  readonly receipts: readonly string[]
  /** Page keys whose receipt names a `path` for this locale. */
  readonly paths: readonly string[]
}

export interface LocaleStatus {
  /** Single-language: the app's one `locale` (or null when the plan names none), and nothing else. */
  readonly single?: { readonly locale: string | null }
  readonly defaultLocale?: string
  readonly locales: readonly LocaleState[]
  /** Address-table problems (APP_ADDRESS_CONFLICT), as `pwf validate` reports them. */
  readonly problems: readonly string[]
}

export async function localeStatus(root: string): Promise<LocaleStatus> {
  const { app } = await readAppIdentity(root, 'pwf locale status')
  const plan = (await readJsonObject(root, PLAN_FILE)) ?? {}
  const declared = localesOf(plan)
  if (!declared) {
    return { single: { locale: typeof plan['locale'] === 'string' ? plan['locale'] : null }, locales: [], problems: localesProblems(plan) }
  }
  const keys = surfaceOrderOf(app)
  const entry = typeof app['entry'] === 'string' ? app['entry'] : (keys[0] ?? '')
  const receiptPaths = new Map<string, Readonly<Record<string, string>> | undefined>()
  for (const key of keys) receiptPaths.set(key, receiptPathOf(await readJsonObject(root, receiptRel(key)).catch(() => undefined)))
  const defaults = stringsOf(await readJsonObject(root, catalogueRel(declared.defaultLocale)).catch(() => undefined))
  const own = new Set(await surfaceFiles(root))
  const locales: LocaleState[] = []
  for (const lang of declared.locales) {
    const raw = await readJsonObject(root, catalogueRel(lang)).catch(() => undefined)
    const words = stringsOf(raw)
    locales.push({
      locale: lang,
      isDefault: lang === declared.defaultLocale,
      prefix: lang === declared.defaultLocale ? '' : localePrefix(lang),
      catalogue: raw !== undefined,
      missing: Object.keys(defaults).filter((id) => words[id] === undefined),
      empty: Object.keys(words).filter((id) => words[id] === ''),
      receipts: keys.filter((k) => own.has(receiptRel(k, lang))),
      paths: keys.filter((k) => receiptPaths.get(k)?.[lang] !== undefined),
    })
  }
  const problems = [...localesProblems(plan), ...addressTable(declared, keys, entry, (k) => receiptPaths.get(k)).problems]
  return { defaultLocale: declared.defaultLocale, locales, problems }
}

/** Every file under `app/surfaces/`, as folder-relative paths. */
async function surfaceFiles(root: string): Promise<string[]> {
  const entries = await readdir(inFolder(root, 'app/surfaces'), { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isFile())
    .map((e) => {
      const dir = (e.parentPath ?? (e as unknown as { path: string }).path).slice(inFolder(root, 'app/surfaces').length).replace(/\\/g, '/').replace(/^\//, '')
      return `app/surfaces/${dir ? `${dir}/` : ''}${e.name}`
    })
}

const list = (ids: readonly string[], max = 8): string => (ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} … (+${ids.length - max})`)

export async function runLocale(args: ParsedArgs, io: CommandIO): Promise<number> {
  const [verb, lang, extra] = args.positionals
  const root = resolveFrom(io.cwd, stringFlag(args, 'dir'))
  if (verb === 'add') {
    if (lang === undefined) throw new UsageError('missing <lang>')
    if (extra !== undefined) throw new UsageError(`unexpected argument "${extra}"`)
    const added = await addLocale(root, lang, stringFlag(args, 'default'))
    if (added.unchanged) {
      io.out(`${lang} is declared already; its catalogue has every id of ${added.defaultLocale}`)
      return 0
    }
    if (added.converted) io.out(`The app is now multi-language: ${added.defaultLocale} at its root (defaultLocale); its messages moved to ${catalogueRel(added.defaultLocale)}`)
    io.out(`Locales: ${added.locales.join(', ')}`)
    for (const rel of added.wrote) io.out(`  wrote ${rel}`)
    if (lang !== added.defaultLocale) {
      io.out('')
      io.out(`Next: fill in the empty strings of ${catalogueRel(lang)}, give pages a path in ${lang} ("path": { "${lang}": "…" }) where the address should be translated, then`)
      io.out('  pwf locale status')
    }
    return 0
  }
  if (verb === 'status') {
    if (lang !== undefined) throw new UsageError(`unexpected argument "${lang}"`)
    const status = await localeStatus(root)
    if (boolFlag(args, 'json')) {
      io.out(JSON.stringify(status, null, 2))
      return 0
    }
    if (status.single) {
      io.out(`A single-language app${status.single.locale ? ` in ${status.single.locale}` : ' (app/plan.json names no locale)'}; \`pwf locale add <lang>\` adds a language.`)
      for (const p of status.problems) io.err(`  APP_LOCALES_INVALID: ${p}`)
      return 0
    }
    for (const l of status.locales) {
      io.out(`${l.locale}${l.isDefault ? ' (default, at the root)' : ` (at ${l.prefix})`}`)
      if (!l.catalogue) io.out(`  no ${catalogueRel(l.locale)}: every word falls back to ${status.defaultLocale}`)
      else if (l.missing.length === 0 && l.empty.length === 0) io.out('  words: complete')
      if (l.missing.length > 0) io.out(`  missing ${l.missing.length}: ${list(l.missing)}`)
      if (l.empty.length > 0) io.out(`  empty ${l.empty.length} (drawn as nothing until filled): ${list(l.empty)}`)
      if (!l.isDefault) io.out(`  translated addresses: ${l.paths.length > 0 ? list(l.paths) : 'none (pages use their keys)'}`)
      if (l.receipts.length > 0) io.out(`  own receipts: ${list(l.receipts)}`)
    }
    for (const p of status.problems) io.err(`APP_ADDRESS_CONFLICT: ${p}`)
    return 0
  }
  throw new UsageError(verb === undefined ? 'missing "add" or "status"' : `unknown subcommand "${verb}"`)
}

export const locale: Command = {
  name: 'locale',
  summary: "Add a language to the app, or show how complete each language's words are",
  usage: `pwf locale add <lang> [--default <lang>] [--dir <app>]
pwf locale status [--json] [--dir <app>]

  <lang>            a BCP 47 tag: en, de, pt-BR
  --default <lang>  the language the app is written in now, when app/plan.json
                    names no "locale" (first add only)
  --dir <path>      the app folder (default: the current folder)

add: puts <lang> in app/plan.json "locales" and writes
app/messages/<lang>.json with every id of the default locale's catalogue, each
"" to fill in (ids it has already are kept). The first add on a
single-language app converts it (envelope §2.3): "locales" and
"defaultLocale" (its "locale") are written into the plan, and its flat
"messages" move to app/messages/<default>.json. Refused, with nothing written,
when the language would break the address rules (APP_ADDRESS_CONFLICT: a page
key starting with its prefix, two locales with one prefix). Again with the
same language: adds only the ids its catalogue lacks.

status: per locale, the default's ids its catalogue lacks and the ids it
leaves empty (both fall back to the default's words, MESSAGES_LOCALE_MISSING),
the pages whose address it translates (a receipt's "path") and the pages with
a receipt of their own (<key>.<lang>.receipt.json). Exit 0; --json prints the
same as data.`,
  run: (args, io) => guard('locale', io, () => runLocale(args, io)),
}
