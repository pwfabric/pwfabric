/**
 * THE VISITOR'S LANGUAGE (envelope §2.3). A runner never sends a visitor to
 * another locale on its own. When the browser's languages prefer a declared
 * locale other than the one drawn, it offers it: a strip fixed at the bottom
 * of the viewport, in the app's theme, drawn by
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
  const sentence = formatMessage(text, { language: languageName(lang) }, lang)
  const box = doc.createElement('div')
  box.setAttribute(LOCALE_SUGGESTION_ATTR, lang)
  box.setAttribute('role', 'region')
  box.setAttribute('lang', lang)
  // The region is named by the app's own sentence, in the language it offers.
  box.setAttribute('aria-label', sentence)
  const say = doc.createElement('span')
  say.textContent = sentence
  const go = doc.createElement('a')
  go.href = options.hrefOf(lang)
  go.hreflang = lang
  go.setAttribute('data-pw-locale-switch', '')
  go.textContent = words['locale.switch'] || 'locale.switch'
  const root = doc.documentElement
  const view = doc.defaultView
  const place = (): void => {
    // Above the app's own bar at the bottom of the viewport (a fixed tab bar,
    // a sticky footer), never over it; and the page scrolls a focused element
    // above both.
    const below = bottomBarHeight(doc, box)
    box.style.bottom = `${below}px`
    const height = box.getBoundingClientRect().height
    root.style.setProperty('scroll-padding-bottom', `${Math.ceil(below + (height || 64))}px`)
  }
  const close = (answer: Record<string, unknown>): void => {
    keep(answer)
    box.remove()
    root.style.removeProperty('scroll-padding-bottom')
    view?.removeEventListener('resize', place)
  }
  go.addEventListener('click', () => close({ locale: lang }))
  const no = doc.createElement('button')
  no.type = 'button'
  no.setAttribute('data-pw-locale-dismiss', '')
  no.textContent = words['locale.dismiss'] || 'locale.dismiss'
  no.addEventListener('click', () => close({ dismissed: true }))
  // Escape inside the strip dismisses it, as its button does.
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') close({ dismissed: true })
  })
  box.append(say, go, no)
  if (!doc.getElementById(LOCALE_SUGGESTION_STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = LOCALE_SUGGESTION_STYLE_ID
    style.textContent = LOCALE_SUGGESTION_CSS
    doc.head.appendChild(style)
  }
  // FIXED AT THE BOTTOM of the viewport, like a cookie bar: drawn after the
  // first paint, it moves nothing (no layout shift) and covers neither the
  // navbar nor a language bar. It takes no focus. While it is shown, an
  // element scrolled into view (a focused field) stops above it.
  doc.body.appendChild(box)
  place()
  view?.addEventListener('resize', place)
  return box
}

/**
 * How much of the viewport's bottom the app's own fixed or sticky elements
 * take (a tab bar, a sticky footer): the strip sits above them. Measured when
 * the strip is shown — after hydration — and again on a resize.
 */
export function bottomBarHeight(doc: Document, except: Element): number {
  const view = doc.defaultView
  if (!view) return 0
  const height = view.innerHeight
  let taken = 0
  for (const el of doc.body.querySelectorAll('*')) {
    if (el === except || except.contains(el)) continue
    const position = view.getComputedStyle(el).position
    if (position !== 'fixed' && position !== 'sticky') continue
    const rect = el.getBoundingClientRect()
    // Anchored at the bottom: it reaches the viewport's bottom edge and is no taller than half of it.
    if (rect.height <= 0 || rect.bottom < height - 1 || rect.height > height / 2) continue
    taken = Math.max(taken, height - rect.top)
  }
  return Math.max(0, Math.ceil(taken))
}

/** The id of the strip's stylesheet, written once. */
export const LOCALE_SUGGESTION_STYLE_ID = 'pw-locale-suggestion-css'

/**
 * The strip's look, from the app's theme tokens: its font, its card and text
 * colours, its border, radius and primary colour; the switch a filled button,
 * dismiss an outlined one, both with a visible focus ring; room for a notch
 * (safe area); a slide in only for a reader who does not ask for less motion.
 */
const LOCALE_SUGGESTION_CSS = [
  `[${LOCALE_SUGGESTION_ATTR}]{position:fixed;inset-inline:0;bottom:0;z-index:500;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.5rem .75rem;box-sizing:border-box;` +
    'padding:.5rem max(1rem,env(safe-area-inset-right)) max(.5rem,env(safe-area-inset-bottom)) max(1rem,env(safe-area-inset-left));' +
    'font-family:var(--pw-font-family,system-ui,sans-serif);font-size:var(--pw-font-size-sm,.875rem);line-height:1.4;' +
    'background:var(--pw-color-card,#f8fafc);color:var(--pw-color-text,#1e293b);border-top:1px solid var(--pw-color-border,#e2e8f0);box-shadow:0 -2px 8px rgb(0 0 0 / .08)}',
  `[${LOCALE_SUGGESTION_ATTR}] a,[${LOCALE_SUGGESTION_ATTR}] button{display:inline-flex;align-items:center;min-height:2rem;padding:.25rem .875rem;` +
    'border-radius:var(--pw-radius,.375rem);font:inherit;font-weight:600;line-height:1.2;text-decoration:none;cursor:pointer;' +
    'border:1px solid var(--pw-color-primary,#4f46e5)}',
  `[${LOCALE_SUGGESTION_ATTR}] a{background:var(--pw-color-primary,#4f46e5);color:var(--pw-color-text-on-primary,#fff)}`,
  `[${LOCALE_SUGGESTION_ATTR}] button{background:transparent;color:var(--pw-color-text,#1e293b);border-color:var(--pw-color-border,#e2e8f0)}`,
  `[${LOCALE_SUGGESTION_ATTR}] a:focus-visible,[${LOCALE_SUGGESTION_ATTR}] button:focus-visible{outline:2px solid var(--pw-color-primary,#4f46e5);outline-offset:2px}`,
  `@media (prefers-reduced-motion:no-preference){[${LOCALE_SUGGESTION_ATTR}]{animation:pw-locale-suggestion-in .2s ease-out}}`,
  '@keyframes pw-locale-suggestion-in{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:none}}',
].join('')
