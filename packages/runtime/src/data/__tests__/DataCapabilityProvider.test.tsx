/**
 * DataCapabilityProvider Tests
 *
 * Tests for the React context provider, useDataService, and useOptionalDataService hooks.
 *
 * @module @pwfabric/runtime/data/__tests__/DataCapabilityProvider
 */

import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import {
  DataCapabilityProvider,
  useDataService,
  useOptionalDataService,
} from '../DataCapabilityProvider.js'
import { DataService } from '../manager.js'

// ============================================================
// HELPERS
// ============================================================

/**
 * Component that uses useDataService and renders the result.
 */
function ServiceConsumer(): React.ReactElement {
  const service = useDataService()
  return <div data-has-service={service !== null ? 'true' : 'false'}>consumer</div>
}

/**
 * Component that uses useOptionalDataService.
 */
function OptionalServiceConsumer(): React.ReactElement {
  const service = useOptionalDataService()
  return <div data-has-service={service !== null ? 'true' : 'false'}>optional-consumer</div>
}

/**
 * Component that registers a source via the service and renders source count.
 */
function SourceRegistrar(): React.ReactElement {
  const service = useDataService()
  if (!service.hasSource('test-source')) {
    service.registerSource({ id: 'test-source', kind: 'static', staticData: 42 })
  }
  return <div data-source-count={service.getSourceIds().length}>registrar</div>
}

// ============================================================
// PROVIDER TESTS
// ============================================================

describe('DataCapabilityProvider', () => {
  it('should provide DataService to children', () => {
    const html = renderToString(
      <DataCapabilityProvider>
        <ServiceConsumer />
      </DataCapabilityProvider>
    )

    expect(html).toContain('data-has-service="true"')
    expect(html).toContain('consumer')
  })

  it('should create DataService with config', () => {
    const html = renderToString(
      <DataCapabilityProvider config={{ defaultCacheTtl: 120, maxRetries: 5 }}>
        <ServiceConsumer />
      </DataCapabilityProvider>
    )

    expect(html).toContain('data-has-service="true"')
  })

  it('should use injected service when provided', () => {
    const injectedService = new DataService({ timeout: 9999 })
    injectedService.registerSource({ id: 'injected', kind: 'static', staticData: 'hello' })

    const html = renderToString(
      <DataCapabilityProvider service={injectedService}>
        <SourceRegistrar />
      </DataCapabilityProvider>
    )

    // The injected service should have both 'injected' and 'test-source' registered by SourceRegistrar
    expect(injectedService.hasSource('injected')).toBe(true)
    expect(injectedService.hasSource('test-source')).toBe(true)
    expect(html).toContain('registrar')
  })

  it('should prefer injected service over config', () => {
    const injectedService = new DataService({ timeout: 1234 })

    const html = renderToString(
      <DataCapabilityProvider config={{ timeout: 5678 }} service={injectedService}>
        <ServiceConsumer />
      </DataCapabilityProvider>
    )

    expect(html).toContain('data-has-service="true"')
    // The injected service's config should be used, not the config prop
    expect(injectedService.config.timeout).toBe(1234)
  })
})

// ============================================================
// useDataService HOOK
// ============================================================

describe('useDataService', () => {
  it('should throw when used outside of provider', () => {
    // In SSR, this will throw during renderToString
    expect(() => {
      renderToString(<ServiceConsumer />)
    }).toThrow('useDataService must be used within a DataCapabilityProvider')
  })

  it('should return the DataService from provider', () => {
    const html = renderToString(
      <DataCapabilityProvider>
        <ServiceConsumer />
      </DataCapabilityProvider>
    )

    expect(html).toContain('data-has-service="true"')
  })
})

// ============================================================
// useOptionalDataService HOOK
// ============================================================

describe('useOptionalDataService', () => {
  it('should return null when used outside of provider', () => {
    const html = renderToString(<OptionalServiceConsumer />)

    expect(html).toContain('data-has-service="false"')
  })

  it('should return the DataService when inside provider', () => {
    const html = renderToString(
      <DataCapabilityProvider>
        <OptionalServiceConsumer />
      </DataCapabilityProvider>
    )

    expect(html).toContain('data-has-service="true"')
  })
})
