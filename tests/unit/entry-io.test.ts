import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeDoc } from '../../src/lib/doc-io.ts';
import {
  deleteEntry,
  EntryIoError,
  patchEntry,
  readEntry,
  toJsonSafe,
} from '../../src/lib/entry-io.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const TASK = [
  '---',
  'type: Task',
  '# the task',
  'name: do-it',
  'title: Do it',
  'description: >-',
  '  Do the thing,',
  '  folded.',
  'state: in-progress',
  'tags: [a,  b]',
  'x-unknown: {k: [1,2]}',
  'stale_after: 2099-01-01',
  'generated:',
  '  by: process:test',
  '  at: 2026-10-17T11:20:00Z',
  '---',
  '',
  '# Do it',
  '',
  'Body with `code`.',
  '',
].join('\n');

const BARE =
  '---\ntype: Task\nname: bare\ndescription: A bare task.\nstate: pending\n---\n\n# Bare\n';

const SKILL = '---\nname: my-skill\ndescription: A skill.\n---\n\n# My skill\n';

function tree(): { dir: string; read: (rel: string) => string } {
  const dir = tmp.make({
    'task/do-it/index.md': TASK,
    'task/bare/index.md': BARE,
    'project/proj/index.md':
      '---\ntype: Project\nname: proj\ndescription: P.\nstate: pending\n---\n',
    'kb/notes/index.md': '---\ntype: Knowledge Base\nname: notes\ndescription: N.\n---\n',
    'skill/my-skill/SKILL.md': SKILL,
    'task/nofm/index.md': '# no frontmatter\n',
  });
  return { dir, read: (rel) => readFileSync(path.join(dir, ...rel.split('/')), 'utf8') };
}

async function failure(promise: Promise<unknown>): Promise<EntryIoError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EntryIoError) return error;
    throw error;
  }
  throw new Error('expected an EntryIoError, but the call resolved');
}

describe('toJsonSafe', () => {
  it('turns midnight UTC dates into YYYY-MM-DD and other dates into ISO strings, deeply', () => {
    expect(
      toJsonSafe({
        a: new Date('2027-01-01T00:00:00Z'),
        b: [new Date('2026-10-17T11:20:00Z')],
        c: { d: undefined, e: 1 },
      }),
    ).toEqual({ a: '2027-01-01', b: ['2026-10-17T11:20:00.000Z'], c: { e: 1 } });
  });
});

describe('readEntry', () => {
  it('returns JSON-safe frontmatter, the file mtime and no issues for a valid entry', async () => {
    const { dir } = tree();
    const entry = await readEntry('task', 'do-it', dir);
    expect(entry.frontmatter).toMatchObject({
      type: 'Task',
      name: 'do-it',
      description: 'Do the thing, folded.',
      state: 'in-progress',
      tags: ['a', 'b'],
      stale_after: '2099-01-01',
      'x-unknown': { k: [1, 2] },
      generated: { by: 'process:test', at: '2026-10-17T11:20:00.000Z' },
    });
    expect(entry.lastModified).toBe(
      statSync(path.join(dir, 'task', 'do-it', 'index.md')).mtime.toISOString(),
    );
    expect(entry.issues).toEqual([]);
  });

  it('reports schema issues without throwing', async () => {
    const dir = tmp.make({
      'task/bad/index.md': '---\ntype: Task\nname: other\ndescription: d\nstate: done\n---\n',
    });
    const entry = await readEntry('task', 'bad', dir);
    expect(entry.issues.map((i) => i.path).sort()).toEqual(['name', 'state']);
  });

  it('reads a skill', async () => {
    const { dir } = tree();
    const entry = await readEntry('skill', 'my-skill', dir);
    expect(entry.frontmatter).toEqual({ name: 'my-skill', description: 'A skill.' });
  });

  it('maps the failure modes to codes', async () => {
    const { dir } = tree();
    expect((await failure(readEntry('context', 'x', dir))).code).toBe('bad-dataset');
    expect((await failure(readEntry('task', 'Bad Slug', dir))).code).toBe('bad-slug');
    expect((await failure(readEntry('task', 'missing', dir))).code).toBe('not-found');
    const invalid = await failure(readEntry('task', 'nofm', dir));
    expect(invalid.code).toBe('invalid-file');
    expect(invalid.issues[0]?.message).toBe('missing frontmatter');
  });
});

describe('patchEntry: single keys, every other byte untouched', () => {
  it('keeps okf_version (first key) and the navigation sections of the entry index.md', async () => {
    const source =
      '---\nokf_version: "0.2"\ntype: Task\nname: nav\ndescription: d\nstate: pending\n---\n\n# Nav\n\n## Concepts\n\n* [A](/concepts/a.md) - a\n';
    const dir = tmp.make({ 'task/nav/index.md': source });
    await patchEntry('task', 'nav', { state: 'complete' }, dir);
    expect(readFileSync(path.join(dir, 'task', 'nav', 'index.md'), 'utf8')).toBe(
      source.replace('state: pending', 'state: complete'),
    );
  });

  it('state replaces only the state line', async () => {
    const { dir, read } = tree();
    const result = await patchEntry('task', 'do-it', { state: 'pending' }, dir);
    expect(result.changed).toBe(true);
    expect(result.frontmatter.state).toBe('pending');
    expect(read('task/do-it/index.md')).toBe(TASK.replace('state: in-progress', 'state: pending'));
    expect(result.lastModified).toBe(
      statSync(path.join(dir, 'task', 'do-it', 'index.md')).mtime.toISOString(),
    );
  });

  it('title is trimmed and newlines collapsed; null / blank delete it', async () => {
    const { dir, read } = tree();
    await patchEntry('task', 'do-it', { title: '  A  new\n  title ' }, dir);
    expect(read('task/do-it/index.md')).toBe(TASK.replace('title: Do it', 'title: A  new title'));
    await patchEntry('task', 'do-it', { title: null }, dir);
    expect(read('task/do-it/index.md')).toBe(TASK.replace('title: Do it\n', ''));
    await patchEntry('task', 'bare', { title: 'Bare title' }, dir);
    expect(read('task/bare/index.md')).toContain('name: bare\ntitle: Bare title\ndescription:');
    await patchEntry('task', 'bare', { title: '   ' }, dir);
    expect(read('task/bare/index.md')).toBe(BARE);
  });

  it('description replaces a folded scalar as one line', async () => {
    const { dir, read } = tree();
    await patchEntry('task', 'do-it', { description: 'Short one.\nSecond line.' }, dir);
    expect(read('task/do-it/index.md')).toBe(
      TASK.replace(
        'description: >-\n  Do the thing,\n  folded.\n',
        'description: Short one. Second line.\n',
      ),
    );
    expect((await failure(patchEntry('task', 'do-it', { description: '  ' }, dir))).code).toBe(
      'invalid',
    );
    expect(
      (await failure(patchEntry('task', 'do-it', { description: 'x'.repeat(1025) }, dir))).issues[0]
        ?.path,
    ).toBe('description');
  });

  it('tags are normalized, deduplicated and keep the flow style', async () => {
    const { dir, read } = tree();
    await patchEntry('task', 'do-it', { tags: [' Docs ', 'agent notes', 'docs'] }, dir);
    expect(read('task/do-it/index.md')).toBe(
      TASK.replace('tags: [a,  b]', 'tags: [docs, agent-notes]'),
    );
    await patchEntry('task', 'do-it', { tags: [] }, dir);
    expect(read('task/do-it/index.md')).toContain('\ntags: []\n');
    const bad = await failure(patchEntry('task', 'do-it', { tags: ['ok', 'no!'] }, dir));
    expect(bad.issues).toEqual([{ path: 'tags.1', message: expect.stringContaining('"no!"') }]);
    expect((await failure(patchEntry('task', 'do-it', { tags: 'a' }, dir))).code).toBe('invalid');
    // a new tags key is added after description (no state on a kb entry)
    await patchEntry('kb', 'notes', { tags: ['x'] }, dir);
    expect(read('kb/notes/index.md')).toContain('description: N.\ntags: [x]\n');
  });

  it('stale_after is written as a plain date; null and blank delete it', async () => {
    const { dir, read } = tree();
    await patchEntry('task', 'do-it', { stale_after: '2027-03-04' }, dir);
    expect(read('task/do-it/index.md')).toBe(TASK.replace('2099-01-01', '2027-03-04'));
    expect((await readEntry('task', 'do-it', dir)).frontmatter.stale_after).toBe('2027-03-04');
    await patchEntry('task', 'do-it', { stale_after: null }, dir);
    expect(read('task/do-it/index.md')).not.toContain('stale_after');
    for (const bad of ['2027-02-30', '2027-1-1', 'soon', 7]) {
      const error = await failure(patchEntry('task', 'do-it', { stale_after: bad }, dir));
      expect(error.issues[0]?.path, String(bad)).toBe('stale_after');
    }
    await patchEntry('task', 'do-it', { stale_after: '2028-01-01' }, dir);
    await patchEntry('task', 'do-it', { stale_after: '' }, dir);
    expect(read('task/do-it/index.md')).not.toContain('stale_after');
  });

  it('status is draft | stable | deprecated or null', async () => {
    const { dir, read } = tree();
    await patchEntry('kb', 'notes', { status: 'stable' }, dir);
    expect(read('kb/notes/index.md')).toContain('status: stable');
    await patchEntry('kb', 'notes', { status: null }, dir);
    expect(read('kb/notes/index.md')).not.toContain('status');
    expect((await failure(patchEntry('kb', 'notes', { status: 'done' }, dir))).code).toBe(
      'invalid',
    );
  });

  it('applies several keys at once and returns the new frontmatter', async () => {
    const { dir, read } = tree();
    const result = await patchEntry(
      'task',
      'bare',
      { state: 'in-progress', tags: ['x'], title: 'T', stale_after: '2027-01-01' },
      dir,
    );
    expect(read('task/bare/index.md')).toBe(
      '---\ntype: Task\nname: bare\ntitle: T\ndescription: A bare task.\nstate: in-progress\ntags: [x]\nstale_after: 2027-01-01\n---\n\n# Bare\n',
    );
    expect(result.frontmatter).toMatchObject({ state: 'in-progress', tags: ['x'], title: 'T' });
  });
});

describe('patchEntry: time tracking (task, feature, bug, rca)', () => {
  it('time is a flow list of ISO 8601 durations after tags, upper-cased, repeats kept; [] and null delete it', async () => {
    const { dir, read } = tree();
    await patchEntry('task', 'bare', { time: ['pt1h30m', ' PT45M ', 'PT45M'] }, dir);
    expect(read('task/bare/index.md')).toBe(
      '---\ntype: Task\nname: bare\ndescription: A bare task.\nstate: pending\ntime: [PT1H30M, PT45M, PT45M]\n---\n\n# Bare\n',
    );
    expect((await readEntry('task', 'bare', dir)).frontmatter.time).toEqual([
      'PT1H30M',
      'PT45M',
      'PT45M',
    ]);
    // an existing tags key comes first
    await patchEntry('task', 'do-it', { time: ['P1D'] }, dir);
    expect(read('task/do-it/index.md')).toContain('tags: [a,  b]\ntime: [P1D]\n');
    await patchEntry('task', 'bare', { time: [] }, dir);
    expect(read('task/bare/index.md')).not.toContain('time');
    await patchEntry('task', 'do-it', { time: null }, dir);
    expect(read('task/do-it/index.md')).not.toContain('time:');
  });

  it('time refuses anything that is not an ISO 8601 duration, naming the item', async () => {
    const { dir, read } = tree();
    const before = read('task/do-it/index.md');
    const bad = await failure(patchEntry('task', 'do-it', { time: ['PT1H', '1h', 3] }, dir));
    expect(bad.issues.map((i) => i.path)).toEqual(['time.1', 'time.2']);
    expect(bad.issues[0]?.message).toContain('ISO 8601 duration');
    expect((await failure(patchEntry('task', 'do-it', { time: 'PT1H' }, dir))).code).toBe(
      'invalid',
    );
    expect(read('task/do-it/index.md')).toBe(before);
  });

  it('resolved takes any ISO 8601 date or date-time and reads back as written; null and blank delete it', async () => {
    const { dir, read } = tree();
    await patchEntry('task', 'bare', { resolved: '2026-10-19' }, dir);
    expect(read('task/bare/index.md')).toContain('state: pending\nresolved: 2026-10-19\n');
    expect((await readEntry('task', 'bare', dir)).frontmatter.resolved).toBe('2026-10-19');
    // a date-time with seconds is quoted: YAML's timestamp tag would read it back as a UTC Date
    await patchEntry('task', 'bare', { resolved: '2026-10-19T14:30:05+02:00' }, dir);
    expect(read('task/bare/index.md')).toContain('resolved: "2026-10-19T14:30:05+02:00"\n');
    expect((await readEntry('task', 'bare', dir)).frontmatter.resolved).toBe(
      '2026-10-19T14:30:05+02:00',
    );
    for (const ok of ['2026-10-19T14:30', '2026-W42-1', '2026-10', '20261019T1430Z']) {
      await patchEntry('task', 'bare', { resolved: ok }, dir);
      expect((await readEntry('task', 'bare', dir)).frontmatter.resolved, ok).toBe(ok);
      expect((await readEntry('task', 'bare', dir)).issues, ok).toEqual([]);
    }
    // time and resolved together: time first, then resolved
    await patchEntry('task', 'bare', { resolved: null }, dir);
    await patchEntry('task', 'bare', { time: ['PT2H'], resolved: '2026-10-20' }, dir);
    expect(read('task/bare/index.md')).toContain(
      'state: pending\ntime: [PT2H]\nresolved: 2026-10-20\n',
    );
    await patchEntry('task', 'bare', { resolved: '  ' }, dir);
    expect(read('task/bare/index.md')).not.toContain('resolved');
    for (const bad of ['yesterday', '2026-02-30', '2026-10-19T25:00', 20261019]) {
      const error = await failure(patchEntry('task', 'bare', { resolved: bad }, dir));
      expect(error.issues[0]?.path, String(bad)).toBe('resolved');
    }
  });

  it('applies to task, feature, bug and rca only', async () => {
    const dir = tmp.make({
      'rca/outage/index.md': '---\ntype: Root Cause Analysis\nname: outage\ndescription: O.\n---\n',
      'feature/f/index.md': '---\ntype: Feature\nname: f\ndescription: F.\nstate: pending\n---\n',
      'bug/b/index.md': '---\ntype: Bug\nname: b\ndescription: B.\nstate: pending\n---\n',
      'kb/notes/index.md': '---\ntype: Knowledge Base\nname: notes\ndescription: N.\n---\n',
      'project/p/index.md': '---\ntype: Project\nname: p\ndescription: P.\nstate: pending\n---\n',
      'skill/my-skill/SKILL.md': SKILL,
    });
    for (const [ds, slug] of [
      ['rca', 'outage'],
      ['feature', 'f'],
      ['bug', 'b'],
    ] as const) {
      const result = await patchEntry(ds, slug, { time: ['PT1H'], resolved: '2026-10-19' }, dir);
      expect(result.frontmatter, ds).toMatchObject({ time: ['PT1H'], resolved: '2026-10-19' });
    }
    for (const [ds, slug] of [
      ['kb', 'notes'],
      ['project', 'p'],
      ['skill', 'my-skill'],
    ] as const) {
      const error = await failure(patchEntry(ds, slug, { time: ['PT1H'], resolved: '2026' }, dir));
      expect(
        error.issues.map((i) => i.path),
        ds,
      ).toEqual(['time', 'resolved']);
    }
  });
});

describe('patchEntry: links', () => {
  const link = (dataset: string, slug: string, rel = 'related') => ({ dataset, slug, rel });

  it('addLinks adds a links block without touching other keys', async () => {
    const { dir, read } = tree();
    const result = await patchEntry(
      'task',
      'bare',
      { addLinks: [link('kb', 'notes'), { dataset: 'task', slug: 'do-it', rel: 'depends-on' }] },
      dir,
    );
    expect(read('task/bare/index.md')).toBe(
      BARE.replace(
        'state: pending\n',
        'state: pending\nlinks:\n  - dataset: kb\n    slug: notes\n    rel: related\n  - dataset: task\n    slug: do-it\n    rel: depends-on\n',
      ),
    );
    expect(result.frontmatter.links).toEqual([
      { dataset: 'kb', slug: 'notes', rel: 'related' },
      { dataset: 'task', slug: 'do-it', rel: 'depends-on' },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('addLinks appends unless the target is linked (then its rel is replaced in place) and defaults rel to related', async () => {
    const { dir } = tree();
    await patchEntry('project', 'proj', { addLinks: [link('task', 'do-it', 'child')] }, dir);
    await patchEntry('project', 'proj', { addLinks: [{ dataset: 'kb', slug: 'notes' }] }, dir);
    const result = await patchEntry(
      'project',
      'proj',
      { addLinks: [link('task', 'do-it', 'related'), link('task', 'bare', 'child')] },
      dir,
    );
    expect(result.frontmatter.links).toEqual([
      { dataset: 'task', slug: 'do-it', rel: 'related' },
      { dataset: 'kb', slug: 'notes', rel: 'related' },
      { dataset: 'task', slug: 'bare', rel: 'child' },
    ]);
  });

  it('removeLinks removes, drops the key when empty and ignores absent targets', async () => {
    const { dir, read } = tree();
    await patchEntry(
      'project',
      'proj',
      { addLinks: [link('task', 'do-it', 'child'), link('kb', 'notes')] },
      dir,
    );
    const one = await patchEntry(
      'project',
      'proj',
      { removeLinks: [{ dataset: 'task', slug: 'do-it' }] },
      dir,
    );
    expect(one.frontmatter.links).toEqual([{ dataset: 'kb', slug: 'notes', rel: 'related' }]);
    const none = await patchEntry(
      'project',
      'proj',
      { removeLinks: [{ dataset: 'bug', slug: 'zzz' }] },
      dir,
    );
    expect(none.changed).toBe(false);
    const last = await patchEntry(
      'project',
      'proj',
      { removeLinks: [{ dataset: 'kb', slug: 'notes' }] },
      dir,
    );
    expect(last.changed).toBe(true);
    expect(last.frontmatter).not.toHaveProperty('links');
    expect(read('project/proj/index.md')).toBe(
      '---\ntype: Project\nname: proj\ndescription: P.\nstate: pending\n---\n',
    );
  });

  it('links replaces the whole list; [] deletes the key', async () => {
    const { dir } = tree();
    await patchEntry('project', 'proj', { addLinks: [link('task', 'do-it', 'child')] }, dir);
    const replaced = await patchEntry('project', 'proj', { links: [link('kb', 'notes')] }, dir);
    expect(replaced.frontmatter.links).toEqual([{ dataset: 'kb', slug: 'notes', rel: 'related' }]);
    const cleared = await patchEntry('project', 'proj', { links: [] }, dir);
    expect(cleared.frontmatter).not.toHaveProperty('links');
  });

  it('rejects self links, duplicates, unknown datasets, mixed modes and skills', async () => {
    const { dir } = tree();
    const self = await failure(
      patchEntry('task', 'bare', { addLinks: [link('task', 'bare')] }, dir),
    );
    expect(self.issues).toEqual([
      { path: 'addLinks.0', message: 'an entry cannot link to itself' },
    ]);

    const dup = await failure(
      patchEntry(
        'project',
        'proj',
        { links: [link('kb', 'notes'), link('kb', 'notes', 'child')] },
        dir,
      ),
    );
    expect(dup.issues).toEqual([{ path: 'links.1', message: 'duplicate link kb/notes' }]);

    const bad = await failure(
      patchEntry(
        'project',
        'proj',
        {
          links: [
            { dataset: 'context', slug: 'x' },
            { dataset: 'kb', slug: 'Bad' },
          ],
        },
        dir,
      ),
    );
    expect(bad.issues.map((i) => i.path)).toEqual(['links.0.dataset', 'links.1.slug']);

    const mixed = await failure(
      patchEntry('project', 'proj', { links: [], addLinks: [link('kb', 'notes')] }, dir),
    );
    expect(mixed.code).toBe('invalid');
    const skill = await failure(
      patchEntry('skill', 'my-skill', { addLinks: [link('kb', 'notes')] }, dir),
    );
    expect(skill.issues[0]?.path).toBe('addLinks');
  });

  it('warns about a missing target but still writes', async () => {
    const { dir } = tree();
    const result = await patchEntry('task', 'bare', { addLinks: [link('idea', 'e2e-nope')] }, dir);
    expect(result.changed).toBe(true);
    expect(result.warnings).toMatchObject([
      { rule: 'links/relation-target', message: expect.stringContaining('idea/e2e-nope') },
    ]);
  });
});

describe('patchEntry: validation, nothing written', () => {
  it('rejects keys that do not exist or do not apply to the dataset', async () => {
    const { dir, read } = tree();
    const before = read('task/do-it/index.md');
    const unknown = await failure(patchEntry('task', 'do-it', { nope: 1 }, dir));
    expect(unknown.issues).toEqual([{ path: 'nope', message: 'unexpected property' }]);
    expect(
      (await failure(patchEntry('kb', 'notes', { state: 'pending' }, dir))).issues[0]?.path,
    ).toBe('state');
    const skill = await failure(
      patchEntry('skill', 'my-skill', { tags: ['a'], title: 'T', state: 'pending' }, dir),
    );
    expect(skill.issues.map((i) => i.path)).toEqual(['state', 'title', 'tags']);
    expect((await failure(patchEntry('task', 'do-it', {}, dir))).code).toBe('invalid');
    expect(
      (
        await failure(
          patchEntry('task', 'do-it', { ifUnmodifiedSince: new Date().toISOString() }, dir),
        )
      ).code,
    ).toBe('invalid');
    expect((await failure(patchEntry('task', 'do-it', [], dir))).code).toBe('invalid');
    expect(read('task/do-it/index.md')).toBe(before);
  });

  it('rejects a state that is not a lifecycle state of the dataset', async () => {
    const { dir, read } = tree();
    const before = read('task/do-it/index.md');
    for (const state of ['done', 'fixed', 5, null]) {
      const error = await failure(patchEntry('task', 'do-it', { state }, dir));
      expect(error.issues[0]?.path, String(state)).toBe('state');
    }
    expect(read('task/do-it/index.md')).toBe(before);
  });

  it('refuses to write when the patched frontmatter still fails the schema', async () => {
    const dir = tmp.make({
      'task/odd/index.md':
        '---\ntype: Task\nname: odd\ndescription: d\nstate: pending\ntags: 5\n---\n',
    });
    const file = path.join(dir, 'task', 'odd', 'index.md');
    const before = readFileSync(file, 'utf8');
    const error = await failure(patchEntry('task', 'odd', { state: 'complete' }, dir));
    expect(error.code).toBe('invalid');
    expect(error.issues.map((i) => i.path)).toEqual(['tags']);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('can repair an invalid file when the patch fixes every problem', async () => {
    const dir = tmp.make({
      'task/odd/index.md': '---\ntype: Task\nname: odd\ndescription: d\nstate: done\n---\n',
    });
    const result = await patchEntry('task', 'odd', { state: 'complete' }, dir);
    expect(result.changed).toBe(true);
    expect((await readEntry('task', 'odd', dir)).issues).toEqual([]);
  });

  it('answers invalid-file for a missing, broken or non-mapping frontmatter and not-found for no file', async () => {
    const dir = tmp.make({
      'task/nofm/index.md': '# nothing\n',
      'task/dup/index.md': '---\ntype: Task\nname: dup\nname: dup\ndescription: d\n---\n',
      'task/list/index.md': '---\n- a\n---\n',
    });
    for (const slug of ['nofm', 'dup', 'list']) {
      const error = await failure(patchEntry('task', slug, { state: 'pending' }, dir));
      expect(error.code, slug).toBe('invalid-file');
    }
    expect((await failure(patchEntry('task', 'gone', { state: 'pending' }, dir))).code).toBe(
      'not-found',
    );
    expect((await failure(patchEntry('nope', 'x', { state: 'pending' }, dir))).code).toBe(
      'bad-dataset',
    );
    expect((await failure(patchEntry('task', 'X', { state: 'pending' }, dir))).code).toBe(
      'bad-slug',
    );
  });

  it('skills accept only description', async () => {
    const { dir, read } = tree();
    const result = await patchEntry('skill', 'my-skill', { description: 'Does more.' }, dir);
    expect(result.frontmatter).toEqual({ name: 'my-skill', description: 'Does more.' });
    expect(read('skill/my-skill/SKILL.md')).toBe(SKILL.replace('A skill.', 'Does more.'));
  });
});

describe('patchEntry: no-op and conflicts', () => {
  it('writes nothing when the patch equals the current frontmatter', async () => {
    const { dir, read } = tree();
    const file = path.join(dir, 'task', 'do-it', 'index.md');
    const old = new Date('2026-01-02T03:04:05.678Z');
    utimesSync(file, old, old);
    const result = await patchEntry(
      'task',
      'do-it',
      {
        state: 'in-progress',
        tags: ['a', 'b'],
        stale_after: '2099-01-01',
        description: 'Do the thing, folded.',
        title: 'Do it',
      },
      dir,
    );
    expect(result.changed).toBe(false);
    expect(result.lastModified).toBe(old.toISOString());
    expect(statSync(file).mtime.toISOString()).toBe(old.toISOString());
    expect(read('task/do-it/index.md')).toBe(TASK);
  });

  it('ifUnmodifiedSince must equal the file mtime', async () => {
    const { dir } = tree();
    const file = path.join(dir, 'task', 'do-it', 'index.md');
    const stamp = new Date('2026-05-06T07:08:09.123Z');
    utimesSync(file, stamp, stamp);

    const stale = await failure(
      patchEntry(
        'task',
        'do-it',
        { state: 'pending', ifUnmodifiedSince: '2026-05-06T07:08:09.000Z' },
        dir,
      ),
    );
    expect(stale.code).toBe('conflict');
    expect(stale.lastModified).toBe(stamp.toISOString());
    expect(readFileSync(file, 'utf8')).toBe(TASK);

    const ok = await patchEntry(
      'task',
      'do-it',
      { state: 'pending', ifUnmodifiedSince: stamp.toISOString() },
      dir,
    );
    expect(ok.changed).toBe(true);
    // The new mtime is the next base; the old one is now stale.
    const again = await failure(
      patchEntry(
        'task',
        'do-it',
        { state: 'complete', ifUnmodifiedSince: stamp.toISOString() },
        dir,
      ),
    );
    expect(again.code).toBe('conflict');
    expect(again.lastModified).toBe(ok.lastModified);
    expect(
      (
        await failure(
          patchEntry('task', 'do-it', { state: 'complete', ifUnmodifiedSince: 'soon' }, dir),
        )
      ).code,
    ).toBe('invalid');
  });

  it('keeps the file mode', async () => {
    const { dir } = tree();
    const file = path.join(dir, 'task', 'bare', 'index.md');
    chmodSync(file, 0o600);
    await patchEntry('task', 'bare', { state: 'pending' }, dir);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('patchEntry: the per-file lock serializes concurrent patches', () => {
  it('two concurrent patches of different keys both land', async () => {
    const { dir } = tree();
    await Promise.all([
      patchEntry('task', 'bare', { state: 'in-progress' }, dir),
      patchEntry('task', 'bare', { tags: ['x'] }, dir),
      patchEntry('task', 'bare', { title: 'Concurrent' }, dir),
    ]);
    const { frontmatter, issues } = await readEntry('task', 'bare', dir);
    expect(frontmatter).toMatchObject({ state: 'in-progress', tags: ['x'], title: 'Concurrent' });
    expect(issues).toEqual([]);
  });

  it('many concurrent addLinks lose no link', async () => {
    const dir = tmp.make({
      'project/proj/index.md':
        '---\ntype: Project\nname: proj\ndescription: P.\nstate: pending\n---\n',
    });
    const slugs = Array.from({ length: 15 }, (_, i) => `t-${i}`);
    await Promise.all(
      slugs.map((slug) =>
        patchEntry('project', 'proj', { addLinks: [{ dataset: 'task', slug, rel: 'child' }] }, dir),
      ),
    );
    const links = (await readEntry('project', 'proj', dir)).frontmatter.links as { slug: string }[];
    expect(links.map((l) => l.slug).sort()).toEqual([...slugs].sort());
  });

  it('a failing patch does not poison the queue', async () => {
    const { dir } = tree();
    const results = await Promise.allSettled([
      patchEntry('task', 'bare', { state: 'nope' }, dir),
      patchEntry('task', 'bare', { state: 'complete' }, dir),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
  });

  it('shares the lock with the doc editor: a PATCH and a PUT of the same index.md cannot both pass the mtime guard', async () => {
    const { dir } = tree();
    const file = path.join(dir, 'task', 'bare', 'index.md');
    const old = new Date('2026-01-02T03:04:05.000Z');
    utimesSync(file, old, old);
    const base = old.toISOString();
    const results = await Promise.allSettled([
      patchEntry('task', 'bare', { state: 'complete', ifUnmodifiedSince: base }, dir),
      writeDoc(
        'task',
        'bare',
        'index.md',
        { markdown: `${BARE}\nEdited.\n`, ifUnmodifiedSince: base },
        dir,
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });
});

describe('deleteEntry', () => {
  it('removes the whole bundle folder', async () => {
    const { dir } = tree();
    mkdirSync(path.join(dir, 'task', 'do-it', 'concepts'), { recursive: true });
    writeFileSync(path.join(dir, 'task', 'do-it', 'concepts', 'a.md'), '---\ntype: X\n---\n');
    await deleteEntry('task', 'do-it', dir);
    expect(existsSync(path.join(dir, 'task', 'do-it'))).toBe(false);
    expect(existsSync(path.join(dir, 'task', 'bare', 'index.md'))).toBe(true);
  });

  it('removes a skill folder', async () => {
    const { dir } = tree();
    await deleteEntry('skill', 'my-skill', dir);
    expect(existsSync(path.join(dir, 'skill', 'my-skill'))).toBe(false);
  });

  it('is not-found for a missing entry, bad-slug / bad-dataset for invalid input', async () => {
    const { dir } = tree();
    expect((await failure(deleteEntry('task', 'missing', dir))).code).toBe('not-found');
    expect((await failure(deleteEntry('task', 'Not Valid', dir))).code).toBe('bad-slug');
    expect((await failure(deleteEntry('task', '..', dir))).code).toBe('bad-slug');
    expect((await failure(deleteEntry('task', '../kb', dir))).code).toBe('bad-slug');
    expect((await failure(deleteEntry('reference', 'x', dir))).code).toBe('bad-dataset');
    expect(existsSync(path.join(dir, 'kb', 'notes', 'index.md'))).toBe(true);
  });

  it('refuses a symlinked bundle dir and leaves the link target alone', async () => {
    const { dir } = tree();
    const outside = tmp.make({ 'keep/index.md': 'keep\n' });
    symlinkSync(path.join(outside, 'keep'), path.join(dir, 'task', 'linked'), 'dir');
    expect((await failure(deleteEntry('task', 'linked', dir))).code).toBe('not-found');
    expect(existsSync(path.join(outside, 'keep', 'index.md'))).toBe(true);
    // a symlink to another entry inside the data dir is refused as well
    symlinkSync(path.join(dir, 'task', 'bare'), path.join(dir, 'task', 'alias'), 'dir');
    expect((await failure(deleteEntry('task', 'alias', dir))).code).toBe('not-found');
    expect(existsSync(path.join(dir, 'task', 'bare', 'index.md'))).toBe(true);
  });

  it('refuses a plain file named like an entry', async () => {
    const { dir } = tree();
    writeFileSync(path.join(dir, 'task', 'afile'), 'x');
    expect((await failure(deleteEntry('task', 'afile', dir))).code).toBe('not-found');
    expect(existsSync(path.join(dir, 'task', 'afile'))).toBe(true);
  });
});
