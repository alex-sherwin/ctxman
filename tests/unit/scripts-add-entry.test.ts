import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { schemaCommentLine } from '../../src/lib/schema-comment.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';
import { runCli } from './fixtures/run-cli.ts';

const ORIGIN = 'http://127.0.0.1:4321';

const tmp = trackTemp();
afterAll(() => tmp.cleanup());

describe.concurrent('add-entry.ts', { timeout: 20_000 }, () => {
  it('creates a lifecycle entry, reports JSON, and the result passes check-all', async ({
    expect,
  }) => {
    const dir = tmp.make();
    const r = await runCli('add-entry.ts', dir, 'task', 't1', '--json');
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual({
      ok: true,
      dataset: 'task',
      slug: 't1',
      path: 'task/t1/index.md',
      files: ['task/t1/index.md', 'task/t1/log.md'],
    });
    const entryText = readFileSync(path.join(dir, 'task', 't1', 'index.md'), 'utf8');
    expect(entryText).toContain('okf_version: "0.2"\ntype: Task\nname: t1\ntitle: T1\n');
    expect(entryText).toContain('state: pending\n');
    expect((await runCli('check-all.ts', dir, '--json')).code).toBe(0);
  });

  it('refuses to overwrite, leaving the existing entry untouched', async ({ expect }) => {
    const dir = tmp.make();
    expect((await runCli('add-entry.ts', dir, 'kb', 'demo', '--description', 'First')).code).toBe(
      0,
    );
    const file = path.join(dir, 'kb', 'demo', 'index.md');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nedited by hand\n`);
    const [again, json] = await Promise.all([
      runCli('add-entry.ts', dir, 'kb', 'demo', '--description', 'Second'),
      runCli('add-entry.ts', dir, 'kb', 'demo', '--json'),
    ]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('already exists');
    expect(readFileSync(file, 'utf8')).toContain('edited by hand');
    expect(readFileSync(file, 'utf8')).toContain('description: First');

    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: false });
    expect(JSON.parse(json.stdout).error).toContain('already exists');
  });

  it('prints created files and the open URL in text mode', async ({ expect }) => {
    const dir = tmp.make();
    const r = await runCli('add-entry.ts', dir, 'kb', 'demo', '--description', 'Demo');
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines[0]).toBe('Created kb "demo":');
    expect(lines.slice(1, 3)).toEqual([
      `  ${path.join(dir, 'kb', 'demo', 'index.md')}`,
      `  ${path.join(dir, 'kb', 'demo', 'log.md')}`,
    ]);
    expect(lines[3]).toBe('Open: http://127.0.0.1:4321/kb/demo');
  });

  it.for([
    [['skill', 'my-skill', '--description', 'A skill'], 'skill/my-skill/SKILL.md'],
    [['context', 'my-ctx', '--description', 'Ctx: with colon'], 'context/my-ctx.yaml'],
    [['recipe', 'my-recipe', '--description', 'Recipe: with colon'], 'recipe/my-recipe.yaml'],
    [
      ['reference', 'my-ref', '--type', 'local-repo', '--path', '/tmp', '--owner', 'me'],
      'reference/my-ref.yaml',
    ],
    [
      ['reference', 'my-folder', '--type', 'local-folder', '--path', '/tmp', '--owner', 'me'],
      'reference/my-folder.yaml',
    ],
    [
      [
        'reference',
        'my-skill-ref',
        '--type',
        'remote-skill',
        '--uri',
        'https://github.com/a/b.git',
        '--owner',
        'not-me',
      ],
      'reference/my-skill-ref.yaml',
    ],
    [
      ['reference', 'scp-ref', '--uri', 'git@github.com:meow-sci/catcom.git'],
      'reference/scp-ref.yaml',
    ],
    [
      [
        'reference',
        'tar-skill',
        '--type',
        'remote-skill',
        '--uri',
        'https://h.test/skill-latest.tar.gz',
      ],
      'reference/tar-skill.yaml',
    ],
    [['bug', 'b1', '--state', 'wont-fix', '--title', 'A "quoted": title'], 'bug/b1/index.md'],
  ] as [string[], string][])(
    'creates %j and the result passes check-all',
    async ([args, expectedPath], { expect }) => {
      const dir = tmp.make();
      const r = await runCli('add-entry.ts', dir, ...args, '--json');
      expect(r.code, r.stderr).toBe(0);
      expect(JSON.parse(r.stdout).path).toBe(expectedPath);
      expect(existsSync(path.join(dir, ...expectedPath.split('/')))).toBe(true);
      const [datasetId] = expectedPath.split('/');
      if (datasetId === 'reference' || datasetId === 'context' || datasetId === 'recipe') {
        const text = readFileSync(path.join(dir, ...expectedPath.split('/')), 'utf8');
        expect(text.split('\n')[0]).toBe(schemaCommentLine(datasetId, ORIGIN));
      }
      const check = await runCli('check-all.ts', dir, '--json');
      expect(check.code, check.stdout).toBe(0);
      expect(JSON.parse(check.stdout).checks.collections.warnings).toBe(0);
    },
  );

  it('exits 2 on usage errors and writes nothing', async ({ expect }) => {
    const dir = tmp.make();
    const cases: string[][] = [
      [],
      ['kb'],
      ['nope', 'x'],
      ['kb', 'Bad_Name'],
      ['kb', 'ok', 'extra'],
      ['task', 'x', '--state', 'done'],
      ['kb', 'x', '--state', 'pending'],
      ['kb', 'x', '--type', 'local-repo'],
      ['reference', 'x', '--type', 'bogus'],
      ['reference', 'x', '--owner', 'them'],
      ['reference', 'x', '--type', 'remote-repo', '--path', '/tmp'],
      ['reference', 'x', '--type', 'local-repo', '--uri', 'https://x'],
      ['reference', 'x', '--type', 'local-folder', '--uri', 'https://x'],
      ['reference', 'x', '--type', 'remote-repo', '--uri', 'not a uri'],
      ['reference', 'x', '--type', 'remote-repo', '--uri', 'https://h.test/a/b.tar.gz'],
      ['reference', 'x', '--type', 'remote-skill', '--uri', 'https://h.test/b.rar'],
      ['kb', 'x', '--bogus'],
    ];
    const [results, badName] = await Promise.all([
      Promise.all(cases.map((args) => runCli('add-entry.ts', dir, ...args))),
      runCli('add-entry.ts', dir, 'kb', 'Bad_Name'),
    ]);
    results.forEach((r, i) => {
      const label = cases[i]!.join(' ');
      expect(r.code, label).toBe(2);
      expect(r.stdout, label).toBe('');
      expect(r.stderr, label).not.toBe('');
    });
    expect(existsSync(path.join(dir, 'kb'))).toBe(false);
    expect(badName.stderr).toContain('lowercase letters');
  });

  it('under --json a usage error still prints exactly one JSON document', async ({ expect }) => {
    const r = await runCli('add-entry.ts', tmp.make(), 'kb', 'Bad_Name', '--json');
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false });
  });

  it('--help prints usage on stdout and exits 0', async ({ expect }) => {
    const r = await runCli('add-entry.ts', tmp.make(), '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: node scripts/add-entry.ts');
  });
});
