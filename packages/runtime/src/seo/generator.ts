/**
 * SEO Capability Implementation
 *
 * Meta tag generation, JSON-LD structured data, and Open Graph tags
 *
 * All outputs are plain serializable objects suitable for SSR.
 *
 * @module @pwfabric/runtime/seo/generator
 */

import type {
  SeoCapability,
  MetaTagInput,
  MetaTagOutput,
  MetaTag,
  LinkTag,
  StructuredDataInput,
  StructuredDataOutput,
  OpenGraphInput,
  OpenGraphOutput,
  SeoConfig,
  SeoOutput,
} from './types.js'

// ============================================================
// DEFAULT SEO CAPABILITY
// ============================================================

/**
 * Default SEO capability implementation
 */
export class DefaultSeoCapability implements SeoCapability {
  private readonly defaults: SeoDefaults

  constructor(defaults?: Partial<SeoDefaults>) {
    this.defaults = {
      siteName: defaults?.siteName ?? '',
      titleSeparator: defaults?.titleSeparator ?? ' | ',
      defaultViewport: defaults?.defaultViewport ?? 'width=device-width, initial-scale=1',
      defaultCharset: defaults?.defaultCharset ?? 'utf-8',
      defaultRobots: defaults?.defaultRobots ?? 'index, follow',
    }
  }

  generateMetaTags(input: MetaTagInput): MetaTagOutput {
    const meta: MetaTag[] = []
    const link: LinkTag[] = []

    // Title (may include site name suffix)
    let title = input.title
    if (this.defaults.siteName && !title.includes(this.defaults.siteName)) {
      title = `${input.title}${this.defaults.titleSeparator}${this.defaults.siteName}`
    }

    // Charset
    const charset = input.charset ?? this.defaults.defaultCharset
    meta.push({ httpEquiv: 'Content-Type', content: `text/html; charset=${charset}` })

    // Viewport
    const viewport = input.viewport ?? this.defaults.defaultViewport
    meta.push({ name: 'viewport', content: viewport })

    // Description
    if (input.description) {
      meta.push({ name: 'description', content: input.description })
    }

    // Keywords
    if (input.keywords && input.keywords.length > 0) {
      meta.push({ name: 'keywords', content: input.keywords.join(', ') })
    }

    // Author
    if (input.author) {
      meta.push({ name: 'author', content: input.author })
    }

    // Robots
    const robots = input.robots ?? this.defaults.defaultRobots
    meta.push({ name: 'robots', content: robots })

    // Canonical
    if (input.canonical) {
      link.push({ rel: 'canonical', href: input.canonical })
    }

    // Custom tags
    if (input.custom) {
      for (const customTag of input.custom) {
        meta.push(customTag)
      }
    }

    return { title, meta, link }
  }

  generateStructuredData(input: StructuredDataInput): StructuredDataOutput {
    const data: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': input.type,
      name: input.name,
    }

    if (input.description) {
      data.description = input.description
    }

    if (input.url) {
      data.url = input.url
    }

    if (input.image) {
      data.image = input.image
    }

    if (input.datePublished) {
      data.datePublished = input.datePublished
    }

    if (input.dateModified) {
      data.dateModified = input.dateModified
    }

    // Author
    if (input.author) {
      data.author = {
        '@type': input.author.type,
        name: input.author.name,
        ...(input.author.url ? { url: input.author.url } : {}),
      }
    }

    // Publisher
    if (input.publisher) {
      const publisher: Record<string, unknown> = {
        '@type': 'Organization',
        name: input.publisher.name,
      }
      if (input.publisher.url) {
        publisher.url = input.publisher.url
      }
      if (input.publisher.logo) {
        publisher.logo = {
          '@type': 'ImageObject',
          url: input.publisher.logo,
        }
      }
      data.publisher = publisher
    }

    // Breadcrumbs
    if (input.breadcrumbs && input.breadcrumbs.length > 0) {
      data['@type'] = 'BreadcrumbList'
      data.itemListElement = input.breadcrumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: crumb.url,
      }))
    }

    // FAQ
    if (input.faq && input.faq.length > 0) {
      data['@type'] = 'FAQPage'
      data.mainEntity = input.faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      }))
    }

    // Custom properties
    if (input.custom) {
      for (const [key, value] of Object.entries(input.custom)) {
        if (key !== '@context' && key !== '@type') {
          data[key] = value
        }
      }
    }

    const script = JSON.stringify(data)

    return { script, data }
  }

  generateOpenGraph(input: OpenGraphInput): OpenGraphOutput {
    const meta: MetaTag[] = []

    // Required OG tags
    meta.push({ property: 'og:title', content: input.title })
    meta.push({ property: 'og:type', content: input.type ?? 'website' })

    // Optional OG tags
    if (input.description) {
      meta.push({ property: 'og:description', content: input.description })
    }

    if (input.url) {
      meta.push({ property: 'og:url', content: input.url })
    }

    if (input.image) {
      meta.push({ property: 'og:image', content: input.image })
      if (input.imageWidth) {
        meta.push({ property: 'og:image:width', content: String(input.imageWidth) })
      }
      if (input.imageHeight) {
        meta.push({ property: 'og:image:height', content: String(input.imageHeight) })
      }
      if (input.imageAlt) {
        meta.push({ property: 'og:image:alt', content: input.imageAlt })
      }
    }

    if (input.siteName) {
      meta.push({ property: 'og:site_name', content: input.siteName })
    }

    if (input.locale) {
      meta.push({ property: 'og:locale', content: input.locale })
    }

    if (input.localeAlternates) {
      for (const alt of input.localeAlternates) {
        meta.push({ property: 'og:locale:alternate', content: alt })
      }
    }

    // Article-specific tags
    if (input.article) {
      if (input.article.publishedTime) {
        meta.push({ property: 'article:published_time', content: input.article.publishedTime })
      }
      if (input.article.modifiedTime) {
        meta.push({ property: 'article:modified_time', content: input.article.modifiedTime })
      }
      if (input.article.author) {
        meta.push({ property: 'article:author', content: input.article.author })
      }
      if (input.article.section) {
        meta.push({ property: 'article:section', content: input.article.section })
      }
      if (input.article.tags) {
        for (const tag of input.article.tags) {
          meta.push({ property: 'article:tag', content: tag })
        }
      }
    }

    // Twitter card
    if (input.twitter) {
      meta.push({ name: 'twitter:card', content: input.twitter.card ?? 'summary' })
      if (input.twitter.site) {
        meta.push({ name: 'twitter:site', content: input.twitter.site })
      }
      if (input.twitter.creator) {
        meta.push({ name: 'twitter:creator', content: input.twitter.creator })
      }
    }

    return { meta }
  }

  generateAll(config: SeoConfig): SeoOutput {
    const output: {
      metaTags: MetaTagOutput
      structuredData?: StructuredDataOutput
      openGraph?: OpenGraphOutput
    } = {
      metaTags: this.generateMetaTags(config.meta),
    }

    if (config.structuredData) {
      output.structuredData = this.generateStructuredData(config.structuredData)
    }

    if (config.openGraph) {
      output.openGraph = this.generateOpenGraph(config.openGraph)
    }

    return output
  }
}

// ============================================================
// DEFAULTS
// ============================================================

interface SeoDefaults {
  siteName: string
  titleSeparator: string
  defaultViewport: string
  defaultCharset: string
  defaultRobots: string
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create an SEO capability instance
 */
export function createSeoCapability(defaults?: {
  siteName?: string
  titleSeparator?: string
  defaultViewport?: string
  defaultCharset?: string
  defaultRobots?: string
}): SeoCapability {
  return new DefaultSeoCapability(defaults)
}
