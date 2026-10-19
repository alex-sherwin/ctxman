---
type: Feature Guide
title: MCP server
description: The embedded Model Context Protocol server at POST /mcp - client setup, the tools, the resources, safety and limits.
tags: [mcp, agents, api, tools]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-18T09:30:00Z
---

# MCP server

ctxman embeds a [Model Context Protocol](https://modelcontextprotocol.io) server so a coding agent can search, read and update the data directly, without scraping pages or calling the JSON API by hand. It is part of the normal ctxman process: no extra port, no extra command, and it needs the same `CTXMAN_DATA_DIR` (see [Runtime modes](/concepts/runtime-modes.md)). While the data directory is unusable the endpoint answers 503 `{ "error": "data-dir" }`.

## Connecting a client

Start ctxman (`pnpm run dev` or `pnpm run start`), then point the client at `http://127.0.0.1:4321/mcp`.

Claude Code:

```bash
claude mcp add --transport http ctxman http://127.0.0.1:4321/mcp
```

(add `--scope project` to share it, `local` or `user` otherwise), or in a project `.mcp.json`:

```json
{ "mcpServers": { "ctxman": { "type": "http", "url": "http://127.0.0.1:4321/mcp" } } }
```

Project servers need approval in interactive sessions. Codex and other clients: use their HTTP MCP server configuration with the same URL. If ctxman runs on another port, change the URL (and `CTXMAN_SERVER_ORIGIN`, which only affects the YAML modelines).

## Transport

* `POST /mcp`, Streamable HTTP, **stateless**: a fresh handler and server instance answer each request (the data directory is resolved per request too; an unusable one is the 503 above), there are no sessions and nothing to clean up. The server advertises `tools` and `resources` without list-change notifications. It is served by the same Astro server as the pages (`src/pages/mcp.ts` is one line; the logic is `src/lib/mcp/`).
* Clients of the 2026-07-28 protocol get plain JSON answers; 2025-era clients that send `initialize` get one-event SSE answers (both are spec-compliant and clients accept either). A 2025-era POST needs `Accept: application/json, text/event-stream` (otherwise 406) and `Content-Type: application/json` (otherwise 415). `GET` and `DELETE` answer the SDK's 405 JSON-RPC error.
* The `Host` header must be loopback (`localhost`, `127.0.0.1`, `[::1]`) and an `Origin` header, when present, too; otherwise 403. A request without `Origin` (what MCP clients send) passes. There is no authentication: the endpoint is for the local machine only.
* The SDK is `@modelcontextprotocol/server` 2.3.1. Tool inputs are arktype Types (Standard Schema); the SDK validates arguments and answers `isError: true` with "Input validation error: ..." for bad input. zod is not used by ctxman code.

## Tools

Names are kebab-case. Every tool returns markdown text and also `structuredContent` (JSON) so an agent can parse it. List-like tools take `limit` (default 20, at most 200). Dataset ids are the twelve from [Datasets](/concepts/datasets.md).

| Tool | Input | Returns |
| --- | --- | --- |
| `search` | `query` (at least 2 characters), `datasets?`, `limit?` | Ranked hits with `dataset`, `slug`, `path`, `title`, `description`, `url`, `resource` (the `ctxman://` URI), `score` (1 minus the fuse.js score, so higher is better, rounded to 3 decimals) and a snippet of at most 200 characters; the same fuse.js options as the [search](/concepts/search.md) widget over the same index |
| `list-datasets` | none | The registry: id, label, kind, states, entry file and entry count |
| `list-entries` | `dataset`, `q?`, `state?`, `tag?`, `project?`, `type?` (reference type), `sort?` (`modified`, `name`, `state`), `limit?` | Entry summaries, filtered and sorted like the list pages (`project` = the children of that project) |
| `get-entry` | `dataset`, `slug`, `includeBody?` (default true) | Frontmatter and body (okf, skill), the YAML data (reference, snippet, context, recipe; a snippet's markdown also as text after the data), relations (links to, linked from, children, parents), bundle files, the contexts that link the entry, url, resource URI, last modified; a context comes with its resolved links, a recipe with its contexts and items. A body over 50 KB is clipped (`bodyTruncated`) with a note pointing at `read-bundle-file` |
| `list-bundle-files` | `dataset` (okf or `skill`), `slug` | The files of the entry folder |
| `read-bundle-file` | `dataset`, `slug`, `path`, `offset?` | The text of one file of the folder (traversal is refused; 512 KB cap) and its last modified; 50 KB per call, `nextOffset` in `structuredContent` when there is more |
| `get-context` | `slug` | The context with resolved links: titles, states, missing flags and notes |
| `render-recipe` | `recipe` (a saved recipe name) OR an ad hoc `contexts`, `items`, `target`, `layout`, `preamble` (one or the other, never both); `offset?` | The [Context inflate](/concepts/context-inflate.md) document markdown as text (50 KB per call, paged with `offset`); `structuredContent` carries the manifest summary (counts, contexts, segments), warnings, size, `offset` and `total`, not the document. Never writes a file; an ad hoc render is named `mcp-adhoc` |
| `check-data` | `scope?` (`okf`, `links`, `collections`) | The findings of the [compliance checks](/concepts/compliance-checks.md), computed in process |
| `create-entry` | `dataset`, `name`, `description`, `title?`, `state?`, `tags?`, `parent?` (a project that gets a `child` link); references add `type`, `path` or `uri`, `subpath?`, `owner`; snippets add `markdown?` (default: a `TODO:` placeholder) | Creates an entry from the same templates as the add scripts and the `/new/<dataset>` forms; returns the summary, files and url |
| `patch-entry` | `dataset` (okf or skill), `slug`, `state?`, `title?`, `description?`, `tags?`, `addLinks?`, `removeLinks?` | The same range-based frontmatter edit as `PATCH /api/entry`; a result that fails the schema is refused and nothing is written |
| `append-context-links` | `slug`, `links: [{dataset, slug, notes?}]` | Appends to a context; answers which links were `added` and which `skipped` |
| `append-log` | `dataset` (okf), `slug`, `text` (at most 1000 characters) | Adds a bullet under today's `## YYYY-MM-DD` heading (local date) of the entry's `log.md` (a new heading when the top one is not today, the file when missing); returns the new top of the log |

The last four are the **write tools**. They act immediately on the files in the data directory, with no `ifUnmodifiedSince` (the last write wins), and clear the entry index, so the next read, in the UI or through MCP, shows the change. Open browser pages show it after a reload.

Results are kept compact: text over 50 KB is clipped with a note and, where the tool pages, a `nextOffset`; search snippets are at most 200 characters. Claude Code warns above 10k tokens of tool output and caps it at 25k. URLs in results are absolute (`CTXMAN_SERVER_ORIGIN` plus the page path). A failure is `isError: true` with the text `code: message` and `structuredContent` `{ error, message, issues? }`; the codes are those of the io modules (`not-found`, `invalid`, `exists`, `bad-path`, `too-large`, `not-text`, `conflict`, `data-dir`, `internal`, `unknown-tool`). No tool declares an `outputSchema`, so `structuredContent` is not validated by the SDK.

## Resources

* `ctxman://{dataset}/{slug}`: the entry (`text/markdown` for okf and skill, frontmatter plus body as on disk; `application/yaml` for reference, snippet, context and recipe).
* `ctxman://{dataset}/{slug}/doc/{+path}`: one file of a bundle or skill folder (`text/markdown` for `.md`, `text/plain` otherwise).

`resources/list` enumerates every entry, invalid files included (`uri`, `name` = title or slug, `description`, `mimeType`); `resources/templates/list` lists the two templates above; `resources/read` returns the content. A missing entry or file is the protocol's resource-not-found error, and a path that escapes the folder returns nothing.

## Suggested use

The server's `instructions` tell an agent: search first, then `get-entry`; `read-bundle-file` for individual concepts of a knowledge base; `render-recipe` for a complete session brief; the write tools are available and immediate. To record work, `create-entry` (with `parent` for a task under a project), then `patch-entry` to change its state, and `append-log` for a dated note.

## Where it lives

`src/lib/mcp/tools.ts` (tool definitions and handlers, plain functions over the library modules), `resources.ts`, `server.ts` (the `McpServer` factory) and `http.ts` (`handleMcpRequest`: Host and Origin checks, then the SDK handler). All are Server-kind modules that import no `astro:*`, so unit tests drive them directly and `pnpm run test:prod` exercises `initialize` and `tools/list` against the built server. See [Architecture](/concepts/architecture.md) for the layering and [Routes and API](/concepts/routes-and-api.md) for the status codes.
