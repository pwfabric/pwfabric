/**
 * Block Error Boundary
 *
 * React class component that isolates block-level render crashes.
 * If a single block throws during render, only that block shows
 * a fallback UI — the rest of the surface stays intact.
 *
 * ON THE SERVER TOO. A class boundary does not catch while a page is rendered
 * to a string (the build's static first paint, pwapp-format §2.5), so each
 * block also sits in a `<Suspense>`: a block whose render throws there (it
 * read `window` while rendering) leaves an empty, client-rendered boundary in
 * the static HTML, and the browser draws that block itself once it hydrates.
 * The rest of the page is still painted before any script runs. In the
 * browser the Suspense is inert — no block suspends.
 *
 * UNDER `pwf dev`, a crash also names the props that did not fit their
 * declared shape (`declared`, the block's manifest props). Applying props
 * keeps a misfit value as written (block-manifest, "Applying props"), so a
 * block that assumed a bound value's type — `props.items.map` on a string —
 * throws here; the notice points at the prop instead of the stack.
 *
 * @module @pwfabric/runtime/render/BlockErrorBoundary
 */

import * as React from 'react'
import { applyBlockProps, type BlockPropDescriptor } from '@pwfabric/contracts'
import { isDevHost } from './block-props.js'

interface BlockErrorBoundaryProps {
  readonly blockId: string
  readonly blockType: string
  readonly children: React.ReactNode
  /** The props the block was given, before its declarations were applied. */
  readonly props?: Readonly<Record<string, unknown>> | undefined
  /** The block's declared props (its manifest's `definition.props`), read only to explain a crash under `pwf dev`. */
  readonly declared?: readonly BlockPropDescriptor[] | undefined
}

/** The declared props whose given value does not fit its shape, as applying props reports them. */
export function misfitProps(
  props: Readonly<Record<string, unknown>> | undefined,
  declared: readonly BlockPropDescriptor[] | undefined
): string[] {
  if (!declared || declared.length === 0) return []
  const names = new Set<string>()
  applyBlockProps(props ?? {}, declared, (issue) => {
    if (issue.code === 'required') return
    const name = declared.find((d) => issue.path === d.name || issue.path.startsWith(`${d.name}.`) || issue.path.startsWith(`${d.name}[`))?.name
    names.add(name ?? issue.path)
  })
  return [...names]
}

interface BlockErrorBoundaryState {
  readonly hasError: boolean
  readonly error: Error | null
}

export class BlockErrorBoundary extends React.Component<
  BlockErrorBoundaryProps,
  BlockErrorBoundaryState
> {
  constructor(props: BlockErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): BlockErrorBoundaryState {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(
      `[PWFabric] Block render error: ${this.props.blockType}#${this.props.blockId}`,
      error,
      info.componentStack
    )
    if (isDevHost()) {
      const misfits = misfitProps(this.props.props, this.props.declared)
      if (misfits.length > 0) {
        console.warn(
          `[pwfabric] block "${this.props.blockType}" (#${this.props.blockId}) threw while ${misfits.map((n) => `"${n}"`).join(', ')} ` +
            `did not fit ${misfits.length === 1 ? 'its' : 'their'} declared shape. A value that does not fit is kept as written: ` +
            "the block must not assume a bound value's type. Fix the receipt, or make the block tolerate it."
        )
      }
    }
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      // Quiet-shape fallback: no visible copy — the earlier card leaked the
      // raw exception message ("Cannot read properties of undefined…") to end
      // users in a hardcoded light-red dev box. The error tint + dashed
      // border signal "this section failed"; the technical message stays in
      // the title tooltip and in the componentDidCatch console.error above,
      // and data-block-error keeps it queryable for tests/tooling.
      return (
        <div
          style={{
            border: '2px dashed var(--pw-color-error, #ef4444)',
            borderRadius: '8px',
            backgroundColor: 'color-mix(in srgb, var(--pw-color-error, #ef4444) 8%, transparent)',
            minHeight: '32px',
          }}
          data-block-error={this.props.blockId}
          data-block-error-type={this.props.blockType}
          title={this.state.error?.message ?? 'Unknown error'}
        />
      )
    }

    return <React.Suspense fallback={null}>{this.props.children}</React.Suspense>
  }
}
