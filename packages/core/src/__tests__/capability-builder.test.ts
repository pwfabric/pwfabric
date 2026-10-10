/**
 * Capability Builder Re-export Tests
 *
 * The builder is implemented in `@pwfabric/contracts`;
 * its behaviour is tested there. These tests only prove that core's public
 * names are the very same objects, so `instanceof` and identity checks hold
 * whichever package a caller imports from.
 *
 * @module @pwfabric/core/__tests__/capability-builder
 */

import { describe, it, expect } from 'vitest'
import {
  CapabilityBuilder as ContractsCapabilityBuilder,
  defineCapability as contractsDefineCapability,
} from '@pwfabric/contracts'
import { CapabilityBuilder, defineCapability } from '../capability-builder.js'
import * as core from '../index.js'

describe('capability builder re-export', () => {
  it('core/capability-builder re-exports the contracts objects', () => {
    expect(defineCapability).toBe(contractsDefineCapability)
    expect(CapabilityBuilder).toBe(ContractsCapabilityBuilder)
  })

  it('the core package root re-exports the contracts objects', () => {
    expect(core.defineCapability).toBe(contractsDefineCapability)
    expect(core.CapabilityBuilder).toBe(ContractsCapabilityBuilder)
  })

  it('a builder from core is an instance of the contracts class', () => {
    expect(defineCapability()).toBeInstanceOf(ContractsCapabilityBuilder)
  })
})
