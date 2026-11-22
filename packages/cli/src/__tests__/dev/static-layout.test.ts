/**
 * The first frame at every width (pwapp-format §2.5): the phone frame's
 * markup ships, and what a wider breakpoint's render changes in inline
 * styles becomes CSS for that breakpoint's widths.
 */
import { describe, expect, it } from 'vitest'
import { parseFrame, parseStyle, staticLayoutOf, visibleText, WIDE_BREAKPOINTS } from '../../dev/static-layout.js'

/** A frame whose two cells span `span` columns and whose row is `direction`. */
const frame = (span: number, direction: string, extra = ''): string =>
  `<div data-pw-surface="" data-viewport="x"><div data-block-wrapper="row" style="grid-column:span ${span} / span ${span}">` +
  `<div id="row" data-block-type="container" style="display:flex;flex-direction:${direction}${extra}"><p>One</p><p>Two</p></div></div></div>`

const at = (byName: Record<string, string>): Record<string, string> =>
  Object.fromEntries(WIDE_BREAKPOINTS.map((bp) => [bp.name, byName[bp.name] ?? byName['*'] ?? '']))

describe('staticLayoutOf', () => {
  it('writes what a wider breakpoint changes, scoped to the node, for that breakpoint’s widths', () => {
    const phone = frame(4, 'column')
    const { css, reshaped } = staticLayoutOf(phone, at({ sm: frame(8, 'column'), md: frame(8, 'column'), '*': frame(12, 'row') }))
    expect(reshaped).toEqual([])
    // sm and md need the same rules: one media query from 640 to below lg.
    expect(css).toBe(
      '@media (min-width:640px) and (max-width:1023.98px){#pw-root [data-block-wrapper="row"]{grid-column:span 8 / span 8!important}}\n' +
        '@media (min-width:1024px){#pw-root [data-block-wrapper="row"]{grid-column:span 12 / span 12!important}#pw-root [id="row"]{flex-direction:row!important}}'
    )
  })

  it('a declaration the wider layout does not make goes back to the stylesheets’ value', () => {
    const { css } = staticLayoutOf(frame(4, 'column', ';display:none'), at({ '*': frame(4, 'column') }))
    expect(css).toContain('display:flex!important')
  })

  it('nothing differs: no stylesheet', () => {
    const phone = frame(4, 'column')
    expect(staticLayoutOf(phone, at({ '*': phone })).css).toBe('')
  })

  it('names a block whose markup differs, and lays out the rest', () => {
    const phone = `<div data-block-wrapper="nav" style="width:1px"><nav data-block-type="navbar"><button>Menu</button></nav></div>`
    const wide = `<div data-block-wrapper="nav" style="width:2px"><nav data-block-type="navbar"><a>One</a><a>Two</a></nav></div>`
    const { css, reshaped } = staticLayoutOf(phone, at({ '*': wide }))
    expect(reshaped).toEqual(['navbar'])
    expect(css).toContain('#pw-root [data-block-wrapper="nav"]{width:2px!important}')
  })

  it('a <style> whose text differs is diffed rule by rule: the wider value under #pw-root, a phone-only one reverted', () => {
    const page = (css: string): string => `<div data-block-wrapper="b"><div data-block-type="box"><style>${css}</style><p>x</p></div></div>`
    const phone = page('.box{flex-direction:column;gap:8px}.only{color:red}@media (min-width:1px){.m{color:red}}@keyframes k{to{opacity:1}}')
    const wide = page('.box{flex-direction:row;gap:8px}@media (min-width:1px){.m{color:blue}}@keyframes k{to{opacity:1}}@keyframes w{to{opacity:0}}')
    const { css, reshaped } = staticLayoutOf(phone, at({ '*': wide }))
    expect(reshaped).toEqual([])
    expect(css).toContain('#pw-root .box{flex-direction:row!important}')
    expect(css).toContain('#pw-root .only{color:revert!important}')
    expect(css).toContain('@media (min-width:1px){#pw-root .m{color:blue!important}}')
    // A rule only a condition applies is not reverted; an at-rule both have is not repeated.
    expect(css).not.toContain('.m{color:revert')
    expect(css).not.toContain('@keyframes k')
    expect(css).toContain('@keyframes w{to{opacity:0}}')
  })

  it('a class or data attribute that differs names the block (CSS cannot change it); its inline styles are still laid out', () => {
    const page = (cls: string, w: number): string =>
      `<div data-viewport="v${w}" data-block-wrapper="n"><nav data-block-type="navbar" class="${cls}"><a style="width:${w}px">A</a></nav></div>`
    const { css, reshaped } = staticLayoutOf(page('menu', 1), at({ '*': page('links', 2) }))
    expect(reshaped).toEqual(['navbar'])
    expect(css).toContain('width:2px!important')
    // The breakpoint the renderer drew at is not how a node looks.
    expect(staticLayoutOf(page('menu', 1), at({ '*': page('menu', 1).replace('v1', 'v2') })).reshaped).toEqual([])
  })

  it('a node no wrapper or id names alone is addressed by its place under the nearest that does, else the root', () => {
    const phone = '<div><span style="color:red"></span></div><div><span style="color:red"></span></div>'
    const wide = '<div><span style="color:red"></span></div><div><span style="color:blue"></span></div>'
    expect(staticLayoutOf(phone, at({ '*': wide })).css).toContain('#pw-root>:nth-child(2)>:nth-child(1){color:blue!important}')
  })
})

describe('the frame’s markup', () => {
  it('parses React’s string renderer output: attributes, void elements, raw text, comments', () => {
    const root = parseFrame('<div a="x &amp; y"><!-- --><img src="i.png"/><style>p>a{}</style><br/><p>t</p></div>')
    const div = root.children[0]
    expect(div?.attrs.get('a')).toBe('x & y')
    expect(div?.children.map((c) => c.tag)).toEqual(['img', 'style', 'br', 'p'])
    expect(div?.children[1]?.text).toBe('p>a{}')
  })

  it('reads a style attribute declaration by declaration, a url’s ; included', () => {
    expect([...parseStyle('display:flex; background:url("a;b.png") ;--x:1')]).toEqual([
      ['display', 'flex'],
      ['background', 'url("a;b.png")'],
      ['--x', '1'],
    ])
  })

  it('reads the words a reader without scripts sees', () => {
    expect(visibleText('<style>.a{}</style><h1>Hi&nbsp;there</h1><template><p>no</p></template><p>you<!-- -->!</p>')).toBe('Hi there you !')
  })
})
