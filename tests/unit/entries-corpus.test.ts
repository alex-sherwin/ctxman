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

  it('renders the entry and a concept body at request time', async () => {
    const detail = await getEntryDetail('kb', 'ctxman');
    expect(detail?.kind).toBe('okf');
    expect(detail?.kind === 'okf' ? detail.html : '').toContain('<h1');
    const doc = await getDocDetail('kb', 'ctxman', 'concepts/search');
    expect(doc?.html).toContain('<');
    expect(doc?.relPath).toBe('concepts/search.md');
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

  it('builds the search index from disk: entries, concepts, skills, references, contexts, recipes', async () => {
    const { docs } = await buildSearchIndex();
    expect(docs.length).toBeGreaterThan(40);
    const datasets = new Set(docs.map((d) => d.dataset));
    for (const ds of ['kb', 'task', 'skill', 'reference', 'context', 'recipe']) {
      expect(datasets.has(ds as never), ds).toBe(true);
    }
    // index.md and log.md never enter the corpus; main.md only as the entry itself
    expect(docs.some((d) => /\/(index|log)$/.test(d.id))).toBe(false);
    expect(docs.filter((d) => d.id === 'kb/ctxman')).toHaveLength(1);
  });
});
