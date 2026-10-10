/**
 * What `pwf dev` adds to a page: the reload client, and the overlay shown
 * instead of the app when the last build failed.
 */
import type { AssembleDiagnostic } from './diagnostics.js'
import { escapeHtml } from './shell.js'

/** Server-Sent Events endpoint the page listens on. */
export const EVENTS_PATH = '/_pwf/events'
/** The current build's status as JSON. */
export const STATUS_PATH = '/_pwf/status'

/** Where the dev server serves the reload client's script. */
export const RELOAD_PATH = '/_pwf/reload.js'

/** The reload client's script: reloads the page when the server announces a new build. */
export const RELOAD_JS = `(function () {
  if (typeof EventSource === 'undefined') return
  var es = new EventSource('${EVENTS_PATH}')
  es.addEventListener('reload', function () { location.reload() })
})()
`

/**
 * The reload client, as markup for a page. A script file on the dev server's
 * own origin, not an inline script, so the app's Content Security Policy
 * covers it with 'self' (and its event stream with connect-src 'self').
 */
export const RELOAD_CLIENT = `
    <script src="${RELOAD_PATH}"></script>`

/** The page shown while the last build has errors. */
export function overlayHtml(diagnostics: readonly AssembleDiagnostic[], title = 'Build failed'): string {
  const errors = diagnostics.filter((d) => d.severity === 'error')
  const rest = diagnostics.length - errors.length
  const items = errors
    .map(
      (d) => `<li><code>${escapeHtml(d.code)}</code>${d.path ? ` <span class="path">${escapeHtml(d.path)}${d.line !== undefined ? `:${d.line}` : ''}</span>` : ''}<pre>${escapeHtml(d.message)}</pre></li>`
    )
    .join('\n')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — pwf dev</title>
    <style>
      body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background: #1c1917; color: #fafaf9; }
      main { max-width: 960px; margin: 0 auto; padding: 32px 16px; }
      h1 { font-size: 20px; color: #fca5a5; margin: 0 0 4px; }
      p { color: #d6d3d1; margin: 0 0 24px; }
      ul { list-style: none; padding: 0; margin: 0; }
      li { border-left: 3px solid #f87171; background: #292524; padding: 12px 16px; margin: 0 0 12px; border-radius: 4px; }
      code { color: #fca5a5; font-weight: 600; }
      .path { color: #a8a29e; margin-left: 8px; }
      pre { white-space: pre-wrap; word-break: break-word; margin: 8px 0 0; font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${errors.length} error${errors.length === 1 ? '' : 's'}${rest > 0 ? `, ${rest} other finding${rest === 1 ? '' : 's'} in the terminal` : ''}. Fix the files and the page reloads.</p>
      <ul>
${items}
      </ul>
    </main>${RELOAD_CLIENT}
  </body>
</html>
`
}
