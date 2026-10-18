import { afterAll, describe, it } from 'vitest';
import { runCli } from './fixtures/run-cli.ts';
import { trackTemp, validDataTree, withYamlComments } from './fixtures/data-fixtures.ts';

// Each test spawns one or more `node scripts/*.ts` processes; the tests of a describe run concurrently.
const tmp = trackTemp();
afterAll(() => tmp.cleanup());

describe.concurrent('CTXMAN_DATA_DIR is required', { timeout: 20_000 }, () => {
  it.for(['check-all.ts', 'check-okf.ts', 'fix-yaml-comments.ts'])(
    '%s exits 2 with the instructions when the variable is unset',
    async (script, { expect }) => {
      const r = await runCli(script, '');
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('CTXMAN_DATA_DIR is not set');
    },
  );

  it('add-entry.ts exits 2 with the instructions when the variable is unset', async ({
    expect,
  }) => {
    const r = await runCli('add-entry.ts', '', 'task', 'x', '--description', 'd');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('CTXMAN_DATA_DIR is not set');
  });
});

describe.concurrent('check-all.ts', { timeout: 20_000 }, () => {
  it('exits 0 with a combined JSON report on an empty data dir', async ({ expect }) => {
    const r = await runCli('check-all.ts', tmp.make(), '--json');
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

  it('prints a human summary and exits 0 for a clean tree', async ({ expect }) => {
    const r = await runCli('check-all.ts', tmp.make(validDataTree()));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('OKF: OK (');
    expect(r.stdout).toContain('Links: OK (');
    expect(r.stdout).toContain('Collections: OK (');
    expect(r.stdout.trim().split('\n').at(-1)).toBe('All checks: OK');
  });

  it('exits 1 on errors, still exits 0 on warnings only', async ({ expect }) => {
    const broken = tmp.make({
      ...validDataTree(),
      'kb/demo/concepts/broken.md': '---\ntype: T\n---\n[x](/nope.md)\n',
    });
    const warnOnly = tmp.make(
      withYamlComments({
        ...validDataTree(),
        'context/dangling.yaml':
          'name: dangling\ndescription: d\nlinks:\n  - dataset: kb\n    slug: gone\n',
      }),
    );
    const [bad, ok] = await Promise.all([
      runCli('check-all.ts', broken, '--json'),
      runCli('check-all.ts', warnOnly),
    ]);
    expect(bad.code).toBe(1);
    const json = JSON.parse(bad.stdout);
    expect(json.ok).toBe(false);
    expect(json.checks.links.errors).toBe(1);
    expect(json.checks.links.findings[0]).toMatchObject({ rule: 'links/broken', line: 4 });

    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('WARN  collections/dangling-link');
    expect(ok.stdout.trim().split('\n').at(-1)).toBe('All checks: 0 errors, 1 warnings');
  });

  it('exits 2 on unknown flags and prints nothing on stdout', async ({ expect }) => {
    const r = await runCli('check-all.ts', tmp.make(), '--bogus');
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Usage');
  });
});

describe.concurrent('check-okf / check-links / check-collections', { timeout: 20_000 }, () => {
  const dir = () =>
    tmp.make({
      ...validDataTree(),
      'kb/demo/concepts/two.md': '---\ntitle: no type\n---\n[x](/nope.md)\n',
      'skill/my-skill/SKILL.md': '---\nname: my-skill\ndescription: d\nextra: nope\n---\n',
    });

  it.for([
    ['check-okf.ts', 'okf/type'],
    ['check-links.ts', 'links/broken'],
    ['check-collections.ts', 'collections/schema'],
  ] as const)(
    '%s reports its own rules, as text and as JSON',
    async ([script, rule], { expect }) => {
      const d = dir();
      const [text, json] = await Promise.all([runCli(script, d), runCli(script, d, '--json')]);
      expect(text.code).toBe(1);
      expect(text.stdout).toContain(`ERROR ${rule}`);

      expect(json.code).toBe(1);
      const report = JSON.parse(json.stdout);
      expect(report.ok).toBe(false);
      expect(report.findings.map((f: { rule: string }) => f.rule)).toContain(rule);
      expect(typeof report.filesChecked).toBe('number');
    },
  );

  it('exit 0 on a clean tree', async ({ expect }) => {
    const scripts = ['check-okf.ts', 'check-links.ts', 'check-collections.ts'];
    const results = await Promise.all(
      scripts.map((script) => runCli(script, tmp.make(validDataTree()), '--json')),
    );
    results.forEach((r, i) => {
      expect(r.code, scripts[i]).toBe(0);
      expect(JSON.parse(r.stdout).ok).toBe(true);
    });
  });
});
