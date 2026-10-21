import { describe, expect, it } from 'vitest';
import { YAML_CODECS } from '../../src/lib/forms/codecs.ts';
import { validate } from '../../src/datasets/validate.ts';
import {
  FORM_FIELDS,
  LINKED_EDITOR,
  YAML_DATASETS,
  emptyDoc,
  fieldHelp,
  fieldPlaceholder,
  isYamlDatasetId,
  normalizeDoc,
  readonlySummary,
  validateDoc,
  visibleFields,
} from '../../src/lib/forms/fields.ts';

const ids = (defs: readonly { id: string }[]): string[] => defs.map((d) => d.id);

describe('YAML_DATASETS', () => {
  it('lists the four editable yaml datasets', () => {
    expect([...YAML_DATASETS]).toEqual(['reference', 'snippet', 'context', 'recipe']);
    expect(isYamlDatasetId('reference')).toBe(true);
    expect(isYamlDatasetId('snippet')).toBe(true);
    expect(isYamlDatasetId('kb')).toBe(false);
    expect(isYamlDatasetId(undefined)).toBe(false);
  });
});

describe('FORM_FIELDS / visibleFields', () => {
  it('reference: the type switch shows path for the local types and uri for the remote types', () => {
    for (const type of ['local-repo', 'local-folder']) {
      expect(ids(visibleFields('reference', { type }))).toEqual([
        'name',
        'description',
        'tags',
        'type',
        'path',
        'subpath',
        'folder',
        'owner',
        'info',
      ]);
    }
    expect(ids(visibleFields('reference', { type: 'remote-repo' }))).toEqual([
      'name',
      'description',
      'tags',
      'type',
      'uri',
      'subpath',
      'folder',
      'owner',
      'info',
    ]);
    // a remote skill is installed under its skill name: no folder
    expect(ids(visibleFields('reference', { type: 'remote-skill' }))).toEqual([
      'name',
      'description',
      'tags',
      'type',
      'uri',
      'subpath',
      'owner',
      'info',
    ]);
    const folder = FORM_FIELDS.reference.find((f) => f.id === 'folder');
    expect(folder?.label).toBe('Folder name');
    expect(folder && fieldHelp(folder, { type: 'local-folder' })).toMatch(
      /^Folder under folders\//,
    );
    expect(folder && fieldHelp(folder, { type: 'remote-repo' })).toMatch(/^Folder under repos\//);
    expect(FORM_FIELDS.reference.find((f) => f.id === 'info')?.kind).toBe('markdown');
  });

  it('reference type options come from the registry', () => {
    const type = FORM_FIELDS.reference.find((f) => f.id === 'type');
    expect(type?.options?.map((o) => o.id)).toEqual([
      'local-repo',
      'local-folder',
      'remote-repo',
      'remote-skill',
    ]);
    expect(type?.options?.map((o) => o.label)).toEqual([
      'Local repo',
      'Local folder',
      'Remote repo',
      'Remote skill',
    ]);
    const owner = FORM_FIELDS.reference.find((f) => f.id === 'owner');
    expect(owner?.options?.map((o) => o.label)).toEqual(['me', 'not me']);
  });

  it('path help and placeholder depend on the local type', () => {
    const path = FORM_FIELDS.reference.find((f) => f.id === 'path')!;
    expect(fieldHelp(path, { type: 'local-repo' })).toBe('Absolute or ~/ path of the repo root');
    expect(fieldHelp(path, { type: 'local-folder' })).toBe('Absolute or ~/ path of the folder');
    expect(fieldPlaceholder(path, { type: 'local-repo' })).toBe('~/repos/my-repo');
    expect(fieldPlaceholder(path, { type: 'local-folder' })).toBe('~/my-folder');
    expect(fieldPlaceholder(FORM_FIELDS.reference[0]!, {})).toBeUndefined();
  });

  it('uri help depends on the type', () => {
    const uri = FORM_FIELDS.reference.find((f) => f.id === 'uri')!;
    expect(fieldHelp(uri, { type: 'remote-repo' })).toContain('git URI');
    expect(fieldHelp(uri, { type: 'remote-skill' })).toContain('.tar.gz');
    expect(fieldHelp(FORM_FIELDS.reference[0]!, {})).toBeUndefined();
  });

  it('context has scalar fields only; recipe adds target, layout and the preamble editor', () => {
    expect(ids(FORM_FIELDS.context)).toEqual(['name', 'description', 'tags']);
    expect(ids(FORM_FIELDS.recipe)).toEqual([
      'name',
      'description',
      'tags',
      'target',
      'layout',
      'preamble',
    ]);
    const kinds = Object.fromEntries(FORM_FIELDS.recipe.map((f) => [f.id, f.kind]));
    expect(kinds).toMatchObject({
      name: 'name',
      tags: 'tags',
      target: 'select',
      preamble: 'markdown',
    });
    const target = FORM_FIELDS.recipe.find((f) => f.id === 'target');
    expect(target?.options?.map((o) => o.label)).toEqual(['Claude Code', 'Codex', 'Generic agent']);
    const layout = FORM_FIELDS.recipe.find((f) => f.id === 'layout');
    expect(layout?.options?.map((o) => o.label)).toEqual(['Grouped', 'Flat']);
  });
});

describe('FORM_FIELDS.snippet', () => {
  it('is name, description, tags and a required markdown editor', () => {
    expect(ids(visibleFields('snippet', {}))).toEqual(['name', 'description', 'tags', 'markdown']);
    const markdown = FORM_FIELDS.snippet.find((f) => f.id === 'markdown');
    expect(markdown).toMatchObject({ kind: 'markdown', required: true });
  });
});

describe('LINKED_EDITOR', () => {
  it('points context at the Forge and recipe at Inflate', () => {
    expect(LINKED_EDITOR.reference).toBeNull();
    expect(LINKED_EDITOR.snippet).toBeNull();
    expect(LINKED_EDITOR.context?.label).toBe('Edit links in Forge');
    expect(LINKED_EDITOR.context?.href('my-ctx')).toBe('/forge?context=my-ctx');
    expect(LINKED_EDITOR.recipe?.label).toBe('Edit composition in Inflate');
    expect(LINKED_EDITOR.recipe?.href('r1')).toBe('/inflate?recipe=r1');
  });
});

describe('emptyDoc', () => {
  it('matches the spec shapes and returns fresh objects', () => {
    expect(emptyDoc('reference')).toEqual({
      name: '',
      description: '',
      type: 'local-repo',
      path: '',
      owner: 'me',
    });
    expect(emptyDoc('context')).toEqual({ name: '', description: '', links: [] });
    expect(emptyDoc('snippet')).toEqual({ name: '', description: '', markdown: '' });
    expect(emptyDoc('recipe')).toMatchObject({
      name: '',
      target: 'claude-code',
      layout: 'grouped',
      contexts: [],
      items: [],
      markdown: [],
      overrides: [],
      order: [],
    });
    expect(emptyDoc('context')).not.toBe(emptyDoc('context'));
  });
});

describe('normalizeDoc', () => {
  it('reference: trims, drops empty optionals and the keys of the inactive type variant', () => {
    expect(
      normalizeDoc('reference', {
        name: ' my-ref ',
        description: ' A repo ',
        tags: [],
        type: 'local-repo',
        path: ' ~/repos/x ',
        uri: 'git@github.com:org/x.git',
        subpath: '  ',
        owner: 'me',
      }),
    ).toEqual({
      name: 'my-ref',
      description: 'A repo',
      type: 'local-repo',
      path: '~/repos/x',
      owner: 'me',
    });
  });

  it('reference: a local-folder keeps path and drops uri, like a local-repo', () => {
    expect(
      normalizeDoc('reference', {
        name: 'notes',
        description: 'My notes',
        type: 'local-folder',
        path: ' ~/notes ',
        uri: 'git@github.com:org/x.git',
        subpath: ' drafts ',
        owner: 'me',
      }),
    ).toEqual({
      name: 'notes',
      description: 'My notes',
      type: 'local-folder',
      path: '~/notes',
      subpath: 'drafts',
      owner: 'me',
    });
  });

  it('reference: folder is trimmed, kept after subpath, dropped when empty or for a remote skill', () => {
    const base = { name: 'r', description: 'd', owner: 'me' };
    const repo = normalizeDoc('reference', {
      ...base,
      type: 'local-repo',
      path: '/x',
      subpath: 'src',
      folder: ' r-main ',
    });
    expect(Object.keys(repo)).toEqual([
      'name',
      'description',
      'type',
      'path',
      'subpath',
      'folder',
      'owner',
    ]);
    expect(repo.folder).toBe('r-main');
    expect(
      normalizeDoc('reference', { ...base, type: 'local-repo', path: '/x', folder: '  ' }),
    ).not.toHaveProperty('folder');
    expect(
      normalizeDoc('reference', {
        ...base,
        type: 'remote-skill',
        uri: 'https://example.com/s.tgz',
        folder: 'leftover',
      }),
    ).not.toHaveProperty('folder');
    expect(
      validateDoc('reference', {
        ...base,
        type: 'remote-repo',
        uri: 'git@h:o/r.git',
        folder: '../x',
      }),
    ).toEqual({
      ok: false,
      errors: {
        folder:
          'must be one folder name: a letter or digit first, then letters, digits, . _ - (max 100 characters) (was "../x")',
      },
    });
    expect(
      validateDoc('reference', {
        ...base,
        type: 'remote-repo',
        uri: 'git@h:o/r.git',
        folder: 'R.git',
      }).ok,
    ).toBe(true);
  });

  it('reference: info is kept as written (last key) and dropped when blank', () => {
    const base = { name: 'r', description: 'd', type: 'local-repo', path: '/x', owner: 'me' };
    const kept = normalizeDoc('reference', { ...base, info: '## Setup\n\nRun it.\n' });
    expect(kept.info).toBe('## Setup\n\nRun it.\n');
    expect(Object.keys(kept).at(-1)).toBe('info');
    expect(normalizeDoc('reference', { ...base, info: '  \n' })).not.toHaveProperty('info');
  });

  it('reference: switching to a remote type drops path and keeps uri / subpath / tags', () => {
    const doc = normalizeDoc('reference', {
      name: 'r',
      description: 'd',
      tags: ['a', 'b'],
      type: 'remote-skill',
      path: '/old',
      uri: ' https://example.com/s.tgz ',
      subpath: ' skills/x ',
      owner: 'not-me',
    });
    expect(doc).toEqual({
      name: 'r',
      description: 'd',
      type: 'remote-skill',
      uri: 'https://example.com/s.tgz',
      subpath: 'skills/x',
      owner: 'not-me',
      tags: ['a', 'b'],
    });
    expect(Object.keys(doc)).toEqual([
      'name',
      'description',
      'type',
      'uri',
      'subpath',
      'owner',
      'tags',
    ]);
  });

  it('context: keeps links untouched and drops empty tags', () => {
    const links = [{ dataset: 'kb', slug: 'ctxman', notes: 'n' }];
    expect(normalizeDoc('context', { name: ' c ', description: ' d ', tags: [], links })).toEqual({
      name: 'c',
      description: 'd',
      links,
    });
  });

  it('recipe: keeps the composition, drops a blank preamble and empty tags', () => {
    const doc = normalizeDoc('recipe', {
      ...emptyDoc('recipe'),
      name: 'r',
      description: 'd',
      tags: [],
      preamble: '  \n',
      contexts: ['a'],
    });
    expect(doc.contexts).toEqual(['a']);
    expect(doc).not.toHaveProperty('preamble');
    expect(doc).not.toHaveProperty('tags');
    expect(normalizeDoc('recipe', { ...doc, preamble: 'Hello' }).preamble).toBe('Hello');
  });
});

describe('normalizeDoc snippet', () => {
  it('trims name and description, drops empty tags, keeps markdown exactly as typed (last key)', () => {
    const doc = normalizeDoc('snippet', {
      name: ' s ',
      description: ' d ',
      tags: [],
      markdown: '  indented\n\n',
      stray: 'gone',
    });
    expect(doc).toEqual({ name: 's', description: 'd', markdown: '  indented\n\n' });
    expect(Object.keys(normalizeDoc('snippet', { ...doc, tags: ['a'] }))).toEqual([
      'name',
      'description',
      'tags',
      'markdown',
    ]);
  });
});

describe('validateDoc', () => {
  it('snippet: a blank markdown is Required; a filled one is valid', () => {
    const r = validateDoc('snippet', emptyDoc('snippet'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual({ name: 'Required', description: 'Required', markdown: 'Required' });
    }
    const blank = validateDoc('snippet', { name: 's', description: 'd', markdown: ' \n ' });
    expect(!blank.ok && blank.errors).toEqual({ markdown: 'Required' });
    expect(validateDoc('snippet', { name: 's', description: 'd', markdown: 'Do it.' })).toEqual({
      ok: true,
      doc: { name: 's', description: 'd', tags: [], markdown: 'Do it.' },
    });
    expect(
      validateDoc('snippet', { name: 't', description: 'd', markdown: 'x' }, 's'),
    ).toMatchObject({ ok: false, errors: { name: expect.stringContaining("can't be changed") } });
  });

  it('accepts a minimal local-repo reference', () => {
    const r = validateDoc('reference', {
      name: 'my-ref',
      description: 'A repo',
      type: 'local-repo',
      path: '~/repos/x',
      owner: 'me',
    });
    expect(r).toMatchObject({ ok: true });
  });

  it('says Required for the empty required fields and validates the name', () => {
    const r = validateDoc('reference', emptyDoc('reference'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toMatchObject({
        name: 'Required',
        description: 'Required',
        path: 'Required',
      });
    }
    const bad = validateDoc('context', {
      ...emptyDoc('context'),
      name: 'Not Kebab',
      description: 'd',
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.name).toMatch(/lowercase letters/);
  });

  it('reference: reports a bad uri with the schema message, first message per field', () => {
    for (const type of ['remote-repo', 'remote-skill']) {
      const r = validateDoc('reference', {
        name: 'x',
        description: 'd',
        type,
        uri: 'nope',
        owner: 'me',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(Object.keys(r.errors)).toEqual(['uri']);
        expect(r.errors.uri).toMatch(/URI/i);
      }
    }
    expect(
      validateDoc('reference', {
        name: 'x',
        description: 'd',
        type: 'remote-skill',
        uri: 'https://example.com/skills.tar.gz',
        owner: 'me',
      }).ok,
    ).toBe(true);
    // an archive is not a valid remote-repo uri
    expect(
      validateDoc('reference', {
        name: 'x',
        description: 'd',
        type: 'remote-repo',
        uri: 'https://example.com/skills.tar.gz',
        owner: 'me',
      }).ok,
    ).toBe(false);
  });

  it('a stale path of the other variant never fails the reference', () => {
    expect(
      validateDoc('reference', {
        name: 'x',
        description: 'd',
        type: 'remote-repo',
        uri: 'git@github.com:org/x.git',
        path: '/old',
        owner: 'me',
      }).ok,
    ).toBe(true);
  });

  it('edit mode: a different name is an error', () => {
    const doc = { name: 'other', description: 'd', links: [] };
    expect(validateDoc('context', doc).ok).toBe(true);
    const r = validateDoc('context', doc, 'mine');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toContain('mine');
  });

  it('maps errors in non-form fields to their field id, root issues to "_"', () => {
    const r = validateDoc('context', {
      name: 'c',
      description: 'd',
      links: [
        { dataset: 'kb', slug: 'x' },
        { dataset: 'kb', slug: 'x' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.links).toContain('duplicate link kb/x');
  });

  it('recipe: validates target and layout', () => {
    const base = { ...emptyDoc('recipe'), name: 'r', description: 'd' };
    expect(validateDoc('recipe', base).ok).toBe(true);
    const bad = validateDoc('recipe', { ...base, target: 'vim' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.target).toBeTruthy();
  });
});

describe('readonlySummary', () => {
  it('counts links, and contexts / items / blocks', () => {
    expect(readonlySummary('context', { links: [{}, {}] })).toBe('2 links — edit in Forge');
    expect(readonlySummary('context', { links: [{}] })).toBe('1 link — edit in Forge');
    expect(readonlySummary('context', {})).toBe('0 links — edit in Forge');
    expect(readonlySummary('recipe', { contexts: ['a'], items: [{}, {}], markdown: [] })).toBe(
      '1 context · 2 items · 0 blocks — edit in Inflate',
    );
    expect(readonlySummary('reference', {})).toBeNull();
    expect(readonlySummary('snippet', {})).toBeNull();
  });
});

describe('YAML_CODECS', () => {
  it('serializes a valid document with the canonical serializer and round-trips through the schema', () => {
    const doc = {
      name: 'my-ref',
      description: 'A repo',
      type: 'remote-repo',
      uri: 'git@github.com:org/x.git',
      owner: 'me',
      tags: ['t1'],
    };
    const text = YAML_CODECS.reference.serialize(doc);
    expect(text).toBe(
      [
        'name: my-ref',
        'description: A repo',
        'type: remote-repo',
        'uri: git@github.com:org/x.git',
        'owner: me',
        'tags:',
        '  - t1',
        '',
      ].join('\n'),
    );
    expect(validate(YAML_CODECS.reference.schema, doc).success).toBe(true);
  });

  it('snippet: markdown last as a literal block; same compares the data', () => {
    const doc = { name: 's', description: 'd', tags: ['t'], markdown: 'One.\n\nTwo.\n' };
    expect(YAML_CODECS.snippet.serialize(doc)).toBe(
      'name: s\ndescription: d\ntags:\n  - t\nmarkdown: |\n  One.\n\n  Two.\n',
    );
    expect(YAML_CODECS.snippet.same(doc, { ...doc })).toBe(true);
    expect(YAML_CODECS.snippet.same(doc, { ...doc, markdown: 'One.\n' })).toBe(false);
    expect(YAML_CODECS.snippet.toDoc({ snippet: doc, lastModified: 'T' })).toEqual(doc);
    expect(YAML_CODECS.snippet.serialize(emptyDoc('snippet'))).toContain('markdown: ""');
  });

  it('serializes an invalid document best-effort instead of throwing', () => {
    const text = YAML_CODECS.reference.serialize(emptyDoc('reference'));
    expect(text).toContain('type: local-repo');
    expect(text).toContain('name: ""');
    expect(YAML_CODECS.context.serialize(emptyDoc('context'))).toContain('links: []');
  });

  it('same ignores key order and absent-vs-empty optionals, detects real changes', () => {
    const a = { name: 'c', description: 'd', links: [] };
    const b = { links: [], description: 'd', tags: [], name: 'c' };
    expect(YAML_CODECS.context.same(a, b)).toBe(true);
    expect(YAML_CODECS.context.same(a, { ...a, description: 'e' })).toBe(false);
    expect(YAML_CODECS.context.same(a, null)).toBe(false);
    expect(YAML_CODECS.context.same(null, null)).toBe(true);
    // invalid documents still compare
    expect(YAML_CODECS.reference.same(emptyDoc('reference'), emptyDoc('reference'))).toBe(true);
    expect(
      YAML_CODECS.reference.same(emptyDoc('reference'), { ...emptyDoc('reference'), name: 'x' }),
    ).toBe(false);
    // switching the reference type is a change even when the old path stays around
    expect(
      YAML_CODECS.reference.same(
        { name: 'r', description: 'd', type: 'local-repo', path: '/x', owner: 'me' },
        { name: 'r', description: 'd', type: 'remote-repo', uri: 'git@h:o/r.git', owner: 'me' },
      ),
    ).toBe(false);
  });

  it('toDoc reads the dataset key of an API body and deep-copies it', () => {
    const body = { recipe: { name: 'r', contexts: ['a'] }, lastModified: 'x' };
    const doc = YAML_CODECS.recipe.toDoc(body)!;
    expect(doc).toEqual({ name: 'r', contexts: ['a'] });
    expect(doc).not.toBe(body.recipe);
    expect(YAML_CODECS.recipe.toDoc({ context: {} })).toBeNull();
    expect(YAML_CODECS.recipe.toDoc(null)).toBeNull();
  });
});
