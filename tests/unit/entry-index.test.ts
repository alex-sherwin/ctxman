import { statSync, utimesSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEntryIndex, invalidateEntryIndex } from '../../src/lib/entry-index.ts';
import { entryAbsPath, lastModifiedOf } from '../../src/lib/freshness.ts';
import { trackTemp, validDataTree, writeTree } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => {
  vi.useRealTimers();
  tmp.cleanup();
});

const okf = (type: string, name: string, extra = '', body = '\n# T\n'): string =>
  `---\ntype: ${type}\nname: ${name}\ndescription: Entry ${name}.\n${extra}---\n${body}`;
const task = (name: string, extra = '', body?: string): string =>
  okf('Task', name, `state: pending\n${extra}`, body);

/** Fresh, uncached read: drops the 200 ms memo first (the per-directory cache stays). */
async function fresh(dir: string) {
  invalidateEntryIndex(dir);
  return getEntryIndex(dir);
}

function bump(abs: string, seconds = 10): void {
  const t = new Date(statSync(abs).mtimeMs + seconds * 1000);
  utimesSync(abs, t, t);
}

describe('getEntryIndex: entries', () => {
  it('lists okf and skill entries in registry dataset order, then slug', async () => {
    const dir = tmp.make({
      ...validDataTree(),
      'task/aaa/index.md': task('aaa'),
      'project/p/index.md': okf('Project', 'p', 'state: pending\n'),
      'kb/another/index.md': okf('Knowledge Base', 'another'),
    });
    const index = await getEntryIndex(dir);
    expect(index.entries.map((e) => `${e.dataset}/${e.slug}`)).toEqual([
      'kb/another',
      'kb/demo',
      'task/aaa',
      'task/do-it',
      'project/p',
      'skill/my-skill',
    ]);
    expect([...index.byKey.keys()].sort()).toEqual(
      index.entries.map((e) => `${e.dataset}/${e.slug}`).sort(),
    );
    expect(index.byKey.get('task/do-it')?.file).toBe('task/do-it/index.md');
    expect(index.byKey.get('skill/my-skill')?.file).toBe('skill/my-skill/SKILL.md');
    expect(index.entries.every((e) => e.issues.length === 0)).toBe(true);
  });

  it('exposes the parsed frontmatter (timestamp tag) and the markdown body', async () => {
    const dir = tmp.make(validDataTree());
    const entry = (await getEntryIndex(dir)).byKey.get('kb/demo');
    expect(entry?.data).toMatchObject({
      type: 'Knowledge Base',
      name: 'demo',
      title: 'Demo',
      tags: ['demo'],
    });
    expect((entry?.data.stale_after as Date | undefined)?.toISOString()).toBe(
      '2099-01-01T00:00:00.000Z',
    );
    expect(entry?.body).toContain('# Demo');
    expect(entry?.body).not.toContain('type:');
    expect(entry?.relations).toEqual([]);
  });

  it('skips directories that are not entries (dot names, invalid names, no entry file)', async () => {
    const dir = tmp.make({
      'task/ok/index.md': task('ok'),
      'task/.hidden/index.md': task('hidden'),
      'task/Bad_Name/index.md': task('bad'),
      'task/no-index/concepts/x.md': '# no entry\n',
      'task/stray.md': '# a file\n',
      'skill/no-skill-md/readme.md': '# x\n',
    });
    const index = await getEntryIndex(dir);
    expect(index.entries.map((e) => e.slug)).toEqual(['ok']);
  });

  it('copes with a data dir that has none of the dataset directories', async () => {
    const dir = tmp.make();
    const index = await getEntryIndex(path.join(dir, 'missing'));
    expect(index.entries).toEqual([]);
    expect(index.parsed).toBe(0);
  });
});

describe('getEntryIndex: issues', () => {
  it('reports a YAML error as one root issue and keeps no data', async () => {
    const dir = tmp.make({ 'task/bad-yaml/index.md': '---\ntype: [oops\nname: x\n---\n# Body\n' });
    const entry = (await getEntryIndex(dir)).byKey.get('task/bad-yaml');
    expect(entry?.data).toEqual({});
    expect(entry?.issues).toHaveLength(1);
    expect(entry?.issues[0]?.path).toBe('');
    expect(entry?.issues[0]?.message).not.toBe('');
    expect(entry?.body).toContain('# Body');
  });

  it('reports a non-mapping frontmatter as a root issue', async () => {
    const dir = tmp.make({ 'task/list/index.md': '---\n- a\n- b\n---\n# T\n' });
    const entry = (await getEntryIndex(dir)).byKey.get('task/list');
    expect(entry?.issues).toEqual([{ path: '', message: 'frontmatter is not a mapping' }]);
  });

  it('reports schema issues with dotted paths and readable wording', async () => {
    const dir = tmp.make({
      'task/odd/index.md':
        '---\ntype: Task\nname: odd\nstate: done\nlinks:\n  - dataset: task\n    slug: Bad Slug\n---\n# T\n',
    });
    const entry = (await getEntryIndex(dir)).byKey.get('task/odd');
    const issues = Object.fromEntries((entry?.issues ?? []).map((i) => [i.path, i.message]));
    expect(issues.description).toBe('Required');
    expect(Object.keys(issues)).toContain('state');
    expect(Object.keys(issues)).toContain('links.0.slug');
  });

  it('reports a frontmatter-less entry file through the schema', async () => {
    const dir = tmp.make({ 'kb/plain/index.md': '# Just markdown\n' });
    const entry = (await getEntryIndex(dir)).byKey.get('kb/plain');
    expect(entry?.data).toEqual({});
    expect(entry?.body).toBe('# Just markdown\n');
    expect(entry?.issues.map((i) => i.path).sort()).toEqual(['description', 'name', 'type']);
  });

  it('reports a name that differs from the directory name', async () => {
    const dir = tmp.make({ 'task/dir-name/index.md': task('other-name') });
    const entry = (await getEntryIndex(dir)).byKey.get('task/dir-name');
    expect(entry?.issues).toEqual([
      { path: 'name', message: 'name "other-name" must equal the directory name "dir-name"' },
    ]);
  });

  it('reports a duplicate relation target', async () => {
    const dir = tmp.make({
      'task/dup/index.md': task(
        'dup',
        'links:\n  - dataset: kb\n    slug: a\n  - dataset: kb\n    slug: a\n    rel: child\n',
      ),
    });
    const entry = (await getEntryIndex(dir)).byKey.get('task/dup');
    expect(entry?.issues).toEqual([{ path: 'links.1', message: 'duplicate link kb/a' }]);
  });

  it('validates skills with the strict agentskills.io schema', async () => {
    const dir = tmp.make({
      'skill/s/SKILL.md': '---\nname: s\ndescription: d\ntags: [x]\nlinks: []\n---\n# S\n',
    });
    const entry = (await getEntryIndex(dir)).byKey.get('skill/s');
    expect(entry?.issues.length).toBeGreaterThan(0);
    expect(entry?.relations).toEqual([]);
  });
});

describe('getEntryIndex: relations', () => {
  it('lists the valid items of links in file order, skipping bad ones, rel defaulting to related', async () => {
    const dir = tmp.make({
      'project/p/index.md': okf(
        'Project',
        'p',
        [
          'state: pending',
          'links:',
          '  - dataset: task',
          '    slug: first',
          '    rel: child',
          '  - dataset: nope',
          '    slug: skipped',
          '  - dataset: kb',
          '    slug: second',
          '  - just-a-string',
          '  - dataset: feature',
          '    slug: third',
          '    rel: depends-on',
          '    extra: 1',
          '  - dataset: reference',
          '    slug: fourth',
          '    rel: depends-on',
          '',
        ].join('\n'),
      ),
    });
    const entry = (await getEntryIndex(dir)).byKey.get('project/p');
    expect(entry?.relations).toEqual([
      { dataset: 'task', slug: 'first', rel: 'child' },
      { dataset: 'kb', slug: 'second', rel: 'related' },
      { dataset: 'reference', slug: 'fourth', rel: 'depends-on' },
    ]);
    expect(entry?.issues.length).toBeGreaterThan(0); // the bad items are still schema issues
  });

  it('gives an entry without links, or with a non-array links, no relations', async () => {
    const dir = tmp.make({
      'task/a/index.md': task('a'),
      'task/b/index.md': task('b', 'links: nope\n'),
    });
    const index = await getEntryIndex(dir);
    expect(index.byKey.get('task/a')?.relations).toEqual([]);
    expect(index.byKey.get('task/b')?.relations).toEqual([]);
  });
});

describe('getEntryIndex: mentions', () => {
  const mentionFiles = (entry: { mentions: { file: string; line: number }[] } | undefined) =>
    entry?.mentions.map((m) => `${m.file}:${m.line}`);

  it('collects ctxman: links from every md of the directory, index.md first, with file lines', async () => {
    const dir = tmp.make({
      'kb/x/index.md': okf(
        'Knowledge Base',
        'x',
        '',
        '\nSee [one](ctxman:task/one) and [two](ctxman:kb/two#frag).\nAgain [one](ctxman:task/one).\n',
      ),
      'kb/x/concepts/deep.md':
        '---\ntype: Concept\n---\n\n[three](ctxman:skill/three) <ctxman:reference/four>\n',
      'kb/x/log.md': '# Log\n\n## 2026-10-18\n* [five](ctxman:idea/five)\n',
    });
    const entry = (await getEntryIndex(dir)).byKey.get('kb/x');
    expect(entry?.mentions.map((m) => `${m.dataset}/${m.slug}`)).toEqual([
      'task/one',
      'kb/two',
      'task/one',
      'skill/three',
      'reference/four',
      'idea/five',
    ]);
    expect(mentionFiles(entry)).toEqual([
      'index.md:7',
      'index.md:7',
      'index.md:8',
      'concepts/deep.md:5',
      'concepts/deep.md:5',
      'log.md:4',
    ]);
  });

  it('ignores code, images, the entry itself, non-linkable datasets and malformed targets', async () => {
    const dir = tmp.make({
      'kb/x/index.md': okf(
        'Knowledge Base',
        'x',
        'related: "[fm](ctxman:task/in-frontmatter)"\n',
        [
          '',
          '```md',
          '[fenced](ctxman:task/fenced)',
          '```',
          'Inline `[code](ctxman:task/inline)` text.',
          '![img](ctxman:task/image)',
          '[self](ctxman:kb/x) and [ctx](ctxman:context/some-context) and [rec](ctxman:recipe/r).',
          '[bad](ctxman:nope/x) [badslug](ctxman:kb/Bad_Slug) [ext](https://example.com) [rel](./y.md)',
          '[kept](ctxman:kb/kept)',
          '',
        ].join('\n'),
      ),
    });
    const entry = (await getEntryIndex(dir)).byKey.get('kb/x');
    expect(entry?.mentions.map((m) => `${m.dataset}/${m.slug}`)).toEqual(['kb/kept']);
  });

  it('does not treat a skill reference file as part of another entry', async () => {
    const dir = tmp.make({
      'skill/s/SKILL.md': '---\nname: s\ndescription: d\n---\n# S\n[a](ctxman:kb/a)\n',
      'skill/s/references/r.md': '# R\n[b](ctxman:kb/b)\n',
      'skill/s/references/data.json': '{ "x": "[c](ctxman:kb/c)" }',
    });
    const entry = (await getEntryIndex(dir)).byKey.get('skill/s');
    expect(entry?.mentions.map((m) => `${m.slug}@${m.file}`)).toEqual([
      'a@SKILL.md',
      'b@references/r.md',
    ]);
  });
});

describe('getEntryIndex: freshness', () => {
  it('lastModified equals lastModifiedOf(dir), also when a nested file is the newest', async () => {
    const dir = tmp.make({
      ...validDataTree(),
      'kb/demo/assets/data.json': '{}',
      'kb/demo/.hidden/skip.md': 'ignored',
    });
    const newest = path.join(dir, 'kb', 'demo', 'concepts', 'one.md');
    bump(newest, 3600);
    const hidden = path.join(dir, 'kb', 'demo', '.hidden', 'skip.md');
    bump(hidden, 7200); // dot dirs are not walked
    const index = await fresh(dir);
    for (const entry of index.entries) {
      const expected = await lastModifiedOf(entryAbsPath(entry.dataset, entry.slug, dir));
      expect(entry.lastModified.getTime(), `${entry.dataset}/${entry.slug}`).toBe(
        expected.getTime(),
      );
    }
    const newestMs = index.byKey.get('kb/demo')?.lastModified.getTime() ?? 0;
    expect(Math.abs(newestMs - statSync(newest).mtimeMs)).toBeLessThan(1);
  });

  it('fileModified is the ISO mtime of the entry file itself', async () => {
    const dir = tmp.make(validDataTree());
    bump(path.join(dir, 'kb', 'demo', 'concepts', 'one.md'), 5000);
    const entry = (await fresh(dir)).byKey.get('kb/demo');
    expect(entry?.fileModified).toBe(
      statSync(path.join(dir, 'kb', 'demo', 'index.md')).mtime.toISOString(),
    );
    expect(entry?.lastModified.getTime()).toBeGreaterThan(
      new Date(entry?.fileModified ?? 0).getTime(),
    );
  });
});

describe('getEntryIndex: fileModified precision', () => {
  it('rounds a fractional millisecond like Stats.mtime (the PATCH base)', async () => {
    const dir = tmp.make({ 'task/a/index.md': task('a') });
    const file = path.join(dir, 'task', 'a', 'index.md');
    utimesSync(file, 1_700_000_000.9996, 1_700_000_000.9996);
    const entry = (await getEntryIndex(dir)).byKey.get('task/a');
    expect(entry?.fileModified).toBe(statSync(file).mtime.toISOString());
    expect(entry?.fileModified).toBe('2023-11-14T22:13:21.000Z');
    // lastModified truncates, exactly like freshness.lastModifiedOf(dir)
    expect(entry?.lastModified.getTime()).toBe(
      (await lastModifiedOf(entryAbsPath('task', 'a', dir))).getTime(),
    );
  });
});

describe('getEntryIndex: caching', () => {
  it('parses every entry once, nothing when unchanged, and only the touched entry after a change', async () => {
    const dir = tmp.make(validDataTree());
    const first = await getEntryIndex(dir);
    expect(first.parsed).toBe(first.entries.length);
    expect(first.parsed).toBeGreaterThan(2);

    const second = await fresh(dir);
    expect(second.parsed).toBe(0);
    expect(second.entries).toBe(first.entries); // identity kept while nothing changed
    expect(second.byKey).toBe(first.byKey);
    expect(second.entries[0]).toBe(first.entries[0]);

    bump(path.join(dir, 'kb', 'demo', 'concepts', 'one.md'));
    const third = await fresh(dir);
    expect(third.parsed).toBe(1);
    expect(third.byKey.get('kb/demo')).not.toBe(first.byKey.get('kb/demo'));
    expect(third.byKey.get('task/do-it')).toBe(first.byKey.get('task/do-it'));

    expect((await fresh(dir)).parsed).toBe(0);
  });

  it('notices a content change (size) even when the mtime is restored', async () => {
    const dir = tmp.make({ 'task/a/index.md': task('a') });
    const file = path.join(dir, 'task', 'a', 'index.md');
    const before = statSync(file);
    await getEntryIndex(dir);
    writeFileSync(file, `${task('a', 'tags: [x]\n')}\n`);
    utimesSync(file, before.atime, before.mtime);
    const next = await fresh(dir);
    expect(next.parsed).toBe(1);
    expect(next.byKey.get('task/a')?.data.tags).toEqual(['x']);
  });

  it('picks up added files and added or vanished entries', async () => {
    const dir = tmp.make({ 'task/a/index.md': task('a'), 'task/b/index.md': task('b') });
    const first = await getEntryIndex(dir);
    expect(first.entries.map((e) => e.slug)).toEqual(['a', 'b']);

    writeTree(dir, {
      'task/c/index.md': task('c'),
      'task/a/concepts/new.md': '# New\n[x](ctxman:kb/x)\n',
    });
    rmSync(path.join(dir, 'task', 'b'), { recursive: true });
    const second = await fresh(dir);
    expect(second.entries.map((e) => e.slug)).toEqual(['a', 'c']);
    expect(second.parsed).toBe(2); // a (new file) and c
    expect(second.byKey.get('task/a')?.mentions.map((m) => m.file)).toEqual(['concepts/new.md']);
    expect(second.byKey.has('task/b')).toBe(false);

    // a vanished directory comes back as a fresh parse, not from a stale cache entry
    writeTree(dir, { 'task/b/index.md': task('b') });
    const third = await fresh(dir);
    expect(third.parsed).toBe(1);
    expect(third.entries.map((e) => e.slug)).toEqual(['a', 'b', 'c']);
  });

  it('drops an entry whose index.md is removed', async () => {
    const dir = tmp.make({ 'task/a/index.md': task('a'), 'task/a/concepts/x.md': '# I\n' });
    expect((await getEntryIndex(dir)).entries).toHaveLength(1);
    rmSync(path.join(dir, 'task', 'a', 'index.md'));
    expect((await fresh(dir)).entries).toEqual([]);
  });

  it('keeps separate caches per data dir', async () => {
    const one = tmp.make({ 'task/a/index.md': task('a') });
    const two = tmp.make({ 'task/z/index.md': task('z') });
    expect((await getEntryIndex(one)).entries.map((e) => e.slug)).toEqual(['a']);
    expect((await getEntryIndex(two)).entries.map((e) => e.slug)).toEqual(['z']);
    expect((await fresh(one)).parsed).toBe(0);
  });
});

describe('getEntryIndex: memo and invalidateEntryIndex', () => {
  it('serves the same build for calls within 200 ms and shares an in-flight build', async () => {
    const dir = tmp.make({ 'task/a/index.md': task('a') });
    const [x, y] = await Promise.all([getEntryIndex(dir), getEntryIndex(dir)]);
    expect(y).toBe(x);
    expect(await getEntryIndex(dir)).toBe(x);

    writeTree(dir, { 'task/b/index.md': task('b') });
    expect((await getEntryIndex(dir)).entries.map((e) => e.slug)).toEqual(['a']); // memoized
  });

  it('invalidateEntryIndex(dir) drops the memo but not the per-directory cache', async () => {
    const dir = tmp.make({ 'task/a/index.md': task('a') });
    const x = await getEntryIndex(dir);
    writeTree(dir, { 'task/b/index.md': task('b') });
    invalidateEntryIndex(dir);
    const y = await getEntryIndex(dir);
    expect(y).not.toBe(x);
    expect(y.entries.map((e) => e.slug)).toEqual(['a', 'b']);
    expect(y.parsed).toBe(1); // only b was read
  });

  it('invalidateEntryIndex() without an argument drops every memo', async () => {
    const one = tmp.make({ 'task/a/index.md': task('a') });
    const two = tmp.make({ 'task/z/index.md': task('z') });
    await getEntryIndex(one);
    await getEntryIndex(two);
    writeTree(one, { 'task/b/index.md': task('b') });
    writeTree(two, { 'task/y/index.md': task('y') });
    invalidateEntryIndex();
    expect((await getEntryIndex(one)).entries).toHaveLength(2);
    expect((await getEntryIndex(two)).entries).toHaveLength(2);
    expect(() => invalidateEntryIndex(path.join(one, 'never-seen'))).not.toThrow();
  });

  it('rescans once the 200 ms memo has expired', async () => {
    const dir = tmp.make({ 'task/a/index.md': task('a') });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
    const x = await getEntryIndex(dir);
    mkdirSync(path.join(dir, 'task', 'b'), { recursive: true });
    writeFileSync(path.join(dir, 'task', 'b', 'index.md'), task('b'));

    vi.setSystemTime(new Date('2026-10-18T10:00:00.150Z'));
    expect(await getEntryIndex(dir)).toBe(x);
    vi.setSystemTime(new Date('2026-10-18T10:00:00.250Z'));
    const y = await getEntryIndex(dir);
    expect(y).not.toBe(x);
    expect(y.entries.map((e) => e.slug)).toEqual(['a', 'b']);
  });
});
