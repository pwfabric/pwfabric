/**
 * SEO Capability Types
 *
 * Meta tag generation, structured data, and Open Graph tags
 *
 * @module @pwfabric/runtime/seo/types
 */

// ============================================================
// META TAGS
// ============================================================

/**
 * Meta tag definition
 */
export interface MetaTag {
  readonly name?: string
  readonly property?: string
  readonly httpEquiv?: string
  readonly content: string
}

/**
 * Input for generating meta tags
 */
export interface MetaTagInput {
  readonly title: string
  readonly description?: string
  readonly keywords?: readonly string[]
  readonly author?: string
  readonly robots?: string
  readonly canonical?: string
  readonly viewport?: string
  readonly charset?: string
  readonly custom?: readonly MetaTag[]
}

/**
 * Generated meta tag output (serializable for SSR)
 */
export interface MetaTagOutput {
  readonly title: string
  readonly meta: readonly MetaTag[]
  readonly link: readonly LinkTag[]
}

/**
 * Link tag definition
 */
export interface LinkTag {
  readonly rel: string
  readonly href: string
  readonly type?: string
  readonly hreflang?: string
}

// ============================================================
// STRUCTURED DATA (JSON-LD)
// ============================================================

/**
 * JSON-LD structured data type
 */
export type StructuredDataType =
  | 'WebSite'
  | 'WebPage'
  | 'Article'
  | 'Organization'
  | 'Person'
  | 'BreadcrumbList'
  | 'FAQPage'
  | 'Product'
  | 'LocalBusiness'
  | string

/**
 * Input for generating structured data
 */
export interface StructuredDataInput {
  readonly type: StructuredDataType
  readonly name: string
  readonly description?: string
  readonly url?: string
  readonly image?: string | readonly string[]
  readonly datePublished?: string
  readonly dateModified?: string
  readonly author?: PersonInput | OrganizationInput
  readonly publisher?: OrganizationInput
  readonly breadcrumbs?: readonly BreadcrumbInput[]
  readonly faq?: readonly FaqInput[]
  readonly custom?: Readonly<Record<string, unknown>>
}

/**
 * Person input for structured data
 */
export interface PersonInput {
  readonly type: 'Person'
  readonly name: string
  readonly url?: string
}

/**
 * Organization input for structured data
 */
export interface OrganizationInput {
  readonly type: 'Organization'
  readonly name: string
  readonly url?: string
  readonly logo?: string
}

/**
 * Breadcrumb input
 */
export interface BreadcrumbInput {
  readonly name: string
  readonly url: string
}

/**
 * FAQ input
 */
export interface FaqInput {
  readonly question: string
  readonly answer: string
}

/**
 * Generated JSON-LD output (serializable)
 */
export interface StructuredDataOutput {
  readonly script: string
  readonly data: Readonly<Record<string, unknown>>
}

// ============================================================
// OPEN GRAPH
// ============================================================

/**
 * Open Graph type
 */
export type OpenGraphType = 'website' | 'article' | 'profile' | 'video' | 'music' | string

/**
 * Input for generating Open Graph tags
 */
export interface OpenGraphInput {
  readonly title: string
  readonly description?: string
  readonly url?: string
  readonly image?: string
  readonly imageWidth?: number
  readonly imageHeight?: number
  readonly imageAlt?: string
  readonly type?: OpenGraphType
  readonly siteName?: string
  readonly locale?: string
  readonly localeAlternates?: readonly string[]
  readonly article?: OpenGraphArticle
  readonly twitter?: TwitterCardInput
}

/**
 * Article-specific Open Graph data
 */
export interface OpenGraphArticle {
  readonly publishedTime?: string
  readonly modifiedTime?: string
  readonly author?: string
  readonly section?: string
  readonly tags?: readonly string[]
}

/**
 * Twitter card input
 */
export interface TwitterCardInput {
  readonly card?: 'summary' | 'summary_large_image' | 'app' | 'player'
  readonly site?: string
  readonly creator?: string
}

/**
 * Generated Open Graph output (serializable)
 */
export interface OpenGraphOutput {
  readonly meta: readonly MetaTag[]
}

// ============================================================
// SEO CAPABILITY INTERFACE
// ============================================================

/**
 * SEO capability interface for generating SEO-related markup
 */
export interface SeoCapability {
  /** Generate meta tags from input */
  generateMetaTags(input: MetaTagInput): MetaTagOutput

  /** Generate JSON-LD structured data */
  generateStructuredData(input: StructuredDataInput): StructuredDataOutput

  /** Generate Open Graph (and Twitter card) tags */
  generateOpenGraph(input: OpenGraphInput): OpenGraphOutput

  /** Combine all SEO outputs into a single serializable object */
  generateAll(config: SeoConfig): SeoOutput
}

/**
 * Combined SEO configuration
 */
export interface SeoConfig {
  readonly meta: MetaTagInput
  readonly structuredData?: StructuredDataInput
  readonly openGraph?: OpenGraphInput
}

/**
 * Combined SEO output (serializable for SSR)
 */
export interface SeoOutput {
  readonly metaTags: MetaTagOutput
  readonly structuredData?: StructuredDataOutput
  readonly openGraph?: OpenGraphOutput
}
