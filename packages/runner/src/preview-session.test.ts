/**
 * What the runner does with a bridge message: re-render the page on screen
 * through the handle it kept — no fetch — and only the page the update names.
 *
 * @module @pwfabric/runner/preview-session.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PREVIEW_MESSAGE, type PreviewBridgeWindow, type PreviewMessageEvent } from './preview-bridge.js'
import {
  receiptSurfaceId,
  startPreviewSession,
  updateTargets,
  type PreviewPage,
  type PreviewSessionDeps,
} from './preview-session.js'
import { projectAppearanceRef } from './run-app.js'
import { THEME_PRESETS } from './theme-presets.js'

const STUDIO = 'https://studio.example.com'

function harness(overrides: Partial<PreviewSessionDeps> = {}) {
  const listeners = new Set<(e: PreviewMessageEvent) => void>()
  const posted: { message: { nonce: string; pageKey: string }; targetOrigin: string }[] = []
  const parent = {
    postMessage: (message: unknown, targetOrigin: string) =>
      void posted.push({ message: message as (typeof posted)[number]['message'], targetOrigin }),
  }
  const win = {
    parent,
    addEventListener: vi.fn((_t: 'message', l: (e: PreviewMessageEvent) => void) => void listeners.add(l)),
    removeEventListener: vi.fn((_t: 'message', l: (e: PreviewMessageEvent) => void) => void listeners.delete(l)),
  }
  const current = { seq: 1, key: 'home' }
  const deps: PreviewSessionDeps = {
    win: win as unknown as PreviewBridgeWindow,
    crypto: globalThis.crypto,
    isCurrent: (page) => page.seq === current.seq && page.key === current.key,
    prepare: vi.fn((s) => ({ blocks: s.blocks, capabilities: s.capabilities ?? [] })),
    applyTheme: vi.fn((t: Record<string, unknown>) => projectAppearanceRef(t)),
    remount: vi.fn(() => ({ update: vi.fn() })),
    ...overrides,
  }
  const send = (data: Record<string, unknown>): void => {
    for (const l of [...listeners]) l({ origin: STUDIO, source: parent, data })
  }
  return { win, deps, posted, send, current, listeners }
}

function page(over: Partial<PreviewPage> = {}): PreviewPage {
  return {
    seq: 1,
    key: 'home',
    surface: { blocks: [{ type: 'heading', props: { text: 'Old' } }], capabilities: [] },
    options: { mode: 'fat', blocks: [{ blockType: 'heading' }], appearance: { config: { theme: {} } } },
    handle: Promise.resolve({ update: vi.fn(), unmount: vi.fn() }),
    ...over,
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

let fetchSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error('the bridge must not fetch')))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** Start, render one page, complete the handshake. */
function started(over: Partial<PreviewSessionDeps> = {}, p: PreviewPage = page()) {
  const h = harness(over)
  const session = startPreviewSession({ allowedOrigins: [STUDIO] }, h.deps)!
  session.rendered(p)
  const nonce = h.posted[0]!.message.nonce
  h.send({ type: PREVIEW_MESSAGE.hello, nonce })
  return { ...h, session, nonce, page: p }
}

describe('startPreviewSession', () => {
  it('is null and adds no listener when the option is absent', () => {
    const h = harness()
    expect(startPreviewSession(undefined, h.deps)).toBeNull()
    expect(h.win.addEventListener).not.toHaveBeenCalled()
  })

  it('announces every route render with its page key', () => {
    const h = harness()
    const session = startPreviewSession({ allowedOrigins: [STUDIO] }, h.deps)!
    session.rendered(page())
    session.rendered(page({ seq: 2, key: 'pricing' }))
    expect(h.posted.map((p) => p.message.pageKey)).toEqual(['home', 'pricing'])
    expect(new Set(h.posted.map((p) => p.message.nonce)).size).toBe(1)
  })
})

describe('surface update', () => {
  it('re-renders through the kept handle without any fetch', async () => {
    const handle = { update: vi.fn(), unmount: vi.fn() }
    const { send, nonce, deps } = started({}, page({ handle: Promise.resolve(handle) }))
    const blocks = [{ type: 'heading', props: { text: 'New' } }]
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: { blocks } })
    await flush()

    expect(deps.prepare).toHaveBeenCalledWith({ blocks })
    expect(handle.update).toHaveBeenCalledTimes(1)
    const arg = handle.update.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.surface).toEqual({ blocks, capabilities: [] })
    // The route's fat options travel unchanged, minus `mode`, plus the placeholder switch.
    expect(arg.blocks).toEqual([{ blockType: 'heading' }])
    expect(arg.appearance).toEqual({ config: { theme: {} } })
    expect(arg.placeholderMissingBlocks).toBe(true)
    expect('mode' in arg).toBe(false)
    expect(handle.unmount).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('applies successive updates in order on the same handle', async () => {
    const handle = { update: vi.fn() }
    const { send, nonce } = started({}, page({ handle: handle }))
    for (const text of ['a', 'b', 'c']) {
      send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: { blocks: [{ type: 't', props: { text } }] } })
    }
    await flush()
    await flush()
    expect(handle.update.mock.calls.map((c) => (c[0] as { surface: { blocks: { props: { text: string } }[] } }).surface.blocks[0]!.props.text)).toEqual(['a', 'b', 'c'])
  })

  it('touches only the page it names', async () => {
    const handle = { update: vi.fn() }
    const { send, nonce } = started({}, page({ handle, surfaceId: 'srf_home' }))
    const surface = { blocks: [] }
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'pricing', surface })
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, surfaceId: 'srf_other', surface })
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surfaceId: 'srf_other', surface })
    // Naming no page at all is not "this page".
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, surface })
    await flush()
    expect(handle.update).not.toHaveBeenCalled()
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, surfaceId: 'srf_home', surface })
    await flush()
    expect(handle.update).toHaveBeenCalledTimes(1)
  })

  it('drops an update once a newer route has started or the page was cleared', async () => {
    const handle = { update: vi.fn() }
    const { send, nonce, current, session } = started({}, page({ handle }))
    current.seq = 2 // a route render is in flight
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: { blocks: [] } })
    await flush()
    current.seq = 1
    session.cleared()
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: { blocks: [] } })
    await flush()
    expect(handle.update).not.toHaveBeenCalled()
  })

  it('remounts in place (still no fetch) when the embed handle has no update', async () => {
    const old = { unmount: vi.fn() }
    const { send, nonce, deps } = started({}, page({ handle: old }))
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: { blocks: [] } })
    await flush()
    expect(old.unmount).toHaveBeenCalled()
    expect(deps.remount).toHaveBeenCalledWith(
      { blocks: [], capabilities: [] },
      expect.objectContaining({ mode: 'fat', placeholderMissingBlocks: true })
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('project theme', () => {
  it('renders with the ref the normal appearance path resolves, not the raw theme', async () => {
    const handle = { update: vi.fn() }
    const { send, nonce, deps, page: p } = started({}, page({ handle }))
    send({ type: PREVIEW_MESSAGE.projectTheme, nonce, theme: { use: 'theme-zinc', theme: { colors: { primary: '#111111' } } } })
    await flush()

    expect(deps.applyTheme).toHaveBeenCalledWith({ use: 'theme-zinc', theme: { colors: { primary: '#111111' } } })
    const arg = handle.update.mock.calls[0]![0] as { appearance: { config: { theme: Record<string, Record<string, unknown>> } }; surface: unknown }
    const expected = projectAppearanceRef({ use: 'theme-zinc', theme: { colors: { primary: '#111111' } } })
    expect(arg.appearance).toEqual(expected)
    // The preset is the base, the pushed colour wins over it — token data, no CSS.
    const zinc = THEME_PRESETS['theme-zinc'] as { colors: Record<string, unknown> }
    expect(arg.appearance.config.theme.colors!.secondary).toBe(zinc.colors.secondary)
    expect(arg.appearance.config.theme.colors!.primary).toBe('#111111')
    expect('use' in arg.appearance.config).toBe(false)
    // The page itself is unchanged.
    expect(arg.surface).toBe(p.surface)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does nothing when the theme resolves to nothing', async () => {
    const handle = { update: vi.fn() }
    const { send, nonce } = started({ applyTheme: vi.fn(() => undefined) }, page({ handle }))
    send({ type: PREVIEW_MESSAGE.projectTheme, nonce, theme: { use: 'no-such-theme' } })
    await flush()
    expect(handle.update).not.toHaveBeenCalled()
  })

  it('keeps the new theme for later surface updates', async () => {
    const handle = { update: vi.fn() }
    const { send, nonce } = started({}, page({ handle }))
    send({ type: PREVIEW_MESSAGE.projectTheme, nonce, theme: { use: 'theme-forest' } })
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: { blocks: [] } })
    await flush()
    await flush()
    const last = handle.update.mock.calls.at(-1)![0] as { appearance: unknown }
    expect(last.appearance).toEqual(projectAppearanceRef({ use: 'theme-forest' }))
  })
})

describe('helpers', () => {
  it('updateTargets requires a name and no mismatch', () => {
    const p = page({ surfaceId: 's1' })
    expect(updateTargets({}, p)).toBe(false)
    expect(updateTargets({ pageKey: 'home' }, p)).toBe(true)
    expect(updateTargets({ surfaceId: 's1' }, p)).toBe(true)
    expect(updateTargets({ pageKey: 'home', surfaceId: 's2' }, p)).toBe(false)
    expect(updateTargets({ surfaceId: 's1' }, page())).toBe(false)
  })

  it('receiptSurfaceId reads surfaceId, then id', () => {
    expect(receiptSurfaceId({ surfaceId: 'a', id: 'b' })).toBe('a')
    expect(receiptSurfaceId({ id: 'b' })).toBe('b')
    expect(receiptSurfaceId({ id: 3 })).toBeUndefined()
  })
})
