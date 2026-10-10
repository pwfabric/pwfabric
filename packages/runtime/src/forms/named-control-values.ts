/**
 * Named controls that FormData cannot see.
 *
 * A form block gathers its values with `new FormData(form)`, which reads
 * native fields only. A control drawn from buttons — a segmented control, a
 * custom picker — has no field, so its answer never reached the record even
 * though the control named itself and wrote its `stateKey` (an RSVP form
 * would store every reply without its yes/no answer).
 *
 * The page state already holds that answer. This completes the submitted
 * values from `state[stateKey]` for every block inside the form that declares
 * both a `name` and a `stateKey` — ONLY where FormData carried nothing under
 * that name, so a native field's own value always wins, and never for a
 * disabled control (a disabled native field is not submitted either).
 *
 * A control that is never touched has written no state; it contributes
 * nothing here. A block that wants its untouched default submitted renders a
 * hidden input (foundation's segmented-control does, from 3.1.3).
 *
 * @module @pwfabric/runtime/forms/named-control-values
 */
import type { Block } from '@pwfabric/core'

function findBlock(blocks: readonly Block[] | undefined, id: string): Block | undefined {
  for (const block of blocks ?? []) {
    if (block.id === id) return block
    const inner = findBlock(block.children as readonly Block[] | undefined, id)
    if (inner) return inner
  }
  return undefined
}

function collect(
  blocks: readonly Block[] | undefined,
  state: Record<string, unknown>,
  into: Record<string, unknown>,
  seen: Set<string>
): void {
  for (const block of blocks ?? []) {
    const props = (block.props ?? {}) as Record<string, unknown>
    const name = props['name']
    const stateKey = props['stateKey']
    if (
      typeof name === 'string' &&
      name &&
      typeof stateKey === 'string' &&
      stateKey &&
      props['disabled'] !== true &&
      !seen.has(name) &&
      state[stateKey] !== undefined
    ) {
      into[name] = state[stateKey]
      seen.add(name)
    }
    collect(block.children as readonly Block[] | undefined, state, into, seen)
  }
}

/**
 * The form's submitted values, completed from page state for named controls
 * FormData missed. Returns `values` itself when there is nothing to add.
 */
export function completeNamedControlValues(
  blocks: readonly Block[],
  formId: string,
  values: Record<string, unknown>,
  state: Record<string, unknown>
): Record<string, unknown> {
  const form = findBlock(blocks, formId)
  if (!form) return values
  const seen = new Set(Object.keys(values))
  const added: Record<string, unknown> = {}
  collect(form.children as readonly Block[] | undefined, state, added, seen)
  return Object.keys(added).length > 0 ? { ...values, ...added } : values
}
