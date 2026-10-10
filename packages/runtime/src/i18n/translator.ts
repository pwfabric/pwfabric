/**
 * i18n Capability Implementation
 *
 * Locale resolution, ICU-style string interpolation,
 * pluralization, and number/date formatting
 *
 * @module @pwfabric/runtime/i18n/translator
 */

import type {
  I18nCapability,
  LocaleId,
  LocaleDefinition,
  TranslationCatalog,
  PluralCategory,
  NumberFormatOptions,
  DateFormatOptions,
} from './types.js'

// ============================================================
// DEFAULT I18N CAPABILITY
// ============================================================

/**
 * Default i18n capability implementation
 */
export class DefaultI18nCapability implements I18nCapability {
  private readonly locales = new Map<LocaleId, LocaleDefinition>()
  private readonly catalogs = new Map<LocaleId, Map<string, string>>()
  private currentLocale: LocaleId
  private readonly defaultLocale: LocaleId
  private readonly missingKeyHandler: MissingKeyHandler

  constructor(options?: I18nOptions) {
    this.defaultLocale = options?.defaultLocale ?? 'en'
    this.currentLocale = this.defaultLocale
    this.missingKeyHandler = options?.onMissingKey ?? defaultMissingKeyHandler
  }

  addLocale(locale: LocaleDefinition): void {
    this.locales.set(locale.id, locale)
  }

  loadTranslations(localeId: LocaleId, catalog: TranslationCatalog): void {
    let existing = this.catalogs.get(localeId)
    if (!existing) {
      existing = new Map()
      this.catalogs.set(localeId, existing)
    }

    for (const [key, value] of Object.entries(catalog)) {
      existing.set(key, value)
    }
  }

  resolveLocale(preferred: readonly LocaleId[]): LocaleId {
    // Try exact match
    for (const locale of preferred) {
      if (this.catalogs.has(locale)) {
        return locale
      }
    }

    // Try language-only match (e.g. 'en-US' -> 'en')
    for (const locale of preferred) {
      const language = locale.split('-')[0]
      if (language && this.catalogs.has(language)) {
        return language
      }
    }

    // Try matching registered locales by language prefix
    for (const locale of preferred) {
      const language = locale.split('-')[0]
      if (language) {
        for (const registeredId of this.catalogs.keys()) {
          if (registeredId.startsWith(language)) {
            return registeredId
          }
        }
      }
    }

    return this.defaultLocale
  }

  setLocale(localeId: LocaleId): void {
    this.currentLocale = localeId
  }

  getLocale(): LocaleId {
    return this.currentLocale
  }

  getLocaleIds(): readonly LocaleId[] {
    return Array.from(this.catalogs.keys())
  }

  translate(key: string, values?: Readonly<Record<string, unknown>>): string {
    const message = this.lookupKey(key, this.currentLocale)

    if (message === undefined) {
      return this.missingKeyHandler(key, this.currentLocale)
    }

    if (!values || Object.keys(values).length === 0) {
      return message
    }

    return this.interpolate(message, values)
  }

  t(key: string, values?: Readonly<Record<string, unknown>>): string {
    return this.translate(key, values)
  }

  formatNumber(value: number, options?: NumberFormatOptions): string {
    try {
      const intlOptions: Intl.NumberFormatOptions = {}

      if (options?.style) intlOptions.style = options.style
      if (options?.currency) intlOptions.currency = options.currency
      if (options?.minimumFractionDigits !== undefined) {
        intlOptions.minimumFractionDigits = options.minimumFractionDigits
      }
      if (options?.maximumFractionDigits !== undefined) {
        intlOptions.maximumFractionDigits = options.maximumFractionDigits
      }
      if (options?.useGrouping !== undefined) intlOptions.useGrouping = options.useGrouping

      return new Intl.NumberFormat(this.currentLocale, intlOptions).format(value)
    } catch {
      // Fallback to basic formatting
      return String(value)
    }
  }

  formatDate(value: Date | number, options?: DateFormatOptions): string {
    try {
      const date = typeof value === 'number' ? new Date(value) : value
      const intlOptions: Intl.DateTimeFormatOptions = {}

      if (options?.dateStyle) intlOptions.dateStyle = options.dateStyle
      if (options?.timeStyle) intlOptions.timeStyle = options.timeStyle
      if (options?.year) intlOptions.year = options.year
      if (options?.month) intlOptions.month = options.month
      if (options?.day) intlOptions.day = options.day
      if (options?.hour) intlOptions.hour = options.hour
      if (options?.minute) intlOptions.minute = options.minute
      if (options?.second) intlOptions.second = options.second
      if (options?.timeZone) intlOptions.timeZone = options.timeZone

      return new Intl.DateTimeFormat(this.currentLocale, intlOptions).format(date)
    } catch {
      // Fallback to ISO string
      const date = typeof value === 'number' ? new Date(value) : value
      return date.toISOString()
    }
  }

  hasTranslation(key: string): boolean {
    return this.lookupKey(key, this.currentLocale) !== undefined
  }

  clear(): void {
    this.locales.clear()
    this.catalogs.clear()
    this.currentLocale = this.defaultLocale
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  private lookupKey(key: string, localeId: LocaleId): string | undefined {
    // Try current locale
    const catalog = this.catalogs.get(localeId)
    if (catalog?.has(key)) {
      return catalog.get(key)
    }

    // Try fallback chain
    const locale = this.locales.get(localeId)
    if (locale?.fallback) {
      return this.lookupKey(key, locale.fallback)
    }

    // Try default locale if different
    if (localeId !== this.defaultLocale) {
      const defaultCatalog = this.catalogs.get(this.defaultLocale)
      if (defaultCatalog?.has(key)) {
        return defaultCatalog.get(key)
      }
    }

    return undefined
  }

  /**
   * Interpolate ICU-style message patterns
   *
   * Supports:
   * - Simple: "Hello, {name}!"
   * - Plural: "{count, plural, one {# item} other {# items}}"
   * - Select: "{gender, select, male {He} female {She} other {They}}"
   */
  private interpolate(message: string, values: Readonly<Record<string, unknown>>): string {
    let result = ''
    let i = 0

    while (i < message.length) {
      if (message[i] === '{') {
        // Extract the full brace-balanced block
        const block = this.extractBraceBlock(message, i)
        if (block !== null) {
          const inner = block.content.trim()
          result += this.resolveBlock(inner, values)
          i = block.end + 1
        } else {
          result += message[i]
          i++
        }
      } else {
        result += message[i]
        i++
      }
    }

    return result
  }

  /**
   * Extract a brace-balanced block starting at position `start`
   * Returns the content between the outer braces and the end index
   */
  private extractBraceBlock(
    message: string,
    start: number
  ): { content: string; end: number } | null {
    if (message[start] !== '{') return null

    let depth = 0
    let i = start

    while (i < message.length) {
      if (message[i] === '{') {
        depth++
      } else if (message[i] === '}') {
        depth--
        if (depth === 0) {
          return {
            content: message.slice(start + 1, i),
            end: i,
          }
        }
      }
      i++
    }

    return null
  }

  /**
   * Resolve a single interpolation block (content between outer braces)
   */
  private resolveBlock(inner: string, values: Readonly<Record<string, unknown>>): string {
    // Check for plural/select: "name, plural, ..." or "name, select, ..."
    const commaIndex = inner.indexOf(',')
    if (commaIndex > 0) {
      const varName = inner.slice(0, commaIndex).trim()
      const rest = inner.slice(commaIndex + 1).trim()

      // Check for plural
      if (rest.startsWith('plural,')) {
        const pluralBody = rest.slice('plural,'.length).trim()
        const value = values[varName]
        if (typeof value === 'number') {
          return this.resolvePlural(value, pluralBody)
        }
      }

      // Check for select
      if (rest.startsWith('select,')) {
        const selectBody = rest.slice('select,'.length).trim()
        const value = values[varName]
        return this.resolveSelect(String(value), selectBody)
      }
    }

    // Simple interpolation: "name"
    const value = values[inner]
    if (value !== undefined) {
      return String(value)
    }

    return `{${inner}}`
  }

  private resolvePlural(count: number, body: string): string {
    const category = this.getPluralCategory(count)
    const options = this.parseICUOptions(body)

    // Try exact match first (=0, =1, etc.)
    const exactMatch = options.get(`=${count}`)
    if (exactMatch) {
      return exactMatch.replace(/#/g, String(count))
    }

    // Try category match
    const categoryMatch = options.get(category)
    if (categoryMatch) {
      return categoryMatch.replace(/#/g, String(count))
    }

    // Fallback to 'other'
    const other = options.get('other')
    if (other) {
      return other.replace(/#/g, String(count))
    }

    return String(count)
  }

  private resolveSelect(value: string, body: string): string {
    const options = this.parseICUOptions(body)

    const match = options.get(value)
    if (match) return match

    const other = options.get('other')
    if (other) return other

    return value
  }

  /**
   * Parse ICU option blocks like: "one {# item} other {# items}"
   * Handles nested braces correctly using a brace-depth parser.
   */
  private parseICUOptions(body: string): Map<string, string> {
    const options = new Map<string, string>()
    let i = 0

    while (i < body.length) {
      // Skip whitespace
      while (i < body.length && /\s/.test(body[i] as string)) i++
      if (i >= body.length) break

      // Read key (non-whitespace until { or whitespace)
      let key = ''
      while (i < body.length && body[i] !== '{' && !/\s/.test(body[i] as string)) {
        key += body[i]
        i++
      }
      if (!key) break

      // Skip whitespace before opening brace
      while (i < body.length && /\s/.test(body[i] as string)) i++
      if (i >= body.length || body[i] !== '{') break

      // Extract brace-balanced value
      const block = this.extractBraceBlock(body, i)
      if (block === null) break

      options.set(key, block.content)
      i = block.end + 1
    }

    return options
  }

  private getPluralCategory(count: number): PluralCategory {
    // Basic English-style plural rules
    // For production use, this should use Intl.PluralRules
    try {
      const pr = new Intl.PluralRules(this.currentLocale)
      return pr.select(count) as PluralCategory
    } catch {
      // Fallback: simple English plural
      if (count === 0) return 'zero'
      if (count === 1) return 'one'
      return 'other'
    }
  }
}

// ============================================================
// TYPES AND HELPERS
// ============================================================

/**
 * i18n construction options
 */
export interface I18nOptions {
  /** Default locale to use */
  readonly defaultLocale?: LocaleId

  /** Handler for missing translation keys */
  readonly onMissingKey?: MissingKeyHandler
}

/**
 * Handler called when a translation key is not found
 */
export type MissingKeyHandler = (key: string, locale: LocaleId) => string

/**
 * Default handler returns the key itself as a visible fallback
 */
function defaultMissingKeyHandler(key: string, _locale: LocaleId): string {
  return key
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create an i18n capability instance
 */
export function createI18nCapability(options?: I18nOptions): I18nCapability {
  return new DefaultI18nCapability(options)
}
