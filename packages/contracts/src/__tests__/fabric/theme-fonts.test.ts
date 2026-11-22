import { describe, expect, it } from 'vitest'
import { surfaceThemeSchema } from '../../fabric/surface-schema.schema.js'

const inter = { family: 'Inter', fallback: 'sans-serif', files: [{ src: 'media/fonts/inter-latin.woff2', weight: '100 900', unicodeRange: 'U+0000-00FF, U+2000-206F' }] }

describe('a theme’s fonts (appearance §3.3)', () => {
  it('takes the app’s own woff2 files by family', () => {
    expect(surfaceThemeSchema.safeParse({ fonts: [inter, { family: 'Fraunces', fallback: 'serif', files: [{ src: 'media/fonts/fraunces-600.woff2', weight: 600, style: 'italic' }] }] }).success).toBe(true)
  })

  it('takes any CSS weight from 1 to 1000, and a range low to high', () => {
    for (const weight of [1, 950, 1000, '100 1000', '1 1000', '400 400']) {
      expect(surfaceThemeSchema.safeParse({ fonts: [{ family: 'X', files: [{ src: 'media/fonts/x.woff2', weight }] }] }).success, String(weight)).toBe(true)
    }
  })

  it('refuses a URL, another folder, another format, a weight out of range, no files, an unknown fallback, a family or a file twice', () => {
    const bad = [
      { family: 'Inter', files: [{ src: 'https://fonts.example.com/inter.woff2', weight: 400 }] },
      { family: 'Inter', files: [{ src: 'media/inter.woff2', weight: 400 }] },
      { family: 'Inter', files: [{ src: 'media/fonts/inter.ttf', weight: 400 }] },
      { family: 'Inter', files: [{ src: 'media/fonts/inter.woff2', weight: 1001 }] },
      { family: 'Inter', files: [{ src: 'media/fonts/inter.woff2', weight: 0 }] },
      { family: 'Inter', files: [{ src: 'media/fonts/inter.woff2', weight: '900 100' }] },
      { family: 'Inter', files: [{ src: 'media/fonts/inter.woff2', weight: '100 1001' }] },
      { family: 'Inter', files: [] },
      { family: 'Inter', fallback: 'arial', files: [{ src: 'media/fonts/inter.woff2', weight: 400 }] },
    ]
    for (const font of bad) expect(surfaceThemeSchema.safeParse({ fonts: [font] }).success, JSON.stringify(font)).toBe(false)
    expect(surfaceThemeSchema.safeParse({ fonts: [inter, { ...inter, family: 'inter', files: [{ src: 'media/fonts/x.woff2', weight: 400 }] }] }).success).toBe(false)
    expect(surfaceThemeSchema.safeParse({ fonts: [inter, { family: 'Other', files: inter.files }] }).success).toBe(false)
  })
})
