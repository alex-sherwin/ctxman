import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { schemaCommentLine } from '../../src/lib/schema-comment.ts';
import { trackTemp, validDataTree, withYamlComments } from './fixtures/data-fixtures.ts';

// Each test spawns one or more `node scripts/*.ts` processes.
vi.setConfig({ testTimeout: 60_000 });

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs scripts/<script> with Node (type stripping) against a temp data dir. */
function run(script: string, dataDir: string, ...args: string[]): Run {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', script), ...args], {
    cwd: repoRoot,
    env: { ...process.env, CTXMAN_DATA_DIR: dataDir, NO_COLOR: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('check-all.ts', () => {
  it('exits 0 with a combined JSON report on an empty data dir', () => {
    const r = run('check-all.ts', tmp.make(), '--json');
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    const json = JSON.parse(r.stdout);
    expect(json.ok).toBe(true);
    expect(Object.keys(json.checks)).toEqual(['okf', 'links', 'collections']);
    for (const report of Object.values<Record<string, unknown>>(json.checks)) {
      expect(report).toMatchObject({
        ok: true,
        errors: 0,
        warnings: 0,
        findings: [],
        filesChecked: 0,
      });
    }
  });

  it('prints a human summary and exits 0 for a clean tree', () => {
    const r = run('check-all.ts', tmp.make(validDataTree()));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('OKF: OK (');
    expect(r.stdout).toContain('Links: OK (');
    expect(r.stdout).toContain('Collections: OK (');
    expect(r.stdout.trim().split('\n').at(-1)).toBe('All checks: OK');
  });

  it('exits 1 on errors, still exits 0 on warnings only', () => {
    const broken = tmp.make({
      ...validDataTree(),
      'kb/demo/concepts/broken.md': '---\ntype: T\n---\n[x](/nope.md)\n',
    });
    const bad = run('check-all.ts', broken, '--json');
    expect(bad.code).toBe(1);
    const json = JSON.parse(bad.stdout);
    expect(json.ok).toBe(false);
    expect(json.checks.links.errors).toBe(1);
    expect(json.checks.links.findings[0]).toMatchObject({ rule: 'links/broken', line: 4 });

    const warnOnly = tmp.make(
      withYamlComments({
        ...validDataTree(),
        'context/dangling.yaml':
          'name: dangling\ndescription: d\nlinks:\n  - dataset: kb\n    slug: gone\n',
      }),
    );
    const ok = run('check-all.ts', warnOnly);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('WARN  collections/dangling-link');
    expect(ok.stdout.trim().split('\n').at(-1)).toBe('All checks: 0 errors, 1 warnings');
  });

  it('exits 2 on unknown flags and prints nothing on stdout', () => {
    const r = run('check-all.ts', tmp.make(), '--bogus');
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Usage');
  });
});

describe('check-okf / check-links / check-collections', () => {
  const dir = () =>
    tmp.make({
      ...validDataTree(),
      'kb/demo/concepts/two.md': '---\ntitle: no type\n---\n[x](/nope.md)\n',
      'skill/my-skill/SKILL.md': '---\nname: my-skill\ndescription: d\nextra: nope\n---\n',
    });

  it.each([
    ['check-okf.ts', 'okf/type'],
    ['check-links.ts', 'links/broken'],
    ['check-collections.ts', 'collections/schema'],
  ])('%s reports its own rules, as text and as JSON', (script, rule) => {
    const d = dir();
    const text = run(script, d);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain(`ERROR ${rule}`);

    const json = run(script, d, '--json');
    expect(json.code).toBe(1);
    const report = JSON.parse(json.stdout);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f: { rule: string }) => f.rule)).toContain(rule);
    expect(typeof report.filesChecked).toBe('number');
  });

  it('exit 0 on a clean tree', () => {
    for (const script of ['check-okf.ts', 'check-links.ts', 'check-collections.ts']) {
      const r = run(script, tmp.make(validDataTree()), '--json');
      expect(r.code, script).toBe(0);
      expect(JSON.parse(r.stdout).ok).toBe(true);
    }
  });
});

describe('add-entry.ts', () => {
  it('creates a lifecycle entry, reports JSON, and the result passes check-all', () => {
    const dir = tmp.make();
    const r = run('add-entry.ts', dir, 'task', 't1', '--json');
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual({
      ok: true,
      dataset: 'task',
      slug: 't1',
      path: 'task/t1/main.md',
      files: ['task/t1/index.md', 'task/t1/main.md', 'task/t1/log.md'],
    });
    const main = readFileSync(path.join(dir, 'task', 't1', 'main.md'), 'utf8');
    expect(main).toContain('type: Task\nname: t1\ntitle: T1\n');
    expect(main).toContain('state: pending\n');
    expect(run('check-all.ts', dir, '--json').code).toBe(0);
  });

  it('refuses to overwrite, leaving the existing entry untouched', () => {
    const dir = tmp.make();
    expect(run('add-entry.ts', dir, 'kb', 'demo', '--description', 'First').code).toBe(0);
    const file = path.join(dir, 'kb', 'demo', 'main.md');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nedited by hand\n`);
    const again = run('add-entry.ts', dir, 'kb', 'demo', '--description', 'Second');
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('already exists');
    expect(readFileSync(file, 'utf8')).toContain('edited by hand');
    expect(readFileSync(file, 'utf8')).toContain('description: First');

    const json = run('add-entry.ts', dir, 'kb', 'demo', '--json');
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: false });
    expect(JSON.parse(json.stdout).error).toContain('already exists');
  });

  it('prints created files and the open URL in text mode', () => {
    const dir = tmp.make();
    const r = run('add-entry.ts', dir, 'kb', 'demo', '--description', 'Demo');
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines[0]).toBe('Created kb "demo":');
    expect(lines.slice(1, 4)).toEqual([
      `  ${path.join(dir, 'kb', 'demo', 'index.md')}`,
      `  ${path.join(dir, 'kb', 'demo', 'main.md')}`,
      `  ${path.join(dir, 'kb', 'demo', 'log.md')}`,
    ]);
    expect(lines[4]).toBe('Open: http://127.0.0.1:4321/kb/demo');
  });

  it.each([
    [['skill', 'my-skill', '--description', 'A skill'], 'skill/my-skill/SKILL.md'],
    [['context', 'my-ctx', '--description', 'Ctx: with colon'], 'context/my-ctx.yaml'],
    [['recipe', 'my-recipe', '--description', 'Recipe: with colon'], 'recipe/my-recipe.yaml'],
    [
      ['reference', 'my-ref', '--type', 'local-repo', '--path', '/tmp', '--owner', 'me'],
      'reference/my-ref.yaml',
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
    [['bug', 'b1', '--state', 'wont-fix', '--title', 'A "quoted": title'], 'bug/b1/main.md'],
  ])('creates %j and the result passes check-all', (args, expectedPath) => {
    const dir = tmp.make();
    const r = run('add-entry.ts', dir, ...args, '--json');
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).path).toBe(expectedPath);
    expect(existsSync(path.join(dir, ...expectedPath.split('/')))).toBe(true);
    const [datasetId] = expectedPath.split('/');
    if (datasetId === 'reference' || datasetId === 'context' || datasetId === 'recipe') {
      const text = readFileSync(path.join(dir, ...expectedPath.split('/')), 'utf8');
      expect(text.split('\n')[0]).toBe(schemaCommentLine(datasetId));
    }
    const check = run('check-all.ts', dir, '--json');
    expect(check.code, check.stdout).toBe(0);
    expect(JSON.parse(check.stdout).checks.collections.warnings).toBe(0);
  });

  it('exits 2 on usage errors and writes nothing', () => {
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
      ['reference', 'x', '--type', 'remote-repo', '--uri', 'not a uri'],
      ['reference', 'x', '--type', 'remote-repo', '--uri', 'https://h.test/a/b.tar.gz'],
      ['reference', 'x', '--type', 'remote-skill', '--uri', 'https://h.test/b.rar'],
      ['kb', 'x', '--bogus'],
    ];
    for (const args of cases) {
      const r = run('add-entry.ts', dir, ...args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.stdout, args.join(' ')).toBe('');
      expect(r.stderr, args.join(' ')).not.toBe('');
    }
    expect(existsSync(path.join(dir, 'kb'))).toBe(false);
    expect(run('add-entry.ts', dir, 'kb', 'Bad_Name').stderr).toContain('lowercase letters');
  });

  it('under --json a usage error still prints exactly one JSON document', () => {
    const r = run('add-entry.ts', tmp.make(), 'kb', 'Bad_Name', '--json');
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false });
  });

  it('--help prints usage on stdout and exits 0', () => {
    const r = run('add-entry.ts', tmp.make(), '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: node scripts/add-entry.ts');
  });
});

describe('fix-yaml-comments.ts', () => {
  const tree = () => ({
    'reference/a.yaml': 'name: a\n',
    'context/b.yaml': `${schemaCommentLine('recipe')}\nname: b\n`,
    'recipe/c.yaml': '\uFEFFname: c\r\ndescription: d\r\n',
    'recipe/d.yaml': `${schemaCommentLine('recipe')}\nname: d\n`,
    'recipe/.hidden.yaml': 'ignored\n',
    'recipe/note.md': 'stray\n',
  });

  it('fixes missing / wrong comments, touches nothing else, and is idempotent', () => {
    const dir = tmp.make(tree());
    const first = run('fix-yaml-comments.ts', dir);
    expect(first.code).toBe(0);
    expect(first.stderr).toBe('');
    expect(first.stdout.trim().split('\n')).toEqual([
      'fixed reference/a.yaml',
      'fixed context/b.yaml',
      'fixed recipe/c.yaml',
      '3 files fixed',
    ]);
    const read = (rel: string) => readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
    expect(read('reference/a.yaml')).toBe(`${schemaCommentLine('reference')}\nname: a\n`);
    expect(read('context/b.yaml')).toBe(`${schemaCommentLine('context')}\nname: b\n`);
    expect(read('recipe/c.yaml')).toBe(
      `${schemaCommentLine('recipe')}\r\nname: c\r\ndescription: d\r\n`,
    );
    expect(read('recipe/d.yaml')).toBe(`${schemaCommentLine('recipe')}\nname: d\n`);
    expect(read('recipe/.hidden.yaml')).toBe('ignored\n');
    expect(read('recipe/note.md')).toBe('stray\n');

    const second = run('fix-yaml-comments.ts', dir, '--json');
    expect(second.code).toBe(0);
    expect(JSON.parse(second.stdout)).toEqual({ ok: true, fixed: [] });
  });

  it('--json lists the fixed files; --help exits 0; unknown flags exit 2', () => {
    const dir = tmp.make(tree());
    const r = run('fix-yaml-comments.ts', dir, '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: true,
      fixed: ['reference/a.yaml', 'context/b.yaml', 'recipe/c.yaml'],
    });
    expect(run('fix-yaml-comments.ts', dir, '--help').stdout).toContain('Usage:');
    const bad = run('fix-yaml-comments.ts', dir, '--bogus');
    expect(bad.code).toBe(2);
    expect(bad.stdout).toBe('');
  });

  it('a data dir without yaml datasets is fine', () => {
    const r = run('fix-yaml-comments.ts', tmp.make(), '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, fixed: [] });
  });

  it('a fresh add-entry file needs no fixing', () => {
    const dir = tmp.make();
    expect(
      run('add-entry.ts', dir, 'reference', 'demo', '--type', 'local-repo', '--path', '/tmp').code,
    ).toBe(0);
    expect(JSON.parse(run('fix-yaml-comments.ts', dir, '--json').stdout).fixed).toEqual([]);
  });
});

describe('check-schemas.ts / gen-schemas.ts', () => {
  /** Runs a script with another working directory (the schemas dir is cwd-relative). */
  function runIn(cwd: string, script: string, ...args: string[]): Run {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', script), ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('the committed schemas of this repo are current (exit 0, JSON report)', () => {
    const text = run('check-schemas.ts', tmp.make());
    expect(text.code, text.stdout).toBe(0);
    expect(text.stdout.trim()).toBe('Schemas: OK (3 files)');
    const json = run('check-schemas.ts', tmp.make(), '--json');
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      ok: true,
      errors: 0,
      warnings: 0,
      filesChecked: 3,
    });
  });

  it('gen-schemas writes into <cwd>/schemas, only changed files, byte-identical to the committed ones', () => {
    const cwd = tmp.make();
    const first = runIn(cwd, 'gen-schemas.ts');
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout.trim().split('\n')).toEqual([
      'wrote schemas/reference.schema.json',
      'wrote schemas/context.schema.json',
      'wrote schemas/recipe.schema.json',
    ]);
    for (const ds of ['reference', 'context', 'recipe']) {
      const name = `${ds}.schema.json`;
      expect(readFileSync(path.join(cwd, 'schemas', name), 'utf8')).toBe(
        readFileSync(path.join(repoRoot, 'schemas', name), 'utf8'),
      );
    }
    const second = runIn(cwd, 'gen-schemas.ts', '--json');
    expect(JSON.parse(second.stdout)).toMatchObject({ ok: true, wrote: [] });
    expect(runIn(cwd, 'check-schemas.ts').code).toBe(0);
  });

  it('check-schemas exits 1 on a missing or edited file and 0 with a stray file only', () => {
    const cwd = tmp.make();
    expect(runIn(cwd, 'gen-schemas.ts').code).toBe(0);
    const file = path.join(cwd, 'schemas', 'context.schema.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('ctxman context', 'edited'));
    const drift = runIn(cwd, 'check-schemas.ts', '--json');
    expect(drift.code).toBe(1);
    expect(JSON.parse(drift.stdout).findings[0]).toMatchObject({
      rule: 'schemas/drift',
      file: 'schemas/context.schema.json',
      line: 4,
    });

    expect(runIn(cwd, 'gen-schemas.ts').code).toBe(0);
    writeFileSync(path.join(cwd, 'schemas', 'extra.json'), '{}\n');
    const stray = runIn(cwd, 'check-schemas.ts');
    expect(stray.code).toBe(0);
    expect(stray.stdout).toContain('WARN  schemas/stray');

    const empty = tmp.make();
    mkdirSync(path.join(empty, 'schemas'));
    const missing = runIn(empty, 'check-schemas.ts');
    expect(missing.code).toBe(1);
    expect(missing.stdout.match(/schemas\/missing/g)).toHaveLength(3);
  });

  it('both scripts reject unknown flags with exit 2', () => {
    expect(run('check-schemas.ts', tmp.make(), '--bogus').code).toBe(2);
    expect(run('gen-schemas.ts', tmp.make(), '--bogus').code).toBe(2);
  });
});
