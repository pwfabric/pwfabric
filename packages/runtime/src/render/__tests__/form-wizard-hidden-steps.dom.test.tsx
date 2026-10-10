// @vitest-environment jsdom
/**
 * A wizard inside ONE form, steps gated by `visibleWhen`.
 *
 * The shape of a generated RSVP invitation, trimmed to what matters:
 *
 *   form{showSubmit:"{{state.step == 3}}"}
 *     section{visibleWhen:"{{state.step == 1}}"} > input{name:fullName}, input{name:email}, button(step=2)
 *     section{visibleWhen:"{{state.step == 2}}"} > select{name:menuPreference}, textarea{name:note}, back, next
 *     section{visibleWhen:"{{state.step == 3}}"} > summary text
 *
 * The form block gathers its values with `new FormData(form)`. A step hidden by
 * `visibleWhen` must not be UNMOUNTED: at step 3 there would be no fields in
 * the form at all — the RSVP would be submitted empty — and going back would
 * remount step 1 with blank inputs. Inside a form a hidden block stays mounted
 * with `display: none`.
 *
 * @module @pwfabric/runtime/render/__tests__/form-wizard-hidden-steps.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { resolveBlockExpressions } from '../resolve-expressions.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const L = DEFAULT_BLOCK_LAYOUT
type P = { block: Block; props: Record<string, unknown>; children?: React.ReactNode }

let submitted: Record<string, FormDataEntryValue> | null = null

/** Gathers values the way the foundation form block does: from the DOM. */
const Form = ({ block, props, children }: P) => (
  <form
    data-testid={block.id}
    onSubmit={(e) => {
      e.preventDefault()
      submitted = Object.fromEntries(new FormData(e.currentTarget).entries())
    }}
  >
    {children}
    {props.showSubmit === true ? <button type="submit" data-testid="submit">Send</button> : null}
  </form>
)
const Section = ({ block, children }: P) => <section data-testid={block.id}>{children}</section>
const Input = ({ block, props }: P) => (
  <input data-testid={block.id} name={String(props.name)} defaultValue="" aria-label={String(props.label ?? '')} />
)
const Select = ({ block, props }: P) => (
  <select data-testid={block.id} name={String(props.name)} defaultValue="etli">
    {(props.options as { value: string; label: string }[]).map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
)
const Textarea = ({ block, props }: P) => <textarea data-testid={block.id} name={String(props.name)} defaultValue="" />
const Text = ({ block, props }: P) => <p data-testid={block.id}>{String(props.content ?? '')}</p>
const Btn = ({ block, props }: P) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={block.id}
      onClick={() => emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId, blockId: block.id } as never)}
    >
      {String(props.label ?? '')}
    </button>
  )
}
const components: Partial<BlockComponentRegistry> = {
  form: Form as never,
  section: Section as never,
  input: Input as never,
  select: Select as never,
  textarea: Textarea as never,
  text: Text as never,
  button: Btn as never,
}

const step = (value: number) => ({ type: 'setState', key: 'step', value })

function rsvpWizard(): never {
  const blocks: Block[] = [
    {
      id: 'rsvp-form',
      type: 'form',
      layout: L,
      props: { method: 'POST', action: '', showSubmit: '{{state.step == 3}}', submitLabel: 'Confirm my attendance' },
      children: [
        {
          id: 'step-one',
          type: 'section',
          layout: L,
          visibleWhen: '{{state.step == 1}}',
          props: {},
          children: [
            { id: 'full-name', type: 'input', layout: L, props: { name: 'fullName', label: 'Full name', stateKey: 'fullName' } },
            { id: 'e-posta', type: 'input', layout: L, props: { name: 'email', label: 'E-posta', stateKey: 'email' } },
            { id: 'step-one-next', type: 'button', layout: L, props: { label: 'Devam et', action: step(2) } },
          ],
        },
        {
          id: 'step-two',
          type: 'section',
          layout: L,
          visibleWhen: '{{state.step == 2}}',
          props: {},
          children: [
            {
              id: 'menu-tercihi',
              type: 'select',
              layout: L,
              props: {
                name: 'menuPreference',
                options: [
                  { label: 'Etli', value: 'etli' },
                  { label: 'Vegan', value: 'vegan' },
                ],
              },
            },
            { id: 'rsvp-note', type: 'textarea', layout: L, props: { name: 'note' } },
            { id: 'step-two-back', type: 'button', layout: L, props: { label: 'Geri', action: step(1) } },
            { id: 'step-two-next', type: 'button', layout: L, props: { label: 'See summary', action: step(3) } },
          ],
        },
        {
          id: 'step-three',
          type: 'section',
          layout: L,
          visibleWhen: '{{state.step == 3}}',
          props: {},
          children: [{ id: 'summary', type: 'text', layout: L, props: { content: 'Summary' } }],
        },
      ],
    } as Block,
  ]
  return {
    id: 'rsvp',
    blocks,
    capabilities: [{ capability: 'platform/persistence', config: { initialState: { step: 1 } } }],
  } as never
}

/** The block wrapper the renderer emits around a block. */
const wrapperOf = (id: string): HTMLElement => {
  const el = document.querySelector(`[data-block-wrapper="${id}"]`)
  if (!el) throw new Error(`no wrapper for ${id}`)
  return el as HTMLElement
}

const click = async (id: string): Promise<void> => {
  await act(async () => screen.getByTestId(id).click())
}

describe('hidden wizard steps inside a form stay mounted', () => {
  it('submitting at step 3 carries the values typed at steps 1 and 2', async () => {
    submitted = null
    render(<DataBoundSurfaceRenderer surface={rsvpWizard()} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('full-name')).not.toBeNull())

    fireEvent.change(screen.getByTestId('full-name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByTestId('e-posta'), { target: { value: 'ayse@example.com' } })
    await click('step-one-next')

    fireEvent.change(screen.getByTestId('menu-tercihi'), { target: { value: 'vegan' } })
    fireEvent.change(screen.getByTestId('rsvp-note'), { target: { value: 'We are coming\nTwo people' } })
    await click('step-two-next')

    await waitFor(() => expect(screen.queryByTestId('submit')).not.toBeNull())
    expect(wrapperOf('step-one').style.display).toBe('none')
    expect(wrapperOf('step-two').style.display).toBe('none')
    expect(wrapperOf('step-three').style.display).not.toBe('none')

    await act(async () => {
      fireEvent.submit(screen.getByTestId('rsvp-form'))
    })
    expect(submitted).toEqual({
      fullName: 'Ada Lovelace',
      email: 'ayse@example.com',
      menuPreference: 'vegan',
      note: 'We are coming\nTwo people',
    })
  })

  it('going back keeps what was typed', async () => {
    render(<DataBoundSurfaceRenderer surface={rsvpWizard()} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('full-name')).not.toBeNull())
    fireEvent.change(screen.getByTestId('full-name'), { target: { value: 'Ada' } })
    await click('step-one-next')
    await waitFor(() => expect(wrapperOf('step-one').style.display).toBe('none'))
    await click('step-two-back')
    await waitFor(() => expect(wrapperOf('step-one').style.display).not.toBe('none'))
    expect((screen.getByTestId('full-name') as HTMLInputElement).value).toBe('Ada')
  })
})

describe('the resolver: hide inside a form, unmount outside', () => {
  const tree = (): Block[] => [
    {
      id: 'f',
      type: 'form',
      layout: L,
      props: {},
      children: [
        { id: 'in-form', type: 'section', layout: L, visibleWhen: '{{state.step == 2}}', props: {}, children: [
          { id: 'nested', type: 'text', layout: L, visibleWhen: '{{false}}', props: { content: '{{state.step}}' } },
        ] },
      ],
    } as Block,
    { id: 'outside', type: 'text', layout: L, visibleWhen: '{{state.step == 2}}', props: {} } as Block,
  ]

  it('keeps the in-form block with layout.hidden and drops the outside one', () => {
    const out = resolveBlockExpressions(tree(), { state: { step: 1 } })
    expect(out.map((b) => b.id)).toEqual(['f'])
    const section = out[0]?.children?.[0] as Block & { layout: { hidden?: unknown } }
    expect(section.id).toBe('in-form')
    expect(section.layout.hidden).toMatchObject({ xs: true, lg: true })
    // its subtree is still resolved (and a hidden child is hidden, not dropped)
    const nested = section.children?.[0] as Block & { layout: { hidden?: unknown } }
    expect(nested.props?.content).toBe(1)
    expect(nested.layout.hidden).toMatchObject({ xs: true })
  })

  it('shows normally when the condition holds', () => {
    const out = resolveBlockExpressions(tree(), { state: { step: 2 } })
    const section = out[0]?.children?.[0] as Block & { layout: { hidden?: unknown } }
    expect(section.layout.hidden).toBeUndefined()
    expect(out.map((b) => b.id)).toEqual(['f', 'outside'])
  })

  it('a namespaced form type counts as a form; hideBlock inside a form hides in place', () => {
    const out = resolveBlockExpressions(
      [
        {
          id: 'f2',
          type: 'acme-base/form',
          layout: L,
          props: {},
          children: [{ id: 'x', type: 'text', layout: L, props: {} }],
        } as Block,
      ],
      { state: { '__show:x': false } }
    )
    const x = out[0]?.children?.[0] as Block & { layout: { hidden?: unknown } }
    expect(x.layout.hidden).toMatchObject({ xs: true })
  })

  it('the form itself still unmounts when its own condition is false', () => {
    const out = resolveBlockExpressions(
      [{ id: 'f3', type: 'form', layout: L, visibleWhen: '{{state.done}}', props: {}, children: [] } as Block],
      { state: { done: false } }
    )
    expect(out).toEqual([])
  })
})
