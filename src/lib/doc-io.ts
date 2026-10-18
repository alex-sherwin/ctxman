// NODE: read / write ONE existing markdown file of an okf bundle or skill directory (round 2 doc API,
// plans/ROUND2_BACKEND_SPEC.md §A) and create a new concept file (round 3, plans/ROUND3_SPEC.md §D.3). Path safety
// is bundles.ts (`safeJoin` + `resolveBundleFile`); writes are atomic (atomic-write.ts: hidden temp file in the
// target's directory, then rename), serialized per file (`withFileLock`) and optimistically locked by mtime.
import { lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { docUrl, isOkfDatasetId, isValidName, OKF_DATASET_IDS } from '../datasets/registry.ts';
import type { OkfDatasetId } from '../datasets/registry.ts';
import { withFileLock, writeFileAtomic } from './atomic-write.ts';
import { MAX_TEXT_BYTES, normalizeBundlePath, resolveBundleFile, safeJoin } from './bundles.ts';
import type { Issue } from './context-io.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { invalidateEntryIndex } from './entry-index.ts';
import type { Finding } from './findings.ts';
import { checkFileLinks } from './links.ts';
import { classifyOkfPath, maskMarkdownCode, validateOkfFile } from './okf.ts';
import { validateSkillFile } from './skill-check.ts';
import { linkText } from './templates.ts';
import { stringifyYaml } from './yaml.ts';

export type DocDatasetId = OkfDatasetId | 'skill';

const DOC_DATASET_IDS: readonly DocDatasetId[] = [...OKF_DATASET_IDS, 'skill'];

/** okf datasets and `skill`: the datasets whose markdown files the doc API serves. */
export function isDocDatasetId(value: unknown): value is DocDatasetId {
  return value === 'skill' || isOkfDatasetId(value);
}

/** normalizeBundlePath (bundles.ts) whose last segment also ends with '.md' (case-sensitive); else null. */
export function normalizeDocPath(raw: string | undefined): string | null {
  const normalized = normalizeBundlePath(raw);
  return normalized !== null && normalized.endsWith('.md') ? normalized : null;
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
  /** validateDoc() findings; `file` is data-dir relative ('kb/foo/index.md'). */
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
    | 'exists'
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
 * Both then get the link findings of that one file (`checkFileLinks`: links/broken, links/escapes-bundle,
 * links/ctxman-invalid, links/ctxman-target and, for an okf entry index.md, the frontmatter relation checks), resolved
 * against `dataDir`.
 */
export function validateDoc(
  dataset: DocDatasetId,
  slug: string,
  relPath: string,
  source: string,
  dataDir: string = resolveDataDir(),
): Finding[] {
  const file = `${dataset}/${slug}/${relPath}`;
  try {
    const findings =
      dataset === 'skill'
        ? relPath === 'SKILL.md'
          ? validateSkillFile(source, slug, file)
          : []
        : validateOkfFile({ dataset, bundle: slug, relPath, source, file });
    return [...findings, ...checkFileLinks({ dataset, name: slug, relPath, source, dataDir })];
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

interface Target {
  dataset: DocDatasetId;
  slug: string;
  /** Bundle-relative posix path. */
  path: string;
  /** Absolute path of the file as addressed (symlinks NOT resolved): the key of its `withFileLock`. */
  abs: string;
}

/** Validates the address of a doc (no fs): `bad-dataset`, `bad-slug`, `bad-path`. */
function docTarget(
  dataset: string,
  slug: string,
  rawPath: string | undefined,
  dataDir: string,
): Target {
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
  const abs = safeJoin(path.join(datasetDir(dataset, dataDir), slug), relPath);
  if (abs === null)
    throw new DocIoError('bad-path', `"${relPath}" is not inside ${dataset}/${slug}`);
  return { dataset, slug, path: relPath, abs };
}

interface Located extends Target {
  file: Extract<Awaited<ReturnType<typeof resolveBundleFile>>, { ok: true }>;
}

/** The public part of a target: what a DocRecord carries. */
const identity = (t: Target): Pick<DocRecord, 'dataset' | 'slug' | 'path'> => ({
  dataset: t.dataset,
  slug: t.slug,
  path: t.path,
});

async function locate(target: Target, dataDir: string): Promise<Located> {
  const { dataset, slug, path: relPath } = target;
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
  return { ...target, file };
}

/** Reads one markdown file. Throws DocIoError (see the order of checks in the spec, §A.3). */
export async function readDoc(
  dataset: string,
  slug: string,
  rawPath: string | undefined,
  dataDir: string = resolveDataDir(),
): Promise<DocRecord> {
  const { file, ...located } = await locate(docTarget(dataset, slug, rawPath, dataDir), dataDir);
  const id = identity(located);
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
    warnings: validateDoc(id.dataset, id.slug, id.path, markdown, dataDir),
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
 * The text is written byte for byte as sent. Validator findings (the file's own rules plus its link problems) are
 * returned as `warnings`; they never block the save. Runs under the file's `withFileLock`, so it never
 * interleaves with a frontmatter PATCH of the same file.
 */
export async function writeDoc(
  dataset: string,
  slug: string,
  rawPath: string | undefined,
  body: unknown,
  dataDir: string = resolveDataDir(),
): Promise<DocRecord> {
  const target = docTarget(dataset, slug, rawPath, dataDir);
  return withFileLock(target.abs, async () => {
    const { file, ...located } = await locate(target, dataDir);
    const id = identity(located);
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

    // The temp file sits next to the REAL target, so a symlinked file inside the bundle stays a symlink (the
    // link target is replaced).
    await writeFileAtomic(file.realAbs, markdown, file.mode);
    invalidateEntryIndex(dataDir);

    const st = await stat(file.realAbs);
    return {
      ...id,
      markdown,
      lastModified: st.mtime.toISOString(),
      bytes: Buffer.byteLength(markdown),
      warnings: validateDoc(id.dataset, id.slug, id.path, markdown, dataDir),
    };
  });
}

// ---------------------------------------------------------------- create a concept (POST)

export interface DocCreated {
  dataset: OkfDatasetId;
  slug: string;
  /** Bundle-relative posix path of the new file. */
  path: string;
  /** Page URL of the new doc (`docUrl`). */
  url: string;
  /** ISO mtime of the new file. */
  lastModified: string;
  /** validateDoc() findings of the new file, plus a warning for each of index.md / log.md that could not be updated. */
  warnings: Finding[];
}

const oneLine = (value: string): string => value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

export const CONCEPT_TITLE_MAX = 200;
export const CONCEPT_TYPE_MAX = 100;
export const CONCEPT_DESCRIPTION_MAX = 1024;

function parseCreateBody(body: unknown): { title: string; type: string; description?: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new DocIoError('invalid', 'body must be a JSON object { title, type?, description? }', [
      { path: '', message: 'must be an object' },
    ]);
  }
  const record = body as Record<string, unknown>;
  const issues: Issue[] = [];
  const text = (key: string, max: number, required: boolean): string | undefined => {
    const value = record[key];
    if (value === undefined || value === null) {
      if (required) issues.push({ path: key, message: 'is required' });
      return undefined;
    }
    if (typeof value !== 'string') {
      issues.push({ path: key, message: 'must be a string' });
      return undefined;
    }
    const line = oneLine(value);
    if (line === '') {
      if (required) issues.push({ path: key, message: 'must not be blank' });
      return undefined;
    }
    if (line.length > max) {
      issues.push({ path: key, message: `must be at most ${max} characters` });
      return undefined;
    }
    return line;
  };
  const title = text('title', CONCEPT_TITLE_MAX, true);
  const type = text('type', CONCEPT_TYPE_MAX, false);
  const description = text('description', CONCEPT_DESCRIPTION_MAX, false);
  for (const key of Object.keys(record)) {
    if (key !== 'title' && key !== 'type' && key !== 'description') {
      issues.push({ path: key, message: 'unexpected property' });
    }
  }
  if (issues.length > 0 || title === undefined) {
    throw new DocIoError('invalid', 'request body is invalid', issues);
  }
  return description === undefined
    ? { title, type: type ?? 'Concept' }
    : { title, type: type ?? 'Concept', description };
}

const isInside = (root: string, candidate: string): boolean => {
  const rel = path.relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

/**
 * The nearest EXISTING ancestor directory of `abs` must resolve (symlinks followed) to somewhere inside the
 * bundle and be a directory, so creating the missing folders below it can never write outside the bundle.
 */
async function assertParentInsideBundle(
  realRoot: string,
  abs: string,
  relPath: string,
): Promise<void> {
  let dir = path.dirname(abs);
  for (;;) {
    let real: string;
    try {
      real = await realpath(dir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        const parent = path.dirname(dir);
        if (parent === dir)
          throw new DocIoError('bad-path', `"${relPath}" is not inside the entry`);
        dir = parent;
        continue;
      }
      if (code === 'ENOTDIR') {
        throw new DocIoError('bad-path', `"${relPath}" has a file where a folder is needed`);
      }
      throw error;
    }
    if (!isInside(realRoot, real)) {
      throw new DocIoError('bad-path', `"${relPath}" is not inside the entry`);
    }
    if (!(await stat(real)).isDirectory()) {
      throw new DocIoError('bad-path', `"${relPath}" has a file where a folder is needed`);
    }
    return;
  }
}

/** Markdown destination of a bundle path: percent-encoded per segment so spaces and parentheses cannot break the link. */
const destinationOf = (relPath: string): string =>
  relPath
    .split('/')
    .map((segment) => encodeURIComponent(segment).replaceAll('(', '%28').replaceAll(')', '%29'))
    .join('/');

/**
 * `index.md` text with the new concept listed under its `## Concepts` section (ATX heading, any case, outside code):
 * `* [title](/path) - description` after the section's last list item, using the section's own bullet character;
 * a section without a list gets the line after the heading and one blank line; without the heading, a
 * `## Concepts` section is appended. CRLF files get CRLF lines. Pure text in, text out.
 */
export function addConceptToIndex(
  source: string,
  concept: { title: string; path: string; description?: string },
): string {
  const crlf = source.includes('\r\n');
  const cr = crlf ? '\r' : '';
  const eol = crlf ? '\r\n' : '\n';
  const text = `[${linkText(concept.title)}](/${destinationOf(concept.path)}) - ${concept.description ?? concept.title}`;

  // Work on lines without the final empty element of a newline-terminated file; existing lines keep their `\r`.
  const lines = source.split('\n');
  const masked = maskMarkdownCode(source).split('\n');
  const terminated = lines.at(-1) === '';
  if (terminated) {
    lines.pop();
    masked.pop();
  }
  const isBlank = (line: string | undefined): boolean => line === undefined || line.trim() === '';
  const heading = masked.findIndex((line) => /^##[ \t]+concepts[ \t]*#*[ \t]*\r?$/i.test(line));

  if (heading === -1) {
    const body = source.replace(/(\r?\n)*$/, '');
    return `${body === '' ? '' : body + eol + eol}## Concepts${eol}${eol}* ${text}${eol}`;
  }

  // The section runs to the next `#` / `##` heading (deeper headings belong to it).
  let end = masked.length;
  for (let i = heading + 1; i < masked.length; i++) {
    if (/^#{1,2}[ \t]/.test(masked[i] ?? '')) {
      end = i;
      break;
    }
  }
  let bullet: string | null = null;
  let last = -1;
  for (let i = heading + 1; i < end; i++) {
    const m = /^\s*([*-]) /.exec(masked[i] ?? '');
    if (m) {
      bullet ??= m[1] ?? '*';
      last = i;
    }
  }

  if (last === -1) {
    // No list yet: heading, one blank line, the item (and a blank line before whatever follows it).
    const blankAfterHeading = heading + 1 < lines.length && isBlank(lines[heading + 1]);
    const at = blankAfterHeading ? heading + 2 : heading + 1;
    const insert = blankAfterHeading ? [] : [cr];
    insert.push(`* ${text}${cr}`);
    if (!isBlank(lines[at])) insert.push(cr);
    lines.splice(at, 0, ...insert);
  } else {
    // Continuation lines of the last item (indented, not a new item) stay attached to it.
    let after = last + 1;
    while (
      after < end &&
      /^\s+\S/.test(lines[after] ?? '') &&
      !/^\s*([*-]) /.test(masked[after] ?? '')
    ) {
      after++;
    }
    lines.splice(after, 0, `${bullet ?? '*'} ${text}${cr}`);
  }
  return lines.join('\n') + (terminated ? '\n' : '');
}

/**
 * `log.md` text with the line `entry` (a complete bullet such as `* **Create**: Created [t](/p.md).`) under
 * `today`'s `## YYYY-MM-DD` heading: right after it when it is the first `## ` heading, else a new dated section
 * before the first `## ` heading (appended when there is none). Pure text in, text out.
 */
export function appendLogEntry(source: string, today: string, entry: string): string {
  const crlf = source.includes('\r\n');
  const cr = crlf ? '\r' : '';
  const eol = crlf ? '\r\n' : '\n';
  const lines = source.split('\n');
  const masked = maskMarkdownCode(source).split('\n');
  const first = masked.findIndex((line) => /^##(?!#)[ \t]/.test(line));

  if (first === -1) {
    const body = source.replace(/(\r?\n)*$/, '');
    return `${body}${body === '' ? '' : eol + eol}## ${today}${eol}${entry}${eol}`;
  }
  const heading = (masked[first] ?? '').replace(/^##[ \t]+/, '').replace(/[ \t]*#*[ \t]*\r?$/, '');
  if (heading === today) {
    lines.splice(first + 1, 0, `${entry}${cr}`);
  } else {
    lines.splice(first, 0, `## ${today}${cr}`, `${entry}${cr}`, cr);
  }
  return lines.join('\n');
}

/**
 * `log.md` text with `* **Create**: Created [title](/path).` under today's `## YYYY-MM-DD` heading (see
 * `appendLogEntry`). Pure text in, text out.
 */
export function addCreateToLog(
  source: string,
  concept: { title: string; path: string },
  today: string,
): string {
  return appendLogEntry(
    source,
    today,
    `* **Create**: Created [${linkText(concept.title)}](/${destinationOf(concept.path)}).`,
  );
}

/** Reads, transforms and atomically rewrites an existing text file under its lock; false when it does not exist. */
async function updateExistingFile(
  abs: string,
  transform: (source: string) => string,
): Promise<boolean> {
  return withFileLock(abs, async () => {
    let real: string;
    let mode: number;
    let source: string;
    try {
      real = await realpath(abs);
      const st = await stat(real);
      if (!st.isFile()) return false;
      mode = st.mode;
      source = await readFile(real, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    const next = transform(source);
    if (next !== source) await writeFileAtomic(real, next, mode);
    return true;
  });
}

/**
 * Creates the NEW concept file `rawPath` in an okf bundle (never overwrites) and lists it in the bundle's root
 * `index.md` (`## Concepts`) and `log.md` (today, UTC) when those files exist. `body` is untrusted JSON:
 * `{ title, type?, description? }` (`type` defaults to `Concept`). The folders in the path are created inside the
 * bundle (symlinks are followed only while they stay inside it). Throws DocIoError: `bad-dataset` (not an okf
 * dataset), `bad-slug`, `bad-path` (not a concept path: the root index.md (the entry), nested index.md and log.md are reserved),
 * `invalid` (body), `not-found` (no such entry), `exists`.
 */
export async function createDoc(
  dataset: string,
  slug: string,
  rawPath: string | undefined,
  body: unknown,
  dataDir: string = resolveDataDir(),
  now: Date = new Date(),
): Promise<DocCreated> {
  if (!isOkfDatasetId(dataset)) {
    throw new DocIoError(
      'bad-dataset',
      `concepts can only be created in an okf dataset (${OKF_DATASET_IDS.join(', ')}), not "${dataset}"`,
    );
  }
  const target = docTarget(dataset, slug, rawPath, dataDir);
  if (classifyOkfPath(target.path) !== 'concept') {
    throw new DocIoError(
      'bad-path',
      `"${target.path}" is reserved; a concept is any other .md file (e.g. concepts/my-topic.md)`,
    );
  }
  const input = parseCreateBody(body);

  const root = path.join(datasetDir(dataset, dataDir), slug);
  let realRoot: string;
  try {
    realRoot = await realpath(root);
    if (!(await stat(realRoot)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new DocIoError('not-found', `${dataset} entry "${slug}" does not exist`);
  }

  const created = await withFileLock(target.abs, async () => {
    await assertParentInsideBundle(realRoot, target.abs, target.path);
    const existing = await lstat(target.abs).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    });
    if (existing !== null) {
      throw new DocIoError('exists', `${target.path} already exists in ${dataset}/${slug}`);
    }
    const frontmatter: Record<string, string> = { type: input.type, title: input.title };
    if (input.description !== undefined) frontmatter.description = input.description;
    const markdown = `---\n${stringifyYaml(frontmatter)}---\n\n# ${input.title}\n`;
    await mkdir(path.dirname(target.abs), { recursive: true });
    await writeFileAtomic(target.abs, markdown);
    return { markdown, lastModified: (await stat(target.abs)).mtime.toISOString() };
  });

  const warnings = validateDoc(dataset, slug, target.path, created.markdown, dataDir);
  const concept = {
    title: input.title,
    path: target.path,
    ...(input.description === undefined ? {} : { description: input.description }),
  };
  const bookkeeping: [string, (source: string) => string][] = [
    ['index.md', (source) => addConceptToIndex(source, concept)],
    ['log.md', (source) => addCreateToLog(source, concept, ymd(now))],
  ];
  for (const [name, transform] of bookkeeping) {
    try {
      await updateExistingFile(path.join(root, name), transform);
    } catch (error) {
      warnings.push({
        severity: 'warning',
        rule: 'doc/bookkeeping-failed',
        file: `${dataset}/${slug}/${name}`,
        message: `could not list the new concept in ${name}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  invalidateEntryIndex(dataDir);

  return {
    dataset,
    slug,
    path: target.path,
    url: docUrl(dataset, slug, target.path),
    lastModified: created.lastModified,
    warnings,
  };
}

export interface AppendedLog {
  /** Bundle-relative path: always 'log.md'. */
  path: 'log.md';
  /** `log.md` did not exist and was created. */
  created: boolean;
  /** The bullet that was added. */
  entry: string;
  /** The newest dated section as it is now (heading + bullets). */
  head: string;
  lastModified: string;
}

export const LOG_TEXT_MAX = 1000;

/** The newest dated section of a log: its first `## ` heading up to the next one (trimmed). */
function logHead(source: string): string {
  const lines = source.split('\n');
  const masked = maskMarkdownCode(source).split('\n');
  const start = masked.findIndex((line) => /^##(?!#)[ \t]/.test(line));
  if (start === -1) return '';
  let end = masked.findIndex((line, i) => i > start && /^##(?!#)[ \t]/.test(line));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join('\n').replace(/\r/g, '').trim();
}

/**
 * Adds `text` (one line; newlines are collapsed) as a `* ` bullet under `today`'s `## YYYY-MM-DD` heading of the
 * bundle's `log.md` (see `appendLogEntry`); creates `log.md` (`# Update log` + the section) when it is missing.
 * Atomic and under the file's lock. Throws DocIoError: `bad-dataset`, `bad-slug`, `invalid` (empty / too long
 * text), `not-found` (no such entry), `bad-path` (`log.md` is a symlink out of the bundle or not a file).
 */
export async function appendLog(
  dataset: string,
  slug: string,
  text: string,
  today: string,
  dataDir: string = resolveDataDir(),
): Promise<AppendedLog> {
  if (!isOkfDatasetId(dataset)) {
    throw new DocIoError(
      'bad-dataset',
      `logs can only be appended in an okf dataset (${OKF_DATASET_IDS.join(', ')}), not "${dataset}"`,
    );
  }
  if (!isValidName(slug)) throw new DocIoError('bad-slug', `"${slug}" is not a valid entry name`);
  const line = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (line === '' || line.length > LOG_TEXT_MAX) {
    throw new DocIoError('invalid', 'request body is invalid', [
      { path: 'text', message: line === '' ? 'is required' : `at most ${LOG_TEXT_MAX} characters` },
    ]);
  }
  const root = path.join(datasetDir(dataset, dataDir), slug);
  try {
    if (!(await stat(root)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new DocIoError('not-found', `${dataset} entry "${slug}" does not exist`);
  }
  const abs = path.join(root, 'log.md');
  const entry = `* ${line}`;
  const result = await withFileLock(abs, async () => {
    const file = await resolveBundleFile(dataset, slug, 'log.md', dataDir);
    if (!file.ok) {
      if (file.reason !== 'not-found' || (await lstat(abs).catch(() => null)) !== null) {
        throw new DocIoError('bad-path', 'log.md is not a regular file inside the bundle');
      }
      const next = appendLogEntry('# Update log\n', today, entry);
      await writeFileAtomic(abs, next);
      return { created: true, next, mtime: (await stat(abs)).mtime };
    }
    const source = await readFile(file.realAbs, 'utf8');
    const next = appendLogEntry(source, today, entry);
    await writeFileAtomic(file.realAbs, next, file.mode);
    return { created: false, next, mtime: (await stat(file.realAbs)).mtime };
  });
  invalidateEntryIndex(dataDir);
  return {
    path: 'log.md',
    created: result.created,
    entry,
    head: logHead(result.next),
    lastModified: result.mtime.toISOString(),
  };
}
