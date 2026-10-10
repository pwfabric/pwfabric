/**
 * jsdom test setup.
 *
 * The real runtime renderer auto-detects the viewport via
 * `window.matchMedia` (see runtime/src/render/responsive.ts). jsdom does not
 * implement it, so we provide a minimal stub that reports a desktop viewport.
 */
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
