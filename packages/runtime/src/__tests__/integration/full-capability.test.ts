/**
 * Full Capability Integration Tests
 *
 * Integration tests verifying the core capabilities work together
 * for real-world intranet scenarios
 *
 * Test scenarios:
 * - Employee Directory: Auth + Data + Search + Collection
 * - Document Management: Forms + Validation + State
 * - Dashboard with Live Data: Binding + Expression + State
 *
 * @module @pwfabric/runtime/__tests__/integration/full-capability
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'

// State
import { createStateStore, type StateStore } from '../../state/index.js'

// Forms
import type { FormProcessor } from '../../forms/index.js'
import { createFormProcessor } from '../../forms/index.js'

// Binding
import type {
  DataSourceRegistry,
  MutableCollectionBinding,
  ExpressionEvaluator,
  BindingExpressionContext,
} from '../../binding/index.js'
import {
  createStateDataSource,
  createCollection,
  createExpressionEvaluator,
  createDataSourceRegistry,
  interpolateBinding,
} from '../../binding/index.js'

// ============================================================
// DOMAIN TYPES
// ============================================================

interface User {
  id: string
  email: string
  displayName: string
  roles: string[]
  department: string
}

interface Employee {
  id: string
  name: string
  email: string
  department: string
  title: string
  manager: string | null
  phone: string
  location: string
  hireDate: string
  active: boolean
}

interface Document {
  id: string
  title: string
  description: string
  category: string
  author: string
  createdAt: number
  updatedAt: number
  tags: string[]
  status: 'draft' | 'published' | 'archived'
}

interface DashboardMetrics {
  totalEmployees: number
  activeProjects: number
  documentsThisWeek: number
  pendingApprovals: number
}

/**
 * Minimal local login session shape — this suite only needs "is a user
 * logged in and who are they" as a precondition for the OTHER capabilities
 * under test (data/search/collection/forms/binding/expression); it isn't
 * testing session management itself, so no session-manager package is
 * needed here.
 */
interface LoginSession {
  readonly id: string
  readonly userId: string
  readonly displayName: string
  readonly roles: readonly string[]
}

// ============================================================
// INTRANET APPLICATION CONTEXT
// ============================================================

/**
 * Represents a fully integrated intranet application context
 * combining the core capabilities
 */
class IntranetAppContext {
  readonly stateStore: StateStore<unknown>
  readonly formProcessor: FormProcessor
  readonly dataRegistry: DataSourceRegistry
  readonly expressionEvaluator: ExpressionEvaluator

  private currentSession: LoginSession | null = null
  private employeeCollection: MutableCollectionBinding<Employee> | null = null
  private documentCollection: MutableCollectionBinding<Document> | null = null
  private sessionCounter = 0

  constructor() {
    // Initialize state management
    this.stateStore = createStateStore<unknown>()

    // Initialize form processing
    this.formProcessor = createFormProcessor()

    // Initialize data source registry
    this.dataRegistry = createDataSourceRegistry()

    // Initialize expression evaluator
    this.expressionEvaluator = createExpressionEvaluator()

    // Setup initial application state
    this.initializeState()
  }

  private initializeState(): void {
    this.stateStore.set('isAuthenticated', false)
    this.stateStore.set('currentUser', null)
    this.stateStore.set('searchTerm', '')
    this.stateStore.set('selectedDepartment', 'all')
    this.stateStore.set('viewMode', 'grid')
    this.stateStore.set('notifications', [])
    this.stateStore.set('lastActivity', Date.now())
  }

  // ============================================================
  // AUTH INTEGRATION
  // ============================================================

  async login(credentials: { email: string; password: string }): Promise<{
    success: boolean
    user?: User
    error?: string
  }> {
    // Simulate auth validation (in real app, this would call auth service)
    if (!credentials.email || !credentials.password) {
      return { success: false, error: 'Invalid credentials' }
    }

    // Create local login session (no session-manager package — see LoginSession doc comment)
    this.sessionCounter += 1
    const session: LoginSession = {
      id: `sess_${Date.now()}_${this.sessionCounter}`,
      userId: `user-${Date.now()}`,
      displayName: credentials.email.split('@')[0] || 'User',
      roles: ['user', 'employee'],
    }

    this.currentSession = session

    // Update state
    const user: User = {
      id: session.userId,
      email: credentials.email,
      displayName: session.displayName,
      roles: [...session.roles],
      department: 'Engineering', // Would come from user profile
    }

    this.stateStore.set('isAuthenticated', true)
    this.stateStore.set('currentUser', user)
    this.stateStore.set('lastActivity', Date.now())

    return { success: true, user }
  }

  async logout(): Promise<void> {
    this.currentSession = null

    this.stateStore.set('isAuthenticated', false)
    this.stateStore.set('currentUser', null)
    this.employeeCollection?.clear()
    this.documentCollection?.clear()
  }

  async validateSession(): Promise<boolean> {
    if (!this.currentSession) return false
    this.stateStore.set('lastActivity', Date.now())
    return true
  }

  // ============================================================
  // EMPLOYEE DIRECTORY
  // ============================================================

  async loadEmployeeDirectory(employees: Employee[]): Promise<void> {
    // Store in state
    this.stateStore.set('employees', employees)

    // Create data source
    const employeeSource = createStateDataSource<Employee[]>(
      'employees',
      'employees',
      this.stateStore
    )
    this.dataRegistry.register(employeeSource)

    // Create collection
    this.employeeCollection = createCollection<Employee>(employees, 'id')
  }

  getEmployeeCollection(): MutableCollectionBinding<Employee> | null {
    return this.employeeCollection
  }

  searchEmployees(searchTerm: string): Employee[] {
    if (!this.employeeCollection) return []

    this.stateStore.set('searchTerm', searchTerm)
    const term = searchTerm.toLowerCase()

    if (!term) {
      return [...this.employeeCollection.items]
    }

    return this.employeeCollection.filter(
      (e) =>
        e.name.toLowerCase().includes(term) ||
        e.email.toLowerCase().includes(term) ||
        e.department.toLowerCase().includes(term) ||
        e.title.toLowerCase().includes(term)
    ).items as Employee[]
  }

  filterByDepartment(department: string): Employee[] {
    if (!this.employeeCollection) return []

    this.stateStore.set('selectedDepartment', department)

    if (department === 'all') {
      return [...this.employeeCollection.items]
    }

    return this.employeeCollection.filter((e) => e.department === department).items as Employee[]
  }

  // ============================================================
  // DOCUMENT MANAGEMENT
  // ============================================================

  async loadDocuments(documents: Document[]): Promise<void> {
    this.stateStore.set('documents', documents)

    const docSource = createStateDataSource<Document[]>('documents', 'documents', this.stateStore)
    this.dataRegistry.register(docSource)

    this.documentCollection = createCollection<Document>(documents, 'id')
  }

  getDocumentCollection(): MutableCollectionBinding<Document> | null {
    return this.documentCollection
  }

  async createDocument(
    formData: Record<string, unknown>
  ): Promise<{ success: boolean; document?: Document; errors?: Record<string, string[]> }> {
    // Define validation schema
    const schema = z.object({
      title: z.string().min(3, 'Title must be at least 3 characters'),
      description: z.string().min(10, 'Description must be at least 10 characters'),
      category: z.string().min(1, 'Category is required'),
      tags: z.string().optional(),
    })

    // Validate
    const validation = this.formProcessor.validateWithSchema(formData, schema)
    if (!validation.valid) {
      return { success: false, errors: validation.errors }
    }

    // Create document
    const currentUser = this.stateStore.get('currentUser') as User | null
    const now = Date.now()

    const document: Document = {
      id: `doc-${now}`,
      title: formData.title as string,
      description: formData.description as string,
      category: formData.category as string,
      author: currentUser?.displayName ?? 'Anonymous',
      createdAt: now,
      updatedAt: now,
      tags: (formData.tags as string)?.split(',').map((t) => t.trim()) ?? [],
      status: 'draft',
    }

    // Add to collection and state
    if (this.documentCollection) {
      this.documentCollection.add(document)
      const documents = [...this.documentCollection.items]
      this.stateStore.set('documents', documents)
    }

    return { success: true, document }
  }

  // ============================================================
  // DASHBOARD METRICS
  // ============================================================

  getDashboardMetrics(): DashboardMetrics {
    const employees = (this.stateStore.get('employees') as Employee[]) ?? []
    const documents = (this.stateStore.get('documents') as Document[]) ?? []
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

    return {
      totalEmployees: employees.filter((e) => e.active).length,
      activeProjects: 12, // Would come from projects data
      documentsThisWeek: documents.filter((d) => d.createdAt > weekAgo).length,
      pendingApprovals: documents.filter((d) => d.status === 'draft').length,
    }
  }

  renderDashboardSummary(): string {
    const metrics = this.getDashboardMetrics()
    const currentUser = this.stateStore.get('currentUser') as User | null

    const context: BindingExpressionContext = {
      data: { metrics },
      state: {
        user: currentUser,
        lastActivity: this.stateStore.get('lastActivity'),
      },
      params: {},
    }

    return interpolateBinding(
      `Welcome, {{state.user.displayName ?? 'User'}}!
Employees: {{data.metrics.totalEmployees}}
Active Projects: {{data.metrics.activeProjects}}
Documents This Week: {{data.metrics.documentsThisWeek}}
Pending Approvals: {{data.metrics.pendingApprovals}}`,
      context
    )
  }

  // ============================================================
  // STATE ACCESS
  // ============================================================

  getState<T>(key: string): T | undefined {
    return this.stateStore.get(key) as T | undefined
  }

  setState(key: string, value: unknown): void {
    this.stateStore.set(key, value)
  }

  subscribeToState(key: string, callback: (value: unknown) => void): () => void {
    return this.stateStore.subscribe(key, callback)
  }

  // ============================================================
  // CLEANUP
  // ============================================================

  dispose(): void {
    this.employeeCollection?.dispose()
    this.documentCollection?.dispose()
    this.dataRegistry.clear()
    this.stateStore.clear()
  }
}

// ============================================================
// TEST DATA
// ============================================================

const SAMPLE_EMPLOYEES: Employee[] = [
  {
    id: 'e1',
    name: 'Alice Johnson',
    email: 'alice@company.com',
    department: 'Engineering',
    title: 'Senior Developer',
    manager: null,
    phone: '555-0101',
    location: 'New York',
    hireDate: '2020-03-15',
    active: true,
  },
  {
    id: 'e2',
    name: 'Bob Smith',
    email: 'bob@company.com',
    department: 'Marketing',
    title: 'Marketing Manager',
    manager: null,
    phone: '555-0102',
    location: 'Los Angeles',
    hireDate: '2019-07-22',
    active: true,
  },
  {
    id: 'e3',
    name: 'Carol Williams',
    email: 'carol@company.com',
    department: 'Engineering',
    title: 'Junior Developer',
    manager: 'e1',
    phone: '555-0103',
    location: 'New York',
    hireDate: '2022-01-10',
    active: true,
  },
  {
    id: 'e4',
    name: 'David Brown',
    email: 'david@company.com',
    department: 'HR',
    title: 'HR Specialist',
    manager: null,
    phone: '555-0104',
    location: 'Chicago',
    hireDate: '2021-05-18',
    active: true,
  },
  {
    id: 'e5',
    name: 'Eve Davis',
    email: 'eve@company.com',
    department: 'Engineering',
    title: 'Tech Lead',
    manager: null,
    phone: '555-0105',
    location: 'San Francisco',
    hireDate: '2018-11-30',
    active: false,
  },
]

const SAMPLE_DOCUMENTS: Document[] = [
  {
    id: 'd1',
    title: 'Engineering Standards',
    description: 'Coding standards and best practices',
    category: 'Engineering',
    author: 'Alice Johnson',
    createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    tags: ['standards', 'engineering'],
    status: 'published',
  },
  {
    id: 'd2',
    title: 'Marketing Plan Q1',
    description: 'Q1 marketing strategy and goals',
    category: 'Marketing',
    author: 'Bob Smith',
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    tags: ['marketing', 'strategy'],
    status: 'draft',
  },
  {
    id: 'd3',
    title: 'Employee Handbook',
    description: 'Company policies and procedures',
    category: 'HR',
    author: 'David Brown',
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    tags: ['hr', 'policy'],
    status: 'published',
  },
]

// ============================================================
// TEST SUITE
// ============================================================

describe('Full Capability Integration - Intranet Scenarios', () => {
  let app: IntranetAppContext

  beforeEach(() => {
    vi.useFakeTimers()
    app = new IntranetAppContext()
  })

  afterEach(() => {
    app.dispose()
    vi.useRealTimers()
  })

  describe('Scenario: Employee Directory', () => {
    it('should complete full employee directory workflow', async () => {
      // Step 1: User authenticates
      const loginResult = await app.login({
        email: 'manager@company.com',
        password: 'secure123',
      })

      expect(loginResult.success).toBe(true)
      expect(loginResult.user?.email).toBe('manager@company.com')
      expect(app.getState('isAuthenticated')).toBe(true)

      // Step 2: Validate session
      const sessionValid = await app.validateSession()
      expect(sessionValid).toBe(true)

      // Step 3: Load employee data
      await app.loadEmployeeDirectory(SAMPLE_EMPLOYEES)
      const collection = app.getEmployeeCollection()
      expect(collection).not.toBeNull()
      expect(collection?.length).toBe(5)

      // Step 4: Search for employees
      const searchResults = app.searchEmployees('alice')
      expect(searchResults).toHaveLength(1)
      const firstResult = searchResults[0]
      expect(firstResult?.name).toBe('Alice Johnson')

      // Step 5: Filter by department
      const engineeringTeam = app.filterByDepartment('Engineering')
      expect(engineeringTeam).toHaveLength(3)
      expect(engineeringTeam.every((e) => e.department === 'Engineering')).toBe(true)

      // Step 6: Get employee by ID
      const employee = collection?.getByKey('e1')
      expect(employee?.name).toBe('Alice Johnson')

      // Step 7: User logs out
      await app.logout()
      expect(app.getState('isAuthenticated')).toBe(false)
      expect(app.getState('currentUser')).toBe(null)
    })

    it('should track search state changes', async () => {
      await app.login({ email: 'user@company.com', password: 'pass' })
      await app.loadEmployeeDirectory(SAMPLE_EMPLOYEES)

      const searchTerms: string[] = []
      app.subscribeToState('searchTerm', (value) => {
        searchTerms.push(value as string)
      })

      // Perform searches
      app.searchEmployees('engineer')
      app.searchEmployees('bob')
      app.searchEmployees('')

      expect(searchTerms).toEqual(['engineer', 'bob', ''])
    })

    it('should update collection when employee added', async () => {
      await app.login({ email: 'admin@company.com', password: 'admin' })
      await app.loadEmployeeDirectory(SAMPLE_EMPLOYEES)

      const collection = app.getEmployeeCollection()
      expect(collection).not.toBeNull()

      // Add new employee
      const newEmployee: Employee = {
        id: 'e6',
        name: 'Frank Miller',
        email: 'frank@company.com',
        department: 'Engineering',
        title: 'DevOps Engineer',
        manager: 'e5',
        phone: '555-0106',
        location: 'Remote',
        hireDate: '2024-01-15',
        active: true,
      }

      collection?.add(newEmployee)

      expect(collection?.length).toBe(6)
      expect(collection?.getByKey('e6')?.name).toBe('Frank Miller')
    })
  })

  describe('Scenario: Document Management', () => {
    it('should complete document creation workflow', async () => {
      // Step 1: Authenticate
      const loginResult = await app.login({
        email: 'writer@company.com',
        password: 'write123',
      })
      expect(loginResult.success).toBe(true)

      // Step 2: Load existing documents
      await app.loadDocuments(SAMPLE_DOCUMENTS)
      const docCollection = app.getDocumentCollection()
      expect(docCollection?.length).toBe(3)

      // Step 3: Create new document with valid form data
      const createResult = await app.createDocument({
        title: 'New Feature Specification',
        description: 'Detailed specification for the new dashboard feature implementation',
        category: 'Engineering',
        tags: 'feature, spec, dashboard',
      })

      expect(createResult.success).toBe(true)
      expect(createResult.document).toBeDefined()
      expect(createResult.document?.title).toBe('New Feature Specification')
      expect(createResult.document?.tags).toEqual(['feature', 'spec', 'dashboard'])
      expect(createResult.document?.author).toBe('writer')

      // Step 4: Verify document added to collection
      const collection = app.getDocumentCollection()
      expect(collection?.length).toBe(4)
    })

    it('should reject invalid document submission', async () => {
      await app.login({ email: 'user@company.com', password: 'pass' })
      await app.loadDocuments([])

      // Try to create document with invalid data
      const result = await app.createDocument({
        title: 'AB', // Too short
        description: 'Short', // Too short
        category: '', // Empty
      })

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors?.title).toBeDefined()
      expect(result.errors?.description).toBeDefined()
      expect(result.errors?.category).toBeDefined()
    })

    it('should filter documents by status', async () => {
      await app.login({ email: 'user@company.com', password: 'pass' })
      await app.loadDocuments(SAMPLE_DOCUMENTS)

      const collection = app.getDocumentCollection()
      expect(collection).not.toBeNull()

      const drafts = collection?.filter((d) => d.status === 'draft')
      const published = collection?.filter((d) => d.status === 'published')

      expect(drafts?.length).toBe(1)
      expect(published?.length).toBe(2)
    })
  })

  describe('Scenario: Dashboard with Live Data', () => {
    it('should render dashboard with metrics', async () => {
      // Authenticate
      await app.login({ email: 'manager@company.com', password: 'manage' })

      // Load data
      await app.loadEmployeeDirectory(SAMPLE_EMPLOYEES)
      await app.loadDocuments(SAMPLE_DOCUMENTS)

      // Get metrics
      const metrics = app.getDashboardMetrics()

      expect(metrics.totalEmployees).toBe(4) // Active employees only
      expect(metrics.activeProjects).toBe(12)
      expect(metrics.documentsThisWeek).toBeGreaterThanOrEqual(0)
      expect(metrics.pendingApprovals).toBe(1) // Draft documents
    })

    it('should render personalized dashboard summary', async () => {
      await app.login({ email: 'john.doe@company.com', password: 'pass' })
      await app.loadEmployeeDirectory(SAMPLE_EMPLOYEES)
      await app.loadDocuments(SAMPLE_DOCUMENTS)

      const summary = app.renderDashboardSummary()

      expect(summary).toContain('Welcome, john.doe!')
      expect(summary).toContain('Employees: 4')
      expect(summary).toContain('Active Projects: 12')
      expect(summary).toContain('Pending Approvals: 1')
    })

    it('should update metrics when data changes', async () => {
      await app.login({ email: 'admin@company.com', password: 'admin' })
      await app.loadEmployeeDirectory(SAMPLE_EMPLOYEES)

      // Initial count
      let metrics = app.getDashboardMetrics()
      expect(metrics.totalEmployees).toBe(4)

      // Add new active employee
      const empCollection = app.getEmployeeCollection()
      expect(empCollection).not.toBeNull()
      empCollection?.add({
        id: 'e7',
        name: 'New Employee',
        email: 'new@company.com',
        department: 'Sales',
        title: 'Sales Rep',
        manager: null,
        phone: '555-0107',
        location: 'Denver',
        hireDate: '2024-02-01',
        active: true,
      })

      // Update state
      app.setState('employees', [...(empCollection?.items ?? [])])

      // Check updated metrics
      metrics = app.getDashboardMetrics()
      expect(metrics.totalEmployees).toBe(5)
    })
  })

  describe('Scenario: Logout and Cleanup', () => {
    it('should cleanup state on logout', async () => {
      await app.login({ email: 'user@company.com', password: 'pass' })
      await app.loadEmployeeDirectory(SAMPLE_EMPLOYEES)
      await app.loadDocuments(SAMPLE_DOCUMENTS)

      // Verify data loaded
      expect(app.getEmployeeCollection()?.length).toBe(5)
      expect(app.getDocumentCollection()?.length).toBe(3)

      // Logout
      await app.logout()

      // Verify cleanup
      expect(app.getState('isAuthenticated')).toBe(false)
      expect(app.getState('currentUser')).toBe(null)
      expect(app.getEmployeeCollection()?.length).toBe(0)
      expect(app.getDocumentCollection()?.length).toBe(0)
    })
  })

  describe('Scenario: Complex Search and Filter', () => {
    it('should combine search and department filter', async () => {
      await app.login({ email: 'user@company.com', password: 'pass' })
      await app.loadEmployeeDirectory(SAMPLE_EMPLOYEES)

      // Search within filtered department
      app.filterByDepartment('Engineering')
      const searchResults = app.searchEmployees('alice')

      // Should find Alice in Engineering
      expect(searchResults).toHaveLength(1)
      const alice = searchResults[0]
      expect(alice?.name).toBe('Alice Johnson')
      expect(alice?.department).toBe('Engineering')
    })

    it('should sort employees by different criteria', async () => {
      await app.login({ email: 'user@company.com', password: 'pass' })
      await app.loadEmployeeDirectory(SAMPLE_EMPLOYEES)

      const collection = app.getEmployeeCollection()
      expect(collection).not.toBeNull()

      // Sort by name
      const byName = collection?.sort((a, b) => a.name.localeCompare(b.name))
      const firstByName = byName?.items[0]
      const lastByName = byName?.items[(byName?.length ?? 1) - 1]
      expect(firstByName?.name).toBe('Alice Johnson')
      expect(lastByName?.name).toBe('Eve Davis')

      // Sort by hire date (newest first)
      const byHireDate = collection?.sort(
        (a, b) => new Date(b.hireDate).getTime() - new Date(a.hireDate).getTime()
      )
      const newestEmployee = byHireDate?.items[0]
      expect(newestEmployee?.name).toBe('Carol Williams')
    })
  })

  describe('Scenario: Form State Persistence', () => {
    it('should preserve form progress across validation attempts', async () => {
      await app.login({ email: 'user@company.com', password: 'pass' })
      await app.loadDocuments([])

      // First attempt - fails validation
      const result1 = await app.createDocument({
        title: 'OK',
        description: 'Too short',
        category: 'Test',
      })
      expect(result1.success).toBe(false)

      // Fix and retry
      const result2 = await app.createDocument({
        title: 'Valid Title Here',
        description: 'This is a sufficiently long description for the document',
        category: 'Test',
      })
      expect(result2.success).toBe(true)
    })
  })

  describe('Scenario: Expression-Based UI Updates', () => {
    it('should evaluate conditional display expressions', async () => {
      await app.login({ email: 'admin@company.com', password: 'admin' })

      const evaluator = app.expressionEvaluator
      const user = app.getState<User>('currentUser')

      const context: BindingExpressionContext = {
        data: {},
        state: { user, isAuthenticated: app.getState('isAuthenticated') },
        params: {},
      }

      // Test role-based visibility
      const isAdmin = evaluator.evaluate("includes(state.user.roles, 'employee')", context)
      expect(isAdmin).toBe(true)

      // Test authenticated state
      const showDashboard = evaluator.evaluate('state.isAuthenticated ? true : false', context)
      expect(showDashboard).toBe(true)
    })

    it('should format display values with helpers', async () => {
      await app.login({ email: 'user@company.com', password: 'pass' })
      await app.loadEmployeeDirectory(SAMPLE_EMPLOYEES)

      const evaluator = app.expressionEvaluator
      const employees = app.getState<Employee[]>('employees') ?? []

      const context: BindingExpressionContext = {
        data: { employees },
        state: {},
        params: {},
      }

      // Count employees
      const count = evaluator.evaluate('length(data.employees)', context)
      expect(count).toBe(5)

      // Get first employee name
      const firstName = evaluator.evaluate('first(data.employees).name', context)
      expect(firstName).toBe('Alice Johnson')
    })
  })
})
