// NODE: runtime read/write of data/context/<slug>.yaml. Contexts are ALWAYS read through this module
// (fs + zod) at request time, never through getCollection('context') (PLAN.md §A.2, runtime-mode rules).
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidName } from '../datasets/registry.ts';
import type { LinkableDatasetId } from '../datasets/registry.ts';
import { contextLinkSchema, contextSchema } from '../datasets/schemas.ts';
import type { ContextData } from '../datasets/schemas.ts';
import { withFileLock, writeFileAtomic } from './atomic-write.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { describeIssue, issuePath } from './findings.ts';
import type { PathIssue } from './findings.ts';
import { withSchemaComment } from './schema-comment.ts';
import { parseYaml, stringifyYaml } from './yaml.ts';

type ContextLinkInput = ContextData['links'][number];

export interface ContextRecord {
  slug: string;
  context: ContextData;
  /** ISO mtime of the file. */
  lastModified: string;
  /** Data-dir-relative path: 'context/<slug>.yaml'. */
  file: string;
}

/** path = zod issue path joined with '.', '' for the root. */
export interface Issue {
  path: string;
  message: string;
}

export class ContextIoError extends Error {
  /** `invalid-file`: the EXISTING file failed to parse / validate while a write needed it (append links). */
  code:
    | 'not-found'
    | 'exists'
    | 'invalid'
    | 'bad-slug'
    | 'name-mismatch'
    | 'parse'
    | 'invalid-file';
  issues: Issue[];
  constructor(code: ContextIoError['code'], message: string, issues: Issue[] = []) {
    super(message);
    this.name = 'ContextIoError';
    this.code = code;
    this.issues = issues;
  }
}

/** Absolute path of data/context/<slug>.yaml; throws `bad-slug` unless the slug is a valid entry name. */
export function contextFile(slug: string, dataDir: string = resolveDataDir()): string {
  if (!isValidName(slug)) {
    throw new ContextIoError(
      'bad-slug',
      `"${slug}" is not a valid context name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  return path.join(datasetDir('context', dataDir), `${slug}.yaml`);
}

const fileRel = (slug: string): string => `context/${slug}.yaml`;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function zodIssues(issues: readonly PathIssue[], root: unknown): Issue[] {
  return issues.map((i) => ({ path: issuePath(i.path), message: describeIssue(i, root ?? {}) }));
}

/** Validates an untrusted context document against `contextSchema` and requires `name === slug`. */
export function validateContext(
  input: unknown,
  slug: string,
):
  | { ok: true; context: ContextData }
  | { ok: false; issues: Issue[]; code: 'invalid' | 'name-mismatch' } {
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, issues: zodIssues(parsed.error.issues, input), code: 'invalid' };
  if (parsed.data.name !== slug) {
    return {
      ok: false,
      code: 'name-mismatch',
      issues: [
        { path: 'name', message: `name must equal "${slug}" (context names cannot be changed)` },
      ],
    };
  }
  return { ok: true, context: parsed.data };
}

function normalizeNotes(notes: string | undefined): string | undefined {
  if (notes === undefined) return undefined;
  const text = notes.replace(/\r\n?/g, '\n').trimEnd();
  return text.trim() === '' ? undefined : `${text}\n`;
}

/**
 * Deterministic YAML for a context: fixed key order name, description, tags (omitted when empty),
 * links[{dataset, slug, notes (omitted when blank)}]. Multi-line notes are written as literal blocks.
 */
export function serializeContext(c: ContextData): string {
  const doc: Record<string, unknown> = { name: c.name, description: c.description };
  if (c.tags.length > 0) doc.tags = c.tags;
  doc.links = c.links.map((link) => {
    const out: Record<string, unknown> = { dataset: link.dataset, slug: link.slug };
    const notes = normalizeNotes(link.notes);
    if (notes !== undefined) out.notes = notes;
    return out;
  });
  return stringifyYaml(doc);
}

async function recordFor(slug: string, abs: string, context: ContextData): Promise<ContextRecord> {
  const st = await stat(abs);
  return { slug, context, lastModified: st.mtime.toISOString(), file: fileRel(slug) };
}

function parseContextSource(source: string, slug: string): ContextData {
  let value: unknown;
  try {
    value = parseYaml(source);
  } catch (error) {
    throw new ContextIoError(
      'parse',
      `${fileRel(slug)}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`,
    );
  }
  const result = validateContext(value ?? {}, slug);
  if (!result.ok) {
    throw new ContextIoError(
      'invalid',
      `${fileRel(slug)} does not match the context schema`,
      result.issues,
    );
  }
  return result.context;
}

/** Reads one context. Throws `not-found`, `parse` (bad YAML) or `invalid` (schema / name != stem). */
export async function readContext(
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<ContextRecord> {
  const abs = contextFile(slug, dataDir);
  let source: string;
  try {
    source = await readFile(abs, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EISDIR') {
      throw new ContextIoError('not-found', `context "${slug}" does not exist`);
    }
    throw error;
  }
  return recordFor(slug, abs, parseContextSource(source, slug));
}

/** Every context, sorted by slug. Files that fail to parse/validate are reported in `errors`, not thrown. */
export async function listContexts(
  dataDir: string = resolveDataDir(),
): Promise<{ items: ContextRecord[]; errors: { file: string; message: string }[] }> {
  const items: ContextRecord[] = [];
  const errors: { file: string; message: string }[] = [];
  let names: string[];
  try {
    names = (await readdir(datasetDir('context', dataDir)))
      .filter((f) => f.endsWith('.yaml'))
      .sort();
  } catch {
    return { items, errors };
  }
  for (const name of names) {
    const slug = name.slice(0, -'.yaml'.length);
    try {
      items.push(await readContext(slug, dataDir));
    } catch (error) {
      const message =
        error instanceof ContextIoError && error.issues.length > 0
          ? `${error.message}: ${error.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')}`
          : error instanceof Error
            ? error.message
            : String(error);
      errors.push({ file: fileRel(slug), message });
    }
  }
  items.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { items, errors };
}

/** Creates context/<input.name>.yaml. Throws `invalid` (schema), `exists` (never overwrites). */
export async function createContext(
  input: unknown,
  dataDir: string = resolveDataDir(),
): Promise<ContextRecord> {
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContextIoError(
      'invalid',
      'context does not match the schema',
      zodIssues(parsed.error.issues, input),
    );
  }
  const context = parsed.data;
  const slug = context.name;
  const abs = contextFile(slug, dataDir);
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    await writeFile(abs, withSchemaComment('context', serializeContext(context)), {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      throw new ContextIoError('exists', `context "${slug}" already exists`);
    }
    throw error;
  }
  return recordFor(slug, abs, context);
}

/** The body of `writeContext`; the caller holds the file's lock. */
async function writeContextLocked(
  slug: string,
  input: unknown,
  dataDir: string,
): Promise<ContextRecord> {
  const abs = contextFile(slug, dataDir);
  let mode: number;
  try {
    mode = (await stat(abs)).mode;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new ContextIoError('not-found', `context "${slug}" does not exist`);
    }
    throw error;
  }
  const result = validateContext(input, slug);
  if (!result.ok) {
    throw new ContextIoError(
      result.code,
      result.code === 'invalid'
        ? 'context does not match the schema'
        : `context name cannot be changed (expected "${slug}")`,
      result.issues,
    );
  }
  await writeFileAtomic(abs, withSchemaComment('context', serializeContext(result.context)), mode);
  return recordFor(slug, abs, result.context);
}

/**
 * Replaces an existing context (PUT). The context must exist (`not-found`) and `input.name` must equal
 * `slug` (`name-mismatch`; names are immutable). Written atomically (atomic-write.ts: temp file in the same dir,
 * then rename) under the file's lock, so it never interleaves with an append of links.
 */
export async function writeContext(
  slug: string,
  input: unknown,
  dataDir: string = resolveDataDir(),
): Promise<ContextRecord> {
  const abs = contextFile(slug, dataDir);
  return withFileLock(abs, () => writeContextLocked(slug, input, dataDir));
}

export const APPEND_LINKS_MAX = 200;

export interface AppendedContextLinks {
  record: ContextRecord;
  /** `dataset/slug` keys appended, in request order. */
  added: string[];
  /** `dataset/slug` keys that were already linked (or repeated in the request) and left untouched. */
  skipped: string[];
}

function parseAppendBody(input: unknown): ContextLinkInput[] {
  const record =
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;
  if (record === null) {
    throw new ContextIoError('invalid', 'body must be a JSON object { links }', [
      { path: '', message: 'must be an object' },
    ]);
  }
  const issues: Issue[] = [];
  for (const key of Object.keys(record)) {
    if (key !== 'links') issues.push({ path: key, message: 'unexpected property' });
  }
  const links = record.links;
  if (!Array.isArray(links) || links.length < 1 || links.length > APPEND_LINKS_MAX) {
    issues.push({ path: 'links', message: `must be an array of 1 to ${APPEND_LINKS_MAX} links` });
  } else {
    links.forEach((item: unknown, index: number) => {
      const parsed = contextLinkSchema.safeParse(item);
      if (parsed.success) return;
      for (const issue of parsed.error.issues) {
        issues.push({
          path: ['links', String(index), ...issue.path.map(String)].join('.'),
          message: describeIssue(issue, item ?? {}),
        });
      }
    });
  }
  if (issues.length > 0) {
    throw new ContextIoError('invalid', 'request body is invalid', issues);
  }
  return (links as unknown[]).map((item) => contextLinkSchema.parse(item));
}

/**
 * Appends links to an existing context (POST /api/context/:slug/links). `input`: `{ links: [{dataset, slug,
 * notes?}] }`, 1..200. A target that is already linked (or repeated in the request) is skipped and its existing
 * link, notes included, is left as is; nothing is written when nothing is new. Throws `bad-slug`, `invalid`
 * (body, paths `links.N.*`), `not-found`, `invalid-file` (the existing file fails to parse / validate).
 */
export async function appendContextLinks(
  slug: string,
  input: unknown,
  dataDir: string = resolveDataDir(),
): Promise<AppendedContextLinks> {
  const abs = contextFile(slug, dataDir);
  const requested = parseAppendBody(input);
  return withFileLock(abs, async () => {
    let current: ContextRecord;
    try {
      current = await readContext(slug, dataDir);
    } catch (error) {
      if (error instanceof ContextIoError && (error.code === 'parse' || error.code === 'invalid')) {
        throw new ContextIoError('invalid-file', error.message, error.issues);
      }
      throw error;
    }
    const present = new Set(current.context.links.map((l) => `${l.dataset}/${l.slug}`));
    const links = [...current.context.links];
    const added: string[] = [];
    const skipped: string[] = [];
    for (const link of requested) {
      const key = `${link.dataset}/${link.slug}`;
      if (present.has(key)) {
        skipped.push(key);
        continue;
      }
      present.add(key);
      added.push(key);
      links.push(link);
    }
    if (added.length === 0) return { record: current, added, skipped };
    await writeContextLocked(slug, { ...current.context, links }, dataDir);
    // Re-read so the response shows the file as stored (notes are normalized when serialized).
    return { record: await readContext(slug, dataDir), added, skipped };
  });
}

/** Deletes a context file; `not-found` if it does not exist. */
export async function deleteContext(
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<void> {
  const abs = contextFile(slug, dataDir);
  try {
    await unlink(abs);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new ContextIoError('not-found', `context "${slug}" does not exist`);
    }
    throw error;
  }
}

/** Contexts that link to `dataset/slug`, in the given order, with the link's notes when non-blank. */
export function backRefs(
  contexts: readonly ContextRecord[],
  dataset: LinkableDatasetId,
  slug: string,
): { context: string; description: string; notes?: string }[] {
  const out: { context: string; description: string; notes?: string }[] = [];
  for (const record of contexts) {
    const link = record.context.links.find((l) => l.dataset === dataset && l.slug === slug);
    if (!link) continue;
    const ref: { context: string; description: string; notes?: string } = {
      context: record.slug,
      description: record.context.description,
    };
    if (link.notes !== undefined && link.notes.trim() !== '') ref.notes = link.notes;
    out.push(ref);
  }
  return out;
}
