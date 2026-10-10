// @vitest-environment jsdom
/**
 * A named control with no native input inside a form is submitted.
 *
 * The form block gathers its values with `new FormData(form)`. A
 * `segmented-control` is a row of buttons (foundation <= 3.1.2 renders no
 * input at all), so without help an RSVP's yes/no answer would never reach
 * the record. The control DOES write its `stateKey`; the bridge completes the submitted values from `state[stateKey]` for every
 * named control inside the form that FormData missed.
 *
 * Shape (a generated form, trimmed):
 *   form rsvp-form
 *     section step-2  segmented-control{name:attending, stateKey:attending, value:"true"}
 *                     input{name:guests}
 *   platform/entities formBindings: rsvp-form → source attending (entity Attending)
 *
 * @module @pwfabric/runtime/render/__tests__/form-named-control-values.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import { completeNamedControlValues } from '../../forms/named-control-values.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => cleanup())

const L = DEFAULT_BLOCK_LAYOUT
type P = { block: Block; props: Record<string, unknown>; children?: React.ReactNode }

/** Gathers values the way the foundation form block does: from the DOM. */
const Form = ({ block, children }: P) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <form
      data-testid={block.id}
      onSubmit={(e) => {
        e.preventDefault()
        const values = Object.fromEntries(new FormData(e.currentTarget).entries())
        emit({
          type: SURFACE_EVENTS.FORM_SUBMIT,
          surfaceId,
          blockId: block.id,
          payload: { values, formId: block.id, timestamp: 0 },
        } as never)
      }}
    >
      {children}
    </form>
  )
}
const Section = ({ block, children }: P) => <section data-testid={block.id}>{children}</section>
const Input = ({ block, props }: P) => (
  <input data-testid={block.id} name={String(props.name)} defaultValue={String(props.value ?? '')} />
)
/** foundation <= 3.1.2's segmented control: buttons, a stateKey write, no input. */
const Segmented = ({ block, props }: P) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  const options = props.options as { label: string; value: string }[]
  return (
    <div role="radiogroup" data-testid={block.id}>
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          onClick={() =>
            emit({
              type: SURFACE_EVENTS.INPUT_CHANGE,
              surfaceId,
              blockId: block.id,
              payload: { value: o.value, name: props.name, action: { type: 'setState', key: String(props.stateKey), value: o.value } },
            } as never)
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
const components: Partial<BlockComponentRegistry> = {
  form: Form as never,
  section: Section as never,
  input: Input as never,
  'segmented-control': Segmented as never,
}

function surface(extra: Partial<Record<'disabled' | 'native', boolean>> = {}): never {
  const blocks: Block[] = [
    {
      id: 'rsvp-form',
      type: 'form',
      layout: L,
      props: {},
      children: [
        {
          id: 'step-2',
          type: 'section',
          layout: L,
          props: {},
          children: [
            {
              id: 'field-attending',
              type: 'segmented-control',
              layout: L,
              props: {
                name: 'attending',
                stateKey: 'attending',
                value: 'true',
                ...(extra.disabled ? { disabled: true } : {}),
                options: [
                  { label: 'Yes', value: 'true' },
                  { label: 'No', value: '' },
                ],
              },
            },
            { id: 'field-guests', type: 'input', layout: L, props: { name: 'guests', value: '2', stateKey: 'guests' } },
          ],
        },
      ],
    } as Block,
  ]
  return {
    id: 'davetiye',
    blocks,
    capabilities: [
      {
        capability: 'platform/persistence',
        config: { dataSources: [{ id: 'attending', kind: 'entity', entityType: 'Attending' }], initialState: { guests: 'stale' } },
      },
      { capability: 'platform/entities', config: { formBindings: [{ formId: 'rsvp-form', sourceId: 'attending' }] } },
    ],
  } as never
}

async function submitAfter(pick: string | null, s = surface()) {
  const create = vi.fn().mockResolvedValue({ success: true, data: { id: 'r1' }, id: 'r1' })
  render(
    <DataBoundSurfaceRenderer
      surface={s}
      components={components}
      entityFacade={{ store: { create } } as never}
      interactionMode="live"
    />
  )
  await screen.findByTestId('rsvp-form')
  if (pick) {
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: pick }))
    })
  }
  await act(async () => {
    fireEvent.submit(screen.getByTestId('rsvp-form'))
  })
  await waitFor(() => expect(create).toHaveBeenCalled())
  return create.mock.calls[0]?.[1] as Record<string, unknown>
}

describe('a named control with no native input reaches the record', () => {
  it('the answer the visitor picked is written', async () => {
    expect(await submitAfter('Yes')).toEqual({ attending: 'true', guests: '2' })
  })

  it('an empty answer ("No" = "") is written, not dropped', async () => {
    expect(await submitAfter('No')).toEqual({ attending: '', guests: '2' })
  })

  it('a value FormData carried wins over page state', async () => {
    // initialState.guests is "stale"; the input's own value is what the visitor sees.
    expect((await submitAfter('Yes')).guests).toBe('2')
  })

  it('a disabled control is not submitted, like a disabled native field', async () => {
    expect(await submitAfter('Yes', surface({ disabled: true }))).toEqual({ guests: '2' })
  })
})

describe('completeNamedControlValues', () => {
  const form = (children: Block[]): Block => ({ id: 'f', type: 'form', layout: L, props: {}, children }) as Block
  const ctl = (id: string, props: Record<string, unknown>, children?: Block[]): Block =>
    ({ id, type: 'segmented-control', layout: L, props, ...(children ? { children } : {}) }) as Block

  it('fills a missing name from state, nested at any depth', () => {
    const tree = [form([ctl('wrap', {}, [ctl('a', { name: 'a', stateKey: 'sa' })])])]
    expect(completeNamedControlValues(tree, 'f', { x: '1' }, { sa: false })).toEqual({ x: '1', a: false })
  })

  it('leaves values alone when the state was never written', () => {
    const tree = [form([ctl('a', { name: 'a', stateKey: 'sa' })])]
    expect(completeNamedControlValues(tree, 'f', {}, {})).toEqual({})
  })

  it('finds a form that is not at the root, and ignores controls outside it', () => {
    const tree = [ctl('outside', { name: 'o', stateKey: 'so' }), ctl('page', {}, [form([ctl('a', { name: 'a', stateKey: 'sa' })])])]
    expect(completeNamedControlValues(tree, 'f', {}, { sa: 'yes', so: 'no' })).toEqual({ a: 'yes' })
  })

  it('an unknown form or a control without a name or stateKey changes nothing', () => {
    const tree = [form([ctl('a', { stateKey: 'sa' }), ctl('b', { name: 'b' })])]
    expect(completeNamedControlValues(tree, 'nope', { k: 1 }, { sa: 1 })).toEqual({ k: 1 })
    expect(completeNamedControlValues(tree, 'f', {}, { sa: 1, b: 2 })).toEqual({})
  })
})
