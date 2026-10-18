import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  buildContextLinks,
  conceptBody,
  conceptPath,
  conceptTitleFromPath,
  dialogFor,
  draftFromFrontmatter,
  draftProblems,
  daysFromToday,
  frontmatterPatch,
  isEntryAction,
  isRealYmd,
  issuesToFields,
  splitKey,
  staleAfterProblem,
} from '../../src/ui/entry/entry-helpers.ts';
import type { FrontmatterDraft } from '../../src/ui/entry/entry-helpers.ts';

const base = (over: Partial<FrontmatterDraft> = {}): FrontmatterDraft => ({
  title: 'Fix login',
  description: 'Fix the login flow.',
  tags: ['auth', 'ui'],
  state: 'pending',
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
});

describe('draftFromFrontmatter', () => {
  it('reads the editable keys and tolerates missing / wrong types', () => {
    expect(
      draftFromFrontmatter({
        title: 'T',
        description: 'D',
        tags: ['a', 3, 'b'],
        state: 'pending',
        stale_after: '2027-01-01',
        status: 'stable',
      }),
    ).toEqual({
      title: 'T',
      description: 'D',
      tags: ['a', 'b'],
      state: 'pending',
      staleAfter: '2027-01-01',
      status: 'stable',
    });
    expect(draftFromFrontmatter({ tags: 'x', title: 4 })).toEqual({
      title: '',
      description: '',
      tags: [],
      state: '',
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
    expect(draftProblems('okf', base({ description: '  ', staleAfter: '2027-02-30' }))).toEqual({
      description: 'Required',
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
      { path: 'links.0.slug', message: 'bad' },
      { path: '', message: 'body must be a JSON object' },
    ]);
    expect(fields.stale_after).toBe('must be a real date in YYYY-MM-DD form');
    expect(fields.tags).toBe('"X" is not a valid tag; "Y" is not a valid tag');
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

describe('new concept', () => {
  it('builds the path and the default title from the file name', () => {
    expect(conceptPath('my-topic')).toBe('concepts/my-topic.md');
    expect(conceptTitleFromPath('concepts/my-topic.md')).toBe('My topic');
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
});

describe('dialogFor', () => {
  it('maps every action to its dialog', () => {
    expect(dialogFor({ action: 'frontmatter' })).toEqual({ type: 'frontmatter' });
    expect(dialogFor({ action: 'add-relation' })).toEqual({ type: 'relation', mode: 'relation' });
    expect(dialogFor({ action: 'add-child' })).toEqual({ type: 'relation', mode: 'child' });
    expect(dialogFor({ action: 'add-to-context' })).toEqual({ type: 'add-to-context' });
    expect(dialogFor({ action: 'build-context' })).toEqual({ type: 'build-context' });
    expect(dialogFor({ action: 'new-concept' })).toEqual({ type: 'new-concept' });
    expect(dialogFor({ action: 'new-concept', path: ' concepts/x.md ' })).toEqual({
      type: 'new-concept',
      path: 'concepts/x.md',
    });
    expect(dialogFor({ action: 'new-concept', path: ' ' })).toEqual({ type: 'new-concept' });
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
