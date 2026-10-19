import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { trackTemp } from './fixtures/data-fixtures.ts';
import { repoRoot, runCli, runCliIn } from './fixtures/run-cli.ts';

const tmp = trackTemp();
afterAll(() => tmp.cleanup());

describe.concurrent('check-schemas.ts / gen-schemas.ts', { timeout: 20_000 }, () => {
  it('the committed schemas of this repo are current (exit 0, JSON report)', async ({ expect }) => {
    const [text, json] = await Promise.all([
      runCli('check-schemas.ts', tmp.make()),
      runCli('check-schemas.ts', tmp.make(), '--json'),
    ]);
    expect(text.code, text.stdout).toBe(0);
    expect(text.stdout.trim()).toBe('Schemas: OK (4 files)');
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      ok: true,
      errors: 0,
      warnings: 0,
      filesChecked: 4,
    });
  });

  it('gen-schemas writes into <cwd>/schemas, only changed files, byte-identical to the committed ones', async ({
    expect,
  }) => {
    const cwd = tmp.make();
    const first = await runCliIn(cwd, 'gen-schemas.ts');
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout.trim().split('\n')).toEqual([
      'wrote schemas/reference.schema.json',
      'wrote schemas/snippet.schema.json',
      'wrote schemas/context.schema.json',
      'wrote schemas/recipe.schema.json',
    ]);
    for (const ds of ['reference', 'snippet', 'context', 'recipe']) {
      const name = `${ds}.schema.json`;
      expect(readFileSync(path.join(cwd, 'schemas', name), 'utf8')).toBe(
        readFileSync(path.join(repoRoot, 'schemas', name), 'utf8'),
      );
    }
    const second = await runCliIn(cwd, 'gen-schemas.ts', '--json');
    expect(JSON.parse(second.stdout)).toMatchObject({ ok: true, wrote: [] });
    expect((await runCliIn(cwd, 'check-schemas.ts')).code).toBe(0);
  });

  it('check-schemas exits 1 on a missing or edited file and 0 with a stray file only', async ({
    expect,
  }) => {
    const cwd = tmp.make();
    expect((await runCliIn(cwd, 'gen-schemas.ts')).code).toBe(0);
    const file = path.join(cwd, 'schemas', 'context.schema.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('ctxman context', 'edited'));
    const empty = tmp.make();
    mkdirSync(path.join(empty, 'schemas'));
    // `empty` is independent of `cwd`, so its run overlaps the drift run.
    const [drift, missing] = await Promise.all([
      runCliIn(cwd, 'check-schemas.ts', '--json'),
      runCliIn(empty, 'check-schemas.ts'),
    ]);
    expect(drift.code).toBe(1);
    expect(JSON.parse(drift.stdout).findings[0]).toMatchObject({
      rule: 'schemas/drift',
      file: 'schemas/context.schema.json',
      line: 4,
    });

    expect((await runCliIn(cwd, 'gen-schemas.ts')).code).toBe(0);
    writeFileSync(path.join(cwd, 'schemas', 'extra.json'), '{}\n');
    const stray = await runCliIn(cwd, 'check-schemas.ts');
    expect(stray.code).toBe(0);
    expect(stray.stdout).toContain('WARN  schemas/stray');

    expect(missing.code).toBe(1);
    expect(missing.stdout.match(/schemas\/missing/g)).toHaveLength(4);
  });

  it('both scripts reject unknown flags with exit 2', async ({ expect }) => {
    const [a, b] = await Promise.all([
      runCli('check-schemas.ts', tmp.make(), '--bogus'),
      runCli('gen-schemas.ts', tmp.make(), '--bogus'),
    ]);
    expect(a.code).toBe(2);
    expect(b.code).toBe(2);
  });
});
