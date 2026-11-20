# pwf — module boundaries

`pwf` is the PWFabric command line. It uses only the engine's packages
(`pwfabric-pack`, `pwfabric-compiler`, `pwfabric-contracts`, and the runner
and runtime bundles it serves). Only `login`, `logout` and `whoami` call a
hosted service (PhiWebs, at the address they are given).

| Folder | Owns | Writes to the registry |
| --- | --- | --- |
| `src/commands/` | one file per command (`create`, `validate`, `pack`, `add`, `run`, `dev`) and `registry.ts` | yes — append to `COMMANDS` |
| `src/dev/` | `pwf dev`: watcher, compile loop, envelope builder, HTTP server; implements `StartDevServer` from `dev/types.ts` | no (the `dev` command file in `commands/` calls it) |
| `src/host/` | local host for data and sign-in; implements `CreateLocalHost` from `host/types.ts` | no |
| `src/mcp/` | `pwf mcp`: the MCP server and its tools, wrapping the command functions; the only importer of the MCP SDK, loaded on demand | no (the `mcp` command imports it lazily) |
| `src/phiwebs/` | signing in to PhiWebs: config folder and token store, OAuth (discovery, registration, PKCE, loopback), the session reader later PhiWebs tools use | no (`login.ts` in `commands/` calls it) |
| `src/args.ts`, `src/index.ts`, `src/bin.ts` | argument parsing and dispatch | — |

Rules:

- A command returns an exit code and writes only through `CommandIO`.
- `dev/` depends on `host/types.ts`, never on `host/local-host.ts` directly;
  the `dev` command wires the two together.
- No network calls except to the local servers `pwf` itself starts, and
  `src/phiwebs/` to the PhiWebs server the user signs in to.
- `src/mcp/` writes nothing to stdout itself: stdout is the protocol.
- The package is `private`: it is not published under the company scope. Its
  public name is decided at migration.
