/**
 * The record's field names ride on each own-records source (data-protocol
 * §4.1), so a form writing it sends those only — a one-time code a booking
 * form collects stayed in the body and the host refused the write with a 400.
 */
import { describe, expect, it } from 'vitest'
import { declaredRecordFields, withRecordFields } from '../../host/index.js'

const entities = {
  entities: [
    {
      typeId: 'Booking',
      fields: [
        { name: 'name', type: 'text' },
        { name: 'day', type: 'date' },
        { name: 'owner', type: 'text', server: 'owner' },
        { name: 'status', type: 'enum', values: ['new'], server: { default: 'new' } },
      ],
    },
    { typeId: 'Empty', fields: [] },
  ],
}
const receipt = (dataSources: unknown[]) => ({ blocks: [], capabilities: [{ capability: 'platform/persistence', config: { dataSources } }] })
const sourcesOf = (r: Record<string, unknown>) =>
  ((r.capabilities as { config: { dataSources: unknown[] } }[])[0] as { config: { dataSources: unknown[] } }).config.dataSources

describe('withRecordFields', () => {
  const declared = declaredRecordFields(entities)

  it('reads each type writable fields as name → type (role server fields are the server own)', () => {
    expect([...declared]).toEqual([['Booking', { name: 'text', day: 'date', status: 'enum' }]])
  })

  it('writes them on an own-records entity source', () => {
    const out = withRecordFields(receipt([{ id: 'b', kind: 'entity', entityType: 'Booking' }]), declared)
    expect(sourcesOf(out)).toEqual([{ id: 'b', kind: 'entity', entityType: 'Booking', fields: { name: 'text', day: 'date', status: 'enum' } }])
  })

  it('leaves a connector source, an undeclared type and a source stating its own fields alone', () => {
    const r = receipt([
      { id: 'c', kind: 'entity', entityType: 'Booking', connector: 'crm' },
      { id: 'u', kind: 'entity', entityType: 'Unknown' },
      { id: 'e', kind: 'entity', entityType: 'Empty' },
      { id: 'o', kind: 'entity', entityType: 'Booking', fields: { name: 'text' } },
    ])
    expect(withRecordFields(r, declared)).toBe(r)
  })
})
