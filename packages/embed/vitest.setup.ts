/**
 * jsdom test setup.
 *
 * The real runtime renderer auto-detects the viewport via
 * `window.matchMedia` (see runtime/src/render/responsive.ts). jsdom does not
 * implement it, so we provide a minimal stub that reports a desktop viewport.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { act } from 'react'
import { afterEach, vi } from 'vitest'

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

/**
 * No React work outlives the test that started it.
 *
 * Every commit React makes outside `act` leaves a task in its scheduler (the
 * passive-effects flush, which reads `window.event`). A test that ends right
 * after a commit — its assertion saw the DOM it waited for — or that never
 * unmounts its root leaves that task queued. If the worker is still alive
 * when the file's jsdom environment is torn down, the task runs with no
 * `window` and Vitest reports "ReferenceError: window is not defined" as an
 * unhandled error against a run whose tests all passed.
 *
 * So after every test: unmount each root the test left mounted (inside `act`,
 * so the unmount's own work is flushed there and then rather than queued),
 * then wait until React's scheduler has run everything queued before.
 */
type Root = { unmount(): void }
const mounted = new Set<Root>()

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>()
  const track = <R extends Root>(root: R): R => {
    mounted.add(root)
    const unmount = root.unmount.bind(root)
    root.unmount = () => {
      mounted.delete(root)
      unmount()
    }
    return root
  }
  const createRoot: typeof actual.createRoot = (...args) => track(actual.createRoot(...args))
  const hydrateRoot: typeof actual.hydrateRoot = (...args) => track(actual.hydrateRoot(...args))
  return { ...actual, createRoot, hydrateRoot, default: { ...actual, createRoot, hydrateRoot } }
})

// react-dom's own copy of the scheduler: resolved from react-dom's folder, so
// it is the instance react-dom queues its work in.
const fromHere = createRequire(import.meta.url)
const fromReactDom = createRequire(join(dirname(fromHere.resolve('react-dom/package.json')), 'package.json'))
const scheduler = fromReactDom('scheduler') as {
  unstable_scheduleCallback(priority: number, callback: () => null): unknown
  unstable_IdlePriority: number
}

/**
 * Resolves once every task already in React's scheduler has run (an idle task
 * runs last). It resolves from a timer, not from inside the scheduler's turn:
 * the next test then starts on a timer turn, as it would without this hook.
 */
const schedulerDrained = (): Promise<void> =>
  new Promise((resolve) => {
    scheduler.unstable_scheduleCallback(scheduler.unstable_IdlePriority, () => {
      setTimeout(resolve, 0)
      return null
    })
  })

afterEach(async () => {
  if (mounted.size > 0) {
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const before = g.IS_REACT_ACT_ENVIRONMENT
    g.IS_REACT_ACT_ENVIRONMENT = true
    try {
      act(() => {
        for (const root of [...mounted]) root.unmount()
      })
    } finally {
      g.IS_REACT_ACT_ENVIRONMENT = before
    }
  }
  await schedulerDrained()
})
