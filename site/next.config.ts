/**
 * Next.js configuration — pwfabric.com, the engine documentation site.
 *
 * Nextra 4 (the docs theme) on the App Router, exported as plain static
 * files (`out/`) so any static host can serve it. The pages are the MDX files
 * under `content/`. Search is Pagefind: `pnpm build` indexes the export into
 * `out/_pagefind` after `next build`. This repository only builds the site;
 * publishing it is configured where it is deployed.
 *
 * `patches/nextra-theme-docs@4.6.1.patch` (root) makes the theme's Layout
 * schema accept a missing `children`: the theme validates its props after
 * taking `children` out, which zod 4.5+ (needed for GHSA "Zod can exhaust
 * memory") reports as a missing required key. Drop the patch once a Nextra
 * release marks it optional.
 */

import nextra from 'nextra'
import type { NextConfig } from 'next'

const withNextra = nextra({
  defaultShowCopyCode: true,
})

const config: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: {
    unoptimized: true,
  },
  typescript: {
    // `pnpm typecheck` checks the site; the static export does not repeat it.
    ignoreBuildErrors: true,
  },
}

export default withNextra(config)
