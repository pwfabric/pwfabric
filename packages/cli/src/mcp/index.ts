/**
 * `@pwfabric/cli/mcp` — the local MCP server `pwf mcp` runs.
 *
 * The only module that loads the MCP SDK; `pwf mcp` imports it on demand, so
 * no other command pays for it. It serves tools only (no sampling,
 * elicitation, resource subscriptions or progress notifications), because
 * those are what MCP clients differ on: every client that lists and calls
 * tools can use all of it. What a client needs to use the tools well comes
 * from here — the server instructions, each tool's description, and each
 * answer's next step.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SERVER_INSTRUCTIONS } from './instructions.js'
import { TOOLS, type ToolDefinition } from './tools.js'

export { SERVER_INSTRUCTIONS } from './instructions.js'
export { TOOLS, failureAnswer, type ToolAnswer, type ToolDefinition } from './tools.js'

export interface PwfMcpServerOptions {
  /** The version the server reports; `pwf mcp` passes the CLI's. */
  readonly version: string
  /** The tools to serve; default {@link TOOLS}. */
  readonly tools?: readonly ToolDefinition[]
}

/** A server with the pwf tools registered, not yet connected to a transport. */
export function createPwfMcpServer(options: PwfMcpServerOptions): McpServer {
  const server = new McpServer({ name: 'pwfabric', title: 'PWFabric', version: options.version }, { instructions: SERVER_INSTRUCTIONS })
  for (const tool of options.tools ?? TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          idempotentHint: tool.readOnly,
          openWorldHint: false,
        },
      },
      (input: Record<string, unknown>) => tool.run(input)
    )
  }
  return server
}

/**
 * Serves the tools over stdio until the client closes the connection.
 * stdout carries the protocol only; nothing else may write to it.
 */
export async function serveStdio(options: PwfMcpServerOptions): Promise<void> {
  const server = createPwfMcpServer(options)
  const transport = new StdioServerTransport()
  const closed = new Promise<void>((done) => {
    transport.onclose = () => done()
  })
  await server.connect(transport)
  await closed
}
