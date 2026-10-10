/**
 * Writes `out/sitemap.xml` from the static export, so a new page appears in
 * the sitemap without anyone listing it. Run after `next build`.
 *
 * Every `out/**\/*.html` is a page, except the error pages. URLs follow the
 * build's own layout (no trailingSlash: `faq.html` is served at `/faq`,
 * `index.html` at `/`). Dependency-free.
 */

import { readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ORIGIN = 'https://pwfabric.com'
const EXCLUDED = new Set(['404', '500', '_error', '_app', '_document'])

const out = fileURLToPath(new URL('../out', import.meta.url))
if (!existsSync(out)) throw new Error(`sitemap: ${out} not found; run next build first`)

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

const urls = []
for (const file of walk(out)) {
  if (!file.endsWith('.html')) continue
  const route = relative(out, file).split(sep).join('/').slice(0, -'.html'.length)
  const name = route.split('/').pop()
  if (EXCLUDED.has(route) || name.startsWith('_')) continue
  if (route === 'index') urls.push(`${ORIGIN}/`)
  else if (name === 'index') urls.push(`${ORIGIN}/${route.slice(0, -'index'.length - 1)}`)
  else urls.push(`${ORIGIN}/${route}`)
}
urls.sort()

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map((u) => `  <url><loc>${u}</loc></url>\n`).join('') +
  '</urlset>\n'

writeFileSync(join(out, 'sitemap.xml'), xml)
console.log(`sitemap: ${urls.length} URLs -> out/sitemap.xml`)
