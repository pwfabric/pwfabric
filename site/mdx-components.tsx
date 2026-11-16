/**
 * The components MDX pages render with: the docs theme's, which callers may
 * extend. Nextra 4 requires this file at the project root.
 */

import { useMDXComponents as getThemeComponents } from 'nextra-theme-docs'

const themeComponents = getThemeComponents()

export function useMDXComponents(components?: Record<string, unknown>) {
  return {
    ...themeComponents,
    ...components,
  }
}
