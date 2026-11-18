/**
 * What the record host enforces beyond one record's own fields: a relation
 * points at a record the caller can read, and an entity's unique keys hold.
 * A member attached a courier note to another account's order (201), and a
 * second RSVP for the same session was stored (201).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HostError, readEntities, RecordStore, type AuthDeclaration, type EntityDeclaration } from '../../host/index.js'

function app(): string {
  const root = mkdtempSync(join(tmpdir(), 'pwf-integrity-'))
  mkdirSync(join(root, 'app', 'definitions'), { recursive: true })
  writeFileSync(
    join(root, 'app', 'definitions', 'entities.json'),
    JSON.stringify({
      entities: [
        { typeId: 'Order', fields: [{ name: 'item', type: 'text' }, { name: 'buyer', type: 'text', server: 'owner' }] },
        {
          typeId: 'CourierNote',
          fields: [
            { name: 'order', type: 'relation', targetTypeId: 'Order', required: true },
            { name: 'text', type: 'text' },
          ],
        },
        {
          typeId: 'Rsvp',
          unique: [['who', 'sessionId']],
          fields: [{ name: 'sessionId', type: 'text' }, { name: 'who', type: 'text', server: 'owner' }],
        },
      ],
    })
  )
  return root
}

const auth = {
  required: false,
  access: {
    roles: [],
    rules: [
      { subject: 'member', model: 'Order', rule: 'create, read own' },
      { subject: 'member', model: 'CourierNote', rule: 'create' },
      { subject: 'member', model: 'Rsvp', rule: 'create, read own, update own' },
    ],
  },
} as unknown as AuthDeclaration
const ada = { principal: { id: 'ada', email: 'ada@example.com', displayName: 'Ada' } }
const bob = { principal: { id: 'bob', email: 'bob@example.com', displayName: 'Bob' } }

function setup() {
  const root = app()
  const entities = readEntities(root)
  const entity = (id: string): EntityDeclaration => entities.find((e) => e.typeId === id)!
  const store = new RecordStore(root, { id: 'dev-user', email: 'dev@localhost', displayName: 'Developer' })
  return { store, entity }
}

const refusal = (fn: () => unknown): { status: number; code: string; message: string } => {
  try {
    fn()
  } catch (err) {
    if (err instanceof HostError) return { status: err.status, code: err.code, message: err.message }
    throw err
  }
  throw new Error('not refused')
}

describe('relation integrity', () => {
  it("a relation to another account's record is refused; to one's own, accepted", () => {
    const { store, entity } = setup()
    const bobsOrder = store.create({ entity: entity('Order'), auth, caller: bob }, { item: 'Lamp' })
    const adasOrder = store.create({ entity: entity('Order'), auth, caller: ada }, { item: 'Desk' })
    const note = (order: string) => store.create({ entity: entity('CourierNote'), auth, caller: ada }, { order, text: 'Back to the depot' })
    expect(refusal(() => note(String(bobsOrder.id)))).toMatchObject({ status: 400, message: 'order: does not name a readable Order record' })
    expect(refusal(() => note('no-such-order'))).toMatchObject({ status: 400 })
    expect(note(String(adasOrder.id))).toMatchObject({ order: adasOrder.id })
  })
})

describe('unique keys', () => {
  it('a second record with the same key is a 409; another session or another person is not', () => {
    const { store, entity } = setup()
    const rsvp = (caller: typeof ada, sessionId: string) => store.create({ entity: entity('Rsvp'), auth, caller }, { sessionId })
    rsvp(ada, 's1')
    expect(refusal(() => rsvp(ada, 's1'))).toMatchObject({ status: 409, code: 'CONFLICT' })
    expect(rsvp(ada, 's2')).toMatchObject({ sessionId: 's2' })
    expect(rsvp(bob, 's1')).toMatchObject({ sessionId: 's1' })
  })

  it('an update cannot make a duplicate either', () => {
    const { store, entity } = setup()
    const target = { entity: entity('Rsvp'), auth, caller: ada }
    store.create(target, { sessionId: 's1' })
    const second = store.create(target, { sessionId: 's2' })
    expect(refusal(() => store.update(target, String(second.id), { sessionId: 's1' }))).toMatchObject({ status: 409 })
  })
})
