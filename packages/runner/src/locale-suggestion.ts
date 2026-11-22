/**
 * THE VISITOR'S LANGUAGE (envelope §2.3). A runner never sends a visitor to
 * another locale on its own. When the browser's languages prefer a declared
 * locale other than the one drawn, it offers it: a small notice, drawn by
 * script after hydration (never in the first frame), with a link to the
 * current page in that locale and a way to dismiss it, its words read from
 * that locale's catalogue — `locale.suggestion` (`{language}` is the
 * language's name in itself), `locale.switch`, `locale.dismiss`.
 *
 * The choice or the dismissal is kept in `localStorage["pwapp_locale:<appId>"]`
 * (`{ "locale": "<lang>" }` or `{ "dismissed": true }`); once either is
 * stored, nothing is suggested again.
 *
 * @module @pwfabric/runner/locale-suggestion
 */
import { formatMessage } from '@pwfabric/runtime/render/messages'

/** The storage key of an app's language choice. */
export function localeStorageKey(appId: string): string {
  return `pwapp_locale:${appId}`
}

/**
 * The declared locale the visitor's languages prefer, in their order: a tag
 * equal to a locale (case aside), else one whose language subtag is a
 * locale's. Undefined when none is declared.
 */
export function preferredLocale(languages: readonly string[], locales: readonly string[]): string | undefined {
  for (const tag of languages) {
    const t = tag.toLowerCase()
    const exact = locales.find((l) => l.toLowerCase() === t)
    if (exact) return exact
    const lang = t.split('-')[0]
    const near = locales.find((l) => l.toLowerCase().split('-')[0] === lang)
    if (near) return near
  }
  return undefined
}

/** A language's name in itself (`Deutsch`), else its tag. */
function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

/** The attribute on the notice. */
export const LOCALE_SUGGESTION_ATTR = 'data-pw-locale-suggestion'

export interface LocaleSuggestionOptions {
  readonly appId: string
  /** The locale drawn. */
  readonly drawn: string
  readonly locales: readonly string[]
  /** `navigator.languages`. */
  readonly languages: readonly string[]
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined
  readonly doc: Document
  /** The current page's address in `lang`. */
  readonly hrefOf: (lang: string) => string
  /** The words of `lang` (its catalogue over the default's). */
  readonly wordsOf: (lang: string) => Promise<Readonly<Record<string, string>>>
}

/**
 * Offers the visitor's preferred locale, when there is one to offer and they
 * have neither chosen nor dismissed; resolves with the notice, or null. A
 * locale whose catalogue writes no `locale.suggestion` is offered by nothing:
 * the engine writes no word of its own.
 */
export async function mountLocaleSuggestion(options: LocaleSuggestionOptions): Promise<HTMLElement | null> {
  const key = localeStorageKey(options.appId)
  try {
    const stored = options.storage?.getItem(key)
    if (stored) return null
  } catch {
    // unreadable storage: nothing stored
  }
  const lang = preferredLocale(options.languages, options.locales)
  if (lang === undefined || lang === options.drawn) return null
  const words = await options.wordsOf(lang)
  const text = words['locale.suggestion']
  if (typeof text !== 'string' || text === '') return null
  const keep = (value: Record<string, unknown>): void => {
    try {
      options.storage?.setItem(key, JSON.stringify(value))
    } catch {
      // blocked storage: the choice lasts for the page load
    }
  }
  const doc = options.doc
  const box = doc.createElement('div')
  box.setAttribute(LOCALE_SUGGESTION_ATTR, lang)
  box.setAttribute('role', 'region')
  box.setAttribute('lang', lang)
  box.setAttribute('aria-label', words['locale.switch'] || 'locale.switch')
  box.setAttribute(
    'style',
    'position:fixed;inset-inline:1rem;bottom:1rem;z-index:500;display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;padding:.75rem 1rem;' +
      'background:var(--pw-color-card,#fff);color:var(--pw-color-text,#111);border:1px solid var(--pw-color-border,#ddd);border-radius:var(--pw-radius,.375rem)'
  )
  const say = doc.createElement('span')
  say.textContent = formatMessage(text, { language: languageName(lang) }, lang)
  const go = doc.createElement('a')
  go.href = options.hrefOf(lang)
  go.hreflang = lang
  go.textContent = words['locale.switch'] || 'locale.switch'
  go.addEventListener('click', () => {
    keep({ locale: lang })
    box.remove()
  })
  const no = doc.createElement('button')
  no.type = 'button'
  no.textContent = words['locale.dismiss'] || 'locale.dismiss'
  no.addEventListener('click', () => {
    keep({ dismissed: true })
    box.remove()
  })
  box.append(say, go, no)
  doc.body.appendChild(box)
  return box
}
