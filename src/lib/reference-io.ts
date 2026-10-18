// NODE: runtime read/write of reference/<slug>.yaml, a mirror of recipe-io.ts / context-io.ts. References are
// ALWAYS read through this module (fs + schema validation) at request time, so lists, details, the search index
// and the API are current on every request.
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidName } from '../datasets/registry.ts';
import type { ReferenceData } from '../datasets/schemas.ts';
import { datasetDir, resolveDataDir, resolveServerOrigin } from './data-dir.ts';
import { parseReference, serializeReference } from './reference-yaml.ts';
import type { ReferenceIssue } from './reference-yaml.ts';
import { withSchemaComment } from './schema-comment.ts';
import { parseYaml } from './yaml.ts';

export interface ReferenceRecord {
  slug: string;
  reference: ReferenceData;
  /** ISO mtime of the file. */
  lastModified: string;
  /** Data-dir-relative path: 'reference/<slug>.yaml'. */
  file: string;
}

export class ReferenceIoError extends Error {
  code: 'not-found' | 'exists' | 'invalid' | 'bad-slug' | 'name-mismatch' | 'parse';
  issues: ReferenceIssue[];
  constructor(code: ReferenceIoError['code'], message: string, issues: ReferenceIssue[] = []) {
    super(message);
    this.name = 'ReferenceIoError';
    this.code = code;
    this.issues = issues;
  }
}

/** Absolute path of reference/<slug>.yaml; throws `bad-slug` unless the slug is a valid entry name. */
export function referenceFile(slug: string, dataDir: string = resolveDataDir()): string {
  if (!isValidName(slug)) {
    throw new ReferenceIoError(
      'bad-slug',
      `"${slug}" is not a valid reference name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  return path.join(datasetDir('reference', dataDir), `${slug}.yaml`);
}

const fileRel = (slug: string): string => `reference/${slug}.yaml`;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/** Validates an untrusted reference document against `referenceSchema` and requires `name === slug`. */
export function validateReference(input: unknown, slug: string): ReturnType<typeof parseReference> {
  return parseReference(input, slug);
}

async function recordFor(
  slug: string,
  abs: string,
  reference: ReferenceData,
): Promise<ReferenceRecord> {
  const st = await stat(abs);
  return { slug, reference, lastModified: st.mtime.toISOString(), file: fileRel(slug) };
}

function parseReferenceSource(source: string, slug: string): ReferenceData {
  let value: unknown;
  try {
    value = parseYaml(source);
  } catch (error) {
    throw new ReferenceIoError(
      'parse',
      `${fileRel(slug)}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`,
    );
  }
  const result = validateReference(value ?? {}, slug);
  if (!result.ok) {
    throw new ReferenceIoError(
      'invalid',
      `${fileRel(slug)} does not match the reference schema`,
      result.issues,
    );
  }
  return result.reference;
}

/** Reads one reference. Throws `not-found`, `parse` (bad YAML) or `invalid` (schema / name != stem). */
export async function readReference(
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<ReferenceRecord> {
  const abs = referenceFile(slug, dataDir);
  let source: string;
  try {
    source = await readFile(abs, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EISDIR') {
      throw new ReferenceIoError('not-found', `reference "${slug}" does not exist`);
    }
    throw error;
  }
  return recordFor(slug, abs, parseReferenceSource(source, slug));
}

export interface InvalidReferenceFile {
  slug: string;
  /** Data-dir-relative path: 'reference/<slug>.yaml'. */
  file: string;
  issues: ReferenceIssue[];
  /** ISO mtime of the file. */
  lastModified: string;
}

/**
 * Every `reference/*.yaml`, sorted by slug: valid ones as records, unreadable ones (bad YAML, schema violation,
 * name != file stem) in `invalid` with their issues. Other errors (I/O) are rethrown.
 */
export async function listReferences(
  dataDir: string = resolveDataDir(),
): Promise<{ items: ReferenceRecord[]; invalid: InvalidReferenceFile[] }> {
  const items: ReferenceRecord[] = [];
  const invalid: InvalidReferenceFile[] = [];
  let names: string[];
  try {
    names = (await readdir(datasetDir('reference', dataDir)))
      .filter((f) => f.endsWith('.yaml') && !f.startsWith('.'))
      .sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return { items, invalid };
    throw error;
  }
  for (const name of names) {
    const slug = name.slice(0, -'.yaml'.length);
    // A file name that is not a valid entry name cannot be addressed by slug at all: skip it.
    if (!isValidName(slug)) continue;
    try {
      items.push(await readReference(slug, dataDir));
    } catch (error) {
      if (!(error instanceof ReferenceIoError)) throw error;
      if (error.code === 'not-found') continue;
      const abs = referenceFile(slug, dataDir);
      const st = await stat(abs).catch(() => undefined);
      invalid.push({
        slug,
        file: fileRel(slug),
        issues: error.issues.length > 0 ? error.issues : [{ path: '', message: error.message }],
        lastModified: (st?.mtime ?? new Date(0)).toISOString(),
      });
    }
  }
  return { items, invalid };
}

/** Creates reference/<input.name>.yaml. Throws `invalid` (schema), `exists` (never overwrites). */
export async function createReference(
  input: unknown,
  dataDir: string = resolveDataDir(),
): Promise<ReferenceRecord> {
  const parsed = parseReference(input);
  if (!parsed.ok) {
    throw new ReferenceIoError('invalid', 'reference does not match the schema', parsed.issues);
  }
  const reference = parsed.reference;
  const slug = reference.name;
  const abs = referenceFile(slug, dataDir);
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    await writeFile(
      abs,
      withSchemaComment('reference', serializeReference(reference), resolveServerOrigin()),
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      throw new ReferenceIoError('exists', `reference "${slug}" already exists`);
    }
    throw error;
  }
  return recordFor(slug, abs, reference);
}

/**
 * Replaces an existing reference (PUT). The reference must exist (`not-found`) and `input.name` must equal
 * `slug` (`name-mismatch`; names are immutable). `type` may change (the discriminated union validates the
 * new shape). Written atomically: temp file in the same dir, then rename.
 */
export async function writeReference(
  slug: string,
  input: unknown,
  dataDir: string = resolveDataDir(),
): Promise<ReferenceRecord> {
  const abs = referenceFile(slug, dataDir);
  try {
    await stat(abs);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new ReferenceIoError('not-found', `reference "${slug}" does not exist`);
    }
    throw error;
  }
  const result = validateReference(input, slug);
  if (!result.ok) {
    throw new ReferenceIoError(
      result.code,
      result.code === 'invalid'
        ? 'reference does not match the schema'
        : `reference name cannot be changed (expected "${slug}")`,
      result.issues,
    );
  }
  // The reference glob is `*.yaml`, so the `.tmp` file is never loaded.
  const tmp = `${abs}.${process.pid}.tmp`;
  try {
    await writeFile(
      tmp,
      withSchemaComment('reference', serializeReference(result.reference), resolveServerOrigin()),
      'utf8',
    );
    await rename(tmp, abs);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  return recordFor(slug, abs, result.reference);
}

/** Deletes a reference file; `not-found` if it does not exist. */
export async function deleteReference(
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<void> {
  const abs = referenceFile(slug, dataDir);
  try {
    await unlink(abs);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new ReferenceIoError('not-found', `reference "${slug}" does not exist`);
    }
    throw error;
  }
}
