/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { localeStorageKey, mountLocaleSuggestion, preferredLocale } from './locale-suggestion.js'

afterEach(() => {
  document.body.replaceChildren()
})

const WORDS: Record<string, Record<string, string>> = {
  en: { 'locale.suggestion': 'This page is in {language}', 'locale.switch': 'Switch', 'locale.dismiss': 'No thanks' },
  de: { 'locale.suggestion': 'Diese Seite gibt es auf {language}', 'locale.switch': 'Wechseln', 'locale.dismiss': 'Nein danke' },
}

function storage(initial?: string) {
  const items = new Map<string, string>(initial ? [[localeStorageKey('cafe'), initial]] : [])
  return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) }
}

const offer = (languages: string[], store = storage()) =>
  mountLocaleSuggestion({
    appId: 'cafe',
    drawn: 'en',
    locales: ['en', 'de'],
    languages,
    storage: store,
    doc: document,
    hrefOf: (lang) => (lang === 'de' ? '/de/preise/' : '/pricing/'),
    wordsOf: async (lang) => WORDS[lang] ?? {},
  })

describe('the locale the visitor prefers (envelope §2.3)', () => {
  it('matches a declared tag, else its language', () => {
    expect(preferredLocale(['de-AT', 'en'], ['en', 'de'])).toBe('de')
    expect(preferredLocale(['fr', 'EN-gb'], ['en-GB', 'de'])).toBe('en-GB')
    expect(preferredLocale(['fr'], ['en', 'de'])).toBeUndefined()
  })

  it("offers it in its own words, links to the page in it, and keeps the visitor's answer", async () => {
    const store = storage()
    const box = await offer(['de-DE', 'en'], store)
    expect(box?.textContent).toContain('Diese Seite gibt es auf Deutsch')
    const link = box?.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/de/preise/')
    link?.addEventListener('click', (e) => e.preventDefault())
    link?.click()
    expect(JSON.parse(store.items.get('pwapp_locale:cafe') ?? '{}')).toEqual({ locale: 'de' })
    expect(document.querySelector('[data-pw-locale-suggestion]')).toBeNull()
  })

  it('keeps a dismissal, and offers nothing once an answer is stored', async () => {
    const store = storage()
    const box = await offer(['de'], store)
    box?.querySelector('button')?.click()
    expect(JSON.parse(store.items.get('pwapp_locale:cafe') ?? '{}')).toEqual({ dismissed: true })
    expect(await offer(['de'], store)).toBeNull()
    expect(await offer(['de'], storage('{"locale":"en"}'))).toBeNull()
  })

  it('offers nothing for the locale drawn, nor without its words', async () => {
    expect(await offer(['en-US'])).toBeNull()
    const none = await mountLocaleSuggestion({
      appId: 'cafe', drawn: 'en', locales: ['en', 'de'], languages: ['de'], storage: storage(), doc: document,
      hrefOf: () => '/de/', wordsOf: async () => ({}),
    })
    expect(none).toBeNull()
  })
})

describe('the suggestion strip', () => {
  it('sits in the flow at the top of the document, named by its sentence, styled once from the theme', async () => {
    const page = document.createElement('div')
    page.id = 'root'
    document.body.appendChild(page)
    const box = await offer(['de'])
    expect(document.body.firstElementChild).toBe(box)
    expect(box?.getAttribute('style')).toBeNull()
    expect(box?.getAttribute('role')).toBe('region')
    expect(box?.getAttribute('aria-label')).toBe('Diese Seite gibt es auf Deutsch')
    const css = document.getElementById('pw-locale-suggestion-css')?.textContent ?? ''
    expect(css).not.toMatch(/position:\s*fixed/)
    expect(css).toContain('var(--pw-color-primary')
    expect(css).toContain('safe-area-inset-top')
    expect(css).toContain('prefers-reduced-motion:no-preference')
    expect(css).toContain(':focus-visible')
    box?.remove()
    await offer(['de'])
    expect(document.querySelectorAll('#pw-locale-suggestion-css')).toHaveLength(1)
  })

  it('is dismissed by its button and by Escape', async () => {
    const store = storage()
    const box = await offer(['de'], store)
    box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector('[data-pw-locale-suggestion]')).toBeNull()
    expect(JSON.parse(store.items.get('pwapp_locale:cafe') ?? '{}')).toEqual({ dismissed: true })
  })
})
