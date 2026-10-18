import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { schemaCommentLine } from '../../src/lib/schema-comment.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';
import { runCli } from './fixtures/run-cli.ts';

const ORIGIN = 'http://127.0.0.1:4321';

const tmp = trackTemp();
afterAll(() => tmp.cleanup());

describe.concurrent('fix-yaml-comments.ts', { timeout: 20_000 }, () => {
  const tree = () => ({
    'reference/a.yaml': 'name: a\n',
    'context/b.yaml': `${schemaCommentLine('recipe', ORIGIN)}\nname: b\n`,
    'recipe/c.yaml': '﻿name: c\r\ndescription: d\r\n',
    'recipe/d.yaml': `${schemaCommentLine('recipe', ORIGIN)}\nname: d\n`,
    'recipe/.hidden.yaml': 'ignored\n',
    'recipe/note.md': 'stray\n',
  });

  it('fixes missing / wrong comments, touches nothing else, and is idempotent', async ({
    expect,
  }) => {
    const dir = tmp.make(tree());
    const first = await runCli('fix-yaml-comments.ts', dir);
    expect(first.code).toBe(0);
    expect(first.stderr).toBe('');
    expect(first.stdout.trim().split('\n')).toEqual([
      'fixed reference/a.yaml',
      'fixed context/b.yaml',
      'fixed recipe/c.yaml',
      '3 files fixed',
    ]);
    const read = (rel: string) => readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
    expect(read('reference/a.yaml')).toBe(`${schemaCommentLine('reference', ORIGIN)}\nname: a\n`);
    expect(read('context/b.yaml')).toBe(`${schemaCommentLine('context', ORIGIN)}\nname: b\n`);
    expect(read('recipe/c.yaml')).toBe(
      `${schemaCommentLine('recipe', ORIGIN)}\r\nname: c\r\ndescription: d\r\n`,
    );
    expect(read('recipe/d.yaml')).toBe(`${schemaCommentLine('recipe', ORIGIN)}\nname: d\n`);
    expect(read('recipe/.hidden.yaml')).toBe('ignored\n');
    expect(read('recipe/note.md')).toBe('stray\n');

    const second = await runCli('fix-yaml-comments.ts', dir, '--json');
    expect(second.code).toBe(0);
    expect(JSON.parse(second.stdout)).toEqual({ ok: true, fixed: [] });
  });

  it('--json lists the fixed files; --help exits 0; unknown flags exit 2', async ({ expect }) => {
    const dir = tmp.make(tree());
    // --help and --bogus never touch the tree, so all three runs overlap.
    const [r, help, bad] = await Promise.all([
      runCli('fix-yaml-comments.ts', dir, '--json'),
      runCli('fix-yaml-comments.ts', dir, '--help'),
      runCli('fix-yaml-comments.ts', dir, '--bogus'),
    ]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: true,
      fixed: ['reference/a.yaml', 'context/b.yaml', 'recipe/c.yaml'],
    });
    expect(help.stdout).toContain('Usage:');
    expect(bad.code).toBe(2);
    expect(bad.stdout).toBe('');
  });

  it('a data dir without yaml datasets is fine', async ({ expect }) => {
    const r = await runCli('fix-yaml-comments.ts', tmp.make(), '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, fixed: [] });
  });

  it('a fresh add-entry file needs no fixing', async ({ expect }) => {
    const dir = tmp.make();
    expect(
      (
        await runCli(
          'add-entry.ts',
          dir,
          'reference',
          'demo',
          '--type',
          'local-repo',
          '--path',
          '/tmp',
        )
      ).code,
    ).toBe(0);
    expect(JSON.parse((await runCli('fix-yaml-comments.ts', dir, '--json')).stdout).fixed).toEqual(
      [],
    );
  });
});
