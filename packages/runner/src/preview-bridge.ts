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
 *    `type`s dropped, the rest parsed with the schemas below before anything
 *    renders.
 *
 * Every refusal is SILENT: no error is posted back, nothing is logged. A
 * sender that does not hold the nonce learns nothing from probing.
 *
 * @module @pwfabric/runner/preview-bridge
 */

import { z } from 'zod'
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
// PAYLOAD SCHEMAS
// ============================================================
//
// Declared here rather than imported from the contracts package: a published
// runner resolves contracts through a host-seeded shim that carries the public
// value surface of the runtime only, and a missing named export would fail the
// whole runner module at link time. These mirror the contracts' surface and
// appearance schemas — same field names and value types — and stay as loose
// as they are (`passthrough`), because the renderer is the one that decides
// what a block's props mean.

const blockNodeSchema: z.ZodType<SurfaceBlockNode> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1).optional(),
      type: z.string().min(1).max(256),
      props: z.record(z.unknown()).optional(),
      children: z.array(blockNodeSchema).optional(),
    })
    .passthrough()
) as z.ZodType<SurfaceBlockNode>

/** Mirrors `AppearanceConfigSchema`: token groups are data, variables and keyframes are strings. */
const appearanceConfigSchema = z
  .object({
    theme: z.record(z.unknown()).optional(),
    darkTheme: z.record(z.unknown()).optional(),
    styleVariables: z.record(z.string()).optional(),
    keyframes: z.record(z.string()).optional(),
    extensions: z.record(z.unknown()).optional(),
    mode: z
      .object({
        policy: z.enum(['light', 'dark', 'system']).optional(),
        contrast: z.enum(['normal', 'high']).optional(),
      })
      .strict()
      .optional(),
    brand: z
      .object({
        logo: z.string().min(1).max(2048).optional(),
        favicon: z.string().min(1).max(2048).optional(),
      })
      .strict()
      .optional(),
  })
  .passthrough()

/** Mirrors `SurfaceAppearanceRefSchema`. */
const appearanceRefSchema = z.object({ config: appearanceConfigSchema.optional() }).passthrough()

/** Mirrors `capabilityBindingSchema`, with `required` optional as receipts write it. */
const capabilityBindingSchema = z
  .object({
    capability: z.string().min(1),
    required: z.boolean().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .passthrough()

const surfaceSchema = z.object({
  blocks: z.array(blockNodeSchema),
  appearance: appearanceRefSchema.optional(),
  capabilities: z.array(capabilityBindingSchema).optional(),
})

const surfaceUpdateSchema = z.object({
  type: z.literal(PREVIEW_MESSAGE.surfaceUpdate),
  nonce: z.string(),
  pageKey: z.string().min(1).optional(),
  surfaceId: z.string().min(1).optional(),
  surface: surfaceSchema,
})

/**
 * The project theme takes the forms `pwpack/appearance.json` takes: a ref
 * (`{ config }`), a bare config, or a preset name (`{ use }`) with overrides.
 * The runner then resolves it with `projectAppearanceRef` — the same function
 * a normal load uses.
 */
const themeSchema = z.union([
  z.object({ config: appearanceConfigSchema }).passthrough(),
  appearanceConfigSchema.extend({ use: z.string().min(1).max(128).optional() }),
])

const projectThemeSchema = z.object({
  type: z.literal(PREVIEW_MESSAGE.projectTheme),
  nonce: z.string(),
  theme: themeSchema,
})

export type PreviewSurface = z.infer<typeof surfaceSchema>

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
        const parsed = surfaceUpdateSchema.safeParse(data)
        if (!parsed.success) return
        const { pageKey, surfaceId, surface } = parsed.data
        handlers.onSurfaceUpdate({
          ...(pageKey !== undefined ? { pageKey } : {}),
          ...(surfaceId !== undefined ? { surfaceId } : {}),
          surface,
        })
        return
      }
      const parsed = projectThemeSchema.safeParse(data)
      if (!parsed.success) return
      handlers.onProjectTheme(parsed.data.theme as Record<string, unknown>)
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
