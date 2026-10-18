import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EntryCreateError,
  plannedProblems,
  writePlannedEntry,
} from '../../src/lib/entry-create.ts';
import { createEntry, EntryIoError, readEntry } from '../../src/lib/entry-io.ts';
import { planNewEntry } from '../../src/lib/templates.ts';
import { validDataTree, trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const now = new Date('2026-10-17T12:34:56.789Z');

async function ioFailure(promise: Promise<unknown>): Promise<EntryIoError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EntryIoError) return error;
    throw error;
  }
  throw new Error('expected an EntryIoError, but the call resolved');
}

const read = (dir: string, rel: string): string =>
  readFileSync(path.join(dir, ...rel.split('/')), 'utf8');

describe('writePlannedEntry', () => {
  it('writes the planned files, validates them and returns their paths', async () => {
    const dir = tmp.make();
    const planned = planNewEntry('task', 'fix-it', { now, description: 'Fix it' });
    const files = await writePlannedEntry('task', 'fix-it', planned, dir);
    expect(files).toEqual(['task/fix-it/index.md', 'task/fix-it/log.md']);
    for (const file of planned) expect(read(dir, file.relPath)).toBe(file.content);
  });

  it('never overwrites: an existing entry is `exists` and left alone', async () => {
    const dir = tmp.make(validDataTree());
    const before = read(dir, 'task/do-it/index.md');
    const planned = planNewEntry('task', 'do-it', { now, description: 'Again' });
    const error = await writePlannedEntry('task', 'do-it', planned, dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntryCreateError);
    expect((error as EntryCreateError).code).toBe('exists');
    expect((error as EntryCreateError).relPath).toBe('task/do-it');
    expect(read(dir, 'task/do-it/index.md')).toBe(before);

    const yaml = await writePlannedEntry(
      'context',
      'ctx',
      planNewEntry('context', 'ctx', { now, description: 'c' }),
      dir,
    ).catch((e: unknown) => e);
    expect((yaml as EntryCreateError).relPath).toBe('context/ctx.yaml');
  });

  it('rolls back every file (and the directory) when a generated file fails validation', async () => {
    const dir = tmp.make();
    const planned = planNewEntry('task', 'broken', { now, description: 'Broken' }).map((file) =>
      file.relPath.endsWith('index.md') ? { ...file, content: '---\ntype: Task\n---\n' } : file,
    );
    const error = await writePlannedEntry('task', 'broken', planned, dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntryCreateError);
    const created = error as EntryCreateError;
    expect(created.code).toBe('invalid');
    expect(created.problems.length).toBeGreaterThan(0);
    expect(created.message).toMatch(
      /^generated files failed validation:\n {2}task\/broken\/index\.md: /,
    );
    expect(existsSync(path.join(dir, 'task', 'broken'))).toBe(false);
    expect(readdirSync(path.join(dir, 'task'))).toEqual([]);
  });

  it('plannedProblems checks skills and data files against their schema and name', () => {
    const skill = { relPath: 'skill/s/SKILL.md', content: '' };
    expect(plannedProblems('skill', 's', skill, '---\nname: s\ndescription: d\n---\n')).toEqual([]);
    expect(plannedProblems('skill', 's', skill, '---\nname: other\ndescription: d\n---\n')).toEqual(
      ['skill/s/SKILL.md: name must equal "s"'],
    );
    expect(plannedProblems('skill', 's', skill, 'no frontmatter')).toEqual([
      'skill/s/SKILL.md: missing frontmatter',
    ]);
    const ctx = { relPath: 'context/c.yaml', content: '' };
    expect(plannedProblems('context', 'c', ctx, 'name: c\ndescription: d\nlinks: []\n')).toEqual(
      [],
    );
    expect(plannedProblems('context', 'c', ctx, 'name: c\nlinks: []\n')[0]).toContain(
      'description',
    );
  });
});

describe('createEntry: okf entries', () => {
  it('creates the same files as the add script, with tags and state', async () => {
    const dir = tmp.make();
    const created = await createEntry(
      'task',
      {
        name: 'w2-demo',
        title: 'W2 demo',
        description: 'Demo of the create API.',
        state: 'in-progress',
        tags: ['Docs', 'agent notes', 'docs'],
      },
      dir,
      now,
    );
    expect(created).toEqual({
      dataset: 'task',
      slug: 'w2-demo',
      path: 'task/w2-demo/index.md',
      url: '/task/w2-demo',
      files: ['task/w2-demo/index.md', 'task/w2-demo/log.md'],
    });
    const entryText = read(dir, 'task/w2-demo/index.md');
    expect(entryText).toContain('title: W2 demo\n');
    expect(entryText).toContain('state: in-progress\n');
    expect(entryText).toContain('tags: [docs, agent-notes]\n');
    const entry = await readEntry('task', 'w2-demo', dir);
    expect(entry.issues).toEqual([]);
    expect(entry.frontmatter).toMatchObject({
      state: 'in-progress',
      tags: ['docs', 'agent-notes'],
    });

    // The same inputs through scripts/add-entry.ts give byte-identical files (tags aside: the script has no flag).
    const scriptDir = tmp.make();
    const run = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'scripts', 'add-entry.ts'),
        'task',
        'w2-demo',
        '--title',
        'W2 demo',
        '--description',
        'Demo of the create API.',
        '--state',
        'in-progress',
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, CTXMAN_DATA_DIR: scriptDir, NO_COLOR: '1' },
        encoding: 'utf8',
      },
    );
    expect(run.status).toBe(0);
    const stamp = /\d{4}-\d\d-\d\d(?:T[\d:.]+Z)?/g;
    for (const rel of created.files) {
      const apiText = read(dir, rel).replace('tags: [docs, agent-notes]', 'tags: []');
      expect(apiText.replace(stamp, 'T'), rel).toBe(read(scriptDir, rel).replace(stamp, 'T'));
    }
  });

  it('works for a dataset without lifecycle and with only name + description', async () => {
    const dir = tmp.make();
    const created = await createEntry(
      'kb',
      { name: 'notes', description: 'Some notes.' },
      dir,
      now,
    );
    expect(created.path).toBe('kb/notes/index.md');
    const entry = await readEntry('kb', 'notes', dir);
    expect(entry.frontmatter).toMatchObject({
      type: 'Knowledge Base',
      name: 'notes',
      title: 'Notes',
    });
    expect(entry.frontmatter).not.toHaveProperty('state');
    expect(entry.issues).toEqual([]);
  });

  it('creates a skill', async () => {
    const dir = tmp.make();
    const created = await createEntry(
      'skill',
      { name: 'my-skill', description: 'Does things.' },
      dir,
    );
    expect(created.files).toEqual(['skill/my-skill/SKILL.md']);
    expect((await readEntry('skill', 'my-skill', dir)).frontmatter).toEqual({
      name: 'my-skill',
      description: 'Does things.',
    });
  });

  it('answers `exists` and leaves the existing entry alone', async () => {
    const dir = tmp.make(validDataTree());
    const before = read(dir, 'task/do-it/index.md');
    const error = await ioFailure(
      createEntry('task', { name: 'do-it', description: 'Again' }, dir),
    );
    expect(error.code).toBe('exists');
    expect(read(dir, 'task/do-it/index.md')).toBe(before);
  });
});

describe('createEntry: validation (nothing written)', () => {
  it('reports every bad field under its own path', async () => {
    const dir = tmp.make();
    const error = await ioFailure(
      createEntry(
        'kb',
        {
          name: 'Bad Name',
          description: '  ',
          title: 5,
          state: 'pending',
          tags: ['no!'],
          parent: 'x',
          extra: 1,
        },
        dir,
      ),
    );
    expect(error.code).toBe('invalid');
    expect(error.issues.map((i) => i.path).sort()).toEqual([
      'description',
      'extra',
      'name',
      'state',
      'tags.0',
      'title',
    ]);
    expect(existsSync(path.join(dir, 'kb'))).toBe(false);
  });

  it('skills take only name and description (+ parent)', async () => {
    const dir = tmp.make();
    const error = await ioFailure(
      createEntry(
        'skill',
        { name: 's', description: 'd', title: 'T', state: 'pending', tags: [] },
        dir,
      ),
    );
    expect(error.issues.map((i) => i.path)).toEqual(['title', 'state', 'tags']);
  });

  it('rejects datasets without an entry directory and non-object bodies', async () => {
    const dir = tmp.make();
    expect((await ioFailure(createEntry('context', {}, dir))).code).toBe('bad-dataset');
    expect((await ioFailure(createEntry('reference', {}, dir))).code).toBe('bad-dataset');
    expect((await ioFailure(createEntry('task', null, dir))).code).toBe('invalid');
    expect((await ioFailure(createEntry('task', { name: 'x' }, dir))).issues).toEqual([
      { path: 'description', message: 'is required' },
    ]);
  });
});

describe('createEntry: parent project', () => {
  const projectTree = (): string =>
    tmp.make({
      'project/proj/index.md':
        '---\ntype: Project\nname: proj\ndescription: A project.\nstate: pending\ntags: [x]\n---\n\n# Proj\n',
    });

  it('appends a child link to the project, leaving the rest of its frontmatter alone', async () => {
    const dir = projectTree();
    const created = await createEntry(
      'task',
      { name: 'child-one', description: 'First child.', parent: 'proj' },
      dir,
      now,
    );
    expect(created.parentLinked).toBe(true);
    expect(read(dir, 'project/proj/index.md')).toBe(
      '---\ntype: Project\nname: proj\ndescription: A project.\nstate: pending\ntags: [x]\nlinks:\n  - dataset: task\n    slug: child-one\n    rel: child\n---\n\n# Proj\n',
    );
    await createEntry(
      'bug',
      { name: 'child-two', description: 'Second.', parent: 'proj' },
      dir,
      now,
    );
    const links = (await readEntry('project', 'proj', dir)).frontmatter.links;
    expect(links).toEqual([
      { dataset: 'task', slug: 'child-one', rel: 'child' },
      { dataset: 'bug', slug: 'child-two', rel: 'child' },
    ]);
  });

  it('a missing parent is a 400 on `parent` and nothing is written', async () => {
    const dir = projectTree();
    const error = await ioFailure(
      createEntry('task', { name: 'orphan', description: 'No parent.', parent: 'nope' }, dir),
    );
    expect(error.code).toBe('invalid');
    expect(error.issues).toEqual([{ path: 'parent', message: 'project "nope" does not exist' }]);
    expect(existsSync(path.join(dir, 'task'))).toBe(false);
  });

  it('keeps the new entry and reports parentLinked: false when the project cannot be patched', async () => {
    const dir = tmp.make({
      'project/proj/index.md':
        '---\ntype: Project\nname: proj\ndescription: P.\nstate: pending\nfoo: [\n---\n',
    });
    const created = await createEntry(
      'task',
      { name: 'kept', description: 'Kept.', parent: 'proj' },
      dir,
    );
    expect(created.parentLinked).toBe(false);
    expect(created.parentError).toContain('project/proj/index.md');
    expect(existsSync(path.join(dir, 'task', 'kept', 'index.md'))).toBe(true);
  });
});
