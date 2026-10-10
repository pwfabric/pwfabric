/**
 * The not-found page — what the app shows when the location names a page it
 * does not have.
 *
 * It exists because the alternative was silence. Rendering the entry surface
 * for an unresolvable URL is indistinguishable, to a reader AND to whoever
 * built the app, from the app working: every wrong link looked like a home
 * page. A four-page app shipped with twenty-one broken links and reported
 * nothing.
 *
 * Deliberately block-free: it must render when the block bundles are the very
 * thing that could not be resolved. Plain DOM + the theme's own CSS custom
 * properties (`assets/theme.css` defines them for every published app), so it
 * inherits the app's colours without importing anything.
 *
 * @module @pwfabric/runner/not-found
 */

import type { ToHref } from './helpers.js'
import { copyFor, type RunnerLocale } from './copy.js'

export interface NotFoundParams {
  /** Where the page mounts — the same container a route render would use. */
  readonly container: Element
  /** The app title, shown above the message when the project declares one. */
  readonly appTitle?: string | undefined
  /** Entry page key, for the way back. */
  readonly entry: string
  /** Active router's href builder, so the way back works in both modes. */
  readonly toHref: ToHref
  readonly locale?: RunnerLocale | undefined
}

/**
 * Replaces the container's children with the not-found page. Returns nothing:
 * like a route render, the DOM is the output.
 */
export function renderNotFound(params: NotFoundParams): void {
  const copy = copyFor(params.locale).notFound

  const page = document.createElement('div')
  page.setAttribute('data-pw-not-found', '')
  page.style.cssText = [
    'min-height:60vh',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:0.75rem',
    'padding:3rem 1.5rem',
    'text-align:center',
    'font-family:var(--pw-font-family, system-ui, sans-serif)',
    'color:var(--pw-color-text, #0f172a)',
    'background:var(--pw-color-background, #ffffff)',
  ].join(';')

  if (params.appTitle) {
    const brand = document.createElement('p')
    brand.textContent = params.appTitle
    brand.style.cssText = 'margin:0;opacity:0.6;font-size:0.875rem;letter-spacing:0.04em'
    page.appendChild(brand)
  }

  const heading = document.createElement('h1')
  heading.textContent = copy.title
  heading.style.cssText = 'margin:0;font-size:1.75rem;font-weight:600'
  page.appendChild(heading)

  const body = document.createElement('p')
  body.textContent = copy.body
  body.style.cssText = 'margin:0;opacity:0.75;max-width:36rem'
  page.appendChild(body)

  const home = document.createElement('a')
  home.textContent = copy.home
  home.href = params.toHref(params.entry)
  home.style.cssText = [
    'margin-top:0.5rem',
    'display:inline-block',
    'padding:0.625rem 1.25rem',
    'border-radius:var(--pw-border-radius, 8px)',
    'background:var(--pw-color-primary, #4f46e5)',
    'color:var(--pw-color-text-on-primary, #ffffff)',
    'text-decoration:none',
    'font-weight:500',
  ].join(';')
  page.appendChild(home)

  params.container.replaceChildren(page)
}
