/**
 * EntityFacadeContext Tests
 *
 * EntityFacadeContext and useEntityFacade() hook.
 *
 * @module @pwfabric/runtime/render/__tests__/entity-facade-context
 */

import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EntityFacadeContext, useEntityFacade } from '../entity-facade-context.js'
import { createEntityFacade } from '../../entity/facade.js'

// ============================================================
// HELPERS
// ============================================================

/**
 * Component that reads from EntityFacadeContext and writes result to data attribute.
 */
function FacadeReader(): React.ReactElement {
  const facade = useEntityFacade()
  return <div data-facade={facade ? 'present' : 'null'} />
}

// ============================================================
// TESTS
// ============================================================

describe('useEntityFacade', () => {
  it('returns null when no EntityFacadeContext.Provider is present', () => {
    const html = renderToStaticMarkup(<FacadeReader />)
    expect(html).toContain('data-facade="null"')
  })

  it('returns null when provider is given null', () => {
    const html = renderToStaticMarkup(
      <EntityFacadeContext.Provider value={null}>
        <FacadeReader />
      </EntityFacadeContext.Provider>
    )
    expect(html).toContain('data-facade="null"')
  })

  it('returns the facade instance when provider supplies one', () => {
    const facade = createEntityFacade()
    const html = renderToStaticMarkup(
      <EntityFacadeContext.Provider value={facade}>
        <FacadeReader />
      </EntityFacadeContext.Provider>
    )
    expect(html).toContain('data-facade="present"')
  })

  it('inner provider overrides outer provider', () => {
    const outerFacade = createEntityFacade()
    const ResultReader = (): React.ReactElement => {
      const facade = useEntityFacade()
      return <div data-facade={facade ? 'present' : 'null'} />
    }
    const html = renderToStaticMarkup(
      <EntityFacadeContext.Provider value={outerFacade}>
        <EntityFacadeContext.Provider value={null}>
          <ResultReader />
        </EntityFacadeContext.Provider>
      </EntityFacadeContext.Provider>
    )
    expect(html).toContain('data-facade="null"')
  })
})
