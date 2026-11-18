/**
 * Own-records sources a visitor who is not signed in cannot read carry
 * `requiresSession` (data-protocol §2.6), decided from the declared access
 * rules exactly as the record host decides them: conference-companion's
 * `Rsvp` (`member` `read own`) and headphone-shop's `CartLine` were asked for
 * every signed-out visitor and answered 401.
 */
import { describe, expect, it } from 'vitest'
import { authDeclarationOf, entityDeclarationsOf } from '../../host/definitions.js'
import { withSessionSources } from '../../host/index.js'

const entities = entityDeclarationsOf({
  entities: ['Session', 'Speaker', 'Ticket', 'Rsvp', 'Note', 'Hidden'].map((typeId) => ({ typeId, fields: [{ name: 'x', type: 'text' }] })),
})
// conference-companion's rules, plus a model a stranger may only count.
const auth = authDeclarationOf({
  required: false,
  topology: 'app',
  methods: ['password'],
  access: {
    rules: [
      { subject: 'public', model: 'Session', rule: 'read' },
      { subject: 'public', model: 'Speaker', rule: 'read' },
      { subject: 'member', model: 'Ticket', rule: 'read own' },
      { subject: 'member', model: 'Rsvp', rule: 'create, read own, update own' },
      { subject: 'public', model: 'Note', rule: 'count' },
      { subject: 'member', model: 'Note', rule: 'read own' },
    ],
  },
})

const receipt = (dataSources: unknown[]) => ({ blocks: [], capabilities: [{ capability: 'platform/persistence', config: { dataSources } }] })
const marked = (r: Record<string, unknown>): Record<string, boolean> => {
  const sources = (r.capabilities as { config: { dataSources: { id: string; requiresSession?: boolean }[] } }[])[0]!.config.dataSources
  return Object.fromEntries(sources.map((s) => [s.id, s.requiresSession === true]))
}

describe('withSessionSources', () => {
  it('marks the sources a signed-out visitor cannot list; leaves the public ones', () => {
    const out = withSessionSources(
      receipt([
        { id: 'sessions', kind: 'entity', entityType: 'Session' },
        { id: 'speakers', kind: 'entity', entityType: 'Speaker' },
        { id: 'ticket', kind: 'entity', entityType: 'Ticket' },
        { id: 'mine', kind: 'entity', entityType: 'Rsvp', query: { filter: { field: 'sessionId', operator: 'eq', value: '{{state.id}}' } } },
        // No rule names it: closed once the app declares any rule.
        { id: 'hidden', kind: 'entity', entityType: 'Hidden' },
      ]),
      entities,
      auth
    )
    expect(marked(out)).toEqual({ sessions: false, speakers: false, ticket: true, mine: true, hidden: true })
  })

  it('a plain count is readable with a count grant alone; a filtered one or a list is not', () => {
    const out = withSessionSources(
      receipt([
        { id: 'n', kind: 'entity', entityType: 'Note', aggregate: { fn: 'count' } },
        { id: 'f', kind: 'entity', entityType: 'Note', aggregate: { fn: 'count', filter: { field: 'x', operator: 'eq', value: 'a' } } },
        { id: 'l', kind: 'entity', entityType: 'Note' },
      ]),
      entities,
      auth
    )
    expect(marked(out)).toEqual({ n: false, f: true, l: true })
  })

  it('an app that requires sign-in: every own-records source', () => {
    const required = authDeclarationOf({ required: true, methods: ['password'], access: { rules: [{ subject: 'public', model: 'Session', rule: 'read' }] } })
    expect(marked(withSessionSources(receipt([{ id: 's', kind: 'entity', entityType: 'Session' }]), entities, required))).toEqual({ s: true })
  })

  it('an app with no access rule is open: nothing is marked, and the receipt is the same object', () => {
    const r = receipt([{ id: 'r', kind: 'entity', entityType: 'Rsvp' }])
    expect(withSessionSources(r, entities, authDeclarationOf({ methods: ['password'] }))).toBe(r)
    expect(withSessionSources(r, entities, undefined)).toBe(r)
  })

  it('leaves a connector source, an undeclared type, a rest source and a source stating its own value alone', () => {
    const r = receipt([
      { id: 'c', kind: 'entity', entityType: 'Rsvp', connector: 'graph' },
      { id: 'u', kind: 'entity', entityType: 'Unknown' },
      { id: 'w', kind: 'rest', endpoint: '/x' },
      { id: 'o', kind: 'entity', entityType: 'Rsvp', requiresSession: false },
    ])
    expect(withSessionSources(r, entities, auth)).toBe(r)
  })
})
