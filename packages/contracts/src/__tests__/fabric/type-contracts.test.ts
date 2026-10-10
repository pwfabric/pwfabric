/**
 * Type Contract Shape Tests
 *
 * Validates that all pure-type contract modules export correct shapes.
 * These files contain only TypeScript interfaces and types (no runtime code).
 * Importing them forces coverage instrumentation to register the file.
 *
 * @module @pwfabric/contracts/fabric/__tests__/type-contracts
 */

import { describe, it, expect } from 'vitest'

// ============================================================
// BLOCK
// ============================================================

import type { Block } from '../../fabric/block.js'

describe('Block contract', () => {
  it('should describe the shape of a Block instance', () => {
    const block: Block = {
      id: 'block-1',
      type: 'hero-block',
      props: { title: 'Hello' },
      layout: { span: { xs: 12 } },
    }
    expect(block.id).toBe('block-1')
    expect(block.type).toBe('hero-block')
    expect(block.props).toEqual({ title: 'Hello' })
  })

  it('should support optional style and children', () => {
    const block: Block = {
      id: 'block-2',
      type: 'section-block',
      props: {},
      layout: {},
      style: { backgroundColor: '#fff', borderRadius: '8px' },
      children: [
        {
          id: 'child-1',
          type: 'text-block',
          props: { text: 'Hi' },
          layout: {},
        },
      ],
    }
    expect(block.style?.backgroundColor).toBe('#fff')
    expect(block.children).toHaveLength(1)
  })
})

// ============================================================
// ARTIFACT
// ============================================================

import type {
  ArtifactScope,
  ArtifactStatus,
  ValidationSeverity,
  ManifestValidationIssue,
  PackageValidationResult,
} from '../../fabric/artifact.js'

describe('Artifact contract types', () => {
  it('should describe ArtifactScope union members', () => {
    const scope1: ArtifactScope = 'workspace'
    const scope2: ArtifactScope = 'marketplace'
    expect(scope1).toBe('workspace')
    expect(scope2).toBe('marketplace')
  })

  it('should describe ArtifactStatus lifecycle values', () => {
    const statuses: ArtifactStatus[] = ['uploading', 'validating', 'valid', 'invalid', 'published']
    expect(statuses).toHaveLength(5)
  })

  it('should describe ValidationSeverity values', () => {
    const error: ValidationSeverity = 'error'
    const warning: ValidationSeverity = 'warning'
    expect(error).toBe('error')
    expect(warning).toBe('warning')
  })

  it('should describe ManifestValidationIssue shape', () => {
    const issue: ManifestValidationIssue = {
      severity: 'error',
      code: 'MISSING_FIELD',
      message: 'name is required',
      path: 'manifest.name',
    }
    expect(issue.severity).toBe('error')
    expect(issue.code).toBe('MISSING_FIELD')
  })

  it('should describe PackageValidationResult shape', () => {
    const result: PackageValidationResult = {
      valid: false,
      issues: [{ severity: 'error', code: 'ERR', message: 'bad' }],
    }
    expect(result.valid).toBe(false)
    expect(result.issues).toHaveLength(1)
  })
})

// ============================================================
// CONFIG SCHEMA
// ============================================================

import type { ConfigFieldType, ConfigFieldDefinition } from '../../fabric/config-schema.js'

describe('ConfigSchema contract types', () => {
  it('should describe all ConfigFieldType values', () => {
    const types: ConfigFieldType[] = [
      'string',
      'number',
      'boolean',
      'select',
      'multi-select',
      'url',
      'email',
      'json',
    ]
    expect(types).toHaveLength(8)
  })

  it('should describe ConfigFieldDefinition shape', () => {
    const field: ConfigFieldDefinition = {
      key: 'api-key',
      type: 'string',
      required: true,
      label: 'API Key',
      description: 'Your API key',
      sensitive: true,
    }
    expect(field.key).toBe('api-key')
    expect(field.sensitive).toBe(true)
  })
})

// ============================================================
// DYNAMIC ARTIFACT
// ============================================================

import type {
  DynamicBlockDescriptor,
  DynamicStarterDescriptor,
  BundleCascadeResult,
} from '../../fabric/dynamic-artifact.js'

describe('DynamicArtifact contract types', () => {
  it('should describe DynamicBlockDescriptor shape', () => {
    const descriptor: DynamicBlockDescriptor = {
      blockType: 'hero-block',
      moduleUrl: 'https://cdn.example.com/hero@1.0.0/index.mjs',
      integrity: 'sha256-abc123',
      publisher: 'acme',
      publisherVerified: true,
      definition: { name: 'Hero Block', category: 'marketing' },
    }
    expect(descriptor.blockType).toBe('hero-block')
    expect(descriptor.publisherVerified).toBe(true)
  })

  it('should describe DynamicStarterDescriptor shape', () => {
    const descriptor: DynamicStarterDescriptor = {
      starterId: 'starter-landing',
      name: 'Landing Page',
      description: 'A full landing page starter',
      blocks: [],
      publisher: 'pwfabric',
      publisherVerified: true,
      requiredBlockTypes: ['hero-block', 'cta-block'],
    }
    expect(descriptor.starterId).toBe('starter-landing')
  })

  it('should describe BundleCascadeResult shape', () => {
    const result: BundleCascadeResult = {
      installed: [{ listingId: 'lst-1', artifactType: 'block', name: 'hero' }],
      skipped: [{ listingId: 'lst-2', reason: 'already installed' }],
      failed: [],
    }
    expect(result.installed).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
  })
})

// ============================================================
// ENTITLEMENT
// ============================================================

import type {
  WorldEntitlementsLegacy,
  EntitlementCheckResult,
  SerializedEntitlements,
  PackageGrants,
} from '../../fabric/entitlement.js'

describe('Entitlement contract types', () => {
  it('should describe WorldEntitlementsLegacy shape', () => {
    const entitlements: WorldEntitlementsLegacy = {
      worldId: 'world-1',
      blocks: ['hero-block', 'text-block'],
      capabilities: ['platform/persistence'],
      resolvedAt: Date.now(),
    }
    expect(entitlements.worldId).toBe('world-1')
    expect(entitlements.blocks).toContain('hero-block')
  })

  it('should describe EntitlementCheckResult shape when entitled', () => {
    const result: EntitlementCheckResult = { entitled: true }
    expect(result.entitled).toBe(true)
    expect(result.missingBlocks).toBeUndefined()
  })

  it('should describe EntitlementCheckResult shape when not entitled', () => {
    const result: EntitlementCheckResult = {
      entitled: false,
      missingBlocks: ['premium-block'],
    }
    expect(result.entitled).toBe(false)
    expect(result.missingBlocks).toContain('premium-block')
  })

  it('should describe SerializedEntitlements shape', () => {
    const serialized: SerializedEntitlements = {
      blocks: ['hero-block'],
      capabilities: ['platform/persistence'],
    }
    expect(serialized.blocks).toHaveLength(1)
  })

  it('should describe PackageGrants shape', () => {
    const grants: PackageGrants = {
      blocks: ['hero-block', 'cta-block'],
      capabilities: [],
    }
    expect(grants.blocks).toHaveLength(2)
    expect(grants.capabilities).toHaveLength(0)
  })
})

// ============================================================
// MARKETPLACE
// ============================================================

import type {
  ArtifactType,
  ListingStatus,
  PricingModel,
  PublisherTier,
  ArtifactProvenance,
  InstallError,
} from '../../fabric/marketplace.js'

describe('Marketplace contract types', () => {
  it('should describe ArtifactType values', () => {
    const types: ArtifactType[] = ['pwfpack', 'starter', 'block', 'capability', 'bundle']
    expect(types).toHaveLength(5)
  })

  it('should describe ListingStatus lifecycle values', () => {
    const statuses: ListingStatus[] = [
      'draft',
      'pending',
      'published',
      'suspended',
      'deprecated',
      'coming_soon',
    ]
    expect(statuses).toHaveLength(6)
  })

  it('should describe PricingModel values', () => {
    const models: PricingModel[] = ['free', 'freemium', 'one-time', 'subscription']
    expect(models).toHaveLength(4)
  })

  it('should describe PublisherTier values', () => {
    const tiers: PublisherTier[] = ['platform', 'verified', 'community']
    expect(tiers).toHaveLength(3)
  })

  it('should describe ArtifactProvenance values', () => {
    const provenances: ArtifactProvenance[] = [
      'platform',
      'platform-extension',
      'marketplace',
      'workspace',
    ]
    expect(provenances).toHaveLength(4)
  })

  it('should describe InstallError discriminated union shapes', () => {
    const notFound: InstallError = { type: 'not_found', listingId: 'lst-1' }
    const alreadyInstalled: InstallError = {
      type: 'already_installed',
      listingId: 'lst-1',
    }
    const missingDeps: InstallError = {
      type: 'missing_dependencies',
      missingBlocks: ['hero-block'],
      missingCapabilities: [],
    }
    expect(notFound.type).toBe('not_found')
    expect(alreadyInstalled.type).toBe('already_installed')
    expect(missingDeps.missingBlocks).toContain('hero-block')
  })
})

// ============================================================
// SURFACE DOC
// ============================================================

import type {
  SurfaceDocument,
  SurfaceDataSource,
  SurfaceCapabilityRequirement,
} from '../../fabric/surface-doc.js'

describe('SurfaceDoc contract types', () => {
  it('should describe SurfaceDocument shape', () => {
    const doc: SurfaceDocument = {
      id: 'surf-1',
      name: 'Landing Page',
      blocks: [],
    }
    expect(doc.id).toBe('surf-1')
    expect(doc.blocks).toHaveLength(0)
  })

  it('should support optional SurfaceDocument fields', () => {
    const doc: SurfaceDocument = {
      id: 'surf-2',
      name: 'Dashboard',
      description: 'Main dashboard',
      tags: ['internal'],
      thumbnailUrl: 'https://cdn.example.com/thumb.png',
      blocks: [],
      styleVariables: { 'color-primary': '#6366f1' },
      dataSources: [],
      initialState: { count: 0 },
      capabilities: [],
    }
    expect(doc.description).toBe('Main dashboard')
    expect(doc.styleVariables?.['color-primary']).toBe('#6366f1')
  })

  it('should describe SurfaceDataSource kinds', () => {
    const sources: SurfaceDataSource[] = [
      { id: 'ds-1', kind: 'rest', endpoint: '/api/data', method: 'GET' },
      { id: 'ds-2', kind: 'static', staticData: { items: [] } },
      { id: 'ds-3', kind: 'state' },
    ]
    expect(sources[0]?.kind).toBe('rest')
    expect(sources[1]?.kind).toBe('static')
    expect(sources[2]?.kind).toBe('state')
  })

  it('should carry connector + authProviderRef (both optional)', () => {
    const withEngine: SurfaceDataSource = {
      id: 'tasks',
      kind: 'entity',
      entityType: 'Task',
      connector: 'graph-lists',
      authProviderRef: 'contoso-entra',
    }
    const withoutEngine: SurfaceDataSource = { id: 'ds-1', kind: 'state' }
    expect(withEngine.connector).toBe('graph-lists')
    expect(withEngine.authProviderRef).toBe('contoso-entra')
    expect(withoutEngine.connector).toBeUndefined()
    expect(withoutEngine.authProviderRef).toBeUndefined()
  })

  it('should describe SurfaceCapabilityRequirement shape', () => {
    const req: SurfaceCapabilityRequirement = {
      capability: 'platform/persistence',
      required: true,
      config: { defaultCacheTtl: 300 },
    }
    expect(req.capability).toBe('platform/persistence')
    expect(req.required).toBe(true)
  })
})

// ============================================================
// SURFACE MUTATION
// ============================================================

import type {
  AddBlockMutation,
  RemoveBlockMutation,
  MoveBlockMutation,
  UpdatePropsMutation,
  UpdateStyleMutation,
  AddVarMutation,
  UpdateVarMutation,
  RemoveVarMutation,
  AddTokenMutation,
  UpdateTokenMutation,
  RemoveTokenMutation,
  AddCapabilityMutation,
  RemoveCapabilityMutation,
  SurfaceMutation,
  MutationRequest,
  MutationResponse,
} from '../../fabric/surface-mutation.js'

describe('SurfaceMutation contract types', () => {
  it('should describe AddBlockMutation shape', () => {
    const mutation: AddBlockMutation = {
      op: 'add-block',
      id: 'block-new',
      type: 'hero-block',
      parentId: 'section-1',
      index: 0,
      props: { title: 'Hello' },
    }
    expect(mutation.op).toBe('add-block')
    expect(mutation.type).toBe('hero-block')
  })

  it('should describe RemoveBlockMutation shape', () => {
    const mutation: RemoveBlockMutation = { op: 'remove-block', blockId: 'block-1' }
    expect(mutation.op).toBe('remove-block')
  })

  it('should describe MoveBlockMutation shape', () => {
    const mutation: MoveBlockMutation = {
      op: 'move-block',
      blockId: 'block-1',
      newParentId: 'section-2',
      index: 2,
    }
    expect(mutation.op).toBe('move-block')
    expect(mutation.index).toBe(2)
  })

  it('should describe UpdatePropsMutation shape', () => {
    const mutation: UpdatePropsMutation = {
      op: 'update-props',
      blockId: 'block-1',
      props: { title: 'Updated' },
    }
    expect(mutation.op).toBe('update-props')
  })

  it('should describe UpdateStyleMutation shape', () => {
    const mutation: UpdateStyleMutation = {
      op: 'update-style',
      blockId: 'block-1',
      style: { backgroundColor: '#ff0000' },
    }
    expect(mutation.op).toBe('update-style')
  })

  it('should describe var mutations', () => {
    const add: AddVarMutation = { op: 'add-var', key: 'color-primary', value: '#6366f1' }
    const update: UpdateVarMutation = { op: 'update-var', key: 'color-primary', value: '#4f46e5' }
    const remove: RemoveVarMutation = { op: 'remove-var', key: 'color-primary' }
    expect(add.op).toBe('add-var')
    expect(update.op).toBe('update-var')
    expect(remove.op).toBe('remove-var')
  })

  it('should describe token mutations', () => {
    const add: AddTokenMutation = {
      op: 'add-token',
      section: 'colors',
      key: 'primary',
      value: '#6366f1',
    }
    const update: UpdateTokenMutation = {
      op: 'update-token',
      section: 'border',
      key: 'radius',
      value: '8px',
    }
    const remove: RemoveTokenMutation = {
      op: 'remove-token',
      section: 'motion',
      key: 'durationFast',
    }
    expect(add.op).toBe('add-token')
    expect(update.section).toBe('border')
    expect(remove.section).toBe('motion')
  })

  it('should describe capability mutations', () => {
    const add: AddCapabilityMutation = {
      op: 'add-capability',
      capability: 'platform/persistence',
      required: true,
    }
    const remove: RemoveCapabilityMutation = {
      op: 'remove-capability',
      capability: 'platform/persistence',
    }
    expect(add.op).toBe('add-capability')
    expect(remove.op).toBe('remove-capability')
  })

  it('should describe SurfaceMutation union type', () => {
    const mutations: SurfaceMutation[] = [
      { op: 'add-block', id: 'b1', type: 'hero-block' },
      { op: 'remove-block', blockId: 'b1' },
      { op: 'update-props', blockId: 'b1', props: {} },
    ]
    expect(mutations).toHaveLength(3)
  })

  it('should describe MutationRequest and MutationResponse shapes', () => {
    const request: MutationRequest = {
      mutations: [{ op: 'remove-block', blockId: 'b1' }],
    }
    const response: MutationResponse = {
      definition: {},
      appliedCount: 1,
      updatedAt: '2026-04-03T12:00:00.000Z',
    }
    expect(request.mutations).toHaveLength(1)
    expect(response.appliedCount).toBe(1)
  })
})

// ============================================================
// SURFACE THEME
// ============================================================

import type { SurfaceTheme } from '../../fabric/surface-theme.js'

describe('SurfaceTheme contract types', () => {
  it('should describe a full SurfaceTheme with all token groups', () => {
    const theme: SurfaceTheme = {
      colors: {
        primary: '#6366f1',
        secondary: '#8b5cf6',
        accent: '#f59e0b',
        background: '#0f172a',
        card: '#1e293b',
        text: '#f8fafc',
        textMuted: '#94a3b8',
        border: '#334155',
        error: '#ef4444',
        success: '#22c55e',
        warning: '#f59e0b',
        info: '#3b82f6',
        textOnPrimary: '#ffffff',
      },
      border: { radius: '0.5rem', width: '1px', style: 'solid', radiusLarge: '1rem' },
      typography: {
        fontFamily: 'Inter, sans-serif',
        baseFontSize: '1rem',
        headingWeight: '700',
        headingLineHeight: '1.2',
        bodyLineHeight: '1.6',
      },
      spacing: { base: '1rem' },
      shadows: { card: '0 1px 3px rgba(0,0,0,0.1)', button: '0 2px 4px rgba(0,0,0,0.2)' },
      motion: { durationFast: '150ms', durationNormal: '300ms', easing: 'ease-in-out' },
      layout: { gap: '1rem', padding: '1.5rem', containerMaxWidth: '1280px', gridGap: '1rem' },
    }
    expect(theme.colors?.primary).toBe('#6366f1')
    expect(theme.border?.radius).toBe('0.5rem')
    expect(theme.typography?.fontFamily).toContain('Inter')
    expect(theme.spacing?.base).toBe('1rem')
    expect(theme.shadows?.card).toBeDefined()
    expect(theme.motion?.durationFast).toBe('150ms')
    expect(theme.layout?.containerMaxWidth).toBe('1280px')
  })

  it('should describe deprecated surface color token', () => {
    const theme: SurfaceTheme = {
      colors: { surface: '#1e293b' },
    }
    expect(theme.colors?.surface).toBe('#1e293b')
  })
})

// ============================================================
// SURFACE
// ============================================================

import type {
  EnvironmentType,
  EnvironmentDescriptor,
  SurfaceDescriptor,
} from '../../fabric/surface.js'

describe('Surface contract types', () => {
  it('should describe all EnvironmentType values', () => {
    const envs: EnvironmentType[] = [
      'web',
      'api',
      'cli',
      'worker',
      'edge',
      'node',
      'native',
      'test',
    ]
    expect(envs).toHaveLength(8)
  })

  it('should describe EnvironmentDescriptor shape', () => {
    const env: EnvironmentDescriptor = {
      type: 'web',
      platform: 'browser',
      version: '1.0.0',
      features: ['webworker', 'serviceworker'],
    }
    expect(env.type).toBe('web')
    expect(env.features).toContain('webworker')
  })

  it('should describe SurfaceDescriptor shape', () => {
    const descriptor: SurfaceDescriptor<'web'> = {
      id: 'surf-1',
      version: '1.0.0',
      environment: 'web',
      metadata: { name: 'My Surface', description: 'A test surface', tags: ['test'] },
    }
    expect(descriptor.environment).toBe('web')
    expect(descriptor.metadata.name).toBe('My Surface')
  })
})
