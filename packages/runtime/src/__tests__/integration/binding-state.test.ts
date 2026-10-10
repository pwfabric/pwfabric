/**
 * Data Binding + State Integration Tests
 *
 * Integration tests verifying data binding and state modules work together
 *
 * Test scenarios:
 * - StateDataSource connects to state store
 * - State changes -> binding updates
 * - Expression evaluates state values
 * - Collection binding with state-backed data
 *
 * @module @pwfabric/runtime/__tests__/integration/binding-state
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { StateStore } from '../../state/index.js'
import { createStateStore } from '../../state/index.js'
import type { BindingExpressionContext } from '../../binding/index.js'
import {
  createStateDataSource,
  createCollection,
  createExpressionEvaluator,
  evaluateExpression,
  interpolateBinding,
  extractDependencies,
} from '../../binding/index.js'

// ============================================================
// TEST FIXTURES
// ============================================================

interface Employee {
  id: string
  name: string
  department: string
  salary: number
  active: boolean
}

// ============================================================
// TEST SUITE
// ============================================================

describe('Data Binding + State Integration', () => {
  let stateStore: StateStore<unknown>

  beforeEach(() => {
    stateStore = createStateStore<unknown>()
  })

  describe('StateDataSource Integration', () => {
    it('should connect StateDataSource to state store', async () => {
      // Arrange
      const employees: Employee[] = [
        { id: '1', name: 'John Doe', department: 'Engineering', salary: 100000, active: true },
        { id: '2', name: 'Jane Smith', department: 'Marketing', salary: 90000, active: true },
      ]
      stateStore.set('employees', employees)

      // Act
      const dataSource = createStateDataSource<Employee[]>(
        'employee-source',
        'employees',
        stateStore
      )

      // Assert
      const data = await dataSource.fetch()
      expect(data).toEqual(employees)
      expect(dataSource.type).toBe('state')
      expect(dataSource.id).toBe('employee-source')
    })

    it('should update bindings when state changes', async () => {
      // Arrange
      stateStore.set('counter', 0)

      const dataSource = createStateDataSource<number>('counter-source', 'counter', stateStore)

      const receivedValues: number[] = []
      if (dataSource.subscribe) {
        dataSource.subscribe((value) => {
          receivedValues.push(value)
        })
      }

      // Act
      stateStore.set('counter', 1)
      stateStore.set('counter', 2)
      stateStore.set('counter', 3)

      // Assert
      // First value (0) is received immediately on subscribe
      // Then we receive 1, 2, 3 from state changes
      expect(receivedValues).toEqual([0, 1, 2, 3])
    })

    it('should transform state data through data source', async () => {
      // Arrange
      stateStore.set('rawPrice', 99.99)

      const dataSource = createStateDataSource<string>('price-display', 'rawPrice', stateStore, {
        transform: (value) => `$${(value as number).toFixed(2)}`,
      })

      // Act
      const result = await dataSource.fetch()

      // Assert
      expect(result).toBe('$99.99')
    })

    it('should propagate transformations to subscribers', async () => {
      // Arrange
      stateStore.set('items', ['apple', 'banana'])

      const dataSource = createStateDataSource<number>('item-count', 'items', stateStore, {
        transform: (items) => (items as string[]).length,
      })

      const counts: number[] = []
      if (dataSource.subscribe) {
        dataSource.subscribe((count) => {
          counts.push(count)
        })
      }

      // Act
      stateStore.set('items', ['apple', 'banana', 'cherry'])
      stateStore.set('items', ['apple'])

      // Assert
      expect(counts).toEqual([2, 3, 1])
    })
  })

  describe('Expression Evaluation with State', () => {
    it('should evaluate expressions using state values', () => {
      // Arrange
      const context: BindingExpressionContext = {
        data: {},
        state: {
          count: 5,
          multiplier: 10,
          name: 'Test',
        },
        params: {},
      }

      // Act & Assert
      const result1 = evaluateExpression('state.count * state.multiplier', context)
      expect(result1.success).toBe(true)
      expect(result1.success && result1.value).toBe(50)

      const result2 = evaluateExpression('state.name', context)
      expect(result2.success).toBe(true)
      expect(result2.success && result2.value).toBe('Test')
    })

    it('should support ternary expressions with state', () => {
      // Arrange
      const context: BindingExpressionContext = {
        data: {},
        state: { isAdmin: true, role: 'admin' },
        params: {},
      }

      // Act
      const result = evaluateExpression("state.isAdmin ? 'Welcome Admin' : 'Welcome User'", context)

      // Assert
      expect(result.success).toBe(true)
      expect(result.success && result.value).toBe('Welcome Admin')
    })

    it('should handle null coalescing with state', () => {
      // Arrange
      const context: BindingExpressionContext = {
        data: {},
        state: { definedValue: 'exists', undefinedValue: undefined },
        params: {},
      }

      // Act
      const result1 = evaluateExpression("state.undefinedValue ?? 'default'", context)
      const result2 = evaluateExpression("state.definedValue ?? 'default'", context)

      // Assert
      expect(result1.success && result1.value).toBe('default')
      expect(result2.success && result2.value).toBe('exists')
    })

    it('should interpolate templates with state values', () => {
      // Arrange
      const context: BindingExpressionContext = {
        data: {},
        state: { userName: 'Alice', itemCount: 5 },
        params: {},
      }

      // Act
      const result = interpolateBinding(
        'Hello {{state.userName}}! You have {{state.itemCount}} items.',
        context
      )

      // Assert
      expect(result).toBe('Hello Alice! You have 5 items.')
    })

    it('should extract state dependencies from expressions', () => {
      // Arrange
      const expression = 'state.user.name + " - " + state.user.department'

      // Act
      const dependencies = extractDependencies(expression)

      // Assert
      expect(dependencies).toHaveLength(2)
      expect(dependencies).toContainEqual({ source: 'state', path: 'user.name' })
      expect(dependencies).toContainEqual({ source: 'state', path: 'user.department' })
    })
  })

  describe('Collection Binding with State', () => {
    it('should create collection from state-backed data source', async () => {
      // Arrange
      const employees: Employee[] = [
        { id: '1', name: 'Alice', department: 'Engineering', salary: 120000, active: true },
        { id: '2', name: 'Bob', department: 'Marketing', salary: 80000, active: true },
        { id: '3', name: 'Charlie', department: 'Engineering', salary: 90000, active: false },
      ]
      stateStore.set('employees', employees)

      const dataSource = createStateDataSource<Employee[]>('employees', 'employees', stateStore)

      // Act
      const data = await dataSource.fetch()
      const collection = createCollection<Employee>(data, 'id')

      // Assert
      expect(collection.length).toBe(3)
      expect(collection.getByKey('2')?.name).toBe('Bob')
    })

    it('should filter collection based on state criteria', async () => {
      // Arrange
      const employees: Employee[] = [
        { id: '1', name: 'Alice', department: 'Engineering', salary: 120000, active: true },
        { id: '2', name: 'Bob', department: 'Marketing', salary: 80000, active: true },
        { id: '3', name: 'Charlie', department: 'Engineering', salary: 90000, active: false },
      ]
      stateStore.set('employees', employees)
      stateStore.set('filterDepartment', 'Engineering')

      const dataSource = createStateDataSource<Employee[]>('employees', 'employees', stateStore)

      // Act
      const data = await dataSource.fetch()
      const collection = createCollection<Employee>(data, 'id')
      const filterDept = stateStore.get('filterDepartment') as string
      const filtered = collection.filter((e) => e.department === filterDept)

      // Assert
      expect(filtered.length).toBe(2)
      expect(filtered.items.every((e) => e.department === 'Engineering')).toBe(true)
    })

    it('should sort collection based on state criteria', async () => {
      // Arrange
      const employees: Employee[] = [
        { id: '1', name: 'Alice', department: 'Engineering', salary: 120000, active: true },
        { id: '2', name: 'Bob', department: 'Marketing', salary: 80000, active: true },
        { id: '3', name: 'Charlie', department: 'Engineering', salary: 90000, active: false },
      ]
      stateStore.set('employees', employees)
      stateStore.set('sortDirection', 'desc')

      const dataSource = createStateDataSource<Employee[]>('employees', 'employees', stateStore)

      // Act
      const data = await dataSource.fetch()
      const collection = createCollection<Employee>(data, 'id')
      const sortDir = stateStore.get('sortDirection') as 'asc' | 'desc'
      const sorted = collection.sort((a, b) => {
        const diff = a.salary - b.salary
        return sortDir === 'asc' ? diff : -diff
      })

      // Assert
      const firstItem = sorted.items[0]
      const lastItem = sorted.items[2]
      expect(firstItem?.name).toBe('Alice') // Highest salary first
      expect(lastItem?.name).toBe('Bob') // Lowest salary last
    })

    it('should update collection when state source updates', async () => {
      // Arrange
      const initialEmployees: Employee[] = [
        { id: '1', name: 'Alice', department: 'Engineering', salary: 120000, active: true },
      ]
      stateStore.set('employees', initialEmployees)

      const dataSource = createStateDataSource<Employee[]>('employees', 'employees', stateStore)

      const collection = createCollection<Employee>([], 'id')
      const updates: Employee[][] = []

      // Subscribe to data source changes and update collection
      if (dataSource.subscribe) {
        dataSource.subscribe((data) => {
          updates.push([...data])
          collection.reset(data)
        })
      }

      // Act
      const newEmployees: Employee[] = [
        { id: '1', name: 'Alice', department: 'Engineering', salary: 120000, active: true },
        { id: '2', name: 'Bob', department: 'Marketing', salary: 80000, active: true },
      ]
      stateStore.set('employees', newEmployees)

      // Assert
      expect(updates).toHaveLength(2) // Initial + update
      expect(collection.length).toBe(2)
      expect(collection.getByKey('2')?.name).toBe('Bob')
    })
  })

  describe('Reactive Expression Evaluator', () => {
    it('should evaluate complex expressions with state and data', () => {
      // Arrange
      const evaluator = createExpressionEvaluator()
      const context: BindingExpressionContext = {
        data: { basePrice: 100 },
        state: { discount: 0.2, taxRate: 0.08 },
        params: {},
      }

      // Act
      const discountedPrice = evaluator.evaluate('data.basePrice * (1 - state.discount)', context)
      const finalPrice = evaluator.evaluate(
        'data.basePrice * (1 - state.discount) * (1 + state.taxRate)',
        context
      )

      // Assert
      expect(discountedPrice).toBe(80)
      expect(finalPrice).toBeCloseTo(86.4, 2)
    })

    it('should support helper functions in expressions', () => {
      // Arrange
      const evaluator = createExpressionEvaluator()
      const context: BindingExpressionContext = {
        data: {},
        state: {
          names: ['alice', 'bob', 'charlie'],
          amount: 1234.567,
        },
        params: {},
      }

      // Act
      const joined = evaluator.evaluate("join(state.names, ', ')", context)
      const rounded = evaluator.evaluate('round(state.amount, 2)', context)
      const upperFirst = evaluator.evaluate('upper(first(state.names))', context)

      // Assert
      expect(joined).toBe('alice, bob, charlie')
      expect(rounded).toBe(1234.57)
      expect(upperFirst).toBe('ALICE')
    })

    it('should interpolate complex templates', () => {
      // Arrange
      const evaluator = createExpressionEvaluator()
      const context: BindingExpressionContext = {
        data: {},
        state: {
          items: [1, 2, 3],
          total: 150.5,
        },
        params: { orderId: 'ORD-123' },
      }

      // Act - evaluator uses 'interpolate' method, not 'interpolateBinding'
      const result = evaluator.interpolate(
        'Order {{params.orderId}}: {{length(state.items)}} items, Total: {{currency(state.total)}}',
        context
      )

      // Assert
      expect(result).toContain('Order ORD-123')
      expect(result).toContain('3 items')
      expect(result).toContain('$150.50')
    })
  })

  describe('Combined State and Binding Workflows', () => {
    it('should implement search filtering via state and collection', async () => {
      // Arrange - Setup employees in state
      const employees: Employee[] = [
        {
          id: '1',
          name: 'Alice Anderson',
          department: 'Engineering',
          salary: 100000,
          active: true,
        },
        { id: '2', name: 'Bob Brown', department: 'Marketing', salary: 90000, active: true },
        { id: '3', name: 'Alice Baker', department: 'Sales', salary: 85000, active: true },
      ]
      stateStore.set('employees', employees)
      stateStore.set('searchTerm', '')

      const dataSource = createStateDataSource<Employee[]>('employees', 'employees', stateStore)

      // Act - Create filtered collection
      const data = await dataSource.fetch()
      const collection = createCollection<Employee>(data, 'id')

      // Filter by search term
      stateStore.set('searchTerm', 'Alice')
      const searchTerm = (stateStore.get('searchTerm') as string).toLowerCase()
      const filtered = collection.filter((e) => e.name.toLowerCase().includes(searchTerm))

      // Assert
      expect(filtered.length).toBe(2)
      const firstFiltered = filtered.items[0]
      const secondFiltered = filtered.items[1]
      expect(firstFiltered?.name).toBe('Alice Anderson')
      expect(secondFiltered?.name).toBe('Alice Baker')
    })

    it('should implement derived state via expression evaluation', () => {
      // Arrange
      stateStore.set('cartItems', [
        { productId: 'p1', quantity: 2, unitPrice: 25.0 },
        { productId: 'p2', quantity: 1, unitPrice: 50.0 },
        { productId: 'p3', quantity: 3, unitPrice: 10.0 },
      ])

      // Custom expression to calculate total (simulating derived state)
      interface CartItem {
        productId: string
        quantity: number
        unitPrice: number
      }
      const cartItems = stateStore.get('cartItems') as CartItem[]
      const total = cartItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)

      // Store derived state
      stateStore.set('cartTotal', total)

      // Use the expression evaluator which includes the currency helper
      const evaluator = createExpressionEvaluator()
      const context: BindingExpressionContext = {
        data: {},
        state: { cartTotal: total },
        params: {},
      }

      // Act - Use evaluator.interpolate which includes DEFAULT_BINDING_HELPERS
      const result = evaluator.interpolate('Cart Total: {{currency(state.cartTotal)}}', context)

      // Assert
      expect(total).toBe(130)
      expect(result).toContain('$130.00')
    })

    it('should support collection map with state transform', async () => {
      // Arrange
      const employees: Employee[] = [
        { id: '1', name: 'Alice', department: 'Engineering', salary: 100000, active: true },
        { id: '2', name: 'Bob', department: 'Marketing', salary: 80000, active: true },
      ]
      stateStore.set('employees', employees)
      stateStore.set('raisePercentage', 0.1)

      const dataSource = createStateDataSource<Employee[]>('employees', 'employees', stateStore)

      // Act
      const data = await dataSource.fetch()
      const collection = createCollection<Employee>(data, 'id')
      const raisePercent = stateStore.get('raisePercentage') as number

      const withRaises = collection.map((e) => ({
        ...e,
        projectedSalary: e.salary * (1 + raisePercent),
      }))

      // Assert - use toBeCloseTo for floating point comparison
      const aliceWithRaise = withRaises.items[0] as
        | { name: string; projectedSalary: number }
        | undefined
      const bobWithRaise = withRaises.items[1] as
        | { name: string; projectedSalary: number }
        | undefined
      expect(aliceWithRaise?.name).toBe('Alice')
      expect(aliceWithRaise?.projectedSalary).toBeCloseTo(110000, 0)
      expect(bobWithRaise?.name).toBe('Bob')
      expect(bobWithRaise?.projectedSalary).toBeCloseTo(88000, 0)
    })
  })
})
