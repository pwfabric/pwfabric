/**
 * Next.js configuration — pwfabric.com, the engine documentation site.
 *
 * Nextra (the docs theme) on the Pages Router, exported as plain static
 * files (`out/`) so any static host can serve it. This repository only
 * builds the site; publishing it is configured where it is deployed.
 */

import nextra from 'nextra'
import type { NextConfig } from 'next'

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
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
