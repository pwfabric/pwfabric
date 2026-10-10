/**
 * The preview bridge's boundary: exact origin, the framing parent only, the
 * nonce handshake, payload validation, and silence on every refusal.
 *
 * @module @pwfabric/runner/preview-bridge.test
 */

import { describe, it, expect, vi } from 'vitest'
import {
  MAX_PREVIEW_MESSAGE_BYTES,
  PREVIEW_MESSAGE,
  createNonce,
  createPreviewBridge,
  normalizeAllowedOrigins,
  serializedBytes,
  type PreviewBridgeHandlers,
  type PreviewBridgeWindow,
  type PreviewMessageEvent,
} from './preview-bridge.js'

const STUDIO = 'https://studio.example.com'
const OTHER = 'https://other.example.com'

interface Posted {
  readonly message: { type: string; nonce: string; pageKey?: string }
  readonly targetOrigin: string
}

function fakeWindow(opts: { framed?: boolean } = {}) {
  const listeners = new Set<(e: PreviewMessageEvent) => void>()
  const posted: Posted[] = []
  const parent = {
    postMessage: (message: unknown, targetOrigin: string) => {
      posted.push({ message: message as Posted['message'], targetOrigin })
    },
  }
  const win = {
    parent: parent as PreviewBridgeWindow['parent'],
    addEventListener: vi.fn((_t: 'message', l: (e: PreviewMessageEvent) => void) => void listeners.add(l)),
    removeEventListener: vi.fn((_t: 'message', l: (e: PreviewMessageEvent) => void) => void listeners.delete(l)),
  }
  if (opts.framed === false) (win as { parent: unknown }).parent = win
  const send = (data: unknown, from: { origin?: string; source?: unknown } = {}): void => {
    const event = { origin: from.origin ?? STUDIO, source: 'source' in from ? from.source : parent, data }
    for (const l of [...listeners]) l(event)
  }
  return { win: win as PreviewBridgeWindow & typeof win, parent, posted, send, listeners }
}

function handlers() {
  return {
    onSurfaceUpdate: vi.fn(),
    onProjectTheme: vi.fn(),
  } satisfies PreviewBridgeHandlers
}

const crypto = globalThis.crypto

/** A bridge with the handshake completed; returns the nonce. */
function connected(allowedOrigins: string[] = [STUDIO]) {
  const w = fakeWindow()
  const h = handlers()
  const bridge = createPreviewBridge({ allowedOrigins }, h, { win: w.win, crypto })!
  bridge.announce('home')
  const nonce = w.posted[0]!.message.nonce
  w.send({ type: PREVIEW_MESSAGE.hello, nonce })
  return { ...w, h, bridge, nonce }
}

const goodSurface = { blocks: [{ id: 'h', type: 'heading', props: { text: 'Hi' } }] }

describe('off by default', () => {
  it('adds no listener when no origin survives normalisation', () => {
    for (const allowedOrigins of [[], ['*'], ['null'], [`${STUDIO}/`], ['studio.example.com']]) {
      const w = fakeWindow()
      expect(createPreviewBridge({ allowedOrigins }, handlers(), { win: w.win, crypto })).toBeNull()
      expect(w.win.addEventListener).not.toHaveBeenCalled()
    }
  })

  it('adds no listener when the page is not framed', () => {
    const w = fakeWindow({ framed: false })
    expect(createPreviewBridge({ allowedOrigins: [STUDIO] }, handlers(), { win: w.win, crypto })).toBeNull()
    expect(w.win.addEventListener).not.toHaveBeenCalled()
  })

  it('removes its listener on dispose', () => {
    const { win, listeners, bridge } = connected()
    expect(listeners.size).toBe(1)
    bridge.dispose()
    expect(win.removeEventListener).toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
})

describe('normalizeAllowedOrigins', () => {
  it('keeps canonical http(s) origins only, deduplicated', () => {
    expect(
      normalizeAllowedOrigins([STUDIO, STUDIO, 'http://localhost:3000', '*', `${STUDIO}/x`, 'ftp://a.example', 7, ''])
    ).toEqual([STUDIO, 'http://localhost:3000'])
    expect(normalizeAllowedOrigins('https://studio.example.com')).toEqual([])
  })
})

describe('nonce', () => {
  it('is 256 random bits from getRandomValues, fresh per bridge', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues')
    const a = createNonce(crypto)
    expect(spy).toHaveBeenCalledWith(expect.any(Uint8Array))
    expect((spy.mock.calls[0]![0] as Uint8Array).length).toBeGreaterThanOrEqual(16)
    spy.mockRestore()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(createNonce(crypto)).not.toBe(a)
  })
})

describe('handshake', () => {
  it('posts ready once per allowed origin, each with that origin as the explicit target', () => {
    const w = fakeWindow()
    const bridge = createPreviewBridge({ allowedOrigins: [STUDIO, OTHER] }, handlers(), { win: w.win, crypto })!
    bridge.announce('pricing')
    expect(w.posted.map((p) => p.targetOrigin)).toEqual([STUDIO, OTHER])
    expect(w.posted.every((p) => p.targetOrigin !== '*')).toBe(true)
    const [first, second] = w.posted
    expect(first!.message).toEqual({ type: PREVIEW_MESSAGE.ready, nonce: expect.any(String), pageKey: 'pricing' })
    // One nonce per page load, whichever origin it went to.
    expect(second!.message.nonce).toBe(first!.message.nonce)
  })

  it('ignores updates before the hello, even with the right nonce', () => {
    const w = fakeWindow()
    const h = handlers()
    const bridge = createPreviewBridge({ allowedOrigins: [STUDIO] }, h, { win: w.win, crypto })!
    bridge.announce('home')
    const nonce = w.posted[0]!.message.nonce
    w.send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: goodSurface })
    expect(h.onSurfaceUpdate).not.toHaveBeenCalled()
    expect(bridge.connectedOrigin).toBeNull()
  })

  it('completes on a hello carrying the nonce, and then accepts updates', () => {
    const { send, h, nonce, bridge } = connected()
    expect(bridge.connectedOrigin).toBe(STUDIO)
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: goodSurface })
    expect(h.onSurfaceUpdate).toHaveBeenCalledWith({ pageKey: 'home', surface: goodSurface })
  })

  it('refuses a hello with a wrong or missing nonce', () => {
    const w = fakeWindow()
    const bridge = createPreviewBridge({ allowedOrigins: [STUDIO] }, handlers(), { win: w.win, crypto })!
    bridge.announce('home')
    w.send({ type: PREVIEW_MESSAGE.hello, nonce: 'guess' })
    w.send({ type: PREVIEW_MESSAGE.hello })
    expect(bridge.connectedOrigin).toBeNull()
  })

  it('refuses a correct hello from a look-alike origin or a non-parent source', () => {
    const w = fakeWindow()
    const bridge = createPreviewBridge({ allowedOrigins: [STUDIO] }, handlers(), { win: w.win, crypto })!
    bridge.announce('home')
    const nonce = w.posted[0]!.message.nonce
    w.send({ type: PREVIEW_MESSAGE.hello, nonce }, { origin: `${STUDIO}.evil.example` })
    w.send({ type: PREVIEW_MESSAGE.hello, nonce }, { origin: 'https://evil.example' })
    w.send({ type: PREVIEW_MESSAGE.hello, nonce }, { source: {} })
    expect(bridge.connectedOrigin).toBeNull()
  })

  it('after the hello, listens only to the origin that answered', () => {
    const { send, h, nonce } = connected([STUDIO, OTHER])
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: goodSurface }, { origin: OTHER })
    expect(h.onSurfaceUpdate).not.toHaveBeenCalled()
  })
})

describe('refusals are silent', () => {
  it('drops a message from an origin that is not allowed — no suffix or prefix match', () => {
    const { send, h, nonce, posted } = connected()
    for (const origin of [
      'https://evil.example',
      `${STUDIO}.evil.example`,
      'https://x.studio.example.com',
      'http://studio.example.com',
      `${STUDIO}:443`,
      'null',
    ]) {
      send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: goodSurface }, { origin })
    }
    expect(h.onSurfaceUpdate).not.toHaveBeenCalled()
    // Nothing echoed back: the only posts are the ready announcement.
    expect(posted.every((p) => p.message.type === PREVIEW_MESSAGE.ready)).toBe(true)
  })

  it('drops a message whose source is not the framing parent', () => {
    const { send, h, nonce } = connected()
    for (const source of [null, {}, undefined]) {
      send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: goodSurface }, { source })
    }
    expect(h.onSurfaceUpdate).not.toHaveBeenCalled()
  })

  it('drops a message with a missing or wrong nonce', () => {
    const { send, h, nonce } = connected()
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, pageKey: 'home', surface: goodSurface })
    send({ type: PREVIEW_MESSAGE.surfaceUpdate, nonce: nonce.toUpperCase(), pageKey: 'home', surface: goodSurface })
    send({ type: PREVIEW_MESSAGE.projectTheme, nonce: 'x', theme: { use: 'zinc' } })
    expect(h.onSurfaceUpdate).not.toHaveBeenCalled()
    expect(h.onProjectTheme).not.toHaveBeenCalled()
  })

  it('drops a malformed payload', () => {
    const { send, h, nonce } = connected()
    const bad: unknown[] = [
      null,
      'a string',
      [1, 2],
      { nonce },
      { type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home' },
      { type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: { blocks: 'nope' } },
      { type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: { blocks: [{ props: {} }] } },
      { type: PREVIEW_MESSAGE.surfaceUpdate, nonce, pageKey: 'home', surface: { blocks: [{ type: '' }] } },
      {
        type: PREVIEW_MESSAGE.surfaceUpdate,
        nonce,
        pageKey: 'home',
        surface: { blocks: [], appearance: { config: { styleVariables: { gap: 4 } } } },
      },
      { type: PREVIEW_MESSAGE.projectTheme, nonce, theme: 'zinc' },
      { type: PREVIEW_MESSAGE.projectTheme, nonce, theme: { mode: { policy: 'neon' } } },
      { type: PREVIEW_MESSAGE.projectTheme, nonce, theme: { keyframes: { spin: { from: 1 } } } },
    ]
    for (const data of bad) send(data)
    expect(h.onSurfaceUpdate).not.toHaveBeenCalled()
    expect(h.onProjectTheme).not.toHaveBeenCalled()
  })

  it('drops a payload over the size cap', () => {
    const { send, h, nonce } = connected()
    const huge = 'x'.repeat(MAX_PREVIEW_MESSAGE_BYTES)
    send({
      type: PREVIEW_MESSAGE.surfaceUpdate,
      nonce,
      pageKey: 'home',
      surface: { blocks: [{ type: 'text', props: { text: huge } }] },
    })
    expect(h.onSurfaceUpdate).not.toHaveBeenCalled()
    // Multi-byte text is measured in bytes, not characters.
    expect(serializedBytes({ t: 'ğ'.repeat(10) })).toBeGreaterThan(JSON.stringify({ t: 'ğ'.repeat(10) }).length)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(serializedBytes(cyclic)).toBe(Infinity)
  })

  it('drops an unknown type', () => {
    const { send, h, nonce } = connected()
    send({ type: 'pw:eval', nonce, code: 'alert(1)' })
    send({ type: PREVIEW_MESSAGE.ready, nonce, pageKey: 'home' })
    expect(h.onSurfaceUpdate).not.toHaveBeenCalled()
    expect(h.onProjectTheme).not.toHaveBeenCalled()
  })
})

describe('accepted messages', () => {
  it('passes a theme in each form appearance.json takes', () => {
    const { send, h, nonce } = connected()
    send({ type: PREVIEW_MESSAGE.projectTheme, nonce, theme: { use: 'theme-zinc' } })
    send({ type: PREVIEW_MESSAGE.projectTheme, nonce, theme: { theme: { colors: { primary: '#18181b' } } } })
    send({ type: PREVIEW_MESSAGE.projectTheme, nonce, theme: { config: { theme: { colors: {} } } } })
    expect(h.onProjectTheme).toHaveBeenCalledTimes(3)
    expect(h.onProjectTheme.mock.calls[0]![0]).toEqual({ use: 'theme-zinc' })
  })

  it('strips unknown top-level keys and keeps the target', () => {
    const { send, h, nonce } = connected()
    send({
      type: PREVIEW_MESSAGE.surfaceUpdate,
      nonce,
      surfaceId: 'srf_1',
      extra: 'dropped',
      surface: { ...goodSurface, capabilities: [{ capability: 'platform/persistence', config: {} }] },
    })
    expect(h.onSurfaceUpdate).toHaveBeenCalledWith({
      surfaceId: 'srf_1',
      surface: { ...goodSurface, capabilities: [{ capability: 'platform/persistence', config: {} }] },
    })
  })
})
