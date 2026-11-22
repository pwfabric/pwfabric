/**
 * `pwf check --hydration`'s verdict on one page, driven through a stand-in
 * browser: a page that drew the not-found page where it was expected FAILS.
 */
import { describe, expect, it } from 'vitest'
import { checkPage, type Browser } from '../../commands/lib/hydration.js'

function browserShowing(shown: string, requested: string[], kept = false): Browser {
  return {
    newContext: async () => ({ route: async () => {}, close: async () => {}, newPage: async () => {
      const handlers: ((r: { url(): string }) => void)[] = []
      return {
        on: (event: string, handler: (x: never) => void) => {
          if (event === 'request') handlers.push(handler as unknown as (r: { url(): string }) => void)
        },
        route: async () => {},
        addInitScript: async () => {},
        goto: async () => {
          for (const url of requested) for (const h of handlers) h({ url: () => url })
        },
        waitForTimeout: async () => {},
        evaluate: async <T,>() => ({ layoutLeft: false, painted: 12, kept, hydrated: kept, gone: [], goneBlocks: [], shown }) as T,
        screenshot: async () => {},
        emulateMedia: async () => {},
        close: async () => {},
      }
    } }),
    close: async () => {},
  } as unknown as Browser
}

const page = { query: '', isRecord: false }

describe('a page the check expected, drawn as not-found', () => {
  it('fails when the not-found page replaced it (its receipt fetched)', async () => {
    const r = await checkPage(browserShowing('not-found', ['http://x/pwpack/surfaces/not-found.receipt.json']), 'http://x', 'menu', { ...page, notFoundKey: 'not-found' }, 390, '/#/menu')
    expect(r.skipped).toBeUndefined()
    expect(r.problems).toContain('the page drew the not-found page where menu was expected')
  })

  it('fails when the document shows the not-found page, with no receipt fetched', async () => {
    const r = await checkPage(browserShowing('not-found', []), 'http://x', 'menu', { ...page, notFoundKey: 'not-found' }, 390, '/#/menu')
    expect(r.problems).toContain('the page drew the not-found page where menu was expected')
  })

  it('judges by the page finally drawn: a not-found receipt fetched on the way to the right page is no failure', async () => {
    const r = await checkPage(browserShowing('menu', ['http://x/pwpack/surfaces/not-found.receipt.json', 'http://x/pwpack/surfaces/menu.receipt.json'], true), 'http://x', 'menu', { ...page, notFoundKey: 'not-found' }, 390, '/#/menu')
    expect(r.problems).toEqual([])
    expect(r.skipped).toBeUndefined()
  })

  it('passes the not-found page itself', async () => {
    const r = await checkPage(browserShowing('not-found', [], true), 'http://x', 'not-found', { ...page, notFoundKey: 'not-found' }, 390, '/pw-check-no-such-page')
    expect(r.problems).toEqual([])
  })
})
