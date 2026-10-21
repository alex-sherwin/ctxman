// NODE: clone an okf bundle into a NEW entry of the same dataset (plans/TIME_WIDTH_CLONE_SPEC.md §5;
// `POST /api/entry/<ds>/<slug>/clone`, the MCP `clone-entry` tool and the Clone… dialog of the detail menu).
// Every regular file and folder of `<ds>/<slug>/` is copied byte for byte into a dot-prefixed temp dir INSIDE the
// dataset dir; then only the listed frontmatter keys of the copy's `index.md` are rewritten by source range
// (frontmatter-patch.ts) and the result must pass the dataset schema; a `log.md` of the copy gets a dated line; and
// only then is the temp dir renamed to `<ds>/<name>/`. Any failure removes the temp dir: no half clone is ever
// visible. Symlinks are never followed nor copied (each is a warning), dot-prefixed names are skipped like
// everywhere else (walkFiles, freshness), nothing outside the source bundle is read, and an existing target is
// never replaced (409 `exists`).
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises';
import path from 'node:path';
import { type } from 'arktype';
import {
  datasetDef,
  entryUrl,
  isOkfDatasetId,
  isTimeTrackedDatasetId,
  isValidName,
  ISSUE_KEY_EXPECTED,
  ISSUE_KEY_PATTERN,
  NAME_MAX_LENGTH,
  OKF_DATASET_IDS,
  OKF_ENTRY_FILE,
} from '../datasets/registry.ts';
import type { OkfDatasetId } from '../datasets/registry.ts';
import { entryLinkSchema } from '../datasets/schemas.ts';
import { validate } from '../datasets/validate.ts';
import { withFileLock, writeFileAtomic } from './atomic-write.ts';
import type { Issue } from './context-io.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { appendLogEntry, validateDoc } from './doc-io.ts';
import { invalidateEntryIndex } from './entry-index.ts';
import {
  DESCRIPTION_MAX,
  EntryIoError,
  parseTags,
  schemaIssues,
  TITLE_MAX,
  toJsonSafe,
} from './entry-io.ts';
import { describeIssue, issuePath } from './findings.ts';
import type { Finding } from './findings.ts';
import { entryFileRelPath } from './freshness.ts';
import { patchFrontmatter } from './frontmatter-patch.ts';
import type { FrontmatterChanges } from './frontmatter-patch.ts';
import { maskMarkdownCode, parseFrontmatter, splitFrontmatter, validateOkfFile } from './okf.ts';
import { cloneTitle } from './names.ts';
import { linkText, NAME_HELP, titleFromName } from './templates.ts';

/**
 * The request body (strict: an unknown key is a 400). An omitted key gets what the Clone… dialog prefills: `title`
 * "<original title> (copy)" (blank or null = the name in sentence case, like a new entry), `state` the dataset's first
 * state (lifecycle datasets only; never the original's), `tags` the original's ([] = none), `issueKey` none (an issue
 * belongs to one entry). `links` (default true) keeps the entry's related / depends-on links, `children` (default false) its
 * child links (a project's children), `time` (default false; task, feature, bug, rca only) its `time` and `resolved`.
 * JSON-Schema-expressible (the MCP tool reuses the shape).
 */
export const cloneEntryBodySchema = type({
  '+': 'reject',
  name: 'string',
  'title?': 'string | null',
  description: 'string',
  'state?': 'string | null',
  'tags?': 'string[]',
  'issueKey?': 'string | null',
  'links?': 'boolean',
  'children?': 'boolean',
  'time?': 'boolean',
});

export type CloneEntryBody = typeof cloneEntryBodySchema.infer;

export interface ClonedEntry {
  dataset: OkfDatasetId;
  /** The new entry's name. */
  slug: string;
  /** Data-dir-relative posix path of its index.md: 'task/x/index.md'. */
  path: string;
  /** Page URL: '/task/x'. */
  url: string;
  /** Data-dir-relative posix paths of every file of the clone, sorted. */
  files: string[];
  /**
   * What was left out (`clone/symlink-skipped`, `clone/special-skipped`, `clone/self-link-dropped`), plus the
   * validator findings of the clone's index.md (`validateDoc`: okf and link rules, e.g. a dangling relation target).
   */
  warnings: Finding[];
}

export interface CloneOptions {
  dataDir?: string;
  now?: Date;
  /**
   * Test seam: runs after the clone is complete in its temp dir, right before it is moved into place. A throw
   * here must leave nothing behind; creating the target here must give 409 `exists`.
   */
  beforeRename?: (tempDir: string) => Promise<void>;
}

interface ParsedClone {
  name: string;
  /** undefined = omitted ("<original title> (copy)"), '' = blank (the name in sentence case). */
  title?: string;
  description: string;
  state?: string;
  /** undefined = omitted: the original's tags stay. */
  tags?: string[];
  issueKey?: string;
  links: boolean;
  children: boolean;
  time: boolean;
}

const oneLine = (value: string): string => value.replace(/\s*[\r\n]+\s*/g, ' ').trim();

function invalid(issues: Issue[]): EntryIoError {
  return new EntryIoError('invalid', 'request body is invalid', issues);
}

function parseCloneBody(dataset: OkfDatasetId, slug: string, body: unknown): ParsedClone {
  const parsed = validate(cloneEntryBodySchema, body);
  if (!parsed.success) {
    throw invalid(
      parsed.issues.map((issue) => ({
        path: issuePath(issue.path),
        message: describeIssue(issue, body ?? {}),
      })),
    );
  }
  const input = parsed.data;
  const def = datasetDef(dataset);
  const issues: Issue[] = [];

  let name = '';
  if (input.name === '') issues.push({ path: 'name', message: 'is required' });
  else if (input.name.length > NAME_MAX_LENGTH) {
    issues.push({ path: 'name', message: `at most ${NAME_MAX_LENGTH} characters` });
  } else if (!isValidName(input.name)) issues.push({ path: 'name', message: NAME_HELP });
  else name = input.name;

  const description = oneLine(input.description);
  if (description === '') issues.push({ path: 'description', message: 'is required' });
  else if (description.length > DESCRIPTION_MAX) {
    issues.push({ path: 'description', message: `at most ${DESCRIPTION_MAX} characters` });
  }

  const titleInput = input.title === undefined ? undefined : oneLine(input.title ?? '');
  if (titleInput !== undefined && titleInput.length > TITLE_MAX) {
    issues.push({ path: 'title', message: `at most ${TITLE_MAX} characters` });
  }

  let state: string | undefined;
  if (input.state !== undefined && input.state !== null) {
    if (def.states === undefined) {
      issues.push({ path: 'state', message: `${def.plural} have no lifecycle state` });
    } else if (!def.states.some((s) => s.id === input.state)) {
      issues.push({
        path: 'state',
        message: `must be one of: ${def.states.map((s) => s.id).join(', ')}`,
      });
    } else state = input.state;
  }
  state ??= def.states?.[0]?.id;

  const tags = input.tags === undefined ? undefined : (parseTags(input.tags, 'tags', issues) ?? []);

  const issueKey = input.issueKey?.trim() ?? '';
  if (issueKey !== '' && !ISSUE_KEY_PATTERN.test(issueKey)) {
    issues.push({ path: 'issueKey', message: `must be ${ISSUE_KEY_EXPECTED}` });
  }

  if (input.time !== undefined && !isTimeTrackedDatasetId(dataset)) {
    issues.push({ path: 'time', message: `${def.plural} have no time tracking` });
  }

  if (issues.length === 0 && name === slug) {
    throw new EntryIoError('exists', `${dataset} "${name}" already exists: it is the original`);
  }
  if (issues.length > 0) throw invalid(issues);
  return {
    name,
    ...(titleInput === undefined ? {} : { title: titleInput }),
    description,
    ...(state === undefined ? {} : { state }),
    ...(tags === undefined ? {} : { tags }),
    ...(issueKey === '' ? {} : { issueKey }),
    links: input.links ?? true,
    children: input.children ?? false,
    time: input.time ?? false,
  };
}

// ---------------------------------------------------------------- the copy

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isInside = (root: string, abs: string): boolean => {
  const rel = path.relative(root, abs);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

/** `constants.O_NOFOLLOW` where the OS has it (not on Windows: there the readdir type check is the guard). */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

interface CopyState {
  /** The realpath of the source bundle: every directory read must stay inside it. */
  realRoot: string;
  dataset: OkfDatasetId;
  slug: string;
  files: string[];
  warnings: Finding[];
}

/** Bytes read and written at a time: big files are copied without holding them in memory. */
const COPY_CHUNK = 256 * 1024;

/** Copies one regular file without following a symlink (`O_NOFOLLOW`), keeping its permission bits. */
async function copyRegularFile(src: string, dst: string): Promise<boolean> {
  const input = await open(src, constants.O_RDONLY | NO_FOLLOW);
  try {
    const st = await input.stat();
    if (!st.isFile()) return false;
    const output = await open(dst, 'wx', 0o600);
    try {
      const chunk = Buffer.allocUnsafe(COPY_CHUNK);
      for (let position = 0; ;) {
        const { bytesRead } = await input.read(chunk, 0, COPY_CHUNK, position);
        if (bytesRead === 0) break;
        for (let done = 0; done < bytesRead;) {
          done += (await output.write(chunk, done, bytesRead - done)).bytesWritten;
        }
        position += bytesRead;
      }
    } finally {
      await output.close();
    }
    await chmod(dst, st.mode & 0o777);
    return true;
  } finally {
    await input.close();
  }
}

/**
 * Copies the regular files and folders of `srcDir` (relative path `rel` inside the bundle) into `dstDir`, which
 * exists. Symlinks and special files become warnings; dot-prefixed names are skipped; a directory is entered only
 * when it is a real directory whose realpath is inside the source bundle.
 */
async function copyTree(
  srcDir: string,
  dstDir: string,
  rel: string,
  state: CopyState,
): Promise<void> {
  const real = await realpath(srcDir);
  if (real !== state.realRoot && !isInside(state.realRoot, real)) {
    throw new Error(`${rel} resolves outside ${state.dataset}/${state.slug}`);
  }
  const dirents = await readdir(srcDir, { withFileTypes: true });
  dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue;
    const childRel = rel === '' ? dirent.name : `${rel}/${dirent.name}`;
    const file = `${state.dataset}/${state.slug}/${childRel}`;
    const src = path.join(srcDir, dirent.name);
    const dst = path.join(dstDir, dirent.name);
    if (dirent.isSymbolicLink()) {
      state.warnings.push({
        severity: 'warning',
        rule: 'clone/symlink-skipped',
        file,
        message: `${childRel} is a symbolic link: not copied (a clone copies regular files and folders only)`,
      });
    } else if (dirent.isDirectory()) {
      await mkdir(dst);
      await copyTree(src, dst, childRel, state);
    } else if (dirent.isFile() && (await copyRegularFile(src, dst))) {
      state.files.push(childRel);
    } else {
      state.warnings.push({
        severity: 'warning',
        rule: 'clone/special-skipped',
        file,
        message: `${childRel} is not a regular file: not copied`,
      });
    }
  }
}

// ---------------------------------------------------------------- the index.md rewrite

/** The links of the frontmatter in canonical form (rel defaulted); an item that does not parse is kept as is. */
function canonicalLinks(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const parsed = validate(entryLinkSchema, item);
    return parsed.success
      ? { dataset: parsed.data.dataset, slug: parsed.data.slug, rel: parsed.data.rel }
      : item;
  });
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The ATX `# heading` text of a line (closing hashes dropped), or null when it is not a level-1 heading. */
function h1Text(line: string): string | null {
  const match = /^ {0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*\r?$/.exec(line);
  return match ? (match[1] ?? '') : null;
}

/**
 * `source` with the FIRST level-1 ATX heading of its body (outside code, after the frontmatter) set to `# to`, but
 * only when that heading reads exactly one of `from` (the original's title as the template wrote it); every other byte
 * stays, the heading's line ending too. Text without such a heading is returned unchanged. PURE.
 */
export function retitleBody(source: string, from: readonly string[], to: string): string {
  const split = splitFrontmatter(source);
  const bodyStart = split === null ? 0 : split.bodyLine - 1;
  const lines = source.split('\n');
  const masked = maskMarkdownCode(source).split('\n');
  for (let i = bodyStart; i < masked.length; i++) {
    const text = h1Text(masked[i] ?? '');
    if (text === null) continue;
    if (!from.includes(text) || text === to) return source;
    const cr = (lines[i] ?? '').endsWith('\r') ? '\r' : '';
    lines[i] = `# ${to}${cr}`;
    return lines.join('\n');
  }
  return source;
}

interface Rewrite {
  source: string;
  dropped: Finding[];
}

/**
 * The clone's index.md: name, title, description, state (lifecycle datasets), tags, issueKey (removed when empty),
 * links (filtered by the options; a link to the clone itself is dropped), time + resolved (removed unless `time`),
 * modified (removed) set by source range, only where the value differs; then the body's first heading follows the
 * title (`retitleBody`). Everything else stays byte for byte.
 */
function rewriteIndex(
  dataset: OkfDatasetId,
  slug: string,
  input: ParsedClone,
  source: string,
  data: Record<string, unknown>,
): Rewrite {
  const current = toJsonSafe(data) as Record<string, unknown>;
  const oldTitle = typeof data.title === 'string' && data.title.trim() !== '' ? data.title : null;
  const title =
    input.title === undefined
      ? cloneTitle(oldTitle ?? titleFromName(slug))
      : input.title === ''
        ? titleFromName(input.name)
        : input.title;
  const wanted: Record<string, unknown> = {
    name: input.name,
    title,
    description: input.description,
  };
  if (datasetDef(dataset).states !== undefined) wanted.state = input.state;
  wanted.issueKey = input.issueKey;

  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(wanted)) {
    if (!sameJson(current[key], value)) changes[key] = value;
  }
  const currentTags = Array.isArray(current.tags) ? current.tags : [];
  if (
    input.tags !== undefined &&
    (!sameJson(currentTags, input.tags) ||
      (current.tags !== undefined && !Array.isArray(current.tags)))
  ) {
    changes.tags = input.tags;
  }

  const dropped: Finding[] = [];
  const links = canonicalLinks(current.links).filter((link) => {
    const child = isRecord(link) && link.rel === 'child';
    if (child ? !input.children : !input.links) return false;
    if (isRecord(link) && link.dataset === dataset && link.slug === input.name) {
      dropped.push({
        severity: 'warning',
        rule: 'clone/self-link-dropped',
        file: `${dataset}/${input.name}/${OKF_ENTRY_FILE}`,
        message: `the link to ${dataset}/${input.name} would point at the clone itself: dropped`,
      });
      return false;
    }
    return true;
  });
  if (!sameJson(canonicalLinks(current.links), links)) {
    changes.links = links.length === 0 ? undefined : links;
  }

  if (isTimeTrackedDatasetId(dataset) && !input.time) {
    if (current.time !== undefined) changes.time = undefined;
    if (current.resolved !== undefined) changes.resolved = undefined;
  }
  if (current.modified !== undefined) changes.modified = undefined;

  const patched = patchFrontmatter(source, changes as FrontmatterChanges);
  if (!patched.ok) {
    throw new EntryIoError(
      'invalid-file',
      `${dataset}/${slug}/${OKF_ENTRY_FILE}: ${patched.error}`,
      [{ path: '', message: patched.error }],
    );
  }
  const oldTitles = oldTitle !== null ? [oldTitle] : [titleFromName(slug), slug];
  return { source: retitleBody(patched.source, oldTitles, title), dropped };
}

/** Schema problems of the rewritten index.md (+ the stale_after format rule, like a PATCH); [] = valid. */
function rewrittenProblems(dataset: OkfDatasetId, name: string, source: string): Issue[] {
  const reparsed = parseFrontmatter(source);
  if (!reparsed.ok) return [{ path: '', message: reparsed.error }];
  const problems = schemaIssues(dataset, name, reparsed.doc.data);
  for (const finding of validateOkfFile({
    dataset,
    bundle: name,
    relPath: OKF_ENTRY_FILE,
    source,
    file: `${dataset}/${name}/${OKF_ENTRY_FILE}`,
  })) {
    if (finding.rule === 'okf/stale-after-format') {
      problems.push({ path: 'stale_after', message: finding.message });
    }
  }
  return problems;
}

// ---------------------------------------------------------------- moving into place

const TARGET_TAKEN = new Set(['EEXIST', 'ENOTEMPTY', 'ENOTDIR']);

/**
 * Renames the finished temp dir to `target` without ever replacing something that is there. POSIX `rename` silently
 * replaces an EMPTY directory, so the name is first reserved with `mkdir` (EEXIST when anything is there) and the
 * rename then replaces only that reservation (ENOTEMPTY / EEXIST when something was written into it meanwhile; it is
 * left alone). On Windows a directory rename never replaces an existing one (EPERM / EEXIST), so it goes direct.
 */
async function moveIntoPlace(
  temp: string,
  target: string,
  taken: () => EntryIoError,
): Promise<void> {
  const reserve = process.platform !== 'win32';
  if (reserve) {
    try {
      await mkdir(target);
    } catch (error) {
      throw TARGET_TAKEN.has((error as NodeJS.ErrnoException).code ?? '') ? taken() : error;
    }
  } else if ((await lstat(target).catch(() => null)) !== null) {
    throw taken();
  }
  try {
    await rename(temp, target);
  } catch (error) {
    if (reserve) await rmdir(target).catch(() => undefined); // only when it is still our empty reservation
    const code = (error as NodeJS.ErrnoException).code ?? '';
    throw TARGET_TAKEN.has(code) || (!reserve && code === 'EPERM') ? taken() : error;
  }
}

// ---------------------------------------------------------------- clone

/**
 * Clones the okf entry `<dataset>/<slug>` into the NEW entry `body.name` of the same dataset (see the module header
 * and `cloneEntryBodySchema` for the body). Throws EntryIoError: `bad-dataset` (not an okf dataset), `bad-slug`,
 * `invalid` (body issues, or the rewritten frontmatter fails the schema: nothing is written), `not-found` (no such
 * entry, a symlinked bundle dir or no index.md), `exists` (the target name is taken), `invalid-file` (the source
 * index.md is a symlink or its frontmatter does not parse). Any other failure (an unreadable file) is rethrown after
 * the temp dir is removed.
 */
export async function cloneEntry(
  dataset: string,
  slug: string,
  body: unknown,
  options: CloneOptions = {},
): Promise<ClonedEntry> {
  const dataDir = options.dataDir ?? resolveDataDir();
  const now = options.now ?? new Date();
  if (!isOkfDatasetId(dataset)) {
    throw new EntryIoError(
      'bad-dataset',
      `only okf entries can be cloned (${OKF_DATASET_IDS.join(', ')}), not "${dataset}"`,
    );
  }
  if (!isValidName(slug)) {
    throw new EntryIoError(
      'bad-slug',
      `"${slug}" is not a valid entry name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  const input = parseCloneBody(dataset, slug, body);

  // The source: a real directory directly inside the dataset dir (a symlinked bundle is never followed).
  const root = datasetDir(dataset, dataDir);
  const sourceDir = path.join(root, slug);
  const notFound = (): EntryIoError =>
    new EntryIoError('not-found', `${dataset} entry "${slug}" does not exist`);
  let realRoot: string;
  try {
    if (!(await lstat(sourceDir)).isDirectory()) throw notFound();
    const realDataset = await realpath(root);
    realRoot = await realpath(sourceDir);
    if (path.dirname(realRoot) !== realDataset) throw notFound();
  } catch (error) {
    if (error instanceof EntryIoError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw notFound();
    throw error;
  }
  const sourceIndex = path.join(sourceDir, OKF_ENTRY_FILE);
  const indexStat = await lstat(sourceIndex).catch(() => null);
  if (indexStat === null) {
    throw new EntryIoError('not-found', `${dataset}/${slug} has no ${OKF_ENTRY_FILE}`);
  }
  if (!indexStat.isFile()) {
    throw new EntryIoError(
      'invalid-file',
      `${dataset}/${slug}/${OKF_ENTRY_FILE} is not a regular file (a symbolic link?): it cannot be cloned`,
    );
  }
  const frontmatterOf = (source: string): Record<string, unknown> => {
    const parsed = parseFrontmatter(source);
    if (parsed.ok) return parsed.doc.data;
    throw new EntryIoError(
      'invalid-file',
      `${dataset}/${slug}/${OKF_ENTRY_FILE}: ${parsed.error}`,
      [{ path: '', message: parsed.error }],
    );
  };
  // Fail fast on an unusable entry before anything is copied.
  frontmatterOf(await readFile(sourceIndex, 'utf8'));

  const target = path.join(root, input.name);
  const taken = (): EntryIoError =>
    new EntryIoError('exists', `${dataset} "${input.name}" already exists`);
  if ((await lstat(target).catch(() => null)) !== null) throw taken();

  const temp = path.join(
    root,
    `.${input.name}.clone-${process.pid}-${randomUUID().slice(0, 8)}.tmp`,
  );
  await mkdir(temp);
  const state: CopyState = { realRoot, dataset, slug, files: [], warnings: [] };
  let rewritten: Rewrite;
  try {
    await copyTree(sourceDir, temp, '', state);
    const indexAbs = path.join(temp, OKF_ENTRY_FILE);
    const copied = await readFile(indexAbs, 'utf8');
    const data = frontmatterOf(copied);
    rewritten = rewriteIndex(dataset, slug, input, copied, data);
    const problems = rewrittenProblems(dataset, input.name, rewritten.source);
    if (problems.length > 0) {
      throw new EntryIoError(
        'invalid',
        'the cloned frontmatter does not match the schema',
        problems,
      );
    }
    if (rewritten.source !== copied)
      await writeFileAtomic(indexAbs, rewritten.source, indexStat.mode);

    // A log.md of the clone (copied, never created) gets the dated line on top.
    if (state.files.includes('log.md')) {
      const logAbs = path.join(temp, 'log.md');
      const log = await readFile(logAbs, 'utf8');
      const title = typeof data.title === 'string' && data.title.trim() !== '' ? data.title : slug;
      const entry = `* **Create**: Cloned from [${linkText(title)}](ctxman:${dataset}/${slug}).`;
      const today = now.toISOString().slice(0, 10); // UTC, like the other log.md bookkeeping lines
      await writeFileAtomic(logAbs, appendLogEntry(log, today, entry), (await lstat(logAbs)).mode);
    }

    await options.beforeRename?.(temp);
    await withFileLock(target, () => moveIntoPlace(temp, target, taken));
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    invalidateEntryIndex(dataDir);
  }

  const warnings = [
    ...state.warnings,
    ...rewritten.dropped,
    ...validateDoc(dataset, input.name, OKF_ENTRY_FILE, rewritten.source, dataDir),
  ];
  return {
    dataset,
    slug: input.name,
    path: entryFileRelPath(dataset, input.name),
    url: entryUrl(dataset, input.name),
    files: state.files.map((rel) => `${dataset}/${input.name}/${rel}`).sort(),
    warnings,
  };
}
