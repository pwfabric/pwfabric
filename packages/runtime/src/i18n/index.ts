/**
 * i18n Capability Module
 *
 * Locale resolution, translation, pluralization, and formatting
 *
 * Exports:
 * - Types: LocaleId, LocaleDefinition, TranslationCatalog, I18nCapability, etc.
 * - Implementations: DefaultI18nCapability
 * - Factory functions: createI18nCapability
 *
 * @module @pwfabric/runtime/i18n
 */

// Types
export type {
  LocaleId,
  LocaleDefinition,
  TranslationCatalog,
  PluralCategory,
  PluralRuleFunction,
  NumberFormatOptions,
  DateFormatOptions,
  I18nCapability,
} from './types.js'

// Implementations
export type { I18nOptions, MissingKeyHandler } from './translator.js'
export { DefaultI18nCapability, createI18nCapability } from './translator.js'
