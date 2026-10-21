// src/lib/entry-clone.ts: cloning an okf bundle into a new entry. Temp fixtures for the byte-level rules (only the
// listed frontmatter keys change, every other byte stays; binary files byte-identical; symlinks skipped; nothing
// left behind on any failure; a target that appears late is a 409, never replaced), a corpus copy for the read path
// (the clone shows on the very next list and search).
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cloneEntry, retitleBody } from '../../src/lib/entry-clone.ts';
import type { CloneOptions } from '../../src/lib/entry-clone.ts';
import { buildSearchIndex, listEntries } from '../../src/lib/entries.ts';
import { invalidateEntryIndex } from '../../src/lib/entry-index.ts';
import { EntryIoError } from '../../src/lib/entry-io.ts';
import { cleanupCorpus, copyCorpus } from './fixtures/corpus.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => {
  tmp.cleanup();
  cleanupCorpus();
  invalidateEntryIndex();
});

const NOW = new Date('2026-10-21T12:00:00Z');

const SOURCE = [
  '---',
  'okf_version: "0.2"',
  'type: Task',
  '# a comment that stays',
  'name: src-task',
  'title: Source task',
  'description: >-',
  '  Folded',
  '  description.',
  'state: in-progress',
  'issueKey: PROJ-1',
  'tags: [a,  b]',
  'x-unknown: {k: [1,2]}',
  'time: [PT1H, PT30M]',
  'resolved: 2026-10-19',
  'stale_after: 2099-01-01',
  'modified: "2026-10-20T14:03:12Z"',
  'generated:',
  '  by: process:test',
  '  at: 2026-10-17T11:20:00Z',
  'links:',
  '  - dataset: kb',
  '    slug: demo',
  '    rel: related',
  '  - dataset: task',
  '    slug: other',
  '    rel: depends-on',
  '---',
  '',
  '# Source task',
  '',
  'Body with `code` and [a concept](/concepts/a.md) and [the other task](ctxman:task/other).',
  '',
  '```md',
  '# Source task',
  '```',
  '',
  '## Links',
  '',
  '* [A](/concepts/a.md)',
  '',
].join('\n');

const KB_DEMO = [
  '---',
  'okf_version: "0.2"',
  'type: Topic',
  'name: demo',
  'description: A demo.',
  'tags: []',
  '---',
  '',
  '# Demo',
  '',
].join('\n');

const OTHER_TASK = [
  '---',
  'okf_version: "0.2"',
  'type: Task',
  'name: other',
  'description: Another task.',
  'state: pending',
  'tags: []',
  '---',
  '',
  '# Other',
  '',
].join('\n');

const CONCEPT = '---\ntype: article\ntitle: A\n---\n\n# A\n\nSee [b](./deep/b.md).\n';
const DEEP = '---\ntype: article\ntitle: B\n---\n\n# B\n';
const LOG = '# Update log\n\n## 2026-10-20\n* **Create**: Created the task.\n';
/** Bytes a text decoder would mangle: NUL, invalid UTF-8, a CR LF pair. */
const BINARY = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0d, 0x0a, 0x00, 0x80, 0x7f,
]);

function fixture(extra: Record<string, string> = {}, withLog = true): string {
  const dir = tmp.make({
    'kb/demo/index.md': KB_DEMO,
    'task/other/index.md': OTHER_TASK,
    'task/src-task/index.md': SOURCE,
    'task/src-task/concepts/a.md': CONCEPT,
    'task/src-task/concepts/deep/b.md': DEEP,
    'task/src-task/.hidden-temp.tmp': 'an editor temp file',
    ...(withLog ? { 'task/src-task/log.md': LOG } : {}),
    ...extra,
  });
  writeFileSync(path.join(dir, 'task', 'src-task', 'assets-img.png'), BINARY);
  return dir;
}

const BODY = { name: 'dst-task', title: 'Copy task', description: 'Folded description.' };

const read = (dir: string, ...rel: string[]): string =>
  readFileSync(path.join(dir, ...rel), 'utf8');

/** Every path under `root` (dirs end in '/'), sorted; '.'-prefixed ones included. */
function tree(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const d of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const child = rel === '' ? d.name : `${rel}/${d.name}`;
    if (d.isDirectory()) out.push(`${child}/`, ...tree(root, child));
    else out.push(child);
  }
  return out.sort();
}

async function clone(dir: string, body: unknown, options: Omit<CloneOptions, 'dataDir'> = {}) {
  return cloneEntry('task', 'src-task', body, { dataDir: dir, now: NOW, ...options });
}

async function failure(promise: Promise<unknown>): Promise<EntryIoError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EntryIoError);
  return error as EntryIoError;
}

describe('cloneEntry: the copy', () => {
  it('copies every file and nested folder, binary files byte for byte, dot-entries skipped', async () => {
    const dir = fixture();
    const before = tree(path.join(dir, 'task', 'src-task'));
    const cloned = await clone(dir, BODY);
    expect(cloned).toMatchObject({
      dataset: 'task',
      slug: 'dst-task',
      path: 'task/dst-task/index.md',
      url: '/task/dst-task',
    });
    expect(cloned.files).toEqual([
      'task/dst-task/assets-img.png',
      'task/dst-task/concepts/a.md',
      'task/dst-task/concepts/deep/b.md',
      'task/dst-task/index.md',
      'task/dst-task/log.md',
    ]);
    expect(tree(path.join(dir, 'task', 'dst-task'))).toEqual(
      before.filter((p) => !p.startsWith('.')),
    );
    expect(readFileSync(path.join(dir, 'task', 'dst-task', 'assets-img.png'))).toEqual(BINARY);
    expect(read(dir, 'task', 'dst-task', 'concepts', 'a.md')).toBe(CONCEPT);
    expect(read(dir, 'task', 'dst-task', 'concepts', 'deep', 'b.md')).toBe(DEEP);
    // the original is untouched, and no temp dir is left in the dataset dir
    expect(read(dir, 'task', 'src-task', 'index.md')).toBe(SOURCE);
    expect(read(dir, 'task', 'src-task', 'log.md')).toBe(LOG);
    expect(tree(path.join(dir, 'task', 'src-task'))).toEqual(before);
    expect(readdirSync(path.join(dir, 'task')).sort()).toEqual(['dst-task', 'other', 'src-task']);
  });

  it('keeps the permission bits of a file', async () => {
    const dir = fixture({ 'task/src-task/run.sh': '#!/bin/sh\necho hi\n' });
    chmodSync(path.join(dir, 'task', 'src-task', 'run.sh'), 0o755);
    await clone(dir, BODY);
    const mode = (await import('node:fs')).statSync(
      path.join(dir, 'task', 'dst-task', 'run.sh'),
    ).mode;
    expect(mode & 0o777).toBe(0o755);
  });

  it('skips symlinks (files and folders) with a warning and never follows them', async () => {
    const dir = fixture();
    const bundle = path.join(dir, 'task', 'src-task');
    symlinkSync('concepts/a.md', path.join(bundle, 'alias.md'));
    symlinkSync(path.join(dir, 'kb', 'demo'), path.join(bundle, 'outside'));
    symlinkSync('/nonexistent/dangling', path.join(bundle, 'dangling.md'));
    const cloned = await clone(dir, BODY);
    const skipped = cloned.warnings.filter((w) => w.rule === 'clone/symlink-skipped');
    expect(skipped.map((w) => w.file).sort()).toEqual([
      'task/src-task/alias.md',
      'task/src-task/dangling.md',
      'task/src-task/outside',
    ]);
    const target = path.join(dir, 'task', 'dst-task');
    for (const name of ['alias.md', 'outside', 'dangling.md']) {
      expect(existsSync(path.join(target, name))).toBe(false);
    }
    expect(cloned.files).not.toContain('task/dst-task/outside/index.md');
  });
});

it.skipIf(process.platform === 'win32')(
  'cloneEntry skips a special file (a FIFO) with a warning, without blocking on it',
  async () => {
    const dir = fixture();
    execFileSync('mkfifo', [path.join(dir, 'task', 'src-task', 'pipe')]);
    const cloned = await clone(dir, BODY);
    expect(cloned.warnings.filter((w) => w.rule === 'clone/special-skipped')).toEqual([
      expect.objectContaining({ file: 'task/src-task/pipe' }),
    ]);
    expect(existsSync(path.join(dir, 'task', 'dst-task', 'pipe'))).toBe(false);
  },
);

describe('cloneEntry: the rewritten index.md', () => {
  it('rewrites only the listed keys and the first heading; every other byte stays', async () => {
    const dir = fixture();
    await clone(dir, BODY);
    const expected = SOURCE.replace('name: src-task', 'name: dst-task')
      .replace('title: Source task', 'title: Copy task')
      .replace('state: in-progress', 'state: pending')
      .replace('issueKey: PROJ-1\n', '')
      .replace('time: [PT1H, PT30M]\n', '')
      .replace('resolved: 2026-10-19\n', '')
      .replace('modified: "2026-10-20T14:03:12Z"\n', '')
      // only the body's first heading follows the title: the one in the code block stays
      .replace('---\n\n# Source task\n', '---\n\n# Copy task\n');
    expect(read(dir, 'task', 'dst-task', 'index.md')).toBe(expected);
  });

  it('sets the given state, tags and issue key; keeps time and resolved with time: true', async () => {
    const dir = fixture();
    await clone(dir, {
      ...BODY,
      state: 'complete',
      tags: ['x', 'Y Z'],
      issueKey: ' PROJ-2 ',
      time: true,
    });
    const text = read(dir, 'task', 'dst-task', 'index.md');
    expect(text).toContain('\nstate: complete\n');
    expect(text).toContain('\nissueKey: PROJ-2\n');
    expect(text).toContain('\ntags: [x, y-z]\n');
    expect(text).toContain('\ntime: [PT1H, PT30M]\nresolved: 2026-10-19\n');
    expect(text).not.toContain('modified:');
  });

  it('an omitted title is "<title> (copy)" (the body heading follows), null the name in sentence case', async () => {
    const dir = fixture();
    await clone(dir, { name: 'dst-task', description: 'Folded description.' });
    const text = read(dir, 'task', 'dst-task', 'index.md');
    expect(text).toContain('\ntitle: Source task (copy)\n');
    expect(text).toContain('---\n\n# Source task (copy)\n');
    // omitted tags keep the original's, as written
    expect(text).toContain('\ntags: [a,  b]\n');

    await clone(dir, { name: 'dst-null', title: null, description: 'x' });
    expect(read(dir, 'task', 'dst-null', 'index.md')).toContain('\ntitle: Dst null\n');
  });

  it('defaults a blank title to the name in sentence case', async () => {
    const dir = fixture();
    await clone(dir, { ...BODY, title: '  ' });
    const text = read(dir, 'task', 'dst-task', 'index.md');
    expect(text).toContain('\ntitle: Dst task\n');
    expect(text).toContain('\n# Dst task\n');
  });

  it('a changed description replaces the folded block; no tags clears them', async () => {
    const dir = fixture();
    await clone(dir, { name: 'dst-task', description: 'New text.', tags: [] });
    const text = read(dir, 'task', 'dst-task', 'index.md');
    expect(text).toContain('\ndescription: New text.\nstate: pending\n');
    expect(text).toContain('\ntags: []\n');
  });

  it('filters relations: related/depends-on by links, child links by children', async () => {
    const project = [
      '---',
      'okf_version: "0.2"',
      'type: Project',
      'name: proj',
      'description: A project.',
      'state: wip',
      'tags: []',
      'links:',
      '  - dataset: task',
      '    slug: other',
      '    rel: child',
      '  - dataset: kb',
      '    slug: demo',
      '---',
      '',
      '# Proj',
      '',
    ].join('\n');
    const dir = tmp.make({
      'kb/demo/index.md': KB_DEMO,
      'task/other/index.md': OTHER_TASK,
      'project/proj/index.md': project,
    });
    const run = (name: string, extra: Record<string, unknown>) =>
      cloneEntry(
        'project',
        'proj',
        { name, description: 'A project.', ...extra },
        { dataDir: dir, now: NOW },
      ).then(() => read(dir, 'project', name, 'index.md'));

    // default: the related link (written with its rel), no child link
    const plain = await run('p1', {});
    expect(plain).toContain('links:\n  - dataset: kb\n    slug: demo\n    rel: related\n---');
    expect(plain).not.toContain('slug: other');
    expect(plain).toContain('\nstate: pending\n');
    // children as well: the links stay as written
    expect(await run('p2', { children: true })).toContain(
      'links:\n  - dataset: task\n    slug: other\n    rel: child\n  - dataset: kb\n    slug: demo\n---',
    );
    // children only
    const childrenOnly = await run('p3', { links: false, children: true });
    expect(childrenOnly).toContain(
      'links:\n  - dataset: task\n    slug: other\n    rel: child\n---',
    );
    expect(childrenOnly).not.toContain('slug: demo');
    // none: the key goes
    expect(await run('p4', { links: false })).not.toContain('links:');
    // the project's own child entries are not touched
    expect(read(dir, 'task', 'other', 'index.md')).toBe(OTHER_TASK);
    expect(read(dir, 'project', 'proj', 'index.md')).toBe(project);
  });

  it('drops a link that would point at the clone itself, with a warning', async () => {
    const dir = fixture();
    const bundle = path.join(dir, 'task', 'src-task', 'index.md');
    writeFileSync(bundle, SOURCE.replace('    slug: other\n', '    slug: dst-task\n'));
    const cloned = await clone(dir, BODY);
    expect(cloned.warnings.map((w) => w.rule)).toContain('clone/self-link-dropped');
    const text = read(dir, 'task', 'dst-task', 'index.md');
    expect(text).not.toContain('slug: dst-task\n    rel');
    expect(text).toContain('links:\n  - dataset: kb\n    slug: demo\n    rel: related\n---');
  });

  it('keeps CRLF line endings', async () => {
    const dir = fixture();
    writeFileSync(path.join(dir, 'task', 'src-task', 'index.md'), SOURCE.replaceAll('\n', '\r\n'));
    await clone(dir, BODY);
    const text = read(dir, 'task', 'dst-task', 'index.md');
    expect(text).toContain('\r\nname: dst-task\r\ntitle: Copy task\r\n');
    expect(text).toContain('\r\n# Copy task\r\n');
    expect(text.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('adds the dated line to an existing log.md, and never creates one', async () => {
    const withLog = fixture();
    await clone(withLog, BODY);
    expect(read(withLog, 'task', 'dst-task', 'log.md')).toBe(
      '# Update log\n\n## 2026-10-21\n* **Create**: Cloned from [Source task](ctxman:task/src-task).\n\n## 2026-10-20\n* **Create**: Created the task.\n',
    );
    expect(read(withLog, 'task', 'src-task', 'log.md')).toBe(LOG);

    const withoutLog = fixture({}, false);
    const cloned = await clone(withoutLog, BODY);
    expect(existsSync(path.join(withoutLog, 'task', 'dst-task', 'log.md'))).toBe(false);
    expect(cloned.files).not.toContain('task/dst-task/log.md');
  });

  it('answers the validator findings of the new index.md (a dangling relation target)', async () => {
    const dir = fixture();
    writeFileSync(
      path.join(dir, 'task', 'src-task', 'index.md'),
      SOURCE.replace('    slug: other\n', '    slug: gone\n'),
    );
    const cloned = await clone(dir, BODY);
    expect(cloned.warnings.map((w) => w.rule)).toContain('links/relation-target');
  });
});

describe('cloneEntry: refusals', () => {
  it('400 bad-dataset for a skill or a yaml dataset, bad-slug for an invalid name', async () => {
    const dir = fixture();
    for (const dataset of ['skill', 'reference', 'context', 'nope']) {
      const error = await failure(cloneEntry(dataset, 'x', BODY, { dataDir: dir }));
      expect(error.code, dataset).toBe('bad-dataset');
    }
    expect((await failure(cloneEntry('task', 'Bad Slug', BODY, { dataDir: dir }))).code).toBe(
      'bad-slug',
    );
  });

  it('400 invalid with issues by field', async () => {
    const dir = fixture();
    const issues = async (body: unknown) => {
      const error = await failure(clone(dir, body));
      expect(error.code).toBe('invalid');
      return error.issues.map((i) => i.path);
    };
    expect(await issues({ ...BODY, name: 'Not Valid' })).toEqual(['name']);
    expect(await issues({ ...BODY, name: 'x'.repeat(65) })).toEqual(['name']);
    expect(await issues({ ...BODY, description: '  ' })).toEqual(['description']);
    expect(await issues({ ...BODY, title: 't'.repeat(201) })).toEqual(['title']);
    expect(await issues({ ...BODY, state: 'stable' })).toEqual(['state']);
    expect(await issues({ ...BODY, tags: ['ok', 'not ok!'] })).toEqual(['tags.1']);
    expect(await issues({ ...BODY, issueKey: 'two words' })).toEqual(['issueKey']);
    expect(await issues({ ...BODY, surprise: 1 })).toEqual(['surprise']);
    expect(await issues({ ...BODY, links: 'yes' })).toEqual(['links']);
    expect(await issues({ description: 'x' })).toEqual(['name']);
    expect(await issues(null)).toEqual(['']);
    // nothing was written
    expect(existsSync(path.join(dir, 'task', 'dst-task'))).toBe(false);
  });

  it('400 invalid for time and state on datasets without them', async () => {
    const dir = fixture();
    const error = await failure(
      cloneEntry(
        'kb',
        'demo',
        { name: 'demo-2', description: 'x', time: false, state: 'pending' },
        {
          dataDir: dir,
        },
      ),
    );
    expect(error.issues.map((i) => i.path).sort()).toEqual(['state', 'time']);
  });

  it('400 invalid when the rewritten frontmatter fails the schema; nothing is left', async () => {
    const dir = fixture();
    writeFileSync(
      path.join(dir, 'task', 'src-task', 'index.md'),
      SOURCE.replace('type: Task', 'type: ""'),
    );
    const error = await failure(clone(dir, BODY));
    expect(error.code).toBe('invalid');
    expect(error.issues.map((i) => i.path)).toContain('type');
    expect(readdirSync(path.join(dir, 'task')).sort()).toEqual(['other', 'src-task']);
  });

  it('404 for a missing entry, a symlinked bundle and a bundle without index.md', async () => {
    const dir = fixture();
    expect((await failure(cloneEntry('task', 'nope', BODY, { dataDir: dir }))).code).toBe(
      'not-found',
    );
    symlinkSync(path.join(dir, 'task', 'src-task'), path.join(dir, 'task', 'linked'));
    expect((await failure(cloneEntry('task', 'linked', BODY, { dataDir: dir }))).code).toBe(
      'not-found',
    );
    mkdirSync(path.join(dir, 'task', 'empty'));
    expect((await failure(cloneEntry('task', 'empty', BODY, { dataDir: dir }))).code).toBe(
      'not-found',
    );
  });

  it('422 invalid-file for unparsable frontmatter or a symlinked index.md', async () => {
    const dir = fixture();
    writeFileSync(path.join(dir, 'task', 'src-task', 'index.md'), '---\nname: [unclosed\n---\n');
    expect((await failure(clone(dir, BODY))).code).toBe('invalid-file');

    const other = fixture();
    const index = path.join(other, 'task', 'src-task', 'index.md');
    writeFileSync(path.join(other, 'task', 'src-task', 'real.md'), SOURCE);
    (await import('node:fs')).rmSync(index);
    symlinkSync('real.md', index);
    expect((await failure(clone(other, BODY))).code).toBe('invalid-file');
  });

  it('409 exists when the name is taken (a folder, a file, a dangling symlink) or is the original', async () => {
    const dir = fixture();
    expect((await failure(clone(dir, { ...BODY, name: 'other' }))).code).toBe('exists');
    writeFileSync(path.join(dir, 'task', 'a-file'), 'x');
    expect((await failure(clone(dir, { ...BODY, name: 'a-file' }))).code).toBe('exists');
    symlinkSync('/nonexistent', path.join(dir, 'task', 'dangling'));
    expect((await failure(clone(dir, { ...BODY, name: 'dangling' }))).code).toBe('exists');
    expect((await failure(clone(dir, { ...BODY, name: 'src-task' }))).code).toBe('exists');
    expect(read(dir, 'task', 'other', 'index.md')).toBe(OTHER_TASK);
  });

  it('409 exists when the target appears before the rename: never replaced, nothing left', async () => {
    for (const late of ['empty dir', 'filled dir', 'file']) {
      const dir = fixture();
      const target = path.join(dir, 'task', 'dst-task');
      const error = await failure(
        clone(dir, BODY, {
          beforeRename: async () => {
            if (late === 'file') writeFileSync(target, 'late');
            else mkdirSync(target);
            if (late === 'filled dir') writeFileSync(path.join(target, 'mine.md'), 'late');
          },
        }),
      );
      expect(error.code, late).toBe('exists');
      if (late === 'file') expect(readFileSync(target, 'utf8')).toBe('late');
      else expect(readdirSync(target), late).toEqual(late === 'filled dir' ? ['mine.md'] : []);
      expect(readdirSync(path.join(dir, 'task')).sort(), late).toEqual([
        'dst-task',
        'other',
        'src-task',
      ]);
    }
  });

  it('leaves nothing behind when a step throws', async () => {
    const dir = fixture();
    await expect(
      clone(dir, BODY, {
        beforeRename: async (temp) => {
          // the clone is complete in a dot-prefixed temp dir inside the dataset dir
          expect(path.dirname(temp)).toBe(path.join(dir, 'task'));
          expect(path.basename(temp).startsWith('.')).toBe(true);
          expect(existsSync(path.join(temp, 'concepts', 'deep', 'b.md'))).toBe(true);
          throw new Error('injected');
        },
      }),
    ).rejects.toThrow('injected');
    expect(readdirSync(path.join(dir, 'task')).sort()).toEqual(['other', 'src-task']);
  });

  it.skipIf(process.platform === 'win32' || os.userInfo().uid === 0)(
    'leaves nothing behind when a file cannot be read',
    async () => {
      const dir = fixture();
      const locked = path.join(dir, 'task', 'src-task', 'concepts', 'deep', 'b.md');
      chmodSync(locked, 0o000);
      try {
        await expect(clone(dir, BODY)).rejects.toThrow();
      } finally {
        chmodSync(locked, 0o644);
      }
      expect(readdirSync(path.join(dir, 'task')).sort()).toEqual(['other', 'src-task']);
    },
  );
});

describe('cloneEntry: the read path', () => {
  it('the clone is listed and searchable on the very next request', async () => {
    const dir = copyCorpus();
    const now = Date.parse('2026-10-21T12:00:00Z');
    const before = await listEntries('task', now, dir);
    expect(before.map((e) => e.slug)).not.toContain('forge-e2e-coverage-copy');
    await cloneEntry(
      'task',
      'forge-e2e-coverage',
      {
        name: 'forge-e2e-coverage-copy',
        title: 'Forge coverage, again',
        description: 'A clone for the unit test.',
      },
      { dataDir: dir, now: NOW },
    );
    const after = await listEntries('task', now, dir);
    const row = after.find((e) => e.slug === 'forge-e2e-coverage-copy');
    expect(row).toMatchObject({ title: 'Forge coverage, again', state: 'pending' });
    expect(after).toHaveLength(before.length + 1);
    const index = await buildSearchIndex(dir);
    expect(
      index.docs.some((d) => d.dataset === 'task' && d.slug === 'forge-e2e-coverage-copy'),
    ).toBe(true);
  });
});

describe('retitleBody', () => {
  const doc = (body: string): string => `---\ntitle: Old\n---\n\n${body}`;

  it('replaces the first level-1 heading when it reads the old title', () => {
    expect(retitleBody(doc('# Old\n\ntext\n# Old\n'), ['Old'], 'New')).toBe(
      doc('# New\n\ntext\n# Old\n'),
    );
    expect(retitleBody(doc('## Sub\n\n# Old #\n'), ['Old'], 'New')).toBe(doc('## Sub\n\n# New\n'));
  });

  it('leaves a different first heading, code blocks and the frontmatter alone', () => {
    const other = doc('# Something else\n\n# Old\n');
    expect(retitleBody(other, ['Old'], 'New')).toBe(other);
    expect(retitleBody(doc('```\n# Old\n```\n\n# Old\n'), ['Old'], 'New')).toBe(
      doc('```\n# Old\n```\n\n# New\n'),
    );
    const none = doc('text only\n');
    expect(retitleBody(none, ['Old'], 'New')).toBe(none);
    expect(retitleBody('---\n# Old: yaml comment\n---\n# Old\n', ['Old'], 'New')).toBe(
      '---\n# Old: yaml comment\n---\n# New\n',
    );
  });

  it('keeps a CRLF line ending', () => {
    expect(retitleBody('---\r\nt: 1\r\n---\r\n# Old\r\nx\r\n', ['Old'], 'New')).toBe(
      '---\r\nt: 1\r\n---\r\n# New\r\nx\r\n',
    );
  });
});
