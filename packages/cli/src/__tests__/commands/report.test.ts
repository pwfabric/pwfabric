import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { checkEntities, checkSeeds } from '../../commands/lib/report.js'
import { tempDir } from './helpers.js'

async function project(files: Record<string, unknown>): Promise<string> {
  const root = await tempDir()
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), typeof body === 'string' ? body : JSON.stringify(body))
  }
  return root
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code)

describe('checkSeeds', () => {
  it('passes a project without app/data and seeds in either accepted form', async () => {
    expect(checkSeeds(await project({}))).toEqual([])
    const root = await project({
      'app/data/Booking.json': { data: [{ name: 'a' }] },
      'app/data/Note.jsonl': '{"text":"x"}\n\n{"text":"y"}\n',
    })
    expect(checkSeeds(root)).toEqual([])
  })

  it('flags a seed the dev host would reject', async () => {
    const root = await project({
      'app/data/Booking.json': [],
      'app/data/Event.json': '{ not json',
    })
    const issues = checkSeeds(root)
    expect(codes(issues)).toEqual(['SEED_INVALID', 'SEED_INVALID'])
    expect(issues.map((i) => i.path).sort()).toEqual(['app/data/Booking', 'app/data/Event'])
    expect(issues.find((i) => i.path === 'app/data/Booking')?.message).toContain('{ "data": [ ...records ] }')
    expect(issues.every((i) => i.severity === 'error')).toBe(true)
  })
})

describe('checkEntities', () => {
  const receipt = (entityType: string) => ({ blocks: [{ props: { form: { submit: { entityType } } } }] })

  it('passes declared entities that the pages use', async () => {
    const root = await project({
      'app/definitions/entities.json': { entities: [{ typeId: 'Booking', fields: [{ name: 'email', type: 'text', required: true }] }] },
      'app/surfaces/home.receipt.json': receipt('Booking'),
    })
    expect(checkEntities(root)).toEqual([])
    expect(checkEntities(await project({}))).toEqual([])
  })

  it('flags entries and fields the dev host would drop', async () => {
    const root = await project({
      'app/definitions/entities.json': { entities: [{ id: 'Booking', fields: [{ key: 'email' }] }, { typeId: 'Note', fields: [{ name: 'text' }] }] },
    })
    const issues = checkEntities(root)
    expect(codes(issues)).toEqual(['ENTITY_INVALID', 'ENTITY_INVALID'])
    expect(issues[0].message).toContain('entities[0] has no "typeId" (it has: id, fields)')
    expect(issues[1].message).toContain('entities[0].fields[0] has no "name" (it has: key)')
  })

  it('flags a file that is not JSON or not the entities shape', async () => {
    expect(codes(checkEntities(await project({ 'app/definitions/entities.json': '{ nope' })))).toEqual(['ENTITY_INVALID'])
    const shape = checkEntities(await project({ 'app/definitions/entities.json': [{ typeId: 'Booking' }] }))
    expect(codes(shape)).toEqual(['ENTITY_INVALID'])
    expect(shape[0].message).toContain('"entities"')
  })

  it('flags a page that binds an entity type nobody declares', async () => {
    const root = await project({
      'app/definitions/entities.json': { entities: [{ typeId: 'Booking', fields: [] }] },
      'app/surfaces/home.receipt.json': receipt('Booking'),
      'app/surfaces/register.receipt.json': receipt('AtolyeKaydi'),
    })
    expect(checkEntities(root)).toEqual([
      expect.objectContaining({ code: 'ENTITY_UNDECLARED', path: 'app/surfaces/register.receipt.json', message: expect.stringContaining('"AtolyeKaydi"') }),
    ])
    const none = await project({ 'app/surfaces/home.receipt.json': receipt('Booking') })
    expect(codes(checkEntities(none))).toEqual(['ENTITY_UNDECLARED'])
  })
})
