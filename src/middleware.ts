// Astro middleware: while the data directory is not usable (CTXMAN_DATA_DIR unset, missing or not a directory)
// every request answers 503 (JSON for /api/* and /mcp, a small instructions page elsewhere). Imports no astro:*
// module besides the middleware helper, so the check itself is plain node.
import { defineMiddleware } from 'astro:middleware';
import { dataDirStatus } from './lib/data-dir.ts';
import type { DataDirStatus } from './lib/data-dir.ts';
import { json } from './lib/http.ts';

const STATUS_TTL_MS = 2000;
let cached: { at: number; status: DataDirStatus } | undefined;
let logged = false;

function currentStatus(): DataDirStatus {
  const now = Date.now();
  if (cached === undefined || now - cached.at >= STATUS_TTL_MS) {
    cached = { at: now, status: dataDirStatus() };
  }
  return cached.status;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/');
}

function instructionsPage(message: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ctxman: data directory required</title>
<style>
  body { margin: 0; padding: 3rem 1.5rem; background: #0b0d12; color: #d8dce6; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1.25rem; color: #fcee09; }
  pre { padding: 1rem; background: #151923; border: 1px solid #2a3040; white-space: pre-wrap; }
  code { font-family: ui-monospace, Menlo, monospace; }
</style>
</head>
<body>
<main>
<h1>ctxman needs a data directory</h1>
<pre>${escapeHtml(message)}</pre>
<p>Fix it in one of two ways, then restart the server:</p>
<ol>
<li>Export the variable: <code>CTXMAN_DATA_DIR=/path/to/data pnpm run dev</code></li>
<li>Create a <code>.env</code> file at the repo root (see <code>.env.example</code>) containing <code>CTXMAN_DATA_DIR=/path/to/data</code>.</li>
</ol>
</main>
</body>
</html>
`;
  return new Response(html, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const onRequest = defineMiddleware((context, next) => {
  const status = currentStatus();
  if (!status.ok) {
    if (isApiPath(context.url.pathname)) {
      return json({ error: 'data-dir', message: status.message }, 503);
    }
    return instructionsPage(status.message);
  }
  if (!logged) {
    logged = true;
    console.log(`[ctxman] data dir: ${status.dir}`);
  }
  return next();
});
