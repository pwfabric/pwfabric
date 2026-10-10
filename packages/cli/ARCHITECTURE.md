# pwf — module boundaries

`pwf` is the PWFabric command line. It uses only the engine's packages
(`pwfabric-pack`, `pwfabric-compiler`, `pwfabric-contracts`, and the runner
and runtime bundles it serves). It never calls a hosted service.

| Folder | Owns | Writes to the registry |
| --- | --- | --- |
| `src/commands/` | one file per command (`create`, `validate`, `pack`, `add`, `run`, `dev`) and `registry.ts` | yes — append to `COMMANDS` |
| `src/dev/` | `pwf dev`: watcher, compile loop, envelope builder, HTTP server; implements `StartDevServer` from `dev/types.ts` | no (the `dev` command file in `commands/` calls it) |
| `src/host/` | local host for data and sign-in; implements `CreateLocalHost` from `host/types.ts` | no |
| `src/args.ts`, `src/index.ts`, `src/bin.ts` | argument parsing and dispatch | — |

Rules:

- A command returns an exit code and writes only through `CommandIO`.
- `dev/` depends on `host/types.ts`, never on `host/local-host.ts` directly;
  the `dev` command wires the two together.
- No network calls except to the local servers `pwf` itself starts.
- The package is `private`: it is not published under the company scope. Its
  public name is decided at migration.
