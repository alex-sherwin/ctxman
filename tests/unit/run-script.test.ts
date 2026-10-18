import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATASET_IDS } from '../../src/datasets/registry.ts';
import {
  buildArgs,
  EXIT_SPAWN_FAILED,
  EXIT_TIMEOUT,
  executeScript,
  MAX_OUTPUT_BYTES,
  runNodeFile,
  runScript,
} from '../../src/lib/run-script.ts';
import { SCRIPTS } from '../../src/lib/scripts-allowlist.ts';
import type { ScriptName } from '../../src/lib/scripts-allowlist.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

// Every test spawns one or more `node` child processes.
vi.setConfig({ testTimeout: 60_000 });

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const CHECKS = SCRIPTS.filter((s) => s.kind === 'check').map((s) => s.name);

describe('buildArgs', () => {
  it('check scripts take no arguments: absent body or {}', () => {
    for (const name of CHECKS) {
      expect(buildArgs(name, undefined)).toEqual({ ok: true, args: [] });
      expect(buildArgs(name, {})).toEqual({ ok: true, args: [] });
    }
  });

  it('check scripts reject properties and non-object bodies', () => {
    expect(buildArgs('check', { extra: 1 })).toEqual({
      ok: false,
      issues: [{ path: 'extra', message: 'unexpected property' }],
    });
    for (const body of [null, [], 'x', 3, true]) {
      const r = buildArgs('check-okf', body);
      expect(r.ok).toBe(false);
    }
  });

  it('add builds [dataset, name, --description, d] and created (entry file path)', () => {
    expect(buildArgs('add', { dataset: 'task', name: 'my-task', description: 'Do it' })).toEqual({
      ok: true,
      args: ['task', 'my-task', '--description', 'Do it'],
      created: {
        dataset: 'task',
        slug: 'my-task',
        path: 'task/my-task/main.md',
        url: '/task/my-task',
      },
    });
  });

  it('add appends --title when non-blank and ignores a blank or null title', () => {
    const base = { dataset: 'kb', name: 'a', description: 'd' };
    expect(buildArgs('add', { ...base, title: 'A title' })).toMatchObject({
      args: ['kb', 'a', '--description', 'd', '--title', 'A title'],
    });
    for (const title of ['', '  ', null]) {
      expect(buildArgs('add', { ...base, title })).toMatchObject({
        ok: true,
        args: ['kb', 'a', '--description', 'd'],
      });
    }
  });

  it('created.path follows the dataset kind for every dataset', () => {
    const expected: Record<string, string> = {
      kb: 'kb/x/main.md',
      skill: 'skill/x/SKILL.md',
      reference: 'reference/x.yaml',
      context: 'context/x.yaml',
      recipe: 'recipe/x.yaml',
    };
    for (const dataset of DATASET_IDS) {
      const r = buildArgs('add', { dataset, name: 'x', description: 'd' });
      expect(r.ok && r.created?.path).toBe(expected[dataset] ?? `${dataset}/x/main.md`);
    }
  });

  it('created.url is the entry page of every dataset', () => {
    for (const dataset of DATASET_IDS) {
      const r = buildArgs('add', { dataset, name: 'x-y', description: 'd' });
      expect(r.ok && r.created?.url).toBe(`/${dataset}/x-y`);
    }
  });

  it('uses --flag=value for values that start with "-" (parseArgs would reject "--flag -x")', () => {
    expect(
      buildArgs('add', { dataset: 'idea', name: 'a', description: '-draft', title: '--odd' }),
    ).toMatchObject({ args: ['idea', 'a', '--description=-draft', '--title=--odd'] });
  });

  it('add reports one issue per bad field with the field path', () => {
    const r = buildArgs('add', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual(['dataset', 'name', 'description']);

    const bad = buildArgs('add', {
      dataset: 'nope',
      name: 'Bad_Name',
      description: '   ',
      title: 5,
      extra: true,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues.map((i) => i.path).sort()).toEqual(
        ['dataset', 'description', 'extra', 'name', 'title'].sort(),
      );
      expect(bad.issues.every((i) => i.message !== '')).toBe(true);
    }
  });

  it('add rejects argument-injection style names and non-object bodies', () => {
    for (const name of ['--help', '../x', 'a b', 'a/b', '', 'x'.repeat(65), 7]) {
      expect(buildArgs('add', { dataset: 'task', name, description: 'd' }).ok).toBe(false);
    }
    for (const body of [undefined, null, [], 'x']) expect(buildArgs('add', body).ok).toBe(false);
  });

  it('an unknown script name is an issue, not a crash', () => {
    expect(buildArgs('nope' as ScriptName, {}).ok).toBe(false);
  });
});

describe('runNodeFile', () => {
  it('captures stdout, stderr and the exit code; strips ANSI; sets color-off env', async () => {
    const dataDir = tmp.make();
    const r = await runNodeFile(fixture('emit.ts'), ['a b', '--exit=3'], {
      env: { CTXMAN_DATA_DIR: dataDir },
    });
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('green out');
    expect(r.stdout).not.toContain('\u001b');
    expect(r.stderr).toBe('red err\n');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    const echoed = JSON.parse(r.stdout.split('\n')[0] ?? '{}');
    expect(echoed.args).toEqual(['a b', '--exit=3']);
    expect(echoed.noColor).toBe('1');
    expect(echoed.forceColor).toBe('0');
    expect(echoed.dataDir).toBe(dataDir);
  });

  it('pins CTXMAN_DATA_DIR to an absolute path and honours cwd', async () => {
    const cwd = tmp.make();
    const r = await runNodeFile(fixture('emit.ts'), [], {
      cwd,
      env: { CTXMAN_DATA_DIR: 'relative-data' },
    });
    expect(r.code).toBe(0);
    const echoed = JSON.parse(r.stdout.split('\n')[0] ?? '{}');
    // Resolved against the server's cwd (not the child's), so scripts and server agree.
    expect(echoed.dataDir).toBe(path.resolve(process.cwd(), 'relative-data'));
    expect(realpathSync(echoed.cwd)).toBe(realpathSync(cwd));
  });

  it('caps each stream at 1 MiB and marks the cut', async () => {
    const r = await runNodeFile(fixture('emit.ts'), ['--flood']);
    expect(r.code).toBe(0);
    expect(r.stdout.endsWith('\n[truncated]')).toBe(true);
    expect(r.stdout.length).toBe(MAX_OUTPUT_BYTES + '\n[truncated]'.length);
  });

  it('kills a script that exceeds timeoutMs: code 124 and a stderr note', async () => {
    const started = Date.now();
    const r = await runNodeFile(fixture('sleep.ts'), [], { timeoutMs: 200 });
    expect(r.code).toBe(EXIT_TIMEOUT);
    expect(r.stdout).toContain('sleeping');
    expect(r.stderr).toContain('[ctxman] timed out after 0.2s');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('reports a spawn failure as code 127 with the reason in stderr', async () => {
    const r = await runNodeFile(fixture('emit.ts'), [], {
      cwd: path.join(tmp.make(), 'does-not-exist'),
    });
    expect(r.code).toBe(EXIT_SPAWN_FAILED);
    expect(r.stderr).toContain('could not start node');
  });
});

describe('runScript / executeScript (real repo scripts against a temp data dir)', () => {
  it('runs an allowlisted check and reports exit 0 with its output', async () => {
    const dataDir = tmp.make();
    const r = await runScript('check', [], { env: { CTXMAN_DATA_DIR: dataDir } });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('All checks: OK');
    expect(r.stderr).toBe('');
    expect(r.created).toBeUndefined();
  });

  it('a failing check is a normal result with a non-zero code', async () => {
    const dataDir = tmp.make({ 'kb/broken/index.md': '# no main.md here\n' });
    const run = await executeScript('check-okf', {}, { env: { CTXMAN_DATA_DIR: dataDir } });
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.result.code).toBe(1);
      expect(run.result.stdout).toContain('okf/missing-main');
      expect(run.result.created).toBeUndefined();
    }
  });

  it('runScript refuses names outside the allowlist', async () => {
    await expect(runScript('nope' as ScriptName, [])).rejects.toThrow(/not allowlisted/);
  });

  it('add creates the entry and returns created only on exit 0', async () => {
    const dataDir = tmp.make();
    const env = { CTXMAN_DATA_DIR: dataDir };
    const body = { dataset: 'task', name: 'rs-task', description: 'From run-script test' };

    const first = await executeScript('add', body, { env });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.result.code).toBe(0);
      expect(first.result.created).toEqual({
        dataset: 'task',
        slug: 'rs-task',
        path: 'task/rs-task/main.md',
        url: '/task/rs-task',
      });
    }
    expect(existsSync(path.join(dataDir, 'task', 'rs-task', 'main.md'))).toBe(true);

    const again = await executeScript('add', body, { env });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.result.code).toBe(1);
      expect(again.result.stderr).toContain('already exists');
      expect(again.result.created).toBeUndefined();
    }
  });

  it('executeScript returns the validation issues without running anything', async () => {
    const dataDir = tmp.make();
    const run = await executeScript(
      'add',
      { dataset: 'task' },
      { env: { CTXMAN_DATA_DIR: dataDir } },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.issues.map((i) => i.path)).toEqual(['name', 'description']);
    expect(existsSync(path.join(dataDir, 'task'))).toBe(false);
  });
});
