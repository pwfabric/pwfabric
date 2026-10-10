/**
 * SEO Capability Generator Tests
 *
 * Tests for meta tag, structured data, and Open Graph generation
 *
 * @module @pwfabric/runtime/seo/__tests__/generator
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DefaultSeoCapability, createSeoCapability } from '../generator.js'

describe('DefaultSeoCapability', () => {
  let seo: DefaultSeoCapability

  beforeEach(() => {
    seo = new DefaultSeoCapability()
  })

  // ============================================================
  // META TAGS
  // ============================================================

  describe('generateMetaTags', () => {
    it('should generate basic meta tags', () => {
      const output = seo.generateMetaTags({
        title: 'My Page',
        description: 'A test page',
      })

      expect(output.title).toBe('My Page')
      expect(output.meta.find((m) => m.name === 'description')?.content).toBe('A test page')
    })

    it('should generate viewport meta tag', () => {
      const output = seo.generateMetaTags({ title: 'Page' })

      const viewport = output.meta.find((m) => m.name === 'viewport')
      expect(viewport).toBeDefined()
      expect(viewport?.content).toBe('width=device-width, initial-scale=1')
    })

    it('should generate charset meta tag', () => {
      const output = seo.generateMetaTags({ title: 'Page' })

      const charset = output.meta.find((m) => m.httpEquiv === 'Content-Type')
      expect(charset).toBeDefined()
      expect(charset?.content).toContain('utf-8')
    })

    it('should generate robots meta tag', () => {
      const output = seo.generateMetaTags({ title: 'Page' })

      const robots = output.meta.find((m) => m.name === 'robots')
      expect(robots).toBeDefined()
      expect(robots?.content).toBe('index, follow')
    })

    it('should allow custom robots directive', () => {
      const output = seo.generateMetaTags({
        title: 'Private Page',
        robots: 'noindex, nofollow',
      })

      const robots = output.meta.find((m) => m.name === 'robots')
      expect(robots?.content).toBe('noindex, nofollow')
    })

    it('should generate keywords meta tag', () => {
      const output = seo.generateMetaTags({
        title: 'Page',
        keywords: ['typescript', 'testing', 'seo'],
      })

      const keywords = output.meta.find((m) => m.name === 'keywords')
      expect(keywords?.content).toBe('typescript, testing, seo')
    })

    it('should generate author meta tag', () => {
      const output = seo.generateMetaTags({
        title: 'Page',
        author: 'John Doe',
      })

      const author = output.meta.find((m) => m.name === 'author')
      expect(author?.content).toBe('John Doe')
    })

    it('should generate canonical link tag', () => {
      const output = seo.generateMetaTags({
        title: 'Page',
        canonical: 'https://example.com/page',
      })

      expect(output.link).toHaveLength(1)
      expect(output.link[0]?.rel).toBe('canonical')
      expect(output.link[0]?.href).toBe('https://example.com/page')
    })

    it('should include custom meta tags', () => {
      const output = seo.generateMetaTags({
        title: 'Page',
        custom: [{ name: 'theme-color', content: '#000000' }],
      })

      const theme = output.meta.find((m) => m.name === 'theme-color')
      expect(theme?.content).toBe('#000000')
    })

    it('should append site name to title when configured', () => {
      const seoWithSiteName = new DefaultSeoCapability({ siteName: 'MySite' })

      const output = seoWithSiteName.generateMetaTags({ title: 'About' })

      expect(output.title).toBe('About | MySite')
    })

    it('should not duplicate site name in title', () => {
      const seoWithSiteName = new DefaultSeoCapability({ siteName: 'MySite' })

      const output = seoWithSiteName.generateMetaTags({ title: 'About | MySite' })

      expect(output.title).toBe('About | MySite')
    })
  })

  // ============================================================
  // STRUCTURED DATA
  // ============================================================

  describe('generateStructuredData', () => {
    it('should generate basic JSON-LD for a WebPage', () => {
      const output = seo.generateStructuredData({
        type: 'WebPage',
        name: 'Home Page',
        description: 'Welcome to our site',
        url: 'https://example.com',
      })

      expect(output.data['@context']).toBe('https://schema.org')
      expect(output.data['@type']).toBe('WebPage')
      expect(output.data.name).toBe('Home Page')
      expect(output.data.description).toBe('Welcome to our site')
      expect(output.data.url).toBe('https://example.com')
    })

    it('should produce valid JSON script string', () => {
      const output = seo.generateStructuredData({
        type: 'Article',
        name: 'Test Article',
      })

      const parsed = JSON.parse(output.script)
      expect(parsed['@context']).toBe('https://schema.org')
      expect(parsed['@type']).toBe('Article')
    })

    it('should include author information', () => {
      const output = seo.generateStructuredData({
        type: 'Article',
        name: 'My Article',
        author: { type: 'Person', name: 'Jane Doe', url: 'https://jane.com' },
      })

      const author = output.data.author as Record<string, unknown>
      expect(author['@type']).toBe('Person')
      expect(author.name).toBe('Jane Doe')
      expect(author.url).toBe('https://jane.com')
    })

    it('should include publisher with logo', () => {
      const output = seo.generateStructuredData({
        type: 'Article',
        name: 'Article',
        publisher: {
          type: 'Organization',
          name: 'Acme Inc',
          logo: 'https://acme.com/logo.png',
        },
      })

      const publisher = output.data.publisher as Record<string, unknown>
      expect(publisher['@type']).toBe('Organization')
      expect(publisher.name).toBe('Acme Inc')
      const logo = publisher.logo as Record<string, unknown>
      expect(logo['@type']).toBe('ImageObject')
      expect(logo.url).toBe('https://acme.com/logo.png')
    })

    it('should generate breadcrumb structured data', () => {
      const output = seo.generateStructuredData({
        type: 'BreadcrumbList',
        name: 'Breadcrumbs',
        breadcrumbs: [
          { name: 'Home', url: 'https://example.com' },
          { name: 'Products', url: 'https://example.com/products' },
          { name: 'Widget', url: 'https://example.com/products/widget' },
        ],
      })

      expect(output.data['@type']).toBe('BreadcrumbList')
      const items = output.data.itemListElement as Record<string, unknown>[]
      expect(items).toHaveLength(3)
      expect(items[0]?.position).toBe(1)
      expect(items[0]?.name).toBe('Home')
      expect(items[2]?.position).toBe(3)
    })

    it('should generate FAQ structured data', () => {
      const output = seo.generateStructuredData({
        type: 'FAQPage',
        name: 'FAQ',
        faq: [
          { question: 'What is this?', answer: 'A test.' },
          { question: 'How does it work?', answer: 'Very well.' },
        ],
      })

      expect(output.data['@type']).toBe('FAQPage')
      const entities = output.data.mainEntity as Record<string, unknown>[]
      expect(entities).toHaveLength(2)
      expect(entities[0]?.['@type']).toBe('Question')
      expect(entities[0]?.name).toBe('What is this?')
    })

    it('should include custom properties', () => {
      const output = seo.generateStructuredData({
        type: 'Product',
        name: 'Widget',
        custom: { price: '9.99', currency: 'USD' },
      })

      expect(output.data.price).toBe('9.99')
      expect(output.data.currency).toBe('USD')
    })

    it('should include dates', () => {
      const output = seo.generateStructuredData({
        type: 'Article',
        name: 'Post',
        datePublished: '2026-01-15',
        dateModified: '2026-02-01',
      })

      expect(output.data.datePublished).toBe('2026-01-15')
      expect(output.data.dateModified).toBe('2026-02-01')
    })
  })

  // ============================================================
  // OPEN GRAPH
  // ============================================================

  describe('generateOpenGraph', () => {
    it('should generate required OG tags', () => {
      const output = seo.generateOpenGraph({
        title: 'My Page',
      })

      const ogTitle = output.meta.find((m) => m.property === 'og:title')
      const ogType = output.meta.find((m) => m.property === 'og:type')

      expect(ogTitle?.content).toBe('My Page')
      expect(ogType?.content).toBe('website')
    })

    it('should generate description OG tag', () => {
      const output = seo.generateOpenGraph({
        title: 'Page',
        description: 'A great page',
      })

      const ogDesc = output.meta.find((m) => m.property === 'og:description')
      expect(ogDesc?.content).toBe('A great page')
    })

    it('should generate image OG tags with dimensions', () => {
      const output = seo.generateOpenGraph({
        title: 'Page',
        image: 'https://example.com/image.jpg',
        imageWidth: 1200,
        imageHeight: 630,
        imageAlt: 'Preview image',
      })

      expect(output.meta.find((m) => m.property === 'og:image')?.content).toBe(
        'https://example.com/image.jpg'
      )
      expect(output.meta.find((m) => m.property === 'og:image:width')?.content).toBe('1200')
      expect(output.meta.find((m) => m.property === 'og:image:height')?.content).toBe('630')
      expect(output.meta.find((m) => m.property === 'og:image:alt')?.content).toBe('Preview image')
    })

    it('should generate locale tags', () => {
      const output = seo.generateOpenGraph({
        title: 'Page',
        locale: 'en_US',
        localeAlternates: ['fr_FR', 'de_DE'],
      })

      expect(output.meta.find((m) => m.property === 'og:locale')?.content).toBe('en_US')
      const alternates = output.meta.filter((m) => m.property === 'og:locale:alternate')
      expect(alternates).toHaveLength(2)
    })

    it('should generate article-specific tags', () => {
      const output = seo.generateOpenGraph({
        title: 'Article',
        type: 'article',
        article: {
          publishedTime: '2026-01-15T00:00:00Z',
          author: 'Jane Doe',
          section: 'Technology',
          tags: ['ai', 'typescript'],
        },
      })

      expect(output.meta.find((m) => m.property === 'og:type')?.content).toBe('article')
      expect(output.meta.find((m) => m.property === 'article:published_time')?.content).toBe(
        '2026-01-15T00:00:00Z'
      )
      expect(output.meta.find((m) => m.property === 'article:author')?.content).toBe('Jane Doe')
      expect(output.meta.find((m) => m.property === 'article:section')?.content).toBe('Technology')
      const tags = output.meta.filter((m) => m.property === 'article:tag')
      expect(tags).toHaveLength(2)
    })

    it('should generate Twitter card tags', () => {
      const output = seo.generateOpenGraph({
        title: 'Page',
        twitter: {
          card: 'summary_large_image',
          site: '@mysite',
          creator: '@author',
        },
      })

      expect(output.meta.find((m) => m.name === 'twitter:card')?.content).toBe(
        'summary_large_image'
      )
      expect(output.meta.find((m) => m.name === 'twitter:site')?.content).toBe('@mysite')
      expect(output.meta.find((m) => m.name === 'twitter:creator')?.content).toBe('@author')
    })

    it('should generate site name tag', () => {
      const output = seo.generateOpenGraph({
        title: 'Page',
        siteName: 'My Website',
      })

      expect(output.meta.find((m) => m.property === 'og:site_name')?.content).toBe('My Website')
    })
  })

  // ============================================================
  // GENERATE ALL
  // ============================================================

  describe('generateAll', () => {
    it('should combine meta, structured data, and OG', () => {
      const output = seo.generateAll({
        meta: { title: 'Full Page', description: 'Complete SEO' },
        structuredData: { type: 'WebPage', name: 'Full Page' },
        openGraph: { title: 'Full Page', description: 'Complete SEO' },
      })

      expect(output.metaTags.title).toBe('Full Page')
      expect(output.structuredData?.data['@type']).toBe('WebPage')
      expect(output.openGraph?.meta.find((m) => m.property === 'og:title')?.content).toBe(
        'Full Page'
      )
    })

    it('should work with meta only', () => {
      const output = seo.generateAll({
        meta: { title: 'Simple Page' },
      })

      expect(output.metaTags.title).toBe('Simple Page')
      expect(output.structuredData).toBeUndefined()
      expect(output.openGraph).toBeUndefined()
    })
  })
})

describe('createSeoCapability', () => {
  it('should create a DefaultSeoCapability instance', () => {
    const seo = createSeoCapability()
    expect(seo).toBeInstanceOf(DefaultSeoCapability)
  })

  it('should accept defaults', () => {
    const seo = createSeoCapability({ siteName: 'TestSite' })
    const output = seo.generateMetaTags({ title: 'Page' })
    expect(output.title).toContain('TestSite')
  })
})
