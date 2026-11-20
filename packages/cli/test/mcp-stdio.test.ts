/**
 * `pwf mcp` as a client starts it: the built binary over stdio. Proves the
 * server answers on stdout with nothing else written there, and that the
 * lazily loaded entry resolves from dist. Skips when the CLI is not built.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { describe, expect, it } from 'vitest'

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url))

describe.skipIf(!existsSync(BIN))('pwf mcp over stdio', () => {
  it('initializes, lists the tools and answers a call', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, 'mcp'], stderr: 'pipe' })
    const client = new Client({ name: 'stdio-test', version: '0.0.0' })
    await client.connect(transport)
    try {
      expect(client.getServerVersion()?.name).toBe('pwfabric')
      expect(client.getInstructions()).toContain('PWFabric')
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain('pwf_validate')
      const answer = (await client.callTool({ name: 'pwf_validate', arguments: { projectDir: 'relative' } })) as { isError?: boolean }
      expect(answer.isError).toBe(true)
    } finally {
      await client.close()
    }
  }, 30_000)
})
