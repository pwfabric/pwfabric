/**
 * Custom App component required by Nextra v3.
 *
 * Pages Router boilerplate; only injects global styles when Nextra
 * adds them.
 */

import type { AppProps } from 'next/app'
import type { ReactNode } from 'react'

export default function App({ Component, pageProps }: AppProps): ReactNode {
  return <Component {...pageProps} />
}
