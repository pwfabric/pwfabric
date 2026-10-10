/**
 * Shared jsdom polyfill setup for runtime component (DOM) tests.
 *
 * jsdom does not implement `window.matchMedia` (it is a browser-only API).
 * The runtime's `useViewport` hook (`render/responsive.ts`) registers
 * `matchMedia` listeners inside a `useEffect`, so any component test that
 * mounts `SurfaceRenderer` needs a minimal `matchMedia` stub.
 *
 * Import this module for its side effect at the top of a `@vitest-environment
 * jsdom` test file:
 *
 *   import '../../__tests__/dom-test-setup.js'
 *
 * The stub returns a non-matching `MediaQueryList` with no-op listener
 * registration — enough for `useViewport` to fall back to its
 * width-based detection without throwing.
 *
 * @module @pwfabric/runtime/__tests__/dom-test-setup
 */

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string): MediaQueryList => {
    const list: MediaQueryList = {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }
    return list
  }) as typeof window.matchMedia
}
