/**
 * Form Processing Module
 *
 * A form block's submission, written to the data source its binding names.
 * The form block validates what it can (required, type) in the browser; the
 * server decides the rest and its refusal arrives as a reason code
 * (`statusKeys.reason`) and the refused fields (`statusKeys.fields`). The
 * engine keeps no validation sentences: the app writes every word.
 *
 * @module @pwfabric/runtime/forms
 */

// Form → Entity Bridge
export { attachFormEntityBridge } from './form-entity-bridge.js'
export { completeNamedControlValues } from './named-control-values.js'
export type { FormEntityBridgeConfig, FormWriter, Unsubscribe } from './form-entity-bridge.js'

// Which verb / which record a form write addresses, and what a refusal means
export {
  resolveFormWriteTarget,
  toFormWriteError,
  writeFailureReason,
  writeFailureFields,
  writeFailureDetail,
} from './form-write-target.js'
export type { FormWriteMethod, FormWriteTarget, FormWriteReason } from './form-write-target.js'
