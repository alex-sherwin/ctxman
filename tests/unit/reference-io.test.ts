import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ReferenceIoError,
  createReference,
  deleteReference,
  readReference,
  referenceFile,
  validateReference,
  writeReference,
} from '../../src/lib/reference-io.ts';
import { parseReference, serializeReference } from '../../src/lib/reference-yaml.ts';
import { schemaCommentLine, withSchemaComment } from '../../src/lib/schema-comment.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ReferenceIoError) return error.code;
    throw error;
  }
  return 'resolved';
}

const doc = (overrides: Record<string, unknown> = {}) => ({
  name: 'my-ref',
  description: 'A reference',
  type: 'remote-repo',
  uri: 'git@github.com:org/repo.git',
  owner: 'me',
  tags: ['a'],
  ...overrides,
});

describe('referenceFile', () => {
  it('returns data/reference/<slug>.yaml and rejects non-kebab slugs', () => {
    const root = path.resolve('/data-root');
    expect(referenceFile('my-ref', root)).toBe(path.join(root, 'reference', 'my-ref.yaml'));
    for (const bad of ['', 'A', '../x', 'a/b', 'a.b', '-a', 'a'.repeat(65)]) {
      expect(() => referenceFile(bad, root), bad).toThrow(ReferenceIoError);
    }
    try {
      referenceFile('../x', root);
    } catch (error) {
      expect((error as ReferenceIoError).code).toBe('bad-slug');
    }
  });
});

describe('validateReference', () => {
  it('accepts a valid document and requires name === slug', () => {
    expect(validateReference(doc(), 'my-ref')).toMatchObject({ ok: true });
    expect(validateReference(doc(), 'other')).toMatchObject({ ok: false, code: 'name-mismatch' });
    expect(validateReference({ name: 'my-ref' }, 'my-ref')).toMatchObject({
      ok: false,
      code: 'invalid',
    });
  });
});

describe('create / read / write / delete cycle', () => {
  it('creates, reads, rewrites and deletes a reference', async () => {
    const dir = tmp.make();

    const created = await createReference(doc(), dir);
    expect(created.slug).toBe('my-ref');
    expect(created.file).toBe('reference/my-ref.yaml');
    const file = path.join(dir, 'reference', 'my-ref.yaml');
    const text = readFileSync(file, 'utf8');
    expect(text).toBe(withSchemaComment('reference', serializeReference(created.reference)));
    expect(text.split('\n')[0]).toBe(schemaCommentLine('reference'));

    const read = await readReference('my-ref', dir);
    expect(read.reference).toEqual(created.reference);
    expect(Number.isNaN(Date.parse(read.lastModified))).toBe(false);

    const written = await writeReference('my-ref', doc({ description: 'Changed' }), dir);
    expect(written.reference.description).toBe('Changed');
    expect(readFileSync(file, 'utf8')).toBe(
      withSchemaComment('reference', serializeReference(written.reference)),
    );
    expect((await readReference('my-ref', dir)).reference.description).toBe('Changed');

    await deleteReference('my-ref', dir);
    expect(existsSync(file)).toBe(false);
  });

  it('may change the type on write; the new shape is validated', async () => {
    const dir = tmp.make();
    await createReference(doc(), dir);
    const written = await writeReference(
      'my-ref',
      {
        name: 'my-ref',
        description: 'Now local',
        type: 'local-repo',
        path: '~/x',
        owner: 'not-me',
      },
      dir,
    );
    expect(written.reference).toMatchObject({ type: 'local-repo', path: '~/x', owner: 'not-me' });
    const text = readFileSync(path.join(dir, 'reference', 'my-ref.yaml'), 'utf8');
    expect(text).not.toContain('uri:');
    expect(await codeOf(writeReference('my-ref', doc({ type: 'local-repo' }), dir))).toBe(
      'invalid',
    );
  });

  it('error codes: exists, not-found, name-mismatch, invalid, bad-slug', async () => {
    const dir = tmp.make();
    await createReference(doc(), dir);

    expect(await codeOf(createReference(doc(), dir))).toBe('exists');
    expect(await codeOf(createReference({ name: 'x' }, dir))).toBe('invalid');
    expect(await codeOf(createReference(doc({ name: 'Bad Name' }), dir))).toBe('invalid');
    expect(await codeOf(createReference(doc({ name: 'x', uri: 'not a uri' }), dir))).toBe(
      'invalid',
    );

    expect(await codeOf(readReference('nope', dir))).toBe('not-found');
    expect(await codeOf(writeReference('nope', doc({ name: 'nope' }), dir))).toBe('not-found');
    expect(await codeOf(deleteReference('nope', dir))).toBe('not-found');

    expect(await codeOf(writeReference('my-ref', doc({ name: 'renamed' }), dir))).toBe(
      'name-mismatch',
    );
    expect(await codeOf(writeReference('my-ref', { name: 'my-ref' }, dir))).toBe('invalid');
    expect(await codeOf(readReference('../etc', dir))).toBe('bad-slug');
    expect(await codeOf(deleteReference('A', dir))).toBe('bad-slug');

    expect((await readReference('my-ref', dir)).reference.description).toBe('A reference');
  });

  it('carries issues on invalid errors', async () => {
    const dir = tmp.make();
    try {
      await createReference(doc({ uri: 'not a uri' }), dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ReferenceIoError);
      const issues = (error as ReferenceIoError).issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]?.path).toBe('uri');
    }
  });

  it('writes atomically: no .tmp files remain, even after a failed write', async () => {
    const dir = tmp.make();
    await createReference(doc(), dir);
    await writeReference('my-ref', doc({ description: 'v2' }), dir);
    await codeOf(writeReference('my-ref', doc({ name: 'other' }), dir));
    expect(readdirSync(path.join(dir, 'reference'))).toEqual(['my-ref.yaml']);
  });

  it('create makes the reference directory when it is missing', async () => {
    const dir = tmp.make();
    expect(existsSync(path.join(dir, 'reference'))).toBe(false);
    await createReference(doc(), dir);
    expect(existsSync(path.join(dir, 'reference', 'my-ref.yaml'))).toBe(true);
  });

  it('files round-trip through parseYaml + parseReference', async () => {
    const dir = tmp.make();
    const created = await createReference(
      doc({ type: 'remote-skill', subpath: 'skills/x', description: 'Has: colon\nand two lines' }),
      dir,
    );
    const source = readFileSync(path.join(dir, 'reference', 'my-ref.yaml'), 'utf8');
    const again = parseReference(parseYaml(source), 'my-ref');
    expect(again.ok && again.reference).toEqual(created.reference);
  });
});

describe('readReference on damaged files', () => {
  it('distinguishes parse errors, schema errors and a stem/name mismatch', async () => {
    const dir = tmp.make({
      'reference/broken.yaml': 'name: [unclosed\n',
      'reference/bad-schema.yaml': 'name: bad-schema\ndescription: ""\ntype: nope\n',
      'reference/stem.yaml': 'name: other\ndescription: d\ntype: local-repo\npath: /x\nowner: me\n',
    });
    expect(await codeOf(readReference('broken', dir))).toBe('parse');
    expect(await codeOf(readReference('bad-schema', dir))).toBe('invalid');
    expect(await codeOf(readReference('stem', dir))).toBe('invalid');
  });

  it('reads a file that starts with the schema comment (and one without it)', async () => {
    const body = 'name: ok\ndescription: d\ntype: local-repo\npath: /x\nowner: me\n';
    const dir = tmp.make({
      'reference/ok.yaml': `${schemaCommentLine('reference')}\n${body}`,
      'reference/plain.yaml': body.replace('name: ok', 'name: plain'),
    });
    expect((await readReference('ok', dir)).reference.name).toBe('ok');
    expect((await readReference('plain', dir)).reference.name).toBe('plain');
  });
});

describe('unused-path guard', () => {
  it('does not touch directories outside the data dir', async () => {
    const dir = tmp.make();
    mkdirSync(path.join(dir, 'reference'));
    writeFileSync(path.join(dir, 'reference', 'keep.yaml'), 'name: keep\n');
    await expect(readReference('../keep', dir)).rejects.toBeInstanceOf(ReferenceIoError);
  });
});
