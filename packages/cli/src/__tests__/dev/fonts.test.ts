/**
 * The app's own fonts (appearance §3.3, pwapp-format §2.3): served hashed
 * under assets/fonts/, an @font-face per file, the body family's regular file
 * preloaded, a "<Family> Fallback" stand-in computed from the file and named
 * in the stacks, font-src 'self' and no font service.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assemblePwapp } from '../../dev/assemble.js'
import { fallbackFaceOf, isWoff2, woff2Metrics } from '../../dev/font-file.js'
import { makeApp, parse, text } from './helpers.js'

vi.setConfig({ testTimeout: 90_000 })

const FONT = fileURLToPath(new URL('../../__fixtures__/fonts/katex-caligraphic-regular.woff2', import.meta.url))

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})

describe('a WOFF2 file’s metrics', () => {
  it('reads units per em, the vertical metrics and the average advance out of the Brotli stream', async () => {
    const bytes = new Uint8Array(await readFile(FONT))
    expect(isWoff2(bytes)).toBe(true)
    const m = woff2Metrics(bytes)
    expect(typeof m).toBe('object')
    if (typeof m === 'string') return
    expect(m.unitsPerEm).toBe(1000)
    expect(m.ascent).toBeGreaterThan(0)
    expect(m.descent).toBeGreaterThan(0)
    expect(m.xAvgCharWidth).toBeGreaterThan(0)
    const face = fallbackFaceOf(m, 'sans-serif')
    expect(face.local).toBe('Arial')
    // The stand-in is the local font resized to the family's average advance.
    expect(face.sizeAdjust).toBeCloseTo((m.xAvgCharWidth / m.unitsPerEm / (904 / 2048)) * 100, 1)
    expect(face.ascent).toBeCloseTo((m.ascent / (m.unitsPerEm * face.sizeAdjust / 100)) * 100, 1)
  })

  it('says why a file is not one', () => {
    expect(woff2Metrics(new TextEncoder().encode('not a font at all, just some bytes here, more than fifty of them'))).toBe('it is not a WOFF2 file')
  })
})

async function withFont(typography: Record<string, string> = { fontFamily: 'Caligraphic, sans-serif' }): Promise<string> {
  const a = await makeApp()
  cleanups.push(a.cleanup)
  await mkdir(join(a.root, 'media', 'fonts'), { recursive: true })
  await writeFile(join(a.root, 'media', 'fonts', 'caligraphic.woff2'), await readFile(FONT))
  await writeFile(join(a.root, 'media', 'fonts', 'LICENSE.txt'), 'MIT')
  const path = join(a.root, 'app', 'definitions', 'appearance.json')
  const appearance = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  const theme = (appearance['theme'] ?? {}) as Record<string, unknown>
  await writeFile(
    path,
    JSON.stringify({
      ...appearance,
      theme: {
        ...theme,
        typography: { ...((theme['typography'] as object) ?? {}), ...typography },
        fonts: [{ family: 'Caligraphic', fallback: 'sans-serif', files: [{ src: 'media/fonts/caligraphic.woff2', weight: 400 }] }],
      },
    })
  )
  return a.root
}

describe('an app’s own fonts in a build', () => {
  it('serves the file hashed, declares it and its stand-in, preloads it, and names the stand-in in the stack', async () => {
    const r = await assemblePwapp(await withFont(), { cacheDir: null })
    expect(r.ok, r.diagnostics.map((d) => `${d.code} ${d.message}`).join(' | ')).toBe(true)
    const served = [...r.files.keys()].find((f) => /^assets\/fonts\/caligraphic\.[0-9a-f]{8}\.woff2$/.test(f))
    expect(served).toBeDefined()
    const theme = text(r.files.get([...r.files.keys()].find((f) => /^assets\/theme\.[0-9a-f]{8}\.css$/.test(f)) as string))
    expect(theme).toContain(`src: url("./${(served as string).slice('assets/'.length)}") format("woff2");`)
    expect(theme).toContain('font-display: swap;')
    expect(theme).toMatch(/font-family: "Caligraphic Fallback";\n {2}src: local\("Arial"\);\n {2}size-adjust: [\d.]+%;\n {2}ascent-override: [\d.]+%;/)
    const html = text(r.files.get('index.html'))
    expect(html).toContain(`<link rel="preload" as="font" type="font/woff2" href="./${served as string}" crossorigin />`)
    const appearance = parse(r.files.get('pwpack/appearance.json')) as { theme: { typography: { fontFamily: string } } }
    expect(appearance.theme.typography.fontFamily).toBe('Caligraphic, "Caligraphic Fallback", sans-serif')
    // The licence text is served as it is; the font is served once, hashed.
    expect(r.files.has('pwpack/media/fonts/LICENSE.txt')).toBe(true)
    expect(r.files.has('pwpack/media/fonts/caligraphic.woff2')).toBe(false)
  })

  it("names no font service and no font origin: font-src is 'self'", async () => {
    const r = await assemblePwapp(await withFont(), { cacheDir: null })
    const html = text(r.files.get('index.html'))
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/)
    const policy = (parse(r.files.get('publish.json')) as { csp: { policy: string } }).csp.policy
    expect(policy).toContain("font-src 'self';")
    expect(policy).not.toContain('googleapis')
  })

  it("warns when a file's metrics cannot be read (FONT_METRICS_UNREADABLE), and keeps a plain stand-in", async () => {
    const root = await withFont()
    // WOFF2 by its signature, but no tables to read.
    await writeFile(join(root, 'media', 'fonts', 'caligraphic.woff2'), new Uint8Array([0x77, 0x4f, 0x46, 0x32, ...new Array(60).fill(0)]))
    const r = await assemblePwapp(root, { cacheDir: null })
    const warning = r.diagnostics.find((d) => d.code === 'FONT_METRICS_UNREADABLE')
    expect(warning?.severity).toBe('warning')
    expect(warning?.message).toContain('the text may move')
    const theme = text(r.files.get([...r.files.keys()].find((f) => /^assets\/theme\.[0-9a-f]{8}\.css$/.test(f)) as string))
    expect(theme).toMatch(/font-family: "Caligraphic Fallback";\n {2}src: local\("Arial"\);\n\}/)
    // A file that can be read gets no such warning.
    const fine = await assemblePwapp(await withFont(), { cacheDir: null })
    expect(fine.diagnostics.some((d) => d.code === 'FONT_METRICS_UNREADABLE')).toBe(false)
  })

  it('warns about a family named with no files, and draws its fallback', async () => {
    const r = await assemblePwapp(await withFont({ fontFamily: 'Caligraphic, sans-serif', headingFontFamily: 'Nunito, serif' }), { cacheDir: null })
    expect(r.diagnostics.filter((d) => d.code === 'FONT_FILES_MISSING').map((d) => d.message).join()).toContain('Nunito')
  })
})
