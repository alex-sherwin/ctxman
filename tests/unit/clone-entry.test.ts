// The PURE helpers of the Clone… dialog (src/ui/entry/clone-entry.ts) and the name / title suggestions it shares with
// the server (src/lib/names.ts): `<slug>-copy`, `-copy-2`…, the draft from the original's frontmatter, local checks,
// the POST body and the server issues on their fields.
import { describe, expect, it } from 'vitest';
import { cloneTitle, suggestCloneName } from '../../src/lib/names.ts';
import {
  canClone,
  cloneBody,
  cloneDraft,
  cloneIssuesToFields,
  cloneName,
  cloneProblems,
  cloneSource,
} from '../../src/ui/entry/clone-entry.ts';

describe('suggestCloneName', () => {
  it('suggests <slug>-copy, then -copy-2, -copy-3… while taken', () => {
    expect(suggestCloneName('fix-login', new Set())).toBe('fix-login-copy');
    expect(suggestCloneName('fix-login', new Set(['fix-login-copy']))).toBe('fix-login-copy-2');
    expect(suggestCloneName('fix-login', new Set(['fix-login-copy', 'fix-login-copy-2']))).toBe(
      'fix-login-copy-3',
    );
  });

  it('does not repeat a copy suffix: a clone of a clone is the next copy of the first', () => {
    const taken = new Set(['fix-login-copy', 'fix-login-copy-2']);
    expect(suggestCloneName('fix-login-copy', taken)).toBe('fix-login-copy-3');
    expect(suggestCloneName('fix-login-copy-2', taken)).toBe('fix-login-copy-3');
    expect(suggestCloneName('copy', new Set())).toBe('copy-copy');
  });

  it('stays within 64 characters and never ends the base in a hyphen', () => {
    const long = `${'a'.repeat(58)}-bcdef`; // 64 characters
    const name = suggestCloneName(long, new Set());
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toBe(`${'a'.repeat(58)}-copy`);
    const next = suggestCloneName(long, new Set([name]));
    expect(next.length).toBeLessThanOrEqual(64);
    expect(next.endsWith('-copy-2')).toBe(true);
    expect(next).not.toContain('--');
  });
});

describe('cloneTitle', () => {
  it('appends (copy) once', () => {
    expect(cloneTitle('Fix login')).toBe('Fix login (copy)');
    expect(cloneTitle('  Fix login ')).toBe('Fix login (copy)');
    expect(cloneTitle('Fix login (copy)')).toBe('Fix login (copy)');
    expect(cloneTitle('Fix login (copy 2)')).toBe('Fix login (copy 2)');
  });
});

describe('canClone', () => {
  it('okf entries in the detail header only', () => {
    expect(canClone({ dataset: 'task', context: 'detail' })).toBe(true);
    expect(canClone({ dataset: 'project', context: 'detail' })).toBe(true);
    expect(canClone({ dataset: 'task', context: 'row' })).toBe(false);
    for (const dataset of ['skill', 'reference', 'snippet', 'context', 'recipe']) {
      expect(canClone({ dataset, context: 'detail' }), dataset).toBe(false);
    }
  });
});

const FM = {
  okf_version: '0.2',
  type: 'Task',
  name: 'fix-login',
  title: 'Fix login',
  description: 'Make login work.',
  state: 'complete',
  issueKey: 'PROJ-1',
  tags: ['auth', 'web'],
  time: ['PT1H', 'PT30M'],
  resolved: '2026-10-19',
  links: [
    { dataset: 'kb', slug: 'auth', rel: 'related' },
    { dataset: 'feature', slug: 'sso' },
    { dataset: 'task', slug: 'sub', rel: 'child' },
  ],
};

describe('cloneDraft and cloneSource', () => {
  it('prefills "(copy)", the description and tags, the DEFAULT state, no issue key', () => {
    expect(cloneDraft('task', 'fix-login', FM)).toEqual({
      name: null,
      title: 'Fix login (copy)',
      description: 'Make login work.',
      state: 'pending',
      tags: ['auth', 'web'],
      issueKey: '',
      links: true,
      children: false,
      time: false,
    });
    expect(cloneDraft('kb', 'notes', { description: 'x' })).toMatchObject({
      title: 'Notes (copy)',
      state: '',
      tags: [],
    });
  });

  it('counts what the checkboxes copy', () => {
    expect(cloneSource(FM)).toEqual({
      relations: 2,
      children: 1,
      timeTotal: '1h 30m',
      resolved: '2026-10-19',
    });
    expect(cloneSource({})).toEqual({ relations: 0, children: 0, timeTotal: '', resolved: '' });
    expect(cloneSource({ time: ['P1M'] }).timeTotal).toBe('1 duration');
  });
});

describe('cloneName, cloneProblems', () => {
  const draft = cloneDraft('task', 'fix-login', FM);

  it('submits the suggestion until a name is typed', () => {
    expect(cloneName(draft, 'fix-login-copy')).toBe('fix-login-copy');
    expect(cloneName({ ...draft, name: 'mine' }, 'fix-login-copy')).toBe('mine');
    expect(cloneName({ ...draft, name: '' }, 'fix-login-copy')).toBe('');
  });

  it('checks the name (incl. taken ones), description, title and issue key', () => {
    const existing = new Set(['fix-login', 'taken']);
    expect(cloneProblems('task', 'fix-login-copy', draft, existing)).toEqual({});
    expect(cloneProblems('task', 'taken', draft, existing).name).toBe(
      'A task with this name already exists',
    );
    expect(cloneProblems('task', '', draft, existing).name).toBe('Required');
    expect(cloneProblems('task', 'Bad Name', draft, existing).name).toMatch(/lowercase/);
    expect(
      cloneProblems('task', 'ok', { ...draft, description: ' \n ' }, existing).description,
    ).toBe('Required');
    expect(cloneProblems('task', 'ok', { ...draft, title: 'x'.repeat(201) }, existing).title).toBe(
      '200 characters max',
    );
    expect(
      cloneProblems('task', 'ok', { ...draft, issueKey: 'two words' }, existing).issueKey,
    ).toMatch(/One word/);
  });
});

describe('cloneBody', () => {
  it('sends trimmed values, the state and time only where the dataset has them', () => {
    const draft = {
      ...cloneDraft('task', 'fix-login', FM),
      title: '  New  ',
      issueKey: ' PROJ-9 ',
      time: true,
    };
    expect(cloneBody('task', 'fix-login-copy', draft)).toEqual({
      name: 'fix-login-copy',
      title: 'New',
      description: 'Make login work.',
      state: 'pending',
      tags: ['auth', 'web'],
      issueKey: 'PROJ-9',
      links: true,
      children: false,
      time: true,
    });
    const kb = cloneBody('kb', 'notes-copy', {
      ...cloneDraft('kb', 'notes', { description: 'x' }),
      title: ' ',
    });
    // a blank title is sent as '' (the name in sentence case), no state, no time, no issue key
    expect(kb).toEqual({
      name: 'notes-copy',
      title: '',
      description: 'x',
      tags: [],
      links: true,
      children: false,
    });
  });
});

describe('cloneIssuesToFields', () => {
  it('puts body and frontmatter issues on fields, the rest in other', () => {
    expect(
      cloneIssuesToFields([
        { path: 'name', message: 'bad' },
        { path: 'tags.1', message: 'not a tag' },
        { path: 'tags.2', message: 'neither' },
        { path: 'links.0.slug', message: 'invalid' },
        { path: '', message: 'general' },
      ]),
    ).toEqual({
      fields: { name: 'bad', tags: 'not a tag; neither' },
      other: ['links.0.slug: invalid', 'general'],
    });
  });
});
