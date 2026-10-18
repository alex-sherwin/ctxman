# MCP SDK facts for Phase 5 (verified 2026-10-18 against published packages; see CORE_REFACTOR_PLAN.md §8)

## Package
* Use **`@modelcontextprotocol/server@2.3.1`** (v2 line, spec 2026-07-28, still serves 2025-11-25 / 2025-06-18 / 2025-03-26 / 2024-11-05 clients). `@modelcontextprotocol/sdk` 1.x is the maintenance line; do not use it.
* Runtime deps: `zod ^4.2` (transitive only; OUR code never imports zod) and `@modelcontextprotocol/core`. ajv is bundled. `type: module`, node >= 20, `exports` map with import/require branches. Works under `astro dev`, the built node server and vitest with NO `vite.ssr.noExternal` / `optimizeDeps` changes. tsconfig needs `types: ["node"]` (already set).
* Added by the orchestrator with `pnpm add @modelcontextprotocol/server@2.3.1` and recorded in AGENTS.md.

## Route glue (verified end to end in a throwaway Astro 7.4 app, dev + built server)
```ts
// src/pages/mcp.ts
import type { APIRoute } from 'astro';
import {
  createMcpHandler, hostHeaderValidationResponse, localhostAllowedHostnames,
  localhostAllowedOrigins, originValidationResponse,
} from '@modelcontextprotocol/server';
import { createMcpServer } from '../lib/mcp/server.ts';

// Handler once per process; the factory runs once per HTTP request (stateless: a transport/server pair may not be reused).
const handler = createMcpHandler(() => createMcpServer(), { onerror: (e) => console.warn('[mcp]', e.message) });

export const ALL: APIRoute = async ({ request }) =>
  hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??   // 403 unless Host is localhost/127.0.0.1/[::1] (port ignored)
  originValidationResponse(request, localhostAllowedOrigins()) ??         // 403 when an Origin header is present and not loopback; absent passes
  handler.fetch(request);
```
* `createMcpHandler(factory, { legacy?: 'stateless' | 'reject' (default stateless), responseMode?: 'auto' | 'sse' | 'json' (default auto), onerror?, keepAliveMs?, maxRequestBodySize? })`; `handler.fetch(request, { parsedBody?, authInfo? }): Promise<Response>`.
* Era detection is automatic: requests with a `_meta` envelope -> 2026-07-28 path (plain `application/json` answers, no sessions, no `initialize`; the client probes with `server/discover`); everything else -> 2025 stateless fallback (`initialize` works, no `Mcp-Session-Id` issued, answers are ONE-event `text/event-stream`; GET/DELETE answer 405 `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}`). Keep `responseMode` default (`'json'` prints a console.warn). Clients MUST accept both content types, so tests that post raw legacy JSON-RPC must parse either `application/json` or the `data:` line of the SSE body.
* 2025-era POST needs `Accept: application/json, text/event-stream` (406 otherwise) and `content-type: application/json` (415 otherwise). 2026 era requires `MCP-Protocol-Version`, `Mcp-Method` and, for tools/call / resources/read, `Mcp-Name` headers (SDK enforces, clients send them).
* The handler does no Origin/Host checks itself: the two helper calls above are required (the built server does not block foreign Host headers; `astro dev` does).

## Server factory: high-level `McpServer` + arktype as Standard Schema (recommended; not deprecated; SDK validates)
```ts
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { type } from 'arktype';

const GetEntryInput = type({ '+': 'reject', dataset: type.enumerated(...LINKABLE_DATASETS), slug: NAME_PATTERN_TYPE, 'includeBody?': 'boolean' }).describe('…');

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'ctxman', version }, { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS });
  server.registerTool('get-entry', {
    title: 'Get entry', description: '…',
    inputSchema: GetEntryInput,          // arktype Type: `~standard.validate` + `~standard.jsonSchema` (draft 2020-12)
    // outputSchema?: Type               // when given, `structuredContent` MUST be present and is validated by the SDK
    annotations: { readOnlyHint: true },
  }, async (args) => ({ content: [{ type: 'text', text: markdown }], structuredContent: json }));   // args typed from the arktype Type
  server.registerResource('entry', new ResourceTemplate('ctxman://{dataset}/{slug}', { list: async () => ({ resources: [...] }) }),
    { mimeType: 'text/markdown' }, async (uri, vars) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }));
  return server;
}
```
* Invalid arguments come back from the SDK as `isError: true` "Input validation error: …" (tool execution error, never a protocol error). Unknown tool -> the SDK answers; nothing to do.
* **arktype `toJsonSchema` THROWS on predicates** (`.narrow()`, `string.date.parse`, custom narrows). Tool input Types may only use JSON-Schema-expressible constraints: enums (`type.enumerated`), regex (`type(/re/)`), string/number ranges, arrays, optional keys, `'+': 'reject'` (-> `additionalProperties: false`), `.describe()` (-> `description`). Reuse `NAME_PATTERN` as a regex, NOT the narrowed `nameSchema`. Validate anything predicate-like inside the handler.
* Tool names: 1–128 chars of `[A-Za-z0-9_.-]` (kebab-case as in the plan is fine). A tool without parameters: `type({ '+': 'reject' })`.
* Resource templates are RFC 6570: `ctxman://{dataset}/{slug}` and `ctxman://{dataset}/{slug}/doc/{+path}` (the `{+path}` form matches slashes; `{/path*}` does not). `resources/list` returns `{ resources: [{ uri, name, mimeType?, description? }] }`; `resources/read` returns `{ contents: [{ uri, mimeType, text }] }`.
* Low-level alternative (only if needed): `import { Server } from '@modelcontextprotocol/server'` is `@deprecated`; handlers by method string `setRequestHandler('tools/list', …)`; `inputSchema` as a JSON Schema object (`T.in.toJsonSchema({ fallback: { predicate: c => c.base, morph: c => c.base } })`); the SDK then validates neither arguments nor structuredContent.

## Client setup to document (Phase 6)
* Claude Code: `claude mcp add --transport http ctxman http://127.0.0.1:4321/mcp` (`--scope local|project|user`), or `.mcp.json`: `{ "mcpServers": { "ctxman": { "type": "http", "url": "http://127.0.0.1:4321/mcp" } } }` (optional `headers`, `timeout`). Project servers need approval in interactive sessions. Output limits: warning above 10k tokens, cap 25k (`MAX_MCP_OUTPUT_TOKENS`), results over 50k characters are saved to a file — keep tool results compact (`limit` defaults, truncate bodies with a note).
* Codex / other clients: their HTTP MCP configuration pointing at the same URL.

## Testing approach
* `tests/unit/mcp-tools.test.ts`: call our tool handler functions directly (export them from `src/lib/mcp/tools.ts` as plain async functions taking validated args + `{ dataDir, nowMs }`), against `copyCorpus()` temp dirs; assert markdown text AND `structuredContent`.
* `tests/unit/mcp-http.test.ts`: build the route-level function (`handleMcpRequest(request)` in `src/lib/mcp/http.ts`, which wraps the three calls shown in the route glue so the Astro route is a one-liner) and post raw 2025-era JSON-RPC: `initialize` -> result with `serverInfo.name === 'ctxman'`; `tools/list` -> every plan tool present with `inputSchema.type === 'object'`; `tools/call search` -> result; bad `content-type` -> 415; GET -> 405; `Origin: http://evil.test` -> 403; `Host: evil.test` -> 403. Parse `application/json` or the SSE `data:` line.
* `tests/prod-smoke.ts`: the same `initialize` + `tools/list` round trip against the built server.
