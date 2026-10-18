import { describe, expect, it } from 'vitest';
import { referenceSchema } from '../../src/datasets/schemas.ts';
import type { ReferenceData } from '../../src/datasets/schemas.ts';
import {
  parseReference,
  referenceToYamlObject,
  sameReference,
  serializeReference,
} from '../../src/lib/reference-yaml.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { assertValid } from '../../src/datasets/validate.ts';

const parse = (input: unknown): ReferenceData => assertValid(referenceSchema, input);

const local = parse({
  name: 'my-repo',
  description: 'A local checkout.',
  type: 'local-repo',
  path: '~/repos/my-repo',
  subpath: 'packages/app',
  owner: 'me',
  tags: ['a', 'b'],
});
const remoteRepo = parse({
  name: 'blasto',
  description: 'ksa mod for ground landing vfx',
  type: 'remote-repo',
  uri: 'git@github.com:meow-sci/blasto.git',
  owner: 'me',
  tags: ['ksa', 'mod'],
});
const remoteSkill = parse({
  name: 'anthropic-skills',
  description: "Anthropic's public skills repository; a good model.",
  type: 'remote-skill',
  uri: 'https://github.com/anthropics/skills.git',
  subpath: 'skills/skill-creator',
  owner: 'not-me',
  tags: ['skills', 'agentskills'],
});

describe('serializeReference', () => {
  it('writes keys in the fixed order for each type', () => {
    expect(Object.keys(referenceToYamlObject(local))).toEqual([
      'name',
      'description',
      'type',
      'path',
      'subpath',
      'owner',
      'tags',
    ]);
    expect(Object.keys(referenceToYamlObject(remoteRepo))).toEqual([
      'name',
      'description',
      'type',
      'uri',
      'owner',
      'tags',
    ]);
    expect(Object.keys(referenceToYamlObject(remoteSkill))).toEqual([
      'name',
      'description',
      'type',
      'uri',
      'subpath',
      'owner',
      'tags',
    ]);
  });

  it('is byte-identical to the hand-written seed files', () => {
    expect(serializeReference(remoteRepo)).toBe(
      [
        'name: blasto',
        'description: ksa mod for ground landing vfx',
        'type: remote-repo',
        'uri: git@github.com:meow-sci/blasto.git',
        'owner: me',
        'tags:',
        '  - ksa',
        '  - mod',
        '',
      ].join('\n'),
    );
    expect(serializeReference(remoteSkill)).toBe(
      [
        'name: anthropic-skills',
        "description: Anthropic's public skills repository; a good model.",
        'type: remote-skill',
        'uri: https://github.com/anthropics/skills.git',
        'subpath: skills/skill-creator',
        'owner: not-me',
        'tags:',
        '  - skills',
        '  - agentskills',
        '',
      ].join('\n'),
    );
    expect(serializeReference(local)).toBe(
      [
        'name: my-repo',
        'description: A local checkout.',
        'type: local-repo',
        'path: ~/repos/my-repo',
        'subpath: packages/app',
        'owner: me',
        'tags:',
        '  - a',
        '  - b',
        '',
      ].join('\n'),
    );
  });

  it('omits subpath for undefined, null and the empty string', () => {
    for (const subpath of [undefined, null, '']) {
      const input = { ...remoteSkill, subpath } as unknown as ReferenceData;
      expect(Object.keys(referenceToYamlObject(input)), String(subpath)).not.toContain('subpath');
    }
    expect(serializeReference(parse({ ...remoteSkill, subpath: null }))).not.toContain('subpath');
  });

  it('omits tags when empty', () => {
    const noTags = parse({ ...remoteRepo, tags: [] });
    expect(serializeReference(noTags)).not.toContain('tags');
    expect(serializeReference(parse({ ...remoteRepo, tags: undefined }))).not.toContain('tags');
  });

  it('round-trips parse -> serialize -> parse', () => {
    for (const reference of [local, remoteRepo, remoteSkill]) {
      const again = parseReference(parseYaml(serializeReference(reference)), reference.name);
      expect(again.ok && again.reference).toEqual(reference);
      expect(serializeReference(again.ok ? again.reference : reference)).toBe(
        serializeReference(reference),
      );
    }
  });

  it('keeps awkward text intact (colons, hash, leading dash, multi-line)', () => {
    const awkward = parse({
      ...remoteRepo,
      description: 'Line one: has a colon # and a hash\nLine two - with dash',
      tags: ['x: y', '- z'],
    });
    const again = parseReference(parseYaml(serializeReference(awkward)));
    expect(again.ok && again.reference.description).toBe(awkward.description);
    expect(again.ok && again.reference.tags).toEqual(['x: y', '- z']);
  });
});

describe('sameReference', () => {
  it('compares the serialized documents; null equals only null', () => {
    expect(sameReference(null, null)).toBe(true);
    expect(sameReference(local, null)).toBe(false);
    expect(sameReference(null, local)).toBe(false);
    expect(sameReference(local, { ...local })).toBe(true);
    expect(sameReference(local, { ...local, description: 'other' })).toBe(false);
    expect(sameReference(local, { ...local, subpath: '' })).toBe(false);
    // an empty subpath serializes like an absent one
    expect(sameReference({ ...local, subpath: '' }, { ...local, subpath: undefined })).toBe(true);
  });
});

describe('parseReference', () => {
  it('accepts the three types', () => {
    for (const reference of [local, remoteRepo, remoteSkill]) {
      expect(parseReference({ ...reference })).toEqual({ ok: true, reference });
    }
  });

  it('returns dotted issues and says "Required" for missing fields', () => {
    const result = parseReference({ type: 'remote-repo', uri: 'nope', owner: 'you' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid');
    expect(result.issues).toContainEqual({ path: 'name', message: 'Required' });
    expect(result.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['name', 'description', 'uri', 'owner']),
    );
  });

  it('rejects an unknown type, extra keys and non-objects', () => {
    expect(parseReference({ ...remoteRepo, type: 'nope' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(parseReference({ ...remoteRepo, extra: 1 })).toMatchObject({ ok: false });
    expect(parseReference({ ...local, uri: 'git@h:o/r.git' })).toMatchObject({ ok: false });
    expect(parseReference(null)).toMatchObject({ ok: false, code: 'invalid' });
    expect(parseReference('x')).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('reports name-mismatch when the name differs from the expected one', () => {
    expect(parseReference({ ...remoteRepo }, 'other')).toEqual({
      ok: false,
      code: 'name-mismatch',
      issues: [
        { path: 'name', message: 'name must equal "other" (reference names cannot be changed)' },
      ],
    });
    expect(parseReference({ ...remoteRepo }, 'blasto').ok).toBe(true);
  });

  it('validates the uri of each type with its own rule', () => {
    const archive = 'https://example.test/skills.tar.gz';
    expect(parseReference({ ...remoteSkill, uri: archive }).ok).toBe(true);
    const onRepo = parseReference({ ...remoteRepo, uri: archive });
    expect(onRepo.ok).toBe(false);
    if (!onRepo.ok) expect(onRepo.issues[0]?.path).toBe('uri');
  });
});
