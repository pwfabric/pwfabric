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
 *
 * Next to the pwf_* tools it lists PhiWebs': the studio's tools when the user
 * is signed in (each call forwarded to the studio), else phiwebs_sign_in.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { SERVER_INSTRUCTIONS } from './instructions.js'
import { PhiwebsTools, publishPackTool, SIGN_IN_TOOL, type PhiwebsToolsOptions } from './phiwebs.js'
import { ADD_PACK_TOOL, addPackTool, TOOLS, type ToolAnswer, type ToolDefinition } from './tools.js'

export { SERVER_INSTRUCTIONS } from './instructions.js'
export { addPackTool, TOOLS, failureAnswer, type ToolAnswer, type ToolDefinition } from './tools.js'
export { PhiwebsTools, publishPackTool, SIGN_IN_TOOL, type PhiwebsToolsOptions, type RemoteTool } from './phiwebs.js'

export interface PwfMcpServerOptions {
  /** The version the server reports; `pwf mcp` passes the CLI's. */
  readonly version: string
  /** The tools to serve; default {@link TOOLS}. */
  readonly tools?: readonly ToolDefinition[]
  /**
   * Where the PhiWebs session lives; `pwf mcp` passes the process's
   * environment. Absent: the server lists the local tools only.
   */
  readonly phiwebs?: PhiwebsToolsOptions
  /**
   * Serve the local tools only (pwf_*, pwf_publish_pack included): no studio
   * tools and no phiwebs_sign_in, for a client that connects to the studio's
   * MCP endpoint itself.
   */
  readonly localOnly?: boolean
}

/** A local tool as `tools/list` lists it: its input schema as JSON Schema. */
function listed(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(z.object(tool.inputSchema), { target: 'draft-7', io: 'input' }),
    annotations: {
      title: tool.title,
      readOnlyHint: tool.readOnly,
      destructiveHint: false,
      idempotentHint: tool.readOnly,
      openWorldHint: false,
    },
  }
}

async function runLocal(tool: ToolDefinition, args: unknown): Promise<ToolAnswer> {
  const parsed = await z.object(tool.inputSchema).safeParseAsync(args ?? {})
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Input validation error: Invalid arguments for tool ${tool.name}: ${z.prettifyError(parsed.error)}` }],
    }
  }
  try {
    return await tool.run(parsed.data as Record<string, unknown>)
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: (e as Error).message }] }
  }
}

/** A server with the pwf tools (and, given `phiwebs`, PhiWebs'), not yet connected to a transport. */
export function createPwfMcpServer(options: PwfMcpServerOptions): Server {
  // With a PhiWebs session, pwf_add_pack also takes a PhiWebs pack id.
  const phiwebsOptions = options.phiwebs
  const base = (options.tools ?? TOOLS).map((t) => (phiwebsOptions && t.name === ADD_PACK_TOOL ? addPackTool(phiwebsOptions) : t))
  const tools = [...base, ...(phiwebsOptions ? [publishPackTool(phiwebsOptions)] : [])]
  const local = new Map(tools.map((t) => [t.name, t]))
  const phiwebs = options.phiwebs && !options.localOnly ? new PhiwebsTools(options.phiwebs, new Set(local.keys())) : null
  const server = new Server(
    { name: 'pwfabric', title: 'PWFabric', version: options.version },
    { capabilities: { tools: { listChanged: true } }, instructions: SERVER_INSTRUCTIONS }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.map(listed), ...(phiwebs ? await phiwebs.list() : [])],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const tool = local.get(name)
    if (tool) return runLocal(tool, args)
    if (phiwebs && name === SIGN_IN_TOOL) {
      const { answer, changed } = await phiwebs.signIn()
      if (changed) await server.sendToolListChanged().catch(() => {})
      return answer
    }
    const forwarded = phiwebs ? await phiwebs.call(name, (args ?? {}) as Record<string, unknown>) : null
    if (forwarded) return forwarded
    throw new McpError(ErrorCode.InvalidParams, `Tool ${name} not found`)
  })
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
