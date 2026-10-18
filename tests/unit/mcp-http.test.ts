// The /mcp HTTP face (src/lib/mcp/http.ts) driven with raw 2025-era JSON-RPC against a copy of the corpus.
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { invalidateEntryIndex } from '../../src/lib/entry-index.ts';
import { handleMcpRequest } from '../../src/lib/mcp/http.ts';
import { TOOLS } from '../../src/lib/mcp/tools.ts';
import type { ToolContext } from '../../src/lib/mcp/tools.ts';
import { cleanupCorpus, copyCorpus } from './fixtures/corpus.ts';

let dir: string;
let ctx: ToolContext;
const factory = (): ToolContext => ctx;

beforeEach(() => {
  dir = copyCorpus();
  invalidateEntryIndex();
  ctx = { dataDir: dir, nowMs: Date.now(), serverOrigin: 'http://127.0.0.1:4321' };
});

afterEach(() => {
  invalidateEntryIndex();
  cleanupCorpus();
});

const URL_ = 'http://127.0.0.1:4321/mcp';
const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  host: '127.0.0.1:4321',
};

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return handleMcpRequest(
    new Request(URL_, {
      method: 'POST',
      headers: { ...HEADERS, ...headers },
      body: JSON.stringify(body),
    }),
    factory,
  );
}

/** A JSON-RPC answer from either `application/json` or the `data:` line of a one-event SSE body. */
async function rpc(response: Response): Promise<{ result?: any; error?: any; id?: unknown }> {
  const raw = await response.text();
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('text/event-stream')) {
    const line = raw.split('\n').find((l) => l.startsWith('data:'));
    expect(line, raw).toBeDefined();
    return JSON.parse(line!.slice('data:'.length).trim());
  }
  return JSON.parse(raw);
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'vitest', version: '0.0.0' },
  },
};

const call = (name: string, args: unknown, id = 3) =>
  post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

describe('POST /mcp (2025-era JSON-RPC)', () => {
  it('initializes as ctxman with tools, resources and instructions', async () => {
    const response = await post(INIT);
    expect(response.status).toBe(200);
    const { result } = await rpc(response);
    expect(result.serverInfo.name).toBe('ctxman');
    expect(result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.capabilities.tools).toBeDefined();
    expect(result.capabilities.resources).toBeDefined();
    // stateless: the lists never change under a client
    expect(result.capabilities.tools.listChanged).toBe(false);
    expect(result.instructions).toContain('search');
    expect(result.instructions).toContain('append-log');
  });

  it('lists every tool with an object input schema and read-only hints', async () => {
    const { result } = await rpc(await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    const tools = result.tools as {
      name: string;
      description: string;
      inputSchema: { type: string };
      annotations?: { readOnlyHint?: boolean };
    }[];
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.description.length).toBeGreaterThan(20);
    }
    expect(tools.find((t) => t.name === 'search')!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'create-entry')!.annotations?.readOnlyHint).toBe(false);
  });

  it('calls search and get-entry', async () => {
    const found = (await rpc(await call('search', { query: 'inflate' }))).result;
    expect(found.isError).not.toBe(true);
    expect(found.content[0].type).toBe('text');
    expect(found.content[0].text).toContain('result(s) for "inflate"');
    expect(found.structuredContent.count).toBeGreaterThan(0);

    const entry = (await rpc(await call('get-entry', { dataset: 'kb', slug: 'ctxman' }))).result;
    expect(entry.structuredContent.frontmatter.name).toBe('ctxman');
    expect(entry.content[0].text).toContain('# ');
  });

  it('writes through a tool and reads it back', async () => {
    const created = (
      await rpc(
        await call('create-entry', {
          dataset: 'task',
          name: 'http-made',
          description: 'Via HTTP.',
        }),
      )
    ).result;
    expect(created.isError).not.toBe(true);
    const listed = (await rpc(await call('list-entries', { dataset: 'task', q: 'http-made' })))
      .result;
    expect(listed.structuredContent.total).toBe(1);
  });

  it('answers bad tool arguments with isError, not a protocol error', async () => {
    const response = await rpc(await call('get-entry', { dataset: 'nope', slug: 'x' }));
    expect(response.error).toBeUndefined();
    expect(response.result.isError).toBe(true);
    const unknown = await rpc(await call('search', { query: 'x', extra: true }));
    expect(unknown.result.isError).toBe(true);
  });

  it('serves resource templates, a listing and reads', async () => {
    const templates = (
      await rpc(await post({ jsonrpc: '2.0', id: 4, method: 'resources/templates/list' }))
    ).result;
    const uris = templates.resourceTemplates.map((t: { uriTemplate: string }) => t.uriTemplate);
    expect(uris).toContain('ctxman://{dataset}/{slug}');
    expect(uris).toContain('ctxman://{dataset}/{slug}/doc/{+path}');

    const list = (await rpc(await post({ jsonrpc: '2.0', id: 5, method: 'resources/list' })))
      .result;
    const listed = list.resources as { uri: string; name: string; mimeType: string }[];
    expect(listed.find((r) => r.uri === 'ctxman://kb/ctxman')!.mimeType).toBe('text/markdown');
    expect(listed.find((r) => r.uri === 'ctxman://context/ctxman-dev')!.mimeType).toBe(
      'application/yaml',
    );
    expect(listed.length).toBeGreaterThan(30);

    const entry = (
      await rpc(
        await post({
          jsonrpc: '2.0',
          id: 6,
          method: 'resources/read',
          params: { uri: 'ctxman://kb/ctxman' },
        }),
      )
    ).result;
    expect(entry.contents[0].mimeType).toBe('text/markdown');
    expect(entry.contents[0].text).toMatch(/^---\n/);

    const doc = (
      await rpc(
        await post({
          jsonrpc: '2.0',
          id: 7,
          method: 'resources/read',
          params: { uri: 'ctxman://kb/ctxman/doc/concepts/search.md' },
        }),
      )
    ).result;
    expect(doc.contents[0].mimeType).toBe('text/markdown');
    expect(doc.contents[0].text.length).toBeGreaterThan(50);

    const yaml = (
      await rpc(
        await post({
          jsonrpc: '2.0',
          id: 8,
          method: 'resources/read',
          params: { uri: 'ctxman://reference/astro-docs' },
        }),
      )
    ).result;
    expect(yaml.contents[0].mimeType).toBe('application/yaml');
    expect(yaml.contents[0].text).toContain('name: astro-docs');

    const missing = await rpc(
      await post({
        jsonrpc: '2.0',
        id: 9,
        method: 'resources/read',
        params: { uri: 'ctxman://kb/nope' },
      }),
    );
    expect(missing.error).toBeDefined();
    const escape = await rpc(
      await post({
        jsonrpc: '2.0',
        id: 10,
        method: 'resources/read',
        params: { uri: 'ctxman://kb/ctxman/doc/../../task/write-agents-md/index.md' },
      }),
    );
    expect(escape.error ?? escape.result.isError).toBeDefined();
    expect(JSON.stringify(escape)).not.toContain('Write AGENTS.md');
  });
});

describe('the HTTP guards', () => {
  it('rejects a wrong content type (415) and a missing Accept (406)', async () => {
    const wrong = await post(INIT, { 'content-type': 'text/plain' });
    expect(wrong.status).toBe(415);
    const noAccept = await post(INIT, { accept: 'application/json' });
    expect(noAccept.status).toBe(406);
  });

  it('answers GET and DELETE with 405', async () => {
    for (const method of ['GET', 'DELETE']) {
      const response = await handleMcpRequest(
        new Request(URL_, {
          method,
          headers: { accept: 'text/event-stream', host: '127.0.0.1:4321' },
        }),
        factory,
      );
      expect(response.status, method).toBe(405);
    }
  });

  it('rejects a foreign Origin and a foreign Host with 403', async () => {
    expect((await post(INIT, { origin: 'http://evil.test' })).status).toBe(403);
    expect((await post(INIT, { host: 'evil.test' })).status).toBe(403);
    // loopback origins and an absent Origin pass
    expect((await post(INIT, { origin: 'http://localhost:4321' })).status).toBe(200);
    expect((await post(INIT)).status).toBe(200);
  });

  it('answers 503 data-dir when no data directory is configured', async () => {
    const { DataDirError } = await import('../../src/lib/data-dir.ts');
    const response = await handleMcpRequest(
      new Request(URL_, { method: 'POST', headers: HEADERS, body: JSON.stringify(INIT) }),
      () => {
        throw new DataDirError('unset', 'CTXMAN_DATA_DIR is not set.');
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'data-dir' });
  });

  it('uses the environment data dir by default', async () => {
    const previous = process.env.CTXMAN_DATA_DIR;
    process.env.CTXMAN_DATA_DIR = path.resolve(dir);
    try {
      const response = await handleMcpRequest(
        new Request(URL_, {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'list-datasets', arguments: {} },
          }),
        }),
      );
      const { result } = await rpc(response);
      expect(result.structuredContent.datasets).toHaveLength(11);
    } finally {
      if (previous === undefined) delete process.env.CTXMAN_DATA_DIR;
      else process.env.CTXMAN_DATA_DIR = previous;
    }
  });
});
