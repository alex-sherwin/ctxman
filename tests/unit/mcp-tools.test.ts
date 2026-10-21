// The MCP tools (src/lib/mcp/tools.ts) against a COPY of the committed corpus: markdown text AND structuredContent,
// and for the write tools the file on disk plus the next read through the tools.
// Tests that only read share ONE copy (`read-only tools`); every test that writes (tools or fixtures) gets its own.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateEntryIndex } from '../../src/lib/entry-index.ts';
import { callTool, MAX_TEXT_CHARS, TOOLS } from '../../src/lib/mcp/tools.ts';
import type { ToolContext, ToolResult } from '../../src/lib/mcp/tools.ts';
import { cleanupCorpus, copyCorpus } from './fixtures/corpus.ts';

let previous: string | undefined;
let dir: string;
let ctx: ToolContext;

// Local noon on 2026-10-18: `append-log` writes the LOCAL date.
const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();

function openCorpus(): void {
  previous = process.env.CTXMAN_DATA_DIR;
  dir = copyCorpus();
  process.env.CTXMAN_DATA_DIR = dir;
  invalidateEntryIndex();
  ctx = { dataDir: dir, nowMs: NOW, serverOrigin: 'http://127.0.0.1:4321' };
}

function closeCorpus(): void {
  if (previous === undefined) delete process.env.CTXMAN_DATA_DIR;
  else process.env.CTXMAN_DATA_DIR = previous;
  invalidateEntryIndex();
  cleanupCorpus();
}

const run = (name: string, args: unknown): Promise<ToolResult> => callTool(name, args, ctx);
const text = (result: ToolResult): string => result.content.map((c) => c.text).join('\n');
const data = <T = Record<string, unknown>>(result: ToolResult): T => result.structuredContent as T;
const read = (...rel: string[]): string => readFileSync(path.join(dir, ...rel), 'utf8');

async function ok(name: string, args: unknown): Promise<ToolResult> {
  const result = await run(name, args);
  expect(result.isError, `${name}: ${text(result)}`).not.toBe(true);
  return result;
}

async function fails(name: string, args: unknown, code: string): Promise<ToolResult> {
  const result = await run(name, args);
  expect(result.isError, `${name} should fail`).toBe(true);
  expect(text(result)).toMatch(new RegExp(`^${code}:`));
  expect(data(result).error).toBe(code);
  return result;
}
describe('read-only tools', () => {
  beforeAll(openCorpus);
  afterAll(closeCorpus);

  describe('the tool registry', () => {
    it('has the planned tools with unique names and object JSON Schemas', () => {
      expect(TOOLS.map((t) => t.name)).toEqual([
        'search',
        'list-datasets',
        'list-entries',
        'get-entry',
        'list-bundle-files',
        'read-bundle-file',
        'get-context',
        'render-recipe',
        'check-data',
        'create-entry',
        'patch-entry',
        'append-context-links',
        'append-log',
      ]);
      for (const tool of TOOLS) {
        const schema = tool.input.toJsonSchema() as { type?: string };
        expect(schema.type, tool.name).toBe('object');
        expect(tool.description.length, tool.name).toBeGreaterThan(20);
      }
      expect(TOOLS.filter((t) => !t.readOnly).map((t) => t.name)).toEqual([
        'create-entry',
        'patch-entry',
        'append-context-links',
        'append-log',
      ]);
    });

    it('answers an unknown tool with a failure result', async () => {
      await fails('nope', {}, 'unknown-tool');
    });
  });

  describe('search', () => {
    it('finds concepts across datasets with snippet, resource and url', async () => {
      const result = await ok('search', { query: 'inflate' });
      const out = data<{ count: number; hits: Record<string, unknown>[] }>(result);
      expect(out.count).toBeGreaterThan(0);
      expect(out.count).toBeLessThanOrEqual(20);
      const hit = out.hits[0]!;
      expect(Object.keys(hit).sort()).toEqual(
        [
          'dataset',
          'description',
          'id',
          'path',
          'resource',
          'score',
          'slug',
          'snippet',
          'title',
          'url',
        ].sort(),
      );
      expect(String(hit.url)).toMatch(/^http:\/\/127\.0\.0\.1:4321\//);
      expect(String(hit.resource)).toMatch(/^ctxman:\/\//);
      expect(String(hit.snippet).length).toBeLessThanOrEqual(202);
      expect(text(result)).toContain('result(s) for "inflate"');
      expect(text(result)).toContain(String(hit.id));
    });

    it('restricts to datasets, honours limit and rejects a short query', async () => {
      const tasks = data<{ hits: { dataset: string }[] }>(
        await ok('search', { query: 'agents', datasets: ['task'] }),
      );
      expect(tasks.hits.length).toBeGreaterThan(0);
      expect(tasks.hits.every((h) => h.dataset === 'task')).toBe(true);
      const one = data<{ count: number }>(await ok('search', { query: 'ctxman', limit: 1 }));
      expect(one.count).toBe(1);
      await fails('search', { query: ' a ' }, 'invalid');
    });

    it('#tag keeps only files whose frontmatter tags include it exactly (concept files too)', async () => {
      const tagged = data<{ hits: { id: string; path: string | null }[] }>(
        await ok('search', { query: '#architecture', limit: 100 }),
      );
      expect(tagged.hits.map((h) => h.id)).toContain('kb/ctxman/concepts/architecture');
      expect(tagged.hits.some((h) => h.path === 'concepts/architecture.md')).toBe(true);
      // a prefix of a tag is not the tag
      expect(data(await ok('search', { query: '#architect' })).count).toBe(0);
      // the rest of the query is fuzzy text within the tagged files
      const both = data<{ hits: { id: string }[] }>(
        await ok('search', { query: '#workflow forge', limit: 100 }),
      );
      expect(both.hits.map((h) => h.id)).toContain('kb/ctxman/concepts/context-forge');
      expect(both.hits.map((h) => h.id)).not.toContain('kb/ctxman/concepts/architecture');
    });

    it('reports no hits in plain text', async () => {
      const result = await ok('search', { query: 'zzzzqqqqxxxx' });
      expect(text(result)).toBe('No results for "zzzzqqqqxxxx".');
      expect(data(result).count).toBe(0);
    });
  });

  describe('list-datasets and list-entries', () => {
    it('lists the 12 datasets with counts', async () => {
      const result = await ok('list-datasets', {});
      const datasets = data<{
        datasets: { id: string; count: number; states: string[]; kind: string }[];
      }>(result).datasets;
      expect(datasets).toHaveLength(12);
      const task = datasets.find((d) => d.id === 'task')!;
      expect(task.count).toBe(4);
      expect(task.states).toEqual(['pending', 'in-progress', 'complete', 'wont-do']);
      expect(datasets.find((d) => d.id === 'reference')!.kind).toBe('data');
      expect(text(result)).toContain('| task | okf | 4 |');
    });

    it('filters like the UI lists', async () => {
      const all = data<{ total: number }>(await ok('list-entries', { dataset: 'task' }));
      expect(all.total).toBe(4);
      const q = await ok('list-entries', { dataset: 'task', q: 'agents' });
      expect(data<{ entries: { slug: string }[] }>(q).entries.map((e) => e.slug)).toContain(
        'write-agents-md',
      );
      expect(text(q)).toContain('`task/write-agents-md`');
      const none = await ok('list-entries', { dataset: 'task', q: 'zzzzqqqq' });
      expect(text(none)).toMatch(/^No tasks match/);
      const limited = data<{ shown: number; total: number }>(
        await ok('list-entries', { dataset: 'task', limit: 2 }),
      );
      expect(limited).toMatchObject({ shown: 2, total: 4 });
    });

    it('lists the children of a project and reference types', async () => {
      const children = data<{ total: number; entries: { slug: string }[] }>(
        await ok('list-entries', { dataset: 'task', project: 'ctxman-v1' }),
      );
      expect(children.total).toBeGreaterThan(0);
      expect(children.total).toBeLessThanOrEqual(4);
      const refs = data<{ entries: { refType?: string }[] }>(
        await ok('list-entries', { dataset: 'reference', type: 'local-repo' }),
      );
      expect(refs.entries.length).toBeGreaterThan(0);
      expect(refs.entries.every((e) => e.refType === 'local-repo')).toBe(true);
    });
  });

  describe('get-entry', () => {
    it('returns frontmatter, body, relations and files of an okf bundle', async () => {
      const result = await ok('get-entry', { dataset: 'kb', slug: 'ctxman' });
      const out = data<{
        frontmatter: { name: string; type: string };
        body: string;
        files: { path: string }[];
        relations: { linksTo: unknown[]; linkedFrom: unknown[] };
        url: string;
        resource: string;
        path: string;
      }>(result);
      expect(out.frontmatter).toMatchObject({ name: 'ctxman', type: 'Knowledge Base' });
      expect(out.body.length).toBeGreaterThan(100);
      expect(out.files.map((f) => f.path)).toContain('concepts/search.md');
      expect(out.url).toBe('http://127.0.0.1:4321/kb/ctxman');
      expect(out.resource).toBe('ctxman://kb/ctxman');
      expect(out.path).toBe('kb/ctxman/index.md');
      expect(out.relations).toHaveProperty('linksTo');
      expect(text(result)).toContain('```yaml');
      expect(text(result)).toContain('## Files');
      expect(text(result)).toContain(out.body.trim().slice(0, 40));
    });

    it('skips the body when includeBody is false', async () => {
      const result = await ok('get-entry', { dataset: 'kb', slug: 'ctxman', includeBody: false });
      expect(data(result)).not.toHaveProperty('body');
    });

    it('returns yaml data for reference, context and recipe', async () => {
      const reference = data<{ data: { type: string } }>(
        await ok('get-entry', { dataset: 'reference', slug: 'astro-docs' }),
      );
      expect(reference.data.type).toBeTypeOf('string');
      const context = await ok('get-entry', { dataset: 'context', slug: 'ctxman-dev' });
      expect(
        data<{ links: { dataset: string; title?: string }[] }>(context).links[0],
      ).toMatchObject({
        dataset: 'kb',
        title: expect.any(String),
      });
      const recipe = await ok('get-entry', { dataset: 'recipe', slug: 'ctxman-dev-brief' });
      expect(data<{ contexts: { slug: string }[] }>(recipe).contexts[0]!.slug).toBe('ctxman-dev');
      expect(text(recipe)).toContain('ctxman-dev-brief');
    });

    it('returns a snippet: its data, and the markdown as text after the yaml', async () => {
      const result = await ok('get-entry', { dataset: 'snippet', slug: 'finish-checklist' });
      const out = data<{ data: { name: string; markdown: string; tags: string[] } }>(result);
      expect(out.data).toMatchObject({ name: 'finish-checklist', tags: ['workflow'] });
      expect(out.data.markdown).toContain('## Before you finish');
      const shown = text(result);
      expect(shown).toContain('```yaml');
      expect(shown).not.toContain('markdown: |');
      expect(shown).toContain('## Before you finish\n\n1. Run `pnpm run fmt`');
    });

    it('lists the contexts that link to an entry', async () => {
      const result = await ok('get-entry', { dataset: 'kb', slug: 'ctxman' });
      expect(text(result)).toContain('## Linked from contexts');
      expect(
        data<{ linkedFromContexts: { context: string }[] }>(result).linkedFromContexts.map(
          (c) => c.context,
        ),
      ).toContain('ctxman-dev');
    });

    it('fails for a missing entry', async () => {
      await fails('get-entry', { dataset: 'task', slug: 'nope' }, 'not-found');
    });
  });

  describe('bundle files', () => {
    it('lists the files of a bundle', async () => {
      const result = await ok('list-bundle-files', { dataset: 'kb', slug: 'ctxman' });
      const files = data<{ files: { path: string; resource: string }[] }>(result).files;
      expect(files.map((f) => f.path)).toContain('concepts/search.md');
      expect(files.find((f) => f.path === 'concepts/search.md')!.resource).toBe(
        'ctxman://kb/ctxman/doc/concepts/search.md',
      );
      expect(text(result)).toContain('`concepts/search.md`');
      await fails('list-bundle-files', { dataset: 'kb', slug: 'nope' }, 'not-found');
    });
  });
  describe('get-context', () => {
    it('resolves the links of a context', async () => {
      const result = await ok('get-context', { slug: 'ctxman-dev' });
      const out = data<{
        slug: string;
        links: {
          dataset: string;
          slug: string;
          title?: string;
          notes?: string;
          missing: boolean;
        }[];
      }>(result);
      expect(out.slug).toBe('ctxman-dev');
      expect(out.links.length).toBeGreaterThan(3);
      expect(out.links[0]).toMatchObject({ dataset: 'kb', slug: 'ctxman', missing: false });
      expect(out.links[0]!.notes).toContain('Start here');
      expect(text(result)).toContain('`kb/ctxman`');
      await fails('get-context', { slug: 'nope' }, 'not-found');
    });
  });

  describe('render-recipe', () => {
    it('renders a saved recipe into the Inflate document', async () => {
      const result = await ok('render-recipe', { recipe: 'ctxman-dev-brief' });
      expect(text(result)).toContain('You are working on ctxman');
      const out = data<{
        recipe: string;
        target: string;
        counts: { included: number };
        warnings: unknown[];
        segments: unknown[];
      }>(result);
      expect(out).toMatchObject({ recipe: 'ctxman-dev-brief', target: 'claude-code' });
      expect(out.counts.included).toBeGreaterThan(3);
      expect(out.segments.length).toBeGreaterThan(3);
      expect(Array.isArray(out.warnings)).toBe(true);
      // the document is in the text only; it is never written anywhere
      expect(data(result)).not.toHaveProperty('markdown');
    });

    it('renders an ad hoc composition', async () => {
      const result = await ok('render-recipe', {
        contexts: ['okf-authoring'],
        items: [{ dataset: 'task', slug: 'write-agents-md' }],
        target: 'codex',
        layout: 'flat',
        preamble: 'Hello preamble',
      });
      expect(text(result)).toContain('Hello preamble');
      expect(data(result)).toMatchObject({ recipe: 'mcp-adhoc', target: 'codex', layout: 'flat' });
    });

    it('validates the input form', async () => {
      await fails('render-recipe', {}, 'invalid');
      await fails(
        'render-recipe',
        { recipe: 'ctxman-dev-brief', contexts: ['ctxman-dev'] },
        'invalid',
      );
      await fails('render-recipe', { recipe: 'nope' }, 'not-found');
      await fails('render-recipe', { contexts: ['Bad Name'] }, 'invalid');
    });
  });

  describe('check-data', () => {
    it('reports a clean corpus', async () => {
      const result = await ok('check-data', {});
      expect(data(result)).toMatchObject({
        ok: true,
        errors: 0,
        findingsTotal: expect.any(Number),
      });
      expect(Object.keys(data<{ checks: object }>(result).checks)).toEqual([
        'okf',
        'links',
        'collections',
      ]);
      expect(text(result)).toContain('All checks:');
    });
  });
});

describe('tools on a private corpus copy (tests that write)', () => {
  beforeEach(openCorpus);
  afterEach(closeCorpus);

  describe('get-entry', () => {
    it('clips a huge body and says how to continue', async () => {
      writeFileSync(
        path.join(dir, 'kb', 'ctxman', 'index.md'),
        read('kb', 'ctxman', 'index.md') + '\n' + 'word '.repeat(30_000),
      );
      invalidateEntryIndex();
      const result = await ok('get-entry', { dataset: 'kb', slug: 'ctxman' });
      const out = data<{ body: string; bodyTruncated: { shown: number; total: number } }>(result);
      expect(out.body.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
      expect(out.bodyTruncated.total).toBeGreaterThan(MAX_TEXT_CHARS);
      expect(text(result)).toContain(
        'more characters; page through the whole file with read-bundle-file',
      );
    });
  });

  describe('search', () => {
    it('leaves out files with index: false (a whole bundle when its entry says so)', async () => {
      writeFileSync(
        path.join(dir, 'kb', 'ctxman', 'concepts', 'session-history.md'),
        '---\ntype: Session log\nindex: false\ntags: [quuxhistory]\n---\n# Session\n\nflorbwazzle transcript\n',
      );
      invalidateEntryIndex();
      expect(data(await ok('search', { query: 'florbwazzle' })).count).toBe(0);
      expect(data(await ok('search', { query: '#quuxhistory' })).count).toBe(0);
      // still a file of the bundle: listed and readable
      const files = data<{ files: { path: string }[] }>(
        await ok('list-bundle-files', { dataset: 'kb', slug: 'ctxman' }),
      );
      expect(files.files.map((f) => f.path)).toContain('concepts/session-history.md');
    });
  });

  describe('bundle files', () => {
    it('reads one file and pages a long one', async () => {
      const result = await ok('read-bundle-file', {
        dataset: 'kb',
        slug: 'ctxman',
        path: 'concepts/search.md',
      });
      expect(text(result)).toBe(read('kb', 'ctxman', 'concepts', 'search.md'));
      expect(data(result)).toMatchObject({ path: 'concepts/search.md', offset: 0 });
      expect(data(result)).not.toHaveProperty('nextOffset');

      writeFileSync(path.join(dir, 'kb', 'ctxman', 'concepts', 'big.md'), 'x'.repeat(120_000));
      const first = await ok('read-bundle-file', {
        dataset: 'kb',
        slug: 'ctxman',
        path: 'concepts/big.md',
      });
      expect(data(first)).toMatchObject({ total: 120_000, nextOffset: MAX_TEXT_CHARS });
      expect(text(first)).toContain(`call again with offset ${MAX_TEXT_CHARS}`);
      const last = await ok('read-bundle-file', {
        dataset: 'kb',
        slug: 'ctxman',
        path: 'concepts/big.md',
        offset: 100_000,
      });
      expect(data<{ text: string }>(last).text).toHaveLength(20_000);
      expect(data(last)).not.toHaveProperty('nextOffset');
    });

    it('refuses unsafe, missing and oversized paths', async () => {
      await fails(
        'read-bundle-file',
        { dataset: 'kb', slug: 'ctxman', path: '../../task/write-agents-md/index.md' },
        'bad-path',
      );
      await fails(
        'read-bundle-file',
        { dataset: 'kb', slug: 'ctxman', path: '/etc/passwd' },
        'bad-path',
      );
      await fails(
        'read-bundle-file',
        { dataset: 'kb', slug: 'ctxman', path: 'concepts/nope.md' },
        'not-found',
      );
      await fails(
        'read-bundle-file',
        { dataset: 'kb', slug: 'nope', path: 'index.md' },
        'no-entry',
      );
      writeFileSync(path.join(dir, 'kb', 'ctxman', 'concepts', 'huge.md'), 'x'.repeat(600 * 1024));
      await fails(
        'read-bundle-file',
        { dataset: 'kb', slug: 'ctxman', path: 'concepts/huge.md' },
        'too-large',
      );
    });
  });
  describe('check-data', () => {
    it('reports errors of the chosen scope', async () => {
      writeFileSync(
        path.join(dir, 'task', 'write-agents-md', 'index.md'),
        '---\ntype: Task\n---\n# x\n',
      );
      const result = await ok('check-data', { scope: ['okf'] });
      const out = data<{
        ok: boolean;
        errors: number;
        checks: object;
        findings: { file: string; check: string }[];
      }>(result);
      expect(out.ok).toBe(false);
      expect(out.errors).toBeGreaterThan(0);
      expect(Object.keys(out.checks)).toEqual(['okf']);
      expect(out.findings.some((f) => f.file.startsWith('task/write-agents-md/'))).toBe(true);
      expect(text(result)).toContain('ERROR');
    });
  });
  describe('create-entry', () => {
    it('creates an okf entry with parent link, visible in the next read', async () => {
      const result = await ok('create-entry', {
        dataset: 'task',
        name: 'mcp-made-task',
        description: 'Made through MCP.',
        title: 'MCP task',
        state: 'in-progress',
        tags: ['mcp'],
        parent: 'ctxman-v1',
      });
      const out = data<{
        path: string;
        files: string[];
        parentLinked: boolean;
        summary: { state: string; title: string };
      }>(result);
      expect(out.path).toBe('task/mcp-made-task/index.md');
      expect(out.files).toContain('task/mcp-made-task/index.md');
      expect(out.parentLinked).toBe(true);
      expect(out.summary).toMatchObject({ state: 'in-progress', title: 'MCP task' });
      expect(existsSync(path.join(dir, 'task', 'mcp-made-task', 'index.md'))).toBe(true);
      expect(read('project', 'ctxman-v1', 'index.md')).toContain('mcp-made-task');
      const listed = data<{ entries: { slug: string }[] }>(
        await ok('list-entries', { dataset: 'task', q: 'mcp' }),
      );
      expect(listed.entries.map((e) => e.slug)).toContain('mcp-made-task');
      expect(text(result)).toContain('Created `task/mcp-made-task`');
    });

    it('creates skill, reference, context and recipe entries', async () => {
      await ok('create-entry', { dataset: 'skill', name: 'mcp-skill', description: 'A skill.' });
      expect(read('skill', 'mcp-skill', 'SKILL.md')).toContain('name: mcp-skill');

      await ok('create-entry', {
        dataset: 'reference',
        name: 'mcp-ref',
        description: 'A ref.',
        type: 'remote-repo',
        uri: 'https://github.com/acme/widgets.git',
        owner: 'not-me',
      });
      const ref = read('reference', 'mcp-ref.yaml');
      expect(ref.split('\n')[0]).toBe(
        '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/reference',
      );
      expect(ref).toContain('uri: https://github.com/acme/widgets.git');
      expect(ref).toContain('owner: not-me');

      await ok('create-entry', {
        dataset: 'reference',
        name: 'mcp-folder',
        description: 'A folder.',
        type: 'local-folder',
        path: '~/notes',
      });
      expect(read('reference', 'mcp-folder.yaml')).toContain('type: local-folder\npath: ~/notes\n');
      const folders = data<{ entries: { slug: string; refType?: string }[] }>(
        await ok('list-entries', { dataset: 'reference', type: 'local-folder' }),
      );
      expect(folders.entries.map((e) => [e.slug, e.refType])).toEqual([
        ['mcp-folder', 'local-folder'],
      ]);

      await ok('create-entry', { dataset: 'context', name: 'mcp-ctx', description: 'A context.' });
      await ok('create-entry', { dataset: 'recipe', name: 'mcp-recipe', description: 'A recipe.' });
      expect(read('context', 'mcp-ctx.yaml')).toContain('links: []');
      expect(read('recipe', 'mcp-recipe.yaml')).toContain('target: claude-code');
      const got = data<{ data: { name: string } }>(
        await ok('get-entry', { dataset: 'recipe', slug: 'mcp-recipe' }),
      );
      expect(got.data.name).toBe('mcp-recipe');
    });

    it('creates a snippet with its markdown (or a TODO one), found by the next search', async () => {
      await ok('create-entry', {
        dataset: 'snippet',
        name: 'mcp-snippet',
        description: 'Made through MCP.',
        markdown: 'Always run zorblaxquint before committing.\n',
      });
      expect(read('snippet', 'mcp-snippet.yaml')).toBe(
        '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/snippet\n' +
          'name: mcp-snippet\ndescription: Made through MCP.\n' +
          'markdown: |\n  Always run zorblaxquint before committing.\n',
      );
      const hits = data<{ hits: { id: string }[] }>(await ok('search', { query: 'zorblaxquint' }));
      expect(hits.hits.map((h) => h.id)).toContain('snippet/mcp-snippet');

      await ok('create-entry', { dataset: 'snippet', name: 'mcp-todo', description: 'Later.' });
      expect(read('snippet', 'mcp-todo.yaml')).toContain(
        'markdown: |\n  TODO: write the Mcp todo snippet.\n',
      );
      await fails(
        'create-entry',
        { dataset: 'kb', name: 'not-a-snippet', description: 'x', markdown: 'm' },
        'invalid',
      );
      expect(existsSync(path.join(dir, 'kb', 'not-a-snippet'))).toBe(false);
    });

    it('refuses duplicates, bad input and misplaced fields', async () => {
      await fails(
        'create-entry',
        { dataset: 'task', name: 'write-agents-md', description: 'x' },
        'exists',
      );
      await fails(
        'create-entry',
        { dataset: 'context', name: 'okf-authoring', description: 'x' },
        'exists',
      );
      await fails(
        'create-entry',
        { dataset: 'task', name: 'Bad Name', description: 'x' },
        'invalid',
      );
      await fails(
        'create-entry',
        { dataset: 'task', name: 'ok-name', description: 'x', state: 'fixed' },
        'invalid',
      );
      await fails(
        'create-entry',
        { dataset: 'task', name: 'ok-name', description: 'x', owner: 'me' },
        'invalid',
      );
      await fails(
        'create-entry',
        { dataset: 'context', name: 'ok-name', description: 'x', tags: ['a'] },
        'invalid',
      );
      await fails(
        'create-entry',
        { dataset: 'task', name: 'ok-name', description: 'x', parent: 'nope' },
        'invalid',
      );
      await fails(
        'create-entry',
        {
          dataset: 'reference',
          name: 'bad-ref',
          description: 'x',
          type: 'remote-repo',
          uri: 'not a uri',
        },
        'invalid',
      );
      expect(existsSync(path.join(dir, 'task', 'ok-name'))).toBe(false);
      expect(existsSync(path.join(dir, 'reference', 'bad-ref.yaml'))).toBe(false);
    });
  });

  describe('patch-entry', () => {
    it('changes the state and tags on disk and shows them on the next read', async () => {
      const result = await ok('patch-entry', {
        dataset: 'task',
        slug: 'write-agents-md',
        state: 'complete',
        tags: ['docs', 'mcp'],
      });
      expect(data(result)).toMatchObject({
        changed: true,
        frontmatter: { state: 'complete', tags: ['docs', 'mcp'] },
      });
      expect(read('task', 'write-agents-md', 'index.md')).toMatch(/state: complete/);
      const entry = data<{ state: string }>(
        await ok('get-entry', { dataset: 'task', slug: 'write-agents-md', includeBody: false }),
      );
      expect(entry.state).toBe('complete');
      const filtered = data<{ entries: { slug: string }[] }>(
        await ok('list-entries', { dataset: 'task', state: ['complete'] }),
      );
      expect(filtered.entries.map((e) => e.slug)).toContain('write-agents-md');
    });

    it('logs time and the resolution date (time-tracked datasets only)', async () => {
      const result = await ok('patch-entry', {
        dataset: 'task',
        slug: 'write-agents-md',
        time: ['PT1H30M', 'pt15m'],
        resolved: '2026-10-19T14:30+02:00',
      });
      expect(data(result)).toMatchObject({
        changed: true,
        frontmatter: { time: ['PT1H30M', 'PT15M'], resolved: '2026-10-19T14:30+02:00' },
      });
      expect(read('task', 'write-agents-md', 'index.md')).toContain('time: [PT1H30M, PT15M]\n');
      await fails(
        'patch-entry',
        { dataset: 'task', slug: 'write-agents-md', time: ['90 minutes'] },
        'invalid',
      );
      await fails(
        'patch-entry',
        { dataset: 'kb', slug: 'ctxman', resolved: '2026-10-19' },
        'invalid',
      );
      const cleared = await ok('patch-entry', {
        dataset: 'task',
        slug: 'write-agents-md',
        time: [],
        resolved: null,
      });
      expect(
        data<{ frontmatter: Record<string, unknown> }>(cleared).frontmatter,
      ).not.toHaveProperty('time');
      expect(read('task', 'write-agents-md', 'index.md')).not.toMatch(/^(time|resolved):/m);
    });

    it('adds and removes relations', async () => {
      await ok('patch-entry', {
        dataset: 'task',
        slug: 'write-agents-md',
        addLinks: [{ dataset: 'kb', slug: 'ctxman', rel: 'depends-on' }],
      });
      expect(read('task', 'write-agents-md', 'index.md')).toContain('depends-on');
      const entry = data<{ relations: { linksTo: { entry: string; rel: string }[] } }>(
        await ok('get-entry', { dataset: 'task', slug: 'write-agents-md' }),
      );
      expect(entry.relations.linksTo).toContainEqual(
        expect.objectContaining({ entry: 'kb/ctxman', rel: 'depends-on' }),
      );
      const removed = await ok('patch-entry', {
        dataset: 'task',
        slug: 'write-agents-md',
        removeLinks: [{ dataset: 'kb', slug: 'ctxman' }],
      });
      expect(data(removed).changed).toBe(true);
      expect(read('task', 'write-agents-md', 'index.md')).not.toContain('depends-on');
    });

    it('reports no change and refuses invalid patches without writing', async () => {
      const before = read('task', 'write-agents-md', 'index.md');
      const same = await ok('patch-entry', {
        dataset: 'task',
        slug: 'write-agents-md',
        description: before.match(/description: (.*)/)![1]!,
      });
      expect(data(same).changed).toBe(false);
      await fails(
        'patch-entry',
        { dataset: 'task', slug: 'write-agents-md', state: 'fixed' },
        'invalid',
      );
      await fails('patch-entry', { dataset: 'task', slug: 'nope', state: 'pending' }, 'not-found');
      await fails('patch-entry', { dataset: 'task', slug: 'write-agents-md' }, 'invalid');
      await fails(
        'patch-entry',
        { dataset: 'skill', slug: 'ctxman-add-entry', tags: ['x'] },
        'invalid',
      );
      expect(read('task', 'write-agents-md', 'index.md')).toBe(before);
    });
  });

  describe('append-context-links', () => {
    it('appends new links and skips existing ones', async () => {
      const result = await ok('append-context-links', {
        slug: 'okf-authoring',
        links: [
          { dataset: 'task', slug: 'write-agents-md', notes: 'Do it.' },
          { dataset: 'task', slug: 'write-agents-md' },
        ],
      });
      expect(data(result)).toMatchObject({
        added: ['task/write-agents-md'],
        skipped: ['task/write-agents-md'],
      });
      expect(read('context', 'okf-authoring.yaml')).toContain('slug: write-agents-md');
      const again = await ok('append-context-links', {
        slug: 'okf-authoring',
        links: [{ dataset: 'task', slug: 'write-agents-md' }],
      });
      expect(data(again)).toMatchObject({ added: [], skipped: ['task/write-agents-md'] });
      const context = data<{ links: { slug: string; notes?: string }[] }>(
        await ok('get-context', { slug: 'okf-authoring' }),
      );
      expect(context.links.find((l) => l.slug === 'write-agents-md')!.notes).toContain('Do it.');
      await fails(
        'append-context-links',
        { slug: 'nope', links: [{ dataset: 'kb', slug: 'ctxman' }] },
        'not-found',
      );
    });
  });

  describe('append-log', () => {
    it("adds a bullet under today's heading (local date) and returns the head", async () => {
      const result = await ok('append-log', {
        dataset: 'kb',
        slug: 'ctxman',
        text: '**Update**: Added MCP notes.',
      });
      const out = data<{ head: string; created: boolean; entry: string }>(result);
      expect(out.created).toBe(false);
      expect(out.entry).toBe('* **Update**: Added MCP notes.');
      expect(out.head).toMatch(/^## 2026-10-18\n\* \*\*Update\*\*: Added MCP notes\./);
      expect(read('kb', 'ctxman', 'log.md')).toContain(
        '## 2026-10-18\n* **Update**: Added MCP notes.',
      );
      const second = data<{ head: string }>(
        await ok('append-log', { dataset: 'kb', slug: 'ctxman', text: 'Second' }),
      );
      expect(second.head).toContain('* Second\n* **Update**: Added MCP notes.');
      expect(text(result)).toContain('Newest section');
    });

    it('creates log.md when missing and refuses bad targets', async () => {
      rmSync(path.join(dir, 'task', 'write-agents-md', 'log.md'), { force: true });
      const result = await ok('append-log', {
        dataset: 'task',
        slug: 'write-agents-md',
        text: 'Started.',
      });
      expect(data(result).created).toBe(true);
      expect(read('task', 'write-agents-md', 'log.md')).toBe(
        '# Update log\n\n## 2026-10-18\n* Started.\n',
      );
      await fails('append-log', { dataset: 'kb', slug: 'nope', text: 'x' }, 'not-found');
      await fails('append-log', { dataset: 'kb', slug: 'ctxman', text: '   ' }, 'invalid');
    });
  });
});
