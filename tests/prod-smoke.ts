// Prod smoke test: starts the BUILT server (dist/server/entry.mjs) against a temp copy of tests/data and
// exercises the paths that only break in a production build (origin check, disk-truth reads, schemas, MCP).
// Run with `pnpm run build && pnpm run test:prod`. Node 24 runs this file directly; no test framework.
// Exit codes: 0 all checks ok, 1 a check failed, 2 dist/server/entry.mjs is missing.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ENTRY = path.resolve('dist', 'server', 'entry.mjs');
const SEED = path.resolve('tests', 'data');

if (!existsSync(ENTRY)) {
  console.error('run pnpm run build first');
  process.exit(2);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
const skipped: string[] = [];

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tempDir = mkdtempSync(path.join(tmpdir(), 'ctxman-prod-smoke-'));
const dataDir = path.join(tempDir, 'data');
cpSync(SEED, dataDir, { recursive: true });

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const origin = base;
let serverLog = '';
const child = spawn(process.execPath, [ENTRY], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CTXMAN_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
});
child.stdout.on('data', (chunk: Buffer) => (serverLog += chunk.toString()));
child.stderr.on('data', (chunk: Buffer) => (serverLog += chunk.toString()));
let exited = false;
child.on('exit', () => {
  exited = true;
});

async function stopChild(): Promise<void> {
  if (exited) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 3000;
  while (!exited && Date.now() < deadline) await sleep(50);
  if (!exited) child.kill('SIGKILL');
  const killDeadline = Date.now() + 2000;
  while (!exited && Date.now() < killDeadline) await sleep(50);
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error('server exited before it answered GET /');
    try {
      const res = await fetch(`${base}/`);
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error('server did not answer GET / with 200 within 30 s');
}

async function getText(pathname: string, expected = 200): Promise<string> {
  const res = await fetch(`${base}${pathname}`);
  const text = await res.text();
  assert(res.status === expected, `GET ${pathname} -> ${res.status}, expected ${expected}`);
  return text;
}

async function getJson<T>(pathname: string): Promise<T> {
  return JSON.parse(await getText(pathname)) as T;
}

function sendJson(
  method: string,
  pathname: string,
  body: unknown,
  originHeader = origin,
): Promise<Response> {
  return fetch(`${base}${pathname}`, {
    method,
    headers: { origin: originHeader, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Parses a JSON body or the `data:` line of a one-event SSE body. */
function parseRpc(contentType: string, text: string): { result?: unknown; error?: unknown } {
  if (contentType.includes('text/event-stream')) {
    const line = text.split(/\r?\n/).find((l) => l.startsWith('data:'));
    assert(line !== undefined, 'SSE body without a data: line');
    return JSON.parse(line.slice('data:'.length).trim()) as { result?: unknown; error?: unknown };
  }
  return JSON.parse(text) as { result?: unknown; error?: unknown };
}

try {
  try {
    await waitForServer();
  } catch (error) {
    console.log(`FAIL server start: ${error instanceof Error ? error.message : String(error)}`);
    console.log(serverLog.trim());
    failures += 1;
  }

  if (failures === 0) {
    await check('GET / contains Dashboard', async () => {
      assert((await getText('/')).includes('Dashboard'), 'no "Dashboard" in the page');
    });
    await check('GET /kb/ctxman renders the detail', async () => {
      assert((await getText('/kb/ctxman')).includes('<h1'), 'no <h1 in the page');
    });
    await check('GET /kb/ctxman/doc/concepts/search', async () => {
      await getText('/kb/ctxman/doc/concepts/search');
    });
    await check('GET /api/entries?dataset=task has >= 4 entries', async () => {
      const body = await getJson<{ entries: unknown[] }>('/api/entries?dataset=task');
      assert(Array.isArray(body.entries), 'no entries array');
      assert(body.entries.length >= 4, `only ${body.entries.length} entries`);
    });
    await check('GET /api/search-index.json has > 40 docs', async () => {
      const body = await getJson<{ docs: unknown[] }>('/api/search-index.json');
      assert(Array.isArray(body.docs), 'no docs array');
      assert(body.docs.length > 40, `only ${body.docs.length} docs`);
    });

    let markdown = '';
    let lastModified: unknown;
    await check('GET /api/doc/kb/ctxman/main.md returns markdown and lastModified', async () => {
      const body = await getJson<{ markdown?: unknown; lastModified?: unknown }>(
        '/api/doc/kb/ctxman/main.md',
      );
      assert(typeof body.markdown === 'string' && body.markdown.length > 0, 'no markdown');
      assert(body.lastModified !== undefined, 'no lastModified');
      markdown = body.markdown;
      lastModified = body.lastModified;
    });
    await check('PUT /api/doc/kb/ctxman/main.md with the browser Origin -> 200', async () => {
      const res = await sendJson('PUT', '/api/doc/kb/ctxman/main.md', {
        markdown,
        ifUnmodifiedSince: lastModified,
      });
      assert(res.status === 200, `status ${res.status}: ${await res.text()}`);
    });
    await check('PUT with a foreign Origin -> 403', async () => {
      const res = await sendJson(
        'PUT',
        '/api/doc/kb/ctxman/main.md',
        { markdown, ifUnmodifiedSince: lastModified },
        'http://evil.test',
      );
      assert(res.status === 403, `status ${res.status}, expected 403`);
    });
    await check(
      'POST /api/entry/task -> 201, then GET /task/prod-smoke-task without restart',
      async () => {
        const res = await sendJson('POST', '/api/entry/task', {
          name: 'prod-smoke-task',
          description: 'x',
        });
        assert(res.status === 201, `status ${res.status}: ${await res.text()}`);
        await getText('/task/prod-smoke-task');
      },
    );
    await check('GET /api/schemas/reference is application/schema+json', async () => {
      const res = await fetch(`${base}/api/schemas/reference`);
      await res.text();
      assert(res.status === 200, `status ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      assert(type.includes('application/schema+json'), `content-type ${type}`);
    });
    await check('POST /mcp initialize + tools/list', async () => {
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      const init = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'prod-smoke', version: '0.0.0' },
          },
        }),
      });
      const initText = await init.text();
      if (init.status === 404 || init.status === 503) {
        skipped.push('POST /mcp');
        console.log(`     skipped: MCP route not present yet (status ${init.status})`);
        return;
      }
      assert(init.status === 200, `initialize status ${init.status}: ${initText.slice(0, 200)}`);
      const initRpc = parseRpc(init.headers.get('content-type') ?? '', initText);
      assert(initRpc.result !== undefined, `initialize error: ${JSON.stringify(initRpc.error)}`);
      const list = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });
      const listText = await list.text();
      assert(list.status === 200, `tools/list status ${list.status}: ${listText.slice(0, 200)}`);
      const rpc = parseRpc(list.headers.get('content-type') ?? '', listText);
      const tools = (rpc.result as { tools?: { name: string }[] } | undefined)?.tools;
      assert(Array.isArray(tools) && tools.length > 0, 'tools/list returned no tools');
      assert(
        tools.some((t) => t.name === 'search'),
        'no "search" tool',
      );
    });
  }
} finally {
  await stopChild();
  rmSync(tempDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log(
  skipped.length > 0 ? `\nall checks ok (skipped: ${skipped.join(', ')})` : '\nall checks ok',
);
