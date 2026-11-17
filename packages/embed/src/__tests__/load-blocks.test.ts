/**
 * A page's block modules are asked for all at once, and the page is drawn
 * when they are in. Before, a block's module was asked for only when the
 * block was drawn — a container's children after the container's own module
 * — so a page arrived in one wave per nesting level and shifted at each.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockModuleLoader } from '@pwfabric/runtime'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import { loadBlocks, surfaceBlockTypes } from '../load-blocks.js'
import { render } from '../index.js'

const d = (blockType: string): DynamicBlockDescriptor =>
  ({ blockType, moduleUrl: `blocks/${blockType}.mjs`, integrity: 'x'.repeat(64) }) as DynamicBlockDescriptor

const page = [
  { id: 'a', type: 'container', children: [{ id: 'b', type: 'grid', children: [{ id: 'c', type: 'card' }] }] },
  { id: 'd', type: 'text' },
]

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('surfaceBlockTypes', () => {
  it('names every type in the tree, nested ones included, once', () => {
    expect(surfaceBlockTypes([...page, { id: 'e', type: 'text' }])).toEqual(['container', 'grid', 'card', 'text'])
  })
})

describe('loadBlocks', () => {
  it('asks for every module of the page at once — the nested ones too', async () => {
    const asked: string[] = []
    vi.spyOn(BlockModuleLoader, 'isLoaded').mockReturnValue(false)
    vi.spyOn(BlockModuleLoader, 'loadAtom').mockImplementation(async (desc) => {
      asked.push(desc.blockType)
      return { Component: (() => null) as never, definition: null }
    })
    await loadBlocks(page, [d('container'), d('grid'), d('card'), d('text'), d('unused')])
    expect(asked.sort()).toEqual(['card', 'container', 'grid', 'text'])
  })

  it('never rejects, and waits no longer than its cap', async () => {
    vi.useFakeTimers()
    vi.spyOn(BlockModuleLoader, 'isLoaded').mockReturnValue(false)
    vi.spyOn(BlockModuleLoader, 'loadAtom').mockImplementation((desc) =>
      desc.blockType === 'grid' ? Promise.reject(new Error('404')) : new Promise(() => undefined)
    )
    const done = vi.fn()
    void loadBlocks(page, [d('container'), d('grid')], 500).then(done)
    await vi.advanceTimersByTimeAsync(499)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toHaveBeenCalled()
  })

  it('is drawn only once the modules are in (fat render)', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    vi.spyOn(BlockModuleLoader, 'isLoaded').mockReturnValue(false)
    vi.spyOn(BlockModuleLoader, 'loadAtom').mockImplementation(async () => {
      await gate
      return { Component: (() => null) as never, definition: null }
    })
    const target = document.createElement('div')
    document.body.appendChild(target)
    let mounted = false
    const p = render(target, { surface: { blocks: page } as never }, { blocks: [d('container')] }).then((h) => {
      mounted = true
      return h
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(mounted).toBe(false)
    release()
    const handle = await p
    expect(mounted).toBe(true)
    handle.unmount()
  })
})
