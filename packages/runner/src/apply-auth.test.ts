import { describe, it, expect } from 'vitest'
import { applyAuthToSurface } from './apply-auth.js'
import type { SurfaceBlockNode } from './types.js'

type Session = Parameters<typeof applyAuthToSurface>[1]

function navbar(greeting: string): { blocks: SurfaceBlockNode[] } {
  return {
    blocks: [
      {
        id: 'nav-1',
        type: 'navbar',
        props: {
          logoText: 'Acme',
          rightInfo: [
            { label: 'weather', value: '24°C' },
            { label: 'greeting', value: greeting },
          ],
        },
      } as unknown as SurfaceBlockNode,
    ],
  }
}

function propsOf(surface: { blocks: SurfaceBlockNode[] }): Record<string, unknown> {
  return (surface.blocks[0] as { props: Record<string, unknown> }).props
}

function greetingValue(surface: { blocks: SurfaceBlockNode[] }): unknown {
  const rightInfo = propsOf(surface).rightInfo as Array<{ label: string; value: unknown }>
  return rightInfo.find((i) => i.label === 'greeting')?.value
}

const namedSession = { user: { name: 'Ada' } } as unknown as Session
const anonymousSession = { user: {} } as unknown as Session

describe('applyAuthToSurface', () => {
  it('keeps the receipt-authored Turkish greeting prefix', () => {
    const out = applyAuthToSurface(navbar('Hoş geldin, Misafir'), namedSession)
    expect(greetingValue(out)).toBe('Hoş geldin, Ada')
  })

  it('keeps the receipt-authored English greeting prefix', () => {
    const out = applyAuthToSurface(navbar('Welcome, Guest'), namedSession)
    expect(greetingValue(out)).toBe('Welcome, Ada')
  })

  it('defaults the fallback display name to English', () => {
    const out = applyAuthToSurface(navbar('Welcome, Guest'), anonymousSession)
    expect(greetingValue(out)).toBe('Welcome, User')
    expect(propsOf(out).avatarName).toBe('User')
  })

  it('uses the Turkish fallback display name when locale is tr', () => {
    const out = applyAuthToSurface(navbar('Hoş geldin, Misafir'), anonymousSession, { locale: 'tr' })
    expect(greetingValue(out)).toBe('Hoş geldin, Kullanıcı')
    expect(propsOf(out).avatarName).toBe('Kullanıcı')
  })

  it('leaves non-greeting rightInfo entries and logged-out surfaces untouched', () => {
    const surface = navbar('Hoş geldin, Misafir')
    const patched = applyAuthToSurface(surface, namedSession)
    const rightInfo = propsOf(patched).rightInfo as Array<{ label: string; value: unknown }>
    expect(rightInfo.find((i) => i.label === 'weather')?.value).toBe('24°C')
    expect(applyAuthToSurface(surface, undefined)).toBe(surface)
  })
})
