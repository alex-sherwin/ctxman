import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendContextLinks,
  backRefs,
  ContextIoError,
  contextFile,
  createContext,
  deleteContext,
  listContexts,
  readContext,
  serializeContext,
  validateContext,
  writeContext,
} from '../../src/lib/context-io.ts';
import { withSchemaComment } from '../../src/lib/schema-comment.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const ORIGIN = 'http://127.0.0.1:4321';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ContextIoError) return error.code;
    throw error;
  }
  return 'resolved';
}

const doc = (overrides: Record<string, unknown> = {}) => ({
  name: 'my-ctx',
  description: 'A context',
  tags: ['a'],
  links: [
    { dataset: 'kb', slug: 'ctxman', notes: 'Read the overview.\nThen skim details.' },
    { dataset: 'task', slug: 'do-it' },
  ],
  ...overrides,
});

describe('contextFile', () => {
  it('returns data/context/<slug>.yaml and rejects non-kebab slugs', () => {
    const root = path.resolve('/data-root');
    expect(contextFile('my-ctx', root)).toBe(path.join(root, 'context', 'my-ctx.yaml'));
    for (const bad of ['', 'A', '../x', 'a/b', 'a.b', '-a', 'a'.repeat(65)]) {
      expect(() => contextFile(bad, root), bad).toThrow(ContextIoError);
    }
    try {
      contextFile('../x', root);
    } catch (error) {
      expect((error as ContextIoError).code).toBe('bad-slug');
    }
  });
});

describe('validateContext', () => {
  it('accepts a valid document, filling defaults', () => {
    const r = validateContext({ name: 'c', description: 'd' }, 'c');
    expect(r).toMatchObject({ ok: true, context: { name: 'c', tags: [], links: [] } });
  });

  it('returns issues with dotted paths for schema violations', () => {
    const r = validateContext(
      { name: 'c', description: '', links: [{ dataset: 'context', slug: 'Bad_Slug' }] },
      'c',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid');
      const paths = r.issues.map((i) => i.path);
      expect(paths).toContain('description');
      expect(paths).toContain('links.0.dataset');
      expect(paths).toContain('links.0.slug');
    }
  });

  it('says "Required" for missing fields and rejects duplicate links', () => {
    const missing = validateContext({}, 'c');
    expect(missing.ok === false && missing.issues).toContainEqual({
      path: 'name',
      message: 'Required',
    });
    const dup = validateContext(
      {
        name: 'c',
        description: 'd',
        links: [
          { dataset: 'kb', slug: 'a' },
          { dataset: 'kb', slug: 'a' },
        ],
      },
      'c',
    );
    expect(dup.ok).toBe(false);
    expect(dup.ok === false && dup.issues[0]?.path).toBe('links.1');
  });

  it('reports name-mismatch when name differs from the slug', () => {
    const r = validateContext({ name: 'other', description: 'd' }, 'c');
    expect(r).toMatchObject({ ok: false, code: 'name-mismatch' });
  });

  it('rejects non-object input', () => {
    expect(validateContext('nope', 'c')).toMatchObject({ ok: false, code: 'invalid' });
    expect(validateContext(null, 'c')).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('serializeContext', () => {
  const parse = (input: unknown) => {
    const r = validateContext(input, 'c');
    if (!r.ok) throw new Error('invalid test input');
    return r.context;
  };

  it('uses the fixed key order and omits empty tags and blank notes', () => {
    const out = serializeContext(
      parse({
        name: 'c',
        description: 'd',
        links: [
          { dataset: 'kb', slug: 'a', notes: '   \n' },
          { dataset: 'kb', slug: 'b', notes: '' },
          { dataset: 'rca', slug: 'c' },
        ],
      }),
    );
    expect(out).toBe(
      'name: c\ndescription: d\nlinks:\n  - dataset: kb\n    slug: a\n  - dataset: kb\n    slug: b\n  - dataset: rca\n    slug: c\n',
    );
  });

  it('writes tags when present and notes as literal blocks with one trailing newline', () => {
    const out = serializeContext(
      parse({
        name: 'c',
        description: 'd',
        tags: ['x', 'y'],
        links: [
          { dataset: 'kb', slug: 'a', notes: 'Line one.\r\n- bullet\n\n\n' },
          { dataset: 'kb', slug: 'b', notes: 'single line   ' },
        ],
      }),
    );
    expect(out).toBe(
      [
        'name: c',
        'description: d',
        'tags:',
        '  - x',
        '  - y',
        'links:',
        '  - dataset: kb',
        '    slug: a',
        '    notes: |',
        '      Line one.',
        '      - bullet',
        '  - dataset: kb',
        '    slug: b',
        '    notes: |',
        '      single line',
        '',
      ].join('\n'),
    );
  });

  it('round-trips through parseYaml + validateContext', () => {
    const original = parse(doc({ name: 'c' }));
    const again = parse(parseYaml(serializeContext(original)));
    expect(again).toEqual({
      ...original,
      links: original.links.map((l) => (l.notes ? { ...l, notes: `${l.notes.trimEnd()}\n` } : l)),
    });
  });
});

describe('notes survive a write/read round trip', () => {
  const nasty = [
    'plain',
    '- a bullet list\n- second item\n\n```ts\nconst x = 1;\n```',
    '\n\nleading blank lines',
    '   leading spaces on the first line\n  and a second',
    'trailing spaces   \nstay inside lines',
    'colon: and # hash and "quotes" and \'single\'',
    '---\nnot a document marker\n---',
    'unicode \u2713 \u00e9 \ud83d\ude80',
    'tab\there',
    `a very long line ${'word '.repeat(80)}end`,
    '| a | b |\n|---|---|\n| 1 | 2 |',
    '*not an alias &not-an-anchor !tag',
  ];

  it.each(nasty)('%j', async (notes) => {
    const dir = tmp.make();
    await createContext(
      { name: 'n', description: 'd', links: [{ dataset: 'kb', slug: 'a', notes }] },
      dir,
    );
    const stored = (await readContext('n', dir)).context.links[0]?.notes;
    expect(stored).toBe(`${notes.replace(/\r\n?/g, '\n').trimEnd()}\n`);
  });

  it('keeps multi-line and special-character descriptions and tags intact', async () => {
    const dir = tmp.make();
    const description = 'first line: with colon\nsecond line # not a comment';
    await createContext({ name: 'd', description, tags: ['a b', 'c:d', 'yes', '123'] }, dir);
    const { context } = await readContext('d', dir);
    expect(context.description).toBe(description);
    expect(context.tags).toEqual(['a b', 'c:d', 'yes', '123']);
  });
});

describe('create / read / write / delete cycle', () => {
  it('creates, reads, rewrites and deletes a context', async () => {
    const dir = tmp.make();

    const created = await createContext(doc(), dir);
    expect(created.slug).toBe('my-ctx');
    expect(created.file).toBe('context/my-ctx.yaml');
    expect(created.context.links).toHaveLength(2);
    const file = path.join(dir, 'context', 'my-ctx.yaml');
    expect(readFileSync(file, 'utf8')).toContain(
      'notes: |\n      Read the overview.\n      Then skim details.\n',
    );
    // The file starts with the yaml-language-server comment; the serializer itself stays comment-free.
    expect(readFileSync(file, 'utf8')).toBe(
      withSchemaComment('context', serializeContext(created.context), ORIGIN),
    );
    expect(serializeContext(created.context).startsWith('#')).toBe(false);

    const read = await readContext('my-ctx', dir);
    expect(read.context).toEqual({
      name: 'my-ctx',
      description: 'A context',
      tags: ['a'],
      links: [
        { dataset: 'kb', slug: 'ctxman', notes: 'Read the overview.\nThen skim details.\n' },
        { dataset: 'task', slug: 'do-it' },
      ],
    });
    expect(Number.isNaN(Date.parse(read.lastModified))).toBe(false);

    const written = await writeContext(
      'my-ctx',
      doc({ description: 'Changed', links: [{ dataset: 'skill', slug: 'okf-authoring' }] }),
      dir,
    );
    expect(written.context.description).toBe('Changed');
    const rewritten = readFileSync(file, 'utf8');
    expect(rewritten).toBe(withSchemaComment('context', serializeContext(written.context), ORIGIN));
    expect(rewritten.split('\n')[0]).toBe(
      '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/context',
    );
    expect((await readContext('my-ctx', dir)).context.links).toEqual([
      { dataset: 'skill', slug: 'okf-authoring' },
    ]);

    await deleteContext('my-ctx', dir);
    expect(existsSync(file)).toBe(false);
  });

  it('error codes: exists, not-found, name-mismatch, invalid, bad-slug', async () => {
    const dir = tmp.make();
    await createContext(doc(), dir);

    expect(await codeOf(createContext(doc(), dir))).toBe('exists');
    expect(await codeOf(createContext({ name: 'x' }, dir))).toBe('invalid');
    expect(await codeOf(createContext(doc({ name: 'Bad Name' }), dir))).toBe('invalid');

    expect(await codeOf(readContext('nope', dir))).toBe('not-found');
    expect(await codeOf(writeContext('nope', doc({ name: 'nope' }), dir))).toBe('not-found');
    expect(await codeOf(deleteContext('nope', dir))).toBe('not-found');

    expect(await codeOf(writeContext('my-ctx', doc({ name: 'renamed' }), dir))).toBe(
      'name-mismatch',
    );
    expect(await codeOf(writeContext('my-ctx', { name: 'my-ctx' }, dir))).toBe('invalid');
    expect(await codeOf(readContext('../etc', dir))).toBe('bad-slug');
    expect(await codeOf(deleteContext('A', dir))).toBe('bad-slug');

    // failed writes leave the original untouched
    expect((await readContext('my-ctx', dir)).context.description).toBe('A context');
  });

  it('carries issues on invalid errors', async () => {
    const dir = tmp.make();
    try {
      await createContext(
        { name: 'c', description: '', links: [{ dataset: 'x', slug: 'y' }] },
        dir,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ContextIoError);
      expect((error as ContextIoError).issues.map((i) => i.path)).toContain('links.0.dataset');
    }
  });

  it('writes atomically: no .tmp files remain, even after a failed write', async () => {
    const dir = tmp.make();
    await createContext(doc(), dir);
    await writeContext('my-ctx', doc({ description: 'v2' }), dir);
    await codeOf(writeContext('my-ctx', doc({ name: 'other' }), dir));
    expect(readdirSync(path.join(dir, 'context'))).toEqual(['my-ctx.yaml']);
  });

  it('create makes the context directory when it is missing', async () => {
    const dir = tmp.make();
    expect(existsSync(path.join(dir, 'context'))).toBe(false);
    await createContext(doc(), dir);
    expect(existsSync(path.join(dir, 'context', 'my-ctx.yaml'))).toBe(true);
  });
});

describe('readContext on damaged files', () => {
  it('distinguishes parse errors, schema errors and a stem/name mismatch', async () => {
    const dir = tmp.make({
      'context/broken.yaml': 'name: [unclosed\n',
      'context/bad-schema.yaml': 'name: bad-schema\ndescription: ""\nlinks: nope\n',
      'context/stem.yaml': 'name: other\ndescription: d\n',
    });
    expect(await codeOf(readContext('broken', dir))).toBe('parse');
    expect(await codeOf(readContext('bad-schema', dir))).toBe('invalid');
    expect(await codeOf(readContext('stem', dir))).toBe('invalid');
  });
});

describe('listContexts', () => {
  it('returns [] for a missing context directory', async () => {
    expect(await listContexts(tmp.make())).toEqual({ items: [], errors: [] });
  });

  it('sorts by slug and reports invalid files in errors instead of throwing', async () => {
    const dir = tmp.make({
      'context/zeta.yaml': 'name: zeta\ndescription: z\n',
      'context/alpha.yaml': 'name: alpha\ndescription: a\nlinks:\n  - dataset: kb\n    slug: x\n',
      'context/broken.yaml': 'name: [oops\n',
      'context/mismatch.yaml': 'name: other\ndescription: d\n',
      'context/notes.txt': 'ignored',
      'context/old.yml': 'name: old\ndescription: ignored\n',
    });
    const { items, errors } = await listContexts(dir);
    expect(items.map((i) => i.slug)).toEqual(['alpha', 'zeta']);
    expect(items[0]?.context.links).toEqual([{ dataset: 'kb', slug: 'x' }]);
    expect(errors.map((e) => e.file)).toEqual(['context/broken.yaml', 'context/mismatch.yaml']);
    expect(errors.every((e) => e.message.length > 0)).toBe(true);
  });
});

describe('backRefs', () => {
  it('lists contexts that link to an entry, with non-blank notes', async () => {
    const dir = tmp.make();
    await createContext(
      {
        name: 'a-ctx',
        description: 'First',
        links: [
          { dataset: 'kb', slug: 'x', notes: 'Use for overview.' },
          { dataset: 'task', slug: 't' },
        ],
      },
      dir,
    );
    await createContext(
      { name: 'b-ctx', description: 'Second', links: [{ dataset: 'kb', slug: 'x', notes: '  ' }] },
      dir,
    );
    await createContext(
      { name: 'c-ctx', description: 'Third', links: [{ dataset: 'kb', slug: 'y' }] },
      dir,
    );
    const { items } = await listContexts(dir);

    expect(backRefs(items, 'kb', 'x')).toEqual([
      { context: 'a-ctx', description: 'First', notes: 'Use for overview.\n' },
      { context: 'b-ctx', description: 'Second' },
    ]);
    expect(backRefs(items, 'task', 't')).toEqual([{ context: 'a-ctx', description: 'First' }]);
    expect(backRefs(items, 'skill', 'x')).toEqual([]);
    expect(backRefs([], 'kb', 'x')).toEqual([]);
  });
});

describe('unused-path guard', () => {
  it('does not touch directories outside the data dir', async () => {
    const dir = tmp.make();
    mkdirSync(path.join(dir, 'context'));
    writeFileSync(path.join(dir, 'context', 'keep.yaml'), 'name: keep\ndescription: d\n');
    await expect(readContext('../keep', dir)).rejects.toBeInstanceOf(ContextIoError);
  });
});

describe('appendContextLinks', () => {
  const issuesOf = async (promise: Promise<unknown>): Promise<string[]> => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ContextIoError) return error.issues.map((i) => i.path);
      throw error;
    }
    return [];
  };

  it('appends new links, skips present ones (notes untouched) and writes the context atomically', async () => {
    const dir = tmp.make();
    await createContext(doc(), dir);
    const before = readContext('my-ctx', dir);
    const result = await appendContextLinks(
      'my-ctx',
      {
        links: [
          { dataset: 'kb', slug: 'ctxman', notes: 'REPLACED?' },
          { dataset: 'task', slug: 'w2-demo', notes: 'x' },
          { dataset: 'bug', slug: 'b' },
          { dataset: 'task', slug: 'w2-demo' },
        ],
      },
      dir,
    );
    expect(result.added).toEqual(['task/w2-demo', 'bug/b']);
    expect(result.skipped).toEqual(['kb/ctxman', 'task/w2-demo']);
    expect(result.record.context.links).toEqual([
      { dataset: 'kb', slug: 'ctxman', notes: 'Read the overview.\nThen skim details.\n' },
      { dataset: 'task', slug: 'do-it' },
      { dataset: 'task', slug: 'w2-demo', notes: 'x\n' },
      { dataset: 'bug', slug: 'b' },
    ]);
    const reread = await readContext('my-ctx', dir);
    expect(reread.context).toEqual(result.record.context);
    expect(reread.lastModified).toBe(result.record.lastModified);
    expect(reread.context.description).toBe((await before).context.description);
    expect(readdirSync(path.join(dir, 'context'))).toEqual(['my-ctx.yaml']);
    expect(readFileSync(path.join(dir, 'context', 'my-ctx.yaml'), 'utf8').split('\n')[0]).toContain(
      'yaml-language-server',
    );
  });

  it('writes nothing when every target is already linked', async () => {
    const dir = tmp.make();
    await createContext(doc(), dir);
    const file = path.join(dir, 'context', 'my-ctx.yaml');
    const old = new Date('2026-01-02T03:04:05.000Z');
    utimesSync(file, old, old);
    const result = await appendContextLinks(
      'my-ctx',
      { links: [{ dataset: 'task', slug: 'do-it' }] },
      dir,
    );
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(['task/do-it']);
    expect(statSync(file).mtime.toISOString()).toBe(old.toISOString());
    expect(result.record.lastModified).toBe(old.toISOString());
  });

  it('validates the body before touching the file: paths links.N.*', async () => {
    const dir = tmp.make();
    await createContext(doc(), dir);
    const text = readFileSync(path.join(dir, 'context', 'my-ctx.yaml'), 'utf8');
    expect(await issuesOf(appendContextLinks('my-ctx', { links: [] }, dir))).toEqual(['links']);
    expect(await issuesOf(appendContextLinks('my-ctx', {}, dir))).toEqual(['links']);
    expect(await issuesOf(appendContextLinks('my-ctx', null, dir))).toEqual(['']);
    expect(
      await issuesOf(
        appendContextLinks('my-ctx', { links: [{ dataset: 'kb', slug: 'a' }], extra: 1 }, dir),
      ),
    ).toEqual(['extra']);
    expect(
      await issuesOf(
        appendContextLinks(
          'my-ctx',
          {
            links: [
              { dataset: 'kb', slug: 'ok' },
              { dataset: 'context', slug: 'x' },
              { dataset: 'kb', slug: 'Bad', foo: 1 },
            ],
          },
          dir,
        ),
      ),
    ).toEqual(['links.1.dataset', 'links.2.slug', 'links.2']);
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ dataset: 'kb', slug: `s-${i}` }));
    expect(await issuesOf(appendContextLinks('my-ctx', { links: tooMany }, dir))).toEqual([
      'links',
    ]);
    expect(readFileSync(path.join(dir, 'context', 'my-ctx.yaml'), 'utf8')).toBe(text);
  });

  it('bad-slug, not-found and invalid-file (the existing file does not parse / validate)', async () => {
    const dir = tmp.make({
      'context/broken.yaml': 'name: [unclosed\n',
      'context/bad-schema.yaml': 'name: bad-schema\ndescription: ""\nlinks: nope\n',
    });
    const body = { links: [{ dataset: 'kb', slug: 'a' }] };
    expect(await codeOf(appendContextLinks('Bad Slug', body, dir))).toBe('bad-slug');
    expect(await codeOf(appendContextLinks('gone', body, dir))).toBe('not-found');
    expect(await codeOf(appendContextLinks('broken', body, dir))).toBe('invalid-file');
    expect(await codeOf(appendContextLinks('bad-schema', body, dir))).toBe('invalid-file');
  });

  it('concurrent appends lose no link', async () => {
    const dir = tmp.make();
    await createContext(doc({ links: [] }), dir);
    const slugs = Array.from({ length: 12 }, (_, i) => `t-${i}`);
    await Promise.all(
      slugs.map((slug) =>
        appendContextLinks('my-ctx', { links: [{ dataset: 'task', slug }] }, dir),
      ),
    );
    const record = await readContext('my-ctx', dir);
    expect(record.context.links.map((l) => l.slug).sort()).toEqual([...slugs].sort());
  });
});
