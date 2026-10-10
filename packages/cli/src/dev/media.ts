/**
 * Media: the app's declared images and files, copied into the pwapp.
 *
 * pwpack-format §1.3: `app/media/<key>.json` declares one image or file
 * (`{ purpose, kind, origin, slots, status, url?, decorative?, file? }`) and
 * carries no bytes; the bytes are `media/<file>`, each recorded in
 * `media/provenance.json`. The pack library's `mediaDeclarations` reads
 * that layout (its findings reach the diagnostics through `validatePack`).
 * pwapp-format §1 puts the bytes the app serves at `pwpack/media/<file>`,
 * and §4 records each declaration's resolved address in `publish.json`
 * `media[]`.
 *
 * For each declaration the bytes are looked up, in order:
 *
 *   1. the declaration's `file` (a pack path, `media/<name>`);
 *   2. `media/<path>` — a `url` that is itself a `media/…` path;
 *   3. `media/<key>.<ext>` — the one media file named after the key.
 *
 * Found bytes are served at `pwpack/media/…` and the declaration resolves to
 * that address. A declaration without bytes but with an absolute `url` keeps
 * the url. Every other one is reported (info) and left alone.
 *
 * Slots: a declared slot (`{ surfaceKey, blockId, prop }`) whose prop is
 * empty in the served receipt gets the resolved address. A value already in
 * the prop is never replaced (plan.md §2 rule 1). The app's own files are
 * never rewritten; only the served copy of the receipt is.
 */
import { MEDIA_DIR, MEDIA_PROVENANCE_FILE, mediaDeclarations, type PackFolder } from '@pwfabric/pack'
import type { AssembleDiagnostic } from './diagnostics.js'
import { isRecord } from './sources.js'

/** One slot a resolved address is written into. */
export interface MediaSlot {
  readonly blockId: string
  readonly prop: string
  readonly url: string
}

export interface CollectedMedia {
  /** Files to serve, relative to `pwpack/` (`media/hero.webp`). */
  readonly files: Map<string, Uint8Array>
  /** `publish.json` `media[]`, in key order. */
  readonly records: { key: string; url: string }[]
  /** Slots to fill, by page key. */
  readonly slots: Map<string, MediaSlot[]>
}

const ABSOLUTE_URL = /^(?:https?:|data:)/i

/** A single path segment that is safe to serve: no separators, no dot names. */
function isSafeName(name: string): boolean {
  return name.length > 0 && !/[\\/\0]/.test(name) && name !== '.' && name !== '..'
}

/** A relative `media/…` path with no `.`/`..` segment. */
function isSafeMediaPath(path: string): boolean {
  return path.startsWith(MEDIA_DIR) && path.slice(MEDIA_DIR.length).split('/').every(isSafeName)
}

/** The media file named after a key (`media/<key>.<ext>`), when exactly one exists. */
function byKey(mediaPaths: readonly string[], key: string): string | undefined {
  const hits = mediaPaths.filter((p) => {
    const name = p.slice(MEDIA_DIR.length)
    return !name.includes('/') && name.slice(0, name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : undefined) === key
  })
  return hits.length === 1 ? hits[0] : undefined
}

/** Reads the app's media declarations and bytes. */
export function collectMedia(folder: PackFolder, diagnostics: AssembleDiagnostic[]): CollectedMedia {
  const files = new Map<string, Uint8Array>()
  const records: { key: string; url: string }[] = []
  const slots = new Map<string, MediaSlot[]>()

  const mediaPaths = [...folder.files.keys()].filter((p) => p !== MEDIA_PROVENANCE_FILE && isSafeMediaPath(p)).sort()
  for (const path of mediaPaths) files.set(path, folder.files.get(path) as Uint8Array)

  for (const { key, path, declaration, filePath } of mediaDeclarations(folder).declarations) {
    const declaredUrl = declaration.url?.trim() ?? ''
    const urlPath = declaredUrl.replace(/^\.\//, '')

    let url: string | undefined
    const inMedia =
      (filePath !== undefined && files.has(filePath) ? filePath : undefined) ??
      (isSafeMediaPath(urlPath) && files.has(urlPath) ? urlPath : undefined) ??
      byKey(mediaPaths, key)
    if (inMedia) {
      url = `pwpack/${inMedia}`
    } else if (ABSOLUTE_URL.test(declaredUrl)) {
      url = declaredUrl
    }
    if (url === undefined) {
      diagnostics.push({
        severity: 'info',
        code: 'MEDIA_UNRESOLVED',
        message: `media "${key}" has no bytes in media/ and no absolute url; its slots keep what the receipts say`,
        path,
      })
      continue
    }
    records.push({ key, url })
    const served = ABSOLUTE_URL.test(url) ? url : `./${url}`
    for (const { surfaceKey, blockId, prop } of declaration.slots ?? []) {
      const list = slots.get(surfaceKey) ?? []
      list.push({ blockId, prop, url: served })
      slots.set(surfaceKey, list)
    }
  }
  return { files, records, slots }
}

const isEmpty = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/**
 * The served receipt with its empty media slots filled, or `undefined` when
 * nothing changed (the bytes are then served exactly as written).
 */
export function fillMediaSlots(receiptBytes: Uint8Array, slots: readonly MediaSlot[] | undefined): Uint8Array | undefined {
  if (!slots || slots.length === 0) return undefined
  let receipt: unknown
  try {
    receipt = JSON.parse(new TextDecoder().decode(receiptBytes))
  } catch {
    return undefined
  }
  if (!isRecord(receipt)) return undefined
  const copy = structuredClone(receipt)
  let changed = false
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!isRecord(node)) return
    for (const slot of slots) {
      if (node['id'] !== slot.blockId) continue
      const props = isRecord(node['props']) ? node['props'] : {}
      if (!isEmpty(props[slot.prop])) continue
      node['props'] = { ...props, [slot.prop]: slot.url }
      changed = true
    }
    if (Array.isArray(node['children'])) node['children'].forEach(walk)
  }
  walk(copy['blocks'])
  return changed ? new TextEncoder().encode(JSON.stringify(copy)) : undefined
}
