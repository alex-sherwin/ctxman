// NODE: read / write ONE existing markdown file of an okf bundle or skill directory (round 2 doc API,
// plans/ROUND2_BACKEND_SPEC.md §A). Path safety is bundles.ts (`safeJoin` + `resolveBundleFile`); writes are
// atomic (hidden temp file in the target's directory, then rename) and optimistically locked by mtime.
import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isOkfDatasetId, isValidName, OKF_DATASET_IDS } from '../datasets/registry.ts';
import type { OkfDatasetId } from '../datasets/registry.ts';
import { MAX_TEXT_BYTES, resolveBundleFile } from './bundles.ts';
import type { Issue } from './context-io.ts';
import { resolveDataDir } from './data-dir.ts';
import type { Finding } from './findings.ts';
import { validateOkfFile } from './okf.ts';
import { validateSkillFile } from './skill-check.ts';

export type DocDatasetId = OkfDatasetId | 'skill';

const DOC_DATASET_IDS: readonly DocDatasetId[] = [...OKF_DATASET_IDS, 'skill'];

/** okf datasets and `skill`: the datasets whose markdown files the doc API serves. */
export function isDocDatasetId(value: unknown): value is DocDatasetId {
  return value === 'skill' || isOkfDatasetId(value);
}

const MAX_PATH_LENGTH = 512;

/**
 * Canonical bundle-relative posix path or null: non-empty, no '\\', no NUL, no leading '/', no empty / '.' /
 * '..' segment, no segment starting with '.', last segment ends with '.md' (case-sensitive), length <= 512.
 */
export function normalizeDocPath(raw: string | undefined): string | null {
  if (raw === undefined || raw === '' || raw.length > MAX_PATH_LENGTH) return null;
  if (raw.includes('\\') || raw.includes('\0') || raw.startsWith('/')) return null;
  const segments = raw.split('/');
  for (const segment of segments) {
    if (segment === '' || segment.startsWith('.')) return null;
  }
  if (!raw.endsWith('.md')) return null;
  return segments.join('/');
}

export interface DocRecord {
  dataset: DocDatasetId;
  slug: string;
  /** Bundle-relative posix, e.g. 'concepts/search.md'. */
  path: string;
  markdown: string;
  /** ISO mtime (ms precision) after the read / write. */
  lastModified: string;
  /** UTF-8 byte length of `markdown`. */
  bytes: number;
  /** validateDoc() findings; `file` is data-dir relative ('kb/foo/main.md'). */
  warnings: Finding[];
}

export class DocIoError extends Error {
  code:
    | 'bad-dataset'
    | 'bad-slug'
    | 'bad-path'
    | 'not-found'
    | 'too-large'
    | 'not-text'
    | 'conflict'
    | 'invalid';
  /** For `invalid`: what is wrong with the request body. */
  issues: Issue[];
  /** For `conflict`: the file's CURRENT mtime (ISO). */
  lastModified?: string;
  constructor(code: DocIoError['code'], message: string, issues: Issue[] = []) {
    super(message);
    this.name = 'DocIoError';
    this.code = code;
    this.issues = issues;
  }
}

/**
 * Findings for `source` as if it were saved at <dataset>/<slug>/<relPath>. Never throws.
 * okf: validateOkfFile (all severities); skill + 'SKILL.md': validateSkillFile; other skill files: [].
 */
export function validateDoc(
  dataset: DocDatasetId,
  slug: string,
  relPath: string,
  source: string,
): Finding[] {
  const file = `${dataset}/${slug}/${relPath}`;
  try {
    if (dataset === 'skill')
      return relPath === 'SKILL.md' ? validateSkillFile(source, slug, file) : [];
    return validateOkfFile({ dataset, bundle: slug, relPath, source, file });
  } catch (error) {
    return [
      {
        severity: 'warning',
        rule: 'doc/validation-failed',
        file,
        message: `could not validate: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
}

interface Located {
  dataset: DocDatasetId;
  slug: string;
  path: string;
  file: Extract<Awaited<ReturnType<typeof resolveBundleFile>>, { ok: true }>;
}

async function locate(
  dataset: string,
  slug: string,
  rawPath: string | undefined,
  dataDir: string,
): Promise<Located> {
  if (!isDocDatasetId(dataset)) {
    throw new DocIoError(
      'bad-dataset',
      `"${dataset}" has no editable markdown; use one of ${DOC_DATASET_IDS.join(', ')}`,
    );
  }
  if (!isValidName(slug)) {
    throw new DocIoError(
      'bad-slug',
      `"${slug}" is not a valid entry name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  const relPath = normalizeDocPath(rawPath);
  if (relPath === null) {
    throw new DocIoError(
      'bad-path',
      'path must be a relative posix path to a .md file inside the entry (no "..", no dot-prefixed segment)',
    );
  }
  const file = await resolveBundleFile(dataset, slug, relPath, dataDir);
  if (!file.ok) {
    switch (file.reason) {
      case 'bad-path':
      case 'outside':
        throw new DocIoError('bad-path', `"${relPath}" is not inside ${dataset}/${slug}`);
      case 'no-entry':
        throw new DocIoError('not-found', `${dataset} entry "${slug}" does not exist`);
      case 'not-found':
        throw new DocIoError('not-found', `${relPath} does not exist in ${dataset}/${slug}`);
    }
  }
  return { dataset, slug, path: relPath, file };
}

/** Reads one markdown file. Throws DocIoError (see the order of checks in the spec, §A.3). */
export async function readDoc(
  dataset: string,
  slug: string,
  rawPath: string | undefined,
  dataDir: string = resolveDataDir(),
): Promise<DocRecord> {
  const { file, ...id } = await locate(dataset, slug, rawPath, dataDir);
  if (file.size > MAX_TEXT_BYTES) {
    throw new DocIoError('too-large', `${id.path} is larger than ${MAX_TEXT_BYTES / 1024} KB`);
  }
  // The mtime was taken before the read: a write in between can only cause a false conflict later, never
  // a silently lost update.
  const buf = await readFile(file.realAbs);
  if (buf.length > MAX_TEXT_BYTES) {
    throw new DocIoError('too-large', `${id.path} is larger than ${MAX_TEXT_BYTES / 1024} KB`);
  }
  if (buf.includes(0)) throw new DocIoError('not-text', `${id.path} is not a text file`);
  const markdown = buf.toString('utf8');
  return {
    ...id,
    markdown,
    lastModified: file.mtime.toISOString(),
    bytes: Buffer.byteLength(markdown),
    warnings: validateDoc(id.dataset, id.slug, id.path, markdown),
  };
}

function parseWriteBody(body: unknown): { markdown: string; ifUnmodifiedSince?: string } {
  const issues: Issue[] = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new DocIoError('invalid', 'body must be a JSON object { markdown, ifUnmodifiedSince? }', [
      { path: '', message: 'must be an object' },
    ]);
  }
  const record = body as Record<string, unknown>;
  const { markdown, ifUnmodifiedSince } = record;
  if (typeof markdown !== 'string') issues.push({ path: 'markdown', message: 'must be a string' });
  if (
    ifUnmodifiedSince !== undefined &&
    (typeof ifUnmodifiedSince !== 'string' || Number.isNaN(Date.parse(ifUnmodifiedSince)))
  ) {
    issues.push({ path: 'ifUnmodifiedSince', message: 'must be an ISO date string' });
  }
  for (const key of Object.keys(record)) {
    if (key !== 'markdown' && key !== 'ifUnmodifiedSince') {
      issues.push({ path: key, message: 'unexpected property' });
    }
  }
  if (issues.length > 0 || typeof markdown !== 'string') {
    throw new DocIoError('invalid', 'request body is invalid', issues);
  }
  return typeof ifUnmodifiedSince === 'string' ? { markdown, ifUnmodifiedSince } : { markdown };
}

/**
 * Replaces the text of an EXISTING markdown file (no create). `body` is untrusted JSON:
 * `{ markdown: string, ifUnmodifiedSince?: string }` (no other keys). With `ifUnmodifiedSince` the file's
 * current mtime must EQUAL it (any change, not only a newer one, is a `conflict`); omitted = unconditional.
 * The text is written byte for byte as sent. Validator findings are returned as `warnings`; they never
 * block the save.
 */
export async function writeDoc(
  dataset: string,
  slug: string,
  rawPath: string | undefined,
  body: unknown,
  dataDir: string = resolveDataDir(),
): Promise<DocRecord> {
  const { file, ...id } = await locate(dataset, slug, rawPath, dataDir);
  const { markdown, ifUnmodifiedSince } = parseWriteBody(body);
  if (Buffer.byteLength(markdown) > MAX_TEXT_BYTES) {
    throw new DocIoError('too-large', `markdown is larger than ${MAX_TEXT_BYTES / 1024} KB`);
  }
  if (ifUnmodifiedSince !== undefined && file.mtime.getTime() !== Date.parse(ifUnmodifiedSince)) {
    const error = new DocIoError(
      'conflict',
      `${id.path} changed on disk since it was loaded (modified ${file.mtime.toISOString()})`,
    );
    error.lastModified = file.mtime.toISOString();
    throw error;
  }

  // Hidden (dot-prefixed) temp file next to the REAL target: globs, walkFiles and freshness ignore it, and
  // a symlinked file inside the bundle stays a symlink (the link target is replaced).
  const dir = path.dirname(file.realAbs);
  const tmp = path.join(
    dir,
    `.${path.basename(file.realAbs)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`,
  );
  try {
    await writeFile(tmp, markdown, { encoding: 'utf8', flag: 'wx' });
    await chmod(tmp, file.mode & 0o777);
    await rename(tmp, file.realAbs);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }

  const st = await stat(file.realAbs);
  return {
    ...id,
    markdown,
    lastModified: st.mtime.toISOString(),
    bytes: Buffer.byteLength(markdown),
    warnings: validateDoc(id.dataset, id.slug, id.path, markdown),
  };
}
