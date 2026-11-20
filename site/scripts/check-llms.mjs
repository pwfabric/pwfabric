/**
 * out/llms.txt and out/llms-full.txt exist, list every page of the sitemap,
 * and name no PWFabric site but https://pwfabric.com.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const out = fileURLToPath(new URL('../out/', import.meta.url))
const problems = []
const read = (name) => {
  if (!existsSync(out + name)) {
    problems.push(`${name} is missing`)
    return ''
  }
  return readFileSync(out + name, 'utf8')
}
const index = read('llms.txt')
const full = read('llms-full.txt')
const pages = [...readFileSync(out + 'sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

if (!index.startsWith('# PWFabric\n')) problems.push('llms.txt does not start with "# PWFabric"')
const listed = [...index.matchAll(/^- \[[^\]]+\]\(([^)]+)\)/gm)].map((m) => m[1])
for (const url of listed) if (!url.startsWith('https://pwfabric.com/')) problems.push(`llms.txt links ${url}, not on https://pwfabric.com`)
for (const page of pages) {
  if (!listed.includes(page)) problems.push(`llms.txt does not list ${page}`)
  if (!full.includes(`\n# ${page}\n`)) problems.push(`llms-full.txt has no section for ${page}`)
}
// Any web address naming pwfabric must be pwfabric.com itself: no other
// domain (people have been pointed at ones that do not exist), no subdomain.
// A bare name counts when it ends in a domain suffix (`pwfabric.dev`), not
// when it is code (`window.PWFabric.render`).
const URL_HOST = /https?:\/\/([a-z0-9.-]*pwfabric\.[a-z]{2,})/gi
const BARE_HOST = /(?<![\w.])([a-z0-9-]+\.)?pwfabric\.(com|dev|io|org|net|app|ai|co|sh|site|xyz|tech|cloud)\b/gi
for (const [name, text] of [['llms.txt', index], ['llms-full.txt', full]]) {
  const hosts = [...[...text.matchAll(URL_HOST)].map((m) => m[1]), ...[...text.matchAll(BARE_HOST)].map((m) => m[0])]
  for (const host of new Set(hosts.map((h) => h.toLowerCase()))) {
    if (host !== 'pwfabric.com') problems.push(`${name} names ${host}`)
  }
}

if (!pages.length || problems.length) {
  console.error('llms check failed:\n' + (problems.length ? problems.map((p) => `  ${p}`).join('\n') : '  the sitemap lists no pages'))
  process.exit(1)
}
console.log(`llms check: ${pages.length} pages in llms.txt and llms-full.txt, every link on https://pwfabric.com`)
