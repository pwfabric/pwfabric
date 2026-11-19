/**
 * `pwf mcp` — a local MCP server over stdio, for any MCP client.
 *
 * The server (and the MCP SDK under it) is imported only here, when the
 * command runs, so every other command starts without it.
 */
import type { Command } from './types.js'
import { UsageError, guard } from './lib/flags.js'

export const mcpCommand: Command = {
  name: 'mcp',
  summary: 'Serve the pwf tools to an MCP client (Claude Code, Cursor, VS Code, Gemini CLI, …) over stdio',
  usage: `pwf mcp

Runs a Model Context Protocol server on stdin/stdout. An MCP client starts it
as a local (stdio) server with the command \`pwf\` and the argument \`mcp\`
(or \`npx -y @pwfabric/cli mcp\`). It serves tools that create apps and packs,
add packs and blocks, describe, validate, build and pack a folder, each
taking the project folder as an absolute path and writing only inside it.
It needs no account and no network, and starts no dev server: run
\`pwf dev\` in a terminal to preview.`,
  run: (args, io) =>
    guard('mcp', io, async () => {
      if (args.positionals.length > 0) throw new UsageError(`unexpected argument "${args.positionals[0]}"`)
      const [{ serveStdio }, { cliVersion }] = await Promise.all([import('../mcp/index.js'), import('../version.js')])
      await serveStdio({ version: cliVersion() })
      return 0
    }),
}
