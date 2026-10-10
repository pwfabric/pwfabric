/**
 * SEO Capability Module
 *
 * Meta tag generation, structured data, and Open Graph tags
 *
 * Exports:
 * - Types: MetaTagInput, StructuredDataInput, OpenGraphInput, SeoCapability, etc.
 * - Implementations: DefaultSeoCapability
 * - Factory functions: createSeoCapability
 *
 * @module @pwfabric/runtime/seo
 */

// Types
export type {
  MetaTag,
  MetaTagInput,
  MetaTagOutput,
  LinkTag,
  StructuredDataType,
  StructuredDataInput,
  PersonInput,
  OrganizationInput,
  BreadcrumbInput,
  FaqInput,
  StructuredDataOutput,
  OpenGraphType,
  OpenGraphInput,
  OpenGraphArticle,
  TwitterCardInput,
  OpenGraphOutput,
  SeoCapability,
  SeoConfig,
  SeoOutput,
} from './types.js'

// Implementations
export { DefaultSeoCapability, createSeoCapability } from './generator.js'
