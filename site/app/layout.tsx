/**
 * Root layout — the PWFabric documentation site (pwfabric.com).
 *
 * Nextra 4 on the App Router. The pages are the MDX files under `content/`,
 * rendered by `app/[[...mdxPath]]/page.tsx`; their order and titles in the
 * sidebar come from each folder's `_meta.ts`.
 */

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://pwfabric.com'),
  // Each page is titled "<page title> – PWFabric"; the home page is just "PWFabric".
  title: { default: 'PWFabric', template: '%s – PWFabric' },
  description: 'The engine that renders an app. Open source, and yours to run.',
}

const logo = (
  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.4rem' }}>
    <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>PWFabric</span>
    <span style={{ opacity: 0.5, fontWeight: 500, fontSize: '0.85em' }}>engine</span>
  </span>
)

const footer = (
  <Footer>
    <span style={{ fontSize: '0.9em', opacity: 0.75 }}>
      PWFabric is open source: Apache-2.0 and BSL 1.1 — see{' '}
      <Link href="/licence" style={{ textDecoration: 'underline' }}>
        licensing
      </Link>
      . © {new Date().getFullYear()} PhiMajor Solutions.
    </span>
  </Footer>
)

export default async function RootLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head
        color={{
          hue: { light: 174, dark: 172 },
          saturation: { light: 60, dark: 52 },
        }}
      />
      <body>
        <Layout
          navbar={<Navbar logo={logo} projectLink="https://github.com/pwfabric/pwfabric" />}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/pwfabric/pwfabric/tree/main/site"
          footer={footer}
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
