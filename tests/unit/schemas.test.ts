import { describe, expect, it } from 'vitest';
import { DATASET_IDS } from '../../src/datasets/registry.ts';
import type { DatasetId } from '../../src/datasets/registry.ts';
import {
  DATASET_SCHEMAS,
  CLONE_DIR_PATTERN,
  GIT_REF_PATTERN,
  OKF_STATUSES,
  recipeSchema,
  REMOTE_URI_HINT_PATTERN,
  YAML_DATASET_TYPES,
  contextLinkSchema,
  contextSchema,
  dateSchema,
  docSchema,
  entryLinkSchema,
  entryLinksSchema,
  nameSchema,
  okfConceptSchema,
  okfEventSchema,
  referenceSchema,
  kbSchema,
  skillSchema,
} from '../../src/datasets/schemas.ts';
import { isSafeGitRef, isSafeRelativeDir } from '../../src/lib/inflate/catalog.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { assertValid, validate } from '../../src/datasets/validate.ts';
import { dataOf, issuesOf } from './fixtures/validation.ts';

const okfBase = { type: 'Knowledge Base', name: 'demo', description: 'A demo entry' };

/** One minimal valid input per dataset. */
const MINIMAL: Record<DatasetId, Record<string, unknown>> = {
  kb: okfBase,
  rca: { ...okfBase, type: 'Root Cause Analysis' },
  idea: { ...okfBase, type: 'Idea', state: 'pending' },
  task: { ...okfBase, type: 'Task', state: 'pending' },
  bug: { ...okfBase, type: 'Bug', state: 'pending' },
  feature: { ...okfBase, type: 'Feature', state: 'pending' },
  project: { ...okfBase, type: 'Project', state: 'pending' },
  skill: { name: 'demo', description: 'A demo skill' },
  reference: {
    name: 'demo',
    description: 'A demo reference',
    type: 'remote-repo',
    uri: 'https://example.com/x.git',
    owner: 'me',
  },
  context: { name: 'demo', description: 'A demo context' },
  recipe: { name: 'x', description: 'd' },
};

describe('DATASET_SCHEMAS', () => {
  it('has a schema for every dataset', () => {
    expect(Object.keys(DATASET_SCHEMAS).sort()).toEqual([...DATASET_IDS].sort());
  });

  it.each([...DATASET_IDS])('%s accepts a minimal valid object', (id) => {
    const result = validate(DATASET_SCHEMAS[id], MINIMAL[id]);
    expect(result.success, JSON.stringify(issuesOf(result))).toBe(true);
  });

  it.each([...DATASET_IDS])('%s rejects a missing name and an invalid name', (id) => {
    const { name: _name, ...withoutName } = MINIMAL[id];
    expect(validate(DATASET_SCHEMAS[id], withoutName).success).toBe(false);
    expect(validate(DATASET_SCHEMAS[id], { ...MINIMAL[id], name: 'Not Kebab' }).success).toBe(
      false,
    );
  });

  it.each([...DATASET_IDS])('%s rejects a blank description', (id) => {
    expect(validate(DATASET_SCHEMAS[id], { ...MINIMAL[id], description: '   ' }).success).toBe(
      false,
    );
  });

  it('defaults tags to [] (okf, reference, context, recipe)', () => {
    for (const id of ['kb', 'idea', 'reference', 'context', 'recipe'] as const) {
      const parsed = assertValid(DATASET_SCHEMAS[id], MINIMAL[id]) as { tags: string[] };
      expect(parsed.tags, id).toEqual([]);
    }
  });
});

describe('name', () => {
  it('accepts kebab-case and rejects everything else', () => {
    for (const ok of ['a', 'a-b', 'a1-b2', 'x'.repeat(64)]) {
      expect(validate(nameSchema, ok).success, ok).toBe(true);
    }
    for (const bad of ['', 'A', '-a', 'a-', 'a--b', 'a_b', 'a b', 'x'.repeat(65)]) {
      expect(validate(nameSchema, bad).success, bad).toBe(false);
    }
  });
});

describe('okf entries (kb, rca, idea, task, bug, feature, project)', () => {
  it('requires type', () => {
    const { type: _type, ...rest } = okfBase;
    expect(validate(DATASET_SCHEMAS.kb, rest).success).toBe(false);
    expect(validate(DATASET_SCHEMAS.kb, { ...okfBase, type: '  ' }).success).toBe(false);
  });

  it('preserves unknown keys', () => {
    const parsed = assertValid(DATASET_SCHEMAS.kb, { ...okfBase, custom_key: { nested: [1, 2] } });
    expect(parsed).toMatchObject({ custom_key: { nested: [1, 2] } });
  });

  it.each(['idea', 'task', 'bug', 'feature', 'project'] as const)(
    '%s requires a valid lifecycle state',
    (id) => {
      const schema = DATASET_SCHEMAS[id];
      expect(validate(schema, { ...MINIMAL[id], state: 'done' }).success).toBe(false);
      expect(validate(schema, { ...MINIMAL[id], state: 'in progress' }).success).toBe(false);
      const { state: _state, ...withoutState } = MINIMAL[id];
      expect(validate(schema, withoutState).success).toBe(false);
      expect(validate(schema, { ...MINIMAL[id], state: 'in-progress' }).success).toBe(true);
    },
  );

  it('uses a different state set per dataset', () => {
    expect(validate(DATASET_SCHEMAS.idea, { ...MINIMAL.idea, state: 'abandoned' }).success).toBe(
      true,
    );
    expect(validate(DATASET_SCHEMAS.idea, { ...MINIMAL.idea, state: 'fixed' }).success).toBe(false);
    expect(validate(DATASET_SCHEMAS.bug, { ...MINIMAL.bug, state: 'fixed' }).success).toBe(true);
    expect(validate(DATASET_SCHEMAS.bug, { ...MINIMAL.bug, state: 'wont-fix' }).success).toBe(true);
    expect(validate(DATASET_SCHEMAS.bug, { ...MINIMAL.bug, state: 'complete' }).success).toBe(
      false,
    );
    expect(validate(DATASET_SCHEMAS.task, { ...MINIMAL.task, state: 'wont-do' }).success).toBe(
      true,
    );
    expect(validate(DATASET_SCHEMAS.task, { ...MINIMAL.task, state: 'abandoned' }).success).toBe(
      false,
    );
  });

  it('kb and rca have no lifecycle (state is just an unknown key)', () => {
    expect(validate(DATASET_SCHEMAS.kb, { ...okfBase, state: 'whatever' }).success).toBe(true);
  });

  it('accepts stale_after as a Date and as a YYYY-MM-DD string, outputting a Date', () => {
    const fromDate = assertValid(DATASET_SCHEMAS.kb, {
      ...okfBase,
      stale_after: new Date('2027-04-01'),
    });
    const fromString = assertValid(DATASET_SCHEMAS.kb, { ...okfBase, stale_after: '2027-04-01' });
    expect((fromDate as { stale_after: Date }).stale_after).toBeInstanceOf(Date);
    expect((fromString as { stale_after: Date }).stale_after).toBeInstanceOf(Date);
    expect((fromString as { stale_after: Date }).stale_after.toISOString()).toBe(
      '2027-04-01T00:00:00.000Z',
    );
    expect(validate(DATASET_SCHEMAS.kb, { ...okfBase, stale_after: 'not a date' }).success).toBe(
      false,
    );
  });

  it('parses an unquoted YAML date through parseYaml + schema (astro parity)', () => {
    const data = parseYaml(
      'type: Knowledge Base\nname: demo\ndescription: d\nstale_after: 2027-04-01\n',
    );
    const parsed = assertValid(DATASET_SCHEMAS.kb, data) as { stale_after: Date };
    expect(parsed.stale_after.toISOString()).toBe('2027-04-01T00:00:00.000Z');
  });

  it('validates provenance and lifecycle metadata', () => {
    const full = {
      ...okfBase,
      resource: 'https://example.com',
      tags: ['a', 'b'],
      sources: [{ id: 'spec', resource: 'https://example.com/spec', title: 'Spec', extra: 1 }],
      generated: { by: 'process:ctxman-planner', at: '2026-10-17T00:00:00Z' },
      verified: [{ by: 'human:alex', at: '2026-10-17' }],
      status: 'draft',
    };
    expect(validate(DATASET_SCHEMAS.kb, full).success).toBe(true);
    expect(
      validate(DATASET_SCHEMAS.kb, { ...full, verified: { by: 'human:alex', at: '2026-10-17' } })
        .success,
    ).toBe(true);
    expect(validate(DATASET_SCHEMAS.kb, { ...full, generated: { by: 'x' } }).success).toBe(false);
    expect(validate(DATASET_SCHEMAS.kb, { ...full, status: 'published' }).success).toBe(false);
    expect(validate(DATASET_SCHEMAS.kb, { ...full, sources: [{ id: 'x' }] }).success).toBe(false);
    expect(validate(DATASET_SCHEMAS.kb, { ...full, tags: [''] }).success).toBe(false);
    expect([...OKF_STATUSES]).toEqual(['draft', 'stable', 'deprecated']);
  });

  it('okfConceptSchema (any non-reserved concept) needs only a type', () => {
    expect(validate(okfConceptSchema, { type: 'Concept' }).success).toBe(true);
    expect(validate(okfConceptSchema, {}).success).toBe(false);
    expect(validate(okfConceptSchema, { type: 'Concept', generated: { by: 'x' } }).success).toBe(
      false,
    );
    expect(validate(okfEventSchema, { by: 'human:alex', at: '2026-10-17' }).success).toBe(true);
  });

  it('okfEntrySchema accepts okf_version "0.2" only', () => {
    const entry = { type: 'Knowledge Base', name: 'x', description: 'd' };
    expect(validate(kbSchema, entry).success).toBe(true);
    expect(validate(kbSchema, { okf_version: '0.2', ...entry }).success).toBe(true);
    expect(validate(kbSchema, { okf_version: '0.1', ...entry }).success).toBe(false);
    expect(validate(kbSchema, { okf_version: 0.2, ...entry }).success).toBe(false);
  });

  it('docSchema is loose', () => {
    expect(validate(docSchema, {}).success).toBe(true);
    expect(validate(docSchema, { okf_version: 0.2, anything: 1, state: 'weird' }).success).toBe(
      true,
    );
    expect(assertValid(docSchema, {}).tags).toEqual([]);
  });
});

describe('dateSchema', () => {
  it('coerces strings to Dates and rejects garbage', () => {
    expect(assertValid(dateSchema, '2026-10-17')).toBeInstanceOf(Date);
    expect(validate(dateSchema, 'nope').success).toBe(false);
  });
});

describe('skill (agentskills.io, strict)', () => {
  it('accepts the spec fields', () => {
    const result = validate(skillSchema, {
      name: 'demo',
      description: 'd',
      license: 'MIT',
      compatibility: 'Needs node',
      metadata: { author: 'me', version: '1' },
      'allowed-tools': 'Bash(git:*) Read',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys such as tags', () => {
    expect(validate(skillSchema, { ...MINIMAL.skill, tags: ['x'] }).success).toBe(false);
    expect(validate(skillSchema, { ...MINIMAL.skill, type: 'Skill' }).success).toBe(false);
  });

  it('enforces length limits and string-only metadata', () => {
    expect(validate(skillSchema, { ...MINIMAL.skill, description: 'x'.repeat(1024) }).success).toBe(
      true,
    );
    expect(validate(skillSchema, { ...MINIMAL.skill, description: 'x'.repeat(1025) }).success).toBe(
      false,
    );
    expect(
      validate(skillSchema, { ...MINIMAL.skill, compatibility: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(validate(skillSchema, { ...MINIMAL.skill, metadata: { n: 1 } }).success).toBe(false);
  });
});

describe('reference (discriminated by type)', () => {
  const base = { name: 'demo', description: 'd', owner: 'me' };
  const local = { ...base, type: 'local-repo', path: '~/repos/x', subpath: 'docs' };
  const remote = { ...base, type: 'remote-repo', uri: 'git@github.com:o/r.git', owner: 'not-me' };
  const skill = { ...base, type: 'remote-skill', uri: 'https://x.test/r.git' };

  it('accepts each variant', () => {
    expect(validate(referenceSchema, local).success).toBe(true);
    expect(validate(referenceSchema, remote).success).toBe(true);
    expect(validate(referenceSchema, skill).success).toBe(true);
  });

  it('discriminates on type and reports the missing variant field', () => {
    expect(validate(referenceSchema, { ...local, type: 'bogus' }).success).toBe(false);
    expect(validate(referenceSchema, { ...base }).success).toBe(false);
    const noPath = validate(referenceSchema, { ...base, type: 'local-repo' });
    expect(noPath.success).toBe(false);
    expect(JSON.stringify(issuesOf(noPath))).toContain('path');
    const noUri = validate(referenceSchema, { ...base, type: 'remote-repo' });
    expect(noUri.success).toBe(false);
    expect(JSON.stringify(issuesOf(noUri))).toContain('uri');
  });

  it('is strict per variant (fields of another variant are rejected)', () => {
    expect(validate(referenceSchema, { ...local, uri: 'https://x.test' }).success).toBe(false);
    expect(validate(referenceSchema, { ...remote, path: '/x' }).success).toBe(false);
  });

  it('remote-repo accepts scp, ssh and https git URIs and rejects anything else', () => {
    for (const uri of [
      'git@github.com:meow-sci/catcom.git',
      'ssh://git@host.test/org/repo.git',
      'https://github.com/org/repo',
      'https://github.com/org/repo.git',
    ]) {
      expect(validate(referenceSchema, { ...remote, uri }).success, uri).toBe(true);
    }
    for (const uri of [
      'not a uri',
      'github.com/org/repo',
      'ftp://h.test/o/r.git',
      'https://h.test',
    ]) {
      expect(validate(referenceSchema, { ...remote, uri }).success, uri).toBe(false);
    }
    // An archive is not a git repo.
    expect(validate(referenceSchema, { ...remote, uri: 'https://h.test/a/b.tar.gz' }).success).toBe(
      false,
    );
  });

  it('remote-skill accepts a git URI or an https archive (.tar.gz, .tgz, .zip)', () => {
    for (const uri of [
      'git@github.com:o/r.git',
      'https://github.com/o/r',
      'https://h.test/d/skill.tar.gz',
      'https://h.test/d/skill.tgz',
      'https://h.test/d/skill.ZIP',
    ]) {
      expect(validate(referenceSchema, { ...skill, uri }).success, uri).toBe(true);
    }
    for (const uri of ['http://h.test/d/skill.tar.gz', 'https://h.test/skill.rar', 'nope']) {
      const result = validate(referenceSchema, { ...skill, uri });
      expect(result.success, uri).toBe(false);
    }
    const bad = validate(referenceSchema, { ...skill, uri: 'nope' });
    expect(JSON.stringify(issuesOf(bad))).toContain('.tar.gz');
  });

  it('validates owner', () => {
    expect(validate(referenceSchema, { ...local, owner: 'someone' }).success).toBe(false);
    expect(validate(referenceSchema, { ...local, owner: 'not-me' }).success).toBe(true);
    const { owner: _owner, ...noOwner } = local;
    expect(validate(referenceSchema, noOwner).success).toBe(false);
  });

  it('remote-skill subpath may be absent, empty, or null (repo root)', () => {
    expect(validate(referenceSchema, { ...skill, subpath: null }).success).toBe(true);
    expect(validate(referenceSchema, { ...skill, subpath: '' }).success).toBe(true);
    expect(validate(referenceSchema, { ...skill, subpath: 'skills/x' }).success).toBe(true);
    // local-repo / remote-repo subpath is optional but not nullable.
    expect(validate(referenceSchema, { ...local, subpath: null }).success).toBe(false);
    expect(validate(referenceSchema, { ...remote, subpath: undefined }).success).toBe(true);
  });

  it('parses a reference yaml document end to end', () => {
    const data = parseYaml(
      'name: astro-docs\ndescription: Astro docs\ntype: remote-repo\nuri: https://github.com/withastro/docs.git\nsubpath: src/content/docs/en\nowner: not-me\ntags: [docs]\n',
    );
    expect(assertValid(referenceSchema, data)).toMatchObject({
      type: 'remote-repo',
      tags: ['docs'],
    });
  });
});

describe('context', () => {
  const ctx = (links: unknown[]) => ({ name: 'demo', description: 'd', links });

  it('accepts links to every linkable dataset, with optional notes', () => {
    const result = validate(
      contextSchema,
      ctx([
        { dataset: 'kb', slug: 'a' },
        { dataset: 'rca', slug: 'a' },
        { dataset: 'idea', slug: 'a' },
        { dataset: 'task', slug: 'a', notes: 'markdown **notes**\n' },
        { dataset: 'bug', slug: 'a' },
        { dataset: 'feature', slug: 'a' },
        { dataset: 'skill', slug: 'a' },
        { dataset: 'reference', slug: 'a' },
        { dataset: 'project', slug: 'a' },
      ]),
    );
    expect(result.success, JSON.stringify(issuesOf(result))).toBe(true);
  });

  it('defaults links and tags to empty arrays', () => {
    expect(assertValid(contextSchema, { name: 'demo', description: 'd' })).toEqual({
      name: 'demo',
      description: 'd',
      tags: [],
      links: [],
    });
  });

  it('rejects a link to the context dataset itself or an unknown dataset', () => {
    expect(validate(contextSchema, ctx([{ dataset: 'context', slug: 'a' }])).success).toBe(false);
    expect(validate(contextSchema, ctx([{ dataset: 'nope', slug: 'a' }])).success).toBe(false);
  });

  it('rejects duplicate links with a path pointing at the second one', () => {
    const result = validate(
      contextSchema,
      ctx([
        { dataset: 'kb', slug: 'a' },
        { dataset: 'task', slug: 'a' },
        { dataset: 'kb', slug: 'a', notes: 'again' },
      ]),
    );
    expect(result.success).toBe(false);
    const issue = issuesOf(result).find((i) => i.message.includes('duplicate'));
    expect(issue?.path).toEqual(['links', 2]);
    expect(issue?.message).toContain('kb/a');
  });

  it('is strict and validates slugs', () => {
    expect(validate(contextSchema, { ...ctx([]), extra: 1 }).success).toBe(false);
    expect(validate(contextLinkSchema, { dataset: 'kb', slug: 'Bad Slug' }).success).toBe(false);
    expect(validate(contextLinkSchema, { dataset: 'kb', slug: 'a', extra: 1 }).success).toBe(false);
  });

  it('parses a context yaml document end to end (literal-block notes)', () => {
    const data = parseYaml(
      'name: demo\ndescription: d\ntags: [x]\nlinks:\n  - dataset: kb\n    slug: ctxman\n    notes: |\n      line one\n      line two\n',
    );
    const parsed = assertValid(contextSchema, data);
    expect(parsed.links[0]?.notes).toBe('line one\nline two\n');
  });
});

describe('okf entry links (frontmatter `links`)', () => {
  const withLinks = (links: unknown) => ({ ...okfBase, links });

  it('defaults a missing rel to related and keeps explicit rels', () => {
    const parsed = assertValid(
      DATASET_SCHEMAS.kb,
      withLinks([
        { dataset: 'task', slug: 'a' },
        { dataset: 'feature', slug: 'b', rel: 'depends-on' },
        { dataset: 'skill', slug: 'c', rel: 'child' },
      ]),
    ) as { links: { dataset: string; slug: string; rel: string }[] };
    expect(parsed.links.map((l) => l.rel)).toEqual(['related', 'depends-on', 'child']);
    expect(assertValid(entryLinkSchema, { dataset: 'kb', slug: 'x' })).toEqual({
      dataset: 'kb',
      slug: 'x',
      rel: 'related',
    });
  });

  it('is optional, and an empty list is fine', () => {
    expect(validate(DATASET_SCHEMAS.kb, okfBase).success).toBe(true);
    expect(validate(DATASET_SCHEMAS.kb, withLinks([])).success).toBe(true);
  });

  it('keeps links on every lifecycle dataset (the schema is extended, not rebuilt)', () => {
    for (const id of ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project'] as const) {
      const parsed = validate(DATASET_SCHEMAS[id], {
        ...MINIMAL[id],
        links: [{ dataset: 'kb', slug: 'x' }],
      });
      expect(parsed.success, id).toBe(true);
      expect((dataOf(parsed) as { links: unknown[] }).links, id).toHaveLength(1);
    }
  });

  it('reports a duplicate target on the second item, with the extended schema too', () => {
    const links = [
      { dataset: 'kb', slug: 'a', rel: 'related' },
      { dataset: 'kb', slug: 'a', rel: 'child' },
      { dataset: 'task', slug: 'a' },
    ];
    for (const id of ['kb', 'task'] as const) {
      const result = validate(DATASET_SCHEMAS[id], { ...MINIMAL[id], links });
      expect(result.success, id).toBe(false);
      const issue = issuesOf(result).find((i) => i.message.includes('duplicate'));
      expect(issue?.path, id).toEqual(['links', 1]);
      expect(issue?.message, id).toBe('duplicate link kb/a');
    }
    expect(validate(entryLinksSchema, links).success).toBe(false);
  });

  it('is strict per item and validates dataset, slug and rel', () => {
    const bad = (item: unknown) => validate(DATASET_SCHEMAS.kb, withLinks([item])).success;
    expect(bad({ dataset: 'kb', slug: 'a', extra: 1 })).toBe(false);
    expect(bad({ dataset: 'context', slug: 'a' })).toBe(false);
    expect(bad({ dataset: 'recipe', slug: 'a' })).toBe(false);
    expect(bad({ dataset: 'kb', slug: 'Bad Slug' })).toBe(false);
    expect(bad({ dataset: 'kb', slug: 'a', rel: 'parent' })).toBe(false);
    expect(bad({ dataset: 'kb' })).toBe(false);
    expect(bad('kb/a')).toBe(false);
    expect(validate(DATASET_SCHEMAS.kb, withLinks({ dataset: 'kb', slug: 'a' })).success).toBe(
      false,
    );
  });

  it('is not part of concept files, skills, or the loose docs schema', () => {
    const links = [{ dataset: 'kb', slug: 'a', rel: 'nonsense' }];
    // concept files keep it as an unknown key (loose), without validating it
    expect(validate(okfConceptSchema, { type: 'Concept', links }).success).toBe(true);
    expect(validate(docSchema, { links }).success).toBe(true);
    // skills are strict: no links
    expect(
      validate(skillSchema, { ...MINIMAL.skill, links: [{ dataset: 'kb', slug: 'a' }] }).success,
    ).toBe(false);
  });

  it('parses a frontmatter block end to end (rel defaults, order kept)', () => {
    const data = parseYaml(
      'type: Task\nname: demo\ndescription: d\nstate: pending\nlinks:\n  - dataset: feature\n    slug: a\n    rel: depends-on\n  - dataset: kb\n    slug: b\n',
    );
    const parsed = assertValid(DATASET_SCHEMAS.task, data) as {
      links: { slug: string; rel: string }[];
    };
    expect(parsed.links.map((l) => [l.slug, l.rel])).toEqual([
      ['a', 'depends-on'],
      ['b', 'related'],
    ]);
  });
});

// ---------------------------------------------------------------- JSON Schema hints

const CLONE_DIRS = [
  '.ctxman/{name}',
  '{name}',
  '../x',
  'a/./b',
  'a//b',
  '/abs',
  '{nam}',
  'a b',
  '...',
  'a/..',
  '.x',
  'x.',
  'x'.repeat(200),
  'x'.repeat(201),
  '{name}{name}',
  '.{name}',
  'ok/dir-1_2',
  '',
  '.',
  '..',
  './a',
  'a/',
  'a\\b',
  'a/b/c/{name}',
  'é',
];

const GIT_REFS = [
  '',
  'develop',
  'release/1.2',
  'v1.0.0',
  'feature/a-b_c',
  '-x',
  '--upload-pack=x',
  'a..b',
  '..',
  'a//b',
  'a/',
  '/a',
  'x.lock',
  'x.lock.y',
  'a/b.lock',
  'a b',
  'a@{1}',
  '.a',
  'a.',
  '9',
  'a\nb',
  'é',
  'a'.repeat(200),
  'a'.repeat(201),
];

describe('JSON Schema hint patterns', () => {
  it('GIT_REF_PATTERN is the regex form of isSafeGitRef', () => {
    for (const ref of GIT_REFS) {
      if (ref.length > 200) continue;
      expect(GIT_REF_PATTERN.test(ref), JSON.stringify(ref)).toBe(isSafeGitRef(ref));
    }
  });

  it('CLONE_DIR_PATTERN is the regex form of isSafeRelativeDir (every length 1..200 sample)', () => {
    for (const cloneDir of CLONE_DIRS) {
      if (cloneDir.length < 1 || cloneDir.length > 200) continue;
      expect(CLONE_DIR_PATTERN.test(cloneDir), JSON.stringify(cloneDir)).toBe(
        isSafeRelativeDir(cloneDir),
      );
    }
  });

  it('the recipe schema accepts exactly the branches and clone dirs the catalog accepts', () => {
    const recipe = { name: 'r', description: 'd' };
    for (const branch of GIT_REFS) {
      const overrides = [{ key: 'reference/x', materialOptions: { branch } }];
      expect(validate(recipeSchema, { ...recipe, overrides }).success, JSON.stringify(branch)).toBe(
        branch.length <= 200 && isSafeGitRef(branch),
      );
    }
    for (const cloneDir of CLONE_DIRS) {
      const overrides = [{ key: 'reference/x', options: { cloneDir } }];
      expect(
        validate(recipeSchema, { ...recipe, overrides }).success,
        JSON.stringify(cloneDir),
      ).toBe(cloneDir.length >= 1 && cloneDir.length <= 200 && isSafeRelativeDir(cloneDir));
    }
  });

  it('REMOTE_URI_HINT_PATTERN is a superset of the strict uri rules', () => {
    const hint = new RegExp(REMOTE_URI_HINT_PATTERN);
    for (const uri of [
      'git@github.com:org/repo.git',
      'ssh://git@host/org/repo.git',
      'https://host/org/repo',
      'https://h.test/d/skill.tar.gz',
    ]) {
      expect(hint.test(uri), uri).toBe(true);
    }
    expect(hint.test('nope')).toBe(false);
  });

  it('YAML_DATASET_TYPES are the schemas the datasets validate with', () => {
    expect(YAML_DATASET_TYPES.reference).toBe(DATASET_SCHEMAS.reference);
    expect(YAML_DATASET_TYPES.context).toBe(DATASET_SCHEMAS.context);
    expect(YAML_DATASET_TYPES.recipe).toBe(DATASET_SCHEMAS.recipe);
  });
});
