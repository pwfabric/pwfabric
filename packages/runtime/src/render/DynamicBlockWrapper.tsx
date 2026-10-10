/**
 * Dynamic Block Wrapper Component
 *
 * Wraps dynamically loaded block components with loading,
 * error, and loaded state management.
 *
 * @module @pwfabric/runtime/render/DynamicBlockWrapper
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import type { Block } from '@pwfabric/core'
import type { BlockComponent, BlockContext } from './types.js'
import { BlockModuleLoader } from './dynamic-block-loader.js'

// ============================================================
// TYPES
// ============================================================

export interface DynamicBlockWrapperProps {
  readonly descriptor: DynamicBlockDescriptor
  readonly block: Block
  readonly context: BlockContext
  readonly children?: ReactNode
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'

// ============================================================
// SKELETON & ERROR COMPONENTS
// ============================================================

/**
 * Quiet, theme-tokened module-load placeholder. Deliberately renders NO
 * visible text or spinner — the earlier "Loading {blockType}..." card was a
 * hardcoded light-theme box (gray fill, indigo spinner, English dev-facing
 * label) that flashed as a burst of bright cards on dark-themed surfaces
 * during a cold load. A low-contrast wash derived from the local text token
 * reads as "something is about to appear" in any theme and inside any card.
 * The data attributes keep the state machine observable for tests/tooling.
 */
function DynamicBlockSkeleton({ blockType }: { readonly blockType: string }): ReactNode {
  return (
    <div
      data-dynamic-block={blockType}
      data-state="loading"
      aria-busy="true"
      style={{
        minHeight: '24px',
        borderRadius: '8px',
        backgroundColor: 'color-mix(in srgb, var(--pw-color-text, #9ca3af) 6%, transparent)',
      }}
    />
  )
}

/**
 * Module-load failure. Same quiet-shape rule: no visible copy — the error
 * tint + dashed border carry the meaning, the technical message lives in the
 * title tooltip (and the loader already logs it), and the single retry
 * control is an icon button with an English aria-label.
 */
function DynamicBlockError({
  blockType,
  error,
  onRetry,
}: {
  readonly blockType: string
  readonly error: string
  readonly onRetry: () => void
}): ReactNode {
  return (
    <div
      data-dynamic-block={blockType}
      data-state="error"
      title={error}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        border: '2px dashed var(--pw-color-error, #fca5a5)',
        borderRadius: '8px',
        backgroundColor: 'color-mix(in srgb, var(--pw-color-error, #ef4444) 8%, transparent)',
        minHeight: '48px',
      }}
    >
      <button
        type="button"
        onClick={onRetry}
        aria-label={`Retry loading ${blockType}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          border: '1px solid var(--pw-color-error, #fca5a5)',
          borderRadius: '50%',
          backgroundColor: 'transparent',
          color: 'var(--pw-color-error, #991b1b)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>
    </div>
  )
}

// ============================================================
// WRAPPER COMPONENT
// ============================================================

/**
 * Wraps a dynamically loaded block component.
 * Manages loading → loaded | error state machine.
 */
export function DynamicBlockWrapper({
  descriptor,
  block,
  context,
  children,
}: DynamicBlockWrapperProps): ReactNode {
  const [state, setState] = useState<LoadState>(
    BlockModuleLoader.isLoaded(descriptor.blockType) ? 'loaded' : 'idle'
  )
  const [component, setComponent] = useState<BlockComponent | null>(() =>
    BlockModuleLoader.getSync(descriptor.blockType)
  )
  const [errorMessage, setErrorMessage] = useState('')

  const loadModule = useCallback(() => {
    setComponent(null)
    setState('loading')
    setErrorMessage('')

    BlockModuleLoader.load(descriptor)
      .then((comp) => {
        setComponent(() => comp)
        setState('loaded')
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setErrorMessage(msg)
        setState('error')
      })
  }, [descriptor])

  useEffect(() => {
    if (state === 'idle') {
      loadModule()
    }
  }, [state, loadModule])

  const handleRetry = useCallback(() => {
    BlockModuleLoader.invalidate(descriptor.blockType)
    loadModule()
  }, [descriptor.blockType, loadModule])

  // Component-first: if we have a loaded component, always render it regardless of
  // the state machine. This prevents the skeleton from flashing when state transitions
  // to 'loading' (e.g. retry) while the previous component is still valid in cache.
  if (component) {
    const Component = component
    // `props` is NEVER undefined. A node may legitimately carry no `props` key
    // at all — `{id, type, children}` is a valid section — and a block component
    // reads `props.x` directly, so handing it `undefined` throws inside the
    // component and the block renders as an error placeholder.
    //
    // A `section` authored without a `props` key would otherwise crash with
    // "Cannot read properties of undefined (reading 'paddingY')". The static
    // renderer guards this too (`renderer.tsx`: `block.props ?? {}`); this is
    // the path every PACK-INSTALLED block takes.
    return (
      <Component block={block} props={block.props ?? {}} context={context}>
        {children}
      </Component>
    )
  }

  if (state === 'error') {
    return (
      <DynamicBlockError
        blockType={descriptor.blockType}
        error={errorMessage}
        onRetry={handleRetry}
      />
    )
  }

  return <DynamicBlockSkeleton blockType={descriptor.blockType} />
}
