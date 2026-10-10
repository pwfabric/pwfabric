/**
 * Self-contained fat HTML builder.
 *
 * Produces a single HTML string that renders a surface fully offline:
 *   - the surface JSON in a `<script type="application/pw-surface+json">` tag,
 *   - the block descriptors in `<script type="application/pw-blocks+json">`
 *     (with `moduleUrl` left as-is — callers should pass `data:` URLs for true
 *     offline self-containment + matching integrity hashes),
 *   - the appearance ref in `<script type="application/pw-appearance+json">`,
 *   - the bundled `embed.js` IIFE inlined verbatim in a `<script>` tag,
 *   - a bootstrap call:
 *       `PWFabric.render('#pw-root', { surface }, { mode:'fat', blocks, appearance })`.
 *
 * Pure function — no I/O. The local preview tool reads `dist/embed.js` off
 * disk and passes its contents as `embedJs`; this module never touches the
 * filesystem.
 *
 * @module @pwfabric/embed/build-fat-html
 */

import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import type { RenderableSurface } from '@pwfabric/runtime'

export interface BuildFatHtmlOptions {
  /** Surface JSON to inline + render. */
  readonly surface: RenderableSurface
  /** Block descriptors (prefer `data:` moduleUrls for offline). */
  readonly blocks?: readonly DynamicBlockDescriptor[]
  /** Appearance ref (defaults to `surface.appearance`). */
  readonly appearance?: RenderableSurface['appearance']
  /** The full contents of the built `dist/embed.js` IIFE. */
  readonly embedJs: string
  /** `<title>` of the page. */
  readonly title?: string
  /** Optional `lang` attribute. */
  readonly lang?: string
}

// Char codes for the JS-illegal line/paragraph separators (kept out of source
// text so the file stays ASCII-clean).
const LS = 0x2028
const PS = 0x2029
const LINE_SEPS = new RegExp(`[${String.fromCharCode(LS)}${String.fromCharCode(PS)}]`, 'g')

/**
 * Escape a JSON payload for safe inlining inside a `<script>` element.
 * Breaks `</script`/HTML-comment sequences and escapes the line/paragraph
 * separators that are invalid in JS string literals.
 */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPS, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
}

/** Minimal HTML-text escaper for the <title>. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Build a fully self-contained HTML document string.
 */
export function buildFatHtml(options: BuildFatHtmlOptions): string {
  const { surface, embedJs } = options
  const blocks = options.blocks ?? []
  const appearance = options.appearance ?? surface.appearance
  const title = options.title ?? 'Surface'
  const lang = options.lang ?? 'en'

  const surfaceJson = safeJson(surface)
  const blocksJson = safeJson(blocks)
  const appearanceJson = safeJson(appearance ?? null)

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>html,body{margin:0;padding:0}#pw-root{min-height:100vh}</style>
</head>
<body>
<div id="pw-root"></div>
<script type="application/pw-surface+json">${surfaceJson}</script>
<script type="application/pw-blocks+json">${blocksJson}</script>
<script type="application/pw-appearance+json">${appearanceJson}</script>
<script>${embedJs}</script>
<script>
(function(){
  var surface = JSON.parse(document.querySelector('script[type="application/pw-surface+json"]').textContent);
  var blocks = JSON.parse(document.querySelector('script[type="application/pw-blocks+json"]').textContent);
  var appearance = JSON.parse(document.querySelector('script[type="application/pw-appearance+json"]').textContent);
  PWFabric.render('#pw-root', { surface: surface }, { mode: 'fat', blocks: blocks, appearance: appearance });
})();
</script>
</body>
</html>`
}
