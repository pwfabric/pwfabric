import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../../index.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

async function app(): Promise<string> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return join(cwd, 'demo')
}

const json = async (root: string, rel: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(root, ...rel.split('/')), 'utf8'))

describe('pwf locale add', () => {
  it('converts a single-language app on the first add, and adds only what is missing after', async () => {
    const root = await app()
    const before = await json(root, 'app/plan.json')
    const c = capture(root)
    expect(await main(['locale', 'add', 'de'], c.io)).toBe(0)
    expect(c.out[0]).toMatch(/now multi-language: en at its root/)
    const plan = await json(root, 'app/plan.json')
    expect(plan['messages']).toBeUndefined()
    expect(plan['locales']).toEqual(['en', 'de'])
    expect(plan['defaultLocale']).toBe('en')
    expect(Object.keys(plan).slice(0, 5)).toEqual(['title', 'locale', 'locales', 'defaultLocale', 'intent'])
    expect(await json(root, 'app/messages/en.json')).toEqual(before['messages'])
    const de = await json(root, 'app/messages/de.json')
    expect(Object.keys(de)).toEqual(Object.keys(before['messages'] as object))
    expect(Object.values(de).every((v) => v === '')).toBe(true)
    expect(await main(['validate'], capture(root).io)).toBe(0)

    // The same language again: nothing to do.
    const again = capture(root)
    expect(await main(['locale', 'add', 'de'], again.io)).toBe(0)
    expect(again.out[0]).toMatch(/declared already/)

    // A new id in the default: the next add fills it in, keeping what was translated.
    await writeFile(join(root, 'app', 'messages', 'de.json'), JSON.stringify({ ...de, 'notFound.title': 'Seite nicht gefunden' }))
    await writeFile(join(root, 'app', 'messages', 'en.json'), JSON.stringify({ ...(before['messages'] as object), 'ui.extra': 'More' }))
    expect(await main(['locale', 'add', 'de'], capture(root).io)).toBe(0)
    const filled = await json(root, 'app/messages/de.json')
    expect(filled['notFound.title']).toBe('Seite nicht gefunden')
    expect(filled['ui.extra']).toBe('')
  })

  it('refuses a language whose prefix a page key starts with, writing nothing', async () => {
    const root = await app()
    const id = await json(root, 'pwpack.json')
    ;(id['app'] as { surfaceOrder: string[] }).surfaceOrder.push('fr')
    await writeFile(join(root, 'pwpack.json'), JSON.stringify(id))
    await writeFile(join(root, 'app', 'surfaces', 'fr.receipt.json'), JSON.stringify({ blocks: [] }))
    const c = capture(root)
    expect(await main(['locale', 'add', 'fr'], c.io)).toBe(1)
    expect(c.text()).toMatch(/the page key "fr" starts with a locale prefix/)
    expect(existsSync(join(root, 'app', 'messages'))).toBe(false)
    expect((await json(root, 'app/plan.json'))['locales']).toBeUndefined()
  })

  it('needs --default when the plan names no locale, and refuses a tag that is not one', async () => {
    const root = await app()
    const plan = await json(root, 'app/plan.json')
    delete plan['locale']
    await writeFile(join(root, 'app', 'plan.json'), JSON.stringify(plan))
    const c = capture(root)
    expect(await main(['locale', 'add', 'de'], c.io)).toBe(2)
    expect(c.text()).toMatch(/pass --default <lang>/)
    expect(await main(['locale', 'add', 'de', '--default', 'en-GB'], capture(root).io)).toBe(0)
    expect((await json(root, 'app/plan.json'))['defaultLocale']).toBe('en-GB')
    expect(await main(['locale', 'add', 'not a tag'], capture(root).io)).toBe(2)
  })
})

describe('pwf locale status', () => {
  it('says what each locale lacks, which addresses it translates and its own receipts', async () => {
    const root = await app()
    const single = capture(root)
    expect(await main(['locale', 'status'], single.io)).toBe(0)
    expect(single.out[0]).toMatch(/single-language app in en/)

    expect(await main(['locale', 'add', 'de'], capture(root).io)).toBe(0)
    const de = await json(root, 'app/messages/de.json')
    const [first, ...rest] = Object.keys(de)
    await writeFile(join(root, 'app', 'messages', 'de.json'), JSON.stringify(Object.fromEntries(rest.map((k) => [k, k === rest[0] ? '' : 'x']))))
    await writeFile(join(root, 'app', 'surfaces', 'home.de.receipt.json'), JSON.stringify({ blocks: [] }))
    const c = capture(root)
    expect(await main(['locale', 'status', '--json'], c.io)).toBe(0)
    const status = JSON.parse(c.out.join('\n'))
    expect(status.defaultLocale).toBe('en')
    const [en, ger] = status.locales
    expect(en).toMatchObject({ locale: 'en', isDefault: true, missing: [], empty: [], receipts: [] })
    expect(ger).toMatchObject({ locale: 'de', prefix: 'de/', catalogue: true, missing: [first], empty: [rest[0]], receipts: ['home'], paths: [] })

    const text = capture(root)
    expect(await main(['locale', 'status'], text.io)).toBe(0)
    expect(text.out).toContain('de (at de/)')
    expect(text.out).toContain(`  missing 1: ${first}`)
    expect(text.out).toContain('  own receipts: home')
  })
})
