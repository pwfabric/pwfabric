/**
 * APPS IN SEVERAL LANGUAGES (envelope §2.3): the locale declaration, the
 * address table every producer derives the same way, and how an address is
 * read back into a locale and a page.
 *
 * Pure and dependency-free: the validator, the build and the runner read
 * locales from this one file.
 *
 * @module @pwfabric/contracts/fabric/app-locales
 */

/** An app's languages and the one at its root. */
export interface LocaleDeclaration {
  readonly locales: readonly string[]
  readonly defaultLocale: string
}

/** `{ <lang>: { <page key>: address } }`, each address from the app's base (`""`, `de/`, `de/preise/`). */
export type AddressTable = Readonly<Record<string, Readonly<Record<string, string>>>>

/** The address prefix of a locale: its tag in lower case, then `/` (`de/`, `pt-br/`). */
export function localePrefix(tag: string): string {
  return `${tag.toLowerCase()}/`
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * What is wrong with a plan's (or a project's) `locales` and
 * `defaultLocale`, as sentences (`APP_LOCALES_INVALID`): `defaultLocale`
 * missing or not one of `locales`, a locale written twice or two with one
 * prefix, a flat `messages` beside `locales`, or a `locale` other than
 * `defaultLocale`. Empty for a single-language plan.
 */
export function localesProblems(plan: unknown): string[] {
  if (!isRecord(plan) || (plan['locales'] === undefined && plan['defaultLocale'] === undefined)) return []
  const problems: string[] = []
  const raw = plan['locales']
  const locales = Array.isArray(raw) ? raw : []
  if (!Array.isArray(raw) || locales.length === 0) problems.push('locales lists the app\'s languages, at least one BCP 47 tag')
  if (locales.some((l) => typeof l !== 'string' || !isLocaleTag(l))) problems.push('every entry of locales is a BCP 47 tag ("en", "pt-BR")')
  const def = plan['defaultLocale']
  if (typeof def !== 'string') problems.push('defaultLocale names the language at the app\'s root, one of locales')
  else if (!locales.includes(def)) problems.push(`defaultLocale "${def}" is not one of locales`)
  const prefixes = new Map<string, string>()
  for (const l of locales) {
    if (typeof l !== 'string') continue
    const p = localePrefix(l)
    const seen = prefixes.get(p)
    if (seen !== undefined) problems.push(`locales "${seen}" and "${l}" have the same address prefix ${p}`)
    prefixes.set(p, l)
  }
  if (plan['messages'] !== undefined) problems.push('an app with locales keeps its words in app/messages/<lang>.json, not in a flat messages map')
  if (plan['locale'] !== undefined && plan['locale'] !== def) problems.push(`locale "${String(plan['locale'])}" is not defaultLocale "${String(def)}"`)
  return problems
}

/** A BCP 47 tag as far as an address needs one: letters, digits and hyphens, starting with a letter. */
function isLocaleTag(tag: string): boolean {
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(tag)
}

/** The locale declaration of a plan or project, when it is one a producer can build (no {@link localesProblems} that touch it). */
export function localesOf(doc: unknown): LocaleDeclaration | undefined {
  if (!isRecord(doc) || !Array.isArray(doc['locales'])) return undefined
  const locales = doc['locales'].filter((l): l is string => typeof l === 'string' && isLocaleTag(l))
  const def = doc['defaultLocale']
  if (locales.length === 0 || typeof def !== 'string' || !locales.includes(def)) return undefined
  if (new Set(locales.map(localePrefix)).size !== locales.length) return undefined
  return { locales, defaultLocale: def }
}

/** A receipt's `path` member: `{ <lang>: segment path }`, string values only. */
export function receiptPathOf(receipt: unknown): Readonly<Record<string, string>> | undefined {
  const raw = isRecord(receipt) ? receipt['path'] : undefined
  if (!isRecord(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [lang, seg] of Object.entries(raw)) if (typeof seg === 'string') out[lang] = seg.replace(/^\/+|\/+$/g, '')
  return out
}

/** The first segment of a key or segment path. */
const firstSegment = (path: string): string => path.split('/')[0] ?? ''

/**
 * The address table (envelope §2.3): every page of `keys` (the app's
 * `surfaceOrder`) in every locale — the entry page at the locale's root
 * (`""`, `<prefix>`), any other page at its segment path (its receipt's
 * `path` for the locale, else its key) and a `/`, under the locale's prefix
 * for a non-default locale. And what breaks the table's rules, as sentences
 * (`APP_ADDRESS_CONFLICT`).
 */
export function addressTable(
  declaration: LocaleDeclaration,
  keys: readonly string[],
  entry: string,
  pathOf: (key: string) => Readonly<Record<string, string>> | undefined
): { addresses: AddressTable; problems: string[] } {
  const problems: string[] = []
  const { locales, defaultLocale } = declaration
  const reserved = new Set(locales.map((l) => l.toLowerCase()))
  const keySet = new Set(keys)
  for (const key of keys) {
    if (reserved.has(firstSegment(key).toLowerCase())) problems.push(`the page key "${key}" starts with a locale prefix`)
    for (const l of locales) if (key.endsWith(`.${l}`)) problems.push(`the page key "${key}" ends in ".${l}", the name of a per-locale receipt`)
    const path = pathOf(key)
    if (!path) continue
    if (key === entry && Object.keys(path).length > 0) problems.push(`the entry page "${key}" has a path: it is each locale's root`)
    for (const [lang, seg] of Object.entries(path)) {
      if (!locales.includes(lang)) problems.push(`the page "${key}" has a path for "${lang}", which is not one of locales`)
      if (reserved.has(firstSegment(seg).toLowerCase())) problems.push(`the page "${key}" has the path "${seg}" in "${lang}", which starts with a locale prefix`)
      if (seg !== key && keySet.has(seg)) problems.push(`the page "${key}" has the path "${seg}" in "${lang}", which is the key of another page`)
    }
  }
  const addresses: Record<string, Record<string, string>> = {}
  for (const lang of locales) {
    const prefix = lang === defaultLocale ? '' : localePrefix(lang)
    const row: Record<string, string> = {}
    const seen = new Map<string, string>()
    for (const key of keys) {
      const seg = key === entry ? '' : (pathOf(key)?.[lang] ?? key)
      const address = seg === '' ? prefix : `${prefix}${seg}/`
      const other = seen.get(address)
      if (other !== undefined) problems.push(`in "${lang}" the pages "${other}" and "${key}" share the address "${address}"`)
      seen.set(address, key)
      row[key] = address
    }
    addresses[lang] = row
  }
  return { addresses, problems: [...new Set(problems)] }
}

/**
 * The locale and the page an address names (envelope §3): `rest` is the
 * path below the app's base (path routing) or the route (hash routing),
 * with or without its slashes. Its first segment selects a non-default
 * locale when it is that locale's prefix; any other address is the default
 * locale's. The rest is matched against that locale's row of the table:
 * `key` is null when it names no page there.
 */
export function addressedPage(table: AddressTable, declaration: LocaleDeclaration, rest: string): { locale: string; key: string | null } {
  const trimmed = rest.replace(/^\/+|\/+$/g, '')
  const first = firstSegment(trimmed).toLowerCase()
  const locale = declaration.locales.find((l) => l !== declaration.defaultLocale && l.toLowerCase() === first) ?? declaration.defaultLocale
  const row = table[locale] ?? {}
  for (const [key, address] of Object.entries(row)) if (address.replace(/\/+$/, '') === trimmed) return { locale, key }
  return { locale, key: null }
}

/** Whether `rest` (as for {@link addressedPage}) is an address of the table, in any locale. */
export function isTableAddress(table: AddressTable, rest: string): boolean {
  const trimmed = rest.replace(/^\/+|\/+$/g, '')
  return Object.values(table).some((row) => Object.values(row).some((a) => a.replace(/\/+$/, '') === trimmed))
}

/**
 * The words of `locale` (envelope §2.3): its catalogue over the default
 * locale's, so an id it does not set reads the default's.
 */
export function catalogueFor(
  catalogues: Readonly<Record<string, Readonly<Record<string, string>>>>,
  declaration: LocaleDeclaration,
  locale: string
): Record<string, string> {
  return { ...(catalogues[declaration.defaultLocale] ?? {}), ...(catalogues[locale] ?? {}) }
}

/** The ids the default locale's catalogue sets and `catalogue` does not (`MESSAGES_LOCALE_MISSING`). */
export function missingCatalogueIds(defaults: Readonly<Record<string, unknown>>, catalogue: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(defaults).filter((id) => typeof catalogue[id] !== 'string' || catalogue[id] === '')
}
