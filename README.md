# ctxman

A local context manager for agentic coding: knowledge bundles, work items, skills, external references and
reusable contexts, kept as files in your own data directory and served by a local web app that also exposes
an MCP server.

## MCP setup

ctxman embeds a [Model Context Protocol](https://modelcontextprotocol.io) server at `POST /mcp` on the same
local web server as the pages. No extra process or port is needed.

### 1. Run ctxman

Point `CTXMAN_DATA_DIR` at your data directory (a `.env` file at the repo root works too, see
`.env.example`), then start the app:

```bash
pnpm install
CTXMAN_DATA_DIR=/absolute/path/to/your/ctxman-data pnpm run dev      # dev server
# or a production build
pnpm run build && CTXMAN_DATA_DIR=/absolute/path/to/your/ctxman-data pnpm run start
```

The app listens on `http://127.0.0.1:4321`; the MCP endpoint is `http://127.0.0.1:4321/mcp`.

### 2. Register the server in your agent

Claude Code (choose the scope you want: `local` is the default, `project` writes `.mcp.json`, `user`
applies everywhere):

```bash
claude mcp add --transport http ctxman http://127.0.0.1:4321/mcp
claude mcp add --transport http --scope project ctxman http://127.0.0.1:4321/mcp
```

Or add it to a project `.mcp.json` by hand:

```json
{
  "mcpServers": {
    "ctxman": { "type": "http", "url": "http://127.0.0.1:4321/mcp" }
  }
}
```

Other clients (Codex, Cursor, ...): configure an HTTP (Streamable HTTP) MCP server with the same URL.

### 3. What the server offers

- **Read tools**: `search`, `list-datasets`, `list-entries`, `get-entry`, `list-bundle-files`,
  `read-bundle-file`, `get-context`, `render-recipe` (a full Context Inflate brief), `check-data`.
- **Write tools**: `create-entry`, `patch-entry`, `append-context-links`, `append-log`. They change files in
  the data directory immediately.
- **Resources**: `ctxman://{dataset}/{slug}` (an entry) and `ctxman://{dataset}/{slug}/doc/{+path}` (a file
  of a bundle).

The endpoint is unauthenticated and accepts loopback hosts only (`127.0.0.1`, `localhost`, `[::1]`). While
`CTXMAN_DATA_DIR` is unset or unusable it answers `503 {"error":"data-dir"}`.

Full details, including every tool's inputs, live in the kb concept `tests/data/kb/ctxman/concepts/mcp.md`
(also served by the app at `/kb/ctxman/doc/concepts/mcp`).
