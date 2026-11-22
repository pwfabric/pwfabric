import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { checkAccess, checkEntities, checkMessages, checkReservedSources, checkSeeds, checkStatusKeys, checkTitleTemplate, reachableMessageIds } from '../../commands/lib/report.js'
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
/** The pwpack.json member that makes a folder an app. */
const APP = { app: {} }

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

describe('checkAccess', () => {
  const entities = { entities: [{ typeId: 'Product', fields: [] }, { typeId: 'Order', displayName: 'Customer order', fields: [] }] }

  it('passes an app without models, and one whose every model a rule names', async () => {
    expect(checkAccess(await project({}))).toEqual([])
    const root = await project({
      'app/definitions/entities.json': entities,
      'app/definitions/auth.json': {
        required: false,
        topology: 'app',
        methods: ['password'],
        access: {
          roles: [],
          rules: [
            { subject: 'public', model: 'product', rule: 'read' },
            { subject: 'member', model: 'Customer order', rule: 'create, read own' },
          ],
        },
      },
    })
    expect(checkAccess(root)).toEqual([])
  })

  it('is an error for every model no rule names, saying how to add one', async () => {
    const root = await project({
      'app/definitions/entities.json': entities,
      'app/definitions/auth.json': {
        required: false,
        topology: 'app',
        methods: ['password'],
        access: { roles: [], rules: [{ subject: 'member', model: 'Order', rule: 'read own' }] },
      },
    })
    const issues = checkAccess(root)
    expect(codes(issues)).toEqual(['ACCESS_RULE_MISSING'])
    expect(issues[0]).toMatchObject({ severity: 'error', path: 'app/definitions/auth.json' })
    expect(issues[0]!.message).toContain('"Product"')
    expect(issues[0]!.message).toContain('{ "subject": "public", "model": "Product", "rule": "read" }')
  })

  it('is an error for every model when there is no access block or no auth.json at all', async () => {
    const noAccess = await project({
      'app/definitions/entities.json': entities,
      'app/definitions/auth.json': { required: false, topology: 'app', methods: ['password'] },
    })
    expect(codes(checkAccess(noAccess))).toEqual(['ACCESS_RULE_MISSING', 'ACCESS_RULE_MISSING'])
    expect(checkAccess(noAccess)[0]!.message).toContain('has no access rules')
    const noAuth = await project({ 'app/definitions/entities.json': entities })
    expect(checkAccess(noAuth).map((i) => i.message.match(/model "(\w+)"/)?.[1])).toEqual(['Product', 'Order'])
  })
})

describe('MESSAGES_MISSING', () => {
  const plan = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ title: 'Manav', locale: 'tr-TR', ...extra })

  it('an app with no sign-in reaches only the runner’s not-found page, and none with its own', async () => {
    expect(reachableMessageIds(await project({ 'app/plan.json': plan() }))).toEqual(['notFound.title', 'notFound.body', 'notFound.home'])
    const own = await project({ 'app/plan.json': plan(), 'pwpack.json': { app: { notFound: 'missing' } } })
    expect(reachableMessageIds(own)).toEqual([])
    expect(checkMessages(own)).toEqual([])
  })

  it('a password app with an account slot reaches the gate, the door, the account control and the auth errors', async () => {
    const root = await project({
      'app/plan.json': plan(),
      'app/definitions/auth.json': { required: true, methods: ['password', 'google'] },
      'app/definitions/navigation.json': { account: { placement: 'navbar' } },
    })
    const ids = reachableMessageIds(root)
    for (const id of ['gate.email', 'gate.or', 'gate.provider.google', 'session.refused', 'account.greeting', 'auth.error.expired', 'auth.error.unknown']) {
      expect(ids).toContain(id)
    }
    // The plan has a title, the slot replaces the pill, no issuer, no profile link.
    for (const id of ['gate.title', 'pill.signIn', 'bridge.exchangeFailed', 'account.profile', 'gate.provider.github']) {
      expect(ids).not.toContain(id)
    }
  })

  it('the app’s own sign-in screen (app.signIn) takes the gate’s words and the pill with it', async () => {
    const root = await project({
      'app/plan.json': plan({ title: '' }),
      'pwpack.json': { app: { signIn: 'sign-in' } },
      'app/definitions/auth.json': { topology: 'external', methods: [], issuer: { issuer: 'https://login.example', clientId: 'c' } },
    })
    const ids = reachableMessageIds(root)
    expect(ids.some((id) => id.startsWith('gate.'))).toBe(false)
    // The screen is the app's own way in: the fallback pill is not drawn.
    expect(ids.some((id) => id.startsWith('pill.'))).toBe(false)
    expect(ids).toContain('bridge.invalidCallback')
    expect(ids).toContain('auth.error.access_denied')
  })

  it('E-4: the app’s own sign-in screen still reaches the password door’s session.* words', async () => {
    const root = await project({
      'app/plan.json': plan(),
      'pwpack.json': { app: { signIn: 'sign-in' } },
      'app/definitions/auth.json': { required: true, methods: ['password'] },
    })
    const ids = reachableMessageIds(root)
    expect(ids.filter((id) => id.startsWith('session.'))).toEqual(['session.unreachable', 'session.unexpected', 'session.failed', 'session.refused'])
    expect(ids.some((id) => id.startsWith('gate.'))).toBe(false)
  })

  it('sign-up words only for a door that takes anyone; the wall sentence only for a required app', async () => {
    const at = async (auth: Record<string, unknown>) =>
      reachableMessageIds(await project({ 'app/plan.json': plan(), 'app/definitions/auth.json': { topology: 'app', methods: ['password'], ...auth } }))
    const closed = await at({ required: true })
    expect(closed).toContain('gate.body')
    expect(closed).not.toContain('gate.register')
    expect(closed).not.toContain('gate.close')
    const open = await at({ required: false })
    expect(open).toContain('gate.register')
    expect(open).toContain('gate.close')
    expect(open).not.toContain('gate.body')
    // A password-only door is never sent back with `?auth_error=` (E18).
    expect(open.some((id) => id.startsWith('auth.error.'))).toBe(false)
  })

  it('SOURCE_ID_RESERVED: a source may not be called me or __anything', async () => {
    const receipt = (id: string) => ({ blocks: [], capabilities: [{ capability: 'platform/persistence', config: { dataSources: [{ id, kind: 'state' }] } }] })
    const root = await project({ 'app/surfaces/a.receipt.json': receipt('me'), 'app/surfaces/b.receipt.json': receipt('__auth'), 'app/surfaces/c.receipt.json': receipt('profile') })
    expect(checkReservedSources(root).map((i) => [i.code, i.path])).toEqual([
      ['SOURCE_ID_RESERVED', 'app/surfaces/a.receipt.json'],
      ['SOURCE_ID_RESERVED', 'app/surfaces/b.receipt.json'],
    ])
  })

  it('E-4: an app with a page reaches the renderer’s ui.retry (a block that failed to load), never ui.loading', async () => {
    const root = await project({ 'app/plan.json': plan(), 'pwpack.json': { app: { entry: 'home', surfaceOrder: ['home'], notFound: 'nf' } } })
    expect(reachableMessageIds(root)).toEqual(['ui.retry'])
    expect(checkMessages(root)[0]?.message).toContain('ui.retry')
  })

  it('an auth.json with access rules only is no way in: no sign-in words are reachable', async () => {
    const root = await project({
      'app/plan.json': plan(),
      'app/definitions/auth.json': { access: { rules: [{ subject: 'public', model: 'Dish', rule: 'read' }] } },
    })
    expect(reachableMessageIds(root)).toEqual(['notFound.title', 'notFound.body', 'notFound.home'])
  })

  it('E-4: is an error in every language — the engine writes no word — and quiet when every id is set', async () => {
    const files = { 'pwpack.json': APP, 'app/plan.json': plan() }
    const tr = checkMessages(await project(files))
    expect(tr.map((i) => [i.code, i.severity])).toEqual([['MESSAGES_MISSING', 'error']])
    expect(tr[0]?.message).toContain('notFound.title, notFound.body, notFound.home')
    const en = checkMessages(await project({ 'pwpack.json': APP, 'app/plan.json': plan({ locale: 'en-GB' }) }))
    expect(en.map((i) => i.severity)).toEqual(['error'])
    // An app with no plan has written no word at all.
    expect(checkMessages(await project({ 'pwpack.json': { app: {} } })).map((i) => i.severity)).toEqual(['error'])
    const done = checkMessages(
      await project({
        'pwpack.json': APP,
        'app/plan.json': plan({ messages: { 'notFound.title': 'Sayfa yok', 'notFound.body': 'Böyle bir sayfa yok.', 'notFound.home': 'Ana sayfa' } }),
      })
    )
    expect(done).toEqual([])
  })

  it('asks a pack (no app member) for no messages: it is not opened as an app', async () => {
    expect(checkMessages(await project({ 'pwpack.json': { id: '@pwpack/cards', version: '0.1.0' } }))).toEqual([])
    expect(checkMessages(await project({ 'pwpack.json': { id: '@pwpack/cards', version: '0.1.0' }, 'app/plan.json': plan() }))).toEqual([])
  })
})

describe('STATUS_KEY_UNKNOWN (E6)', () => {
  it('flags a statusKeys member the runtime never writes — 2.2’s message — on a form binding and a write action', async () => {
    const root = await project({
      'app/surfaces/a.receipt.json': {
        blocks: [{ id: 'b', type: 'button', props: { action: { type: 'write', sourceId: 's', op: 'delete', statusKeys: { error: 'failed', mesage: 'm' } } } }],
        capabilities: [
          {
            capability: 'platform/entities',
            config: { formBindings: [{ formId: 'f', sourceId: 's', statusKeys: { loading: 'l', success: 'ok', reason: 'why', fields: 'which', detail: 'd', message: 'msg' } }] },
          },
        ],
      },
    })
    const issues = checkStatusKeys(root)
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ['STATUS_KEY_UNKNOWN', 'warning'],
      ['STATUS_KEY_UNKNOWN', 'warning'],
    ])
    expect(issues[0]!.message).toContain('blocks[0].props.action.statusKeys.mesage')
    expect(issues[1]!.message).toContain('statusKeys.message')
    expect(issues[1]!.message).toContain('bind reason')
  })
})

describe('PLAN_TITLE_TEMPLATE_INVALID', () => {
  it('accepts exactly one %s with %% for a %, and no template at all', async () => {
    expect(checkTitleTemplate(await project({ 'app/plan.json': { titleTemplate: '%s · 100%% Acme' } }))).toEqual([])
    expect(checkTitleTemplate(await project({ 'app/plan.json': { title: 'Acme' } }))).toEqual([])
  })

  it('refuses any other', async () => {
    for (const bad of ['Acme', '%s %s', '%s at 5%', 7]) {
      expect(codes(checkTitleTemplate(await project({ 'app/plan.json': { titleTemplate: bad } }))), String(bad)).toEqual(['PLAN_TITLE_TEMPLATE_INVALID'])
    }
  })
})

describe('MESSAGES_INVALID — plurals (envelope §2.1)', () => {
  it('refuses a plural the runner cannot pick, and accepts a good one', async () => {
    const own = { 'pwpack.json': { app: { notFound: 'missing' } } }
    expect(checkMessages(await project({ ...own, 'app/plan.json': { messages: { 'cart.n': '{n, plural, one {# item} other {# items}}' } } }))).toEqual([])
    const bad = checkMessages(await project({ ...own, 'app/plan.json': { messages: { 'cart.n': '{n, plural, one {# item}}' } } }))
    expect(codes(bad)).toEqual(['MESSAGES_INVALID'])
    expect(bad[0]?.message).toContain('messages["cart.n"]')
  })
})

describe('the words of an app with locales (envelope §2.3)', () => {
  const app = { 'pwpack.json': { app: {} } }
  const plan = { title: 'Acme', locales: ['en', 'de'], defaultLocale: 'en' }

  it("reads the default locale's catalogue for the ids the app can reach", async () => {
    const root = await project({ ...app, 'app/plan.json': plan, 'app/messages/en.json': { 'notFound.title': 'x', 'notFound.body': 'y' } })
    const issues = checkMessages(root)
    expect(codes(issues)).toEqual(['MESSAGES_MISSING'])
    expect(issues[0]?.path).toBe('app/messages/en.json')
    expect(issues[0]?.message).toContain('notFound.home')
  })

  it("checks every catalogue's plurals", async () => {
    const root = await project({
      ...app,
      'pwpack.json': { app: { notFound: 'missing' } },
      'app/plan.json': plan,
      'app/messages/en.json': { n: '{n, plural, one {#} other {#}}' },
      'app/messages/de.json': { n: '{n, plural, one {#}}' },
    })
    const issues = checkMessages(root)
    expect(issues.map((i) => [i.code, i.path])).toEqual([['MESSAGES_INVALID', 'app/messages/de.json']])
  })
})
