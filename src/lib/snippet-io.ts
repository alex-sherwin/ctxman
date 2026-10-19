// NODE: runtime read/write of snippet/<slug>.yaml, a mirror of reference-io.ts. Snippets are ALWAYS read through
// this module (fs + schema validation) at request time, so lists, details, the search index, Inflate and the API
// are current on every request.
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidName } from '../datasets/registry.ts';
import type { SnippetData } from '../datasets/schemas.ts';
import { datasetDir, resolveDataDir, resolveServerOrigin } from './data-dir.ts';
import { parseSnippet, serializeSnippet } from './snippet-yaml.ts';
import type { SnippetIssue } from './snippet-yaml.ts';
import { withSchemaComment } from './schema-comment.ts';
import { parseYaml } from './yaml.ts';

export interface SnippetRecord {
  slug: string;
  snippet: SnippetData;
  /** ISO mtime of the file. */
  lastModified: string;
  /** Data-dir-relative path: 'snippet/<slug>.yaml'. */
  file: string;
}

export class SnippetIoError extends Error {
  code: 'not-found' | 'exists' | 'invalid' | 'bad-slug' | 'name-mismatch' | 'parse';
  issues: SnippetIssue[];
  constructor(code: SnippetIoError['code'], message: string, issues: SnippetIssue[] = []) {
    super(message);
    this.name = 'SnippetIoError';
    this.code = code;
    this.issues = issues;
  }
}

/** Absolute path of snippet/<slug>.yaml; throws `bad-slug` unless the slug is a valid entry name. */
export function snippetFile(slug: string, dataDir: string = resolveDataDir()): string {
  if (!isValidName(slug)) {
    throw new SnippetIoError(
      'bad-slug',
      `"${slug}" is not a valid snippet name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  return path.join(datasetDir('snippet', dataDir), `${slug}.yaml`);
}

const fileRel = (slug: string): string => `snippet/${slug}.yaml`;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/** Validates an untrusted snippet document against `snippetSchema` and requires `name === slug`. */
export function validateSnippet(input: unknown, slug: string): ReturnType<typeof parseSnippet> {
  return parseSnippet(input, slug);
}

async function recordFor(slug: string, abs: string, snippet: SnippetData): Promise<SnippetRecord> {
  const st = await stat(abs);
  return { slug, snippet, lastModified: st.mtime.toISOString(), file: fileRel(slug) };
}

function parseSnippetSource(source: string, slug: string): SnippetData {
  let value: unknown;
  try {
    value = parseYaml(source);
  } catch (error) {
    throw new SnippetIoError(
      'parse',
      `${fileRel(slug)}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`,
    );
  }
  const result = validateSnippet(value ?? {}, slug);
  if (!result.ok) {
    throw new SnippetIoError(
      'invalid',
      `${fileRel(slug)} does not match the snippet schema`,
      result.issues,
    );
  }
  return result.snippet;
}

/** Reads one snippet. Throws `not-found`, `parse` (bad YAML) or `invalid` (schema / name != stem). */
export async function readSnippet(
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<SnippetRecord> {
  const abs = snippetFile(slug, dataDir);
  let source: string;
  try {
    source = await readFile(abs, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EISDIR') {
      throw new SnippetIoError('not-found', `snippet "${slug}" does not exist`);
    }
    throw error;
  }
  return recordFor(slug, abs, parseSnippetSource(source, slug));
}

export interface InvalidSnippetFile {
  slug: string;
  /** Data-dir-relative path: 'snippet/<slug>.yaml'. */
  file: string;
  issues: SnippetIssue[];
  /** ISO mtime of the file. */
  lastModified: string;
}

/**
 * Every `snippet/*.yaml`, sorted by slug: valid ones as records, unreadable ones (bad YAML, schema violation,
 * name != file stem) in `invalid` with their issues. Other errors (I/O) are rethrown.
 */
export async function listSnippets(
  dataDir: string = resolveDataDir(),
): Promise<{ items: SnippetRecord[]; invalid: InvalidSnippetFile[] }> {
  const items: SnippetRecord[] = [];
  const invalid: InvalidSnippetFile[] = [];
  let names: string[];
  try {
    names = (await readdir(datasetDir('snippet', dataDir)))
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
      items.push(await readSnippet(slug, dataDir));
    } catch (error) {
      if (!(error instanceof SnippetIoError)) throw error;
      if (error.code === 'not-found') continue;
      const abs = snippetFile(slug, dataDir);
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

/** Creates snippet/<input.name>.yaml. Throws `invalid` (schema), `exists` (never overwrites). */
export async function createSnippet(
  input: unknown,
  dataDir: string = resolveDataDir(),
): Promise<SnippetRecord> {
  const parsed = parseSnippet(input);
  if (!parsed.ok) {
    throw new SnippetIoError('invalid', 'snippet does not match the schema', parsed.issues);
  }
  const snippet = parsed.snippet;
  const slug = snippet.name;
  const abs = snippetFile(slug, dataDir);
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    await writeFile(
      abs,
      withSchemaComment('snippet', serializeSnippet(snippet), resolveServerOrigin()),
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      throw new SnippetIoError('exists', `snippet "${slug}" already exists`);
    }
    throw error;
  }
  return recordFor(slug, abs, snippet);
}

/**
 * Replaces an existing snippet (PUT). The snippet must exist (`not-found`) and `input.name` must equal
 * `slug` (`name-mismatch`; names are immutable). Written atomically: temp file in the same dir, then rename.
 */
export async function writeSnippet(
  slug: string,
  input: unknown,
  dataDir: string = resolveDataDir(),
): Promise<SnippetRecord> {
  const abs = snippetFile(slug, dataDir);
  try {
    await stat(abs);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new SnippetIoError('not-found', `snippet "${slug}" does not exist`);
    }
    throw error;
  }
  const result = validateSnippet(input, slug);
  if (!result.ok) {
    throw new SnippetIoError(
      result.code,
      result.code === 'invalid'
        ? 'snippet does not match the schema'
        : `snippet name cannot be changed (expected "${slug}")`,
      result.issues,
    );
  }
  // Lists read `*.yaml` only, so the `.tmp` file is never listed.
  const tmp = `${abs}.${process.pid}.tmp`;
  try {
    await writeFile(
      tmp,
      withSchemaComment('snippet', serializeSnippet(result.snippet), resolveServerOrigin()),
      'utf8',
    );
    await rename(tmp, abs);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  return recordFor(slug, abs, result.snippet);
}

/** Deletes a snippet file; `not-found` if it does not exist. */
export async function deleteSnippet(
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<void> {
  const abs = snippetFile(slug, dataDir);
  try {
    await unlink(abs);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new SnippetIoError('not-found', `snippet "${slug}" does not exist`);
    }
    throw error;
  }
}
