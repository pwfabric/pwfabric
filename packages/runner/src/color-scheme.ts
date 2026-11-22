/**
 * The visitor's colour scheme (appearance §4.1).
 *
 * Under the `system` mode policy an app may let the visitor choose light or
 * dark: a block reads `context.colorScheme` and calls
 * `context.setColorScheme("light" | "dark" | "system")`, which lands here.
 * The choice is set as `data-pw-theme` on the document element and kept in
 * `localStorage["pwapp_color_scheme:<appId>"]`, so it holds on every page and
 * on the next visit; `"system"` removes both. Storage that cannot be read or
 * written is not an error: the choice then lasts for the page load.
 *
 * Blocks never touch storage themselves; the shell's colour-scheme script
 * applies a stored choice before the first paint, and this store keeps it
 * from then on.
 *
 * @module @pwfabric/runner/color-scheme
 */

export type ColorScheme = 'light' | 'dark' | 'system'

/** The storage key of an app's colour-scheme choice. */
export function colorSchemeStorageKey(appId: string): string {
  return `pwapp_color_scheme:${appId}`
}

/** The attribute the choice is set as, on the document element. */
export const THEME_ATTR = 'data-pw-theme'

export interface ColorSchemeStore {
  /** The choice so far; `"system"` when none is made. */
  scheme(): ColorScheme
  /** Records a choice; any value but `"light"`, `"dark"` or `"system"` is ignored. */
  set(scheme: ColorScheme): void
  /** Called after every change of the choice; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

export interface ColorSchemeOptions {
  readonly appId: string
  readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined
  /** The document element. */
  readonly root: Pick<Element, 'setAttribute' | 'removeAttribute'>
}

const isChoice = (v: unknown): v is 'light' | 'dark' => v === 'light' || v === 'dark'

export function createColorScheme(options: ColorSchemeOptions): ColorSchemeStore {
  const key = colorSchemeStorageKey(options.appId)
  let current: ColorScheme = 'system'
  try {
    const stored = options.storage?.getItem(key)
    if (isChoice(stored)) current = stored
  } catch {
    // unreadable storage: no choice made
  }
  // What the shell's script set before the first paint, kept (a shell without
  // the script — an embedding host's — gets it here).
  if (current !== 'system') options.root.setAttribute(THEME_ATTR, current)
  const listeners = new Set<() => void>()
  return {
    scheme: () => current,
    set(scheme) {
      if (scheme !== 'system' && !isChoice(scheme)) return
      if (scheme === current) return
      current = scheme
      if (scheme === 'system') options.root.removeAttribute(THEME_ATTR)
      else options.root.setAttribute(THEME_ATTR, scheme)
      try {
        if (scheme === 'system') options.storage?.removeItem(key)
        else options.storage?.setItem(key, scheme)
      } catch {
        // blocked storage: the choice lasts for this page load
      }
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * The shell's colour-scheme script (appearance §4.1): inline in `<head>`,
 * before the theme stylesheet, it applies a stored `light` or `dark` before
 * anything is drawn, and never throws when storage is blocked. Its text names
 * the app's storage key, so its hash goes into the policy's `script-src`.
 */
export function colorSchemeScript(appId: string): string {
  const key = JSON.stringify(colorSchemeStorageKey(appId)).replace(/</g, '\\u003c')
  return `try{var s=localStorage.getItem(${key});if(s==="light"||s==="dark")document.documentElement.setAttribute("data-pw-theme",s)}catch(e){}`
}
