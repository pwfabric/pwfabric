/**
 * THE APP WRITES EVERY WORD (envelope §2, "Messages").
 *
 * An app declares its words once, in `app/plan.json` `messages`: a flat map
 * from a message id to a string in the app's `plan.locale`. `pwf build` and
 * `pwf dev` carry it into `project.json`; the runner draws its gate, pill,
 * account labels and not-found page from it, and blocks read their accessible
 * names from it (`useAppMessage`, app-messages.tsx).
 *
 * THE ENGINE WRITES NO VISITOR WORD (founder decision, 3.0.1). It keeps no
 * fallback table: a message the app does not set reads as `''` — a block may
 * still pass a fallback of its own (`useAppMessage(id, fallback)`, the
 * block's words, not the engine's) — and under `pwf dev` the console names
 * the missing id once (`warnMissingMessage`). `pwf validate` reports every id
 * the app can reach and does not set (MESSAGES_MISSING).
 *
 * Placeholders are `{name}`, `{code}` and `{n}` — whatever `vars` names, in
 * braces. A placeholder `vars` does not fill is written as nothing, so a
 * visitor never sees `{name}`. A message may choose its words by a number
 * with the ICU plural form, `{n, plural, one {# item} other {# items}}`,
 * picked with the plural rules of the app's locale (envelope §2.1).
 *
 * Pure: no React, no DOM. The runner imports this file on its own
 * (`@pwfabric/runtime/render/messages`) without pulling in the renderer.
 *
 * @module @pwfabric/runtime/render/messages
 */

import { extractBraceBlock, readIcuOptions } from '../i18n/icu.js'

/**
 * The renderer's own message ids — the words it draws around blocks:
 *  - `ui.retry`: the accessible name of the retry button a block whose module
 *    failed to load is drawn as (any page can meet it);
 *  - `ui.loading`: the loading gate's line (`loadingStrategy: 'gate'` only —
 *    the runner paints `immediate`, so a published app never draws it).
 */
export const RENDERER_MESSAGE_IDS = ['ui.retry', 'ui.loading'] as const

/** The app's words: message id → string, in the app's locale. */
export type AppMessages = Readonly<Record<string, string>>

/** The values a message's `{placeholders}` are filled from. */
export type MessageVars = Readonly<Record<string, string | number | null | undefined>>

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g

/** `{<arg>, plural, …` at the start of a text: the head of an ICU plural. */
const PLURAL_HEAD = /^\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*plural\s*,/
/** `{<arg>, select…` and `{<arg>, selectordinal…`: ICU forms a message does not use. */
const OTHER_FORM = /^\{\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*(select|selectordinal)\s*,/
/** An ICU form inside a branch. */
const NESTED_FORM = /\{\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*(?:plural|select|selectordinal)\s*,/
/** The selectors a plural branch may carry: `=N` and the CLDR categories. */
const PLURAL_SELECTOR = /^(?:=\d+|zero|one|two|few|many|other)$/

/** One plural of a message, read: its argument, its branches, where it ends. */
interface PluralRead {
  readonly arg: string
  readonly branches: ReadonlyMap<string, string>
  readonly end: number
}

/**
 * Every ICU form of `message`, read — and the problems that make it one a
 * runner writes as its text (envelope §2.1): a plural with no `other`, an
 * unknown or repeated selector, a branch that is not `<selector> {text}`, a
 * plural inside a branch, an unclosed brace, and `select` or
 * `selectordinal`, which a message does not use.
 */
function readPlurals(message: string): { plurals: Map<number, PluralRead>; problems: string[] } {
  const plurals = new Map<number, PluralRead>()
  const problems: string[] = []
  for (let i = 0; i < message.length; i++) {
    if (message[i] !== '{') continue
    const rest = message.slice(i)
    const other = OTHER_FORM.exec(rest)
    if (other) {
      problems.push(`${other[1] as string} is not understood in a message; only plural is`)
      const block = extractBraceBlock(message, i)
      if (block === null) break
      i = block.end
      continue
    }
    const head = PLURAL_HEAD.exec(rest)
    if (!head) continue
    const arg = head[1] as string
    const block = extractBraceBlock(message, i)
    if (block === null) {
      problems.push(`the plural of {${arg}} is not closed`)
      break
    }
    const body = block.content.slice(head[0].length - 1)
    const { options, complete } = readIcuOptions(body)
    if (!complete) problems.push(`the plural of {${arg}} has a branch that is not <selector> {text}`)
    const branches = new Map<string, string>()
    for (const { key, text } of options) {
      if (!PLURAL_SELECTOR.test(key)) problems.push(`the plural of {${arg}} has the selector "${key}", which is not =<number> or a plural category`)
      if (branches.has(key)) problems.push(`the plural of {${arg}} has the branch "${key}" twice`)
      if (NESTED_FORM.test(text)) problems.push(`the plural of {${arg}} has a plural inside its branch "${key}"`)
      branches.set(key, text)
    }
    if (!branches.has('other')) problems.push(`the plural of {${arg}} has no "other" branch`)
    plurals.set(i, { arg, branches, end: block.end })
    i = block.end
  }
  return { plurals, problems }
}

/**
 * What is wrong with the plurals of `message` (envelope §2.1), as sentences:
 * empty for a message whose plurals a runner can pick, and for a message
 * with none. What a validator reports.
 */
export function pluralProblems(message: string): string[] {
  return readPlurals(message).problems
}

/** The plural category of `n` in `locale` (`en` when the locale is unknown). */
function pluralCategory(n: number, locale: string): string {
  try {
    return new Intl.PluralRules(locale).select(n)
  } catch {
    return new Intl.PluralRules('en').select(n)
  }
}

/** `n` written in `locale` (`en` when the locale is unknown). */
function localNumber(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(n)
  } catch {
    return new Intl.NumberFormat('en').format(n)
  }
}

/** The `{name}` placeholders of a text filled from `vars` (nothing when unset). */
function fillPlaceholders(text: string, vars?: MessageVars): string {
  return text.replace(PLACEHOLDER, (_, name: string) => {
    const v = vars?.[name]
    return v === undefined || v === null ? '' : String(v)
  })
}

/**
 * `template` with each `{name}` replaced by `vars.name` (nothing when unset)
 * and each ICU plural (`{n, plural, =0 {…} one {# …} other {# …}}`,
 * envelope §2.1) resolved: the branch of the first `=N` equal to the number,
 * else of its category under the plural rules of `locale` (the app's; `en`
 * when it names none), else `other`; in that branch `#` is the number
 * written in `locale`. A value that is not a finite number selects `other`
 * and is written as given. A message whose ICU forms are not plurals a
 * runner can pick ({@link pluralProblems}) is written as its text, braces
 * and all.
 */
export function formatMessage(template: string, vars?: MessageVars, locale = 'en'): string {
  if (!template.includes(',')) return fillPlaceholders(template, vars)
  const { plurals, problems } = readPlurals(template)
  if (problems.length > 0) return template
  if (plurals.size === 0) return fillPlaceholders(template, vars)
  let out = ''
  let at = 0
  for (const [start, plural] of plurals) {
    out += fillPlaceholders(template.slice(at, start), vars)
    const value = vars?.[plural.arg]
    const n = typeof value === 'number' && Number.isFinite(value) ? value : undefined
    const branch =
      (n !== undefined && Number.isInteger(n) ? plural.branches.get(`=${n}`) : undefined) ??
      (n !== undefined ? plural.branches.get(pluralCategory(n, locale)) : undefined) ??
      (plural.branches.get('other') as string)
    const written = n !== undefined ? localNumber(n, locale) : value === undefined || value === null ? '' : String(value)
    out += fillPlaceholders(branch, vars).replace(/#/g, written)
    at = plural.end + 1
  }
  return out + fillPlaceholders(template.slice(at), vars)
}

/** Ids already named in the console, so a missing word is said once, not per render. */
const warned = new Set<string>()

/**
 * Under `pwf dev` (the dev server's reload client sets `globalThis.__pwfabric_dev`),
 * names a message id the app does not set, once. Silent anywhere else — a
 * published app's visitor has no use for it, and `pwf validate` has said it.
 */
export function warnMissingMessage(id: string): void {
  if ((globalThis as { __pwfabric_dev?: unknown }).__pwfabric_dev !== true || warned.has(id)) return
  warned.add(id)
  console.warn(`[pwapp] the app sets no message "${id}": nothing is drawn there. Write it in app/plan.json messages.`)
}

/**
 * The app's message for `id` when it sets a non-empty string, else
 * `fallback` (a block's own word) when one is given, else `''`; then its
 * placeholders filled.
 *
 * Only a string counts: a number or an object under an id is a mistake in the
 * plan, and is read as not set rather than as `[object Object]`.
 */
export function messageOf(
  messages: AppMessages | null | undefined,
  id: string,
  fallback?: string,
  vars?: MessageVars,
  /** The app's locale: the plural rules and the numbers a plural is written in; `en` without one. */
  locale?: string
): string {
  const own = messages && Object.prototype.hasOwnProperty.call(messages, id) ? messages[id] : undefined
  if (typeof own === 'string' && own.length > 0) return formatMessage(own, vars, locale)
  if (fallback !== undefined) return formatMessage(fallback, vars, locale)
  warnMissingMessage(id)
  return ''
}

/**
 * The app's messages as a plain map: string values only, from `project.json`
 * or `plan.json` `messages`. Anything else is `{}`.
 */
export function appMessagesOf(value: unknown): AppMessages {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
  return out
}
