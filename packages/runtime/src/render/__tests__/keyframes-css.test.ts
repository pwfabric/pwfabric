/**
 * Surface keyframe registry CSS generation tests.
 *
 * Asserts that `appearance.config.keyframes` entries are emitted as
 * `@keyframes pw-kf-<name>{<body>}` (prefixed to avoid collision), and that an
 * empty/absent registry emits nothing.
 *
 * @module @pwfabric/runtime/render/__tests__/keyframes-css
 */

import { describe, it, expect } from 'vitest'
import { buildKeyframesCss } from '../keyframes-css.js'

describe('keyframes-css', () => {
  it('emits a prefixed @keyframes rule for a named keyframe', () => {
    const css = buildKeyframesCss({
      wiggle: '0%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}100%{transform:rotate(-3deg)}',
    })
    expect(css).toBe(
      '@keyframes pw-kf-wiggle{0%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}100%{transform:rotate(-3deg)}}'
    )
    // name is prefixed pw-kf- so a block references it via `animation: pw-kf-wiggle …`
    expect(css).toContain('@keyframes pw-kf-wiggle{')
  })

  it('emits one rule per entry', () => {
    const css = buildKeyframesCss({
      glow: '0%{opacity:.4}100%{opacity:1}',
      shake: '0%{left:0}100%{left:4px}',
    })
    expect(css).toContain('@keyframes pw-kf-glow{0%{opacity:.4}100%{opacity:1}}')
    expect(css).toContain('@keyframes pw-kf-shake{0%{left:0}100%{left:4px}}')
  })

  it('skips entries with an empty body', () => {
    const css = buildKeyframesCss({ empty: '   ', ok: 'from{opacity:0}to{opacity:1}' })
    expect(css).toBe('@keyframes pw-kf-ok{from{opacity:0}to{opacity:1}}')
  })

  it('emits nothing for an empty registry', () => {
    expect(buildKeyframesCss({})).toBe('')
  })

  it('emits nothing for an undefined registry', () => {
    expect(buildKeyframesCss(undefined)).toBe('')
  })
})
