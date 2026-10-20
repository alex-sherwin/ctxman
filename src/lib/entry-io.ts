// NODE: the entry frontmatter API (plans/ROUND3_SPEC.md §D.1, §D.2): read an okf / skill entry's frontmatter, PATCH
// single top-level keys (state, title, description, tags, time, resolved, stale_after, status, links) and create a new entry from the
// shared templates. A PATCH edits the YAML by SOURCE RANGE (frontmatter-patch.ts: every other byte of the file stays
// as it was), runs under the file's `withFileLock`, is optimistically locked by mtime (`ifUnmodifiedSince`) and
// NEVER writes frontmatter that fails the dataset schema (400 `invalid`, nothing written).
import { lstat, readFile, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  datasetDef,
  entryUrl,
  isLinkableDatasetId,
  isOkfDatasetId,
  isTimeTrackedDatasetId,
  isValidName,
  NAME_MAX_LENGTH,
  OKF_DATASET_IDS,
  OKF_ENTRY_FILE,
} from '../datasets/registry.ts';
import type { LinkableDatasetId, OkfDatasetId } from '../datasets/registry.ts';
import { DATASET_SCHEMAS, entryLinkSchema, OKF_STATUSES } from '../datasets/schemas.ts';
import type { EntryLink } from '../datasets/schemas.ts';
import { validate } from '../datasets/validate.ts';
import { withFileLock, writeFileAtomic } from './atomic-write.ts';
import { resolveBundleFile } from './bundles.ts';
import type { Issue } from './context-io.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { invalidateEntryIndex } from './entry-index.ts';
import { EntryCreateError, writePlannedEntry } from './entry-create.ts';
import { describeIssue, issuePath } from './findings.ts';
import type { Finding } from './findings.ts';
import { entryFileRelPath } from './freshness.ts';
import { patchFrontmatter } from './frontmatter-patch.ts';
import type { FrontmatterChanges } from './frontmatter-patch.ts';
import {
  DATE_TIME_MESSAGE,
  DURATION_MESSAGE,
  isIsoDateTime,
  normalizeIsoDuration,
} from './iso8601.ts';
import { checkFileLinks } from './links.ts';
import { normalizeTag, TAG_PATTERN } from './names.ts';
import { parseFrontmatter, validateOkfFile } from './okf.ts';
import { NAME_HELP, planNewEntry } from './templates.ts';

/** The datasets the entry API serves: the okf bundles and skills. */
export type EntryDatasetId = OkfDatasetId | 'skill';

const ENTRY_DATASET_IDS: readonly EntryDatasetId[] = [...OKF_DATASET_IDS, 'skill'];

export function isEntryDatasetId(value: unknown): value is EntryDatasetId {
  return value === 'skill' || isOkfDatasetId(value);
}

export class EntryIoError extends Error {
  code:
    | 'bad-dataset'
    | 'bad-slug'
    | 'invalid'
    | 'not-found'
    | 'conflict'
    | 'invalid-file'
    | 'exists';
  /** For `invalid` / `invalid-file`: what is wrong (paths are body keys, or frontmatter keys for the schema). */
  issues: Issue[];
  /** For `conflict`: the file's CURRENT mtime (ISO). */
  lastModified?: string;
  constructor(code: EntryIoError['code'], message: string, issues: Issue[] = []) {
    super(message);
    this.name = 'EntryIoError';
    this.code = code;
    this.issues = issues;
  }
}

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 1024;
export const TAGS_MAX = 50;
export const LINKS_MAX = 500;
export const TIME_MAX = 500;

// ---------------------------------------------------------------- reading

/** JSON-safe copy of parsed frontmatter: a Date at 00:00:00.000Z becomes 'YYYY-MM-DD', any other Date its ISO string. */
export function toJsonSafe(value: unknown): unknown {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, toJsonSafe(v)]),
    );
  }
  return value;
}

export interface EntryRecord {
  /** JSON-safe frontmatter exactly as parsed from the file (no schema defaults). */
  frontmatter: Record<string, unknown>;
  /** ISO mtime of the entry file: the `ifUnmodifiedSince` base of a PATCH. */
  lastModified: string;
  /** Schema problems of the frontmatter (the file may be invalid and still be returned). */
  issues: Issue[];
}

interface LocatedEntry {
  dataset: EntryDatasetId;
  slug: string;
  entryFile: typeof OKF_ENTRY_FILE | 'SKILL.md';
  /** Lock key: the entry file as addressed (symlinks not resolved). */
  abs: string;
}

function locateEntry(dataset: string, slug: string, dataDir: string): LocatedEntry {
  if (!isEntryDatasetId(dataset)) {
    throw new EntryIoError(
      'bad-dataset',
      `"${dataset}" entries have no frontmatter API; use one of ${ENTRY_DATASET_IDS.join(', ')}`,
    );
  }
  if (!isValidName(slug)) {
    throw new EntryIoError(
      'bad-slug',
      `"${slug}" is not a valid entry name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  const entryFile = datasetDef(dataset).entryFile === 'SKILL.md' ? 'SKILL.md' : OKF_ENTRY_FILE;
  return {
    dataset,
    slug,
    entryFile,
    abs: path.resolve(datasetDir(dataset, dataDir), slug, entryFile),
  };
}

interface EntryFile {
  realAbs: string;
  mtime: Date;
  mode: number;
  source: string;
}

async function readEntryFile(located: LocatedEntry, dataDir: string): Promise<EntryFile> {
  const { dataset, slug, entryFile } = located;
  const file = await resolveBundleFile(dataset, slug, entryFile, dataDir);
  if (!file.ok) {
    throw new EntryIoError(
      'not-found',
      file.reason === 'no-entry'
        ? `${dataset} entry "${slug}" does not exist`
        : `${dataset}/${slug}/${entryFile} does not exist`,
    );
  }
  // The mtime was taken before the read: a write in between can only cause a false conflict later.
  const source = await readFile(file.realAbs, 'utf8');
  return { realAbs: file.realAbs, mtime: file.mtime, mode: file.mode, source };
}

function parseEntryFrontmatter(source: string, located: LocatedEntry): Record<string, unknown> {
  const parsed = parseFrontmatter(source);
  if (!parsed.ok) {
    throw new EntryIoError(
      'invalid-file',
      `${located.dataset}/${located.slug}/${located.entryFile}: ${parsed.error}`,
      [{ path: '', message: parsed.error }],
    );
  }
  return parsed.doc.data;
}

/** Schema problems of parsed frontmatter, plus `name` must equal the directory name. */
function schemaIssues(
  dataset: EntryDatasetId,
  slug: string,
  data: Record<string, unknown>,
): Issue[] {
  const issues: Issue[] = [];
  const result = validate(DATASET_SCHEMAS[dataset], data);
  if (!result.success) {
    for (const issue of result.issues) {
      issues.push({ path: issuePath(issue.path), message: describeIssue(issue, data) });
    }
  }
  if (typeof data.name === 'string' && data.name !== slug) {
    issues.push({
      path: 'name',
      message: `name "${data.name}" must equal the directory name "${slug}"`,
    });
  }
  return issues;
}

/**
 * Reads one entry's frontmatter (GET). Throws EntryIoError: `bad-dataset`, `bad-slug`, `not-found`, `invalid-file`
 * (no frontmatter / unparseable YAML / not a mapping). Schema problems do not throw: they come back as `issues`.
 */
export async function readEntry(
  dataset: string,
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<EntryRecord> {
  const located = locateEntry(dataset, slug, dataDir);
  const file = await readEntryFile(located, dataDir);
  const data = parseEntryFrontmatter(file.source, located);
  return {
    frontmatter: toJsonSafe(data) as Record<string, unknown>,
    lastModified: file.mtime.toISOString(),
    issues: schemaIssues(located.dataset, located.slug, data),
  };
}

// ---------------------------------------------------------------- PATCH body

const oneLine = (value: string): string => value.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/** `YYYY-MM-DD` that is a real calendar date. */
function isRealYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const PATCH_KEYS = [
  'state',
  'title',
  'description',
  'tags',
  'time',
  'resolved',
  'stale_after',
  'status',
  'links',
  'addLinks',
  'removeLinks',
] as const;

interface ParsedPatch {
  /** Scalar keys: undefined = delete. */
  set: Record<string, unknown>;
  /** Full replacement of `links`. */
  links?: EntryLink[];
  addLinks?: EntryLink[];
  removeLinks?: { dataset: LinkableDatasetId; slug: string }[];
  ifUnmodifiedSince?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validates `tags` input: normalized, pattern-checked, deduplicated (order kept). Pushes issues under `key`. */
function parseTags(value: unknown, key: string, issues: Issue[]): string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path: key, message: 'must be an array of strings' });
    return undefined;
  }
  if (value.length > TAGS_MAX) {
    issues.push({ path: key, message: `at most ${TAGS_MAX} tags` });
    return undefined;
  }
  const tags: string[] = [];
  let ok = true;
  value.forEach((raw, index) => {
    if (typeof raw !== 'string') {
      issues.push({ path: `${key}.${index}`, message: 'must be a string' });
      ok = false;
      return;
    }
    const tag = normalizeTag(raw);
    if (!TAG_PATTERN.test(tag)) {
      issues.push({
        path: `${key}.${index}`,
        message: `"${raw}" is not a valid tag (lowercase letters, digits and hyphens)`,
      });
      ok = false;
    } else if (!tags.includes(tag)) {
      tags.push(tag);
    }
  });
  return ok ? tags : undefined;
}

/** Validates `time` input: ISO 8601 durations, trimmed and upper-cased; repeats are kept (two sessions of PT1H). */
function parseTime(value: unknown, issues: Issue[]): string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path: 'time', message: 'must be an array of ISO 8601 durations (or null)' });
    return undefined;
  }
  if (value.length > TIME_MAX) {
    issues.push({ path: 'time', message: `at most ${TIME_MAX} durations` });
    return undefined;
  }
  const out: string[] = [];
  let ok = true;
  value.forEach((raw, index) => {
    const duration = typeof raw === 'string' ? normalizeIsoDuration(raw) : null;
    if (duration === null) {
      issues.push({
        path: `time.${index}`,
        message: `${JSON.stringify(raw)} is not ${DURATION_MESSAGE}`,
      });
      ok = false;
    } else {
      out.push(duration);
    }
  });
  return ok ? out : undefined;
}

/** Validates a list of `{dataset, slug, rel?}` (links, addLinks) or `{dataset, slug}` (removeLinks). */
function parseLinkList(
  value: unknown,
  key: string,
  self: { dataset: string; slug: string },
  issues: Issue[],
): EntryLink[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path: key, message: 'must be an array' });
    return undefined;
  }
  if (value.length > LINKS_MAX) {
    issues.push({ path: key, message: `at most ${LINKS_MAX} links` });
    return undefined;
  }
  const out: EntryLink[] = [];
  let ok = true;
  value.forEach((item, index) => {
    const parsed = validate(entryLinkSchema, item);
    if (!parsed.success) {
      for (const issue of parsed.issues) {
        issues.push({
          path: [key, String(index), ...issue.path.map(String)].join('.'),
          message: describeIssue(issue, item),
        });
      }
      ok = false;
      return;
    }
    if (parsed.data.dataset === self.dataset && parsed.data.slug === self.slug) {
      issues.push({ path: `${key}.${index}`, message: 'an entry cannot link to itself' });
      ok = false;
      return;
    }
    out.push(parsed.data);
  });
  return ok ? out : undefined;
}

function parsePatchBody(dataset: EntryDatasetId, slug: string, body: unknown): ParsedPatch {
  if (!isRecord(body)) {
    throw new EntryIoError('invalid', 'body must be a JSON object', [
      { path: '', message: 'must be an object' },
    ]);
  }
  const issues: Issue[] = [];
  const set: Record<string, unknown> = {};
  const out: ParsedPatch = { set };
  const def = datasetDef(dataset);
  const isSkill = dataset === 'skill';
  const okfOnly = (key: string): boolean => {
    if (!isSkill) return true;
    issues.push({ path: key, message: 'is not available for skills' });
    return false;
  };

  for (const key of Object.keys(body)) {
    if (key !== 'ifUnmodifiedSince' && !(PATCH_KEYS as readonly string[]).includes(key)) {
      issues.push({ path: key, message: 'unexpected property' });
    }
  }

  if (body.state !== undefined && okfOnly('state')) {
    if (def.states === undefined) {
      issues.push({ path: 'state', message: `${def.plural} have no lifecycle state` });
    } else if (typeof body.state !== 'string' || !def.states.some((s) => s.id === body.state)) {
      issues.push({
        path: 'state',
        message: `must be one of: ${def.states.map((s) => s.id).join(', ')}`,
      });
    } else {
      set.state = body.state;
    }
  }

  if (body.title !== undefined && okfOnly('title')) {
    if (body.title === null) {
      set.title = undefined;
    } else if (typeof body.title !== 'string') {
      issues.push({ path: 'title', message: 'must be a string or null' });
    } else {
      const title = oneLine(body.title);
      if (title.length > TITLE_MAX) {
        issues.push({ path: 'title', message: `at most ${TITLE_MAX} characters` });
      } else {
        set.title = title === '' ? undefined : title;
      }
    }
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || oneLine(body.description) === '') {
      issues.push({ path: 'description', message: 'must be a non-blank string' });
    } else if (oneLine(body.description).length > DESCRIPTION_MAX) {
      issues.push({ path: 'description', message: `at most ${DESCRIPTION_MAX} characters` });
    } else {
      set.description = oneLine(body.description);
    }
  }

  if (body.tags !== undefined && okfOnly('tags')) {
    const tags = parseTags(body.tags, 'tags', issues);
    if (tags !== undefined) set.tags = tags;
  }

  const timeTracked = (key: string): boolean => {
    if (!okfOnly(key)) return false;
    if (isTimeTrackedDatasetId(dataset)) return true;
    issues.push({ path: key, message: `${def.plural} have no time tracking` });
    return false;
  };

  if (body.time !== undefined && timeTracked('time')) {
    if (body.time === null) {
      set.time = undefined;
    } else {
      const time = parseTime(body.time, issues);
      // An emptied list drops the key.
      if (time !== undefined) set.time = time.length === 0 ? undefined : time;
    }
  }

  if (body.resolved !== undefined && timeTracked('resolved')) {
    const value = typeof body.resolved === 'string' ? body.resolved.trim() : body.resolved;
    if (value === null || value === '') {
      set.resolved = undefined;
    } else if (typeof value !== 'string' || !isIsoDateTime(value)) {
      issues.push({ path: 'resolved', message: `must be ${DATE_TIME_MESSAGE} (or null)` });
    } else {
      set.resolved = value;
    }
  }

  if (body.stale_after !== undefined && okfOnly('stale_after')) {
    const value = body.stale_after;
    if (value === null || value === '') {
      set.stale_after = undefined;
    } else if (typeof value !== 'string' || !isRealYmd(value)) {
      issues.push({ path: 'stale_after', message: 'must be a real date in YYYY-MM-DD form' });
    } else {
      set.stale_after = value;
    }
  }

  if (body.status !== undefined && okfOnly('status')) {
    if (body.status === null) {
      set.status = undefined;
    } else if (
      typeof body.status !== 'string' ||
      !(OKF_STATUSES as readonly string[]).includes(body.status)
    ) {
      issues.push({
        path: 'status',
        message: `must be one of: ${OKF_STATUSES.join(', ')} (or null)`,
      });
    } else {
      set.status = body.status;
    }
  }

  const self = { dataset, slug };
  const usesLinks = body.links !== undefined;
  const usesDelta = body.addLinks !== undefined || body.removeLinks !== undefined;
  if (usesLinks && usesDelta) {
    issues.push({ path: 'links', message: 'cannot be combined with addLinks / removeLinks' });
  } else {
    if (body.links !== undefined && okfOnly('links')) {
      const links = parseLinkList(body.links, 'links', self, issues);
      if (links !== undefined) out.links = links;
    }
    if (body.addLinks !== undefined && okfOnly('addLinks')) {
      const links = parseLinkList(body.addLinks, 'addLinks', self, issues);
      if (links !== undefined) out.addLinks = links;
    }
    if (body.removeLinks !== undefined && okfOnly('removeLinks')) {
      if (!Array.isArray(body.removeLinks)) {
        issues.push({ path: 'removeLinks', message: 'must be an array' });
      } else if (body.removeLinks.length > LINKS_MAX) {
        issues.push({ path: 'removeLinks', message: `at most ${LINKS_MAX} links` });
      } else {
        const removals: { dataset: LinkableDatasetId; slug: string }[] = [];
        body.removeLinks.forEach((item: unknown, index: number) => {
          if (
            !isRecord(item) ||
            !isLinkableDatasetId(item.dataset) ||
            typeof item.slug !== 'string' ||
            !isValidName(item.slug)
          ) {
            issues.push({
              path: `removeLinks.${index}`,
              message: 'must be { dataset, slug } of a linkable entry',
            });
          } else {
            removals.push({ dataset: item.dataset, slug: item.slug });
          }
        });
        out.removeLinks = removals;
      }
    }
  }

  if (body.ifUnmodifiedSince !== undefined) {
    if (
      typeof body.ifUnmodifiedSince !== 'string' ||
      Number.isNaN(Date.parse(body.ifUnmodifiedSince))
    ) {
      issues.push({ path: 'ifUnmodifiedSince', message: 'must be an ISO date string' });
    } else {
      out.ifUnmodifiedSince = body.ifUnmodifiedSince;
    }
  }

  const hasPatchKey = Object.keys(body).some((key) =>
    (PATCH_KEYS as readonly string[]).includes(key),
  );
  if (issues.length === 0 && !hasPatchKey) {
    issues.push({ path: '', message: `give at least one of: ${PATCH_KEYS.join(', ')}` });
  }
  if (issues.length > 0) throw new EntryIoError('invalid', 'request body is invalid', issues);
  return out;
}

// ---------------------------------------------------------------- PATCH

export interface PatchedEntry {
  /** JSON-safe frontmatter of the file after the patch. */
  frontmatter: Record<string, unknown>;
  /** ISO mtime of the entry file after the patch (unchanged when `changed` is false). */
  lastModified: string;
  /** false = the patch equalled the current frontmatter and nothing was written. */
  changed: boolean;
  /** `links/relation-target` findings of the file as it is now. */
  warnings: Finding[];
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The links of the current frontmatter in canonical form; an item that does not parse is kept as is (and fails validation later). */
function currentLinks(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const parsed = validate(entryLinkSchema, item);
    return parsed.success ? parsed.data : item;
  });
}

/** Link array → canonical objects with key order dataset, slug, rel. */
const canonicalLink = (link: EntryLink): EntryLink => ({
  dataset: link.dataset,
  slug: link.slug,
  rel: link.rel,
});

function relationWarnings(located: LocatedEntry, source: string, dataDir: string): Finding[] {
  if (located.dataset === 'skill') return [];
  return checkFileLinks({
    dataset: located.dataset,
    name: located.slug,
    relPath: OKF_ENTRY_FILE,
    source,
    dataDir,
  }).filter((f) => f.rule === 'links/relation-target');
}

/**
 * PATCHes the frontmatter of an existing entry. `body` is untrusted JSON (see D.1: state, title, description, tags,
 * time + resolved (task, feature, bug, rca), stale_after, status, links | addLinks + removeLinks, ifUnmodifiedSince). Only the given keys are edited, by source
 * range; a patch that equals the current values writes nothing (`changed: false`). The patched frontmatter must pass
 * the dataset schema (+ `name` == directory, + the stale_after format rule) or nothing is written (`invalid`).
 * Throws EntryIoError: `bad-dataset`, `bad-slug`, `invalid`, `not-found`, `conflict`, `invalid-file`.
 */
export async function patchEntry(
  dataset: string,
  slug: string,
  body: unknown,
  dataDir: string = resolveDataDir(),
): Promise<PatchedEntry> {
  const located = locateEntry(dataset, slug, dataDir);
  const patch = parsePatchBody(located.dataset, located.slug, body);
  return withFileLock(located.abs, async () => {
    const file = await readEntryFile(located, dataDir);
    const lastModified = file.mtime.toISOString();
    if (
      patch.ifUnmodifiedSince !== undefined &&
      file.mtime.getTime() !== Date.parse(patch.ifUnmodifiedSince)
    ) {
      const error = new EntryIoError(
        'conflict',
        `${located.entryFile} changed on disk since it was loaded (modified ${lastModified})`,
      );
      error.lastModified = lastModified;
      throw error;
    }

    const data = parseEntryFrontmatter(file.source, located);
    const current = toJsonSafe(data) as Record<string, unknown>;

    // What actually differs from the file, as YAML-ready values (undefined = delete the key).
    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch.set)) {
      if (!sameJson(current[key], value)) changes[key] = value;
    }
    if (
      patch.links !== undefined ||
      patch.addLinks !== undefined ||
      patch.removeLinks !== undefined
    ) {
      let next: unknown[];
      if (patch.links !== undefined) {
        next = patch.links.map(canonicalLink);
      } else {
        next = currentLinks(current.links);
        for (const link of patch.addLinks ?? []) {
          const at = next.findIndex(
            (item) => isRecord(item) && item.dataset === link.dataset && item.slug === link.slug,
          );
          if (at === -1) next.push(canonicalLink(link));
          else next[at] = canonicalLink(link);
        }
        for (const gone of patch.removeLinks ?? []) {
          next = next.filter(
            (item) => !(isRecord(item) && item.dataset === gone.dataset && item.slug === gone.slug),
          );
        }
      }
      // A full replacement by [] also drops an existing (empty) `links:` key.
      const dropsKey =
        patch.links !== undefined && next.length === 0 && current.links !== undefined;
      if (!sameJson(currentLinks(current.links), next) || dropsKey) {
        changes.links = next.length === 0 ? undefined : next;
      }
    }

    if (Object.keys(changes).length === 0) {
      return {
        frontmatter: current,
        lastModified,
        changed: false,
        warnings: relationWarnings(located, file.source, dataDir),
      };
    }

    const patched = patchFrontmatter(file.source, changes as FrontmatterChanges);
    if (!patched.ok) {
      throw new EntryIoError(
        'invalid-file',
        `${located.dataset}/${located.slug}/${located.entryFile}: ${patched.error}`,
        [{ path: '', message: patched.error }],
      );
    }

    // Validate what would be on disk; nothing is written unless it is valid.
    const reparsed = parseFrontmatter(patched.source);
    if (!reparsed.ok) {
      throw new EntryIoError(
        'invalid',
        `the patched frontmatter does not parse: ${reparsed.error}`,
        [{ path: '', message: reparsed.error }],
      );
    }
    const problems = schemaIssues(located.dataset, located.slug, reparsed.doc.data);
    if (located.dataset !== 'skill') {
      const rel = `${located.dataset}/${located.slug}/${OKF_ENTRY_FILE}`;
      for (const finding of validateOkfFile({
        dataset: located.dataset,
        bundle: located.slug,
        relPath: OKF_ENTRY_FILE,
        source: patched.source,
        file: rel,
      })) {
        if (finding.rule === 'okf/stale-after-format') {
          problems.push({ path: 'stale_after', message: finding.message });
        }
      }
    }
    if (problems.length > 0) {
      throw new EntryIoError(
        'invalid',
        'the patched frontmatter does not match the schema',
        problems,
      );
    }

    await writeFileAtomic(file.realAbs, patched.source, file.mode);
    invalidateEntryIndex(dataDir);
    const st = await stat(file.realAbs);
    return {
      frontmatter: toJsonSafe(reparsed.doc.data) as Record<string, unknown>,
      lastModified: st.mtime.toISOString(),
      changed: true,
      warnings: relationWarnings(located, patched.source, dataDir),
    };
  });
}

// ---------------------------------------------------------------- create

export interface CreatedEntry {
  dataset: EntryDatasetId;
  slug: string;
  /** Data-dir-relative posix path of the entry file: 'task/x/index.md' | 'skill/x/SKILL.md'. */
  path: string;
  /** Page URL: '/task/x'. */
  url: string;
  /** Data-dir-relative paths of every file written. */
  files: string[];
  /** Only with `parent`: whether the project now lists the new entry as a `child`. */
  parentLinked?: boolean;
  /** Only when `parentLinked` is false: why. The entry itself was created. */
  parentError?: string;
}

interface ParsedCreate {
  name: string;
  description: string;
  title?: string;
  state?: string;
  tags?: string[];
  parent?: string;
}

function parseCreateBody(dataset: EntryDatasetId, body: unknown): ParsedCreate {
  if (!isRecord(body)) {
    throw new EntryIoError('invalid', 'body must be a JSON object', [
      { path: '', message: 'must be an object' },
    ]);
  }
  const issues: Issue[] = [];
  const def = datasetDef(dataset);
  const isSkill = dataset === 'skill';
  const allowed = ['name', 'description', 'title', 'state', 'tags', 'parent'];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) issues.push({ path: key, message: 'unexpected property' });
  }

  let name = '';
  if (typeof body.name !== 'string' || body.name === '') {
    issues.push({ path: 'name', message: 'is required' });
  } else if (body.name.length > NAME_MAX_LENGTH) {
    issues.push({ path: 'name', message: `at most ${NAME_MAX_LENGTH} characters` });
  } else if (!isValidName(body.name)) {
    issues.push({ path: 'name', message: NAME_HELP });
  } else {
    name = body.name;
  }

  let description = '';
  if (typeof body.description !== 'string' || oneLine(body.description) === '') {
    issues.push({ path: 'description', message: 'is required' });
  } else if (oneLine(body.description).length > DESCRIPTION_MAX) {
    issues.push({ path: 'description', message: `at most ${DESCRIPTION_MAX} characters` });
  } else {
    description = oneLine(body.description);
  }

  const out: ParsedCreate = { name, description };

  if (body.title !== undefined && body.title !== null) {
    if (isSkill) {
      issues.push({ path: 'title', message: 'is not available for skills' });
    } else if (typeof body.title !== 'string') {
      issues.push({ path: 'title', message: 'must be a string' });
    } else if (oneLine(body.title).length > TITLE_MAX) {
      issues.push({ path: 'title', message: `at most ${TITLE_MAX} characters` });
    } else if (oneLine(body.title) !== '') {
      out.title = oneLine(body.title);
    }
  }

  if (body.state !== undefined && body.state !== null) {
    if (def.states === undefined) {
      issues.push({ path: 'state', message: `${def.plural} have no lifecycle state` });
    } else if (typeof body.state !== 'string' || !def.states.some((s) => s.id === body.state)) {
      issues.push({
        path: 'state',
        message: `must be one of: ${def.states.map((s) => s.id).join(', ')}`,
      });
    } else {
      out.state = body.state;
    }
  }

  if (body.tags !== undefined && body.tags !== null) {
    if (isSkill) {
      issues.push({ path: 'tags', message: 'is not available for skills' });
    } else {
      const tags = parseTags(body.tags, 'tags', issues);
      if (tags !== undefined) out.tags = tags;
    }
  }

  if (body.parent !== undefined && body.parent !== null) {
    if (typeof body.parent !== 'string' || !isValidName(body.parent)) {
      issues.push({ path: 'parent', message: 'must be the name of a project' });
    } else {
      out.parent = body.parent;
    }
  }

  if (issues.length > 0) throw new EntryIoError('invalid', 'request body is invalid', issues);
  return out;
}

/**
 * Creates a NEW okf / skill entry from the shared templates (the files `pnpm run add:<ds>` writes, validated the
 * same way and rolled back on failure). `body`: `{ name, description, title?, state?, tags?, parent? }`; `parent`
 * is a project that must exist (`invalid`, nothing written) and gets `{dataset, slug: name, rel: 'child'}` appended
 * to its `links` once the entry is on disk; a failure there keeps the entry and is reported as `parentLinked: false`.
 * Throws EntryIoError: `bad-dataset`, `invalid`, `exists`; an `EntryCreateError` of code `invalid` / `io` (a
 * template bug, never with valid input) propagates.
 */
export async function createEntry(
  dataset: string,
  body: unknown,
  dataDir: string = resolveDataDir(),
  now: Date = new Date(),
): Promise<CreatedEntry> {
  if (!isEntryDatasetId(dataset)) {
    throw new EntryIoError(
      'bad-dataset',
      `entries of "${dataset}" cannot be created here; use one of ${ENTRY_DATASET_IDS.join(', ')}`,
    );
  }
  const input = parseCreateBody(dataset, body);

  if (input.parent !== undefined) {
    const project = await resolveBundleFile('project', input.parent, OKF_ENTRY_FILE, dataDir);
    if (!project.ok) {
      throw new EntryIoError('invalid', 'request body is invalid', [
        { path: 'parent', message: `project "${input.parent}" does not exist` },
      ]);
    }
  }

  let planned;
  try {
    planned = planNewEntry(dataset, input.name, {
      description: input.description,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      now,
    });
  } catch (error) {
    throw new EntryIoError('invalid', (error as Error).message, [
      { path: '', message: (error as Error).message },
    ]);
  }

  let files: string[];
  try {
    files = await writePlannedEntry(dataset, input.name, planned, dataDir);
  } catch (error) {
    if (error instanceof EntryCreateError && error.code === 'exists') {
      throw new EntryIoError('exists', `${dataset} "${input.name}" already exists`);
    }
    throw error;
  }
  invalidateEntryIndex(dataDir);

  const created: CreatedEntry = {
    dataset,
    slug: input.name,
    path: entryFileRelPath(dataset, input.name),
    url: entryUrl(dataset, input.name),
    files,
  };
  if (input.parent !== undefined) {
    try {
      await patchEntry(
        'project',
        input.parent,
        { addLinks: [{ dataset, slug: input.name, rel: 'child' }] },
        dataDir,
      );
      created.parentLinked = true;
    } catch (error) {
      created.parentLinked = false;
      created.parentError = error instanceof Error ? error.message : String(error);
    }
  }
  return created;
}

/**
 * Deletes a whole okf bundle / skill directory (DELETE). The directory must exist, be a REAL directory (a symlinked
 * bundle is refused: the link target is never touched) and resolve inside the dataset directory; anything else is
 * `not-found`. Throws EntryIoError: `bad-dataset`, `bad-slug`, `not-found`.
 */
export async function deleteEntry(
  dataset: string,
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<void> {
  const located = locateEntry(dataset, slug, dataDir);
  const root = datasetDir(located.dataset, dataDir);
  const dir = path.resolve(root, slug);
  const notFound = new EntryIoError('not-found', `${dataset} entry "${slug}" does not exist`);
  try {
    const info = await lstat(dir);
    if (!info.isDirectory()) throw notFound;
    const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
    if (path.dirname(realDir) !== realRoot) throw notFound;
  } catch (error) {
    if (error instanceof EntryIoError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw notFound;
    throw error;
  }
  try {
    await rm(dir, { recursive: true, force: false });
  } finally {
    invalidateEntryIndex(dataDir);
  }
}
