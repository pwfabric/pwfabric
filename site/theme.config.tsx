/**
 * Nextra theme config — the PWFabric documentation site (pwfabric.com).
 */

import type { DocsThemeConfig } from 'nextra-theme-docs'

const config: DocsThemeConfig = {
  logo: (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.4rem' }}>
      <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>PWFabric</span>
      <span style={{ opacity: 0.5, fontWeight: 500, fontSize: '0.85em' }}>engine</span>
    </span>
  ),
  project: {
    link: 'https://github.com/pwfabric/pwfabric',
  },
  docsRepositoryBase:
    'https://github.com/pwfabric/pwfabric/tree/main/site',
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>PWFabric</title>
      <meta property="og:title" content="PWFabric" />
      <meta
        property="og:description"
        content="The engine that renders an app. Open source, and yours to run."
      />
    </>
  ),
  footer: {
    content: (
      <span style={{ fontSize: '0.9em', opacity: 0.75 }}>
        PWFabric is open source: Apache-2.0 and BSL 1.1 — see{' '}
        <a href="/licence" style={{ textDecoration: 'underline' }}>
          licensing
        </a>
        . © {new Date().getFullYear()} PhiMajor Solutions.
      </span>
    ),
  },
  sidebar: {
    defaultMenuCollapseLevel: 1,
  },
  color: {
    hue: { light: 174, dark: 172 },
    saturation: { light: 60, dark: 52 },
  },
}

export default config
