import { describe, expect, it } from 'vitest'
import { addressedPage, addressTable, catalogueFor, isTableAddress, localePrefix, localesOf, localesProblems, missingCatalogueIds } from '../app-locales.js'

const DECL = { locales: ['en', 'de', 'pt-BR'], defaultLocale: 'en' }

describe('localesProblems (APP_LOCALES_INVALID)', () => {
  it('finds nothing in a single-language plan and in a coherent one', () => {
    expect(localesProblems({ title: 'x', locale: 'en' })).toEqual([])
    expect(localesProblems({ locales: ['en', 'de'], defaultLocale: 'en', locale: 'en' })).toEqual([])
  })

  it('refuses a missing or undeclared default, one prefix twice, flat messages, a locale other than the default', () => {
    expect(localesProblems({ locales: ['en'] }).join()).toMatch(/defaultLocale/)
    expect(localesProblems({ locales: ['en'], defaultLocale: 'de' }).join()).toMatch(/not one of locales/)
    expect(localesProblems({ locales: ['pt-BR', 'pt-br'], defaultLocale: 'pt-BR' }).join()).toMatch(/same address prefix/)
    expect(localesProblems({ locales: ['en'], defaultLocale: 'en', messages: {} }).join()).toMatch(/flat messages/)
    expect(localesProblems({ locales: ['en', 'de'], defaultLocale: 'en', locale: 'de' }).join()).toMatch(/not defaultLocale/)
    expect(localesProblems({ defaultLocale: 'en' }).join()).toMatch(/locales lists/)
  })

  it('reads a declaration only when it can be built', () => {
    expect(localesOf({ locales: ['en', 'de'], defaultLocale: 'en' })).toEqual({ locales: ['en', 'de'], defaultLocale: 'en' })
    expect(localesOf({ locales: ['en'], defaultLocale: 'de' })).toBeUndefined()
    expect(localesOf({ locale: 'en' })).toBeUndefined()
  })
})

describe('addressTable (envelope §2.3)', () => {
  const paths: Record<string, Record<string, string>> = { pricing: { de: 'preise' }, 'docs/intro': { de: 'docs/einfuehrung' } }
  const table = addressTable(DECL, ['home', 'pricing', 'docs/intro'], 'home', (k) => paths[k])

  it('puts the entry at each root, other pages at their segment path under the prefix', () => {
    expect(table.problems).toEqual([])
    expect(table.addresses).toEqual({
      en: { home: '', pricing: 'pricing/', 'docs/intro': 'docs/intro/' },
      de: { home: 'de/', pricing: 'de/preise/', 'docs/intro': 'de/docs/einfuehrung/' },
      'pt-BR': { home: 'pt-br/', pricing: 'pt-br/pricing/', 'docs/intro': 'pt-br/docs/intro/' },
    })
    expect(localePrefix('pt-BR')).toBe('pt-br/')
  })

  it('reports each broken rule', () => {
    const problems = (keys: string[], p: Record<string, Record<string, string>>): string =>
      addressTable({ locales: ['en', 'de'], defaultLocale: 'en' }, keys, 'home', (k) => p[k]).problems.join('\n')
    expect(problems(['home', 'pricing'], { home: { de: 'pricing' } })).toMatch(/entry page/)
    expect(problems(['home', 'a', 'b'], { a: { de: 'b' } })).toMatch(/key of another page/)
    expect(problems(['home', 'a', 'b'], { a: { de: 'x' }, b: { de: 'x' } })).toMatch(/share the address "de\/x\/"/)
    expect(problems(['home', 'de-help'], {})).toBe('')
    expect(problems(['home', 'de/help'], {})).toMatch(/starts with a locale prefix/)
    expect(problems(['home', 'a'], { a: { de: 'de/x' } })).toMatch(/starts with a locale prefix/)
    expect(problems(['home', 'a'], { a: { fr: 'x' } })).toMatch(/not one of locales/)
    expect(problems(['home', 'home.de'], {})).toMatch(/per-locale receipt/)
  })
})

describe('addressedPage (envelope §3)', () => {
  const { addresses } = addressTable(DECL, ['home', 'pricing'], 'home', (k) => (k === 'pricing' ? { de: 'preise' } : undefined))

  it('selects the locale by the first segment and the page by that locale\'s row', () => {
    expect(addressedPage(addresses, DECL, '')).toEqual({ locale: 'en', key: 'home' })
    expect(addressedPage(addresses, DECL, 'pricing/')).toEqual({ locale: 'en', key: 'pricing' })
    expect(addressedPage(addresses, DECL, '/de/preise')).toEqual({ locale: 'de', key: 'pricing' })
    expect(addressedPage(addresses, DECL, 'de')).toEqual({ locale: 'de', key: 'home' })
    expect(addressedPage(addresses, DECL, 'PT-BR/')).toEqual({ locale: 'pt-BR', key: null })
    expect(addressedPage(addresses, DECL, 'de/pricing')).toEqual({ locale: 'de', key: null })
    expect(addressedPage(addresses, DECL, 'nothing')).toEqual({ locale: 'en', key: null })
    expect(isTableAddress(addresses, '/de/preise/')).toBe(true)
    expect(isTableAddress(addresses, '/de/pricing/')).toBe(false)
  })
})

describe('catalogues', () => {
  it("reads the drawn locale's words over the default's, and names the ids it lacks", () => {
    const catalogues = { en: { a: 'A', b: 'B' }, de: { a: 'Ä' } }
    expect(catalogueFor(catalogues, DECL, 'de')).toEqual({ a: 'Ä', b: 'B' })
    expect(missingCatalogueIds(catalogues.en, catalogues.de)).toEqual(['b'])
  })

  it("reads an empty word as untranslated: the default locale's word stands", () => {
    const catalogues = { en: { a: 'A', b: 'B' }, de: { a: '', b: 'Bé' } }
    expect(catalogueFor(catalogues, DECL, 'de')).toEqual({ a: 'A', b: 'Bé' })
    expect(missingCatalogueIds(catalogues.en, catalogues.de)).toEqual(['a'])
  })
})
