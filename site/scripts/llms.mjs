/**
 * Writes `out/llms.txt` and `out/llms-full.txt` from the docs content, so the
 * files a language model reads never drift from the pages people read. Run
 * after `next build` (it writes into the static export).
 *
 *   llms.txt       the llmstxt.org format: a title, a summary, then a link to
 *                  every page with its frontmatter description
 *   llms-full.txt  every page's Markdown in site order, each under its URL
 *
 * Site order is the `_meta.ts` order: a folder's pages follow its own
 * `_meta.ts`, its index first. Links are absolute on https://pwfabric.com,
 * the only domain the site is served from. Dependency-free.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ORIGIN = 'https://pwfabric.com'

const content = fileURLToPath(new URL('../content', import.meta.url))
const out = fileURLToPath(new URL('../out', import.meta.url))

/** The keys of a `_meta.ts` default export, in order (the files are plain object literals). */
function metaOrder(dir) {
  const file = join(dir, '_meta.ts')
  if (!existsSync(file)) return []
  const body = readFileSync(file, 'utf8').split('export default')[1] ?? ''
  return [...body.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_-]+))\s*:/gm)].map((m) => m[1] ?? m[2] ?? m[3])
}

/** `title` and `description` from a page's frontmatter, and the Markdown after it. */
function readPage(file) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  const front = {}
  if (match) {
    for (const line of match[1].split('\n')) {
      const kv = /^(\w+):\s*(.*)$/.exec(line)
      if (kv) front[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return { title: front.title, description: front.description, body: match ? text.slice(match[0].length) : text }
}

/** Every page in site order: `{ route, url, title, description, body }`. */
export function pages() {
  const list = []
  const visit = (dir, prefix) => {
    const names = readdirSync(dir, { withFileTypes: true })
    const known = new Set(names.map((e) => e.name.replace(/\.mdx$/, '')))
    // Pages and folders the _meta lists, in its order; anything it does not list after, by name.
    const order = [...metaOrder(dir).filter((k) => known.has(k))]
    for (const e of names.map((n) => n.name.replace(/\.mdx$/, '')).sort()) if (!order.includes(e) && !e.startsWith('_')) order.push(e)
    for (const key of order) {
      const folder = join(dir, key)
      if (existsSync(folder) && names.find((e) => e.name === key)?.isDirectory()) {
        visit(folder, `${prefix}${key}/`)
        continue
      }
      const file = join(dir, `${key}.mdx`)
      if (!existsSync(file)) continue
      const route = key === 'index' ? prefix.replace(/\/$/, '') : `${prefix}${key}`
      const page = readPage(file)
      if (!page.title) throw new Error(`llms: ${file} has no title in its frontmatter`)
      list.push({ route, url: route ? `${ORIGIN}/${route}` : `${ORIGIN}/`, ...page })
    }
  }
  visit(content, '')
  return list
}

/** Site-relative Markdown links made absolute, so a page read alone still points somewhere. */
function absolutise(markdown) {
  return markdown.replace(/\]\((\/[^)\s]*)\)/g, (_, path) => `](${ORIGIN}${path === '/' ? '/' : path})`)
}

const SUMMARY = `PWFabric is an open engine for web apps. An app is a folder of JSON documents — pages that place blocks, a plan, definitions — standing on packs of blocks, themes and capabilities; the engine validates it, renders it, builds it into a static site and packs it into a deterministic .pwpack archive. The engine ships on npm as the @pwfabric/* packages (the pwf command line is @pwfabric/cli, with a local MCP server for AI coding tools: pwf mcp). The open packs — foundation and widgets — are released at https://github.com/pwfabric/packs/releases. PWFabric was built for PhiWebs (https://phiwebs.com), which hosts and publishes PWFabric apps; nothing in the engine needs it.`

export function llmsTxt(list) {
  const groups = new Map()
  for (const p of list) {
    const top = p.route.includes('/') ? p.route.split('/')[0] : ''
    const name = top ? (list.find((q) => q.route === top)?.title ?? top) : ''
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(p)
  }
  const lines = ['# PWFabric', '', `> ${SUMMARY}`, '']
  for (const [name, items] of groups) {
    lines.push(`## ${name || 'Docs'}`, '')
    for (const p of items) {
      lines.push(`- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ''}`)
      // The MCP server is what an AI coding tool comes for: link its section directly.
      if (/^## `pwf mcp`$/m.test(p.body)) {
        lines.push(`- [pwf mcp](${p.url}#pwf-mcp): the local MCP server for any MCP client (Claude Code, Cursor, VS Code, Gemini CLI, …), its tools, and the configuration to paste`)
      }
    }
    lines.push('')
  }
  lines.push('## Optional', '', `- [Full text](${ORIGIN}/llms-full.txt): every page above in one file, in this order`, '')
  return lines.join('\n')
}

export function llmsFullTxt(list) {
  const parts = [`# PWFabric — the full documentation`, '', `> ${SUMMARY}`, '']
  for (const p of list) {
    parts.push(`# ${p.url}`, '', `Title: ${p.title}`, ...(p.description ? [`Description: ${p.description}`] : []), '', absolutise(p.body).trim(), '')
  }
  return parts.join('\n')
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  if (!existsSync(out)) throw new Error(`llms: ${out} not found; run next build first`)
  const list = pages()
  writeFileSync(join(out, 'llms.txt'), llmsTxt(list))
  writeFileSync(join(out, 'llms-full.txt'), llmsFullTxt(list))
  console.log(`llms: ${list.length} pages -> out/llms.txt, out/llms-full.txt`)
}
