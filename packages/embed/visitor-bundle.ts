/**
 * What the visitor bundle (`dist/embed.js`) leaves out, as esbuild plugins.
 *
 * `embed.js` exposes whole module namespaces to blocks (`__pwfabric_runtime`,
 * `__pwfabric_core`, …), so nothing in them can be tree-shaken: whatever a
 * namespace reaches ships to every visitor of every app. What it reaches with
 * no use on a published page is cut here, at the one place the bundle is made:
 *
 * - **zod.** Not cut — absent: no package root bundled here imports it (3.0),
 *   and {@link noZod} turns any import that comes back into a build error.
 * - **`next/image`.** The runtime's `NextImageAdapter` is for a Next.js host,
 *   which bundles the runtime itself; a pwapp has no Next. The adapter stays
 *   exported, and fails loudly if a page ever draws it.
 *
 * What only a build, an install, a server or a tool runs is not cut here: it
 * is not in those namespaces at all. It lives on its package's subpaths
 * (`@pwfabric/core/host-imports`, `@pwfabric/contracts/pack`,
 * `@pwfabric/runtime/entity/postgres`, …), and the authoring global is the
 * runtime plus `@pwfabric/authoring/block`. The bundle test lists each module
 * and fails if one comes back.
 *
 * Kept in its own module so the test that guards the budget builds the bundle
 * with exactly these plugins.
 *
 * @module @pwfabric/embed/visitor-bundle
 */
import type { Plugin } from 'esbuild'

/**
 * zod has no place on a visitor's page (3.0): block props are declared in the
 * manifest and applied without a validation library, and the package roots
 * the bundle carries are zod-free. An import of zod that creeps back fails the
 * build here, naming the importer, instead of adding ~190 KB to every page.
 */
export const noZod: Plugin = {
  name: 'pwfabric-no-zod',
  setup(build) {
    build.onResolve({ filter: /^zod(\/.*)?$/ }, (args) => ({
      errors: [
        {
          text: `zod is not in embed.js: ${args.importer} imports '${args.path}'. Import the zod-free package root, or move the schema to a /schemas subpath (tooling only).`,
        },
      ],
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

export const visitorBundlePlugins: Plugin[] = [noZod, noNextImage]
