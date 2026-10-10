/**
 * Nextra theme config — the PWFabric documentation site (pwfabric.com).
 */

import { useRouter } from 'next/router'
import { useConfig, type DocsThemeConfig } from 'nextra-theme-docs'

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
  // Each page is titled "<page title> – PWFabric"; the home page is just "PWFabric".
  head: function Head() {
    const { frontMatter, title: pageTitle } = useConfig()
    const { asPath } = useRouter()
    // Canonical URL: the page's own path on the apex domain, without query,
    // hash or trailing slash (the export is not trailing-slash).
    const path = (asPath.split(/[?#]/)[0] ?? '/').replace(/\/+$/, '')
    const canonical = `https://pwfabric.com${path === '' ? '/' : path}`
    const title = pageTitle && pageTitle !== 'PWFabric' ? `${pageTitle} – PWFabric` : 'PWFabric'
    const description =
      frontMatter.description ?? 'The engine that renders an app. Open source, and yours to run.'
    return (
      <>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={title} />
        <meta name="description" content={description} />
        <meta property="og:description" content={description} />
      </>
    )
  },
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
