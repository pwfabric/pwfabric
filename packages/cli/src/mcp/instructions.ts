/**
 * What every MCP client is told about this server, in the `instructions` of
 * its initialize answer. It is the only guide a client gets: nothing here may
 * assume a plugin, a skill or a particular assistant.
 */
export const SERVER_INSTRUCTIONS = `PWFabric is an open engine for web apps. An app is a folder of JSON documents (pages called receipts, a plan, definitions) that places blocks from packs; pwf validates it, builds it into a static site, and packs it into a deterministic .pwpack archive. Everything here runs locally: no account and no network.

Order of work:
1. pwf_create_app makes an app folder on a foundation pack (its basic blocks, themes and shells). Download a foundation .pwpack from the open packs' releases, https://github.com/pwfabric/packs/releases, and pass its path. (pwf_create_pack makes a pack folder instead, for authoring blocks.)
2. pwf_describe_project shows what the folder holds and which blocks (with their props) the pinned packs offer. Call it before writing a page.
3. Edit the files yourself: app/surfaces/<page>.receipt.json places blocks with props; app/plan.json holds the app's messages. pwf_add_pack installs another .pwpack; pwf_add_block writes a new block of the folder's own.
4. pwf_validate after every change; fix each error by its code and path.
5. pwf_build writes the static site; pwf_pack writes the .pwpack.

Rules:
- The app writes every word. Blocks hold no default text: every heading, label, button and message the visitor reads is set in the receipts or in app/plan.json messages. A missing text is a validation finding (MESSAGES_MISSING, BLOCK_DEFAULT_COPY), never filled in by the engine.
- Every tool takes projectDir, an absolute path, and writes only inside it.
- To preview, ask the user to run \`pwf dev\` in a terminal in the project folder (it serves the app and rebuilds on change); these tools never start a server.

PWFabric was built for PhiWebs (https://phiwebs.com), which hosts and publishes PWFabric apps; \`pwf login\` signs the CLI in to it. None of the tools above needs it.`
