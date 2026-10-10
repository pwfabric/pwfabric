/**
 * i18n Capability Translator Tests
 *
 * Tests for locale resolution, translation, pluralization,
 * and number/date formatting
 *
 * @module @pwfabric/runtime/i18n/__tests__/translator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DefaultI18nCapability, createI18nCapability } from '../translator.js'

describe('DefaultI18nCapability', () => {
  let i18n: DefaultI18nCapability

  beforeEach(() => {
    i18n = new DefaultI18nCapability({ defaultLocale: 'en' })

    // Load English translations
    i18n.loadTranslations('en', {
      greeting: 'Hello, {name}!',
      welcome: 'Welcome to our app',
      'items.count': '{count, plural, one {# item} other {# items}}',
      'items.zero': '{count, plural, =0 {No items} one {# item} other {# items}}',
      'nav.home': 'Home',
      'nav.about': 'About',
      'nav.contact': 'Contact',
      'gender.pronoun': '{gender, select, male {He} female {She} other {They}}',
      farewell: 'Goodbye, {name}! See you in {days} days.',
    })
  })

  // ============================================================
  // LOCALE MANAGEMENT
  // ============================================================

  describe('addLocale', () => {
    it('should register a locale definition', () => {
      i18n.addLocale({
        id: 'en',
        name: 'English',
        nativeName: 'English',
        direction: 'ltr',
      })

      expect(i18n.getLocaleIds()).toContain('en')
    })
  })

  describe('setLocale / getLocale', () => {
    it('should set and get the current locale', () => {
      i18n.setLocale('en')
      expect(i18n.getLocale()).toBe('en')

      i18n.loadTranslations('fr', { welcome: 'Bienvenue' })
      i18n.setLocale('fr')
      expect(i18n.getLocale()).toBe('fr')
    })
  })

  describe('getLocaleIds', () => {
    it('should return all locale IDs with loaded translations', () => {
      i18n.loadTranslations('fr', { welcome: 'Bienvenue' })
      i18n.loadTranslations('de', { welcome: 'Willkommen' })

      const ids = i18n.getLocaleIds()
      expect(ids).toContain('en')
      expect(ids).toContain('fr')
      expect(ids).toContain('de')
    })
  })

  // ============================================================
  // LOCALE RESOLUTION
  // ============================================================

  describe('resolveLocale', () => {
    beforeEach(() => {
      i18n.loadTranslations('fr', { welcome: 'Bienvenue' })
      i18n.loadTranslations('de', { welcome: 'Willkommen' })
    })

    it('should resolve exact locale match', () => {
      expect(i18n.resolveLocale(['fr', 'en'])).toBe('fr')
    })

    it('should resolve language-only match', () => {
      // 'fr-CA' is not registered, but 'fr' is
      expect(i18n.resolveLocale(['fr-CA'])).toBe('fr')
    })

    it('should return default locale when no match found', () => {
      expect(i18n.resolveLocale(['ja', 'ko'])).toBe('en')
    })

    it('should try locales in preference order', () => {
      expect(i18n.resolveLocale(['ja', 'de', 'fr'])).toBe('de')
    })
  })

  // ============================================================
  // TRANSLATION
  // ============================================================

  describe('translate', () => {
    it('should return a simple translation', () => {
      expect(i18n.translate('welcome')).toBe('Welcome to our app')
    })

    it('should interpolate simple values', () => {
      expect(i18n.translate('greeting', { name: 'World' })).toBe('Hello, World!')
    })

    it('should interpolate multiple values', () => {
      expect(i18n.translate('farewell', { name: 'Alice', days: 3 })).toBe(
        'Goodbye, Alice! See you in 3 days.'
      )
    })

    it('should return the key for missing translations', () => {
      expect(i18n.translate('nonexistent.key')).toBe('nonexistent.key')
    })

    it('should support the t() shorthand', () => {
      expect(i18n.t('welcome')).toBe('Welcome to our app')
      expect(i18n.t('greeting', { name: 'Bob' })).toBe('Hello, Bob!')
    })

    it('should fall back to default locale when translation missing in current', () => {
      i18n.loadTranslations('fr', { welcome: 'Bienvenue' })
      i18n.setLocale('fr')

      // 'greeting' is not in French catalog, should fall back to English
      expect(i18n.translate('greeting', { name: 'Pierre' })).toBe('Hello, Pierre!')
    })

    it('should support fallback chain via locale definition', () => {
      i18n.addLocale({ id: 'en-GB', name: 'British English', fallback: 'en' })
      i18n.loadTranslations('en-GB', { 'nav.home': 'Home Page' })
      i18n.setLocale('en-GB')

      // Present in en-GB
      expect(i18n.translate('nav.home')).toBe('Home Page')

      // Falls back to en
      expect(i18n.translate('welcome')).toBe('Welcome to our app')
    })

    it('should leave unmatched placeholders intact', () => {
      expect(i18n.translate('greeting', {})).toBe('Hello, {name}!')
    })
  })

  // ============================================================
  // PLURALIZATION
  // ============================================================

  describe('pluralization', () => {
    it('should handle plural "one" category', () => {
      expect(i18n.translate('items.count', { count: 1 })).toBe('1 item')
    })

    it('should handle plural "other" category', () => {
      expect(i18n.translate('items.count', { count: 5 })).toBe('5 items')
    })

    it('should handle exact plural match (=0)', () => {
      expect(i18n.translate('items.zero', { count: 0 })).toBe('No items')
    })

    it('should replace # with the count value', () => {
      expect(i18n.translate('items.count', { count: 42 })).toBe('42 items')
    })
  })

  // ============================================================
  // SELECT
  // ============================================================

  describe('select', () => {
    it('should resolve select for known value', () => {
      expect(i18n.translate('gender.pronoun', { gender: 'male' })).toBe('He')
      expect(i18n.translate('gender.pronoun', { gender: 'female' })).toBe('She')
    })

    it('should fall back to other for unknown select value', () => {
      expect(i18n.translate('gender.pronoun', { gender: 'nonbinary' })).toBe('They')
    })
  })

  // ============================================================
  // HAS TRANSLATION
  // ============================================================

  describe('hasTranslation', () => {
    it('should return true for existing keys', () => {
      expect(i18n.hasTranslation('welcome')).toBe(true)
      expect(i18n.hasTranslation('nav.home')).toBe(true)
    })

    it('should return false for missing keys', () => {
      expect(i18n.hasTranslation('nonexistent')).toBe(false)
    })
  })

  // ============================================================
  // NUMBER FORMATTING
  // ============================================================

  describe('formatNumber', () => {
    it('should format a basic number', () => {
      const formatted = i18n.formatNumber(1234.56)
      // Should contain the digits (format varies by locale/runtime)
      expect(formatted).toContain('1')
      expect(formatted).toContain('234')
    })

    it('should format with custom fraction digits', () => {
      const formatted = i18n.formatNumber(3.14159, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      expect(formatted).toContain('3.14')
    })

    it('should format currency', () => {
      const formatted = i18n.formatNumber(99.99, {
        style: 'currency',
        currency: 'USD',
      })
      expect(formatted).toContain('99.99')
    })

    it('should format percentage', () => {
      const formatted = i18n.formatNumber(0.75, { style: 'percent' })
      expect(formatted).toContain('75')
    })
  })

  // ============================================================
  // DATE FORMATTING
  // ============================================================

  describe('formatDate', () => {
    it('should format a Date object', () => {
      const date = new Date('2026-01-15T10:30:00Z')
      const formatted = i18n.formatDate(date)

      // Should produce some string representation
      expect(formatted.length).toBeGreaterThan(0)
    })

    it('should format a timestamp number', () => {
      const timestamp = new Date('2026-06-15').getTime()
      const formatted = i18n.formatDate(timestamp)

      expect(formatted.length).toBeGreaterThan(0)
    })

    it('should respect date format options', () => {
      const date = new Date('2026-01-15T10:30:00Z')
      const formatted = i18n.formatDate(date, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })

      expect(formatted).toContain('2026')
      expect(formatted).toContain('15')
    })
  })

  // ============================================================
  // CUSTOM MISSING KEY HANDLER
  // ============================================================

  describe('custom missing key handler', () => {
    it('should call custom handler for missing keys', () => {
      const handler = vi.fn().mockReturnValue('[MISSING]')
      const customI18n = new DefaultI18nCapability({
        defaultLocale: 'en',
        onMissingKey: handler,
      })

      const result = customI18n.translate('missing.key')

      expect(handler).toHaveBeenCalledWith('missing.key', 'en')
      expect(result).toBe('[MISSING]')
    })
  })

  // ============================================================
  // MERGE TRANSLATIONS
  // ============================================================

  describe('loadTranslations', () => {
    it('should merge new translations with existing', () => {
      i18n.loadTranslations('en', {
        'new.key': 'New Value',
      })

      // Original translations should still be present
      expect(i18n.translate('welcome')).toBe('Welcome to our app')
      // New translation should be added
      expect(i18n.translate('new.key')).toBe('New Value')
    })

    it('should overwrite existing keys', () => {
      i18n.loadTranslations('en', {
        welcome: 'Updated welcome message',
      })

      expect(i18n.translate('welcome')).toBe('Updated welcome message')
    })
  })

  // ============================================================
  // CLEAR
  // ============================================================

  describe('clear', () => {
    it('should clear all locales and translations', () => {
      i18n.clear()

      expect(i18n.getLocaleIds()).toHaveLength(0)
      expect(i18n.getLocale()).toBe('en') // Reverts to default
      expect(i18n.hasTranslation('welcome')).toBe(false)
    })
  })
})

describe('createI18nCapability', () => {
  it('should create a DefaultI18nCapability instance', () => {
    const i18n = createI18nCapability()
    expect(i18n).toBeInstanceOf(DefaultI18nCapability)
  })

  it('should accept options', () => {
    const i18n = createI18nCapability({ defaultLocale: 'fr' })
    expect(i18n.getLocale()).toBe('fr')
  })
})
