import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REMOTE_URI_HINT_PATTERN } from '../../src/datasets/schemas.ts';
import { LINKABLE_DATASETS, OWNERS } from '../../src/datasets/registry.ts';
import {
  INFLATE_LAYOUTS,
  INFLATE_TARGETS,
  ITEM_KINDS,
  materialsFor,
  modesFor,
} from '../../src/lib/inflate/catalog.ts';
import {
  JSON_SCHEMA_DIALECT,
  allSchemaTexts,
  buildJsonSchema,
  jsonSchemaText,
  schemaId,
} from '../../src/lib/json-schema.ts';
import { SCHEMA_DATASETS, schemaFileName } from '../../src/lib/schema-comment.ts';

type Node = { [key: string]: unknown };

/** Every object node of a JSON document (depth first), root included. */
function* walk(value: unknown): Generator<Node> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walk(item);
  } else if (value !== null && typeof value === 'object') {
    yield value as Node;
    for (const child of Object.values(value)) yield* walk(child);
  }
}

const parsed = (ds: (typeof SCHEMA_DATASETS)[number]) =>
  JSON.parse(jsonSchemaText(ds)) as Node & { properties?: Node; anyOf?: Node[] };

describe.each(SCHEMA_DATASETS)('JSON Schema of %s', (ds) => {
  it('is deterministic: two generations are byte-identical', () => {
    expect(jsonSchemaText(ds)).toBe(jsonSchemaText(ds));
    expect(allSchemaTexts()[ds]).toBe(jsonSchemaText(ds));
  });

  it('equals the committed file schemas/<ds>.schema.json (run pnpm run gen:schemas)', () => {
    const committed = readFileSync(
      new URL(`../../schemas/${schemaFileName(ds)}`, import.meta.url),
      'utf8',
    );
    expect(committed).toBe(jsonSchemaText(ds));
  });

  it('is formatted as JSON.stringify(..., null, 2) plus one trailing newline', () => {
    const text = jsonSchemaText(ds);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  });

  it('starts with $schema, $id, title, description, $comment and uses draft-07', () => {
    const doc = buildJsonSchema(ds);
    expect(Object.keys(doc).slice(0, 5)).toEqual([
      '$schema',
      '$id',
      'title',
      'description',
      '$comment',
    ]);
    expect(doc.$schema).toBe(JSON_SCHEMA_DIALECT);
    expect(JSON_SCHEMA_DIALECT).toBe('http://json-schema.org/draft-07/schema#');
    expect(doc.$id).toBe(`https://ctxman.local/schemas/${ds}.schema.json`);
    expect(doc.$id).toBe(schemaId(ds));
    expect(String(doc.$comment)).toContain('do not edit');
    expect(String(doc.$comment)).toContain('name must equal the file name');
  });

  it('every node with a pattern and a description also has patternErrorMessage = description', () => {
    let withPattern = 0;
    for (const node of walk(parsed(ds))) {
      if (typeof node.pattern === 'string' && typeof node.description === 'string') {
        withPattern++;
        expect(node.patternErrorMessage).toBe(node.description);
      } else {
        expect(node).not.toHaveProperty('patternErrorMessage');
      }
    }
    expect(withPattern).toBeGreaterThan(0);
  });

  it('every additionalProperties is false, and every object with properties sets it', () => {
    for (const node of walk(parsed(ds))) {
      if ('additionalProperties' in node) expect(node.additionalProperties).toBe(false);
      if (node.type === 'object' && node.properties !== undefined) {
        expect(node.additionalProperties).toBe(false);
      }
    }
  });

  it('never marks a defaulted array / tags field as required', () => {
    const variants = parsed(ds).anyOf ?? [parsed(ds)];
    // a recipe's `markdown` is a defaulted list of blocks; a snippet's `markdown` is its required text
    const arrays = ['links', 'contexts', 'items', 'markdown', 'overrides', 'order'].filter(
      (key) => !(ds === 'snippet' && key === 'markdown'),
    );
    for (const variant of variants) {
      expect(variant.required as string[]).not.toContain('tags');
      for (const key of arrays) expect(variant.required as string[]).not.toContain(key);
    }
  });
});

describe('reference schema', () => {
  const variants = (parsed('reference').anyOf ?? []) as (Node & { properties: Node })[];

  it('is an anyOf of the four variants, told apart by the type const', () => {
    expect(variants.map((v) => (v.properties.type as Node).const)).toEqual([
      'local-folder',
      'local-repo',
      'remote-repo',
      'remote-skill',
    ]);
  });

  it('uri has the lenient hint pattern on both remote variants, with the exact message', () => {
    const uris = variants
      .filter((v) => v.properties.uri !== undefined)
      .map((v) => v.properties.uri as Node);
    expect(uris).toHaveLength(2);
    for (const uri of uris) {
      expect(uri.pattern).toBe(REMOTE_URI_HINT_PATTERN);
      expect(uri.patternErrorMessage).toBe(uri.description);
    }
    expect(String(uris[0]?.description)).toContain('git URI');
    expect(String(uris[1]?.description)).toContain('.tar.gz');
  });

  it('the hint pattern accepts what isGitUri accepts', () => {
    const hint = new RegExp(REMOTE_URI_HINT_PATTERN);
    for (const ok of [
      'git@github.com:o/r.git',
      'ssh://git@h.test/o/r.git',
      'https://h.test/o/r',
      'https://h.test/o/r.git',
      'https://h.test/s.tar.gz',
    ]) {
      expect(hint.test(ok), ok).toBe(true);
    }
    for (const bad of ['', 'nope', 'not a uri', 'http://h.test/o/r', 'git@host']) {
      expect(hint.test(bad), bad).toBe(false);
    }
  });

  it('owner is the enum me | not-me on every variant', () => {
    for (const variant of variants) {
      expect((variant.properties.owner as Node).enum).toEqual([...OWNERS].sort());
    }
  });
});

describe('context schema', () => {
  it('link datasets are the linkable ones (no context, no recipe)', () => {
    const links = (parsed('context').properties?.links ?? {}) as Node;
    const dataset = (((links.items as Node).properties as Node).dataset ?? {}) as Node;
    // arktype sorts enum members
    expect(dataset.enum).toEqual([...LINKABLE_DATASETS].sort());
    expect(dataset.enum).not.toContain('context');
    expect(dataset.enum).not.toContain('recipe');
  });
});

describe('recipe schema', () => {
  const props = parsed('recipe').properties as Node;

  it('defaults.properties has one entry per item kind (sorted), each mode.enum = that kind modes', () => {
    const defaults = props.defaults as Node & {
      properties: Record<string, { properties: { mode: { enum?: string[]; const?: string } } }>;
    };
    expect(Object.keys(defaults.properties)).toEqual([...ITEM_KINDS].sort());
    for (const kind of ITEM_KINDS) {
      const mode = defaults.properties[kind].properties.mode;
      // one choice (a snippet's `inline`) is a `const`, several an `enum`
      expect([...(mode.enum ?? [mode.const])].sort()).toEqual(
        modesFor(kind)
          .map((m) => m.id)
          .sort(),
      );
    }
  });

  it('defaults.<kind>.material.enum = that kind materials (v3: skill symlink, local-repo copy)', () => {
    const defaults = props.defaults as Node & {
      properties: Record<string, { properties: { material: { enum?: string[]; const?: string } } }>;
    };
    for (const kind of ITEM_KINDS) {
      const material = defaults.properties[kind].properties.material;
      expect([...(material.enum ?? [material.const])].sort(), kind).toEqual(
        materialsFor(kind)
          .map((m) => m.id)
          .sort(),
      );
    }
    expect(defaults.properties.skill.properties.material.enum).toContain('symlink');
    expect(defaults.properties['local-repo'].properties.material.enum).toContain('copy');
  });

  it('an override carries the boolean edit (Editable) next to exclude', () => {
    const overrides = props.overrides as Node & {
      items: { properties: Record<string, Node> };
    };
    expect(overrides.items.properties.edit).toEqual({ type: 'boolean' });
    expect(overrides.items.properties.exclude).toEqual({ type: 'boolean' });
  });

  it('target and layout are enums', () => {
    expect((props.target as Node).enum).toEqual([...INFLATE_TARGETS].sort());
    expect((props.layout as Node).enum).toEqual([...INFLATE_LAYOUTS].sort());
  });

  it('cloneDir, override key and order key carry pattern messages', () => {
    const text = jsonSchemaText('recipe');
    expect(text).toContain('must be a relative path inside the project');
    expect(text).toContain('must be <dataset>/<slug> of a linkable dataset');
    expect(text).toContain('must be <dataset>/<slug>, md:<id>, ctx:<context> or sec:extra');
  });
});
