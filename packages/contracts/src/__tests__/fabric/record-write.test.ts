/**
 * D2 — the record write contract (server-owned fields, declared types,
 * undeclared fields refused).
 */
import { describe, it, expect } from 'vitest'
import { prepareRecordWrite, type RecordFieldDeclaration } from '../../fabric/record-write.js'

const NOW = '2026-11-17T10:00:00.000Z'
const ORDER: RecordFieldDeclaration[] = [
  { name: 'items', type: 'text', required: true },
  { name: 'qty', type: 'number', required: true },
  { name: 'gift', type: 'boolean' },
  { name: 'deliverOn', type: 'date' },
  { name: 'product', type: 'relation' },
  { name: 'finish', type: 'enum', values: ['graphite', 'sand'] },
  { name: 'owner', type: 'text', server: 'owner' },
  { name: 'placed', type: 'date', server: 'createdAt' },
  { name: 'changed', type: 'date', server: 'updatedAt' },
  { name: 'status', type: 'text', server: { default: 'placed' } },
]

const create = (body: Record<string, unknown>, callerId: string | null = 'u1') =>
  prepareRecordWrite({ fields: ORDER, body, op: 'create', ...(callerId ? { callerId } : {}), now: NOW })
const update = (body: Record<string, unknown>) =>
  prepareRecordWrite({ fields: ORDER, body, op: 'update', callerId: 'u1', now: NOW })

describe('prepareRecordWrite', () => {
  it('sets the server-owned fields on create and reads every value as its type', () => {
    const r = create({ items: 'A40', qty: '2', gift: 'on', deliverOn: '2026-11-19', product: 7, finish: 'sand' })
    expect(r).toEqual({
      ok: true,
      fields: {
        items: 'A40',
        qty: 2,
        gift: true,
        deliverOn: '2026-11-19',
        product: '7',
        finish: 'sand',
        owner: 'u1',
        placed: NOW,
        changed: NOW,
        status: 'placed',
      },
    })
  })

  it('ownerName is the writer’s name at the time of the write, set on create only', () => {
    const fields = [{ name: 'by', type: 'text', server: 'ownerName' as const }, { name: 'text', type: 'text' }]
    const made = prepareRecordWrite({ fields, body: { text: 'hi' }, op: 'create', callerId: 'u1', callerName: 'Ada', now: NOW })
    expect(made).toMatchObject({ ok: true, fields: { by: 'Ada', text: 'hi' } })
    const forged = prepareRecordWrite({ fields, body: { by: 'Eve' }, op: 'update', callerId: 'u1', callerName: 'Ada', now: NOW })
    expect(forged.ok).toBe(false)
    const changed = prepareRecordWrite({ fields, body: { text: 'x' }, op: 'update', callerId: 'u1', callerName: 'Ada', now: NOW })
    expect(changed).toMatchObject({ ok: true, fields: { text: 'x' } })
    expect((changed as { fields: Record<string, unknown> }).fields.by).toBeUndefined()
  })

  it('refuses a client value for a server-owned field', () => {
    const r = create({ items: 'A40', qty: 1, owner: 'someone-else', status: 'shipped', placed: '2020-01-01' })
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION_FAILED', fieldNames: ['owner', 'status', 'placed'] })
    expect(r.ok === false && r.message).toBe(
      'owner: is set by the server; status: is set by the server; placed: is set by the server'
    )
  })

  it('refuses a field the entity does not declare, and drops the envelope', () => {
    const r = create({ items: 'A40', qty: 1, total: 698, id: 'forged', createdAt: 'x' })
    expect(r).toMatchObject({ ok: false, fieldNames: ['total'] })
  })

  it('refuses a value that is not its type', () => {
    const r = create({ items: 3, qty: 'two', gift: 'yes', deliverOn: '19/11/2026', finish: 'red' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.fieldNames).toEqual(['items', 'qty', 'gift', 'deliverOn', 'finish'])
    expect(r.message).toContain('finish: must be one of "graphite", "sand"')
  })

  it('a required field must have a value on create; blank is none', () => {
    const r = create({ items: '', qty: ' ' })
    expect(r).toMatchObject({ ok: false, fieldNames: ['items', 'qty'] })
    expect(r.ok === false && r.message).toBe('items: is required; qty: is required')
  })

  it('an update: the change only, updatedAt moved, owner and createdAt untouchable, a default field changeable', () => {
    expect(update({ status: 'shipped', gift: '' })).toEqual({
      ok: true,
      fields: { status: 'shipped', gift: null, changed: NOW },
    })
    expect(update({ owner: 'u2' })).toMatchObject({ ok: false, fieldNames: ['owner'] })
    expect(update({ changed: NOW })).toMatchObject({ ok: false, fieldNames: ['changed'] })
    expect(update({ qty: '' })).toMatchObject({ ok: false, fieldNames: ['qty'] })
  })

  it('a visitor who has not signed in owns nothing: the owner stays empty', () => {
    const r = create({ items: 'A40', qty: 1 }, null)
    expect(r.ok).toBe(true)
    expect(r.ok && r.fields['owner']).toBeUndefined()
  })

  it('accepts a lone { data } wrapper', () => {
    expect(create({ data: { items: 'A40', qty: 1 } }).ok).toBe(true)
  })

  it('carries a field of an unknown type unchecked', () => {
    const r = prepareRecordWrite({ fields: [{ name: 'shape', type: 'geo' }], body: { shape: { x: 1 } }, op: 'create', now: NOW })
    expect(r).toEqual({ ok: true, fields: { shape: { x: 1 } } })
  })
})
