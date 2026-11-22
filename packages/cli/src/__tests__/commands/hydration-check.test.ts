/**
 * `pwf check --hydration`, one page at a time (commands/lib/hydration.ts):
 * what a page's receipt says of it (`recordPageInfo`) and the verdict on what
 * the browser saw (`checkPage`), driven through a stand-in browser that
 * replays the console, page errors, requests and responses a real one would.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkPage, localPage, recordPageInfo, type Browser } from '../../commands/lib/hydration.js'
import { tempDir } from './helpers.js'

interface Seen {
  shown?: string | null
  layoutLeft?: boolean
  painted?: number
  kept?: boolean
  hydrated?: boolean
  gone?: string[]
  goneBlocks?: (string | null)[]
}

interface Script {
  readonly console?: string[]
  readonly errors?: string[]
  readonly requests?: string[]
  readonly responses?: string[]
  readonly seen?: Seen
}

/** A browser that replays `script` and records what the check set up. */
function browser(script: Script, log: string[] = []): Browser {
  return {
    newContext: async (options: { serviceWorkers: string }) => {
      log.push(`context ${options.serviceWorkers}`)
      return {
        route: async () => {
          log.push('context route')
        },
        routeWebSocket: async () => {
          log.push('context websocket')
        },
        close: async () => {
          log.push('context closed')
        },
        newPage: async () => {
          const on: Record<string, ((x: unknown) => void)[]> = {}
          return {
            on: (event: string, handler: (x: never) => void) => {
              ;(on[event] ??= []).push(handler as (x: unknown) => void)
            },
            route: async () => {
              log.push('page route records')
            },
            addInitScript: async () => {},
            goto: async (url: string) => {
              log.push(`goto ${url}`)
              for (const t of script.console ?? []) for (const h of on['console'] ?? []) h({ text: () => t })
              for (const m of script.errors ?? []) for (const h of on['pageerror'] ?? []) h(new Error(m))
              for (const u of script.requests ?? []) for (const h of on['request'] ?? []) h({ url: () => u })
              for (const u of script.responses ?? []) for (const h of on['response'] ?? []) h({ url: () => u })
            },
            waitForTimeout: async () => {},
            evaluate: async <T,>() =>
              ({ shown: null, layoutLeft: false, painted: 10, kept: true, hydrated: true, gone: [], goneBlocks: [], ...script.seen }) as T,
            screenshot: async () => {},
            emulateMedia: async () => {},
            close: async () => {},
          }
        },
      }
    },
    close: async () => {},
  } as unknown as Browser
}

const plain = { query: '', isRecord: false }
const record = { query: '?id=7', isRecord: true, hasFallbackId: true }

describe('checkPage', () => {
  it('passes a page that kept and hydrated its frame, in a guarded context it closes', async () => {
    const log: string[] = []
    expect(await checkPage(browser({}, log), 'http://127.0.0.1:1', 'home', plain, 390, '/')).toEqual({ problems: [] })
    expect(log).toEqual(['context block', 'context route', 'context websocket', 'page route records', 'goto http://127.0.0.1:1/', 'context closed'])
  })

  it('reports hydration messages and page errors, and ignores other console lines', async () => {
    const r = await checkPage(browser({ console: ['Minified React error #418', 'hello', 'Text content did not match'], errors: ['boom'] }), 'o', 'home', plain, 390, '/')
    expect(r.problems).toEqual(['hydration: Minified React error #418', 'hydration: Text content did not match', 'page error: boom'])
  })

  it('skips a page the runner drew before its frame arrived', async () => {
    expect(await checkPage(browser({ seen: { painted: 0 } }), 'o', 'home', plain, 390, '/')).toEqual({ skipped: 'the runner drew before the frame arrived', problems: [] })
  })

  it('names a leftover frame stylesheet, a replaced root, an unhydrated root and nodes drawn again', async () => {
    expect((await checkPage(browser({ seen: { layoutLeft: true } }), 'o', 'home', plain, 390, '/')).problems).toEqual([
      'the frame’s stylesheet (#pw-static-layout) is still in the document after the update',
    ])
    expect((await checkPage(browser({ seen: { kept: false } }), 'o', 'home', plain, 390, '/')).problems).toEqual(['the painted root was replaced'])
    expect((await checkPage(browser({ seen: { hydrated: false } }), 'o', 'home', plain, 390, '/')).problems).toEqual(['the painted root was not hydrated'])
    const gone = await checkPage(
      browser({ seen: { gone: ['p in text#a', 'p in text#a', 'span in badge#s'], goneBlocks: ['a', 'a', 'session'] } }),
      'o',
      'home',
      { ...plain, sessionBlocks: new Set(['session']) },
      390,
      '/'
    )
    // A block that reads a session source's loading state may draw again: not counted.
    expect(gone.problems).toEqual(['2 painted node(s) drawn again: p in text#a ×2'])
  })

  it('without a known not-found page, takes another page’s receipt fetched for not-found', async () => {
    const r = await checkPage(browser({ requests: ['o/pwpack/surfaces/other.receipt.json'], seen: { kept: false } }), 'o', 'home', plain, 390, '/')
    expect(r.problems).toEqual(['the page drew the not-found page where home was expected'])
    const own = await checkPage(browser({ requests: ['o/pwpack/surfaces/home.receipt.json'] }), 'o', 'home', plain, 390, '/')
    expect(own.problems).toEqual([])
  })

  describe('a record page', () => {
    it('passes when its record was asked for and arrived', async () => {
      const r = await checkPage(browser({ requests: ['o/_host/records/Dish/7'], responses: ['o/_host/records/Dish/7'] }), 'o', 'dish', record, 390, '/dish/')
      expect(r).toEqual({ problems: [] })
    })

    it('fails when the record was never asked for, or did not arrive', async () => {
      expect((await checkPage(browser({}), 'o', 'dish', record, 390, '/dish/')).problems).toEqual(['record page: the record was never requested'])
      expect((await checkPage(browser({ requests: ['o/_host/records/Dish/7'] }), 'o', 'dish', record, 390, '/dish/')).problems).toEqual([
        'record page: the record did not arrive within the check window',
      ])
    })

    it('keeps other problems first', async () => {
      expect((await checkPage(browser({ errors: ['x'] }), 'o', 'dish', record, 390, '/dish/')).problems).toEqual(['page error: x'])
    })

    it('judges not-found by whether it had a real id to open it with', async () => {
      const notFound = { requests: ['o/pwpack/surfaces/notfound.receipt.json'], seen: { kept: false } }
      expect((await checkPage(browser(notFound), 'o', 'dish', record, 390, '/dish/')).problems).toEqual([
        'record page showed not-found with a real id: the address did not reach the page state',
      ])
      const seeded = { ...record, hasFallbackId: false }
      expect((await checkPage(browser(notFound), 'o', 'dish', seeded, 390, '/dish/')).problems).toEqual(['record page: the source was never requested'])
      const asked = { ...notFound, requests: [...notFound.requests, 'o/_host/records/Dish/pw-check-seed'] }
      expect(await checkPage(browser(asked), 'o', 'dish', seeded, 390, '/dish/')).toEqual({ skipped: 'no record id to open it with: not-found expected', problems: [] })
    })
  })
})

describe('localPage', () => {
  it('guards a context that has no WebSocket routing (an older Playwright) with its routes alone', async () => {
    const log: string[] = []
    const b = {
      newContext: async () => ({
        route: async () => void log.push('route'),
        close: async () => void log.push('closed'),
        newPage: async () => ({}),
      }),
      close: async () => {},
    } as unknown as Browser
    const { done } = await localPage(b, { width: 390, height: 844 })
    await done()
    expect(log).toEqual(['route', 'closed'])
  })
})

describe('recordPageInfo', () => {
  async function built(receipts: Record<string, unknown>, content: Record<string, unknown> = {}): Promise<{ out: string; app: string }> {
    const root = await tempDir()
    const out = join(root, 'out')
    await mkdir(join(out, 'pwpack', 'surfaces'), { recursive: true })
    for (const [key, r] of Object.entries(receipts)) await writeFile(join(out, 'pwpack', 'surfaces', `${key}.receipt.json`), JSON.stringify(r))
    await mkdir(join(root, 'app', 'content'), { recursive: true })
    for (const [type, rows] of Object.entries(content)) await writeFile(join(root, 'app', 'content', `${type}.json`), JSON.stringify(rows))
    return { out, app: root }
  }
  const sources = (...dataSources: unknown[]) => ({ capabilities: [{ config: { dataSources } }, { config: {} }, 'x'], blocks: [] })

  it('is no record page without a receipt, or without a source that is not-found when empty', async () => {
    const { out, app } = await built({ home: sources({ id: 's', entityType: 'Dish' }) })
    expect(recordPageInfo(out, 'missing', app)).toEqual({ query: '', isRecord: false })
    expect(recordPageInfo(out, 'home', app)).toMatchObject({ query: '', isRecord: false })
  })

  it('opens it with the id of its fallback row', async () => {
    const { out } = await built({ dish: sources({ id: 'd', notFoundWhenEmpty: true, filter: { id: '{{state.id}}' }, fallback: [{ name: 'x' }, { id: 'f-1' }] }) })
    expect(recordPageInfo(out, 'dish', null)).toMatchObject({ query: '?id=f-1', isRecord: true, hasFallbackId: true })
  })

  it('else with the first id in the app’s content, a list or { data }', async () => {
    const { out, app } = await built(
      {
        dish: sources({ id: 'd', notFoundWhenEmpty: true, entityType: 'Dish', filter: { id: '{{state.dishId}}' } }),
        order: sources({ id: 'o', notFoundWhenEmpty: true, entityType: 'Order', filter: { id: '{{state.orderId}}' } }),
      },
      { Dish: [{ name: 'no id' }, { id: 'c-9' }], Order: { data: [{ id: 'o-3' }] } }
    )
    expect(recordPageInfo(out, 'dish', app)).toMatchObject({ query: '?dishId=c-9', hasFallbackId: true })
    expect(recordPageInfo(out, 'order', app)).toMatchObject({ query: '?orderId=o-3', hasFallbackId: true })
  })

  it('seeds a stand-in id when nothing gives one, and fills each state key once', async () => {
    const { out, app } = await built({
      dish: sources(
        { id: 'a', notFoundWhenEmpty: true, entityType: 'Nothing', filter: { id: '{{state.id}}' } },
        { id: 'b', notFoundWhenEmpty: true, filter: { id: '{{state.id}}', other: '{{state.tab}}' } }
      ),
    })
    expect(recordPageInfo(out, 'dish', app)).toMatchObject({ query: '?id=pw-check-seed&tab=pw-check-seed', isRecord: true, hasFallbackId: false })
    expect(recordPageInfo(out, 'dish', null)).toMatchObject({ hasFallbackId: false })
  })

  it('names the blocks that read a session source’s loading or error state, and those inside them', async () => {
    const { out } = await built({
      account: {
        capabilities: [{ config: { dataSources: [{ id: 'me-1', requiresSession: true }, { id: 'open' }] } }],
        blocks: [
          { id: 'card', type: 'card', props: { hidden: '{{__loading.me1}}' }, children: [{ id: 'inner', type: 'text' }] },
          { id: 'other', type: 'text', props: { text: 'x' } },
          'not a block',
        ],
      },
    })
    expect([...(recordPageInfo(out, 'account', null).sessionBlocks ?? [])].sort()).toEqual(['card', 'inner'])
  })
})
