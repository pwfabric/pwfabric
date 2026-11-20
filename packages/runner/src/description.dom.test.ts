/**
 * @vitest-environment jsdom
 *
 * Every page carries a `<meta name="description">`: its own, else the app's.
 * The shell had none, so search results and link previews had nothing to say.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { applyCanonical, applyDescription, canonicalOf, descriptionOf, publicOriginOf } from './description.js'

const meta = (): HTMLMetaElement | null => document.head.querySelector('meta[name="description"]')

afterEach(() => meta()?.remove())

describe('descriptionOf', () => {
  it('is the page’s own, else the app’s, else none', () => {
    expect(descriptionOf('The menu.', 'A café.')).toBe('The menu.')
    expect(descriptionOf(undefined, 'A café.')).toBe('A café.')
    expect(descriptionOf('  ', undefined)).toBeUndefined()
  })

  it('never shows a template: an expression falls back to the app’s', () => {
    expect(descriptionOf('{{dish.0.name}} at the café', 'A café.')).toBe('A café.')
    expect(descriptionOf('{{x}}', undefined)).toBeUndefined()
  })
})

describe('applyDescription', () => {
  it('writes the element, updates it per page, and removes it when nothing applies', () => {
    applyDescription(document, 'The menu.', 'A café.')
    expect(meta()?.content).toBe('The menu.')
    applyDescription(document, undefined, 'A café.')
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(meta()?.content).toBe('A café.')
    applyDescription(document, undefined, undefined)
    expect(meta()).toBeNull()
  })
})

describe('the canonical address (envelope §4)', () => {
  const link = (): HTMLLinkElement | null => document.head.querySelector('link[rel="canonical"]')
  afterEach(() => link()?.remove())

  it('is the app’s public origin with the page’s path; none without an http(s) origin', () => {
    expect(canonicalOf('https://example.com', '/pricing/')).toBe('https://example.com/pricing/')
    expect(canonicalOf('https://example.com/', '/')).toBe('https://example.com/')
    expect(canonicalOf('https://example.com:8443', '/shop/a/')).toBe('https://example.com:8443/shop/a/')
    expect(canonicalOf(undefined, '/pricing/')).toBeUndefined()
    expect(canonicalOf('ftp://example.com', '/')).toBeUndefined()
    expect(canonicalOf('not a url', '/')).toBeUndefined()
    expect(publicOriginOf(' https://Example.com ')).toBe('https://example.com')
  })

  it('writes the link, keeps one per document, and removes it for a page with none', () => {
    applyCanonical(document, 'https://example.com/')
    applyCanonical(document, 'https://example.com/pricing/')
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(link()?.getAttribute('href')).toBe('https://example.com/pricing/')
    applyCanonical(document, undefined)
    expect(link()).toBeNull()
  })
})
