// @vitest-environment jsdom
/**
 * The first render knows the window's breakpoint. `useViewport` started at
 * 'lg' and corrected itself in an effect, after the browser had painted the
 * desktop layout on a phone: the page moved once under the visitor (a layout
 * shift of ~0.5 on a split page, measured with Lighthouse).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { useViewport } from '../responsive.js'

const original = window.innerWidth

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: original })
})

describe('useViewport', () => {
  it('answers the window’s breakpoint on the very first render', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    window.matchMedia ??= ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    const seen: string[] = []
    function Probe(): React.ReactElement {
      seen.push(useViewport())
      return React.createElement('span')
    }
    render(React.createElement(Probe))
    expect(seen[0]).toBe('xs')
    expect(new Set(seen)).toEqual(new Set(['xs']))
  })
})
