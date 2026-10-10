/**
 * BlockManifestSchema Tests
 *
 * Covers Zod schema validation for block manifest documents.
 *
 * @module @pwfabric/contracts/fabric/__tests__/block-manifest-schema
 */

import { describe, it, expect } from 'vitest'
import { blockManifestSchema, type BlockManifest } from '../../fabric/block-manifest-schema.js'

const validManifest: BlockManifest = {
  manifestVersion: 1,
  name: 'my-block',
  version: '1.0.0',
  type: 'block',
  entryPoints: { main: './index.js' },
}

describe('blockManifestSchema', () => {
  describe('valid manifests', () => {
    it('should accept a minimal valid manifest', () => {
      const result = blockManifestSchema.safeParse(validManifest)
      expect(result.success).toBe(true)
    })

    it('should accept a scoped package name', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        name: '@my-scope/my-block',
      })
      expect(result.success).toBe(true)
    })

    it('should accept all artifact types', () => {
      // 'bundle' artifactType retired — no longer a valid manifest type.
      const types = ['block', 'starter', 'capability'] as const
      for (const type of types) {
        const result = blockManifestSchema.safeParse({ ...validManifest, type })
        expect(result.success).toBe(true)
      }
    })

    it('should reject the retired bundle artifact type', () => {
      const result = blockManifestSchema.safeParse({ ...validManifest, type: 'bundle' })
      expect(result.success).toBe(false)
    })

    it('should accept optional description', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        description: 'A useful block',
      })
      expect(result.success).toBe(true)
    })

    it('should accept optional provides field', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        provides: {
          blocks: ['hero-block', 'cta-block'],
          starters: ['landing-page'],
          capabilities: ['platform/persistence'],
        },
      })
      expect(result.success).toBe(true)
    })

    it('should accept optional requires field', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        requires: {
          blocks: ['container-block'],
          capabilities: ['platform/persistence'],
        },
      })
      expect(result.success).toBe(true)
    })

    it('should accept optional entry points', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        entryPoints: {
          main: './index.js',
          renderer: './renderer.js',
          editor: './editor.js',
          server: './server.js',
        },
      })
      expect(result.success).toBe(true)
    })

    it('should accept optional author with all fields', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        author: {
          name: 'Acme Corp',
          email: 'blocks@acme.com',
          url: 'https://acme.com',
        },
      })
      expect(result.success).toBe(true)
    })

    it('should accept optional license and keywords', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        license: 'MIT',
        keywords: ['hero', 'landing', 'cta'],
        repository: 'https://github.com/acme/my-block',
      })
      expect(result.success).toBe(true)
    })

    it('should accept semver with pre-release tag', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        version: '2.0.0-beta.1',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('invalid manifests', () => {
    it('should reject wrong manifestVersion', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        manifestVersion: 2,
      })
      expect(result.success).toBe(false)
    })

    it('should reject name that is too short', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        name: 'a',
      })
      expect(result.success).toBe(false)
    })

    it('should reject name that is too long', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        name: 'a'.repeat(129),
      })
      expect(result.success).toBe(false)
    })

    it('should reject name with uppercase letters', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        name: 'MyBlock',
      })
      expect(result.success).toBe(false)
    })

    it('should reject name with underscores', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        name: 'my_block',
      })
      expect(result.success).toBe(false)
    })

    it('should reject invalid version (no patch)', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        version: '1.0',
      })
      expect(result.success).toBe(false)
    })

    it('should reject invalid artifact type', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        type: 'plugin',
      })
      expect(result.success).toBe(false)
    })

    it('should reject description that is too long', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        description: 'a'.repeat(501),
      })
      expect(result.success).toBe(false)
    })

    it('should reject invalid author email', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        author: { name: 'Acme', email: 'not-an-email' },
      })
      expect(result.success).toBe(false)
    })

    it('should reject invalid author url', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        author: { name: 'Acme', url: 'not-a-url' },
      })
      expect(result.success).toBe(false)
    })

    it('should reject missing entryPoints.main', () => {
      const result = blockManifestSchema.safeParse({
        ...validManifest,
        entryPoints: {},
      })
      expect(result.success).toBe(false)
    })

    it('should reject missing required fields', () => {
      const result = blockManifestSchema.safeParse({})
      expect(result.success).toBe(false)
    })
  })
})
