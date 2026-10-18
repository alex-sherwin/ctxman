// /mcp: the embedded MCP server (Streamable HTTP, stateless). All methods go to the SDK handler, which answers
// POST and gives GET / DELETE its own 405 JSON-RPC error. See src/lib/mcp/http.ts.
import type { APIRoute } from 'astro';
import { handleMcpRequest } from '../lib/mcp/http.ts';

export const ALL: APIRoute = ({ request }) => handleMcpRequest(request);
