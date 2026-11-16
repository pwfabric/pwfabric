/**
 * Every documentation page: the MDX file under `content/` that the path names.
 * `generateStaticParams` lists them all, so the static export writes one HTML
 * file per page.
 */

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { generateStaticParamsFor, importPage } from 'nextra/pages'
import { useMDXComponents as getMDXComponents } from '../../mdx-components'

interface PageProps {
  readonly params: Promise<{ mdxPath?: string[] }>
}

export const generateStaticParams = generateStaticParamsFor('mdxPath')

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params
  const { metadata } = await importPage(params.mdxPath)
  const pageTitle = typeof metadata.title === 'string' ? metadata.title : undefined
  // The home page's own title is the site name; the template would double it.
  const title = pageTitle && pageTitle !== 'PWFabric' ? pageTitle : { absolute: 'PWFabric' }
  const ogTitle = typeof title === 'string' ? `${title} – PWFabric` : 'PWFabric'
  // Canonical URL: the page's own path on the apex domain, without a trailing
  // slash (the export is not trailing-slash).
  const path = (params.mdxPath ?? []).join('/')
  return {
    ...metadata,
    title,
    alternates: { canonical: `/${path}` },
    openGraph: {
      title: ogTitle,
      ...(metadata.description ? { description: metadata.description } : {}),
    },
  }
}

const Wrapper = getMDXComponents().wrapper

export default async function Page(props: PageProps): Promise<ReactNode> {
  const params = await props.params
  const { default: MDXContent, toc, metadata, sourceCode } = await importPage(params.mdxPath)
  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  )
}
