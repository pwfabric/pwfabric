/** Every URL in out/sitemap.xml must have a file in out/. */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const out = fileURLToPath(new URL('../out/', import.meta.url))
const urls = [...readFileSync(out + 'sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
const missing = urls.filter((u) => {
  const path = new URL(u).pathname
  return !existsSync(out + (path === '/' ? 'index.html' : `${path.slice(1)}.html`))
})
if (!urls.length || missing.length) {
  console.error('sitemap check failed:', urls.length ? missing : 'no URLs')
  process.exit(1)
}
console.log(`sitemap check: ${urls.length} URLs, all present in out/`)
