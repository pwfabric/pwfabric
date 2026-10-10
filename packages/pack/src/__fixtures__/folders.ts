/**
 * Small pack folders shared by the tests. In-memory `path → text` records;
 * `packFromRecord` turns them into a PackFolder.
 */

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n'

/** A canonical app folder: identity with an app, declaration, atoms of several kinds, shared code. */
export const CANONICAL_APP: Record<string, string> = {
  'pwpack.json': json({
    id: '@pwpack/acme/clinic',
    version: '1.2.0',
    formatVersion: '1.0',
    engines: { pwfabric: '>=4.17 <5' },
    license: { fork: true, redistribute: false },
    app: { entry: 'home', surfaceOrder: ['home', 'book'] },
    packs: [{ id: '@pwpack/acme/base', version: '2.0.0', hash: 'sha256:abc' }],
  }),
  'app/plan.json': json({ title: 'Clinic' }),
  'app/definitions/navigation.json': json({ navbar: { links: [] } }),
  'app/surfaces/home.receipt.json': json({ blocks: [] }),
  'app/surfaces/book.receipt.json': json({ blocks: [] }),
  'app/media/hero.json': json({ purpose: 'hero', kind: 'image', status: 'pending' }),
  'atoms/blocks/panel/card/component.tsx': 'export default function Card() { return null }\n',
  'atoms/blocks/panel/card/manifest.json': json({ id: 'panel.card' }),
  'atoms/capabilities/booking/handler.ts': 'export const handler = () => null\n',
  'atoms/capabilities/booking/manifest.json': json({ id: 'booking' }),
  'atoms/appearance/calm/manifest.json': json({ id: 'calm' }),
  'atoms/patterns/hero-split.json': json({ id: 'hero-split' }),
  'atoms/icons/icons.json': json({ check: '<svg/>' }),
  'atoms/connectors/rest.knowledge.json': json({ id: 'rest' }),
  'atoms/connectors/rest.ts': 'export {}\n',
  'atoms/providers/crm/entities/contact.knowledge.json': json({ id: 'contact' }),
  'atoms/auth/AuthProvider.knowledge.json': json({ id: 'auth' }),
  'atoms/auth/AuthProvider.tsx': 'export {}\n',
  'atoms/surfaces/marketing/landing.receipt.json': json({ blocks: [] }),
  'atoms/lib/_shared-utils.ts': 'export const x = 1\n',
  'atoms/test/card.test.ts': 'export {}\n',
}

/** A plain pack (no app) in the canonical layout. */
export const CANONICAL_PACK: Record<string, string> = {
  'pwpack.json': json({ id: '@pwpack/acme/widgets', version: '0.3.0', requires: [] }),
  'atoms/blocks/control/button/component.tsx': 'export default function Button() { return null }\n',
  'atoms/blocks/control/button/manifest.json': json({ id: 'control.button' }),
  'atoms/lib/_shared-theme.ts': 'export const t = 1\n',
}

/** Text with Windows line endings — must survive every round trip byte-for-byte. */
export const CRLF_PACK: Record<string, string> = {
  'pwpack.json': '{\r\n  "id": "@pwpack/acme/crlf",\r\n  "version": "1.0.0"\r\n}\r\n',
  'atoms/blocks/text/note/component.tsx': 'export default function Note() {\r\n  return null\r\n}\r\n',
  'atoms/patterns/mixed.json': '{\n  "a": 1\r\n}\n',
}

/** A media export: files under media/ with their provenance. */
export function mediaPack(heroBytes: string, heroHash: string): Record<string, string> {
  return {
    'pwpack.json': json({ id: '@pwpack/acme/export', version: '1.0.0' }),
    'media/hero.webp': heroBytes,
    'media/provenance.json': json({
      formatVersion: '1.0',
      items: [{ path: 'media/hero.webp', hash: heroHash, source: 'generated', model: 'm-1', createdAt: '2026-10-01T00:00:00Z' }],
    }),
  }
}
