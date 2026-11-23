/**
 * The app writes every word (envelope §2): the receipt checks that keep it so.
 *
 *  - BLOCK_DEFAULT_COPY — a placed block shows a word the app never wrote:
 *    its manifest declares a copy prop (`copy: true`) with a non-empty
 *    default, and the receipt does not set the prop. The default is in the
 *    pack's language, whatever the app's is.
 *  - ERROR_BOUND_AS_TEXT — a receipt shows a failure's CODE as text:
 *    `{{__errors.<id>}}`, or the state key a write's `statusKeys.reason` or
 *    `statusKeys.detail` names, bound where a visitor reads it. These are
 *    states to branch on (`visibleWhen`, a condition, a comparison); the
 *    words for each are the app's. `detail` is the developer's.
 *
 * Both are warnings: the page renders. Both read only declarative files
 * (block manifests and receipts); no block code runs.
 *
 * {@link placedBlockWords} lists the `ui.*` words placed blocks read of their
 * own (`definition.messages`), for the check that the app sets each one
 * (MESSAGES_MISSING, which reads the app's messages).
 */
import type { PackFolder, PackIssue } from './types.js'
import { namedBlocksOf, resolveBlockType, type BlockPropsCatalog, type BlockSource } from './block-props.js'

/** A placed block shows its manifest's default for a copy prop the receipt does not set. */
export const BLOCK_DEFAULT_COPY = 'BLOCK_DEFAULT_COPY'
/** A failure code (`__errors.*`, `statusKeys.reason` / `detail`) is bound as visible text. */
export const ERROR_BOUND_AS_TEXT = 'ERROR_BOUND_AS_TEXT'

const RECEIPT = /^app\/surfaces\/[^/]+\.receipt\.json$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function jsonAt(folder: PackFolder, path: string): unknown {
  const bytes = folder.files.get(path)
  if (!bytes) return undefined
  try {
    const text = new TextDecoder().decode(bytes)
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
  } catch {
    return undefined
  }
}

function receiptPaths(app: PackFolder): string[] {
  return [...app.files.keys()].filter((p) => RECEIPT.test(p)).sort()
}

/** Calls `visit` for every block node of a receipt, with its path (`blocks[0].children[1]`). */
function eachBlock(receipt: unknown, visit: (node: Record<string, unknown>, at: string) => void): void {
  const walk = (node: unknown, at: string): void => {
    if (!isRecord(node)) return
    visit(node, at)
    const children = node['children']
    if (Array.isArray(children)) children.forEach((c, i) => walk(c, `${at}.children[${i}]`))
  }
  if (isRecord(receipt) && Array.isArray(receipt['blocks'])) receipt['blocks'].forEach((b, i) => walk(b, `blocks[${i}]`))
}

function where(node: Record<string, unknown>, at: string): string {
  const id = typeof node['id'] === 'string' && node['id'] ? ` "${node['id']}"` : ''
  return `${at} (${String(node['type'])}${id})`
}

// ============================================================
// BLOCK_DEFAULT_COPY
// ============================================================

/** A copy prop's default as a manifest writes it: the descriptor's `default`, else its schema's. */
function copyDefault(prop: { readonly default?: unknown; readonly jsonSchema?: unknown }): string | undefined {
  const own = prop.default
  const schema = isRecord(prop.jsonSchema) ? prop.jsonSchema['default'] : undefined
  const value = own !== undefined ? own : schema
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** The BLOCK_DEFAULT_COPY findings for one receipt. */
export function checkReceiptDefaultCopy(receipt: unknown, catalog: BlockPropsCatalog, path: string): PackIssue[] {
  const issues: PackIssue[] = []
  eachBlock(receipt, (node, at) => {
    const type = node['type']
    const entry = typeof type === 'string' ? catalog.get(type) : undefined
    if (!entry) return
    const props = isRecord(node['props']) ? node['props'] : {}
    for (const prop of entry.props) {
      if (prop.copy !== true || props[prop.name] !== undefined) continue
      const text = copyDefault(prop)
      if (text === undefined) continue
      issues.push({
        severity: 'warning',
        code: BLOCK_DEFAULT_COPY,
        path,
        message: `${where(node, at)} does not set ${prop.name}, so the visitor reads ${entry.atomId}'s default ${JSON.stringify(text)} — a word the app never wrote; set it in the app's language`,
      })
    }
  })
  return issues
}

/** BLOCK_DEFAULT_COPY for every receipt of an app. */
export function checkDefaultCopy(app: PackFolder, catalog: BlockPropsCatalog): PackIssue[] {
  return receiptPaths(app).flatMap((p) => checkReceiptDefaultCopy(jsonAt(app, p), catalog, p))
}

// ============================================================
// ERROR_BOUND_AS_TEXT
// ============================================================

/**
 * A key whose value is a condition, not text: `visibleWhen`, `errorWhen`,
 * `if`, `hidden`, `disabled` … A bare `{{__errors.x}}` there IS branching.
 */
const CONDITION_KEY = /(When|If)$|^(if|when|condition|visible|hidden|show|disabled|loading|open|active|selected|checked)$/i

/** The state keys a receipt's writes put a reason or a detail in (`statusKeys.reason`, `statusKeys.detail`). */
function statusTextKeys(receipt: unknown): Set<string> {
  const keys = new Set<string>()
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (isRecord(v)) {
      const sk = v['statusKeys']
      if (isRecord(sk)) {
        for (const k of ['reason', 'detail'] as const) {
          const name = sk[k]
          if (typeof name === 'string' && name) keys.add(name)
        }
      }
      Object.values(v).forEach(walk)
    }
  }
  walk(receipt)
  return keys
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The first `{{…}}` in `text` that only NAMES a failure value — `__errors.x`,
 * `state.<reason key>` — with no operator around it, or undefined. A
 * comparison (`__errors.x == 'forbidden' ? … : …`) or a negation branches.
 */
function boundFailure(text: string, failure: RegExp): string | undefined {
  for (const m of text.matchAll(/\{\{([\s\S]+?)\}\}/g)) {
    const expr = (m[1] ?? '').trim()
    if (failure.test(expr)) return m[0]
  }
  return undefined
}

/** The ERROR_BOUND_AS_TEXT findings for one receipt. */
export function checkReceiptErrorsAsText(receipt: unknown, catalog: BlockPropsCatalog, path: string): PackIssue[] {
  const keys = [...statusTextKeys(receipt)].map(escapeRe)
  const names = ['__errors\\.[A-Za-z0-9_$-]+', ...keys.map((k) => `state\\.${k}`)]
  const failure = new RegExp(`^(?:${names.join('|')})$`)
  const issues: PackIssue[] = []
  eachBlock(receipt, (node, at) => {
    const props = node['props']
    if (!isRecord(props)) return
    const type = node['type']
    const entry = typeof type === 'string' ? catalog.get(type) : undefined
    const booleanProp = (name: string): boolean => {
      const schema = entry?.props.find((p) => p.name === name)?.jsonSchema
      return isRecord(schema) && schema['type'] === 'boolean'
    }
    const scan = (value: unknown, key: string, label: string, top: boolean): void => {
      if (CONDITION_KEY.test(key) || (top && booleanProp(key))) return
      if (typeof value === 'string') {
        const found = boundFailure(value, failure)
        if (found) {
          issues.push({
            severity: 'warning',
            code: ERROR_BOUND_AS_TEXT,
            path,
            message: `${where(node, at)} shows ${found} in ${label}: that is a code to branch on (visibleWhen, a comparison), not words for the visitor — write the app's own words for each case`,
          })
        }
      } else if (Array.isArray(value)) value.forEach((v, i) => scan(v, key, `${label}[${i}]`, false))
      else if (isRecord(value)) for (const [k, v] of Object.entries(value)) scan(v, k, `${label}.${k}`, false)
    }
    for (const [k, v] of Object.entries(props)) scan(v, k, k, true)
  })
  return issues
}

/** ERROR_BOUND_AS_TEXT for every receipt of an app. */
export function checkErrorsAsText(app: PackFolder, catalog: BlockPropsCatalog): PackIssue[] {
  return receiptPaths(app).flatMap((p) => checkReceiptErrorsAsText(jsonAt(app, p), catalog, p))
}

// ============================================================
// The words placed blocks read of their own (definition.messages)
// ============================================================

/** A `ui.*` word a block reads of its own, and the prop that replaces it (block-manifest, "Words a block draws"). */
export interface BlockMessage {
  readonly id: string
  readonly prop?: string
}

const UI_WORD = /^ui\.[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/

/** The words a block manifest declares in `definition.messages`; an entry that is not `{ id: "ui.…", prop? }` is skipped. */
export function blockMessagesOf(manifest: unknown): BlockMessage[] {
  const def = isRecord(manifest) ? manifest['definition'] : undefined
  const list = isRecord(def) && Array.isArray(def['messages']) ? def['messages'] : []
  const out: BlockMessage[] = []
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry['id'] !== 'string' || !UI_WORD.test(entry['id'])) continue
    const prop = entry['prop']
    out.push(typeof prop === 'string' && prop !== '' ? { id: entry['id'], prop } : { id: entry['id'] })
  }
  return out
}

/** One word a placed block reads: which, where the block is, and which block. */
export interface PlacedBlockWord {
  readonly id: string
  /** The receipt (`app/surfaces/<page>.receipt.json`, `app/layout.receipt.json`). */
  readonly path: string
  /** Where in it, as the other findings print it: `blocks[0] (navbar "bar")`. */
  readonly block: string
  readonly atomId: string
}

/** Every receipt a visitor is shown: the pages, their per-locale receipts and the layout. */
const SHOWN_RECEIPT = /^app\/(?:surfaces\/[^/]+|layout)\.receipt\.json$/

/**
 * The `ui.*` words the app's placed blocks read of their own, as their
 * manifests declare them (`definition.messages`), resolved as `pwf dev`
 * resolves a type (the app first, then its pinned packs; `sources[0]` is the
 * app). A word whose `prop` the placed block sets is the receipt's, not read.
 */
export function placedBlockWords(sources: readonly BlockSource[]): PlacedBlockWord[] {
  const app = sources[0]
  if (!app) return []
  const blocks = namedBlocksOf(sources)
  const declared = new Map<string, { atomId: string; words: BlockMessage[] } | null>()
  const wordsOf = (type: string): { atomId: string; words: BlockMessage[] } | null => {
    if (!declared.has(type)) {
      const hit = resolveBlockType(type, blocks)
      const words = hit && !('ambiguous' in hit) ? blockMessagesOf(blocks.find((b) => b.atom === hit.atom)?.manifest) : []
      declared.set(type, hit && !('ambiguous' in hit) && words.length > 0 ? { atomId: hit.id, words } : null)
    }
    return declared.get(type) ?? null
  }
  const out: PlacedBlockWord[] = []
  const paths = [...app.folder.files.keys()].filter((p) => SHOWN_RECEIPT.test(p)).sort()
  for (const path of paths) {
    eachBlock(jsonAt(app.folder, path), (node, at) => {
      const type = node['type']
      const found = typeof type === 'string' ? wordsOf(type) : null
      if (!found) return
      const props = isRecord(node['props']) ? node['props'] : {}
      for (const word of found.words) {
        const own = word.prop !== undefined ? props[word.prop] : undefined
        if (typeof own === 'string' && own.trim() !== '') continue
        out.push({ id: word.id, path, block: where(node, at), atomId: found.atomId })
      }
    })
  }
  return out
}
