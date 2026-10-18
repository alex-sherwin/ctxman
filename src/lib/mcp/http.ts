// SERVER (no astro:*): the Streamable HTTP face of /mcp (plans/CORE_REFACTOR_PLAN.md §8, plans/MCP_SDK_NOTES.md).
// Stateless: a fresh McpServer (server.ts) serves each request. 2025-era clients get one-event SSE answers,
// 2026-07-28 clients plain JSON; GET / DELETE answer the SDK's 405, a wrong content type 415, a 2025-era POST
// without `Accept: application/json, text/event-stream` 406. The SDK handler does no Host / Origin check itself:
// both are validated here against loopback (403 otherwise; an absent Origin passes, as MCP clients send none).
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { DataDirError } from '../data-dir.ts';
import { createMcpServer } from './server.ts';
import { buildToolContext } from './tools.ts';
import type { ToolContext } from './tools.ts';

/** Builds the tool context of one request; the default reads `CTXMAN_DATA_DIR` (throws DataDirError when unset). */
export type ToolContextFactory = () => ToolContext;

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Serves one MCP HTTP request. `ctxFactory` lets tests point the tools at a temp corpus; production passes
 * nothing (the data dir comes from the environment per request, so a changed env or a new write is seen at once).
 */
export async function handleMcpRequest(
  request: Request,
  ctxFactory: ToolContextFactory = buildToolContext,
): Promise<Response> {
  const rejected =
    hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
    originValidationResponse(request, localhostAllowedOrigins());
  if (rejected) return rejected;

  let ctx: ToolContext;
  try {
    ctx = ctxFactory();
  } catch (error) {
    if (error instanceof DataDirError) return jsonError(503, 'data-dir', error.message);
    throw error;
  }
  // The handler is cheap to build; making it per request lets the factory close over this request's context.
  const handler = createMcpHandler(() => createMcpServer(ctx), {
    onerror: (error) => console.warn('[mcp]', error.message),
  });
  return handler.fetch(request);
}
