import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFsSources } from '../../src/lib/inflate/fs-sources.ts';
import { loadExpandInputs, lookupFrom } from '../../src/lib/inflate/pipeline.ts';
import { parseRecipe } from '../../src/lib/inflate/recipe.ts';
import { trackTemp, validDataTree } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const NOW = Date.parse('2026-10-17T12:00:00Z');

function fixture(extra: Record<string, string> = {}) {
  const dataDir = tmp.make({
    ...validDataTree(),
    'kb/old/index.md':
      '---\ntype: Knowledge Base\nname: old\ndescription: Old stuff.\nstale_after: 2020-01-01\n---\n',
    'kb/no-desc/index.md': '---\ntype: Knowledge Base\nname: no-desc\n---\n',
    'kb/bad-yaml/index.md': '---\ntype: [oops\n---\n',
    'kb/no-index/concepts/x.md': '# nothing\n',
    'skill/strict/SKILL.md': '---\nname: strict\ndescription: d\nextra: nope\n---\n',
    'reference/rs.yaml':
      'name: rs\ndescription: A remote skill.\ntags: [t]\ntype: remote-skill\nuri: https://h.test/s.tar.gz\nsubpath: pkg\nowner: not-me\n',
    'reference/broken.yaml': 'name: [oops\n',
    'reference/bad-schema.yaml':
      'name: bad-schema\ndescription: d\ntype: remote-repo\nuri: nope\nowner: me\n',
    'context/broken.yaml': 'name: [oops\n',
    'context/bad-schema.yaml': 'name: bad-schema\ndescription: d\nlinks: nope\n',
    ...extra,
  });
  return {
    dataDir,
    src: createFsSources({ dataDir, nowMs: NOW, homeDir: '/home/me', cwd: '/work' }),
  };
}

describe('readContext', () => {
  it('ready: the parsed context', async () => {
    const { src } = fixture();
    const found = await src.readContext('ctx');
    expect(found.status).toBe('ready');
    if (found.status === 'ready') {
      expect(found.context.name).toBe('ctx');
      expect(found.context.description).toBe('A context.');
      expect(found.context.links.map((l) => `${l.dataset}/${l.slug}`)).toEqual([
        'kb/demo',
        'task/do-it',
      ]);
      expect(found.context.links[0]?.notes).toBe('Read this.\n');
    }
  });

  it('missing: no file, or a slug that is not a valid name', async () => {
    const { src } = fixture();
    expect(await src.readContext('nope')).toEqual({ status: 'missing' });
    expect(await src.readContext('../ctx')).toEqual({ status: 'missing' });
    expect(await src.readContext('')).toEqual({ status: 'missing' });
  });

  it('invalid: bad YAML and schema errors carry a message with the issues', async () => {
    const { src } = fixture();
    const parse = await src.readContext('broken');
    expect(parse.status).toBe('invalid');
    expect(parse.status === 'invalid' && parse.message).toContain('context/broken.yaml');
    const schema = await src.readContext('bad-schema');
    expect(schema.status).toBe('invalid');
    expect(schema.status === 'invalid' && schema.message).toContain(
      'context/bad-schema.yaml does not match the context schema: links: ',
    );
  });
});

describe('readItem', () => {
  it('okf: ready with summary-derived meta', async () => {
    const { src } = fixture();
    const found = await src.readItem('kb', 'demo');
    expect(found).toEqual({
      status: 'ready',
      meta: {
        dataset: 'kb',
        slug: 'demo',
        title: 'Demo',
        description: 'A demo knowledge base entry.',
        tags: ['demo'],
        stale: false,
        staleAfter: '2099-01-01',
      },
    });
    const task = await src.readItem('task', 'do-it');
    expect(task.status === 'ready' && task.meta).toMatchObject({
      title: 'do-it',
      state: 'in-progress',
      stale: false,
    });
  });

  it('okf: staleness uses the injected clock', async () => {
    const { dataDir, src } = fixture();
    const old = await src.readItem('kb', 'old');
    expect(old.status === 'ready' && old.meta).toMatchObject({
      stale: true,
      staleAfter: '2020-01-01',
    });
    const demo = await src.readItem('kb', 'demo');
    expect(demo.status === 'ready' && demo.meta.stale).toBe(false);
    const future = createFsSources({ dataDir, nowMs: Date.parse('2100-01-01T00:00:00Z') });
    const stale = await future.readItem('kb', 'demo');
    expect(stale.status === 'ready' && stale.meta.stale).toBe(true);
  });

  it('okf: missing for an absent entry, an absent index.md and an invalid slug', async () => {
    const { src } = fixture();
    expect(await src.readItem('kb', 'gone')).toEqual({ status: 'missing' });
    expect(await src.readItem('kb', 'no-index')).toEqual({ status: 'missing' });
    expect(await src.readItem('kb', '../demo')).toEqual({ status: 'missing' });
    expect(await src.readItem('skill', 'gone')).toEqual({ status: 'missing' });
  });

  it('okf: invalid for broken frontmatter and schema errors', async () => {
    const { src } = fixture();
    const yaml = await src.readItem('kb', 'bad-yaml');
    expect(yaml.status).toBe('invalid');
    const schema = await src.readItem('kb', 'no-desc');
    expect(schema).toEqual({ status: 'invalid', message: 'description: Required' });
  });

  it('skill: ready, and strict keys are invalid', async () => {
    const { src } = fixture();
    const ok = await src.readItem('skill', 'my-skill');
    expect(ok.status === 'ready' && ok.meta).toMatchObject({
      dataset: 'skill',
      slug: 'my-skill',
      title: 'my-skill',
      description: 'A skill.',
    });
    const strict = await src.readItem('skill', 'strict');
    expect(strict.status).toBe('invalid');
    expect(strict.status === 'invalid' && strict.message).toContain('extra');
  });

  it('reference: meta plus the full reference data', async () => {
    const { src } = fixture();
    const found = await src.readItem('reference', 'rs');
    expect(found.status).toBe('ready');
    if (found.status === 'ready') {
      expect(found.meta).toMatchObject({
        dataset: 'reference',
        slug: 'rs',
        refType: 'remote-skill',
        uriKind: 'archive',
        tags: ['t'],
      });
      expect(found.meta.ref).toMatchObject({
        type: 'remote-skill',
        uri: 'https://h.test/s.tar.gz',
        subpath: 'pkg',
        owner: 'not-me',
      });
    }
    const local = await src.readItem('reference', 'repo');
    expect(local.status === 'ready' && local.meta.refType).toBe('local-repo');
  });

  it('reference: missing, invalid yaml and invalid schema', async () => {
    const { src } = fixture();
    expect(await src.readItem('reference', 'gone')).toEqual({ status: 'missing' });
    expect((await src.readItem('reference', 'broken')).status).toBe('invalid');
    const schema = await src.readItem('reference', 'bad-schema');
    expect(schema.status).toBe('invalid');
    expect(schema.status === 'invalid' && schema.message).toMatch(/^uri: /);
  });
});

describe('loadExpandInputs + lookupFrom', () => {
  it('reads every context and every reachable item once; unknown keys are missing', async () => {
    const { src } = fixture();
    const r = parseRecipe({
      name: 'r',
      description: 'd',
      contexts: ['ctx', 'nope'],
      items: [
        { dataset: 'skill', slug: 'my-skill' },
        { dataset: 'kb', slug: 'demo' },
      ],
    });
    if (!r.ok) throw new Error('invalid recipe');
    const inputs = await loadExpandInputs(r.recipe, src);
    expect([...inputs.contexts.keys()].sort()).toEqual(['ctx', 'nope']);
    expect([...inputs.items.keys()].sort()).toEqual(['kb/demo', 'skill/my-skill', 'task/do-it']);
    const lookup = lookupFrom(inputs);
    expect(lookup.context('nope').status).toBe('missing');
    expect(lookup.context('ctx').status).toBe('ready');
    expect(lookup.item('kb', 'demo').status).toBe('ready');
    expect(lookup.item('bug', 'not-loaded').status).toBe('missing');
    expect(lookup.context('never-asked').status).toBe('missing');
  });
});

describe('entryRef', () => {
  it('returns the entry file and a title for every dataset', async () => {
    const { dataDir, src } = fixture();
    expect(await src.entryRef('kb', 'demo')).toEqual({
      title: 'Demo',
      abs: path.join(dataDir, 'kb', 'demo', 'index.md'),
    });
    expect(await src.entryRef('task', 'do-it')).toEqual({
      title: 'do-it',
      abs: path.join(dataDir, 'task', 'do-it', 'index.md'),
    });
    expect(await src.entryRef('skill', 'my-skill')).toEqual({
      title: 'my-skill',
      abs: path.join(dataDir, 'skill', 'my-skill', 'SKILL.md'),
    });
    expect(await src.entryRef('reference', 'repo')).toEqual({
      title: 'repo',
      abs: path.join(dataDir, 'reference', 'repo.yaml'),
    });
    // context and recipe are not linkable: title = slug
    expect(await src.entryRef('context', 'ctx')).toEqual({
      title: 'ctx',
      abs: path.join(dataDir, 'context', 'ctx.yaml'),
    });
    expect(await src.entryRef('recipe', 'brief')).toEqual({
      title: 'brief',
      abs: path.join(dataDir, 'recipe', 'brief.yaml'),
    });
  });

  it('falls back to the slug as title when the entry is invalid; null when absent or unsafe', async () => {
    const { dataDir, src } = fixture();
    expect(await src.entryRef('kb', 'no-desc')).toEqual({
      title: 'no-desc',
      abs: path.join(dataDir, 'kb', 'no-desc', 'index.md'),
    });
    expect(await src.entryRef('kb', 'gone')).toBeNull();
    expect(await src.entryRef('kb', 'no-index')).toBeNull();
    expect(await src.entryRef('context', 'gone')).toBeNull();
    expect(await src.entryRef('kb', '../x')).toBeNull();
    expect(await src.entryRef('kb', 'Bad Slug')).toBeNull();
  });
});

describe('itemPaths / listFiles / readText', () => {
  it('itemPaths: bundle dir + index.md, skill dir + SKILL.md, yaml file for both', () => {
    const { dataDir, src } = fixture();
    expect(src.itemPaths('kb', 'demo')).toEqual({
      rootAbs: path.join(dataDir, 'kb', 'demo'),
      entryAbs: path.join(dataDir, 'kb', 'demo', 'index.md'),
    });
    expect(src.itemPaths('skill', 'my-skill')).toEqual({
      rootAbs: path.join(dataDir, 'skill', 'my-skill'),
      entryAbs: path.join(dataDir, 'skill', 'my-skill', 'SKILL.md'),
    });
    const ref = path.join(dataDir, 'reference', 'repo.yaml');
    expect(src.itemPaths('reference', 'repo')).toEqual({ rootAbs: ref, entryAbs: ref });
  });

  it('listFiles keeps the bundle tree order with absolute paths and kinds', async () => {
    const { dataDir, src } = fixture({ 'kb/demo/assets/pic.png': 'x' });
    const files = await src.listFiles('kb', 'demo');
    expect(files.map((f) => [f.rel, f.kind])).toEqual([
      ['index.md', 'markdown'],
      ['log.md', 'markdown'],
      ['assets/pic.png', 'binary'],
      ['concepts/one.md', 'markdown'],
    ]);
    expect(files[2]?.abs).toBe(path.join(dataDir, 'kb', 'demo', 'assets', 'pic.png'));
    expect(await src.listFiles('kb', 'gone')).toEqual([]);
    expect((await src.listFiles('skill', 'my-skill')).map((f) => f.rel)).toEqual([
      'SKILL.md',
      'references/checklist.md',
    ]);
  });

  it('readText returns text, null for missing and unsafe paths', async () => {
    const { src } = fixture();
    expect(await src.readText('kb', 'demo', 'concepts/one.md')).toContain('# One');
    expect(await src.readText('kb', 'demo', 'nope.md')).toBeNull();
    expect(await src.readText('kb', 'demo', '../../task/do-it/index.md')).toBeNull();
    expect(await src.readText('kb', 'demo', '/etc/passwd')).toBeNull();
    expect(await src.readText('skill', 'my-skill', 'SKILL.md')).toContain('name: my-skill');
  });
});

describe('localPaths / statPath / listDir', () => {
  it('localPaths: ~, ~/x, ~\\x, absolute and relative paths, with an optional subpath', () => {
    const { src } = fixture();
    expect(src.localPaths('~')).toEqual({ root: '/home/me', target: '/home/me' });
    expect(src.localPaths('~/code/x')).toEqual({
      root: path.join('/home/me', 'code', 'x'),
      target: path.join('/home/me', 'code', 'x'),
    });
    expect(src.localPaths('~\\code')).toEqual({
      root: path.join('/home/me', 'code'),
      target: path.join('/home/me', 'code'),
    });
    expect(src.localPaths('/abs/repo', 'src/lib')).toEqual({
      root: path.resolve('/abs/repo'),
      target: path.join(path.resolve('/abs/repo'), 'src', 'lib'),
    });
    expect(src.localPaths('rel/repo').root).toBe(path.resolve('/work', 'rel/repo'));
    expect(src.localPaths('/r', '/a//b\\c/').target).toBe(
      path.join(path.resolve('/r'), 'a', 'b', 'c'),
    );
    expect(src.localPaths('/r', '  ').target).toBe(path.resolve('/r'));
    expect(src.localPaths('/r', '').target).toBe(path.resolve('/r'));
  });

  it('statPath: dir, file, null', async () => {
    const { dataDir, src } = fixture();
    expect(await src.statPath(dataDir)).toBe('dir');
    expect(await src.statPath(path.join(dataDir, 'kb', 'demo', 'index.md'))).toBe('file');
    expect(await src.statPath(path.join(dataDir, 'nope'))).toBeNull();
  });

  it('listDir: dirs first, then case-insensitive names; dot entries and node_modules skipped', async () => {
    const { src } = fixture();
    const dir = tmp.make({
      'b-file.txt': '',
      'A-file.txt': '',
      'Z-file.txt': '',
      'zdir/x.txt': '',
      'Adir/x.txt': '',
      'mdir/x.txt': '',
      '.git/config': '',
      '.env': '',
      'node_modules/pkg/index.js': '',
    });
    expect(await src.listDir(dir)).toEqual([
      { name: 'Adir', dir: true },
      { name: 'mdir', dir: true },
      { name: 'zdir', dir: true },
      { name: 'A-file.txt', dir: false },
      { name: 'b-file.txt', dir: false },
      { name: 'Z-file.txt', dir: false },
    ]);
  });

  it('listDir: null for a file or a missing path; empty directory -> []; symlinked dirs count as dirs', async () => {
    const { src } = fixture();
    const dir = tmp.make({ 'file.txt': 'x' });
    expect(await src.listDir(path.join(dir, 'file.txt'))).toBeNull();
    expect(await src.listDir(path.join(dir, 'missing'))).toBeNull();
    mkdirSync(path.join(dir, 'empty'));
    expect(await src.listDir(path.join(dir, 'empty'))).toEqual([]);
    mkdirSync(path.join(dir, 'real'));
    writeFileSync(path.join(dir, 'real', 'a.txt'), '');
    try {
      symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'), 'dir');
    } catch {
      return; // symlinks unavailable (e.g. Windows without privileges)
    }
    const listed = await src.listDir(dir);
    expect(listed?.find((e) => e.name === 'link')).toEqual({ name: 'link', dir: true });
  });
});
