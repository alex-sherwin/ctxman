import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  convertEntry,
  migrateDataDir,
  remainingIndexSections,
  rewriteMainLinks,
} from '../../src/lib/migrate-index.ts';
import { checkOkf } from '../../src/lib/okf.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const MAIN =
  '---\ntype: Knowledge Base\nname: demo\ntitle: Demo\ndescription: A demo.\ntags: [demo]\n---\n\n# Demo\n\nSee [one](/concepts/one.md).\n';
const OLD_INDEX =
  '---\nokf_version: "0.2"\n---\n# Demo\n\n## Entry\n\n* [Demo](/main.md) - A demo.\n\n## Concepts\n\n* [One](/concepts/one.md) - First.\n\n## Design\n\nProse.\n';

const read = (dir: string, rel: string): string =>
  readFileSync(path.join(dir, ...rel.split('/')), 'utf8');

function legacyTree(): Record<string, string> {
  return {
    'kb/demo/main.md': MAIN,
    'kb/demo/index.md': OLD_INDEX,
    'kb/demo/concepts/one.md':
      '---\ntype: Concept\n---\n\nBack to [main](../main.md#demo), [again](./main.md) and `[code](/main.md)`.\n\n[ref]: /main.md\n',
    'kb/demo/concepts/deep/two.md':
      '---\ntype: Concept\n---\n\n[up](../../main.md) [own](main.md)\n',
    'kb/demo/log.md': '# Update log\n\n## 2026-10-17\n* **Create**: Created [Demo](/main.md).\n',
    'task/plain/main.md':
      '---\ntype: Task\nname: plain\ndescription: d\nstate: pending\n---\n\n# Plain\n',
  };
}

describe('remainingIndexSections', () => {
  it('drops the title heading and the Entry section, keeps the rest verbatim', () => {
    expect(remainingIndexSections(splitBody(OLD_INDEX))).toBe(
      '## Concepts\n\n* [One](/concepts/one.md) - First.\n\n## Design\n\nProse.',
    );
  });

  it('is empty when only the title and the Entry section exist', () => {
    expect(remainingIndexSections('# T\n\n## Entry\n\n* [T](/main.md) - d\n')).toBe('');
  });

  it('keeps text under the title and ignores headings in code fences', () => {
    expect(remainingIndexSections('# T\n\nIntro.\n\n```md\n## Entry\n```\n')).toBe(
      'Intro.\n\n```md\n## Entry\n```',
    );
  });
});

function splitBody(source: string): string {
  return source.slice(source.indexOf('\n---\n') + 5);
}

describe('convertEntry', () => {
  it('puts okf_version first, keeps the frontmatter and body, appends the navigation', () => {
    expect(convertEntry(MAIN, OLD_INDEX)).toBe(
      '---\nokf_version: "0.2"\ntype: Knowledge Base\nname: demo\ntitle: Demo\ndescription: A demo.\ntags: [demo]\n---\n\n# Demo\n\nSee [one](/concepts/one.md).\n\n## Concepts\n\n* [One](/concepts/one.md) - First.\n\n## Design\n\nProse.\n',
    );
  });

  it('adds okf_version when there is no old index and keeps the body when nothing is left to merge', () => {
    expect(convertEntry(MAIN, null)).toBe(
      MAIN.replace('---\ntype:', '---\nokf_version: "0.2"\ntype:'),
    );
    expect(
      convertEntry(MAIN, '---\nokf_version: "0.2"\n---\n# Demo\n\n## Entry\n\n* [d](/main.md)\n'),
    ).toBe(convertEntry(MAIN, null));
  });

  it('refuses an old index.md that already carries entry keys, and a main.md without frontmatter', () => {
    expect(() => convertEntry(MAIN, MAIN)).toThrow(/already has entry frontmatter/);
    expect(() => convertEntry('# no fm\n', null)).toThrow(/no frontmatter/);
  });
});

describe('rewriteMainLinks', () => {
  it('rewrites every form that resolves to the bundle-root main.md, fragments kept', () => {
    const src =
      '[a](/main.md) [b](./main.md#x) [c](main.md) [d](<main.md?raw=1>) ![i](/main.md)\n\n[ref]: /main.md "t"\n';
    const out = rewriteMainLinks(src, 'index.md');
    expect(out.count).toBe(6);
    expect(out.text).toBe(
      '[a](/index.md) [b](./index.md#x) [c](index.md) [d](<index.md?raw=1>) ![i](/index.md)\n\n[ref]: /index.md "t"\n',
    );
  });

  it('resolves relative to the file (only the bundle-root main.md is rewritten, not a nested one); code is left alone', () => {
    expect(rewriteMainLinks('[u](../main.md) [v](../../main.md)', 'concepts/deep/x.md')).toEqual({
      text: '[u](../main.md) [v](../../index.md)',
      count: 1,
    });
    expect(rewriteMainLinks('[w](../main.md)', 'concepts/x.md').text).toBe('[w](../index.md)');
    expect(rewriteMainLinks('[n](main.md) [m](/concepts/main.md)', 'concepts/x.md').count).toBe(0);
    expect(rewriteMainLinks('`[c](/main.md)`\n\n```\n[d](/main.md)\n```\n', 'x.md').count).toBe(0);
  });
});

describe('migrateDataDir', () => {
  it('merges main.md into index.md, rewrites links bundle-wide, deletes main.md and passes check:okf', async () => {
    const dir = tmp.make(legacyTree());
    const report = await migrateDataDir(dir);
    expect(report).toMatchObject({ dryRun: false, migrated: 2, skipped: 0, failed: 0 });
    expect(report.bundles.map((b) => [b.dataset, b.slug, b.status])).toEqual([
      ['kb', 'demo', 'migrated'],
      ['task', 'plain', 'migrated'],
    ]);
    expect(report.bundles[0]?.navigationMerged).toBe(true);
    expect(report.bundles[1]?.navigationMerged).toBe(false);

    expect(existsSync(path.join(dir, 'kb', 'demo', 'main.md'))).toBe(false);
    expect(read(dir, 'kb/demo/index.md')).toBe(convertEntry(MAIN, OLD_INDEX));
    expect(read(dir, 'kb/demo/concepts/one.md')).toBe(
      '---\ntype: Concept\n---\n\nBack to [main](../index.md#demo), [again](./main.md) and `[code](/main.md)`.\n\n[ref]: /index.md\n',
    );
    expect(read(dir, 'kb/demo/concepts/deep/two.md')).toContain(
      '[up](../../index.md) [own](main.md)',
    );
    expect(read(dir, 'kb/demo/log.md')).toContain('Created [Demo](/index.md).');
    expect(report.rewrites).toBe(4);

    const { findings } = await checkOkf(dir);
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('is idempotent and a dry run changes nothing', async () => {
    const dir = tmp.make(legacyTree());
    const dry = await migrateDataDir(dir, { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, migrated: 2 });
    expect(dry.bundles.every((b) => b.status === 'would-migrate')).toBe(true);
    expect(read(dir, 'kb/demo/main.md')).toBe(MAIN);
    expect(read(dir, 'kb/demo/index.md')).toBe(OLD_INDEX);

    await migrateDataDir(dir);
    const again = await migrateDataDir(dir);
    expect(again).toMatchObject({ migrated: 0, skipped: 2, failed: 0, rewrites: 0 });
  });

  it('reports a bundle whose index.md already is an entry as failed and leaves it untouched', async () => {
    const dir = tmp.make({ 'kb/both/main.md': MAIN, 'kb/both/index.md': MAIN });
    const report = await migrateDataDir(dir);
    expect(report).toMatchObject({ migrated: 0, failed: 1 });
    expect(report.bundles[0]?.error).toMatch(/already has entry frontmatter/);
    expect(read(dir, 'kb/both/main.md')).toBe(MAIN);
  });

  it('treats a missing data dir as empty', async () => {
    expect(await migrateDataDir('/definitely/not/here')).toMatchObject({
      bundles: [],
      migrated: 0,
    });
  });
});
