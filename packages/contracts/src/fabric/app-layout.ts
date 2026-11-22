/**
 * THE APP'S LAYOUT (receipt §4): one receipt that wraps every page, so the
 * blocks every page shares — a navbar, a footer, a docs sidebar — are
 * written once. It holds exactly one page slot, `{ "type": "pw:page" }`,
 * where each page's top-level blocks go.
 *
 * Pure and dependency-free: the validator, the build and the runner assemble
 * a page the same way, from this one file.
 *
 * @module @pwfabric/contracts/fabric/app-layout
 */

/** The block type of the layout's page slot. The `pw:` prefix is the format's. */
export const PAGE_SLOT_TYPE = 'pw:page'

/** The prefix of the block types the format reserves (no block manifest names one). */
export const RESERVED_BLOCK_TYPE_PREFIX = 'pw:'

/** The persistence capability, whose sources, behaviors and state a layout joins to the page's. */
const PERSISTENCE = 'platform/persistence'

/** A block node as the layout reads it: open, like every receipt node. */
export interface LayoutBlockNode {
  readonly id?: string
  readonly type: string
  readonly props?: Record<string, unknown>
  readonly children?: LayoutBlockNode[]
  readonly [member: string]: unknown
}

/** A capability entry of a receipt. A hosted record may spell it `{ id, config }`. */
export interface LayoutCapabilityEntry {
  readonly capability?: string
  readonly id?: string
  readonly config?: Record<string, unknown>
  readonly [member: string]: unknown
}

/** What assembly reads of a receipt, page or layout. */
export interface LayoutReceiptLike {
  readonly blocks: readonly LayoutBlockNode[]
  readonly capabilities?: readonly LayoutCapabilityEntry[]
  readonly layout?: boolean
  readonly [member: string]: unknown
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * What is wrong with a layout's page slot, as sentences; empty when it holds
 * exactly one bare slot (`type`, and `id` at most) that no repeat holds.
 */
export function layoutSlotProblems(layout: unknown): string[] {
  if (!isRecord(layout) || !Array.isArray(layout['blocks'])) return ['a layout is an object with "blocks", and one of them is the page slot { "type": "pw:page" }']
  const problems: string[] = []
  let slots = 0
  const walk = (node: unknown, path: string, inRepeat: boolean): void => {
    if (!isRecord(node)) return
    if (node['type'] === PAGE_SLOT_TYPE) {
      slots++
      const extra = Object.keys(node).filter((k) => k !== 'type' && k !== 'id')
      if (extra.length > 0) problems.push(`${path} is the page slot and carries ${extra.join(', ')}: it carries "type" and at most an "id"`)
      if (inRepeat) problems.push(`${path} is the page slot inside a repeat: a page is drawn once`)
    }
    const repeated = inRepeat || typeof node['repeat'] === 'string'
    if (Array.isArray(node['children'])) node['children'].forEach((c, i) => walk(c, `${path}.children[${i}]`, repeated))
  }
  layout['blocks'].forEach((b, i) => walk(b, `blocks[${i}]`, false))
  if (slots !== 1) problems.unshift(`a layout holds exactly one page slot { "type": "pw:page" }; this one holds ${slots}`)
  return problems
}

/** A collision assembly met: an id the page and the layout both use. */
export interface LayoutAssemblyProblem {
  readonly kind: 'block' | 'source'
  readonly id: string
  readonly message: string
}

export interface LayoutAssemblyOptions {
  /**
   * The page's root-relative address (`/<key>`, `/` for the entry page; `""`
   * for the not-found page): what a layout block that marks the current page
   * and sets no `activeHref` of its own is given.
   */
  readonly currentHref: string
  /** Whether blocks of `type` mark the current page (their manifest declares `activeHref`). */
  readonly marksCurrent?: (type: string) => boolean
}

/** Every block id in `nodes`, at any depth. */
function blockIds(nodes: readonly unknown[] | undefined, out = new Set<string>()): Set<string> {
  for (const n of nodes ?? []) {
    if (!isRecord(n)) continue
    if (typeof n['id'] === 'string') out.add(n['id'])
    if (Array.isArray(n['children'])) blockIds(n['children'], out)
  }
  return out
}

const capabilityName = (entry: LayoutCapabilityEntry): string | undefined =>
  typeof entry.capability === 'string' ? entry.capability : typeof entry.id === 'string' ? entry.id : undefined

const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const sourceId = (s: unknown): string | undefined => (isRecord(s) && typeof s['id'] === 'string' ? s['id'] : undefined)

/**
 * Page `page` assembled into `layout` (receipt §4): the page's top-level
 * blocks in place of the slot; the layout's capabilities joined to the
 * page's — persistence `dataSources` and `behaviors` concatenated (the
 * layout's first), `initialState` merged with the page's value winning,
 * any other capability added unless the page binds it; and the layout blocks
 * that mark the current page given `currentHref`.
 *
 * A page that says `layout: false`, and every page of an app without a
 * layout, comes back as it is (the same object). A block id or a source id
 * both declare is reported; the layout's source of that id is dropped, so a
 * source is never shared. Neither input is changed.
 */
export function assembleIntoLayout<R extends LayoutReceiptLike>(
  layout: LayoutReceiptLike | null | undefined,
  page: R,
  options: LayoutAssemblyOptions
): { receipt: R; problems: LayoutAssemblyProblem[] } {
  if (!layout || !Array.isArray(layout.blocks) || page.layout === false || layoutSlotProblems(layout).length > 0) {
    return { receipt: page, problems: [] }
  }
  const problems: LayoutAssemblyProblem[] = []
  const pageIds = blockIds(page.blocks)
  for (const id of blockIds(layout.blocks)) {
    if (pageIds.has(id)) problems.push({ kind: 'block', id, message: `the page repeats the layout's block id "${id}"` })
  }

  const marks = options.marksCurrent
  // Layout nodes are copied; the page's own nodes go in as they are.
  const place = (nodes: readonly LayoutBlockNode[]): LayoutBlockNode[] => {
    const out: LayoutBlockNode[] = []
    for (const node of nodes) {
      if (!isRecord(node)) continue
      if (node.type === PAGE_SLOT_TYPE) {
        out.push(...page.blocks)
        continue
      }
      let copy: LayoutBlockNode = { ...node }
      if (marks?.(node.type) && (node.props === undefined || node.props['activeHref'] === undefined)) {
        copy = { ...copy, props: { ...(node.props ?? {}), activeHref: options.currentHref } }
      }
      if (Array.isArray(node.children)) copy = { ...copy, children: place(node.children) }
      out.push(copy)
    }
    return out
  }
  const blocks = place(layout.blocks)

  const pageCaps = [...(page.capabilities ?? [])]
  const layoutCaps = [...(layout.capabilities ?? [])]
  const pageNames = new Set(pageCaps.map(capabilityName).filter((n): n is string => n !== undefined))
  const joined: LayoutCapabilityEntry[] = []
  const layoutPersistence = layoutCaps.find((c) => capabilityName(c) === PERSISTENCE)
  const pagePersistenceAt = pageCaps.findIndex((c) => capabilityName(c) === PERSISTENCE)
  for (const entry of layoutCaps) {
    const name = capabilityName(entry)
    if (name === PERSISTENCE || (name !== undefined && pageNames.has(name))) continue
    joined.push(entry)
  }
  if (layoutPersistence) {
    const own = pagePersistenceAt >= 0 ? pageCaps[pagePersistenceAt] : undefined
    const lc = isRecord(layoutPersistence.config) ? layoutPersistence.config : {}
    const pc = isRecord(own?.config) ? own.config : {}
    const pageSources = listOf(pc['dataSources'])
    const pageSourceIds = new Set(pageSources.map(sourceId).filter((s): s is string => s !== undefined))
    const layoutSources = listOf(lc['dataSources']).filter((s) => {
      const id = sourceId(s)
      if (id === undefined || !pageSourceIds.has(id)) return true
      problems.push({ kind: 'source', id, message: `the page and the layout both declare the data source "${id}"; a source is never shared` })
      return false
    })
    const config: Record<string, unknown> = { ...lc, ...pc }
    if (layoutSources.length > 0 || pageSources.length > 0) config['dataSources'] = [...layoutSources, ...pageSources]
    const behaviors = [...listOf(lc['behaviors']), ...listOf(pc['behaviors'])]
    if (behaviors.length > 0) config['behaviors'] = behaviors
    if (isRecord(lc['initialState']) || isRecord(pc['initialState'])) {
      config['initialState'] = { ...(isRecord(lc['initialState']) ? lc['initialState'] : {}), ...(isRecord(pc['initialState']) ? pc['initialState'] : {}) }
    }
    const merged: LayoutCapabilityEntry = { ...layoutPersistence, ...(own ?? {}), config }
    if (own) pageCaps[pagePersistenceAt] = merged
    else joined.push(merged)
  }
  const capabilities = [...joined, ...pageCaps]
  const receipt = { ...page, blocks, ...(capabilities.length > 0 || page.capabilities !== undefined ? { capabilities } : {}) } as R
  return { receipt, problems }
}
