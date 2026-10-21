import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  buildContextLinks,
  conceptBody,
  conceptTitleFromPath,
  DEFAULT_CONCEPT_TYPE,
  dialogFor,
  draftFromFrontmatter,
  draftProblems,
  daysFromToday,
  frontmatterPatch,
  isEntryAction,
  isRealYmd,
  issuesToFields,
  newFilePath,
  newFilePathProblem,
  resolvedProblem,
  splitKey,
  staleAfterProblem,
} from '../../src/ui/entry/entry-helpers.ts';
import type { FrontmatterDraft } from '../../src/ui/entry/entry-helpers.ts';

const base = (over: Partial<FrontmatterDraft> = {}): FrontmatterDraft => ({
  title: 'Fix login',
  description: 'Fix the login flow.',
  tags: ['auth', 'ui'],
  state: 'pending',
  time: ['PT1H'],
  resolved: '',
  staleAfter: '2027-01-01',
  status: 'draft',
  ...over,
});

describe('dates', () => {
  it('isRealYmd accepts real calendar days only', () => {
    expect(isRealYmd('2027-01-31')).toBe(true);
    expect(isRealYmd('2028-02-29')).toBe(true);
    expect(isRealYmd('2027-02-29')).toBe(false);
    expect(isRealYmd('2027-13-01')).toBe(false);
    expect(isRealYmd('2027-1-1')).toBe(false);
    expect(isRealYmd('tomorrow')).toBe(false);
    expect(isRealYmd('')).toBe(false);
  });

  it('addDaysYmd rolls over months, years and leap days', () => {
    expect(addDaysYmd('2026-10-18', 30)).toBe('2026-11-17');
    expect(addDaysYmd('2026-12-15', 30)).toBe('2027-01-14');
    expect(addDaysYmd('2028-02-01', 29)).toBe('2028-03-01');
    expect(addDaysYmd('2026-10-18', 0)).toBe('2026-10-18');
    expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('daysFromToday adds to the local calendar day', () => {
    const now = new Date(2026, 9, 18, 15, 30).getTime(); // local 2026-10-18
    expect(daysFromToday(now, 30)).toBe('2026-11-17');
    expect(daysFromToday(now, 90)).toBe('2027-01-16');
  });

  it('staleAfterProblem: empty is fine, a non-date is not', () => {
    expect(staleAfterProblem('')).toBeNull();
    expect(staleAfterProblem('  ')).toBeNull();
    expect(staleAfterProblem('2027-01-01')).toBeNull();
    expect(staleAfterProblem('2027-02-30')).toMatch(/YYYY-MM-DD/);
    expect(staleAfterProblem('soon')).toMatch(/YYYY-MM-DD/);
  });

  it('resolvedProblem: empty is fine, so is any ISO 8601 date or date-time; anything else is not', () => {
    expect(resolvedProblem('')).toBeNull();
    expect(resolvedProblem(' 2026-10-19 ')).toBeNull();
    expect(resolvedProblem('2026-10-19T14:30+02:00')).toBeNull();
    expect(resolvedProblem('2026-02-30')).toMatch(/ISO 8601/);
    expect(resolvedProblem('last week')).toMatch(/ISO 8601/);
  });
});

describe('draftFromFrontmatter', () => {
  it('reads the editable keys and tolerates missing / wrong types', () => {
    expect(
      draftFromFrontmatter({
        title: 'T',
        description: 'D',
        tags: ['a', 3, 'b'],
        state: 'pending',
        time: ['PT1H', 2, 'PT30M'],
        resolved: '2026-10-19T14:30',
        stale_after: '2027-01-01',
        status: 'stable',
      }),
    ).toEqual({
      title: 'T',
      description: 'D',
      tags: ['a', 'b'],
      state: 'pending',
      time: ['PT1H', 'PT30M'],
      resolved: '2026-10-19T14:30',
      staleAfter: '2027-01-01',
      status: 'stable',
    });
    expect(draftFromFrontmatter({ tags: 'x', title: 4, time: 'PT1H' })).toEqual({
      title: '',
      description: '',
      tags: [],
      state: '',
      time: [],
      resolved: '',
      staleAfter: '',
      status: '',
    });
  });
});

describe('frontmatterPatch', () => {
  it('is empty when nothing changed', () => {
    expect(frontmatterPatch('okf', true, base(), base())).toEqual({});
  });

  it('sends only the changed keys, trimmed', () => {
    const patch = frontmatterPatch(
      'okf',
      true,
      base(),
      base({ title: '  New title ', staleAfter: '2027-06-01' }),
    );
    expect(patch).toEqual({ title: 'New title', stale_after: '2027-06-01' });
  });

  it('an emptied title / stale_after / status is null (delete the key)', () => {
    const patch = frontmatterPatch(
      'okf',
      true,
      base(),
      base({ title: '', staleAfter: '', status: '' }),
    );
    expect(patch).toEqual({ title: null, stale_after: null, status: null });
  });

  it('tags: order matters, an unchanged list is not sent', () => {
    expect(frontmatterPatch('okf', true, base(), base({ tags: ['auth', 'ui'] }))).toEqual({});
    expect(frontmatterPatch('okf', true, base(), base({ tags: ['ui', 'auth'] }))).toEqual({
      tags: ['ui', 'auth'],
    });
    expect(frontmatterPatch('okf', true, base(), base({ tags: [] }))).toEqual({ tags: [] });
  });

  it('state only for lifecycle datasets and never emptied', () => {
    expect(frontmatterPatch('okf', true, base(), base({ state: 'complete' }))).toEqual({
      state: 'complete',
    });
    expect(frontmatterPatch('okf', false, base(), base({ state: 'complete' }))).toEqual({});
    expect(frontmatterPatch('okf', true, base(), base({ state: '' }))).toEqual({});
  });

  it('time: a changed list is sent whole (repeats kept), an emptied one is null', () => {
    expect(frontmatterPatch('okf', true, base(), base({ time: ['PT1H'] }))).toEqual({});
    expect(frontmatterPatch('okf', true, base(), base({ time: ['PT1H', 'PT1H'] }))).toEqual({
      time: ['PT1H', 'PT1H'],
    });
    expect(frontmatterPatch('okf', true, base(), base({ time: [] }))).toEqual({ time: null });
  });

  it('resolved: trimmed when set, null when emptied', () => {
    expect(frontmatterPatch('okf', true, base(), base({ resolved: ' 2026-10-19 ' }))).toEqual({
      resolved: '2026-10-19',
    });
    expect(
      frontmatterPatch('okf', true, base({ resolved: '2026-10-19' }), base({ resolved: '' })),
    ).toEqual({ resolved: null });
  });

  it('status maps to a known value', () => {
    expect(frontmatterPatch('okf', true, base(), base({ status: 'deprecated' }))).toEqual({
      status: 'deprecated',
    });
  });

  it('a skill edits its description only', () => {
    expect(
      frontmatterPatch(
        'skill',
        false,
        base(),
        base({ description: ' New. ', title: 'x', tags: [] }),
      ),
    ).toEqual({ description: 'New.' });
  });
});

describe('draftProblems', () => {
  it('flags a blank description and a bad date', () => {
    expect(
      draftProblems(
        'okf',
        base({ description: '  ', staleAfter: '2027-02-30', resolved: 'yesterday' }),
      ),
    ).toEqual({
      description: 'Required',
      resolved: 'Use an ISO 8601 date or date-time, e.g. 2026-10-19 or 2026-10-19T14:30',
      stale_after: 'Use a real date as YYYY-MM-DD',
    });
    expect(draftProblems('okf', base())).toEqual({});
  });

  it('limits the lengths; a skill ignores okf-only fields', () => {
    expect(draftProblems('okf', base({ title: 'x'.repeat(201) })).title).toMatch(/200/);
    expect(draftProblems('okf', base({ description: 'x'.repeat(1025) })).description).toMatch(
      /1024/,
    );
    expect(draftProblems('skill', base({ staleAfter: 'bad', title: 'x'.repeat(300) }))).toEqual({});
  });
});

describe('issuesToFields', () => {
  it('maps body-key paths (also indexed ones) onto fields and keeps the rest', () => {
    const { fields, other } = issuesToFields([
      { path: 'stale_after', message: 'must be a real date in YYYY-MM-DD form' },
      { path: 'tags.2', message: '"X" is not a valid tag' },
      { path: 'tags.3', message: '"Y" is not a valid tag' },
      { path: 'time.1', message: '"1h" is not an ISO 8601 duration' },
      { path: 'links.0.slug', message: 'bad' },
      { path: '', message: 'body must be a JSON object' },
    ]);
    expect(fields.stale_after).toBe('must be a real date in YYYY-MM-DD form');
    expect(fields.tags).toBe('"X" is not a valid tag; "Y" is not a valid tag');
    expect(fields.time).toBe('"1h" is not an ISO 8601 duration');
    expect(other).toEqual(['links.0.slug: bad', 'body must be a JSON object']);
  });
});

describe('keys and context links', () => {
  it('splitKey validates dataset and name', () => {
    expect(splitKey('task/fix-login')).toEqual({ dataset: 'task', slug: 'fix-login' });
    expect(splitKey('skill/a-b')).toEqual({ dataset: 'skill', slug: 'a-b' });
    expect(splitKey('context/x')).toBeNull();
    expect(splitKey('task/Bad Name')).toBeNull();
    expect(splitKey('task')).toBeNull();
    expect(splitKey('')).toBeNull();
  });

  it('buildContextLinks puts the project first, keeps order, drops duplicates and invalid keys', () => {
    const links = buildContextLinks({ dataset: 'project', slug: 'p' }, [
      'task/a',
      'bug/b',
      'task/a',
      'project/p',
      'recipe/r',
      'nonsense',
      'kb/c',
    ]);
    expect(links).toEqual([
      { dataset: 'project', slug: 'p' },
      { dataset: 'task', slug: 'a' },
      { dataset: 'bug', slug: 'b' },
      { dataset: 'kb', slug: 'c' },
    ]);
  });
});

describe('add file', () => {
  it('newFilePath keeps folders, drops a leading / or ./ and adds .md when missing', () => {
    expect(newFilePath(' references/abc.md ')).toBe('references/abc.md');
    expect(newFilePath('references/abc')).toBe('references/abc.md');
    expect(newFilePath('/notes/x')).toBe('notes/x.md');
    expect(newFilePath('./a/b/c.MD')).toBe('a/b/c.md');
    expect(newFilePath('top')).toBe('top.md');
    expect(newFilePath('references/')).toBe('references/');
    expect(newFilePath('  ')).toBe('');
  });

  it('newFilePathProblem refuses empty, dot, unsafe and reserved names', () => {
    for (const ok of ['references/abc.md', 'a/b/c/d.md', 'My notes/Plan v2.md', 'x.md']) {
      expect(newFilePathProblem(ok), ok).toBeNull();
    }
    expect(newFilePathProblem('')).toBeNull();
    expect(newFilePathProblem('references/')).toMatch(/file name/);
    expect(newFilePathProblem('a//b.md')).toMatch(/empty/);
    expect(newFilePathProblem('../b.md')).toMatch(/\.\./);
    expect(newFilePathProblem('a/../b.md')).toMatch(/\.\./);
    expect(newFilePathProblem('.hidden/b.md')).toMatch(/dot/);
    expect(newFilePathProblem('a/b?.md')).toMatch(/not allowed/);
    expect(newFilePathProblem('a\\b.md')).toMatch(/not allowed/);
    expect(newFilePathProblem('a/\u0007.md')).toMatch(/control/);
    expect(newFilePathProblem(`${'a'.repeat(600)}.md`)).toMatch(/512/);
    expect(newFilePathProblem('index.md')).toMatch(/reserved/);
    expect(newFilePathProblem('concepts/index.md')).toMatch(/reserved/);
    expect(newFilePathProblem('a/log.md')).toMatch(/reserved/);
  });

  it('derives the default title from the file name', () => {
    expect(conceptTitleFromPath('concepts/my-topic.md')).toBe('My topic');
    expect(conceptTitleFromPath('references/abc.md')).toBe('Abc');
    expect(conceptTitleFromPath('guide.md')).toBe('Guide');
    expect(conceptTitleFromPath('a/b/c-d.md')).toBe('C d');
  });

  it('conceptBody leaves blank type / description out', () => {
    expect(conceptBody({ title: ' T ', type: ' ', description: '' })).toEqual({ title: 'T' });
    expect(conceptBody({ title: 'T', type: 'Guide', description: ' d ' })).toEqual({
      title: 'T',
      type: 'Guide',
      description: 'd',
    });
  });

  it('the Add file dialog starts with the type article (the server fallback of POST /api/doc too)', () => {
    expect(DEFAULT_CONCEPT_TYPE).toBe('article');
  });
});

describe('dialogFor', () => {
  it('maps every action to its dialog', () => {
    expect(dialogFor({ action: 'frontmatter' })).toEqual({ type: 'frontmatter' });
    expect(dialogFor({ action: 'add-relation' })).toEqual({ type: 'relation', mode: 'relation' });
    expect(dialogFor({ action: 'add-child' })).toEqual({ type: 'relation', mode: 'child' });
    expect(dialogFor({ action: 'add-to-context' })).toEqual({ type: 'add-to-context' });
    expect(dialogFor({ action: 'build-context' })).toEqual({ type: 'build-context' });
    expect(dialogFor({ action: 'add-file' })).toEqual({ type: 'add-file' });
    expect(dialogFor({ action: 'add-file', path: ' references/x.md ' })).toEqual({
      type: 'add-file',
      path: 'references/x.md',
    });
    expect(dialogFor({ action: 'add-file', path: ' ' })).toEqual({ type: 'add-file' });
    expect(dialogFor({ action: 'new-concept' })).toBeNull();
  });

  it('remove needs a valid key; the title falls back to the key; remove-child fixes rel', () => {
    expect(
      dialogFor({ action: 'remove-relation', key: 'task/a', rel: 'related', title: 'Task A' }),
    ).toEqual({
      type: 'remove',
      key: 'task/a',
      rel: 'related',
      title: 'Task A',
    });
    expect(dialogFor({ action: 'remove-child', key: 'task/a', rel: 'ignored' })).toEqual({
      type: 'remove',
      key: 'task/a',
      rel: 'child',
      title: 'task/a',
    });
    expect(dialogFor({ action: 'remove-relation', key: 'nope' })).toBeNull();
    expect(dialogFor({ action: 'remove-relation' })).toBeNull();
  });

  it('an unknown or missing action opens nothing', () => {
    expect(dialogFor({ action: 'explode' })).toBeNull();
    expect(dialogFor({ action: undefined })).toBeNull();
    expect(isEntryAction('frontmatter')).toBe(true);
    expect(isEntryAction('x')).toBe(false);
  });
});
