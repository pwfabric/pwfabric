/**
 * Entity + DataSource + Collection + Expression Integration Tests
 *
 * GENUINE multi-module integration: every collaborator below is the
 * REAL production module wired together exactly as the runtime wires
 * them — no mocks, no stubs, no in-process fakes.
 *
 *   EntityRegistry  ── definitions
 *   ConnectorRegistry + StaticConnector ── storage
 *   DefaultEntityStore ── validation + CRUD
 *   EntityFacade ── subsystem aggregate
 * EntityDataSource ── DataSource adapter over the facade
 *   ReactiveCollection ── filter/sort/paginate over the fetched rows
 *   ExpressionEvaluator ── surface expressions over collection data
 *
 * The point of this file (vs. the per-module unit suites) is to prove
 * the *seams* between these modules hold: a row written through the
 * store is validated by the registry's Zod schema, surfaces through the
 * facade's `resolveBinding`, flows into a DataSource, is materialised
 * into a reactive collection, and is finally readable by the expression
 * evaluator — the full surface data-binding pipeline.
 *
 * @module @pwfabric/runtime/__tests__/integration/entity-binding
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'

// Entity subsystem — all real
import {
  createEntityFacade,
  createConnectorRegistry,
  createEntityRegistry,
  createStaticConnector,
  createEntityDataSource,
  type EntityFacade,
  type EntityDefinition,
  type EntityTypeId,
} from '../../entity/index.js'

// Binding subsystem — all real
import {
  createCollection,
  createExpressionEvaluator,
  evaluateExpression,
  type BindingExpressionContext,
} from '../../binding/index.js'

// ============================================================
// FIXTURES — a realistic "Employee" entity
// ============================================================

const EMPLOYEE_TYPE = 'employee' as EntityTypeId

const employeeSchema = z.object({
  name: z.string().min(1),
  department: z.string().min(1),
  salary: z.number().positive(),
  active: z.boolean(),
})

const employeeDefinition: EntityDefinition = {
  id: EMPLOYEE_TYPE,
  name: 'Employee',
  description: 'A company employee',
  fields: [
    { name: 'name', type: 'string', required: true },
    { name: 'department', type: 'string', required: true },
    { name: 'salary', type: 'number', required: true },
    { name: 'active', type: 'boolean', required: true },
  ],
  relations: [],
  primaryKey: 'id',
  timestamps: false,
  softDelete: false,
  schema: employeeSchema,
}

/**
 * Wire the REAL entity facade: registry + connector registry + static
 * connector + store, exactly as `createEntityFacade` composes them.
 */
function wireFacade(): EntityFacade {
  const registry = createEntityRegistry()
  const connectors = createConnectorRegistry()
  const connector = createStaticConnector('integration-static')
  connectors.register(connector)
  connectors.setDefault('integration-static')

  const facade = createEntityFacade({ registry, connectors })
  facade.registerEntity(employeeDefinition, 'integration-static')
  return facade
}

// ============================================================
// STORE → FACADE seam
// ============================================================

describe('integration: entity store ↔ facade', () => {
  let facade: EntityFacade

  beforeEach(() => {
    facade = wireFacade()
  })

  it('validates a written row against the registered Zod schema', async () => {
    const ok = await facade.store.create(EMPLOYEE_TYPE, {
      name: 'Alice',
      department: 'Engineering',
      salary: 120000,
      active: true,
    })
    expect(ok.success).toBe(true)

    // The registry's schema rejects an invalid row at the store boundary.
    const bad = await facade.store.create(EMPLOYEE_TYPE, {
      name: '',
      department: 'Engineering',
      salary: -1,
      active: true,
    })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.error.type).toBe('validation')
    }
  })

  it('surfaces written rows through facade.resolveBinding', async () => {
    await facade.store.create(EMPLOYEE_TYPE, {
      name: 'Bob',
      department: 'Sales',
      salary: 90000,
      active: true,
    })
    await facade.store.create(EMPLOYEE_TYPE, {
      name: 'Carol',
      department: 'Sales',
      salary: 95000,
      active: false,
    })

    const result = await facade.resolveBinding(EMPLOYEE_TYPE)
    expect(result.total).toBe(2)
    expect(result.items.map((i) => i.name).sort()).toEqual(['Bob', 'Carol'])
  })

  it('applies query filters/sort through the facade resolveBinding seam', async () => {
    for (const emp of [
      { name: 'Dave', department: 'Eng', salary: 130000, active: true },
      { name: 'Eve', department: 'Eng', salary: 110000, active: true },
      { name: 'Frank', department: 'Ops', salary: 80000, active: true },
    ]) {
      await facade.store.create(EMPLOYEE_TYPE, emp)
    }

    const engOnly = await facade.resolveBinding(EMPLOYEE_TYPE, {
      filter: { field: 'department', operator: 'eq', value: 'Eng' },
      sort: [{ field: 'salary', direction: 'desc' }],
    })

    expect(engOnly.items).toHaveLength(2)
    expect(engOnly.items[0]?.name).toBe('Dave') // highest salary first
    expect(engOnly.items[1]?.name).toBe('Eve')
  })
})

// ============================================================
// FACADE → DATASOURCE → COLLECTION seam
// ============================================================

describe('integration: entity datasource ↔ reactive collection', () => {
  let facade: EntityFacade

  beforeEach(async () => {
    facade = wireFacade()
    for (const emp of [
      { name: 'Grace', department: 'Eng', salary: 140000, active: true },
      { name: 'Heidi', department: 'Eng', salary: 105000, active: false },
      { name: 'Ivan', department: 'Sales', salary: 88000, active: true },
      { name: 'Judy', department: 'Sales', salary: 92000, active: true },
    ]) {
      await facade.store.create(EMPLOYEE_TYPE, emp)
    }
  })

  it('fetches rows through a real EntityDataSource adapter', async () => {
    const dataSource = createEntityDataSource(facade, {
      id: 'employees',
      entityType: EMPLOYEE_TYPE,
    })

    expect(dataSource.type).toBe('entity')
    const result = await dataSource.fetch()
    expect(result.total).toBe(4)
  })

  it('materialises datasource rows into a reactive collection and filters them', async () => {
    const dataSource = createEntityDataSource(facade, {
      id: 'employees',
      entityType: EMPLOYEE_TYPE,
    })
    const { items } = await dataSource.fetch()

    // Real ReactiveCollection over the real fetched rows.
    const collection = createCollection(items as Array<Record<string, unknown>>)
    expect(collection.items).toHaveLength(4)

    const activeOnly = collection.filter((row) => row.active === true)
    expect(activeOnly.items).toHaveLength(3)

    const byName = collection.sort((a, b) =>
      String(a.name).localeCompare(String(b.name))
    )
    expect(byName.items.map((r) => r.name)).toEqual(['Grace', 'Heidi', 'Ivan', 'Judy'])
  })

  it('reflects a row deleted via the store on the next datasource fetch', async () => {
    const dataSource = createEntityDataSource(facade, {
      id: 'employees',
      entityType: EMPLOYEE_TYPE,
    })

    const before = await dataSource.fetch()
    expect(before.total).toBe(4)

    const grace = before.items.find((i) => i.name === 'Grace')
    expect(grace).toBeDefined()
    const del = await facade.store.delete(EMPLOYEE_TYPE, String(grace?.id))
    expect(del.success).toBe(true)

    // The datasource is a live view over the store — refetch sees the change.
    const after = await dataSource.fetch()
    expect(after.total).toBe(3)
    expect(after.items.some((i) => i.name === 'Grace')).toBe(false)
  })
})

// ============================================================
// COLLECTION → EXPRESSION seam (full pipeline)
// ============================================================

describe('integration: entity data ↔ expression evaluator', () => {
  let facade: EntityFacade

  beforeEach(async () => {
    facade = wireFacade()
    for (const emp of [
      { name: 'Karl', department: 'Eng', salary: 150000, active: true },
      { name: 'Lara', department: 'Eng', salary: 130000, active: true },
      { name: 'Mike', department: 'Ops', salary: 70000, active: false },
    ]) {
      await facade.store.create(EMPLOYEE_TYPE, emp)
    }
  })

  it('evaluates surface expressions over real entity rows end-to-end', async () => {
    const dataSource = createEntityDataSource(facade, {
      id: 'employees',
      entityType: EMPLOYEE_TYPE,
    })
    const { items } = await dataSource.fetch()
    const collection = createCollection(items as Array<Record<string, unknown>>)

    // Expression context fed from the live collection.
    const context: BindingExpressionContext = {
      data: {},
      params: {},
      state: {
        employees: collection.items,
        headcount: collection.length,
      },
    }

    // Path expression resolves a value out of the collection-backed state.
    const count = evaluateExpression('state.headcount', context)
    expect(count.success).toBe(true)
    expect(count.success && count.value).toBe(3)

    // An arithmetic expression over the collection-derived count.
    const doubled = evaluateExpression('state.headcount * 2', context)
    expect(doubled.success).toBe(true)
    expect(doubled.success && doubled.value).toBe(6)
  })

  it('re-evaluates an expression after the underlying entity data changes', async () => {
    const dataSource = createEntityDataSource(facade, {
      id: 'employees',
      entityType: EMPLOYEE_TYPE,
    })
    const evaluator = createExpressionEvaluator()

    // First snapshot — 3 employees.
    let snapshot = await dataSource.fetch()
    let ctx: BindingExpressionContext = {
      data: {},
      params: {},
      state: {
        total: createCollection(snapshot.items as Array<Record<string, unknown>>).length,
      },
    }
    // `ExpressionEvaluator.evaluate` returns the value directly (throws on error).
    const before = evaluator.evaluate('state.total', ctx)
    expect(before).toBe(3)

    // Mutate the store, then re-run the same pipeline.
    await facade.store.create(EMPLOYEE_TYPE, {
      name: 'Nina',
      department: 'Ops',
      salary: 75000,
      active: true,
    })
    snapshot = await dataSource.fetch()
    ctx = {
      data: {},
      params: {},
      state: {
        total: createCollection(snapshot.items as Array<Record<string, unknown>>).length,
      },
    }
    const after = evaluator.evaluate('state.total', ctx)
    expect(after).toBe(4)
  })
})
