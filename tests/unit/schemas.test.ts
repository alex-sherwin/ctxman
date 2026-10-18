import { describe, expect, it } from 'vitest';
import { DATASET_IDS } from '../../src/datasets/registry.ts';
import type { DatasetId } from '../../src/datasets/registry.ts';
import {
  DATASET_SCHEMAS,
  OKF_STATUSES,
  contextLinkSchema,
  contextSchema,
  dateSchema,
  docSchema,
  entryLinkSchema,
  entryLinksSchema,
  nameSchema,
  okfConceptSchema,
  okfEventSchema,
  okfIndexSchema,
  referenceSchema,
  skillSchema,
} from '../../src/datasets/schemas.ts';
import { parseYaml } from '../../src/lib/yaml.ts';

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
    const result = DATASET_SCHEMAS[id].safeParse(MINIMAL[id]);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it.each([...DATASET_IDS])('%s rejects a missing name and an invalid name', (id) => {
    const { name: _name, ...withoutName } = MINIMAL[id];
    expect(DATASET_SCHEMAS[id].safeParse(withoutName).success).toBe(false);
    expect(DATASET_SCHEMAS[id].safeParse({ ...MINIMAL[id], name: 'Not Kebab' }).success).toBe(
      false,
    );
  });

  it.each([...DATASET_IDS])('%s rejects a blank description', (id) => {
    expect(DATASET_SCHEMAS[id].safeParse({ ...MINIMAL[id], description: '   ' }).success).toBe(
      false,
    );
  });

  it('defaults tags to [] (okf, reference, context, recipe)', () => {
    for (const id of ['kb', 'idea', 'reference', 'context', 'recipe'] as const) {
      const parsed = DATASET_SCHEMAS[id].parse(MINIMAL[id]) as { tags: string[] };
      expect(parsed.tags, id).toEqual([]);
    }
  });
});

describe('name', () => {
  it('accepts kebab-case and rejects everything else', () => {
    for (const ok of ['a', 'a-b', 'a1-b2', 'x'.repeat(64)]) {
      expect(nameSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['', 'A', '-a', 'a-', 'a--b', 'a_b', 'a b', 'x'.repeat(65)]) {
      expect(nameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('okf entries (kb, rca, idea, task, bug, feature, project)', () => {
  it('requires type', () => {
    const { type: _type, ...rest } = okfBase;
    expect(DATASET_SCHEMAS.kb.safeParse(rest).success).toBe(false);
    expect(DATASET_SCHEMAS.kb.safeParse({ ...okfBase, type: '  ' }).success).toBe(false);
  });

  it('preserves unknown keys', () => {
    const parsed = DATASET_SCHEMAS.kb.parse({ ...okfBase, custom_key: { nested: [1, 2] } });
    expect(parsed).toMatchObject({ custom_key: { nested: [1, 2] } });
  });

  it.each(['idea', 'task', 'bug', 'feature', 'project'] as const)(
    '%s requires a valid lifecycle state',
    (id) => {
      const schema = DATASET_SCHEMAS[id];
      expect(schema.safeParse({ ...MINIMAL[id], state: 'done' }).success).toBe(false);
      expect(schema.safeParse({ ...MINIMAL[id], state: 'in progress' }).success).toBe(false);
      const { state: _state, ...withoutState } = MINIMAL[id];
      expect(schema.safeParse(withoutState).success).toBe(false);
      expect(schema.safeParse({ ...MINIMAL[id], state: 'in-progress' }).success).toBe(true);
    },
  );

  it('uses a different state set per dataset', () => {
    expect(DATASET_SCHEMAS.idea.safeParse({ ...MINIMAL.idea, state: 'abandoned' }).success).toBe(
      true,
    );
    expect(DATASET_SCHEMAS.idea.safeParse({ ...MINIMAL.idea, state: 'fixed' }).success).toBe(false);
    expect(DATASET_SCHEMAS.bug.safeParse({ ...MINIMAL.bug, state: 'fixed' }).success).toBe(true);
    expect(DATASET_SCHEMAS.bug.safeParse({ ...MINIMAL.bug, state: 'wont-fix' }).success).toBe(true);
    expect(DATASET_SCHEMAS.bug.safeParse({ ...MINIMAL.bug, state: 'complete' }).success).toBe(
      false,
    );
    expect(DATASET_SCHEMAS.task.safeParse({ ...MINIMAL.task, state: 'wont-do' }).success).toBe(
      true,
    );
    expect(DATASET_SCHEMAS.task.safeParse({ ...MINIMAL.task, state: 'abandoned' }).success).toBe(
      false,
    );
  });

  it('kb and rca have no lifecycle (state is just an unknown key)', () => {
    expect(DATASET_SCHEMAS.kb.safeParse({ ...okfBase, state: 'whatever' }).success).toBe(true);
  });

  it('accepts stale_after as a Date and as a YYYY-MM-DD string, outputting a Date', () => {
    const fromDate = DATASET_SCHEMAS.kb.parse({ ...okfBase, stale_after: new Date('2027-04-01') });
    const fromString = DATASET_SCHEMAS.kb.parse({ ...okfBase, stale_after: '2027-04-01' });
    expect((fromDate as { stale_after: Date }).stale_after).toBeInstanceOf(Date);
    expect((fromString as { stale_after: Date }).stale_after).toBeInstanceOf(Date);
    expect((fromString as { stale_after: Date }).stale_after.toISOString()).toBe(
      '2027-04-01T00:00:00.000Z',
    );
    expect(DATASET_SCHEMAS.kb.safeParse({ ...okfBase, stale_after: 'not a date' }).success).toBe(
      false,
    );
  });

  it('parses an unquoted YAML date through parseYaml + schema (astro parity)', () => {
    const data = parseYaml(
      'type: Knowledge Base\nname: demo\ndescription: d\nstale_after: 2027-04-01\n',
    );
    const parsed = DATASET_SCHEMAS.kb.parse(data) as { stale_after: Date };
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
    expect(DATASET_SCHEMAS.kb.safeParse(full).success).toBe(true);
    expect(
      DATASET_SCHEMAS.kb.safeParse({ ...full, verified: { by: 'human:alex', at: '2026-10-17' } })
        .success,
    ).toBe(true);
    expect(DATASET_SCHEMAS.kb.safeParse({ ...full, generated: { by: 'x' } }).success).toBe(false);
    expect(DATASET_SCHEMAS.kb.safeParse({ ...full, status: 'published' }).success).toBe(false);
    expect(DATASET_SCHEMAS.kb.safeParse({ ...full, sources: [{ id: 'x' }] }).success).toBe(false);
    expect(DATASET_SCHEMAS.kb.safeParse({ ...full, tags: [''] }).success).toBe(false);
    expect([...OKF_STATUSES]).toEqual(['draft', 'stable', 'deprecated']);
  });

  it('okfConceptSchema (any non-reserved concept) needs only a type', () => {
    expect(okfConceptSchema.safeParse({ type: 'Concept' }).success).toBe(true);
    expect(okfConceptSchema.safeParse({}).success).toBe(false);
    expect(okfConceptSchema.safeParse({ type: 'Concept', generated: { by: 'x' } }).success).toBe(
      false,
    );
    expect(okfEventSchema.safeParse({ by: 'human:alex', at: '2026-10-17' }).success).toBe(true);
  });

  it('okfIndexSchema allows only okf_version "0.2"', () => {
    expect(okfIndexSchema.safeParse({}).success).toBe(true);
    expect(okfIndexSchema.safeParse({ okf_version: '0.2' }).success).toBe(true);
    expect(okfIndexSchema.safeParse({ okf_version: '0.1' }).success).toBe(false);
    expect(okfIndexSchema.safeParse({ okf_version: '0.2', title: 'x' }).success).toBe(false);
  });

  it('docSchema is loose', () => {
    expect(docSchema.safeParse({}).success).toBe(true);
    expect(docSchema.safeParse({ okf_version: 0.2, anything: 1, state: 'weird' }).success).toBe(
      true,
    );
    expect(docSchema.parse({}).tags).toEqual([]);
  });
});

describe('dateSchema', () => {
  it('coerces strings to Dates and rejects garbage', () => {
    expect(dateSchema.parse('2026-10-17')).toBeInstanceOf(Date);
    expect(dateSchema.safeParse('nope').success).toBe(false);
  });
});

describe('skill (agentskills.io, strict)', () => {
  it('accepts the spec fields', () => {
    const result = skillSchema.safeParse({
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
    expect(skillSchema.safeParse({ ...MINIMAL.skill, tags: ['x'] }).success).toBe(false);
    expect(skillSchema.safeParse({ ...MINIMAL.skill, type: 'Skill' }).success).toBe(false);
  });

  it('enforces length limits and string-only metadata', () => {
    expect(skillSchema.safeParse({ ...MINIMAL.skill, description: 'x'.repeat(1024) }).success).toBe(
      true,
    );
    expect(skillSchema.safeParse({ ...MINIMAL.skill, description: 'x'.repeat(1025) }).success).toBe(
      false,
    );
    expect(
      skillSchema.safeParse({ ...MINIMAL.skill, compatibility: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(skillSchema.safeParse({ ...MINIMAL.skill, metadata: { n: 1 } }).success).toBe(false);
  });
});

describe('reference (discriminated by type)', () => {
  const base = { name: 'demo', description: 'd', owner: 'me' };
  const local = { ...base, type: 'local-repo', path: '~/repos/x', subpath: 'docs' };
  const remote = { ...base, type: 'remote-repo', uri: 'git@github.com:o/r.git', owner: 'not-me' };
  const skill = { ...base, type: 'remote-skill', uri: 'https://x.test/r.git' };

  it('accepts each variant', () => {
    expect(referenceSchema.safeParse(local).success).toBe(true);
    expect(referenceSchema.safeParse(remote).success).toBe(true);
    expect(referenceSchema.safeParse(skill).success).toBe(true);
  });

  it('discriminates on type and reports the missing variant field', () => {
    expect(referenceSchema.safeParse({ ...local, type: 'bogus' }).success).toBe(false);
    expect(referenceSchema.safeParse({ ...base }).success).toBe(false);
    const noPath = referenceSchema.safeParse({ ...base, type: 'local-repo' });
    expect(noPath.success).toBe(false);
    expect(JSON.stringify(noPath.error?.issues)).toContain('path');
    const noUri = referenceSchema.safeParse({ ...base, type: 'remote-repo' });
    expect(noUri.success).toBe(false);
    expect(JSON.stringify(noUri.error?.issues)).toContain('uri');
  });

  it('is strict per variant (fields of another variant are rejected)', () => {
    expect(referenceSchema.safeParse({ ...local, uri: 'https://x.test' }).success).toBe(false);
    expect(referenceSchema.safeParse({ ...remote, path: '/x' }).success).toBe(false);
  });

  it('remote-repo accepts scp, ssh and https git URIs and rejects anything else', () => {
    for (const uri of [
      'git@github.com:meow-sci/catcom.git',
      'ssh://git@host.test/org/repo.git',
      'https://github.com/org/repo',
      'https://github.com/org/repo.git',
    ]) {
      expect(referenceSchema.safeParse({ ...remote, uri }).success, uri).toBe(true);
    }
    for (const uri of [
      'not a uri',
      'github.com/org/repo',
      'ftp://h.test/o/r.git',
      'https://h.test',
    ]) {
      expect(referenceSchema.safeParse({ ...remote, uri }).success, uri).toBe(false);
    }
    // An archive is not a git repo.
    expect(referenceSchema.safeParse({ ...remote, uri: 'https://h.test/a/b.tar.gz' }).success).toBe(
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
      expect(referenceSchema.safeParse({ ...skill, uri }).success, uri).toBe(true);
    }
    for (const uri of ['http://h.test/d/skill.tar.gz', 'https://h.test/skill.rar', 'nope']) {
      const result = referenceSchema.safeParse({ ...skill, uri });
      expect(result.success, uri).toBe(false);
    }
    const bad = referenceSchema.safeParse({ ...skill, uri: 'nope' });
    expect(JSON.stringify(bad.error?.issues)).toContain('.tar.gz');
  });

  it('validates owner', () => {
    expect(referenceSchema.safeParse({ ...local, owner: 'someone' }).success).toBe(false);
    expect(referenceSchema.safeParse({ ...local, owner: 'not-me' }).success).toBe(true);
    const { owner: _owner, ...noOwner } = local;
    expect(referenceSchema.safeParse(noOwner).success).toBe(false);
  });

  it('remote-skill subpath may be absent, empty, or null (repo root)', () => {
    expect(referenceSchema.safeParse({ ...skill, subpath: null }).success).toBe(true);
    expect(referenceSchema.safeParse({ ...skill, subpath: '' }).success).toBe(true);
    expect(referenceSchema.safeParse({ ...skill, subpath: 'skills/x' }).success).toBe(true);
    // local-repo / remote-repo subpath is optional but not nullable.
    expect(referenceSchema.safeParse({ ...local, subpath: null }).success).toBe(false);
    expect(referenceSchema.safeParse({ ...remote, subpath: undefined }).success).toBe(true);
  });

  it('parses a reference yaml document end to end', () => {
    const data = parseYaml(
      'name: astro-docs\ndescription: Astro docs\ntype: remote-repo\nuri: https://github.com/withastro/docs.git\nsubpath: src/content/docs/en\nowner: not-me\ntags: [docs]\n',
    );
    expect(referenceSchema.parse(data)).toMatchObject({ type: 'remote-repo', tags: ['docs'] });
  });
});

describe('context', () => {
  const ctx = (links: unknown[]) => ({ name: 'demo', description: 'd', links });

  it('accepts links to every linkable dataset, with optional notes', () => {
    const result = contextSchema.safeParse(
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
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('defaults links and tags to empty arrays', () => {
    expect(contextSchema.parse({ name: 'demo', description: 'd' })).toEqual({
      name: 'demo',
      description: 'd',
      tags: [],
      links: [],
    });
  });

  it('rejects a link to the context dataset itself or an unknown dataset', () => {
    expect(contextSchema.safeParse(ctx([{ dataset: 'context', slug: 'a' }])).success).toBe(false);
    expect(contextSchema.safeParse(ctx([{ dataset: 'nope', slug: 'a' }])).success).toBe(false);
  });

  it('rejects duplicate links with a path pointing at the second one', () => {
    const result = contextSchema.safeParse(
      ctx([
        { dataset: 'kb', slug: 'a' },
        { dataset: 'task', slug: 'a' },
        { dataset: 'kb', slug: 'a', notes: 'again' },
      ]),
    );
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.message.includes('duplicate'));
    expect(issue?.path).toEqual(['links', 2]);
    expect(issue?.message).toContain('kb/a');
  });

  it('is strict and validates slugs', () => {
    expect(contextSchema.safeParse({ ...ctx([]), extra: 1 }).success).toBe(false);
    expect(contextLinkSchema.safeParse({ dataset: 'kb', slug: 'Bad Slug' }).success).toBe(false);
    expect(contextLinkSchema.safeParse({ dataset: 'kb', slug: 'a', extra: 1 }).success).toBe(false);
  });

  it('parses a context yaml document end to end (literal-block notes)', () => {
    const data = parseYaml(
      'name: demo\ndescription: d\ntags: [x]\nlinks:\n  - dataset: kb\n    slug: ctxman\n    notes: |\n      line one\n      line two\n',
    );
    const parsed = contextSchema.parse(data);
    expect(parsed.links[0]?.notes).toBe('line one\nline two\n');
  });
});

describe('okf entry links (frontmatter `links`)', () => {
  const withLinks = (links: unknown) => ({ ...okfBase, links });

  it('defaults a missing rel to related and keeps explicit rels', () => {
    const parsed = DATASET_SCHEMAS.kb.parse(
      withLinks([
        { dataset: 'task', slug: 'a' },
        { dataset: 'feature', slug: 'b', rel: 'depends-on' },
        { dataset: 'skill', slug: 'c', rel: 'child' },
      ]),
    ) as { links: { dataset: string; slug: string; rel: string }[] };
    expect(parsed.links.map((l) => l.rel)).toEqual(['related', 'depends-on', 'child']);
    expect(entryLinkSchema.parse({ dataset: 'kb', slug: 'x' })).toEqual({
      dataset: 'kb',
      slug: 'x',
      rel: 'related',
    });
  });

  it('is optional, and an empty list is fine', () => {
    expect(DATASET_SCHEMAS.kb.safeParse(okfBase).success).toBe(true);
    expect(DATASET_SCHEMAS.kb.safeParse(withLinks([])).success).toBe(true);
  });

  it('keeps links on every lifecycle dataset (the schema is extended, not rebuilt)', () => {
    for (const id of ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project'] as const) {
      const parsed = DATASET_SCHEMAS[id].safeParse({
        ...MINIMAL[id],
        links: [{ dataset: 'kb', slug: 'x' }],
      });
      expect(parsed.success, id).toBe(true);
      expect((parsed.data as { links: unknown[] }).links, id).toHaveLength(1);
    }
  });

  it('reports a duplicate target on the second item, with the extended schema too', () => {
    const links = [
      { dataset: 'kb', slug: 'a', rel: 'related' },
      { dataset: 'kb', slug: 'a', rel: 'child' },
      { dataset: 'task', slug: 'a' },
    ];
    for (const id of ['kb', 'task'] as const) {
      const result = DATASET_SCHEMAS[id].safeParse({ ...MINIMAL[id], links });
      expect(result.success, id).toBe(false);
      const issue = result.error?.issues.find((i) => i.message.includes('duplicate'));
      expect(issue?.path, id).toEqual(['links', 1]);
      expect(issue?.message, id).toBe('duplicate link kb/a');
    }
    expect(entryLinksSchema.safeParse(links).success).toBe(false);
  });

  it('is strict per item and validates dataset, slug and rel', () => {
    const bad = (item: unknown) => DATASET_SCHEMAS.kb.safeParse(withLinks([item])).success;
    expect(bad({ dataset: 'kb', slug: 'a', extra: 1 })).toBe(false);
    expect(bad({ dataset: 'context', slug: 'a' })).toBe(false);
    expect(bad({ dataset: 'recipe', slug: 'a' })).toBe(false);
    expect(bad({ dataset: 'kb', slug: 'Bad Slug' })).toBe(false);
    expect(bad({ dataset: 'kb', slug: 'a', rel: 'parent' })).toBe(false);
    expect(bad({ dataset: 'kb' })).toBe(false);
    expect(bad('kb/a')).toBe(false);
    expect(DATASET_SCHEMAS.kb.safeParse(withLinks({ dataset: 'kb', slug: 'a' })).success).toBe(
      false,
    );
  });

  it('is not part of concept files, skills, or the loose docs schema', () => {
    const links = [{ dataset: 'kb', slug: 'a', rel: 'nonsense' }];
    // concept files keep it as an unknown key (loose), without validating it
    expect(okfConceptSchema.safeParse({ type: 'Concept', links }).success).toBe(true);
    expect(docSchema.safeParse({ links }).success).toBe(true);
    // skills are strict: no links
    expect(
      skillSchema.safeParse({ ...MINIMAL.skill, links: [{ dataset: 'kb', slug: 'a' }] }).success,
    ).toBe(false);
  });

  it('parses a frontmatter block end to end (rel defaults, order kept)', () => {
    const data = parseYaml(
      'type: Task\nname: demo\ndescription: d\nstate: pending\nlinks:\n  - dataset: feature\n    slug: a\n    rel: depends-on\n  - dataset: kb\n    slug: b\n',
    );
    const parsed = DATASET_SCHEMAS.task.parse(data) as {
      links: { slug: string; rel: string }[];
    };
    expect(parsed.links.map((l) => [l.slug, l.rel])).toEqual([
      ['a', 'depends-on'],
      ['b', 'related'],
    ]);
  });
});
