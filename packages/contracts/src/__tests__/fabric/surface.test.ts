/**
 * Surface Definition Tests
 *
 * Tests for surface types, environment types, and binding configurations
 *
 * @module @pwfabric/contracts/fabric/__tests__/surface
 */

import { describe, it, expect } from 'vitest'
import type {
  EnvironmentType,
  EnvironmentDescriptor,
  SurfaceMetadata,
  CapabilityBinding,
  BindingTransform,
  TransformDescriptor,
  SurfaceBinding,
  SurfaceContext,
  BaseSurfaceOutput,
  WebSurfaceOutput,
  ApiSurfaceOutput,
  CliSurfaceOutput,
  Surface,
  SurfaceDescriptor,
} from '../../fabric/surface.js'
import type { CapabilityId, SurfaceId } from '../../core/ids.js'

describe('EnvironmentType', () => {
  it('should accept all valid environment types', () => {
    const types: EnvironmentType[] = [
      'web',
      'api',
      'cli',
      'worker',
      'edge',
      'node',
      'native',
      'test',
    ]

    expect(types).toHaveLength(8)
    types.forEach((type) => {
      expect(typeof type).toBe('string')
    })
  })
})

describe('EnvironmentDescriptor', () => {
  it('should accept minimal descriptor', () => {
    const descriptor: EnvironmentDescriptor = {
      type: 'web',
    }

    expect(descriptor.type).toBe('web')
  })

  it('should accept full descriptor', () => {
    const descriptor: EnvironmentDescriptor = {
      type: 'web',
      platform: 'browser',
      version: 'chrome-120',
      features: ['webgl', 'webrtc', 'serviceworker'],
    }

    expect(descriptor.type).toBe('web')
    expect(descriptor.platform).toBe('browser')
    expect(descriptor.version).toBe('chrome-120')
    expect(descriptor.features).toContain('webgl')
  })

  it('should accept different environment types', () => {
    const nodeEnv: EnvironmentDescriptor = {
      type: 'node',
      platform: 'linux',
      version: '22.0.0',
    }

    const edgeEnv: EnvironmentDescriptor = {
      type: 'edge',
      platform: 'cloudflare',
      features: ['kv', 'd1'],
    }

    expect(nodeEnv.type).toBe('node')
    expect(edgeEnv.type).toBe('edge')
  })
})

describe('SurfaceMetadata', () => {
  it('should accept minimal metadata', () => {
    const metadata: SurfaceMetadata = {
      name: 'Dashboard',
    }

    expect(metadata.name).toBe('Dashboard')
  })

  it('should accept full metadata', () => {
    const metadata: SurfaceMetadata = {
      name: 'Dashboard',
      description: 'Main application dashboard',
      tags: ['dashboard', 'admin', 'analytics'],
    }

    expect(metadata.description).toBe('Main application dashboard')
    expect(metadata.tags).toHaveLength(3)
  })
})

describe('CapabilityBinding', () => {
  it('should accept minimal binding', () => {
    const binding: CapabilityBinding = {
      capabilityId: 'auth/login' as CapabilityId,
    }

    expect(binding.capabilityId).toBe('auth/login')
  })

  it('should accept binding with alias', () => {
    const binding: CapabilityBinding = {
      capabilityId: 'auth/login' as CapabilityId,
      alias: 'login',
    }

    expect(binding.alias).toBe('login')
  })

  it('should accept binding with transform', () => {
    const binding: CapabilityBinding = {
      capabilityId: 'users/list' as CapabilityId,
      transform: {
        input: {
          type: 'map',
          config: { mapping: { userId: 'id' } },
        },
        output: {
          type: 'pick',
          config: { fields: ['id', 'name'] },
        },
      },
    }

    expect(binding.transform?.input?.type).toBe('map')
    expect(binding.transform?.output?.type).toBe('pick')
  })
})

describe('TransformDescriptor', () => {
  it('should accept map transform', () => {
    const transform: TransformDescriptor = {
      type: 'map',
      config: { mapping: { oldKey: 'newKey' } },
    }

    expect(transform.type).toBe('map')
  })

  it('should accept filter transform', () => {
    const transform: TransformDescriptor = {
      type: 'filter',
      config: { predicate: 'active === true' },
    }

    expect(transform.type).toBe('filter')
  })

  it('should accept pick transform', () => {
    const transform: TransformDescriptor = {
      type: 'pick',
      config: { fields: ['id', 'name', 'email'] },
    }

    expect(transform.type).toBe('pick')
  })

  it('should accept omit transform', () => {
    const transform: TransformDescriptor = {
      type: 'omit',
      config: { fields: ['password', 'secret'] },
    }

    expect(transform.type).toBe('omit')
  })

  it('should accept custom transform', () => {
    const transform: TransformDescriptor = {
      type: 'custom',
      config: { handler: 'myCustomTransform' },
    }

    expect(transform.type).toBe('custom')
  })
})

describe('BindingTransform', () => {
  it('should accept input-only transform', () => {
    const transform: BindingTransform = {
      input: {
        type: 'map',
        config: {},
      },
    }

    expect(transform.input).toBeDefined()
    expect(transform.output).toBeUndefined()
  })

  it('should accept output-only transform', () => {
    const transform: BindingTransform = {
      output: {
        type: 'filter',
        config: {},
      },
    }

    expect(transform.input).toBeUndefined()
    expect(transform.output).toBeDefined()
  })

  it('should accept both input and output transforms', () => {
    const transform: BindingTransform = {
      input: { type: 'map' },
      output: { type: 'pick' },
    }

    expect(transform.input?.type).toBe('map')
    expect(transform.output?.type).toBe('pick')
  })
})

describe('SurfaceBinding', () => {
  it('should have correct structure', () => {
    const binding: SurfaceBinding<unknown> = {
      capabilityId: 'auth/login' as CapabilityId,
      capability: {} as unknown,
      alias: 'login',
    }

    expect(binding.capabilityId).toBe('auth/login')
    expect(binding.alias).toBe('login')
  })
})

describe('SurfaceContext', () => {
  it('should accept minimal context', () => {
    const context: SurfaceContext<'web'> = {
      environment: 'web',
      bindings: [],
    }

    expect(context.environment).toBe('web')
    expect(context.bindings).toHaveLength(0)
  })

  it('should accept context with bindings', () => {
    const context: SurfaceContext<'api'> = {
      environment: 'api',
      bindings: [
        { capabilityId: 'auth/login' as CapabilityId },
        { capabilityId: 'users/get' as CapabilityId, alias: 'getUser' },
      ],
    }

    expect(context.bindings).toHaveLength(2)
  })

  it('should accept context with data', () => {
    const context: SurfaceContext<'web'> = {
      environment: 'web',
      bindings: [],
      data: {
        theme: 'dark',
        locale: 'en-US',
        user: { id: '123' },
      },
    }

    expect(context.data?.theme).toBe('dark')
    expect(context.data?.locale).toBe('en-US')
  })
})

describe('SurfaceOutput types', () => {
  describe('BaseSurfaceOutput', () => {
    it('should have correct structure', () => {
      const output: BaseSurfaceOutput = {
        type: 'custom',
        data: { foo: 'bar' },
      }

      expect(output.type).toBe('custom')
      expect(output.data).toEqual({ foo: 'bar' })
    })
  })

  describe('WebSurfaceOutput', () => {
    it('should have correct structure', () => {
      const output: WebSurfaceOutput = {
        type: 'web',
        data: null,
        html: '<div>Hello</div>',
      }

      expect(output.type).toBe('web')
      expect(output.html).toBe('<div>Hello</div>')
    })

    it('should accept component output', () => {
      const output: WebSurfaceOutput = {
        type: 'web',
        data: null,
        component: { name: 'Dashboard' },
      }

      expect(output.component).toEqual({ name: 'Dashboard' })
    })
  })

  describe('ApiSurfaceOutput', () => {
    it('should have correct structure', () => {
      const output: ApiSurfaceOutput = {
        type: 'api',
        data: null,
        status: 200,
        body: { success: true, data: [] },
      }

      expect(output.type).toBe('api')
      expect(output.status).toBe(200)
    })

    it('should accept headers', () => {
      const output: ApiSurfaceOutput = {
        type: 'api',
        data: null,
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'abc123',
        },
        body: { id: '123' },
      }

      expect(output.headers?.['Content-Type']).toBe('application/json')
    })
  })

  describe('CliSurfaceOutput', () => {
    it('should have correct structure', () => {
      const output: CliSurfaceOutput = {
        type: 'cli',
        data: null,
        stdout: 'Command completed successfully',
        exitCode: 0,
      }

      expect(output.type).toBe('cli')
      expect(output.stdout).toBe('Command completed successfully')
      expect(output.exitCode).toBe(0)
    })

    it('should accept stderr', () => {
      const output: CliSurfaceOutput = {
        type: 'cli',
        data: null,
        stderr: 'Error: File not found',
        exitCode: 1,
      }

      expect(output.stderr).toBe('Error: File not found')
      expect(output.exitCode).toBe(1)
    })
  })
})

describe('SurfaceDescriptor', () => {
  it('should accept minimal descriptor', () => {
    const descriptor: SurfaceDescriptor<'web'> = {
      id: 'web/dashboard',
      version: '1.0.0',
      environment: 'web',
      metadata: {
        name: 'Dashboard',
      },
    }

    expect(descriptor.id).toBe('web/dashboard')
    expect(descriptor.environment).toBe('web')
  })

  it('should accept descriptor with capabilities', () => {
    const descriptor: SurfaceDescriptor<'api'> = {
      id: 'api/users',
      version: '2.0.0',
      environment: 'api',
      metadata: {
        name: 'Users API',
        description: 'REST API for user management',
      },
      capabilities: [
        { capabilityId: 'users/list' as CapabilityId },
        { capabilityId: 'users/get' as CapabilityId, alias: 'getById' },
        { capabilityId: 'users/create' as CapabilityId },
      ],
    }

    expect(descriptor.capabilities).toHaveLength(3)
  })

  it('should accept different environment types', () => {
    const cliSurface: SurfaceDescriptor<'cli'> = {
      id: 'cli/admin',
      version: '1.0.0',
      environment: 'cli',
      metadata: { name: 'Admin CLI' },
    }

    const workerSurface: SurfaceDescriptor<'worker'> = {
      id: 'worker/background',
      version: '1.0.0',
      environment: 'worker',
      metadata: { name: 'Background Worker' },
    }

    expect(cliSurface.environment).toBe('cli')
    expect(workerSurface.environment).toBe('worker')
  })
})

describe('Surface interface', () => {
  // Surface is an interface, so we test its expected structure
  it('should have expected properties', () => {
    // This is a structural test - we define a mock that satisfies Surface
    const mockSurface: Surface<'web'> = {
      id: 'web/dashboard' as SurfaceId,
      version: { major: 1, minor: 0, patch: 0 },
      environment: 'web',
      metadata: { name: 'Dashboard' },
      capabilities: [],
      bind: () => ({
        capabilityId: 'test/cap' as CapabilityId,
        capability: {} as unknown,
      }),
      render: async () => ({
        type: 'web',
        data: null,
      }),
    }

    expect(mockSurface.id).toBe('web/dashboard')
    expect(mockSurface.environment).toBe('web')
    expect(typeof mockSurface.bind).toBe('function')
    expect(typeof mockSurface.render).toBe('function')
  })
})
