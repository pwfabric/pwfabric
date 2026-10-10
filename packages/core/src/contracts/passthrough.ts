/**
 * Passthrough Contract
 *
 * A canonical declaration-only contract used by platform capabilities
 * (persistence, navigation, interaction, entities) that accept any input
 * and produce any output with no schema validation.
 *
 * Moved from `@pwfabric/runtime/capability/platform-capabilities.ts` to
 * `@pwfabric/core/contracts/passthrough` so pwpack-authored capabilities
 * can import it without a runtime dependency.
 *
 * @module @pwfabric/core/contracts/passthrough
 */

import { defineContract, anySchema } from '../contract-builder.js'

export const passthroughContract = defineContract()
  .id('platform/passthrough')
  .name('Platform Passthrough')
  .description('Passthrough contract for platform capability declarations')
  .state('stable')
  .input(anySchema())
  .output(anySchema())
  .build()
