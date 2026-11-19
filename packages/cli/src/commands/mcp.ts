/**
 * `pwf mcp` — a local MCP server over stdio, for any MCP client.
 *
 * The server (and the MCP SDK under it) is imported only here, when the
 * command runs, so every other command starts without it.
 */
import type { Command } from './types.js'
import { UsageError, boolFlag, guard, stringFlag } from './lib/flags.js'
import { SERVER_HELP } from './login.js'

export const mcpCommand: Command = {
  name: 'mcp',
  summary: 'Serve the pwf tools to an MCP client (Claude Code, Cursor, VS Code, Gemini CLI, …) over stdio',
  usage: `pwf mcp [--local-only] [--server <url>]

  --local-only     serve the local tools only: no PhiWebs studio tools and no
                   phiwebs_sign_in (for a client that connects to the studio's
                   MCP endpoint itself)
${SERVER_HELP}

Runs a Model Context Protocol server on stdin/stdout. An MCP client starts it
as a local (stdio) server with the command \`pwf\` and the argument \`mcp\`
(or \`npx -y @pwfabric/cli mcp\`). It serves tools that create apps and packs,
add packs and blocks, describe, validate, build and pack a folder, each
taking the project folder as an absolute path and writing only inside it.
They need no account and no network, and start no dev server: run
\`pwf dev\` in a terminal to preview.

Signed in with \`pwf login\`, it also lists the PhiWebs studio's tools (build
and change an app with the studio's AI, preview, publish) and forwards each
call to the studio as you. Not signed in, one tool, phiwebs_sign_in, says
how to sign in and what PhiWebs adds. pwf_publish_pack sends a local pack
folder to the PhiWebs marketplace (signed in, as your workspace's publisher);
it is local work, so --local-only keeps it.`,
  run: (args, io) =>
    guard('mcp', io, async () => {
      if (args.positionals.length > 0) throw new UsageError(`unexpected argument "${args.positionals[0]}"`)
      const server = stringFlag(args, 'server')
      const [{ serveStdio }, { cliVersion }] = await Promise.all([import('../mcp/index.js'), import('../version.js')])
      await serveStdio({ version: cliVersion(), phiwebs: { env: io.env, ...(server ? { server } : {}) }, localOnly: boolFlag(args, 'local-only') })
      return 0
    }),
}
