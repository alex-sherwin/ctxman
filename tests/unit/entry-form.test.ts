// PURE rules of the NewEntryForm (src/lib/forms/entry-form.ts, ROUND3_SPEC §E.7).
import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX,
  FORM_ERROR_KEY,
  TITLE_MAX,
  blankDraft,
  buildBody,
  failureErrors,
  failureMessage,
  isNewEntryDataset,
  validateDraft,
} from '../../src/lib/forms/entry-form.ts';
import type { NewEntryDraft } from '../../src/lib/forms/entry-form.ts';

const draft = (patch: Partial<NewEntryDraft> = {}): NewEntryDraft => ({
  ...blankDraft('task', null),
  name: 'fix-login',
  description: 'Fix it',
  ...patch,
});
const none = { existing: new Set<string>(), projects: null };

describe('isNewEntryDataset', () => {
  it('is true for the okf datasets and skill only', () => {
    for (const id of ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project', 'skill']) {
      expect(isNewEntryDataset(id)).toBe(true);
    }
    for (const id of ['reference', 'context', 'recipe', 'nope', '', undefined, 3]) {
      expect(isNewEntryDataset(id)).toBe(false);
    }
  });
});

describe('blankDraft', () => {
  it('starts lifecycle datasets in their first state and prefills the parent', () => {
    expect(blankDraft('task', 'ctxman-v1')).toEqual({
      name: '',
      title: '',
      description: '',
      state: 'pending',
      tags: [],
      parent: 'ctxman-v1',
    });
    expect(blankDraft('bug', null).state).toBe('pending');
  });

  it('has no state for kb, rca and skill', () => {
    for (const ds of ['kb', 'rca', 'skill'] as const) expect(blankDraft(ds, null).state).toBe('');
  });
});

describe('validateDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateDraft('task', draft(), none)).toEqual({});
  });

  it('requires a name and a description', () => {
    expect(validateDraft('task', draft({ name: '', description: '  ' }), none)).toEqual({
      name: 'Required',
      description: 'Required',
    });
  });

  it('checks the name pattern and uniqueness with the dataset noun', () => {
    expect(validateDraft('task', draft({ name: 'Bad Name' }), none).name).toContain('lowercase');
    expect(
      validateDraft('task', draft(), { existing: new Set(['fix-login']), projects: null }).name,
    ).toBe('A task with this name already exists');
    expect(
      validateDraft('kb', draft(), { existing: new Set(['fix-login']), projects: null }).name,
    ).toBe('A kb entry with this name already exists');
  });

  it('limits title and description', () => {
    const errors = validateDraft(
      'task',
      draft({ title: 'x'.repeat(TITLE_MAX + 1), description: 'y'.repeat(DESCRIPTION_MAX + 1) }),
      none,
    );
    expect(errors.title).toBe(`${TITLE_MAX} characters max`);
    expect(errors.description).toBe(`${DESCRIPTION_MAX} characters max`);
  });

  it('judges the parent only once the project list is known', () => {
    expect(validateDraft('task', draft({ parent: 'gone' }), none)).toEqual({});
    const known = { existing: new Set<string>(), projects: new Set(['ctxman-v1']) };
    expect(validateDraft('task', draft({ parent: 'ctxman-v1' }), known)).toEqual({});
    expect(validateDraft('task', draft({ parent: 'gone' }), known).parent).toBe(
      'Project "gone" does not exist',
    );
  });
});

describe('buildBody', () => {
  it('sends name and trimmed description, plus what is set', () => {
    expect(
      buildBody(
        'task',
        draft({
          description: '  Fix it  ',
          title: ' Fix login ',
          state: 'in-progress',
          tags: ['auth', 'ui'],
          parent: 'ctxman-v1',
        }),
      ),
    ).toEqual({
      name: 'fix-login',
      description: 'Fix it',
      title: 'Fix login',
      state: 'in-progress',
      tags: ['auth', 'ui'],
      parent: 'ctxman-v1',
    });
  });

  it('omits a blank title, empty tags and no parent', () => {
    expect(buildBody('task', draft())).toEqual({
      name: 'fix-login',
      description: 'Fix it',
      state: 'pending',
    });
  });

  it('kb has no state; skill has no title, tags or state', () => {
    expect(buildBody('kb', { ...draft(), state: '' })).toEqual({
      name: 'fix-login',
      description: 'Fix it',
    });
    expect(
      buildBody('skill', { ...draft({ title: 'T', tags: ['a'], parent: 'p' }), state: '' }),
    ).toEqual({ name: 'fix-login', description: 'Fix it', parent: 'p' });
  });
});

describe('failureErrors / failureMessage', () => {
  it('maps a 409 to the name', () => {
    const res = { status: 409, message: 'task "x" already exists' };
    const errors = failureErrors(res, 'task');
    expect(errors).toEqual({ name: 'A task with this name already exists' });
    expect(failureMessage(res, errors)).toBe('A task with this name already exists');
  });

  it('maps 400 issues by their first path segment, first one wins', () => {
    const res = {
      status: 400,
      message: 'request body is invalid',
      issues: [
        { path: 'description', message: 'is required' },
        { path: 'tags.1', message: 'bad tag' },
        { path: 'tags.2', message: 'another' },
        { path: 'parent', message: 'project "x" does not exist' },
      ],
    };
    const errors = failureErrors(res, 'task');
    expect(errors).toEqual({
      description: 'is required',
      tags: 'bad tag',
      parent: 'project "x" does not exist',
    });
    expect(failureMessage(res, errors)).toBe('Fix the highlighted fields');
  });

  it('a root issue is a form-level error and becomes the status text', () => {
    const res = { status: 400, message: 'm', issues: [{ path: '', message: 'must be an object' }] };
    const errors = failureErrors(res, 'task');
    expect(errors).toEqual({ [FORM_ERROR_KEY]: 'must be an object' });
    expect(failureMessage(res, errors)).toBe('must be an object');
  });

  it('network and server failures show the response message', () => {
    expect(failureMessage({ status: 0, message: 'offline' }, {})).toBe('offline');
    expect(failureMessage({ status: 500, message: 'boom', issues: [] }, {})).toBe('boom');
  });
});
