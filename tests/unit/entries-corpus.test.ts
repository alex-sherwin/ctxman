// entries.ts (no astro:*) against a COPY of the committed corpus tests/data (fixtures/corpus.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildSearchIndex,
  getDocDetail,
  getEntryDetail,
  listEntries,
} from '../../src/lib/entries.ts';
import { invalidateEntryIndex } from '../../src/lib/entry-index.ts';
import { cleanupCorpus, copyCorpus } from './fixtures/corpus.ts';
import { writeTree } from './fixtures/data-fixtures.ts';

let previous: string | undefined;
let dir: string;

beforeEach(() => {
  previous = process.env.CTXMAN_DATA_DIR;
  dir = copyCorpus();
  process.env.CTXMAN_DATA_DIR = dir;
  invalidateEntryIndex();
});

afterEach(() => {
  if (previous === undefined) delete process.env.CTXMAN_DATA_DIR;
  else process.env.CTXMAN_DATA_DIR = previous;
  invalidateEntryIndex();
  cleanupCorpus();
});

describe('entries.ts on the seed corpus', () => {
  it('lists references with their owner, read from disk', async () => {
    const refs = await listEntries('reference');
    expect(refs.length).toBeGreaterThan(5);
    expect(refs.every((r) => r.owner === 'me' || r.owner === 'not-me')).toBe(true);
    expect(refs.every((r) => r.invalid === undefined)).toBe(true);
  });

  it('flags an invalid reference file in the list and answers null for its detail', async () => {
    writeTree(dir, { 'reference/broken.yaml': 'name: broken\ndescription: d\ntype: nope\n' });
    const refs = await listEntries('reference');
    const broken = refs.find((r) => r.slug === 'broken');
    expect(broken?.invalid?.length).toBeGreaterThan(0);
    expect(await getEntryDetail('reference', 'broken')).toBeNull();
    expect(await getEntryDetail('reference', 'missing-one')).toBeNull();
    expect((await getEntryDetail('reference', 'ctxman-repo'))?.kind).toBe('reference');
  });

  it('renders a reference info as HTML (ctxman: links routed, missing ones flagged); none without info', async () => {
    writeTree(dir, {
      'reference/with-info.yaml': [
        'name: with-info',
        'description: d',
        'type: local-folder',
        'path: /tmp/x',
        'owner: me',
        'info: |',
        '  ## Layout',
        '',
        '  See [ctxman](ctxman:kb/ctxman) and [gone](ctxman:kb/gone).',
        '',
      ].join('\n'),
    });
    const detail = await getEntryDetail('reference', 'with-info');
    const html = detail?.kind === 'reference' ? (detail.infoHtml ?? '') : '';
    expect(html).toContain('Layout</h2>');
    expect(html).toContain('href="/kb/ctxman"');
    expect(html).toContain('cx-link--broken');
    const plain = await getEntryDetail('reference', 'ctxman-repo');
    expect(plain?.kind === 'reference' && plain.infoHtml).toBe(undefined);
  });

  it('lists snippets from disk (an invalid file flagged) and renders a snippet markdown as HTML', async () => {
    writeTree(dir, { 'snippet/broken.yaml': 'name: broken\ndescription: d\n' });
    const snippets = await listEntries('snippet');
    expect(snippets.map((s) => s.slug)).toEqual([
      'broken',
      'conventional-commits',
      'finish-checklist',
    ]);
    expect(snippets.find((s) => s.slug === 'broken')?.invalid?.length).toBeGreaterThan(0);
    expect(snippets.find((s) => s.slug === 'finish-checklist')?.tags).toEqual(['workflow']);
    expect(await getEntryDetail('snippet', 'broken')).toBeNull();
    expect(await getEntryDetail('snippet', 'missing-one')).toBeNull();

    const detail = await getEntryDetail('snippet', 'finish-checklist');
    expect(detail?.kind).toBe('snippet');
    if (detail?.kind !== 'snippet') return;
    expect(detail.data.markdown).toContain('## Before you finish');
    expect(detail.markdownHtml).toContain('Before you finish</h2>');
    expect(detail.markdownHtml).toContain('href="/kb/ctxman"');
    expect(detail.relations.linksTo).toEqual([]);
  });

  it('renders the entry and a concept body at request time', async () => {
    const detail = await getEntryDetail('kb', 'ctxman');
    expect(detail?.kind).toBe('okf');
    expect(detail?.kind === 'okf' ? detail.html : '').toContain('<h1');
    const doc = await getDocDetail('kb', 'ctxman', 'concepts/search');
    expect(doc?.html).toContain('<');
    expect(doc?.relPath).toBe('concepts/search.md');
  });

  it('carries the markdown body without frontmatter (the doc toolbar Copy in preview)', async () => {
    writeTree(dir, {
      'kb/ctxman/concepts/copy-me.md':
        '---\r\ntype: Concept\r\n---\r\n\r\n# Copy me\r\n\r\nText.\r\n',
    });
    const doc = await getDocDetail('kb', 'ctxman', 'concepts/copy-me');
    expect(doc?.body).toBe('\n# Copy me\n\nText.\n');
    const detail = await getEntryDetail('kb', 'ctxman');
    const body = detail?.kind === 'okf' ? detail.body : '';
    expect(body).toContain('# ctxman');
    expect(body).not.toContain('okf_version');
    const skill = await getEntryDetail('skill', 'ctxman-add-entry');
    expect(skill?.kind === 'skill' ? skill.body : '').not.toMatch(/^---/);
  });

  it('serves the entry index.md only as the entry page, a nested index.md as a doc', async () => {
    expect(await getDocDetail('kb', 'ctxman', 'index')).toBeNull();
    writeTree(dir, { 'kb/ctxman/concepts/nested/index.md': '# Nested nav\n' });
    expect((await getDocDetail('kb', 'ctxman', 'concepts/nested/index'))?.relPath).toBe(
      'concepts/nested/index.md',
    );
  });

  it('shows a new concept on the very next request (no content layer lag)', async () => {
    writeTree(dir, {
      'kb/ctxman/concepts/fresh-one.md':
        '---\ntype: Concept\n---\n\n# Fresh one\n\nHello **world**.\n',
    });
    const doc = await getDocDetail('kb', 'ctxman', 'concepts/fresh-one');
    expect(doc?.html).toContain('<strong>world</strong>');
    const index = await buildSearchIndex();
    expect(index.docs.some((d) => d.id === 'kb/ctxman/concepts/fresh-one')).toBe(true);
  });

  it('leaves index: false files out of the search index; on the entry, the whole bundle', async () => {
    writeTree(dir, {
      'kb/hidden-bundle/index.md':
        '---\nokf_version: "0.2"\ntype: Knowledge Base\nname: hidden-bundle\ndescription: Hidden.\nindex: false\n---\n# Hidden\n',
      'kb/hidden-bundle/concepts/a.md': '---\ntype: Concept\n---\n# A\n',
      'kb/ctxman/concepts/history.md': '---\ntype: Session log\nindex: false\n---\n# History\n',
      'kb/ctxman/concepts/kept.md': '---\ntype: Concept\nindex: true\n---\n# Kept\n',
      // only the boolean counts: a string is a schema issue, and the file stays indexed
      'kb/ctxman/concepts/quoted.md': '---\ntype: Concept\nindex: "false"\n---\n# Quoted\n',
      'kb/ctxman/concepts/no.md': '---\ntype: Concept\nindex: no\n---\n# No\n',
    });
    const ids = new Set((await buildSearchIndex()).docs.map((d) => d.id));
    expect(ids.has('kb/hidden-bundle')).toBe(false);
    expect(ids.has('kb/hidden-bundle/concepts/a')).toBe(false);
    expect(ids.has('kb/ctxman/concepts/history')).toBe(false);
    expect(ids.has('kb/ctxman')).toBe(true);
    expect(ids.has('kb/ctxman/concepts/kept')).toBe(true);
    expect(ids.has('kb/ctxman/concepts/quoted')).toBe(true);
    expect(ids.has('kb/ctxman/concepts/no')).toBe(true);
    // the rest of the app still sees them: lists and pages
    expect((await listEntries('kb')).some((e) => e.slug === 'hidden-bundle')).toBe(true);
    expect((await getDocDetail('kb', 'ctxman', 'concepts/history'))?.title).toBe('History');
  });

  it('builds the search index from disk: entries, concepts, skills, references, snippets, contexts, recipes', async () => {
    const { docs } = await buildSearchIndex();
    expect(docs.length).toBeGreaterThan(40);
    const datasets = new Set(docs.map((d) => d.dataset));
    for (const ds of ['kb', 'task', 'skill', 'reference', 'snippet', 'context', 'recipe']) {
      expect(datasets.has(ds as never), ds).toBe(true);
    }
    // index.md and log.md never enter the corpus; index.md only as the entry itself
    expect(docs.some((d) => /\/(index|log)$/.test(d.id))).toBe(false);
    expect(docs.filter((d) => d.id === 'kb/ctxman')).toHaveLength(1);
  });
});
