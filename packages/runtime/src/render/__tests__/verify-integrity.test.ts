/**
 * verifyIntegrity
 *
 * Hash check helper for `BlockModuleLoader`. End-to-end Blob URL + dynamic
 * import is integration-only (browser-runtime); this suite covers the
 * verification primitive that decides accept vs. throw before evaluation.
 *
 * @module @pwfabric/runtime/render/__tests__/verify-integrity
 */

import { describe, it, expect } from 'vitest'
import { verifyIntegrity } from '../dynamic-block-loader.js'

const TEXT_ENCODER = new TextEncoder()

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(text))
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Base64(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(text)))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

describe('verifyIntegrity', () => {
  it('accepts bare hex matching the SHA-256 of the bytes', async () => {
    const payload = 'export const Component = () => null'
    const bytes = TEXT_ENCODER.encode(payload).buffer
    const hex = await sha256Hex(payload)
    await expect(verifyIntegrity(bytes, hex, 'test-block')).resolves.toBeUndefined()
  })

  it('accepts SRI-style sha256-<base64>', async () => {
    const payload = 'console.log("ok")'
    const bytes = TEXT_ENCODER.encode(payload).buffer
    const b64 = await sha256Base64(payload)
    await expect(verifyIntegrity(bytes, `sha256-${b64}`, 'test-block')).resolves.toBeUndefined()
  })

  it('rejects when the hash differs', async () => {
    const bytes = TEXT_ENCODER.encode('payload-A').buffer
    const wrongHex = '0'.repeat(64)
    await expect(verifyIntegrity(bytes, wrongHex, 'test-block')).rejects.toThrow(
      /Integrity check failed/
    )
  })

  it('rejects when integrity is empty', async () => {
    const bytes = TEXT_ENCODER.encode('payload').buffer
    await expect(verifyIntegrity(bytes, '', 'test-block')).rejects.toThrow(/Missing integrity/)
  })

  it('rejects when integrity format is not recognized', async () => {
    const bytes = TEXT_ENCODER.encode('payload').buffer
    await expect(verifyIntegrity(bytes, 'md5-deadbeef', 'test-block')).rejects.toThrow(
      /Unrecognized integrity format/
    )
  })

  it('treats hex case-insensitively', async () => {
    const payload = 'mixed-case'
    const bytes = TEXT_ENCODER.encode(payload).buffer
    const hex = await sha256Hex(payload)
    await expect(verifyIntegrity(bytes, hex.toUpperCase(), 'test-block')).resolves.toBeUndefined()
  })
})
