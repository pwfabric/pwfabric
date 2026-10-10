/**
 * i18n Capability Types
 *
 * Locale resolution, translation, pluralization, and formatting
 *
 * @module @pwfabric/runtime/i18n/types
 */

// ============================================================
// LOCALE
// ============================================================

/**
 * Locale identifier (BCP 47 format, e.g. 'en', 'en-US', 'pt-BR')
 */
export type LocaleId = string

/**
 * Locale definition
 */
export interface LocaleDefinition {
  readonly id: LocaleId
  readonly name: string
  readonly nativeName?: string
  readonly direction?: 'ltr' | 'rtl'
  readonly fallback?: LocaleId
}

// ============================================================
// TRANSLATION CATALOG
// ============================================================

/**
 * Translation catalog -- flat key-value pairs for a locale
 *
 * Keys can be dot-separated for namespacing (e.g. 'nav.home', 'errors.notFound').
 * Values support ICU-style interpolation:
 *   - Simple: "Hello, {name}!"
 *   - Plural: "{count, plural, one {# item} other {# items}}"
 *   - Select: "{gender, select, male {He} female {She} other {They}}"
 */
export type TranslationCatalog = Readonly<Record<string, string>>

// ============================================================
// PLURALIZATION
// ============================================================

/**
 * Plural categories (CLDR)
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/**
 * Plural rule function
 */
export type PluralRuleFunction = (count: number) => PluralCategory

// ============================================================
// FORMAT OPTIONS
// ============================================================

/**
 * Number format options
 */
export interface NumberFormatOptions {
  readonly style?: 'decimal' | 'currency' | 'percent' | 'unit'
  readonly currency?: string
  readonly minimumFractionDigits?: number
  readonly maximumFractionDigits?: number
  readonly useGrouping?: boolean
}

/**
 * Date format options
 */
export interface DateFormatOptions {
  readonly style?: 'short' | 'medium' | 'long' | 'full'
  readonly dateStyle?: 'short' | 'medium' | 'long' | 'full'
  readonly timeStyle?: 'short' | 'medium' | 'long' | 'full'
  readonly year?: 'numeric' | '2-digit'
  readonly month?: 'numeric' | '2-digit' | 'long' | 'short' | 'narrow'
  readonly day?: 'numeric' | '2-digit'
  readonly hour?: 'numeric' | '2-digit'
  readonly minute?: 'numeric' | '2-digit'
  readonly second?: 'numeric' | '2-digit'
  readonly timeZone?: string
}

// ============================================================
// I18N CAPABILITY INTERFACE
// ============================================================

/**
 * i18n capability interface
 */
export interface I18nCapability {
  /** Register a locale definition */
  addLocale(locale: LocaleDefinition): void

  /** Load translations for a locale */
  loadTranslations(localeId: LocaleId, catalog: TranslationCatalog): void

  /** Resolve the best locale from a list of preferred locales */
  resolveLocale(preferred: readonly LocaleId[]): LocaleId

  /** Set the current active locale */
  setLocale(localeId: LocaleId): void

  /** Get the current active locale */
  getLocale(): LocaleId

  /** Get all registered locale IDs */
  getLocaleIds(): readonly LocaleId[]

  /** Translate a key with optional interpolation values */
  translate(key: string, values?: Readonly<Record<string, unknown>>): string

  /** Shorthand alias for translate */
  t(key: string, values?: Readonly<Record<string, unknown>>): string

  /** Format a number according to the current locale */
  formatNumber(value: number, options?: NumberFormatOptions): string

  /** Format a date according to the current locale */
  formatDate(value: Date | number, options?: DateFormatOptions): string

  /** Check if a translation key exists */
  hasTranslation(key: string): boolean

  /** Clear all locales and translations */
  clear(): void
}
