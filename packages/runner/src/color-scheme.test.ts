import { describe, expect, it, vi } from 'vitest'
import { colorSchemeScript, colorSchemeStorageKey, createColorScheme, THEME_ATTR } from './color-scheme.js'

function fakes(stored?: string) {
  const items = new Map<string, string>(stored ? [[colorSchemeStorageKey('cafe'), stored]] : [])
  const storage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  }
  const attrs = new Map<string, string>()
  const root = { setAttribute: (n: string, v: string) => void attrs.set(n, v), removeAttribute: (n: string) => void attrs.delete(n) }
  return { items, storage, attrs, root }
}

describe('the visitor’s colour scheme (appearance §4.1)', () => {
  it('is "system" until a choice is made, and reads a stored one', () => {
    const none = fakes()
    expect(createColorScheme({ appId: 'cafe', storage: none.storage, root: none.root }).scheme()).toBe('system')
    expect(none.attrs.has(THEME_ATTR)).toBe(false)
    const dark = fakes('dark')
    expect(createColorScheme({ appId: 'cafe', storage: dark.storage, root: dark.root }).scheme()).toBe('dark')
    expect(dark.attrs.get(THEME_ATTR)).toBe('dark')
  })

  it('sets data-pw-theme and keeps the choice; "system" removes both; anything else is ignored', () => {
    const f = fakes()
    const store = createColorScheme({ appId: 'cafe', storage: f.storage, root: f.root })
    const heard = vi.fn()
    store.subscribe(heard)
    store.set('dark')
    expect(f.attrs.get(THEME_ATTR)).toBe('dark')
    expect(f.items.get('pwapp_color_scheme:cafe')).toBe('dark')
    store.set('purple' as never)
    expect(store.scheme()).toBe('dark')
    store.set('system')
    expect(f.attrs.has(THEME_ATTR)).toBe(false)
    expect(f.items.has('pwapp_color_scheme:cafe')).toBe(false)
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it('lasts for the page load when storage is blocked', () => {
    const f = fakes()
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => undefined,
    }
    const store = createColorScheme({ appId: 'cafe', storage: blocked, root: f.root })
    expect(store.scheme()).toBe('system')
    store.set('light')
    expect(store.scheme()).toBe('light')
    expect(f.attrs.get(THEME_ATTR)).toBe('light')
  })
})

describe('the colour-scheme script', () => {
  it('applies a stored light or dark to the document element, and survives blocked storage', () => {
    const text = colorSchemeScript('cafe')
    expect(text).toBe(
      'try{var s=localStorage.getItem("pwapp_color_scheme:cafe");if(s==="light"||s==="dark")document.documentElement.setAttribute("data-pw-theme",s)}catch(e){}'
    )
    const attrs = new Map<string, string>()
    const run = (storage: unknown): void =>
      new Function('localStorage', 'document', text)(storage, { documentElement: { setAttribute: (n: string, v: string) => attrs.set(n, v) } })
    run({ getItem: () => 'dark' })
    expect(attrs.get('data-pw-theme')).toBe('dark')
    attrs.clear()
    run({ getItem: () => 'blue' })
    expect(attrs.size).toBe(0)
    expect(() =>
      run({
        getItem: () => {
          throw new Error('blocked')
        },
      })
    ).not.toThrow()
  })

  it('cannot close its own script element', () => {
    expect(colorSchemeScript('</script><x>')).not.toContain('</script>')
  })
})
