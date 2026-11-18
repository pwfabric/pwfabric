/**
 * The preview bridge — live edits from an authoring host into a running app.
 *
 * A studio shows an app's pages in an iframe served from a separate preview
 * origin, so the app's block code can never reach the studio. That isolation
 * cost the live preview: the iframe could only show what was last built. This
 * bridge lets the framing page push the page it holds in memory, and the
 * project theme, into the runner, which re-renders through the handle it
 * already holds. Nothing is fetched and nothing is rebuilt.
 *
 * OFF BY DEFAULT. It exists only when the host passes
 * `runApp({ previewBridge: { allowedOrigins } })`. A published app's shell
 * never does, so a published app adds no `message` listener at all.
 *
 * THE BOUNDARY (see spec/hosting-security.md §5):
 *
 * 1. Origin — `event.origin` must EQUAL one of `allowedOrigins`. Exact string
 *    equality: no suffix match, no wildcard. An entry that is not a canonical
 *    http(s) origin (`*`, `null`, a path, a trailing slash) is discarded when
 *    the bridge starts, so `*` can never become a postMessage target.
 * 2. Source — `event.source` must be `window.parent`. A sibling frame or a
 *    popup with an allowed origin is still not the page that framed us.
 * 3. Nonce — 256 random bits from `crypto.getRandomValues`, one per page load.
 *    The runner posts `{ type: 'pw:preview-ready', nonce, pageKey }` to the
 *    parent once per allowed origin, each with that origin as the explicit
 *    `targetOrigin` — the browser delivers it only to a parent that really is
 *    that origin. The parent answers `{ type: 'pw:preview-hello', nonce }`.
 *    Until that answer arrives nothing else is read. After it, only the origin
 *    that answered is listened to, and every message must carry the nonce.
 * 4. Payload — capped at `MAX_PREVIEW_MESSAGE_BYTES` serialized, unknown
 *    `type`s dropped, the rest checked against the shapes below before anything
 *    renders.
 *
 * Every refusal is SILENT: no error is posted back, nothing is logged. A
 * sender that does not hold the nonce learns nothing from probing.
 *
 * @module @pwfabric/runner/preview-bridge
 */

import type { SurfaceBlockNode } from './types.js'

// ============================================================
// PROTOCOL
// ============================================================

/** The four message types. Neutral names: the engine does not know which host frames it. */
export const PREVIEW_MESSAGE = {
  /** runner → parent: here is my nonce and the page on screen. */
  ready: 'pw:preview-ready',
  /** parent → runner: the nonce, echoed. Completes the handshake. */
  hello: 'pw:preview-hello',
  /** parent → runner: the in-memory page to show. */
  surfaceUpdate: 'pw:surface-update',
  /** parent → runner: the project theme to wear. */
  projectTheme: 'pw:project-theme',
} as const

/** Largest message the bridge will parse, measured as serialized JSON bytes. */
export const MAX_PREVIEW_MESSAGE_BYTES = 2 * 1024 * 1024

/** Random bytes in a nonce (256 bits). */
const NONCE_BYTES = 32

/** What the host passes to `runApp` to turn the bridge on. */
export interface PreviewBridgeOptions {
  /**
   * The exact origins allowed to drive the preview, e.g.
   * `['https://studio.example.com']`. Compared with `===` against
   * `MessageEvent.origin`. Required and non-empty; no wildcards.
   */
  readonly allowedOrigins: readonly string[]
}

// ============================================================
// PAYLOAD SHAPES
// ============================================================
//
// Checked by hand: no page carries zod (3.0; the contracts' zod schemas are
// tooling, `@pwfabric/contracts/schemas`). The checks mirror the contracts' surface and
// appearance schemas — same field names and value types — and stay as loose
// as they are (unknown members pass through, except at the top of a message,
// where they are dropped), because the renderer is the one that decides what
// a block's props mean.

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown, min = 0, max = Infinity): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max
/** An absent member, or one that passes `check`. */
const opt = (v: unknown, check: (x: unknown) => boolean): boolean => v === undefined || check(v)
const isRecordOf = (v: unknown, value: (x: unknown) => boolean = () => true): boolean =>
  isObject(v) && Object.values(v).every(value)
/** An object holding only the members `allowed` names. */
const onlyKeys = (v: Json, allowed: readonly string[]): boolean => Object.keys(v).every((k) => allowed.includes(k))

/** Mirrors the contracts' block node: `type` 1–256 characters, `id` non-empty, `children` nodes. */
function isBlockNode(v: unknown): v is SurfaceBlockNode {
  if (!isObject(v)) return false
  return (
    isString(v['type'], 1, 256) &&
    opt(v['id'], (x) => isString(x, 1)) &&
    opt(v['props'], (x) => isRecordOf(x)) &&
    opt(v['children'], (x) => Array.isArray(x) && x.every(isBlockNode))
  )
}

const MODE_POLICIES: readonly unknown[] = ['light', 'dark', 'system']
const CONTRASTS: readonly unknown[] = ['normal', 'high']

/** Mirrors `AppearanceConfigSchema`: token groups are data, variables and keyframes are strings. */
function isAppearanceConfig(v: unknown): v is Json {
  if (!isObject(v)) return false
  const strings = (x: unknown): boolean => isRecordOf(x, (y) => typeof y === 'string')
  return (
    opt(v['theme'], (x) => isRecordOf(x)) &&
    opt(v['darkTheme'], (x) => isRecordOf(x)) &&
    opt(v['styleVariables'], strings) &&
    opt(v['keyframes'], strings) &&
    opt(v['extensions'], (x) => isRecordOf(x)) &&
    opt(
      v['mode'],
      (x) =>
        isObject(x) &&
        onlyKeys(x, ['policy', 'contrast']) &&
        opt(x['policy'], (p) => MODE_POLICIES.includes(p)) &&
        opt(x['contrast'], (c) => CONTRASTS.includes(c))
    ) &&
    opt(
      v['brand'],
      (x) =>
        isObject(x) &&
        onlyKeys(x, ['logo', 'favicon']) &&
        opt(x['logo'], (l) => isString(l, 1, 2048)) &&
        opt(x['favicon'], (f) => isString(f, 1, 2048))
    )
  )
}

/** Mirrors `capabilityBindingSchema`, with `required` optional as receipts write it. */
const isCapabilityBinding = (v: unknown): boolean =>
  isObject(v) &&
  isString(v['capability'], 1) &&
  opt(v['required'], (x) => typeof x === 'boolean') &&
  opt(v['config'], (x) => isRecordOf(x))

/** The page a host pushes: its blocks, and optionally its appearance ref and capabilities. */
export interface PreviewSurface {
  blocks: SurfaceBlockNode[]
  appearance?: { config?: Record<string, unknown>; [key: string]: unknown }
  capabilities?: { capability: string; required?: boolean; config?: Record<string, unknown>; [key: string]: unknown }[]
}

/** The surface a message carries, its own unknown members dropped; null when it is not one. */
function parseSurface(v: unknown): PreviewSurface | null {
  if (!isObject(v) || !Array.isArray(v['blocks']) || !v['blocks'].every(isBlockNode)) return null
  const appearance = v['appearance']
  if (!opt(appearance, (x) => isObject(x) && opt(x['config'], isAppearanceConfig))) return null
  const capabilities = v['capabilities']
  if (!opt(capabilities, (x) => Array.isArray(x) && x.every(isCapabilityBinding))) return null
  return {
    blocks: v['blocks'] as SurfaceBlockNode[],
    ...(appearance !== undefined ? { appearance: appearance as NonNullable<PreviewSurface['appearance']> } : {}),
    ...(capabilities !== undefined ? { capabilities: capabilities as NonNullable<PreviewSurface['capabilities']> } : {}),
  }
}

/** A surface update's members, or null when the message is not one. */
function parseSurfaceUpdate(data: Json): PreviewSurfaceUpdate | null {
  if (!isString(data['nonce'])) return null
  const { pageKey, surfaceId } = data
  if (!opt(pageKey, (x) => isString(x, 1)) || !opt(surfaceId, (x) => isString(x, 1))) return null
  const surface = parseSurface(data['surface'])
  if (!surface) return null
  return {
    ...(typeof pageKey === 'string' ? { pageKey } : {}),
    ...(typeof surfaceId === 'string' ? { surfaceId } : {}),
    surface,
  }
}

/**
 * The project theme a message carries, or null. It takes the forms
 * `pwpack/appearance.json` takes: a ref (`{ config }`), a bare config, or a
 * preset name (`{ use }`) with overrides. The runner then resolves it with
 * `projectAppearanceRef` — the same function a normal load uses.
 */
function parseProjectTheme(data: Json): Json | null {
  if (!isString(data['nonce'])) return null
  const theme = data['theme']
  if (!isObject(theme)) return null
  if (isAppearanceConfig(theme['config'])) return theme
  if (isAppearanceConfig(theme) && opt(theme['use'], (x) => isString(x, 1, 128))) return theme
  return null
}

export interface PreviewSurfaceUpdate {
  readonly pageKey?: string
  readonly surfaceId?: string
  readonly surface: PreviewSurface
}

// ============================================================
// BRIDGE
// ============================================================

/** The part of a `MessageEvent` the bridge reads. */
export interface PreviewMessageEvent {
  readonly origin: string
  readonly source: unknown
  readonly data: unknown
}

/** The part of `window` the bridge needs — a seam for tests. */
export interface PreviewBridgeWindow {
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void } | null
  addEventListener(type: 'message', listener: (event: PreviewMessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: PreviewMessageEvent) => void): void
}

export interface PreviewBridgeHandlers {
  onSurfaceUpdate(update: PreviewSurfaceUpdate): void
  onProjectTheme(theme: Record<string, unknown>): void
}

export interface PreviewBridge {
  /** Tell the parent which page is on screen (and the nonce). Called after every route render. */
  announce(pageKey: string): void
  /** The origin that completed the handshake, or null before it. */
  readonly connectedOrigin: string | null
  /** Remove the listener. */
  dispose(): void
}

/**
 * The allowed origins, canonical only. An entry survives when it is an
 * http(s) URL whose `origin` is exactly the entry — so `*`, `null`,
 * `https://a.example/` (trailing slash) and `https://a.example/path` are all
 * discarded rather than "fixed".
 */
export function normalizeAllowedOrigins(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const entry of list) {
    if (typeof entry !== 'string') continue
    let url: URL
    try {
      url = new URL(entry)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    if (url.origin !== entry) continue
    if (!out.includes(entry)) out.push(entry)
  }
  return out
}

/** A fresh hex nonce of `NONCE_BYTES` random bytes. */
export function createNonce(crypto: Pick<Crypto, 'getRandomValues'>): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Serialized size in bytes, or Infinity when it cannot be serialized. */
export function serializedBytes(data: unknown): number {
  let json: string | undefined
  try {
    json = JSON.stringify(data)
  } catch {
    return Infinity
  }
  if (json === undefined) return Infinity
  // A UTF-16 length over the cap is over it in UTF-8 too; skip the encode.
  if (json.length > MAX_PREVIEW_MESSAGE_BYTES) return json.length
  return new TextEncoder().encode(json).length
}

/**
 * Start the bridge. Returns null — and adds NO listener — when the options
 * name no usable origin or the page is not framed.
 */
export function createPreviewBridge(
  options: PreviewBridgeOptions,
  handlers: PreviewBridgeHandlers,
  env: { readonly win: PreviewBridgeWindow; readonly crypto: Pick<Crypto, 'getRandomValues'> }
): PreviewBridge | null {
  const origins = normalizeAllowedOrigins(options?.allowedOrigins)
  if (origins.length === 0) return null
  const { win } = env
  const parent = win.parent
  // Not framed: there is nobody to talk to, and `parent` is the page itself.
  if (!parent || (parent as unknown) === win) return null

  const nonce = createNonce(env.crypto)
  let connected: string | null = null

  const onMessage = (event: PreviewMessageEvent): void => {
    try {
      // 1. Exact origin.
      if (!origins.includes(event.origin)) return
      // 2. The page that framed us, nothing else.
      if (event.source !== parent) return
      // After the handshake, only the origin that answered.
      if (connected !== null && event.origin !== connected) return
      const data = event.data
      if (!data || typeof data !== 'object' || Array.isArray(data)) return
      const { type, nonce: carried } = data as { type?: unknown; nonce?: unknown }
      if (typeof type !== 'string') return
      // 3. The nonce, on every message including the hello.
      if (carried !== nonce) return

      if (connected === null) {
        // Before the handshake only the reply counts.
        if (type === PREVIEW_MESSAGE.hello) connected = event.origin
        return
      }
      if (type !== PREVIEW_MESSAGE.surfaceUpdate && type !== PREVIEW_MESSAGE.projectTheme) return
      // 4. Size, then shape.
      if (serializedBytes(data) > MAX_PREVIEW_MESSAGE_BYTES) return
      if (type === PREVIEW_MESSAGE.surfaceUpdate) {
        const update = parseSurfaceUpdate(data as Json)
        if (update) handlers.onSurfaceUpdate(update)
        return
      }
      const theme = parseProjectTheme(data as Json)
      if (theme) handlers.onProjectTheme(theme)
    } catch {
      // Silent by design: a malformed message is dropped, never echoed.
    }
  }

  win.addEventListener('message', onMessage)

  return {
    announce(pageKey: string): void {
      for (const origin of origins) {
        try {
          parent.postMessage({ type: PREVIEW_MESSAGE.ready, nonce, pageKey }, origin)
        } catch {
          // A parent that has gone away is not an error worth surfacing.
        }
      }
    },
    get connectedOrigin() {
      return connected
    },
    dispose(): void {
      win.removeEventListener('message', onMessage)
    },
  }
}
