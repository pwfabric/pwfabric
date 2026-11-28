import { describe, expect, it } from 'vitest'
import { mergeColorLayers, mergeSurfaceThemes, surfaceThemeToCSS } from '../../fabric/appearance-cascade.js'
import { DEFAULT_APPEARANCE_THEME } from '../../fabric/surface-theme.js'

// The case it guards: an app theme (light, a near-black heading) under a page's own
// dark theme that names no heading. The heading was carried onto the dark ground.
const app = { colors: { background: '#ffffff', text: '#09090b', heading: '#09090b', link: '#1d4ed8' } }
const page = { colors: { background: '#15110e', text: '#f8efe3', primary: '#f2a43a' } }

describe('a layer that states its own ground is a new palette', () => {
  it('drops the lower layers’ extra colours, keeps the named ones', () => {
    const out = mergeColorLayers(app.colors, page.colors)
    expect(out['heading']).toBeUndefined()
    expect(out['link']).toBeUndefined()
    expect(out).toMatchObject({ background: '#15110e', text: '#f8efe3', primary: '#f2a43a' })
  })

  it('keeps them when the upper layer only touches other colours (no ground of its own)', () => {
    expect(mergeColorLayers(app.colors, { primary: '#e8590c' })['heading']).toBe('#09090b')
  })

  it('keeps an extra the upper layer restates', () => {
    expect(mergeColorLayers(app.colors, { ...page.colors, heading: '#ffffff' })['heading']).toBe('#ffffff')
  })

  it('the emitted page CSS resets the app’s heading (it would inherit from :root); the blocks then fall back to the page’s text', () => {
    const vars = surfaceThemeToCSS(page, DEFAULT_APPEARANCE_THEME, app)
    expect(vars['--pw-color-heading']).toBe('initial')
    expect(vars['--pw-color-link']).toBe('initial')
    expect(vars['--pw-color-text']).toBe('#f8efe3')
    // Positive control: without a ground of its own the page keeps the app's heading.
    expect(surfaceThemeToCSS({ colors: { primary: '#f2a43a' } }, DEFAULT_APPEARANCE_THEME, app)['--pw-color-heading']).toBe('#09090b')
  })

  it('mergeSurfaceThemes follows the same rule', () => {
    expect(mergeSurfaceThemes(app, page).colors?.['heading' as 'text']).toBeUndefined()
  })
})
