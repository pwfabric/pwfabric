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
    const r = create({ items: 'A40', qty: 2, gift: true, deliverOn: '2026-11-19', product: '7', finish: 'sand' })
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

  it('is strict: a numeral, "on" or a number id is not its type (the writer converts before it sends)', () => {
    const r = create({ items: 'A40', qty: '10', gift: 'on', product: 7 })
    expect(r).toMatchObject({ ok: false, fieldNames: ['qty', 'gift', 'product'] })
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

  it('an email field holds an address', () => {
    const fields = [{ name: 'email', type: 'email', required: true }]
    expect(prepareRecordWrite({ fields, body: { email: 'notanemail' }, op: 'create', now: NOW })).toMatchObject({
      ok: false,
      message: 'email: must be an e-mail address',
    })
    expect(prepareRecordWrite({ fields, body: { email: ' ada@example.com ' }, op: 'create', now: NOW })).toEqual({
      ok: true,
      fields: { email: 'ada@example.com' },
    })
  })

  it('a consent field declared mustBe: true refuses false', () => {
    const fields = [{ name: 'consent', type: 'boolean', required: true, mustBe: true }]
    expect(prepareRecordWrite({ fields, body: { consent: false }, op: 'create', now: NOW })).toMatchObject({
      ok: false,
      message: 'consent: must be true',
    })
    expect(prepareRecordWrite({ fields, body: { consent: true }, op: 'create', now: NOW }).ok).toBe(true)
  })

  it('a number keeps to its min, max and integer', () => {
    const fields = [{ name: 'quantity', type: 'number', min: 1, max: 10, integer: true }]
    const w = (quantity: number) => prepareRecordWrite({ fields, body: { quantity }, op: 'create', now: NOW })
    expect(w(-5)).toMatchObject({ ok: false, message: 'quantity: must be at least 1' })
    expect(w(11)).toMatchObject({ ok: false, message: 'quantity: must be at most 10' })
    expect(w(1.5)).toMatchObject({ ok: false, message: 'quantity: must be a whole number' })
    expect(w(3).ok).toBe(true)
  })

  it('a relation must name a record the caller can read, when the server says which', () => {
    const fields = [{ name: 'order', type: 'relation', targetTypeId: 'Order' }]
    const readable = (t: string, id: string) => t === 'Order' && id === 'mine'
    const w = (order: string) => prepareRecordWrite({ fields, body: { order }, op: 'create', now: NOW, relationReadable: readable })
    expect(w('theirs')).toMatchObject({ ok: false, message: 'order: does not name a readable Order record' })
    expect(w('mine').ok).toBe(true)
  })
})
