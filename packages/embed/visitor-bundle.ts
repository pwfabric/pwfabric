/**
 * What the visitor bundle (`dist/embed.js`) leaves out, as esbuild plugins.
 *
 * `embed.js` exposes whole module namespaces to blocks (`__pwfabric_zod`,
 * `__pwfabric_runtime`, …), so nothing in them can be tree-shaken: whatever a
 * namespace reaches ships to every visitor of every app. Two things it reaches
 * have no use on a published page and are cut here, at the one place the
 * bundle is made:
 *
 * - **zod's message locales.** `z.locales` carries ~50 translations of zod's
 *   error messages (~264 KB minified, more than a quarter of the bundle). zod
 *   itself uses English (`en`), and nothing in the engine switches it. The
 *   bundle keeps `z.locales.en` only; a block that wants zod's messages in
 *   another language ships that locale itself.
 * - **`next/image`.** The runtime's `NextImageAdapter` is for a Next.js host,
 *   which bundles the runtime itself; a pwapp has no Next. The adapter stays
 *   exported, and fails loudly if a page ever draws it.
 *
 * Kept in its own module so the test that guards the budget builds the bundle
 * with exactly these plugins.
 *
 * @module @pwfabric/embed/visitor-bundle
 */
import { dirname, join } from 'node:path'
import type { Plugin } from 'esbuild'

/** zod's locale index, as zod's own modules import it. */
const ZOD_LOCALES = /^\.\.\/locales(\/index\.js)?$/

/** `z.locales` with English only. */
export const zodEnglishOnly: Plugin = {
  name: 'pwfabric-zod-english-only',
  setup(build) {
    build.onResolve({ filter: ZOD_LOCALES }, (args) => {
      if (!/[\\/]zod[\\/]/.test(args.importer)) return undefined
      return { path: join(dirname(args.importer), '..', 'locales', 'index.js'), namespace: 'pwfabric-zod-locales' }
    })
    build.onLoad({ filter: /.*/, namespace: 'pwfabric-zod-locales' }, (args) => ({
      contents: `export { default as en } from ${JSON.stringify(join(dirname(args.path), 'en.js'))}\n`,
      loader: 'js',
      resolveDir: dirname(args.path),
    }))
  },
}

/** `next/image` replaced by a component that says why it cannot draw. */
export const noNextImage: Plugin = {
  name: 'pwfabric-no-next-image',
  setup(build) {
    build.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'next/image', namespace: 'pwfabric-no-next' }))
    build.onLoad({ filter: /.*/, namespace: 'pwfabric-no-next' }, () => ({
      contents:
        'export default function NextImage() { throw new Error("[pwfabric-embed] next/image is not in embed.js: NextImageAdapter is for a Next.js host") }\n',
      loader: 'js',
    }))
  },
}

export const visitorBundlePlugins: Plugin[] = [zodEnglishOnly, noNextImage]
