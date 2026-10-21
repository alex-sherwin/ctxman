import { describe, expect, it } from 'vitest';
import { summarize } from '../../src/lib/entry-summary.ts';
import type { ContextDoc } from '../../src/lib/entry-summary.ts';
import type { ContextInput } from '../../src/datasets/schemas.ts';
import { contextSchema, DATASET_SCHEMAS } from '../../src/datasets/schemas.ts';
import { assertValid, validate } from '../../src/datasets/validate.ts';

const MODIFIED = new Date('2026-10-15T08:30:00.000Z');
const NOW = new Date(2026, 9, 17, 12, 0).getTime(); // local noon, 2026-10-17

describe('summarize', () => {
  describe('okf entries', () => {
    const data = {
      type: 'Task',
      name: 'write-agents-md',
      title: 'Write AGENTS.md',
      description: 'Document the repo',
      tags: ['docs', 'agents'],
      state: 'in-progress',
      status: 'draft',
      stale_after: new Date('2027-04-01T00:00:00.000Z'),
      custom: 'ignored',
    };

    it('maps the shared fields', () => {
      expect(summarize('task', 'write-agents-md', data, MODIFIED, NOW)).toEqual({
        dataset: 'task',
        slug: 'write-agents-md',
        name: 'write-agents-md',
        title: 'Write AGENTS.md',
        description: 'Document the repo',
        tags: ['docs', 'agents'],
        state: 'in-progress',
        lastModified: '2026-10-15T08:30:00.000Z',
        staleAfter: '2027-04-01',
        stale: false,
        okfStatus: 'draft',
        url: '/task/write-agents-md',
      });
    });

    it('is stale on and after stale_after (today local >= stale_after)', () => {
      const stale = { ...data, stale_after: new Date('2026-10-17T00:00:00.000Z') };
      expect(summarize('task', 'x', stale, MODIFIED, NOW).stale).toBe(true);
      const before = { ...data, stale_after: '2026-10-18' };
      expect(summarize('task', 'x', before, MODIFIED, NOW)).toMatchObject({
        stale: false,
        staleAfter: '2026-10-18',
      });
      const old = { ...data, stale_after: '2026-01-01' };
      expect(summarize('task', 'x', old, MODIFIED, NOW)).toMatchObject({
        stale: true,
        staleAfter: '2026-01-01',
      });
    });

    it('omits staleAfter / okfStatus / title / state when absent or invalid', () => {
      const out = summarize('kb', 'plain', { name: 'plain', description: 'd' }, MODIFIED, NOW);
      expect(out).toEqual({
        dataset: 'kb',
        slug: 'plain',
        name: 'plain',
        description: 'd',
        tags: [],
        lastModified: '2026-10-15T08:30:00.000Z',
        stale: false,
        url: '/kb/plain',
      });
      expect(Object.keys(out)).not.toContain('staleAfter');
      expect(Object.keys(out)).not.toContain('okfStatus');
      const odd = summarize(
        'kb',
        'odd',
        { name: 'odd', title: '', status: 'published', stale_after: 42 },
        MODIFIED,
        NOW,
      );
      expect(odd.title).toBeUndefined();
      expect(odd.okfStatus).toBeUndefined();
      expect(odd.staleAfter).toBeUndefined();
      expect(odd.stale).toBe(false);
    });

    it.each(['stable', 'deprecated'] as const)('keeps okfStatus %s', (status) => {
      expect(summarize('kb', 'x', { status }, MODIFIED, NOW).okfStatus).toBe(status);
    });

    it('carries a valid issueKey of an okf entry only', () => {
      expect(summarize('task', 'x', { issueKey: 'PROJ-1' }, MODIFIED, NOW).issueKey).toBe('PROJ-1');
      expect(
        summarize('kb', 'x', { issueKey: 'two words' }, MODIFIED, NOW).issueKey,
      ).toBeUndefined();
      expect(summarize('kb', 'x', { issueKey: 7 }, MODIFIED, NOW).issueKey).toBeUndefined();
      expect(
        summarize('reference', 'x', { issueKey: 'PROJ-1' }, MODIFIED, NOW).issueKey,
      ).toBeUndefined();
    });

    it('only lifecycle datasets carry a state', () => {
      expect(summarize('kb', 'x', { state: 'pending' }, MODIFIED, NOW).state).toBeUndefined();
      expect(summarize('bug', 'x', { state: 'fixed' }, MODIFIED, NOW).state).toBe('fixed');
      expect(summarize('idea', 'x', {}, MODIFIED, NOW).state).toBeUndefined();
    });

    it('falls back to the slug when name is missing and ignores non-string tags', () => {
      const out = summarize('rca', 'the-slug', { tags: ['a', 3, null, 'b'] }, MODIFIED, NOW);
      expect(out.name).toBe('the-slug');
      expect(out.description).toBe('');
      expect(out.tags).toEqual(['a', 'b']);
    });
  });

  describe('relations (frontmatter links)', () => {
    const base = { name: 'ctxman-v1', description: 'Project' };

    it('is absent when the entry has no links (also an empty list or a non-list)', () => {
      expect(summarize('project', 'p', base, MODIFIED, NOW).relations).toBeUndefined();
      expect(summarize('project', 'p', { ...base, links: [] }, MODIFIED, NOW)).not.toHaveProperty(
        'relations',
      );
      expect(
        summarize('project', 'p', { ...base, links: 'nope' }, MODIFIED, NOW),
      ).not.toHaveProperty('relations');
      expect(summarize('project', 'p', { ...base, links: null }, MODIFIED, NOW)).not.toHaveProperty(
        'relations',
      );
    });

    it('lists the links in file order with rel filled in (default related)', () => {
      const out = summarize(
        'project',
        'p',
        {
          ...base,
          links: [
            { dataset: 'task', slug: 'a', rel: 'child' },
            { dataset: 'kb', slug: 'b' },
            { dataset: 'feature', slug: 'c', rel: 'depends-on' },
          ],
        },
        MODIFIED,
        NOW,
      );
      expect(out.relations).toEqual([
        { dataset: 'task', slug: 'a', rel: 'child' },
        { dataset: 'kb', slug: 'b', rel: 'related' },
        { dataset: 'feature', slug: 'c', rel: 'depends-on' },
      ]);
    });

    it('skips items that do not parse (bad dataset, rel, slug, extra key, non-object)', () => {
      const out = summarize(
        'project',
        'p',
        {
          ...base,
          links: [
            { dataset: 'context', slug: 'a', rel: 'child' },
            { dataset: 'task', slug: 'Bad Slug', rel: 'child' },
            { dataset: 'task', slug: 'x', rel: 'owns' },
            { dataset: 'task', slug: 'y', rel: 'child', notes: 'extra' },
            'task/z',
            null,
            { dataset: 'task', slug: 'ok', rel: 'child' },
          ],
        },
        MODIFIED,
        NOW,
      );
      expect(out.relations).toEqual([{ dataset: 'task', slug: 'ok', rel: 'child' }]);
    });

    it('is absent when every item is bad', () => {
      const out = summarize('task', 't', { ...base, links: [{ dataset: 'nope' }] }, MODIFIED, NOW);
      expect(out).not.toHaveProperty('relations');
    });

    it('is only read for okf datasets (a context links[] is not a relation list)', () => {
      const links = [{ dataset: 'kb', slug: 'ctxman' }];
      expect(summarize('skill', 's', { ...base, links }, MODIFIED, NOW)).not.toHaveProperty(
        'relations',
      );
      expect(
        summarize('context', 'c', { name: 'c', description: 'd', links }, MODIFIED, NOW),
      ).not.toHaveProperty('relations');
    });

    it('never sets invalid (the caller attaches the entry index issues)', () => {
      expect(
        summarize('task', 't', { name: 't', state: 'bogus' }, MODIFIED, NOW),
      ).not.toHaveProperty('invalid');
    });
  });

  describe('skill', () => {
    it('has no freshness-by-stale_after or lifecycle', () => {
      const out = summarize(
        'skill',
        'okf-authoring',
        { name: 'okf-authoring', description: 'How to author OKF', stale_after: '2020-01-01' },
        MODIFIED,
        NOW,
      );
      expect(out).toMatchObject({ dataset: 'skill', url: '/skill/okf-authoring', stale: false });
      expect(out.staleAfter).toBeUndefined();
      expect(out.state).toBeUndefined();
      expect(out.refType).toBeUndefined();
    });
  });

  describe('reference', () => {
    it('sets refType from data.type', () => {
      const out = summarize(
        'reference',
        'astro-docs',
        {
          name: 'astro-docs',
          description: 'Docs',
          type: 'remote-repo',
          owner: 'not-me',
          tags: ['docs'],
        },
        MODIFIED,
        NOW,
      );
      expect(out).toMatchObject({ dataset: 'reference', refType: 'remote-repo', tags: ['docs'] });
      expect(out.linkCount).toBeUndefined();
    });

    it('derives uriKind for remote-skill only', () => {
      const skill = (uri: string) =>
        summarize('reference', 'x', { type: 'remote-skill', uri }, MODIFIED, NOW).uriKind;
      expect(skill('https://h.test/a/b.tgz')).toBe('archive');
      expect(skill('https://github.com/o/r.git')).toBe('git');
      expect(skill('git@github.com:o/r.git')).toBe('git');
      expect(skill('nonsense')).toBeUndefined();
      const repo = summarize(
        'reference',
        'x',
        { type: 'remote-repo', uri: 'git@github.com:o/r.git' },
        MODIFIED,
        NOW,
      );
      expect(repo.uriKind).toBeUndefined();
    });

    it('ignores an invalid type', () => {
      expect(summarize('reference', 'x', { type: 'ftp' }, MODIFIED, NOW).refType).toBeUndefined();
    });

    it('sets owner for me / not-me and omits it when absent or invalid', () => {
      const owner = (data: Record<string, unknown>) =>
        summarize('reference', 'x', { type: 'local-repo', ...data }, MODIFIED, NOW).owner;
      expect(owner({ owner: 'me' })).toBe('me');
      expect(owner({ owner: 'not-me' })).toBe('not-me');
      expect(owner({})).toBeUndefined();
      expect(owner({ owner: 'someone' })).toBeUndefined();
      expect(owner({ owner: 3 })).toBeUndefined();
      expect('owner' in summarize('reference', 'x', {}, MODIFIED, NOW)).toBe(false);
    });

    it('sets subpath trimmed without outer slashes and omits it when empty or not a string', () => {
      const subpath = (data: Record<string, unknown>) =>
        summarize('reference', 'x', { type: 'remote-repo', ...data }, MODIFIED, NOW).subpath;
      expect(subpath({ subpath: 'docs/en' })).toBe('docs/en');
      expect(subpath({ subpath: ' /docs/en/ ' })).toBe('docs/en');
      expect(subpath({ subpath: '' })).toBeUndefined();
      expect(subpath({ subpath: '  / ' })).toBeUndefined();
      expect(subpath({ subpath: null })).toBeUndefined();
      expect(subpath({ subpath: 3 })).toBeUndefined();
      expect(subpath({})).toBeUndefined();
      expect('subpath' in summarize('reference', 'x', { subpath: '' }, MODIFIED, NOW)).toBe(false);
    });

    it('sets folder for repositories and folders only, when it is a valid folder name', () => {
      const folder = (data: Record<string, unknown>) =>
        summarize('reference', 'x', data, MODIFIED, NOW).folder;
      expect(folder({ type: 'local-repo', folder: 'x-main' })).toBe('x-main');
      expect(folder({ type: 'local-folder', folder: 'Notes' })).toBe('Notes');
      expect(folder({ type: 'remote-repo', folder: 'r.git' })).toBe('r.git');
      expect(folder({ type: 'remote-skill', folder: 'x' })).toBeUndefined();
      expect(folder({ type: 'local-repo', folder: '../x' })).toBeUndefined();
      expect(folder({ type: 'local-repo', folder: 3 })).toBeUndefined();
      expect(folder({ folder: 'x' })).toBeUndefined();
      expect(
        summarize('kb', 'x', { type: 'local-repo', folder: 'x' }, MODIFIED, NOW).folder,
      ).toBeUndefined();
    });

    it('subpath is reference-only', () => {
      for (const dataset of ['kb', 'skill', 'context', 'recipe'] as const) {
        expect(summarize(dataset, 'x', { subpath: 'a' }, MODIFIED, NOW).subpath).toBeUndefined();
      }
    });

    it('owner is reference-only', () => {
      for (const dataset of ['kb', 'skill', 'context', 'recipe'] as const) {
        expect(summarize(dataset, 'x', { owner: 'me' }, MODIFIED, NOW).owner).toBeUndefined();
      }
    });
  });

  describe('context', () => {
    it('sets linkCount from links', () => {
      const out = summarize(
        'context',
        'ctxman-dev',
        {
          name: 'ctxman-dev',
          description: 'Dev context',
          tags: [],
          links: [
            { dataset: 'kb', slug: 'a' },
            { dataset: 'task', slug: 'b', notes: 'n' },
          ],
        },
        MODIFIED,
        NOW,
      );
      expect(out).toMatchObject({ linkCount: 2, url: '/context/ctxman-dev' });
      expect(out.refType).toBeUndefined();
    });

    it('a context without links has linkCount 0', () => {
      expect(summarize('context', 'x', { name: 'x' }, MODIFIED, NOW).linkCount).toBe(0);
    });
  });

  describe('recipe', () => {
    it('sets recipeTarget, contextCount and itemCount', () => {
      const out = summarize(
        'recipe',
        'brief',
        {
          name: 'brief',
          description: 'A brief',
          tags: ['x'],
          target: 'codex',
          contexts: ['a', 'b'],
          items: [{ dataset: 'kb', slug: 'c' }],
        },
        MODIFIED,
        NOW,
      );
      expect(out).toMatchObject({
        recipeTarget: 'codex',
        contextCount: 2,
        itemCount: 1,
        url: '/recipe/brief',
        tags: ['x'],
      });
      expect(out.linkCount).toBeUndefined();
    });

    it('a recipe without arrays or with an unknown target degrades to zero counts', () => {
      const out = summarize('recipe', 'x', { name: 'x', target: 'vim' }, MODIFIED, NOW);
      expect(out.recipeTarget).toBeUndefined();
      expect(out.contextCount).toBe(0);
      expect(out.itemCount).toBe(0);
    });

    it('other datasets carry no recipe fields', () => {
      const out = summarize('context', 'x', { name: 'x' }, MODIFIED, NOW);
      expect(out.recipeTarget).toBeUndefined();
      expect(out.contextCount).toBeUndefined();
      expect(out.itemCount).toBeUndefined();
    });
  });

  describe('lastModified', () => {
    it('is the ISO string of the date', () => {
      expect(summarize('kb', 'x', {}, new Date(0), NOW).lastModified).toBe(
        '1970-01-01T00:00:00.000Z',
      );
    });

    it('survives an invalid Date by using the epoch', () => {
      expect(summarize('kb', 'x', {}, new Date('nope'), NOW).lastModified).toBe(
        '1970-01-01T00:00:00.000Z',
      );
    });
  });

  it('is JSON-serializable without undefined placeholders', () => {
    const out = summarize('kb', 'x', { name: 'x', description: 'd' }, MODIFIED, NOW);
    expect(Object.values(out).every((v) => v !== undefined)).toBe(true);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('summarizes parsed schema output (Date stale_after from the schema)', () => {
    const data = assertValid(DATASET_SCHEMAS.task, {
      type: 'Task',
      name: 'x',
      description: 'd',
      state: 'pending',
      stale_after: '2026-10-17',
    });
    expect(summarize('task', 'x', data, MODIFIED, NOW)).toMatchObject({
      stale: true,
      staleAfter: '2026-10-17',
    });
  });
});

describe('ContextDoc', () => {
  it('is assignable to the schema input and carries required links', () => {
    const doc: ContextDoc = {
      name: 'demo',
      description: 'd',
      links: [{ dataset: 'kb', slug: 'a', notes: 'n' }],
    };
    const input: ContextInput = doc;
    expect(validate(contextSchema, input).success).toBe(true);
    expect(doc.links).toHaveLength(1);
  });
});
