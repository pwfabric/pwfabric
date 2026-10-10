/**
 * defineCapability Re-export Tests
 *
 * Authoring exposes the capability builder from the Apache-2.0 contracts
 * package, so a capability author does not depend on the engine core.
 *
 * @module @pwfabric/authoring/__tests__/define-capability
 */

import { describe, it, expect } from 'vitest'
import {
  CapabilityBuilder as ContractsCapabilityBuilder,
  defineCapability as contractsDefineCapability,
} from '@pwfabric/contracts'
import { CapabilityBuilder, defineCapability } from '../index.js'

describe('authoring capability builder', () => {
  it('re-exports the contracts objects', () => {
    expect(defineCapability).toBe(contractsDefineCapability)
    expect(CapabilityBuilder).toBe(ContractsCapabilityBuilder)
  })
})
