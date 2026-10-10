/**
 * Block Error Boundary
 *
 * React class component that isolates block-level render crashes.
 * If a single block throws during render, only that block shows
 * a fallback UI — the rest of the surface stays intact.
 *
 * @module @pwfabric/runtime/render/BlockErrorBoundary
 */

import * as React from 'react'

interface BlockErrorBoundaryProps {
  readonly blockId: string
  readonly blockType: string
  readonly children: React.ReactNode
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

    return this.props.children
  }
}
