import { describe, expect, it } from 'vitest'
import {
  assembleFooter,
  assembleNav,
  FOOTER_BAND_ID,
  composeTitle,
  doorHeaders,
  isHrefKey,
  pageKeyOf,
  receiptFilesOf,
  rewriteHrefs,
  strayPageKeyOf,
  withVersion,
} from './helpers.js'
import type { SurfaceBlockNode } from './types.js'

const ENTRY = 'home'
const hashHref = (key: string): string => `#/${key}`
const pathHref = (key: string): string => `/apps/intranet/${key}`

describe('pageKeyOf', () => {
  it('trims leading/trailing slashes', () => {
    expect(pageKeyOf('/about/')).toBe('about')
    expect(pageKeyOf('/about')).toBe('about')
    expect(pageKeyOf('about/')).toBe('about')
    expect(pageKeyOf('about')).toBe('about')
  })

  it('maps root and empty to null (entry)', () => {
    expect(pageKeyOf('/')).toBeNull()
    expect(pageKeyOf('')).toBeNull()
    expect(pageKeyOf('///')).toBeNull()
  })

  it('keeps nested paths intact', () => {
    expect(pageKeyOf('/duyurular-departman/')).toBe('duyurular-departman')
  })
})

describe('rewriteHrefs', () => {
  it('rewrites page hrefs to hash form', () => {
    const tree = { props: { href: '/about' } }
    expect(rewriteHrefs(tree, ENTRY, hashHref)).toEqual({ props: { href: '#/about' } })
  })

  it('rewrites page hrefs with the injected toHref (path mode)', () => {
    const tree = { props: { href: '/gallery' } }
    expect(rewriteHrefs(tree, ENTRY, pathHref)).toEqual({
      props: { href: '/apps/intranet/gallery' },
    })
  })

  it("maps '/' (and '') to the entry page", () => {
    expect(rewriteHrefs({ href: '/' }, ENTRY, hashHref)).toEqual({ href: '#/home' })
    expect(rewriteHrefs({ href: '' }, ENTRY, hashHref)).toEqual({ href: '#/home' })
  })

  it('leaves absolute-scheme and fragment hrefs untouched', () => {
    const tree = {
      a: { href: 'https://example.com/x' },
      b: { href: 'mailto:x@y.z' },
      c: { href: '#section' },
      d: { href: 'tel:+901112223344' },
    }
    expect(rewriteHrefs(tree, ENTRY, hashHref)).toEqual(tree)
  })

  /**
   * THE PAGE IS THE ADDRESS; the query and fragment ride along. Keying the
   * WHOLE href would make `/about#team` into the page key `about#team`, which
   * names no page — so in hash mode every in-page link would render the
   * not-found page. `strayPageKeyOf` splits the two the same way.
   */
  /**
   * Asserted on the KEY, not on the rewritten string. `'#/' + 'about#team'` and
   * `'#/about' + '#team'` are the same six-teen characters, so comparing output
   * cannot tell a split page key from a swallowed one — the first version of
   * this test passed against the very defect it was written for. What the
   * router consumes is the key, so that is what has to be measured.
   */
  it('hands the router the PAGE, with the anchor riding along outside it', () => {
    const keys: string[] = []
    const spy = (key: string): string => {
      keys.push(key)
      return `#/${key}`
    }
    const out = rewriteHrefs(
      { a: { href: '/about#team' }, b: { href: '/about?tab=2' }, c: { href: '/about?tab=2#team' } },
      ENTRY,
      spy
    )
    expect(keys).toEqual(['about', 'about', 'about'])
    expect(out).toEqual({
      a: { href: '#/about#team' },
      b: { href: '#/about?tab=2' },
      c: { href: '#/about?tab=2#team' },
    })
  })

  it('an anchor on the entry page keeps the entry key', () => {
    expect(rewriteHrefs({ href: '/#top' }, ENTRY, hashHref)).toEqual({ href: '#/home#top' })
  })

  // The defect this replaced: an unknown internal href was left live, so
  // clicking it left the app — in path mode a full document load that the SPA
  // fallback answered with the entry page, which is how a four-page app came
  // to render its home page at every address.
  it('keeps an unknown internal href INSIDE the app, for the router to refuse', () => {
    expect(rewriteHrefs({ href: '/nope' }, ENTRY, hashHref)).toEqual({ href: '#/nope' })
    expect(rewriteHrefs({ href: '/nope' }, ENTRY, pathHref)).toEqual({
      href: '/apps/intranet/nope',
    })
  })

  it('walks arrays and nested objects; non-href strings untouched', () => {
    const tree = [
      { type: 'navbar', props: { links: [{ label: '/about', href: '/about' }] } },
      { type: 'footer', children: [{ props: { href: 'gallery/' } }] },
    ]
    expect(rewriteHrefs(tree, ENTRY, hashHref)).toEqual([
      { type: 'navbar', props: { links: [{ label: '/about', href: '#/about' }] } },
      { type: 'footer', children: [{ props: { href: '#/gallery' } }] },
    ])
  })

  it('does not mutate the input tree', () => {
    const tree = { props: { href: '/about' } }
    rewriteHrefs(tree, ENTRY, hashHref)
    expect(tree.props.href).toBe('/about')
  })

  it('passes primitives through', () => {
    expect(rewriteHrefs('hello', ENTRY, hashHref)).toBe('hello')
    expect(rewriteHrefs(42, ENTRY, hashHref)).toBe(42)
    expect(rewriteHrefs(null, ENTRY, hashHref)).toBeNull()
  })
})

describe('assembleNav', () => {
  const navigation = {
    navbar: { links: [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }] },
  }

  it('fills ONLY empty navbar links from navigation.json (rewritten)', () => {
    const blocks: SurfaceBlockNode[] = [{ type: 'navbar', props: { links: [] } }]
    assembleNav(blocks, navigation, ENTRY, hashHref)
    expect(blocks[0]!.props!.links).toEqual([
      { label: 'Home', href: '#/home' },
      { label: 'About', href: '#/about' },
    ])
  })

  it('leaves navbars with authored links untouched', () => {
    const authored = [{ label: 'Custom', href: '#/gallery' }]
    const blocks: SurfaceBlockNode[] = [{ type: 'navbar', props: { links: authored } }]
    assembleNav(blocks, navigation, ENTRY, hashHref)
    expect(blocks[0]!.props!.links).toBe(authored)
  })

  /**
   * The navbar block has always rendered the wordmark as a link when
   * `logoHref` is set, and nothing ever set it — so on a generated five-page
   * app the site name was inert on every page. Which page is entry, and what
   * an href looks like in the active router, are facts the surface cannot
   * know, which is why this is assembly and not authoring.
   */
  it('points the wordmark at the entry page', () => {
    const blocks: SurfaceBlockNode[] = [{ type: 'navbar', props: { links: [] } }]
    assembleNav(blocks, navigation, ENTRY, hashHref)
    expect(blocks[0]!.props!.logoHref).toBe('#/home')
  })

  it('in path mode the wordmark href carries the base', () => {
    const blocks: SurfaceBlockNode[] = [{ type: 'navbar', props: { links: [] } }]
    assembleNav(blocks, navigation, ENTRY, pathHref)
    expect(blocks[0]!.props!.logoHref).toBe('/apps/intranet/home')
  })

  it('an authored wordmark href is left alone', () => {
    const blocks: SurfaceBlockNode[] = [
      { type: 'navbar', props: { links: [], logoHref: 'https://corporate.example' } },
    ]
    assembleNav(blocks, navigation, ENTRY, hashHref)
    expect(blocks[0]!.props!.logoHref).toBe('https://corporate.example')
  })

  it('a navbar whose links were authored still gets the wordmark home', () => {
    // The two fills are independent: the old code returned early on authored
    // links, which would have left the wordmark inert on exactly the navbars
    // someone had bothered to write.
    const blocks: SurfaceBlockNode[] = [
      { type: 'navbar', props: { links: [{ label: 'X', href: '#/x' }] } },
    ]
    assembleNav(blocks, navigation, ENTRY, hashHref)
    expect(blocks[0]!.props!.logoHref).toBe('#/home')
  })

  it('reaches nested navbars through children', () => {
    const blocks: SurfaceBlockNode[] = [
      { type: 'section', children: [{ type: 'navbar', props: { links: [] } }] },
    ]
    assembleNav(blocks, navigation, ENTRY, hashHref)
    expect((blocks[0]!.children![0] as SurfaceBlockNode).props!.links).toHaveLength(2)
  })

  it('tolerates a missing navigation.json', () => {
    const blocks: SurfaceBlockNode[] = [{ type: 'navbar', props: { links: [] } }]
    assembleNav(blocks, null, ENTRY, hashHref)
    expect(blocks[0]!.props!.links).toEqual([])
  })
})

/**
 * `navigation.footer` declared an address column and a social column;
 * no runner drew it and the page ended on an empty copyright strip.
 */
describe('assembleFooter', () => {
  const navigation = {
    footer: {
      columns: [
        { heading: 'Mavi Fincan', links: [{ label: 'Menu', href: '/menu/' }, { label: 'About', href: '/about/' }] },
        { heading: 'Social', links: [{ label: 'Contact', href: '/contact/' }] },
      ],
      excludeSurfaces: ['profile'],
    },
  }
  /** The shell-topbar-flow shape every H3 page had: navbar, content, copyright strip. */
  const shellPage = (): SurfaceBlockNode[] => [
    {
      id: 'shell',
      type: 'container',
      children: [
        { id: 'shell-nav', type: 'navbar', props: { links: [] } },
        { id: 'shell-content', type: 'container', children: [] },
        { id: 'shell-foot', type: 'section', children: [{ id: 'shell-foot-c', type: 'text', props: { content: '(c) 2026' } }] },
      ],
    },
  ]
  const band = (blocks: SurfaceBlockNode[]): SurfaceBlockNode | undefined => {
    const find = (nodes: SurfaceBlockNode[] | undefined): SurfaceBlockNode | undefined => {
      for (const n of nodes ?? []) {
        if (n.id === FOOTER_BAND_ID) return n
        const hit = find(n.children)
        if (hit) return hit
      }
      return undefined
    }
    return find(blocks)
  }

  it('opens a link to another site in a new tab; an explicit target wins', () => {
    const nav = {
      footer: {
        columns: [
          {
            heading: 'Links',
            links: [
              { label: 'Docs', href: 'https://docs.example.com/' },
              { label: 'CDN', href: '//cdn.example.com/x' },
              { label: 'Menu', href: '/menu/' },
              { label: 'Mail', href: 'mailto:hi@example.com' },
              { label: 'Same tab', href: 'https://example.com/', target: '_self' as const },
              { label: 'New tab', href: '/about/', target: '_blank' as const },
            ],
          },
        ],
      },
    }
    const drawn = band(assembleFooter(shellPage(), nav, 'home', ENTRY, hashHref))
    const links = drawn!.children![0]!.children![0]!.children!.filter((n) => n.type === 'link')
    expect(links.map((l) => [l.props!.text, l.props!.external ?? false])).toEqual([
      ['Docs', true],
      ['CDN', true],
      ['Menu', false],
      ['Mail', false],
      ['Same tab', false],
      ['New tab', true],
    ])
  })

  it('draws the declared columns as heading + links, hrefs rewritten for the router', () => {
    const blocks = assembleFooter(shellPage(), navigation, 'home', ENTRY, hashHref)
    const drawn = band(blocks)
    expect(drawn?.type).toBe('section')
    const cols = drawn!.children![0]!
    expect(cols.type).toBe('grid')
    expect(cols.props!.columns).toBe(2)
    const [first, second] = cols.children!
    expect(first!.children!.map((c) => [c.type, c.props!.text, c.props!.href])).toEqual([
      ['heading', 'Mavi Fincan', undefined],
      ['link', 'Menu', '#/menu'],
      ['link', 'About', '#/about'],
    ])
    expect(second!.children!.map((c) => c.props!.text)).toEqual(['Social', 'Contact'])
  })

  it('sits inside the shell, above its copyright strip', () => {
    const blocks = assembleFooter(shellPage(), navigation, 'home', ENTRY, hashHref)
    expect(blocks[0]!.children!.map((c) => c.id)).toEqual(['shell-nav', 'shell-content', FOOTER_BAND_ID, 'shell-foot'])
  })

  it('a page with no shell gets it as its last top-level block', () => {
    const blocks: SurfaceBlockNode[] = [{ id: 'hero', type: 'section' }]
    assembleFooter(blocks, navigation, 'home', ENTRY, pathHref)
    expect(blocks.map((b) => b.id)).toEqual(['hero', FOOTER_BAND_ID])
    expect(band(blocks)!.children![0]!.children![0]!.children![1]!.props!.href).toBe('/apps/intranet/menu')
  })

  it('is not drawn on an excluded page, without a declaration, or twice', () => {
    expect(band(assembleFooter(shellPage(), navigation, 'profile', ENTRY, hashHref))).toBeUndefined()
    expect(band(assembleFooter(shellPage(), null, 'home', ENTRY, hashHref))).toBeUndefined()
    expect(band(assembleFooter(shellPage(), { footer: { columns: [{ heading: 'Empty', links: [] }] } }, 'home', ENTRY, hashHref))).toBeUndefined()
    const once = assembleFooter(shellPage(), navigation, 'home', ENTRY, hashHref)
    assembleFooter(once, navigation, 'home', ENTRY, hashHref)
    expect(once[0]!.children!.filter((c) => c.id === FOOTER_BAND_ID)).toHaveLength(1)
  })

  it('a page with its own footer gets none, even when its links differ from the declaration', () => {
    const ownFooters: SurfaceBlockNode[] = [
      // the footer pattern composed by the page, other links
      { id: 'site-footer', type: 'section', children: [{ id: 'site-footer-cols', type: 'grid', children: [{ type: 'link', props: { text: 'Jobs', href: '#/jobs' } }] }] },
      // a generator's own (Turkish) name for it, no links at all
      { id: 'altbilgi', type: 'section', children: [{ id: 'altbilgi-adres', type: 'text', props: { content: 'Street 3' } }] },
      // the retired footer block
      { id: 'x', type: 'footer' },
      // camelCase id
      { id: 'pageFooter', type: 'container' },
    ]
    for (const own of ownFooters) {
      const page = shellPage()
      page[0]!.children![1]!.children = [own]
      expect(band(assembleFooter(page, navigation, 'home', ENTRY, hashHref))).toBeUndefined()
    }
  })

  it('a shell copyright strip that holds links is the page drawing its footer', () => {
    const page = shellPage()
    page[0]!.children![2]!.children!.push({ id: 'shell-foot-l', type: 'link', props: { text: 'Instagram', href: 'https://instagram.com/x' } })
    expect(band(assembleFooter(page, navigation, 'home', ENTRY, hashHref))).toBeUndefined()
  })

  it('a page with only the empty copyright strip gets the declared footer', () => {
    expect(band(assembleFooter(shellPage(), navigation, 'home', ENTRY, hashHref))).toBeDefined()
  })

  it('an id that merely contains the letters is not a footer', () => {
    const page = shellPage()
    page[0]!.children![1]!.children = [{ id: 'football-scores', type: 'section' }, { id: 'footnote', type: 'text' }]
    expect(band(assembleFooter(page, navigation, 'home', ENTRY, hashHref))).toBeDefined()
  })
})

describe('receiptFilesOf', () => {
  it('passes through the ideal surfaceReceiptFiles map', () => {
    const map = { home: 'surfaces/home.receipt.json', about: 'pages/about.json' }
    expect(
      receiptFilesOf({ entrySurfaceId: 'home', surfaceOrder: ['home', 'about'], surfaceReceiptFiles: map })
    ).toBe(map)
  })

  it('builds the legacy fallback map key → surfaces/<key>.receipt.json', () => {
    expect(receiptFilesOf({ entrySurfaceId: 'home', surfaceOrder: ['home', 'gallery'] })).toEqual({
      home: 'surfaces/home.receipt.json',
      gallery: 'surfaces/gallery.receipt.json',
    })
  })
})

describe('composeTitle', () => {
  it('uses the project title when the receipt has none', () => {
    expect(composeTitle('Intranet', undefined)).toBe('Intranet')
  })

  it('avoids duplicating the project title prefix', () => {
    expect(composeTitle('Intranet', 'Intranet — Announcements')).toBe('Intranet — Announcements')
  })

  it('joins otherwise', () => {
    expect(composeTitle('Intranet', 'Announcements')).toBe('Intranet — Announcements')
  })

  it('falls back to the receipt title without a project title', () => {
    expect(composeTitle(undefined, 'Announcements')).toBe('Announcements')
  })
})

describe('isHrefKey — role-named links are links, field names are not', () => {
  it('accepts href and *Href', () => {
    expect(isHrefKey('href')).toBe(true)
    expect(isHrefKey('ctaHref')).toBe(true)
    expect(isHrefKey('linkHref')).toBe(true)
  })
  it('rejects a field NAME that holds a link, and unrelated keys', () => {
    expect(isHrefKey('ctaHrefField')).toBe(false)
    expect(isHrefKey('src')).toBe(false)
    expect(isHrefKey('hrefs')).toBe(false)
  })
})

describe("rewriteHrefs — a navbar's ctaHref stays inside the app", () => {
  it('rewrites ctaHref like href and leaves ctaHrefField alone', () => {
    const out = rewriteHrefs(
      { props: { ctaHref: '/contact/', ctaHrefField: 'link', href: '/about/' } },
      'home',
      (k) => `#/${k}`
    )
    expect(out).toEqual({ props: { ctaHref: '#/contact', ctaHrefField: 'link', href: '#/about' } })
  })
})

describe('strayPageKeyOf — a root-relative page link arriving at click time', () => {
  const pages = ['home', 'people', 'session']
  it('names the page for /people/ and /session, query and fragment ignored', () => {
    expect(strayPageKeyOf('/people/', pages)).toBe('people')
    expect(strayPageKeyOf('/session?id=s-01', pages)).toBe('session')
    expect(strayPageKeyOf('/session/#top', pages)).toBe('session')
  })
  it('is null for anything that is not one of our pages', () => {
    expect(strayPageKeyOf('/contact/', pages)).toBeNull()
    expect(strayPageKeyOf('/people/ada', pages)).toBeNull()
    expect(strayPageKeyOf('//evil.example/people', pages)).toBeNull()
    expect(strayPageKeyOf('https://x.example/people', pages)).toBeNull()
    expect(strayPageKeyOf('#people', pages)).toBeNull()
    expect(strayPageKeyOf('/', pages)).toBeNull()
  })
})

describe('doorHeaders — the credential a receipt request carries', () => {
  it('is empty for an anonymous visitor', () => {
    expect(doorHeaders({ appSession: undefined, doorToken: undefined })).toEqual({})
  })

  it('presents a platform session as the session header', () => {
    expect(doorHeaders({ appSession: 'sess-1', doorToken: undefined })).toEqual({ 'x-app-session': 'sess-1' })
  })

  it("presents an issuer's door token as a bearer", () => {
    expect(doorHeaders({ appSession: undefined, doorToken: 'door-jwt' })).toEqual({ authorization: 'Bearer door-jwt' })
  })

  it('prefers the platform session when both exist', () => {
    expect(doorHeaders({ appSession: 'sess-1', doorToken: 'door-jwt' })).toEqual({ 'x-app-session': 'sess-1' })
  })
})

describe('withVersion', () => {
  it('appends v as the first or a further query parameter', () => {
    expect(withVersion('./pwpack/project.json', 3)).toBe('./pwpack/project.json?v=3')
    expect(withVersion('https://x.example/p/auth.json?token=a', '2026-10-10')).toBe(
      'https://x.example/p/auth.json?token=a&v=2026-10-10'
    )
  })

  it('encodes the version and keeps a fragment last', () => {
    expect(withVersion('/p/home.receipt.json#x', 'a b&c')).toBe('/p/home.receipt.json?v=a%20b%26c#x')
  })

  it('leaves the address alone without a version', () => {
    expect(withVersion('./pwpack/project.json', undefined)).toBe('./pwpack/project.json')
    expect(withVersion('./pwpack/project.json', '')).toBe('./pwpack/project.json')
  })

  it('treats 0 as a version', () => {
    expect(withVersion('a.json', 0)).toBe('a.json?v=0')
  })
})

describe('rewriteHrefs — redirects and navigate actions stay inside the app', () => {
  it("rewrites a form binding's successRedirect and a navigate action's url", () => {
    const capabilities = [
      { capability: 'platform/entities', config: { formBindings: [{ formId: 'f', sourceId: 'Order', successRedirect: '/thanks/?from=order' }] } },
      { capability: 'platform/persistence', config: { behaviors: [{ id: 'b', event: 'block:click', actions: [{ type: 'navigate', url: '/menu' }] }] } },
    ]
    const out = rewriteHrefs(capabilities, 'home', (k) => `#/${k}`)
    expect(out[0]?.config.formBindings[0]?.successRedirect).toBe('#/thanks?from=order')
    expect(out[1]?.config.behaviors[0]?.actions[0]).toEqual({ type: 'navigate', url: '#/menu' })
  })

  it("rewrites a block's navigate action and leaves other urls and external targets alone", () => {
    const out = rewriteHrefs(
      {
        props: {
          action: { type: 'navigate', url: '/cart' },
          other: { type: 'setState', url: '/not-a-link' },
          away: { type: 'navigate', url: 'https://example.com/x' },
          url: '/plain-url-prop',
        },
      },
      'home',
      (k) => `#/${k}`
    )
    expect(out.props).toEqual({
      action: { type: 'navigate', url: '#/cart' },
      other: { type: 'setState', url: '/not-a-link' },
      away: { type: 'navigate', url: 'https://example.com/x' },
      url: '/plain-url-prop',
    })
  })
})
