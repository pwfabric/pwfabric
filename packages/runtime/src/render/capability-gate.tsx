/**
 * Capability Gate Components
 *
 * Entitlement enforcement at the rendering layer.
 *
 * Provides:
 * - EntitlementProvider: React context for entitlement state
 * - useEntitlements: Hook to read entitlement state
 * - GatedBlockPlaceholder: Visual placeholder for unentitled blocks
 *
 * @module @pwfabric/runtime/render/capability-gate
 */

import * as React from 'react'

// ============================================================
// TYPES
// ============================================================

/**
 * The claim set this gate reads.
 *
 * Enforcing a claim set is a rendering mechanism; deciding WHO is entitled to
 * WHAT is the host's business. A host's own entitlement type conforms to this
 * shape structurally.
 *
 * Keeping the gate but not the vocabulary is the point: the engine can
 * enforce entitlements for a product it knows nothing about.
 */
export interface EntitlementClaims {
  readonly blocks: readonly string[]
  readonly capabilities: readonly string[]
}

export interface EntitlementContextValue {
  /** Whether entitlements have been loaded */
  readonly loaded: boolean
  /** Set of entitled block types */
  readonly entitledBlocks: ReadonlySet<string>
  /** Set of entitled capabilities */
  readonly entitledCapabilities: ReadonlySet<string>
  /** Check if a specific block type is entitled */
  readonly isBlockEntitled: (blockType: string) => boolean
  /** Check if a specific capability is entitled */
  readonly isCapabilityEntitled: (capability: string) => boolean
}

export interface EntitlementProviderProps {
  /** The claim set from the host, or null if not yet loaded */
  readonly entitlements: EntitlementClaims | null
  readonly children: React.ReactNode
}

// ============================================================
// CONTEXT
// ============================================================

const EntitlementContext = React.createContext<EntitlementContextValue>({
  loaded: false,
  entitledBlocks: new Set(),
  entitledCapabilities: new Set(),
  isBlockEntitled: () => true, // fail-open when no provider
  isCapabilityEntitled: () => true,
})

// ============================================================
// PROVIDER
// ============================================================

/**
 * EntitlementProvider
 *
 * Wraps the app or surface renderer to provide entitlement state.
 * When entitlements is null (not yet loaded), all checks pass (fail-open).
 * Once loaded, enforcement is active.
 */
export function EntitlementProvider({
  entitlements,
  children,
}: EntitlementProviderProps): React.ReactElement {
  const value = React.useMemo<EntitlementContextValue>(() => {
    if (!entitlements) {
      return {
        loaded: false,
        entitledBlocks: new Set(),
        entitledCapabilities: new Set(),
        isBlockEntitled: () => true,
        isCapabilityEntitled: () => true,
      }
    }

    const blocks = new Set(entitlements.blocks)
    const capabilities = new Set(entitlements.capabilities)

    return {
      loaded: true,
      entitledBlocks: blocks,
      entitledCapabilities: capabilities,
      isBlockEntitled: (blockType: string) => blocks.has(blockType),
      isCapabilityEntitled: (capability: string) => capabilities.has(capability),
    }
  }, [entitlements])

  return React.createElement(EntitlementContext.Provider, { value }, children)
}

// ============================================================
// HOOK
// ============================================================

/**
 * useEntitlements
 *
 * Read entitlement state from the nearest EntitlementProvider.
 */
export function useEntitlements(): EntitlementContextValue {
  return React.useContext(EntitlementContext)
}

// ============================================================
// GATED BLOCK PLACEHOLDER
// ============================================================

export interface GatedBlockPlaceholderProps {
  readonly blockId: string
  readonly blockType: string
}

/**
 * GatedBlockPlaceholder
 *
 * Renders a visual placeholder for blocks the tenant is not entitled to use.
 * Uses inline styles (no Tailwind dependency in runtime package).
 */
export function GatedBlockPlaceholder({
  blockId,
  blockType,
}: GatedBlockPlaceholderProps): React.ReactElement {
  return (
    <div
      data-block-id={blockId}
      data-gated-block={blockType}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        // Theme-tokened (was a hardcoded light-gray card that clashed on
        // dark-themed surfaces). The copy stays — this is a deliberate
        // marketplace CTA, not an error message.
        border: '2px dashed var(--pw-color-border, #d1d5db)',
        borderRadius: '8px',
        backgroundColor: 'color-mix(in srgb, var(--pw-color-text, #6b7280) 5%, transparent)',
        color: 'var(--pw-color-text-muted, #6b7280)',
        textAlign: 'center',
        minHeight: '80px',
        gap: '4px',
      }}
    >
      <span style={{ fontSize: '14px', fontWeight: 500 }}>
        {'\u{1F512}'} {blockType} block
      </span>
      <span style={{ fontSize: '12px', color: 'var(--pw-color-text-muted, #9ca3af)' }}>Install from Marketplace</span>
    </div>
  )
}
