// @vitest-environment jsdom
/**
 * Identity on the page: state and actions.
 *
 *  I1  a chip or a button whose `action` is `auth:signIn` (with or without a
 *      `method`) hands it to the host — it used to do nothing, so no page could
 *      start sign-in
 *  I2  a form's submit firing `auth:signIn` hands the host its field values
 *  I3  the action an event carries (`payload.action`, the shell's account
 *      control) reaches the host on a static page too
 *  I4  `{{__auth.*}}` and `{{me.*}}` read the host's state — on a page with no
 *      source at all — and read "signed out" without a host
 *  I5  a behavior's `auth:*` action reaches the host; inert mode performs none
 *
 * @module @pwfabric/runtime/render/__tests__/databound-auth.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer, isAuthAction, surfaceNeedsDataBinding } from '../DataBoundSurfaceRenderer.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'
import type { SurfaceAuthHost, SurfaceAuthState } from '../data-binding-types.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const L = DEFAULT_BLOCK_LAYOUT

/** Emits a block click — or, given `payload`, a click carrying it (the account control's shape). */
const Btn = ({ block, props }: { block: Block; props: Record<string, unknown> }) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={block.id}
      onClick={() =>
        emit({
          type: SURFACE_EVENTS.BLOCK_CLICK,
          surfaceId,
          blockId: block.id,
          ...(props.payload ? { payload: props.payload } : {}),
        } as never)
      }
    >
      {String(props.label ?? '')}
    </button>
  )
}
/** A form that submits fixed values with its `onSubmitAction`, as the pack form does. */
const Form = ({ block, props }: { block: Block; props: Record<string, unknown> }) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={block.id}
      onClick={() =>
        emit({
          type: SURFACE_EVENTS.FORM_SUBMIT,
          surfaceId,
          blockId: block.id,
          payload: { values: { email: 'a@b.c', password: 'pw' }, formId: block.id, timestamp: 0, action: props.onSubmitAction },
        } as never)
      }
    />
  )
}
const Text = ({ block, props }: { block: Block; props: Record<string, unknown> }) => (
  <div data-testid={block.id}>{String(props.text ?? '')}</div>
)
const components: Partial<BlockComponentRegistry> = {
  button: Btn as never,
  chip: Btn as never,
  form: Form as never,
  text: Text as never,
}

const SIGNED_IN: SurfaceAuthState = {
  signedIn: true,
  user: { id: 'u1', name: 'Ada', email: 'ada@example.com', roles: ['staff'] },
  methods: ['password'],
  registration: 'open',
  error: null,
}

function host(state: SurfaceAuthState = { signedIn: false, user: null, methods: ['password', 'google'], registration: 'open', error: null }) {
  const onAction = vi.fn()
  const auth: SurfaceAuthHost = { state, onAction }
  return { auth, onAction }
}

describe('I1 — a chip or a button can start sign-in', () => {
  it('a chip whose action is auth:signIn (with a method) hands it to the host', async () => {
    const { auth, onAction } = host()
    const surface = {
      id: 's',
      blocks: [
        { id: 'google', type: 'chip', layout: L, props: { label: 'Google', action: { type: 'auth:signIn', method: 'google' } } },
        { id: 'in', type: 'button', layout: L, props: { label: 'Sign in', action: { type: 'auth:signIn' } } },
      ],
    } as never
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" identity={auth} />)
    await waitFor(() => expect(screen.queryByTestId('google')).not.toBeNull())
    await act(async () => screen.getByTestId('google').click())
    await act(async () => screen.getByTestId('in').click())
    expect(onAction.mock.calls).toEqual([
      [{ type: 'auth:signIn', method: 'google' }, {}],
      [{ type: 'auth:signIn' }, {}],
    ])
  })

  it('an auth action alone makes the page data-bound, like any block action', () => {
    expect(
      surfaceNeedsDataBinding({ blocks: [{ id: 'x', type: 'button', layout: L, props: { action: { type: 'auth:signOut' } } }] as never })
    ).toBe(true)
    expect(isAuthAction({ type: 'auth:register' })).toBe(true)
    expect(isAuthAction({ type: 'auth:signIn', method: 3 })).toBe(false)
    expect(isAuthAction({ type: 'auth:delete' })).toBe(false)
  })

  it('without a host the action does nothing, and says so once in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const surface = { id: 's', blocks: [{ id: 'in', type: 'button', layout: L, props: { action: { type: 'auth:signIn' } } }] } as never
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('in')).not.toBeNull())
    await act(async () => screen.getByTestId('in').click())
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('auth:signIn'))
  })
})

describe('I2 — a form signs in with its values', () => {
  it('the submit hands the host the form values', async () => {
    const { auth, onAction } = host()
    const surface = {
      id: 's',
      blocks: [{ id: 'f', type: 'form', layout: L, props: { onSubmitAction: { type: 'auth:signIn', method: 'password' } } }],
      capabilities: [{ capability: 'platform/persistence', config: { initialState: {} } }],
    } as never
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" identity={auth} />)
    await waitFor(() => expect(screen.queryByTestId('f')).not.toBeNull())
    await act(async () => screen.getByTestId('f').click())
    expect(onAction).toHaveBeenCalledWith({ type: 'auth:signIn', method: 'password' }, { values: { email: 'a@b.c', password: 'pw' } })
  })
})

describe('I3 — the account control on a static page', () => {
  it('the action its click carries reaches the host without any data binding', async () => {
    const { auth, onAction } = host(SIGNED_IN)
    const surface = {
      id: 's',
      blocks: [{ id: 'nav', type: 'button', layout: L, props: { label: 'Out', payload: { action: { type: 'auth:signOut' } } } }],
    } as never
    expect(surfaceNeedsDataBinding(surface)).toBe(false)
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" identity={auth} />)
    await waitFor(() => expect(screen.queryByTestId('nav')).not.toBeNull())
    await act(async () => screen.getByTestId('nav').click())
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith({ type: 'auth:signOut' }, {})
  })
})

describe('I4 — the page reads who is signed in', () => {
  const greeting = (): never =>
    ({
      id: 's',
      blocks: [
        { id: 'hi', type: 'text', layout: L, props: { text: 'Welcome, {{me.name}}' }, visibleWhen: '{{__auth.signedIn}}' },
        { id: 'out', type: 'text', layout: L, props: { text: 'Signed out' }, visibleWhen: '{{!__auth.signedIn}}' },
        { id: 'roles', type: 'text', layout: L, props: { text: '{{me.roles.length}} {{__auth.methods.length}} {{__auth.error}}' } },
      ],
    }) as never

  it('{{me.*}} and {{__auth.*}} resolve on a page with no source', async () => {
    const { auth } = host(SIGNED_IN)
    render(<DataBoundSurfaceRenderer surface={greeting()} components={components} interactionMode="live" identity={auth} />)
    await waitFor(() => expect(screen.queryByTestId('hi')?.textContent).toBe('Welcome, Ada'))
    expect(screen.queryByTestId('out')).toBeNull()
    expect(screen.getByTestId('roles').textContent?.trim()).toBe('1 1')
  })

  it('a text reading only {{me.name}} is not left to the passthrough', () => {
    expect(surfaceNeedsDataBinding({ blocks: [{ id: 'a', type: 'text', layout: L, props: { text: 'Hi {{me.name}}' } }] as never })).toBe(true)
    expect(surfaceNeedsDataBinding({ blocks: [{ id: 'a', type: 'text', layout: L, props: { text: 'Hi {{state.name}}' } }] as never })).toBe(false)
  })

  it('without a host the page reads "signed out", never an unresolved value', async () => {
    render(<DataBoundSurfaceRenderer surface={greeting()} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('out')).not.toBeNull())
    expect(screen.queryByTestId('hi')).toBeNull()
  })

  it('the error is a code the page branches on', async () => {
    const { auth } = host({ signedIn: false, user: null, methods: ['password'], registration: 'open', error: 'refused' })
    const surface = {
      id: 's',
      blocks: [{ id: 'e', type: 'text', layout: L, props: { text: 'That did not work.' }, visibleWhen: "{{__auth.error == 'refused'}}" }],
    } as never
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" identity={auth} />)
    await waitFor(() => expect(screen.queryByTestId('e')).not.toBeNull())
  })
})

describe('I5 — behaviors, and inert mode', () => {
  const page = (): never =>
    ({
      id: 's',
      blocks: [{ id: 'b', type: 'button', layout: L, props: { label: 'x' } }],
      capabilities: [
        {
          capability: 'platform/persistence',
          config: { behaviors: [{ id: 'bh', event: 'block:click', targetBlockId: 'b', actions: [{ type: 'auth:register' }] }] },
        },
      ],
    }) as never

  it('a behavior’s auth:register reaches the host', async () => {
    const { auth, onAction } = host()
    render(<DataBoundSurfaceRenderer surface={page()} components={components} interactionMode="live" identity={auth} />)
    await waitFor(() => expect(screen.queryByTestId('b')).not.toBeNull())
    await act(async () => screen.getByTestId('b').click())
    expect(onAction).toHaveBeenCalledWith({ type: 'auth:register' }, {})
  })

  it('an inert (editor) render performs no auth action', async () => {
    const { auth, onAction } = host()
    const surface = { id: 's', blocks: [{ id: 'in', type: 'button', layout: L, props: { action: { type: 'auth:signIn' } } }] } as never
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="inert" identity={auth} />)
    await waitFor(() => expect(screen.queryByTestId('in')).not.toBeNull())
    await act(async () => screen.getByTestId('in').click())
    expect(onAction).not.toHaveBeenCalled()
  })
})
