/**
 * The block tree of an app's pages, judged as a whole: every block type a
 * page places must be defined by the app or a pack it pins
 * (`UNKNOWN_BLOCK_TYPE`), and every block id is unique within its page
 * (`BLOCK_ID_DUPLICATE`; receipt §2: "Unique within the page"). Both are
 * errors, reported the same by `pwf validate` and `pwf build`.
 *
 * A page's blocks are its `blocks` and, below them, every `children` list —
 * the only member a block node holds blocks in (receipt §2). A pattern
 * applied to a page, and a shell's main slot, are already expanded into that
 * tree (pattern-format §4), so their blocks are walked like any other. A
 * repeat's `children` are one template, drawn once per item: each node is
 * counted once, as written.
 */
import { ambiguousBlockTypeMessage, atomManifestPath, BLOCK_TYPE_AMBIGUOUS, blockTypeNames, namedBlocksOf, resolveBlockType, type BlockSource } from './block-props.js'
import type { PackIssue } from './types.js'

export const UNKNOWN_BLOCK_TYPE = 'UNKNOWN_BLOCK_TYPE'
export const BLOCK_ID_DUPLICATE = 'BLOCK_ID_DUPLICATE'

/** One page of an app: its key, its receipt's path in the app folder, and the parsed receipt. */
export interface PageReceipt {
  readonly key: string
  readonly path: string
  readonly receipt: unknown
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Calls `visit` for every block node of a receipt, with its path (`blocks[0].children[1]`). */
export function walkReceiptBlocks(receipt: unknown, visit: (node: Record<string, unknown>, at: string) => void): void {
  const walk = (node: unknown, at: string): void => {
    if (!isRecord(node)) return
    visit(node, at)
    const children = node['children']
    if (Array.isArray(children)) children.forEach((c, i) => walk(c, `${at}.children[${i}]`))
  }
  if (isRecord(receipt) && Array.isArray(receipt['blocks'])) receipt['blocks'].forEach((b, i) => walk(b, `blocks[${i}]`))
}

/**
 * Every name a block of the sources answers to in a receipt, resolved as
 * `pwf dev` and `pwf build` resolve them: the app's own blocks and its pinned
 * packs' ({@link blockTypeNames}).
 */
export function definedBlockTypes(sources: readonly BlockSource[]): Set<string> {
  const names = new Set<string>()
  for (const source of sources) {
    for (const ref of source.atoms) {
      if (ref.kind !== 'block') continue
      let manifest: Record<string, unknown> | undefined
      const bytes = source.folder.files.get(atomManifestPath(ref))
      if (bytes) {
        try {
          const text = new TextDecoder().decode(bytes)
          const value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
          if (isRecord(value)) manifest = value
        } catch {
          // A manifest that does not parse is the pack validation's finding; the id still names the block.
        }
      }
      for (const n of blockTypeNames(ref.id, manifest)) names.add(n)
    }
  }
  return names
}

/**
 * The block types the pages place, each with the first page (in page order)
 * that places it, sorted by type — the order a build resolves them in.
 */
export function blockTypeFirstUses<P extends PageReceipt>(pages: readonly P[]): [string, P][] {
  const first = new Map<string, P>()
  for (const page of pages) {
    walkReceiptBlocks(page.receipt, (node) => {
      const type = node['type']
      if (typeof type === 'string' && type && !first.has(type)) first.set(type, page)
    })
  }
  return [...first].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/** The `UNKNOWN_BLOCK_TYPE` finding for a type no source defines, at the first page that places it. */
export function unknownBlockTypeIssue(type: string, page: Pick<PageReceipt, 'key' | 'path'>): PackIssue {
  return {
    severity: 'error',
    code: UNKNOWN_BLOCK_TYPE,
    path: page.path,
    message: `page "${page.key}" places a block of type "${type}", which neither the app nor its pinned packs define`,
  }
}

/** `UNKNOWN_BLOCK_TYPE` for every type the pages place that `isKnown` does not know; one finding per type. */
export function checkBlockTypes(pages: readonly PageReceipt[], isKnown: (type: string) => boolean): PackIssue[] {
  return blockTypeFirstUses(pages)
    .filter(([type]) => !isKnown(type))
    .map(([type, page]) => unknownBlockTypeIssue(type, page))
}

/**
 * `BLOCK_ID_DUPLICATE` for every block whose `id` an earlier block of the same
 * page already has, naming both paths. Ids are compared as written; a block
 * without an id is not compared.
 */
export function checkBlockIds(page: Pick<PageReceipt, 'path' | 'receipt'>): PackIssue[] {
  const issues: PackIssue[] = []
  const seen = new Map<string, string>()
  walkReceiptBlocks(page.receipt, (node, at) => {
    const id = node['id']
    if (typeof id !== 'string' || id === '') return
    const first = seen.get(id)
    if (first === undefined) {
      seen.set(id, at)
      return
    }
    issues.push({
      severity: 'error',
      code: BLOCK_ID_DUPLICATE,
      path: page.path,
      message: `block id "${id}" is used twice on this page, at ${first} and ${at}; a block id is unique within its page (behaviours, media slots and forms address blocks by id)`,
    })
  })
  return issues
}

/**
 * `BLOCK_TYPE_AMBIGUOUS` for every type the pages place that names two
 * different blocks by a short name (block-props.ts `resolveBlockType`), at
 * the first page that places it, naming each block.
 */
export function checkAmbiguousBlockTypes(pages: readonly PageReceipt[], sources: readonly BlockSource[]): PackIssue[] {
  const blocks = namedBlocksOf(sources)
  const issues: PackIssue[] = []
  for (const [type, page] of blockTypeFirstUses(pages)) {
    const hit = resolveBlockType(type, blocks)
    if (!hit || !('ambiguous' in hit)) continue
    issues.push({ severity: 'error', code: BLOCK_TYPE_AMBIGUOUS, path: page.path, message: ambiguousBlockTypeMessage(type, page.key, hit.ambiguous.map((b) => b.id)) })
  }
  return issues
}
