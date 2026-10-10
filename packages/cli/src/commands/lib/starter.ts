/**
 * What `pwf create` writes: the starter app's documents, composed only from
 * the block types and themes the foundation pack actually carries.
 */
import type { PackFolder, PackValidation } from '@pwfabric/pack'
import { stripBom } from './identity.js'

export interface FoundationBlock {
  /** Block type a receipt names (the manifest's `name`). */
  readonly type: string
  /** Atom id, `<category>.<name>`. */
  readonly id: string
  /** Prop names the manifest declares. */
  readonly props: readonly string[]
}

export interface FoundationCatalog {
  readonly blocks: readonly FoundationBlock[]
  /** Theme ids (`ui-appearance` atoms). */
  readonly themes: readonly string[]
}

function parseObject(bytes: Uint8Array | undefined): Record<string, unknown> | null {
  if (!bytes) return null
  try {
    const v: unknown = JSON.parse(stripBom(new TextDecoder().decode(bytes)))
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Block types and themes of a pack, from its derived atoms. A block's type is
 * the `name` of the `manifest.json` next to its component (falling back to the
 * last segment of its id); its props are the manifest's `definition.props`.
 */
export function catalogOf(pack: PackFolder, validation: PackValidation): FoundationCatalog {
  const blocks: FoundationBlock[] = []
  const themes: string[] = []
  for (const atom of validation.atoms) {
    if (atom.kind === 'ui-appearance') {
      const manifest = parseObject(pack.files.get(atom.relPath))
      themes.push(typeof manifest?.id === 'string' ? manifest.id : atom.id)
      continue
    }
    if (atom.kind !== 'block') continue
    const dir = atom.relPath.slice(0, atom.relPath.lastIndexOf('/') + 1)
    const manifest = parseObject(pack.files.get(`${dir}manifest.json`))
    const name = typeof manifest?.name === 'string' ? manifest.name : (atom.id.split('.').pop() as string)
    const definition = manifest?.definition as { props?: unknown } | undefined
    const props = Array.isArray(definition?.props)
      ? (definition.props as unknown[]).flatMap((p) =>
          p !== null && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string' ? [(p as { name: string }).name] : []
        )
      : []
    blocks.push({ type: name, id: atom.id, props })
  }
  return { blocks, themes }
}

interface Slot {
  readonly id: string
  readonly types: readonly string[]
  readonly textProps: readonly string[]
  readonly text: (title: string) => string
  readonly extra: Readonly<Record<string, unknown>>
}

/** The starter page, in order: a heading, a paragraph and a button. */
const SLOTS: readonly Slot[] = [
  { id: 'title', types: ['heading', 'title'], textProps: ['text', 'content', 'title', 'label'], text: (t) => t, extra: { level: 'h1' } },
  {
    id: 'intro',
    types: ['text', 'paragraph', 'prose'],
    textProps: ['content', 'text', 'body', 'markdown'],
    text: () => 'Edit app/surfaces/home.receipt.json to change this page, then run pwf dev to see it.',
    extra: {},
  },
  { id: 'cta', types: ['button'], textProps: ['label', 'text'], text: () => 'Get started', extra: { href: '/' } },
]

export interface BlockNode {
  readonly id: string
  readonly type: string
  readonly props: Record<string, unknown>
}

/** Starter blocks for the home page, using only block types the catalog has. */
export function starterBlocks(catalog: FoundationCatalog, title: string): BlockNode[] {
  const out: BlockNode[] = []
  for (const slot of SLOTS) {
    const block = slot.types.map((t) => catalog.blocks.find((b) => b.type === t)).find((b) => b !== undefined)
    if (!block) continue
    const props: Record<string, unknown> = {}
    const textProp = slot.textProps.find((p) => block.props.includes(p))
    if (textProp) props[textProp] = slot.text(title)
    for (const [k, v] of Object.entries(slot.extra)) if (block.props.includes(k)) props[k] = v
    out.push({ id: slot.id, type: block.type, props })
  }
  return out
}

/** The theme the starter uses: `theme-zinc` when present (a neutral default), otherwise the first by id. */
export function starterTheme(catalog: FoundationCatalog): string | undefined {
  if (catalog.themes.includes('theme-zinc')) return 'theme-zinc'
  return [...catalog.themes].sort()[0]
}

/** `my-shop` → `My Shop`. */
export function titleOf(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ')
}

export function starterPlan(name: string, title: string, blocks: readonly BlockNode[], foundationId: string, theme: string | undefined): unknown {
  return {
    title: title.slice(0, 80),
    intent: {
      purpose: `${title}: describe what this app is for`,
      audience: 'Describe who will use it',
      tone: 'Clear and friendly',
      successCriteria: 'The home page renders',
    },
    theme: { direction: 'Clean and neutral', paletteHint: theme ?? 'the foundation default', status: 'applied' },
    capabilities: [],
    media: [],
    customBlocks: [],
    surfaces: [
      {
        key: 'home',
        name: 'Home',
        isEntry: true,
        purpose: `The first page of ${name}`,
        keyContent: blocks.map((b) => b.id),
        linksTo: [],
        usesCapabilities: [],
        usesMedia: [],
        usesCustomBlocks: [],
        status: 'applied',
      },
    ],
    packs: [{ id: foundationId }],
  }
}

export function starterAppearance(theme: string | undefined): unknown {
  return theme ? { use: theme } : { config: { mode: { policy: 'light' } } }
}

export function starterNavigation(): unknown {
  return { navbar: { links: [{ label: 'Home', href: '/' }] } }
}

export function starterReceipt(blocks: readonly BlockNode[]): unknown {
  return { title: 'Home', blocks }
}

export const ATOMS_README_TEXT = `# atoms/

This app's own reusable parts. Empty to start: the app is composed from the
foundation pack pinned in \`pwpack.json\`.

Add a block as \`atoms/blocks/<category>/<name>/component.tsx\` with a
\`manifest.json\` next to it; see the pwpack format and block manifest
documents of the PWFabric specification for every atom family.

This README is documentation, not an atom: it travels with the pack and
validation notes it as such (DOC_FILE).
`

export const GITIGNORE_TEXT = `.pwf/\n*.pwpack\n`
