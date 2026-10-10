/**
 * Surface Renderer
 *
 * Phase 2A.1: Main Surface-to-React rendering component
 *
 * @module @pwfabric/runtime/render/renderer
 */

import * as React from 'react'
import type { Block } from '@pwfabric/core'
import { FLEX_HOIST_KEYS, LAYOUT_HOIST_KEYS } from './scoped-css.js'
import type {
  SurfaceRendererProps,
  BlockRendererProps,
  BlockContext,
  BlockComponentRegistry,
  BlockComponent,
  BlockWrapperProps,
  BlockWrapperRenderArgs,
  CapabilityProvider,
  CapabilityType,
  ImageAdapter,
  BlockSizing,
} from './types.js'
import {
  resolveBlockLayout,
  resolveMeasureStyle,
  resolveSurfaceRootStyle,
  useViewport,
  getColumnsAtBreakpoint,
} from './responsive.js'
import { chunkByWidthScope, resolveWidthScope } from './width-scope.js'
import {
  resolveAppearanceVars,
  resolveAppearanceDarkVars,
  resolveAppearanceKeyframes,
} from './appearance-resolver.js'
import { collectVisibilityCss } from './visibility-css.js'
import { collectStatesCss } from './states-css.js'
import { collectConditionalStatesCss } from './conditional-states-css.js'
import { collectResponsiveStyleCss } from './responsive-style-css.js'
import { collectGroupStatesCss } from './group-states-css.js'
import { buildDarkThemeCss } from './dark-theme-css.js'
import { resolveAppearanceMode } from '@pwfabric/contracts'
import { buildKeyframesCss } from './keyframes-css.js'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { BreakpointName } from '@pwfabric/core'
import type { ImageAdapterProps } from '../adapters/types.js'
import type {
  DynamicBlockDescriptor,
  SurfaceEventDescriptor,
} from '@pwfabric/contracts'
import type { SurfaceEvent } from './types.js'
// `defaultBlockComponents` retired. Production render
// path goes exclusively through the install pipeline — `customComponents`
// (typically wired from `useDynamicArtifacts`) supplies the runtime
// component map; blocks without a descriptor render as
// "Unknown block" placeholders.
import { useEntitlements, GatedBlockPlaceholder } from './capability-gate.js'
import { useDynamicBlocks } from './dynamic-artifact-context.js'
import { DynamicBlockWrapper } from './DynamicBlockWrapper.js'
import { BlockErrorBoundary } from './BlockErrorBoundary.js'
import { BehaviorSurfaceProvider } from './BehaviorSurfaceProvider.js'
import { isCapability } from '../capability/type-mapping.js'
import type { SurfaceDataSourceDefinition } from './data-binding-types.js'
import { EntityFacadeContext } from './entity-facade-context.js'
import { SurfaceConnectionsContext } from './connections-context.js'
import { ShellSelectionProvider } from './shell-selection.js'
import type { FormEntityBridgeConfig } from '../forms/form-entity-bridge.js'
import { isRepeatExpanded } from './resolve-expressions.js'

// ============================================================
// HELPERS
// ============================================================

/**
 * Merge component registries, filtering out undefined values
 */
function mergeComponentRegistries(
  base: BlockComponentRegistry | Partial<BlockComponentRegistry> = {},
  overrides?: Partial<BlockComponentRegistry>
): BlockComponentRegistry {
  const merged: BlockComponentRegistry = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) merged[key] = value
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) merged[key] = value
    }
  }
  return merged
}

/**
 * Project a canonical `SurfaceEventDescriptor.type` (contracts vocabulary, e.g.
 * `'block:click'`, `'form:submit'`, `'input:change'`) onto the renderer's legacy
 * `SurfaceEvent['type']` enum. Anything without a direct legacy equivalent
 * collapses to `'custom'`. Only used to satisfy the `onEvent` handler's shape —
 * the dispatcher reads `blockId`/`payload`, not the projected `type`.
 */
function mapCanonicalEventType(type: string): SurfaceEvent['type'] {
  switch (type) {
    case 'block:click':
      return 'click'
    case 'form:submit':
      return 'submit'
    case 'form:change':
    case 'input:change':
      return 'change'
    default:
      return 'custom'
  }
}

/**
 * Create an ImageBlock component that uses the provided adapter
 */
function createImageBlockWithAdapter(adapter: ImageAdapter): BlockComponent {
  return ({ props, block }): React.ReactNode => {
    // Build adapter props, only including defined values
    const adapterProps: ImageAdapterProps = {
      src: (props.src as string) || '/placeholder.png',
      alt: (props.alt as string) ?? '',
      blockId: block.id,
    }

    // Add optional props only if they have values
    if (props.width !== undefined) {
      ;(adapterProps as { width: number | string }).width = props.width as number | string
    }
    if (props.height !== undefined) {
      ;(adapterProps as { height: number | string }).height = props.height as number | string
    }
    if (props.loading !== undefined) {
      ;(adapterProps as { loading: 'lazy' | 'eager' }).loading = props.loading as 'lazy' | 'eager'
      ;(adapterProps as { priority: boolean }).priority = props.loading === 'eager'
    }
    if (props.objectFit !== undefined) {
      ;(adapterProps as { objectFit: ImageAdapterProps['objectFit'] }).objectFit =
        props.objectFit as ImageAdapterProps['objectFit']
    }
    if (props.aspectRatio !== undefined) {
      ;(adapterProps as { aspectRatio: string }).aspectRatio = props.aspectRatio as string
    }
    if (props.borderRadius !== undefined) {
      ;(adapterProps as { borderRadius: number | string }).borderRadius = props.borderRadius as
        | number
        | string
    }
    if (props.placeholder !== undefined) {
      ;(adapterProps as { placeholder: 'blur' | 'empty' }).placeholder = props.placeholder as
        | 'blur'
        | 'empty'
    }
    if (props.blurDataURL !== undefined) {
      ;(adapterProps as { blurDataURL: string }).blurDataURL = props.blurDataURL as string
    }

    return React.createElement(adapter, adapterProps)
  }
}

// ============================================================
// BLOCK WRAPPER SEAM (ADR render-unification)
// ============================================================

type RenderBlockWrapperFn = (args: BlockWrapperRenderArgs) => React.ReactNode

/**
 * Emit a block's outermost wrapper. When `renderBlockWrapper` is provided
 * (editor seam) the decorator owns the wrapper element and receives the
 * runtime-computed `wrapperProps` (layout style + selectors). Otherwise the
 * default `<div {...wrapperProps}>` is rendered — byte-identical to the
 * pre-seam runtime (modulo the unified `data-block-id`).
 */
/**
 * The attributes EVERY wrapper must carry — in one place.
 *
 * `states-css.ts` and `conditional-states-css.ts` EXCLUDE the wrapper from
 * their state rules with `:not([data-block-wrapper])`. Without the attribute
 * there is no exclusion: a rule matches both the wrapper and the component
 * root, and the defect described in states-css comes back ("the square
 * wrapper takes the hover box-shadow, corners show under the rounded card,
 * transforms stack") — on every block, including blocks installed from a pack.
 *
 * All four call sites derive from this base, so they cannot drift apart.
 */
function baseWrapperProps(
  block: { id: string },
  layoutStyle: React.CSSProperties | undefined,
  scopeAttr: Record<string, string>
): BlockWrapperProps {
  return {
    // `exactOptionalPropertyTypes`: an optional field cannot be given an
    // explicit `undefined`; when absent it is left out.
    ...(layoutStyle ? { style: layoutStyle } : {}),
    id: block.id,
    'data-block-id': block.id,
    ...scopeAttr,
    // `data-block-wrapper`: an ALIAS carrying the same value as `data-block-id`
    // but with a separate job — the one marker that tells the wrapper apart
    // from the component root.
    'data-block-wrapper': block.id,
  }
}

function emitBlockWrapper(
  block: Block,
  wrapperProps: BlockWrapperProps,
  inner: React.ReactNode,
  parentBlock: Block | undefined,
  renderBlockWrapper: RenderBlockWrapperFn | undefined
): React.ReactNode {
  if (renderBlockWrapper) {
    return (
      <React.Fragment key={block.id}>
        {renderBlockWrapper({
          block,
          children: inner,
          wrapperProps,
          ...(parentBlock !== undefined ? { parentBlock } : {}),
        })}
      </React.Fragment>
    )
  }
  return (
    <div key={block.id} {...wrapperProps}>
      {inner}
    </div>
  )
}

// ============================================================
// RESPONSIVE STYLE FLATTENING
// ============================================================

/**
 * Strip a block's responsive (`{ xs?, sm?, … }`) `style` prop values for INLINE
 * application: those are emitted ENTIRELY as scoped stylesheet rules by
 * `collectResponsiveStyleCss` (base as a non-media rule + larger breakpoints as
 * `@media`). They must NOT be applied inline — inline declarations beat
 * stylesheet/@media rules, so an inline base would pin the value and the
 * responsive overrides would never take effect. Flat string values pass through
 * untouched. Returns the SAME block object when no responsive value is present
 * (zero allocation for existing surfaces).
 */
function flattenResponsiveStyle(block: Block): Block {
  const style = block.style
  if (!style) return block
  let hasResponsive = false
  const flat: Record<string, string> = {}
  for (const [prop, value] of Object.entries(style)) {
    if (typeof value === 'string') {
      flat[prop] = value
      continue
    }
    if (value === null || value === undefined) continue
    // Responsive value map → handled ENTIRELY by responsive-style-css (base as a
    // non-media scoped rule + larger breakpoints as @media). It must NOT be
    // applied inline: inline declarations beat stylesheet/@media rules, so an
    // inline base would pin the value and the responsive overrides would never
    // take effect. Strip it from the inline style here.
    hasResponsive = true
  }
  if (!hasResponsive) return block
  return { ...block, style: flat }
}

// ============================================================
// BLOCK RENDERER
// ============================================================

/**
 * Compute a block's grid/flex layout style. Applied to EVERY render path
 * (static, dynamic, unknown, gated) so installed dynamic blocks lay out
 * identically to static ones — otherwise full-span dynamic sections auto-place
 * side-by-side instead of stacking.
 */
/**
 * CHROME IS DECLARED, NOT HARD-CODED.
 *
 * The engine keeps no list of chrome block names (navbar, rail, bottom bar…):
 * such a list would be one pack's vocabulary, and a second pack could not
 * express its own chrome. Instead a block declares its own
 * `layout.widthScope` and the engine applies it. That a piece of chrome
 * inside a row is not stretched to an equal column also follows from that
 * declaration (see `resolveWidthScope` below).
 *
 * The one name kept below, `split-view`, is not pack vocabulary: it is a
 * LAYOUT block that places its own children and keeps the selection in
 * surface-owned state (see `shell-selection`).
 */
const CHILD_LAYOUT_OWNER = 'split-view'

// Style keys hoisted from block.style to the WRAPPER div (the flex/grid item).
// Module-scoped because renderBlock must strip the SAME keys from the style the
// component receives — otherwise a margin is applied twice (wrapper + inner):
// marginTop:'-40%' would move content by -335px AND -256px.
// FLEX_HOIST_KEYS / LAYOUT_HOIST_KEYS live in scoped-css.ts — the responsive
// CSS generator must read the SAME list (one hoisting rule, one place).

/** block.style minus the hoisted keys — what the component itself may apply. */
function stripHoistedStyle(block: Block): Block {
  const style = block.style as Record<string, unknown> | undefined
  if (!style) return block
  let has = false
  for (const key of LAYOUT_HOIST_KEYS) if (style[key] !== undefined) { has = true; break }
  if (!has) return block
  const rest: Record<string, unknown> = { ...style }
  for (const key of LAYOUT_HOIST_KEYS) delete rest[key]
  return { ...block, style: rest } as Block
}

/**
 * ROW STACKING LAW.
 *
 * A `container` with `direction: 'row'` is a flex row with `nowrap`; without
 * this rule nothing turns it into a column on a phone, so on xs a heading
 * sits squeezed beside a segmented control that overflows, navbar pills run
 * off the edge, and a two-column body becomes two 190px columns.
 *
 * The law: at the `xs` breakpoint a row container whose children include at
 * least TWO non-intrinsic blocks renders as a column. Rows made of intrinsic
 * blocks (avatar + name, icon + label, a button pair) are content rows and
 * keep their direction. Authors opt out with `keepRow: true`; a row that
 * already declares `wrap: true` handles itself. The stacked container carries
 * `stackedFromRow: true` so child layout does not apply column-mode
 * partial-span widths to what used to be row cells.
 */
const ROW_DIRECTIONS = new Set(['row', 'row-reverse'])
function applyRowStacking(
  block: Block,
  viewport: BreakpointName,
  components: BlockComponentRegistry
): Block {
  if (viewport !== 'xs' || block.type !== 'container') return block
  const props = (block.props ?? {}) as Record<string, unknown>
  if (!ROW_DIRECTIONS.has(String(props.direction))) return block
  if (props.keepRow === true || props.wrap === true) return block
  const children = block.children ?? []
  const fluid = children.filter((c) => components[c.type]?.sizing !== 'intrinsic').length
  if (fluid < 2) return block
  return { ...block, props: { ...props, direction: 'column', stackedFromRow: true } }
}

const FIXED_PX_WIDTH = /^\s*\d+(?:\.\d+)?\s*px\s*$/i

/**
 * A width that is a fixed length — a finite number (px, the props unit) or a
 * `px` string. Percentages, `auto`, `fit-content`, theme vars and
 * responsive maps are NOT fixed: they say nothing about the block keeping
 * its own size in a row.
 */
function isFixedWidth(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  return typeof value === 'string' && FIXED_PX_WIDTH.test(value) && parseFloat(value) > 0
}

/** The instance states a fixed width in `props.width` or `style.width`. */
function hasFixedWidth(block: Block): boolean {
  const props = block.props as Record<string, unknown> | undefined
  const style = block.style as Record<string, unknown> | undefined
  return isFixedWidth(props?.width) || isFixedWidth(style?.width)
}

function computeBlockLayoutStyle(
  block: Block,
  parentBlock: Block | undefined,
  viewport: BreakpointName,
  sizing?: BlockSizing
): React.CSSProperties {
  // Skip grid-column when parent manages its own layout (grid, container, form, etc.)
  const parentType = parentBlock?.type
  // A child that EXPLICITLY declares layout.span keeps it inside a grid parent.
  // Otherwise asymmetric 12-col layouts are impossible: the declaration would
  // be silently swallowed. Grid stays the owner only for span-less children
  // (equal auto columns, the default).
  const childDeclaresSpan = block.layout?.span !== undefined
  // A parent that expanded a `repeat` (the repeater family, or any block that
  // repeats) lays its clones out with its own grid/columns — the clones must
  // not carry the surface's 12-column span into it. A grid
  // parent keeps its own rule above.
  const parentRepeats = parentType !== 'grid' && isRepeatExpanded(parentBlock)
  const parentOwnsLayout =
    parentRepeats ||
    (parentType === 'grid' && !childDeclaresSpan) ||
    parentType === 'container' ||
    parentType === 'section' ||
    parentType === 'form' ||
    parentType === 'tabs' ||
    parentType === 'tooltip' ||
    parentType === CHILD_LAYOUT_OWNER

  const layout = block.layout ?? DEFAULT_BLOCK_LAYOUT
  const resolved = resolveBlockLayout(layout, viewport)

  // Column container children: apply explicit width when span < surface columns
  const parentDirection = parentBlock?.props?.direction as string | undefined
  // A row stacked by the ROW STACKING LAW is not an authored column: its
  // children were row cells, so their partial spans must not become widths.
  const parentStackedFromRow = parentBlock?.props?.stackedFromRow === true
  const isColumnContainer =
    parentType === 'container' &&
    (parentDirection === 'column' || parentDirection === undefined) &&
    !parentStackedFromRow

  let columnChildWidth: string | undefined
  if (isColumnContainer && parentBlock) {
    const surfaceCols = getColumnsAtBreakpoint(viewport)
    const parentCols = resolveBlockLayout(parentBlock.layout ?? DEFAULT_BLOCK_LAYOUT, viewport).span
    if (resolved.span < surfaceCols) {
      columnChildWidth = `${(resolved.span / parentCols) * 100}%`
    }
  }

  // Row container children: apply flexBasis so spans translate to proportional widths.
  //
  // Weighted columns: a child's OWN `block.style` flex hints win over the span-derived
  // default. The wrapper is the flex item — so `flex`/`flexGrow`/`flexBasis`/`flexShrink`
  // declared on a child must land on the wrapper, not the inner block. When present they
  // fully replace the default span/equal distribution, letting an author express an
  // arbitrary ratio (e.g. `flex:"1.62 1 0"` + `flex:"1 1 0"` → exact 1.62:1 columns)
  // that the integer-span model cannot. `layout.span` remains the default when no flex
  // hint is given.
  const childStyle = block.style as React.CSSProperties | undefined
  const childHasFlexHint =
    childStyle !== undefined && FLEX_HOIST_KEYS.some((k) => childStyle[k] !== undefined)

  const isRowContainer = parentType === 'container' && parentDirection === 'row'

  let rowChildStyle: React.CSSProperties | undefined
  // A rail beside a row is NOT one of two equal columns. The default below
  // gives every row child `flex: 1 1 0` — right for two content columns,
  // wrong for chrome: it would stretch a 76px rail to half the row and squeeze
  // the body it exists to sit beside. The block DECLARES its own scope.
  if (isRowContainer && resolveWidthScope(block, viewport) === 'viewport' && !childHasFlexHint) {
    rowChildStyle = { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', alignSelf: 'stretch' }
  } else if (
    isRowContainer &&
    (sizing === 'intrinsic' || hasFixedWidth(block)) &&
    !childHasFlexHint
  ) {
    // The block declared its width is its content (avatar, badge, button…):
    // it keeps that width; whatever sits beside it takes the rest. Without
    // this every such block would take half the row.
    //
    // The same holds for an INSTANCE that states a fixed width (a 56px
    // thumbnail beside a product title). `sizing` is static per block type,
    // so a fluid-by-default block (image) cannot declare it; the instance's
    // own numeric/px width is the declaration. Without it a 56px image took
    // the equal share and squeezed the text beside it into two lines.
    rowChildStyle = { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }
  } else if (isRowContainer && parentBlock && !childHasFlexHint) {
    // No author flex hint → derive proportional width from the integer span.
    const surfaceCols = getColumnsAtBreakpoint(viewport)
    const parentCols = resolveBlockLayout(parentBlock.layout ?? DEFAULT_BLOCK_LAYOUT, viewport).span
    if (resolved.span < surfaceCols) {
      // Explicit partial span → proportional width
      rowChildStyle = {
        flexBasis: `${(resolved.span / parentCols) * 100}%`,
        flexGrow: 0,
        flexShrink: 0,
      }
    } else {
      // Default/full-width span → equal distribution
      rowChildStyle = { flexGrow: 1, flexShrink: 1, flexBasis: '0' }
    }
  }

  // Hoist layout-positioning props (margin/maxWidth/minWidth) to the wrapper div so
  // grid-item centering works (the inner block element is usually width:100%). Flex
  // hints hoist here too so a row-container child's authored ratio reaches the flex
  // item (the wrapper) rather than the inner block.
  const hoistedStyle: React.CSSProperties = {}
  if (block.style) {
    for (const key of LAYOUT_HOIST_KEYS) {
      const val = (block.style as React.CSSProperties)[key]
      if (val !== undefined) {
        ;(hoistedStyle as Record<string, unknown>)[key] = val
      }
    }
  }
  // Auto-center when maxWidth is set without an explicit margin.
  if (
    hoistedStyle.maxWidth !== undefined &&
    hoistedStyle.margin === undefined &&
    hoistedStyle.marginLeft === undefined &&
    hoistedStyle.marginRight === undefined
  ) {
    hoistedStyle.margin = '0 auto'
    // An auto-centred max-width block FILLS up to its max width, as a block
    // box with `max-width` + `margin: 0 auto` does in normal flow. Inside a
    // flex column or a grid cell, auto inline margins cancel `stretch`, so
    // without an explicit width the wrapper shrank to its content and the
    // inner `width:100%` resolved against that shrunken box (
    // a two-pane doc shell collapsed to 307 px and the panes stacked unless
    // the selected text was long, and content columns narrowed).
    // Not applied where the block keeps its own width: an intrinsic block
    // (button, badge), a row cell (its flex basis is the width), a column
    // child with a span-derived width, or an authored non-100% width.
    const authoredWidth = (block.style as React.CSSProperties | undefined)?.width
    if (
      sizing !== 'intrinsic' &&
      !isRowContainer &&
      columnChildWidth === undefined &&
      (authoredWidth === undefined || authoredWidth === '100%')
    ) {
      hoistedStyle.width = '100%'
    }
  }

  // Interaction states (block.states) are rendered as scoped `:hover`/`:active`/
  // `:focus-visible` CSS rules elsewhere; here we add a default `transition` to
  // the base wrapper style so the state change animates. Authors can still
  // override via `block.style.transition`, and `prefers-reduced-motion`
  // (SURFACE_BASE_CSS) neutralises it for users who opt out.
  const hasStates = block.states !== undefined && block.states !== null
  const transitionStyle: React.CSSProperties =
    hasStates && (block.style as React.CSSProperties | undefined)?.transition === undefined
      ? { transition: 'all var(--pw-duration-fast, 150ms) var(--pw-easing, ease)' }
      : {}

  // GRID items default to min-width:auto, which lets nowrap/max-content content
  // leak its intrinsic width into track sizing even under overflow:hidden
  // (measured: a marquee pushed the whole page 63px). Zero it for grid items
  // only — on FLEX children min-width:auto is load-bearing (equal-distribution
  // rows keep children at least min-content wide; zeroing it made a highlighted
  // word stretch to half the row). An author's own minWidth (hoisted) wins.
  const isGridItem = !parentOwnsLayout || parentType === 'grid'
  return {
    ...(isGridItem ? { minWidth: 0 } : {}),
    ...(!parentOwnsLayout ? { gridColumn: `span ${resolved.span} / span ${resolved.span}` } : {}),
    ...(resolved.offset !== undefined && !parentOwnsLayout
      ? { gridColumnStart: resolved.offset + 1 }
      : {}),
    ...(columnChildWidth !== undefined ? { width: columnChildWidth } : {}),
    ...(rowChildStyle ?? {}),
    ...(resolved.order !== undefined ? { order: resolved.order } : {}),
    ...(resolved.hidden ? { display: 'none' } : {}),
    ...transitionStyle,
    ...hoistedStyle,
  }
}

/**
 * Render a single block recursively.
 * parentBlock is used to determine the CSS strategy for nested blocks.
 * entitlementCheck gates unentitled blocks.
 * dynamicBlocks provides dynamic block descriptors for fallback rendering.
 */
function renderBlock(
  { block: rawBlock, context, components }: BlockRendererProps,
  parentBlock?: Block,
  entitlementCheck?: (blockType: string) => boolean,
  dynamicBlocks?: ReadonlyMap<string, DynamicBlockDescriptor>,
  renderBlockWrapper?: RenderBlockWrapperFn
): React.ReactNode {
  // Per-prop responsive styles (block.style values that are `{ xs?, … }` maps)
  // can't be expressed inline as media queries — flatten them to their base
  // value here so the inline path (this block + computeBlockLayoutStyle hoists)
  // sees a flat `Record<string,string>`; the larger-breakpoint values are
  // emitted as scoped media-query CSS by collectResponsiveStyleCss.
  const block = applyRowStacking(
    flattenResponsiveStyle(rawBlock),
    (context.viewport ?? 'lg') as BreakpointName,
    components
  )
  // Layout applies to EVERY path below (static/dynamic/unknown/gated) so installed
  // dynamic blocks get the same grid span/width/centering as static ones. Previously
  // only the static path applied it → full-span dynamic sections collapsed side-by-side.
  const layoutStyle = computeBlockLayoutStyle(
    block,
    parentBlock,
    (context.viewport ?? 'lg') as BreakpointName,
    components[block.type]?.sizing
  )

  // Scope stamp. A viewport audit needs to see the declaration in the DOM to
  // say "viewport was declared but the block does not reach the edge"; the
  // style alone carries the result, not the declaration.
  const scopeAttr =
    resolveWidthScope(block, (context.viewport ?? 'lg') as BreakpointName) === 'viewport'
      ? { 'data-pw-width-scope': 'viewport' }
      : {}

  // Gate check — show placeholder for unentitled blocks
  // Dynamic blocks with descriptors are entitled (installed + built)
  if (entitlementCheck && !entitlementCheck(block.type) && !dynamicBlocks?.has(block.type)) {
    return emitBlockWrapper(
      block,
      baseWrapperProps(block, layoutStyle, scopeAttr),
      <GatedBlockPlaceholder blockId={block.id} blockType={block.type} />,
      parentBlock,
      renderBlockWrapper
    )
  }

  // Install-only render — when the world has the atom
  // installed (CDN bundle URL on the descriptor) the dynamic wrapper
  // takes over. `customComponents` may still supply test/preview-time
  // component overrides, but the legacy `defaultBlockComponents` map is
  // gone; unmatched block types render as "Unknown block" placeholders.
  const dynamicDescriptor = dynamicBlocks?.get(block.type)
  if (dynamicDescriptor) {
    let dynamicChildren: React.ReactNode = null
    if (block.children && block.children.length > 0) {
      dynamicChildren = block.children.map((child) =>
        renderBlock(
          { block: child, context, components },
          block,
          entitlementCheck,
          dynamicBlocks,
          renderBlockWrapper
        )
      )
    }
    return emitBlockWrapper(
      block,
      { ...baseWrapperProps(block, layoutStyle, scopeAttr), 'data-dynamic-block': block.type },
      <BlockErrorBoundary blockId={block.id} blockType={block.type}>
        <DynamicBlockWrapper descriptor={dynamicDescriptor} block={stripHoistedStyle(block)} context={context}>
          {dynamicChildren}
        </DynamicBlockWrapper>
      </BlockErrorBoundary>,
      parentBlock,
      renderBlockWrapper
    )
  }

  const Component = components[block.type]

  if (!Component) {
    console.warn(`Unknown block type: ${block.type}`)
    // Render children so a partial subtree still shows when a block type isn't
    // installed (e.g. an uninstalled "Container" wrapper), but DON'T surface a
    // visible "Unknown block: <type>" placeholder to end users on published /
    // preview surfaces — that read as a broken page. The console.warn above and
    // the `data-unknown-type` attribute keep it diagnosable, and the authoring
    // editor uses its own EditableBlock placeholder, so nothing is lost there.
    let unknownChildren: React.ReactNode = null
    if (block.children && block.children.length > 0) {
      unknownChildren = block.children.map((child) =>
        renderBlock(
          { block: child, context, components },
          block,
          entitlementCheck,
          dynamicBlocks,
          renderBlockWrapper
        )
      )
    }
    return emitBlockWrapper(
      block,
      { ...baseWrapperProps(block, layoutStyle, scopeAttr), 'data-unknown-type': block.type },
      <>{unknownChildren}</>,
      parentBlock,
      renderBlockWrapper
    )
  }

  // Recursively render children — current block becomes the parent
  let children: React.ReactNode = null
  if (block.children && block.children.length > 0) {
    children = block.children.map((child) =>
      renderBlock(
        { block: child, context, components },
        block,
        entitlementCheck,
        dynamicBlocks,
        renderBlockWrapper
      )
    )
  }

  // TODO: When FormBlock contract includes `bindToEntity` prop,
  // call attachFormEntityBridge(bus, entityStore, { formId: block.id, ...block.props.bindToEntity })
  // Requires: platform/entities capability active (platform/input retired).
  // See packages/runtime/src/forms/form-entity-bridge.ts for the bridge implementation.

  return emitBlockWrapper(
    block,
    baseWrapperProps(block, layoutStyle, scopeAttr),
    <BlockErrorBoundary blockId={block.id} blockType={block.type}>
      <Component block={stripHoistedStyle(block)} props={block.props ?? {}} context={context}>
        {children}
      </Component>
    </BlockErrorBoundary>,
    parentBlock,
    renderBlockWrapper
  )
}

// ============================================================
// BASE CSS STANDARD (box-sizing reset)
// ============================================================

/**
 * Scoped box-sizing reset injected at the surface render root.
 *
 * `box-sizing` is NOT an inherited CSS property, so setting it only on the
 * `[data-pw-surface]` root would leave every descendant at the browser
 * default `content-box`. Under `content-box`, a block declared `width:100%`
 * with padding (e.g. `layout/section` padding:80) computes its border-box
 * width as `100% + padding` and overflows its parent → horizontal scroll.
 * A descendant selector (`[data-pw-surface] *`) is therefore required so
 * every block inside the surface respects its declared width.
 *
 * The reset is scoped to the `[data-pw-surface]` subtree (root + descendants
 * + their generated `::before`/`::after` boxes) rather than emitted as a
 * global `*{}` rule so it cannot leak into and reset a host page that embeds
 * the surface. This makes the standard ship from the runtime itself — a host
 * app, the embed bundle, and a preview tool all inherit it for free.
 */
const SURFACE_BASE_CSS =
  '[data-pw-surface],' +
  '[data-pw-surface] *,' +
  '[data-pw-surface] *::before,' +
  '[data-pw-surface] *::after{box-sizing:border-box}' +
  // Horizontal-overflow guard. Reference pages protect themselves with
  // body{overflow-x:hidden}; a surface must not rely on its host for that.
  // `clip` (not `hidden`) so no scroll container is created and position:sticky
  // descendants keep working.
  '[data-pw-surface]{overflow-x:clip}' +
  // Surface root paints the THEME ground (light/dark). Without this the
  // root stays transparent and content OUTSIDE a card (a bare heading/section)
  // shows the host page's own background — fine in light mode, but in dark mode
  // (derived dark vars) it left light text on a white page → unreadable. Painting
  // background+color from the tokens makes the whole surface follow the mode
  // (the dark <style> block re-resolves --pw-color-* under [data-pw-theme]/@media).
  // Scoped to the root only (not descendants) so blocks still set their own.
  '[data-pw-surface]{background:var(--pw-color-background);color:var(--pw-color-text);' +
  // The BODY FONT, bound on the root like the ground. Only the published
  // theme.css bound it (on html,body), so a serif-bodied theme (rose) read
  // serif on the published page and in the host font on the canvas and in an
  // embed. Blocks inherit it; a block that sets its own font still wins.
  // `inherit` keeps the host font when a theme declares none.
  'font-family:var(--pw-font-family,inherit);font-size:var(--pw-font-size-base,inherit);' +
  'line-height:var(--pw-line-height-body,inherit)}' +
  // Controls take the surface font. Browsers give button, input,
  // select and textarea their OWN system font instead of inheriting, so a
  // themed page showed its body face everywhere except in its controls (a
  // serif theme rendered sans-serif buttons). Family only: sizes and colours stay the
  // block's. :where() keeps specificity at zero so a block's own font wins.
  '[data-pw-surface] :where(button,input,select,textarea,optgroup){font-family:inherit}' +
  // Centralised keyboard focus ring (WCAG 2.4.7/2.4.11) — every focusable element
  // inside the surface gets the theme's --pw-focus-ring-* (with on-brand AA fallbacks)
  // instead of each block hard-coding (or dropping) a ring. :where() = zero
  // specificity so a block can still override. A tenant re-skin changes the ring in
  // one place; it can never silently lose focus visibility.
  '[data-pw-surface] :where(a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])):focus-visible{' +
  'outline:var(--pw-focus-ring-width,2px) solid var(--pw-focus-ring-color,#4f46e5);' +
  'outline-offset:var(--pw-focus-ring-offset,2px)}' +
  // Named animation keyframes shipped from the runtime so a block can drive
  // motion via `block.style.animation: 'pw-pulse 1.5s ease-in-out infinite'` (or
  // pw-marquee / pw-fade-in) WITHOUT each surface defining @keyframes (block.style
  // can't). Names are pw-* to avoid host-page collision. Covers the soundwave-pulse
  // / logo-marquee patterns that previously had no offline-capable expression.
  '@keyframes pw-pulse{0%,100%{opacity:1}50%{opacity:.45}}' +
  '@keyframes pw-fade-in{from{opacity:0}to{opacity:1}}' +
  '@keyframes pw-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}' +
  // Batch-1 animation library — entrance/loop motion blocks can drive via
  // block.style.animation without defining @keyframes.
  '@keyframes pw-slide-up{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}' +
  '@keyframes pw-slide-down{from{transform:translateY(-8px);opacity:0}to{transform:translateY(0);opacity:1}}' +
  '@keyframes pw-scale-in{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}' +
  '@keyframes pw-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}' +
  '@keyframes pw-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-25%)}}' +
  // Spring ENTRANCE (Dalga 1, core (d)). pw-bounce is a vertical loop and the
  // theme's --pw-easing-bounce token had no entrance keyframe to ride on, so
  // delivered apps reached for pw-pulse. The overshoot is the keyframe's own
  // timing function: `animation: pw-spring-in .4s` springs with no easing
  // named, a theme re-tunes it through the token, and the fallback is the
  // token's canonical default (surface-theme.ts). Reduced-motion gated below.
  '@keyframes pw-spring-in{from{transform:scale(.9);opacity:0;' +
  'animation-timing-function:var(--pw-easing-bounce,cubic-bezier(0.34, 1.56, 0.64, 1))}' +
  'to{transform:scale(1);opacity:1}}' +
  // Interaction-state transitions (theme motion tokens): every interactive
  // element eases its colour/elevation changes instead of snapping — the
  // micro-polish half of hover/focus/pressed feedback that inline block
  // styles cannot express (pseudo-states need a stylesheet). :where() keeps
  // specificity at zero so any block's own transition wins; the property
  // list is colour/elevation-only (no `all`) so layout-affecting properties
  // never animate by accident. Durations/easing come from the theme's motion
  // tokens with the old instant behaviour recoverable per-theme by setting
  // them to 0ms. The reduced-motion rule below already neutralises these.
  '[data-pw-surface] :where(a,button,input,select,textarea,[role="button"]):not(:disabled){' +
  'transition:background-color var(--pw-duration-fast,150ms) var(--pw-easing,ease),' +
  'color var(--pw-duration-fast,150ms) var(--pw-easing,ease),' +
  'border-color var(--pw-duration-fast,150ms) var(--pw-easing,ease),' +
  'box-shadow var(--pw-duration-fast,150ms) var(--pw-easing,ease),' +
  'opacity var(--pw-duration-fast,150ms) var(--pw-easing,ease),' +
  'filter var(--pw-duration-fast,150ms) var(--pw-easing,ease)}' +
  // Honour reduced-motion: neutralise pw-* animations + transitions for users who
  // opt out (a11y). Covers pseudo-elements too.
  '@media (prefers-reduced-motion:reduce){[data-pw-surface] *,[data-pw-surface] *::before,[data-pw-surface] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}' +
  // iOS safe-area insets. Host apps already set `viewport-fit=cover`, so
  // env(safe-area-inset-*) is live but nothing consumed it → on notch /
  // Dynamic-Island / home-indicator devices sticky navbars tuck under the notch
  // and trailing footers/bottom bars sit under the home indicator. These rules
  // make EVERY published surface (embed, preview, host app) inset-aware at a
  // single point. The surface root takes the horizontal insets; navbar/footer
  // block roots (which emit data-block-type) take the vertical ones. max(N,env)
  // keeps each ≥ its normal value when no inset exists (env resolves to 0px),
  // so a static mid-page navbar only ever gains pad on an actual inset device.
  '[data-pw-surface]{' +
  'padding-left:max(0px,env(safe-area-inset-left));' +
  'padding-right:max(0px,env(safe-area-inset-right))}' +
  '[data-pw-surface] [data-block-type="navbar"]{' +
  'padding-top:max(12px,env(safe-area-inset-top))}' +
  '[data-pw-surface] [data-block-type="footer"]{' +
  'padding-bottom:max(48px,env(safe-area-inset-bottom))}'

// ============================================================
// SURFACE RENDERER COMPONENT
// ============================================================

/**
 * SurfaceRenderer component
 *
 * Renders a surface definition to React components. surface
 * definitions come from the pack-derived registry (the host's installed
 * blocks and receipts) rather than hardcoded starter exports.
 */
export function SurfaceRenderer({
  surface,
  capabilities = [],
  theme = 'light',
  projectTheme,
  projectDarkTheme,
  basePath = '',
  onEvent,
  components: customComponents,
  className,
  viewport: viewportProp,
  gap,
  padding,
  imageAdapter,
  entityFacade,
  connections,
  renderBlockWrapper,
  interactionMode = 'live',
}: SurfaceRendererProps): React.ReactElement {
  // Use explicit viewport or auto-detect
  const autoViewport = useViewport()
  const viewport = viewportProp ?? autoViewport
  // `onEvent` is a pure notification — it ALWAYS flows, even in inert mode, so
  // the host (editor/preview) can observe interactions and give feedback. The
  // `interactionMode` flag (threaded into BlockContext below) is what gates real
  // side-effects: blocks must skip navigation / data writes when `inert`.
  const effectiveOnEvent = onEvent

  // Canonical bus → renderer `onEvent` bridge. The `BehaviorSurfaceProvider`
  // subscribes this to the bus' global `*` wildcard, so every block-emitted
  // `SurfaceEventDescriptor` (contracts vocabulary: namespaced `type` string +
  // `surfaceId`/`payload`/`timestamp`) reaches the renderer's `onEvent` handler
  // — i.e. `DataBoundSurfaceRenderer.handleEvent`, which dispatches a form's
  // `payload.action` setState and a block's `action` prop. The handler consumes
  // the legacy `SurfaceEvent` shape (`{type, blockId, payload}`), so we project
  // the descriptor onto it: the canonical namespaced type maps to its legacy
  // equivalent, with anything else collapsing to `'custom'` (blockId/payload pass
  // through unchanged — that is all the dispatcher reads).
  const busOnEvent = React.useMemo(() => {
    if (!effectiveOnEvent) return undefined
    return (event: SurfaceEventDescriptor): void => {
      // Surface lifecycle events (`surface:load`/`surface:unload`) are bus-internal
      // and were never part of the legacy `onEvent` host/dispatcher contract — only
      // block interactions flow to the renderer's handler. Skip them so the host
      // callback (and the DataBound dispatcher) see exactly the block-level events
      // they saw under the retired `context.onEvent` path.
      if (event.type.startsWith('surface:')) return
      effectiveOnEvent({
        type: mapCanonicalEventType(event.type),
        blockId: event.blockId ?? '',
        ...(event.payload !== undefined ? { payload: event.payload } : {}),
        canonicalType: event.type,
      })
    }
  }, [effectiveOnEvent])
  // Build capability map
  const capabilityMap = React.useMemo(() => {
    const map = new Map<CapabilityType, CapabilityProvider>()
    for (const cap of capabilities) {
      map.set(cap.type, cap)
    }
    return map
  }, [capabilities])

  // Build block context (theme removed from BlockContext)
  const context: BlockContext = React.useMemo(
    () => ({
      capabilities: capabilityMap,
      basePath,
      onEvent: effectiveOnEvent,
      imageAdapter,
      viewport,
      interactionMode,
    }),
    [capabilityMap, basePath, effectiveOnEvent, imageAdapter, viewport, interactionMode]
  )

  // Create image component override if adapter is provided
  const imageComponentOverride = React.useMemo(() => {
    if (!imageAdapter) return undefined
    return { image: createImageBlockWithAdapter(imageAdapter) }
  }, [imageAdapter])

  // Merge component registries (image adapter takes precedence over custom components)
  // `defaultBlockComponents` removed; `customComponents`
  // is now the only static seed for the registry alongside the image override.
  const componentRegistry = React.useMemo(
    () => mergeComponentRegistries(customComponents, imageComponentOverride),
    [customComponents, imageComponentOverride]
  )

  // Read entitlements from context
  const { isBlockEntitled, loaded: entitlementsLoaded } = useEntitlements()
  const entitlementCheck = entitlementsLoaded ? isBlockEntitled : undefined

  // Read dynamic block descriptors
  const { blocks: dynamicBlockMap } = useDynamicBlocks()

  // The root FLOWS; the measure lives in an INNER container.
  //
  // If the root carried grid + `maxWidth` + `margin:0 auto`, persistent
  // navigation chrome would sit inside the centred box too (at 1536px a rail
  // would start 218px in from the screen edge). The rule: chrome belongs to
  // the viewport, the body to the measure.
  //
  // Gap/padding come from CSS variables so the `surface.theme.layout` tokens
  // take effect; the variables are set on this element through `themeVars`.
  const rootLayoutStyle = resolveSurfaceRootStyle(gap ?? 'var(--pw-layout-surface-gap)', 0)
  const measureStyle = resolveMeasureStyle(
    viewport,
    gap ?? 'var(--pw-layout-surface-gap)',
    padding ?? 'var(--pw-layout-surface-padding)'
  )

  // Resolve appearance atom (theme + layout + styleVariables unified).
  // Theme tokens + custom CSS vars both live inside surface.appearance.config.
  const appearanceVars = React.useMemo(
    () => resolveAppearanceVars(surface.appearance, projectTheme),
    [surface.appearance, projectTheme]
  )

  const rootStyle = React.useMemo(
    () => ({
      ...rootLayoutStyle,
      ...appearanceVars,
    }),
    [rootLayoutStyle, appearanceVars]
  )

  // Surface-scope key for every emitted <style> rule. The embed autoloader
  // hydrates EVERY [data-pw-surface] element in a document, so a host page can
  // hold several surfaces at once; scoping by the ATTRIBUTE VALUE keeps each
  // surface's rules off its siblings. Undefined only when a surface has no id
  // (isolated test renders), where the historical value-less selector is fine.
  const scopeId = surface.id || undefined

  // Per-breakpoint visibility (hideOn/showOn). Media queries can't be
  // expressed inline, so the runtime emits scoped CSS rules — keyed by each
  // block's `data-block-id` — into the surface stylesheet (alongside the
  // box-sizing reset). Empty string when no block uses hideOn/showOn → existing
  // surfaces emit zero extra bytes.
  const visibilityCss = React.useMemo(
    () => collectVisibilityCss(surface.blocks, scopeId),
    [surface.blocks, scopeId]
  )

  // Interaction-state styling (block.states). Pseudo-classes (:hover/:active/
  // :focus-visible) can't be expressed inline, so the runtime emits scoped CSS
  // rules — keyed by each block's `data-block-id` — alongside the visibility CSS.
  // Empty string when no block uses `states` → existing surfaces emit zero bytes.
  const statesCss = React.useMemo(
    () => collectStatesCss(surface.blocks, scopeId),
    [surface.blocks, scopeId]
  )

  // Conditional-state styling (block.conditionalStates) — aria/data/disabled/
  // checked/:has variants. Attribute selectors and these pseudo-classes can't be
  // expressed inline, so the runtime emits scoped `[data-block-id]<selector>`
  // rules (with `!important` to beat component inline defaults). Empty string
  // when no block uses `conditionalStates` → existing surfaces emit zero bytes.
  const conditionalStatesCss = React.useMemo(
    () => collectConditionalStatesCss(surface.blocks, scopeId),
    [surface.blocks, scopeId]
  )

  // Per-prop responsive styles (block.style values that vary by breakpoint).
  // The base (xs) value is applied inline by the renderer (flattenResponsiveStyle);
  // the larger breakpoints are emitted here as scoped min-width media-query rules
  // keyed by each block's `data-block-id`. Empty string when no block uses a
  // responsive style value → existing surfaces emit zero bytes.
  const responsiveStyleCss = React.useMemo(
    () => collectResponsiveStyleCss(surface.blocks, scopeId),
    [surface.blocks, scopeId]
  )

  // Group-hover styling (block.groupRoot + descendant block.groupStates.hover) —
  // a parent marked groupRoot, on :hover, restyles descendants declaring
  // groupStates. The ancestor `:hover` + descendant relationship can't be
  // expressed inline, so the runtime emits scoped
  // `[data-block-id="<root>"]:hover [data-block-id="<desc>"]{…}` rules keyed by
  // both block ids. Empty string when no block uses groupStates under a
  // groupRoot → existing surfaces emit zero bytes.
  const groupStatesCss = React.useMemo(
    () => collectGroupStatesCss(surface.blocks, scopeId),
    [surface.blocks, scopeId]
  )

  // Dark theme variant (appearance.config.darkTheme). Light vars stay inline on
  // the root; the dark vars override under BOTH `[data-pw-theme="dark"]` (manual
  // force) AND `@media (prefers-color-scheme:dark)` (auto). Empty string when no
  // darkTheme is declared.
  const darkThemeCss = React.useMemo(() => {
    // Same `projectTheme` middle layer the light vars above resolve with —
    // otherwise a project-themed page is on-brand in light and platform-default
    // in dark.
    const darkVars = resolveAppearanceDarkVars(surface.appearance, projectTheme, projectDarkTheme)
    // `appearance.config.mode.policy` decides whether the dark rule
    // exists at all (light), always applies (dark) or follows the device.
    return buildDarkThemeCss(darkVars, scopeId, resolveAppearanceMode(surface.appearance?.config).policy)
  }, [surface.appearance, projectTheme, projectDarkTheme, scopeId])

  // Surface keyframe registry (appearance.config.keyframes) — arbitrary named
  // @keyframes a block can reference via `block.style.animation: 'pw-kf-<name> …'`
  // (each declared name is prefixed `pw-kf-`). Empty string when no registry is
  // declared. The prefers-reduced-motion gate in SURFACE_BASE_CSS neutralises
  // these for users who opt out (it matches by animation, not keyframe name).
  const keyframesCss = React.useMemo(
    () => buildKeyframesCss(resolveAppearanceKeyframes(surface.appearance)),
    [surface.appearance]
  )

  // extract form→entity bridge configs from surface capabilities
  const entityFormBindings = React.useMemo<readonly FormEntityBridgeConfig[] | undefined>(() => {
    // NO LONGER GATED ON THE ENTITY FACADE. A form now writes to a SOURCE, and
    // a rest-backed source has no facade behind it — requiring one here meant
    // a form pointed at anyone else's endpoint silently never attached.
    if (!surface.capabilities?.length) return undefined
    const entityCap = surface.capabilities.find((c) => isCapability(c, 'platform/entities'))
    const formBindings = entityCap?.config?.formBindings
    if (!Array.isArray(formBindings) || formBindings.length === 0) return undefined
    return formBindings as readonly FormEntityBridgeConfig[]
  }, [surface.capabilities])

  /**
   * The read sources, so a form binding's `sourceId` can be resolved.
   *
   * The same declaration the persistence capability already carries — a form
   * writes to something the page also knows how to read, which is what makes
   * "refresh after write" meaningful.
   */
  const formWriteSources = React.useMemo<readonly SurfaceDataSourceDefinition[] | undefined>(() => {
    const cap = surface.capabilities?.find((c) => isCapability(c, 'platform/persistence'))
    const sources = cap?.config?.dataSources
    return Array.isArray(sources) && sources.length > 0
      ? (sources as readonly SurfaceDataSourceDefinition[])
      : undefined
  }, [surface.capabilities])

  // Render blocks — in scope groups, keeping source order.
  //
  // `container` groups are wrapped in the measured container; `viewport`
  // groups become DIRECT children of the root. The escape is PLACEMENT, not a
  // CSS trick: `width:100vw` counts the scrollbar too and would produce ~15px
  // of horizontal overflow on every page with a vertical scrollbar.
  const renderOne = (block: Block) =>
    renderBlock(
      {
        block,
        context,
        components: componentRegistry,
      },
      undefined,
      entitlementCheck,
      dynamicBlockMap,
      renderBlockWrapper
    )

  const renderedBlocks = chunkByWidthScope(surface.blocks, viewport).map((chunk, i) =>
    chunk.scope === 'viewport' ? (
      <React.Fragment key={`pw-vp-${i}`}>{chunk.blocks.map(renderOne)}</React.Fragment>
    ) : (
      <div key={`pw-ct-${i}`} data-pw-measure="" style={measureStyle}>
        {chunk.blocks.map(renderOne)}
      </div>
    )
  )

  return (
    // SurfaceConnectionsContext carries the connections
    // context (world connections + engine registry) to blocks on the
    // engine-bridge path. null (host didn't opt in) = today's behavior.
    <SurfaceConnectionsContext.Provider value={connections ?? null}>
    {/*. EntityFacadeContext.Provider wraps the entire render tree */}
    <EntityFacadeContext.Provider value={entityFacade ?? null}>
      <BehaviorSurfaceProvider
        surfaceId={surface.id ?? ''}
        {...(entityFormBindings ? { entityFormBindings } : {})}
        {...(formWriteSources ? { dataSources: formWriteSources } : {})}
        {...(busOnEvent ? { onEvent: busOnEvent } : {})}
        blocks={surface.blocks}
      >
        {/* Shell selection (split shells) — ONE store per surface, so a list, a
            detail pane and any header reading the same key agree. `syncUrl`
            follows interactionMode: an inert canvas selects without moving the
            host's address bar. */}
        <ShellSelectionProvider syncUrl={interactionMode !== 'inert'}>
        <div
          className={className}
          style={rootStyle}
          // Carries the surface id so scoped rules can target THIS surface only.
          // Empty string when the surface has no id — still matches the bare
          // `[data-pw-surface]` selector the base CSS and the embed autoloader use.
          data-pw-surface={scopeId ?? ''}
          data-surface-renderer
          data-theme={theme}
          data-viewport={viewport}
        >
          {/* BASE CSS standard: scoped box-sizing reset, first child so it
              applies before any block paints. Scoped to [data-pw-surface] so
              it cannot leak to a host page. */}
          <style data-pw-base-css>{SURFACE_BASE_CSS}</style>
          {/* Per-breakpoint visibility (hideOn/showOn) — media-query rules
              keyed by block id. Only present when a block opts in. */}
          {visibilityCss ? (
            <style data-pw-visibility-css>{visibilityCss}</style>
          ) : null}
          {/* Interaction-state styling (block.states) — scoped
              :hover/:active/:focus-visible rules keyed by block id. Only
              present when a block opts in. */}
          {statesCss ? <style data-pw-states-css>{statesCss}</style> : null}
          {/* Conditional-state styling (block.conditionalStates) — scoped
              aria/data/disabled/checked/:has rules keyed by block id. Only
              present when a block opts in. */}
          {conditionalStatesCss ? (
            <style data-pw-conditional-states-css>{conditionalStatesCss}</style>
          ) : null}
          {/* Per-prop responsive styles (block.style breakpoint maps) —
              min-width media-query rules keyed by block id. Only present when a
              block opts in; base value stays inline. */}
          {responsiveStyleCss ? (
            <style data-pw-responsive-style-css>{responsiveStyleCss}</style>
          ) : null}
          {/* Group-hover styling (block.groupRoot + descendant
              block.groupStates) — scoped
              `[data-block-id="<root>"]:hover [data-block-id="<desc>"]` rules.
              Only present when a block opts in. */}
          {groupStatesCss ? (
            <style data-pw-group-states-css>{groupStatesCss}</style>
          ) : null}
          {/* Dark theme variant (appearance.config.darkTheme) — scoped
              force-dark + prefers-color-scheme:dark var overrides. Only present
              when a darkTheme is declared. */}
          {darkThemeCss ? <style data-pw-dark-theme-css>{darkThemeCss}</style> : null}
          {/* Surface keyframe registry (appearance.config.keyframes) — arbitrary
              @keyframes pw-kf-<name> a block can reference via
              block.style.animation. Only present when a registry is declared. */}
          {keyframesCss ? <style data-pw-keyframes-css>{keyframesCss}</style> : null}
          {renderedBlocks}
        </div>
        </ShellSelectionProvider>
      </BehaviorSurfaceProvider>
    </EntityFacadeContext.Provider>
    </SurfaceConnectionsContext.Provider>
  )
}

// ============================================================
// BLOCK RENDERER (STANDALONE)
// ============================================================

/**
 * Standalone block renderer
 *
 * Renders a single block without a surface wrapper.
 */
export function BlockRenderer({
  block,
  capabilities = [],
  theme: _theme = 'light',
  basePath = '',
  onEvent,
  components: customComponents,
  imageAdapter,
}: {
  block: Block
  capabilities?: CapabilityProvider[]
  theme?: 'light' | 'dark'
  basePath?: string
  onEvent?: SurfaceRendererProps['onEvent']
  components?: Partial<BlockComponentRegistry>
  imageAdapter?: ImageAdapter
}): React.ReactElement {
  // Build capability map
  const capabilityMap = React.useMemo(() => {
    const map = new Map<CapabilityType, CapabilityProvider>()
    for (const cap of capabilities) {
      map.set(cap.type, cap)
    }
    return map
  }, [capabilities])

  // Build block context (theme removed from BlockContext)
  const context: BlockContext = React.useMemo(
    () => ({
      capabilities: capabilityMap,
      basePath,
      onEvent,
      imageAdapter,
    }),
    [capabilityMap, basePath, onEvent, imageAdapter]
  )

  // Create image component override if adapter is provided
  const imageComponentOverride = React.useMemo(() => {
    if (!imageAdapter) return undefined
    return { image: createImageBlockWithAdapter(imageAdapter) }
  }, [imageAdapter])

  // Merge component registries
  // `defaultBlockComponents` retired; `customComponents`
  // is the only static seed (defaulted to {}) alongside the image override.
  const componentRegistry = React.useMemo(
    () => mergeComponentRegistries(customComponents, imageComponentOverride),
    [customComponents, imageComponentOverride]
  )

  return renderBlock({ block, context, components: componentRegistry }) as React.ReactElement
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Get all block IDs from a surface
 */
export function getBlockIds(blocks: readonly Block[]): string[] {
  const ids: string[] = []

  function collectIds(block: Block): void {
    ids.push(block.id)
    if (block.children) {
      for (const child of block.children) {
        collectIds(child)
      }
    }
  }

  for (const block of blocks) {
    collectIds(block)
  }

  return ids
}

/**
 * Find a block by ID in a surface
 */
export function findBlockById(blocks: readonly Block[], id: string): Block | undefined {
  for (const block of blocks) {
    if (block.id === id) {
      return block
    }
    if (block.children) {
      const found = findBlockById(block.children, id)
      if (found) {
        return found
      }
    }
  }
  return undefined
}

/**
 * Update a block by ID in a surface
 */
export function updateBlockById(
  blocks: readonly Block[],
  id: string,
  updates: Partial<Block>
): Block[] {
  return blocks.map((block) => {
    if (block.id === id) {
      return { ...block, ...updates }
    }
    if (block.children) {
      return {
        ...block,
        children: updateBlockById(block.children, id, updates),
      }
    }
    return block
  })
}
