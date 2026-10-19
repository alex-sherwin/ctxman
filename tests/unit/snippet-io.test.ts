import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { schemaCommentLine, withSchemaComment } from '../../src/lib/schema-comment.ts';
import {
  SnippetIoError,
  createSnippet,
  deleteSnippet,
  listSnippets,
  readSnippet,
  snippetFile,
  validateSnippet,
  writeSnippet,
} from '../../src/lib/snippet-io.ts';
import { parseSnippet, serializeSnippet } from '../../src/lib/snippet-yaml.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const ORIGIN = 'http://127.0.0.1:4321';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SnippetIoError) return error.code;
    throw error;
  }
  return 'resolved';
}

const doc = (overrides: Record<string, unknown> = {}) => ({
  name: 'my-snippet',
  description: 'A snippet',
  tags: ['a'],
  markdown: 'Run the checks.\n\n- `pnpm run check`\n',
  ...overrides,
});

describe('snippetFile', () => {
  it('returns data/snippet/<slug>.yaml and rejects non-kebab slugs', () => {
    const root = path.resolve('/data-root');
    expect(snippetFile('my-snippet', root)).toBe(path.join(root, 'snippet', 'my-snippet.yaml'));
    for (const bad of ['', 'A', '../x', 'a/b', 'a.b', '-a', 'a'.repeat(65)]) {
      expect(() => snippetFile(bad, root), bad).toThrow(SnippetIoError);
    }
  });
});

describe('validateSnippet', () => {
  it('accepts a valid document and requires name === slug', () => {
    expect(validateSnippet(doc(), 'my-snippet')).toMatchObject({ ok: true });
    expect(validateSnippet(doc(), 'other')).toMatchObject({ ok: false, code: 'name-mismatch' });
    expect(validateSnippet(doc({ markdown: '' }), 'my-snippet')).toMatchObject({
      ok: false,
      code: 'invalid',
    });
  });
});

describe('create / read / write / delete cycle', () => {
  it('creates, reads, rewrites and deletes a snippet', async () => {
    const dir = tmp.make();
    expect(existsSync(path.join(dir, 'snippet'))).toBe(false);

    const created = await createSnippet(doc(), dir);
    expect(created.slug).toBe('my-snippet');
    expect(created.file).toBe('snippet/my-snippet.yaml');
    const file = path.join(dir, 'snippet', 'my-snippet.yaml');
    const text = readFileSync(file, 'utf8');
    expect(text).toBe(withSchemaComment('snippet', serializeSnippet(created.snippet), ORIGIN));
    expect(text.split('\n')[0]).toBe(schemaCommentLine('snippet', ORIGIN));
    expect(text).toContain('markdown: |\n  Run the checks.\n');

    const read = await readSnippet('my-snippet', dir);
    expect(read.snippet).toEqual(created.snippet);
    expect(Number.isNaN(Date.parse(read.lastModified))).toBe(false);

    const written = await writeSnippet('my-snippet', doc({ markdown: 'Changed.' }), dir);
    expect(written.snippet.markdown).toBe('Changed.');
    expect((await readSnippet('my-snippet', dir)).snippet.markdown).toBe('Changed.');

    await deleteSnippet('my-snippet', dir);
    expect(existsSync(file)).toBe(false);
  });

  it('error codes: exists, not-found, name-mismatch, invalid, bad-slug', async () => {
    const dir = tmp.make();
    await createSnippet(doc(), dir);

    expect(await codeOf(createSnippet(doc(), dir))).toBe('exists');
    expect(await codeOf(createSnippet({ name: 'x' }, dir))).toBe('invalid');
    expect(await codeOf(createSnippet(doc({ name: 'x', markdown: ' ' }), dir))).toBe('invalid');

    expect(await codeOf(readSnippet('nope', dir))).toBe('not-found');
    expect(await codeOf(writeSnippet('nope', doc({ name: 'nope' }), dir))).toBe('not-found');
    expect(await codeOf(deleteSnippet('nope', dir))).toBe('not-found');

    expect(await codeOf(writeSnippet('my-snippet', doc({ name: 'renamed' }), dir))).toBe(
      'name-mismatch',
    );
    expect(await codeOf(readSnippet('../etc', dir))).toBe('bad-slug');
    expect((await readSnippet('my-snippet', dir)).snippet.description).toBe('A snippet');
  });

  it('carries issues on invalid errors and leaves no .tmp files', async () => {
    const dir = tmp.make();
    try {
      await createSnippet(doc({ markdown: '' }), dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SnippetIoError);
      expect((error as SnippetIoError).issues.map((i) => i.path)).toEqual(['markdown']);
    }
    await createSnippet(doc(), dir);
    await codeOf(writeSnippet('my-snippet', doc({ name: 'other' }), dir));
    expect(readdirSync(path.join(dir, 'snippet'))).toEqual(['my-snippet.yaml']);
  });

  it('files round-trip through parseYaml + parseSnippet', async () => {
    const dir = tmp.make();
    const created = await createSnippet(
      doc({ description: 'Has: colon', markdown: '# Title\n\n    code\n\ntrailing\n\n' }),
      dir,
    );
    const source = readFileSync(path.join(dir, 'snippet', 'my-snippet.yaml'), 'utf8');
    const again = parseSnippet(parseYaml(source), 'my-snippet');
    expect(again.ok && again.snippet).toEqual(created.snippet);
  });
});

describe('readSnippet on damaged files', () => {
  it('distinguishes parse errors, schema errors and a stem/name mismatch', async () => {
    const dir = tmp.make({
      'snippet/broken.yaml': 'name: [unclosed\n',
      'snippet/bad-schema.yaml': 'name: bad-schema\ndescription: d\n',
      'snippet/stem.yaml': 'name: other\ndescription: d\nmarkdown: m\n',
    });
    expect(await codeOf(readSnippet('broken', dir))).toBe('parse');
    expect(await codeOf(readSnippet('bad-schema', dir))).toBe('invalid');
    expect(await codeOf(readSnippet('stem', dir))).toBe('invalid');
  });
});

describe('listSnippets', () => {
  const OK = 'name: {n}\ndescription: d\nmarkdown: m\n';

  it('lists valid files sorted by slug and reports invalid ones with their issues', async () => {
    const root = tmp.make({
      'snippet/b.yaml': OK.replace('{n}', 'b'),
      'snippet/a.yaml': `${schemaCommentLine('snippet', ORIGIN)}\n${OK.replace('{n}', 'a')}`,
      'snippet/bad-schema.yaml': 'name: bad-schema\ndescription: d\n',
      'snippet/wrong-name.yaml': OK.replace('{n}', 'other'),
      'snippet/.hidden.yaml': 'x: 1\n',
      'snippet/notes.txt': 'ignored',
    });
    const { items, invalid } = await listSnippets(root);
    expect(items.map((r) => r.slug)).toEqual(['a', 'b']);
    expect(items[0]?.file).toBe('snippet/a.yaml');
    expect(invalid.map((r) => r.slug)).toEqual(['bad-schema', 'wrong-name']);
    for (const bad of invalid) expect(bad.issues.length).toBeGreaterThan(0);
  });

  it('is empty when the snippet directory does not exist', async () => {
    expect(await listSnippets(tmp.make())).toEqual({ items: [], invalid: [] });
  });
});
