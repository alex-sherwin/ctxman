import { describe, expect, it } from 'vitest';
import { contextSchema, recipeSchema, referenceSchema } from '../../src/datasets/schemas.ts';
import { validate } from '../../src/datasets/validate.ts';
import { describeIssue, issueMessage, issuePath } from '../../src/lib/findings.ts';
import { issuesOf } from './fixtures/validation.ts';

describe('issuePath', () => {
  it('joins with dots, empty for the root', () => {
    expect(issuePath([])).toBe('');
    expect(issuePath(['links', 0, 'slug'])).toBe('links.0.slug');
  });
});

describe('describeIssue / issueMessage (arktype wording -> friendly wording)', () => {
  it('a missing key is "Required"', () => {
    const issue = issuesOf(validate(contextSchema, { name: 'a' }))[0]!;
    expect(describeIssue(issue)).toBe('Required');
    expect(describeIssue(issue, { name: 'a' })).toBe('Required');
    expect(issueMessage(issue, { name: 'a' })).toBe('description: Required');
  });

  it('a key that is present but undefined counts as missing when the document is given', () => {
    const issue = {
      path: ['description'],
      message: 'description must be a string (was undefined)',
    };
    expect(describeIssue(issue, { description: undefined })).toBe('Required');
    expect(describeIssue(issue, { description: 5 })).toBe(
      issue.message.replace(/^description /, ''),
    );
  });

  it('an unparsable date says which formats work', () => {
    const issue = {
      path: ['stale_after'],
      message: 'stale_after must be a parsable date (was "nope")',
    };
    expect(describeIssue(issue)).toBe('Invalid date (use YYYY-MM-DD or an ISO 8601 timestamp)');
    expect(issueMessage(issue)).toBe(
      'stale_after: Invalid date (use YYYY-MM-DD or an ISO 8601 timestamp)',
    );
  });

  it('an undeclared key is "Unrecognized key" with the key from the path', () => {
    const issue = issuesOf(validate(contextSchema, { name: 'a', description: 'd', extra: 1 }))[0]!;
    expect(describeIssue(issue)).toBe('Unrecognized key "extra"');
    const nested = { path: ['output', 'oops'], message: 'output.oops must be removed' };
    expect(describeIssue(nested)).toBe('Unrecognized key "oops"');
  });

  it('drops the path arktype puts in front of its messages (dotted and bracket form)', () => {
    expect(describeIssue({ path: ['name'], message: 'name must be a string (was a number)' })).toBe(
      'must be a string (was a number)',
    );
    expect(
      describeIssue({
        path: ['links', 0, 'dataset'],
        message: 'links[0].dataset must be "kb" (was "x")',
      }),
    ).toBe('must be "kb" (was "x")');
    expect(
      describeIssue({ path: ['a', 'b'], message: 'a.b must be a string (was a number)' }),
    ).toBe('must be a string (was a number)');
    expect(describeIssue({ path: [], message: 'must be an object (was a string)' })).toBe(
      'must be an object (was a string)',
    );
    // a custom message without the path prefix stays as it is
    expect(describeIssue({ path: ['links', 1], message: 'duplicate link kb/x' })).toBe(
      'duplicate link kb/x',
    );
  });

  it('issueMessage never reads "name: name must be ..."', () => {
    const issue = issuesOf(validate(contextSchema, { name: 'Bad Name', description: 'd' }))[0]!;
    const message = issueMessage(issue);
    expect(message.startsWith('name: must be kebab-case')).toBe(true);
    expect(message).not.toContain('name: name');
    expect(message).not.toContain('must be must be');
  });

  it('a recipe default whose mode or material does not belong to the kind names the kind', () => {
    const doc = {
      name: 'r',
      description: 'd',
      defaults: { kb: { mode: 'install', material: 'clone' } },
    };
    const messages = issuesOf(validate(recipeSchema, doc))
      .map((i) => issueMessage(i, doc))
      .sort();
    expect(messages).toEqual([
      'defaults.kb.material: material "clone" does not apply to Knowledge Base items',
      'defaults.kb.mode: mode "install" does not apply to Knowledge Base items',
    ]);
  });

  it('a bad uri keeps its own explanation', () => {
    const doc = { name: 'r', description: 'd', type: 'remote-repo', uri: 'nope', owner: 'me' };
    const issue = issuesOf(validate(referenceSchema, doc))[0]!;
    expect(issueMessage(issue, doc)).toContain('uri: must be');
  });
});
