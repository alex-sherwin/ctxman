// NODE* (no fs calls of its own; imports src/lib/okf.ts through markdown.ts): renders an ExpandedPlan plus
// the gathered file contents into ONE markdown document and a JSON manifest (plans/INFLATE_SPEC.md §6.3).
// With `ctx.output` (a working directory, plans/INFLATE_V2_SPEC.md §9, plans/INFLATE_V3_PLAN.md §7) the same
// document is rendered for the directory: every path into it is a relative markdown link, absolute links point
// at what is not placed, and the directory map, the `## Placement` legend, the primary / repositories / folders /
// skills sections carry the details the (compact) repository, folder and skill items only point to. Without it
// the output is the single document with absolute paths in code spans, unchanged since v1. Brief quality
// (plans/ROUND3_SPEC.md §H): the entry description is printed when the body lacks it, empty template sections
// are dropped, markdown blocks nest under their group, links that do not resolve become `unresolved-link`
// warnings. Never import from the browser island.
import {
  OKF_DATASET_IDS,
  OKF_ENTRY_FILE,
  OWNER_LABELS,
  stateLabel,
} from '../../datasets/registry.ts';
import { maskMarkdownCode, parseFrontmatterLoose, splitFrontmatter } from '../okf.ts';
import { classifyRemoteUri } from '../remote-uri.ts';
import {
  FOLDERS_DIR,
  ITEM_KIND_LABELS,
  OPTION_DEFS,
  REPOS_DIR,
  TARGETS,
  familyOf,
  modeDef,
  modesForPlacement,
} from './catalog.ts';
import type {
  BooleanOptionId,
  InflateLayout,
  InflateOptions,
  InflateTarget,
  ItemKind,
  MaterialId,
  ModeId,
  TargetDef,
} from './catalog.ts';
import type {
  ExpandedPlan,
  InflateWarning,
  ItemSegment,
  Segment,
  SegmentStatus,
} from './expand.ts';
import { cleanSubpath, createPathMapper } from './material-plan.ts';
import type { FileRole, MaterialView } from './material-plan.ts';
import { normalizeText } from './recipe.ts';
import {
  alignRows,
  dropEmptySections,
  fenced,
  firstHeadingText,
  guidance,
  headingText,
  inlineCode,
  nestHeadings,
  pathLink,
  rewriteLinks,
  shQuote,
  shiftHeadings,
  stripLeadingTitle,
  truncateText,
} from './markdown.ts';
import type { UnresolvedReason } from './markdown.ts';
import type { EntryRef, ItemContent, PlanContent } from './pipeline.ts';

export interface ManifestSegment {
  key: string;
  type: Segment['type'];
  title: string;
  status: Exclude<SegmentStatus, 'loading'>;
  dataset?: ItemSegment['dataset'];
  slug?: string;
  kind?: ItemKind;
  mode?: ModeId;
  modeLabel?: string;
  options?: Partial<InflateOptions>;
  via: string[];
  adhoc: boolean;
  /** entryAbs (items) */
  source?: string;
  /** Working-directory output: what is placed for this item (items with a view). */
  material?: MaterialId;
  /** Working-directory output: posix path relative to the directory (when something is placed). */
  dest?: string;
  /** UTF-8 bytes of this segment's text (0 when not rendered). */
  bytes: number;
  warnings: InflateWarning[];
}

export interface InflateManifest {
  recipe: string;
  target: InflateTarget;
  layout: InflateLayout;
  generatedAt: string;
  /** Whole document. */
  bytes: number;
  /** Item segments; invalid counts as missing. */
  counts: { included: number; excluded: number; missing: number };
  contexts: { slug: string; status: 'ready' | 'missing' | 'invalid' }[];
  segments: ManifestSegment[];
  /** plan + content + render, deduped on code + key + message. */
  warnings: InflateWarning[];
  /** Present when rendered for a working directory. */
  output?: { dir: string; contextFile: string; primary: string | null };
}

export interface InflateResult {
  markdown: string;
  manifest: InflateManifest;
}

/** What a working-directory render needs besides the plan (plans/INFLATE_V2_SPEC.md §9.1). */
export interface RenderOutput {
  /** Absolute <W> (printed once in the header). */
  dir: string;
  contextFile: string;
  /** Valid primary key (placed in the directory) or null. */
  primary: string | null;
  target: InflateTarget;
  materials: Record<string, MaterialView>;
  /** Context file + stubs that are written (map rows, header lines). */
  files: { path: string; role: FileRole }[];
}

export const LARGE_OUTPUT_BYTES = 512 * 1024;

/** "Summary + links" lists at most this many concept files, then "and N more in <folder>". */
export const SUMMARY_FILES_LIMIT = 20;

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

const HEADER_PATHS_LINE =
  'Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.';

// ---------------------------------------------------------------- small helpers

const flag = (options: Partial<InflateOptions>, id: BooleanOptionId): boolean =>
  options[id] ?? (OPTION_DEFS[id].default as boolean);

const shBlock = (lines: readonly string[]): string => fenced(lines.join('\n'), 'sh');

/** `text` without leading blank lines (indentation of the first real line is kept) and trailing whitespace. */
const trimBlankLines = (text: string): string => text.replace(/^(?:[ \t]*\n)+/, '').trimEnd();

const H1 = /^ {0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** Frontmatter `title` ?? first ATX H1 ?? file name without `.md`. */
function fileTitle(text: string, rel: string): string {
  try {
    const title = parseFrontmatterLoose(text).data.title;
    if (typeof title === 'string' && title.trim() !== '') return title.trim();
  } catch {
    // unreadable frontmatter: fall through to the heading / file name
  }
  const body = splitFrontmatter(text)?.body ?? text;
  const masked = maskMarkdownCode(body).split('\n');
  const lines = body.split('\n');
  for (const [i, line] of masked.entries()) {
    if (!H1.test(line)) continue; // headings inside code are masked out
    const heading = H1.exec(lines[i] ?? '')?.[1]?.trim();
    if (heading !== undefined && heading !== '') return heading;
  }
  return (rel.split('/').pop() ?? rel).replace(/\.md$/i, '');
}

// ---------------------------------------------------------------- environment

interface DirEnv {
  output: RenderOutput;
  /** Valid, not failed primary key. */
  primary: string | null;
  /** Every view (included items with a kind) in segment order. */
  views: MaterialView[];
}

interface Env {
  target: TargetDef;
  content: PlanContent;
  /** abs → path printed in the document (identity without a working directory). */
  pathOf: (abs: string) => string;
  /** ctxman: link targets with `pathOf` applied. */
  targets: Readonly<Record<string, EntryRef | null>>;
  /** The phrase for the directory instructions run from: 'the project root' (v1) or 'this directory'. */
  root: string;
  /** Set when rendering for a working directory. */
  dir?: DirEnv;
  /** Collector for `unresolved-link` warnings found while rendering (one list per renderPlan call). */
  warnings: InflateWarning[];
}

const identity = (abs: string): string => abs;

/** Placed in the directory: a dest is known and the step did not fail. */
const isPlacedView = (view: MaterialView): boolean => view.dest !== null && view.state !== 'failed';

/**
 * The view of an item that is placed in the directory; undefined otherwise. The renderer decides "placed" from
 * the view, not from `ItemSegment.placed`: the planner can still demote an item (missing tool or source,
 * collision) and a run can fail a step.
 */
function placedView(seg: ItemSegment, env: Env): MaterialView | undefined {
  const view = env.dir?.output.materials[seg.key];
  return view !== undefined && isPlacedView(view) ? view : undefined;
}

/**
 * A path printed in the document: a markdown link in a working-directory document (relative for what is
 * placed, absolute for what is not), a plain code span in the single document.
 */
function pathRef(env: Env, path: string, folder = false): string {
  return env.dir === undefined ? inlineCode(path) : pathLink(path, { folder });
}

// ---------------------------------------------------------------- bodies shared by both outputs

interface BodyArgs {
  text: string;
  /** Bundle-relative path of the file (for link resolution). */
  fromRel: string;
  title: string;
  /** Heading level the file's shallowest heading is moved to. */
  base: number;
  options: Partial<InflateOptions>;
  files: ReadonlyMap<string, string>;
  targets: Readonly<Record<string, EntryRef | null>>;
  /** Segment key of the item the file belongs to (`unresolved-link` warnings are filed under it). */
  key: string;
  warnings: InflateWarning[];
}

const UNRESOLVED_WHY: Record<UnresolvedReason, string> = {
  'no-entry': 'no such entry',
  'no-file': 'no such file in the bundle',
  escapes: 'points outside the bundle',
  malformed: 'malformed ctxman: link',
};

/**
 * frontmatter dropped → leading title dropped → empty sections dropped → headings shifted → links made
 * absolute (relative inside a working directory; unresolved ones reported) → trimmed.
 */
function renderBody(a: BodyArgs): string {
  const text = a.text.replace(/\r\n?/g, '\n');
  let body = splitFrontmatter(text)?.body ?? text;
  body = stripLeadingTitle(body, a.title);
  body = dropEmptySections(body);
  if (flag(a.options, 'shiftHeadings')) body = shiftHeadings(body, a.base);
  if (flag(a.options, 'rewriteLinks')) {
    body = rewriteLinks(body, {
      fromRel: a.fromRel,
      files: a.files,
      targets: a.targets,
      onUnresolved: (destination, reason) => {
        a.warnings.push({
          code: 'unresolved-link',
          key: a.key,
          message: `${a.key}/${a.fromRel}: link "${destination}" does not resolve (${UNRESOLVED_WHY[reason]})`,
        });
      },
    });
  }
  return body.trim();
}

function frontmatterBlock(text: string, options: Partial<InflateOptions>): string {
  if (!flag(options, 'includeFrontmatter')) return '';
  const raw = splitFrontmatter(text.replace(/\r\n?/g, '\n'))?.raw;
  return raw === undefined || raw.trim() === '' ? '' : fenced(raw, 'yaml');
}

/** `- rel — path` rows; the path is a code span in the single document and a link in a working directory. */
const listLines = (rows: readonly { rel: string; abs: string }[], env: Env): string =>
  rows.map((row) => `- ${inlineCode(row.rel)} — ${pathRef(env, row.abs)}`).join('\n');

function pointerLine(seg: ItemSegment, tail: string): string {
  const description = (seg.meta?.description ?? '').trim();
  const label = seg.kind === null ? '' : ITEM_KIND_LABELS[seg.kind];
  return `${inlineCode(seg.key)} · ${label} · ${description === '' ? '' : `${description} `}${tail}`;
}

/** Lower case, whitespace collapsed: how the description is looked for in a rendered body. */
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

// ---- okf

function okfBody(seg: ItemSegment, ic: ItemContent, level: number, env: Env): string[] {
  const options = seg.options;
  const files = new Map((ic.files ?? []).map((f) => [f.rel, env.pathOf(f.abs)] as const));
  const targets = env.targets;
  const main = ic.texts?.[OKF_ENTRY_FILE];
  const out: string[] = [];
  const concepts = ic.concepts ?? [];
  const body = (rel: string, text: string, title: string, base: number): string =>
    renderBody({
      text,
      fromRel: rel,
      title,
      base,
      options,
      files,
      targets,
      key: seg.key,
      warnings: env.warnings,
    });

  const mainBody =
    main !== undefined && main !== null ? body(OKF_ENTRY_FILE, main, seg.title, level + 1) : '';
  // The description is the one line that says what the entry is: print it unless the frontmatter block or
  // the body already carries it.
  const description = (seg.meta?.description ?? '').trim();
  if (
    !flag(options, 'includeFrontmatter') &&
    description !== '' &&
    !squash(mainBody).includes(squash(description))
  ) {
    out.push(description);
  }
  if (main !== undefined && main !== null) {
    out.push(frontmatterBlock(main, options));
    out.push(mainBody);
  }

  if (seg.mode === 'inline-main') {
    if (concepts.length > 0) {
      const root = env.pathOf(ic.rootAbs);
      out.push(
        env.dir === undefined
          ? `More in this bundle (under ${inlineCode(root)}): ${concepts.map((c) => inlineCode(c)).join(', ')}.`
          : `More in this bundle (under ${pathLink(root, { folder: true })}): ${concepts.map((c) => pathLink(files.get(c) ?? `${root}/${c}`)).join(', ')}.`,
      );
    }
    return out;
  }

  // inline-bundle
  const section = (heading: string, rel: string, text: string, title: string): void => {
    out.push(headingText(level + 1, heading));
    out.push(`${inlineCode(rel)} · ${pathRef(env, files.get(rel) ?? rel)}`);
    out.push(body(rel, text, title, level + 2));
  };
  for (const rel of concepts) {
    const text = ic.texts?.[rel];
    if (text === undefined || text === null) continue;
    const title = fileTitle(text, rel);
    section(title, rel, text, title);
  }
  if (flag(options, 'includeLog')) {
    const log = ic.texts?.['log.md'];
    if (log !== undefined && log !== null) section('Update log', 'log.md', log, 'Update log');
  }
  const others = (ic.files ?? [])
    .filter((f) => f.kind !== 'markdown')
    .map((f) => ({ rel: f.rel, abs: env.pathOf(f.abs) }));
  if (others.length > 0) out.push('Other files in this bundle:', listLines(others, env));
  return out;
}

// ---- skill

function skillInlineBody(seg: ItemSegment, ic: ItemContent, level: number, env: Env): string[] {
  const options = seg.options;
  const files = new Map((ic.files ?? []).map((f) => [f.rel, env.pathOf(f.abs)] as const));
  const out: string[] = [];
  const text = ic.texts?.['SKILL.md'];
  if (text !== undefined && text !== null) {
    out.push(frontmatterBlock(text, options));
    out.push(
      renderBody({
        text,
        fromRel: 'SKILL.md',
        title: seg.title,
        base: level + 1,
        options,
        files,
        targets: env.targets,
        key: seg.key,
        warnings: env.warnings,
      }),
    );
  }
  const others = (ic.files ?? [])
    .filter((f) => f.rel !== 'SKILL.md')
    .map((f) => ({ rel: f.rel, abs: env.pathOf(f.abs) }));
  if (others.length > 0) {
    out.push(
      `Files in this skill (under ${pathRef(env, env.pathOf(ic.rootAbs), true)}):`,
      listLines(others, env),
    );
  }
  return out;
}

/** The shell block that copies (or symlinks) a local skill into the harness skills directory (not placed). */
function skillInstallBody(seg: ItemSegment, ic: ItemContent, env: Env): string[] {
  const dest = `${env.target.skillsDir}/${seg.slug}`;
  const lines = [
    `mkdir -p ${shQuote(env.target.skillsDir)}`,
    `${seg.options.symlink === true ? 'ln -s' : 'cp -R'} ${shQuote(ic.rootAbs)} ${shQuote(dest)}`,
  ];
  return [`Install this skill into the project (run from ${env.root}):`, shBlock(lines)];
}

// ---- local repo

/** Tree mode: the top-level entries of the local path (`label` = how the path is printed); [] for any other mode. */
function treeLines(seg: ItemSegment, ic: ItemContent, label: string): string[] {
  if (seg.mode !== 'tree' || ic.tree == null) return [];
  const limit = seg.options.treeLimit ?? (OPTION_DEFS.treeLimit.default as number);
  const shown = ic.tree.entries.slice(0, limit);
  const out = [`Top-level entries of ${label} (${shown.length} of ${ic.tree.total}):`];
  if (shown.length > 0) {
    out.push(fenced(shown.map((e) => (e.dir ? `${e.name}/` : e.name)).join('\n'), 'text'));
  }
  return out;
}

// ---- remote repo / skill

/** The `git clone` commands of a remote repository in mode `clone` (the project is `root`). */
function cloneCommands(
  seg: ItemSegment,
  ref: { uri: string; subpath?: string | null | undefined },
  root: string,
): string[] {
  const subpath = cleanSubpath(ref.subpath);
  const dir =
    seg.options.cloneDir ?? (OPTION_DEFS.cloneDir.default as string).replaceAll('{name}', seg.slug);
  const depth = flag(seg.options, 'shallow') ? ' --depth 1' : '';
  const lines =
    flag(seg.options, 'sparse') && subpath !== ''
      ? [
          `git clone${depth} --filter=blob:none --sparse ${shQuote(ref.uri)} ${shQuote(dir)}`,
          `git -C ${shQuote(dir)} sparse-checkout set ${shQuote(subpath)}`,
        ]
      : [`git clone${depth} ${shQuote(ref.uri)} ${shQuote(dir)}`];
  const out = [
    `Clone it into the project (run from ${root}; keep \`.ctxman/\` out of version control):`,
    shBlock(lines),
  ];
  if (subpath !== '') out.push(`Then read ${inlineCode(`${dir}/${subpath}`)}.`);
  return out;
}

/** The commands that clone or download a remote skill into the skills directory. */
function installCommands(
  seg: ItemSegment,
  ref: { uri: string; subpath?: string | null | undefined },
  env: Env,
): string[] {
  const subpath = cleanSubpath(ref.subpath);
  const archive = classifyRemoteUri(ref.uri) === 'archive';
  const skills = env.target.skillsDir;
  const n = seg.slug;
  const tmp = `.ctxman/tmp/${n}`;
  const dest = `${skills}/${n}`;
  const q = shQuote;
  let lines: string[];
  if (!archive) {
    lines =
      subpath === ''
        ? [
            `mkdir -p ${q(skills)}`,
            `git clone --depth 1 ${q(ref.uri)} ${q(dest)}`,
            `rm -rf ${q(`${dest}/.git`)}`,
          ]
        : [
            `mkdir -p ${q(skills)} .ctxman/tmp`,
            `git clone --depth 1 ${q(ref.uri)} ${q(tmp)}`,
            `cp -R ${q(`${tmp}/${subpath}`)} ${q(dest)}`,
            `rm -rf ${q(tmp)}`,
          ];
  } else {
    const zip = /\.zip$/i.test(new URL(ref.uri).pathname);
    const file = `${tmp}.${zip ? 'zip' : 'tgz'}`;
    lines = [
      `mkdir -p ${q(skills)} ${q(tmp)}`,
      `curl -fsSL ${q(ref.uri)} -o ${q(file)}`,
      zip ? `unzip -q ${q(file)} -d ${q(tmp)}` : `tar -xzf ${q(file)} -C ${q(tmp)}`,
      `cp -R ${q(subpath === '' ? tmp : `${tmp}/${subpath}`)} ${q(dest)}`,
      `rm -rf ${q(tmp)} ${q(file)}`,
    ];
  }
  const out = [
    `Install this skill into ${inlineCode(`${dest}/`)} (run from ${env.root}):`,
    shBlock(lines),
  ];
  if (archive) {
    out.push(
      'The skill folder is the one that contains SKILL.md; if the archive wraps it in a top-level folder, copy that folder instead.',
    );
  }
  return out;
}

// ---------------------------------------------------------------- item rendering

/** What every item renderer works with. `kind`, `mode` and `meta` are checked once by `renderItem`. */
interface ItemCtx {
  seg: ItemSegment;
  kind: ItemKind;
  mode: ModeId;
  meta: NonNullable<ItemSegment['meta']>;
  ic: ItemContent;
  level: number;
  env: Env;
}

function renderItem(seg: ItemSegment, env: Env): string {
  const { kind, mode, meta } = seg;
  if (seg.status !== 'included' || kind === null || mode === null || meta === null) return '';
  const ic = env.content.items[seg.key];
  if (ic === undefined) return '';
  const c: ItemCtx = { seg, kind, mode, meta, ic, level: seg.group === null ? 2 : 3, env };
  const parts = [
    headingText(c.level, seg.title),
    ...(env.dir === undefined ? documentItem(c) : directoryItem(c)),
  ];
  const failed = env.dir?.output.materials[seg.key];
  if (failed?.state === 'failed') {
    parts.push(`Not placed in this directory: ${failed.reason ?? 'the step failed'}.`);
  }
  return parts.join('\n\n');
}

// ---- the single document (no working directory): absolute paths in code spans, install and clone commands

function metaLine(seg: ItemSegment, location: string | null): string {
  const meta = seg.meta;
  const kind = seg.kind;
  if (meta === null || kind === null) return '';
  const parts = [inlineCode(seg.key), ITEM_KIND_LABELS[kind]];
  if (kind === 'remote-skill' && meta.uriKind !== undefined) parts.push(meta.uriKind);
  if (meta.state !== undefined) parts.push(`state: ${stateLabel(meta.state)}`);
  if (meta.stale && meta.staleAfter !== undefined) parts.push(`stale since ${meta.staleAfter}`);
  if (meta.ref !== undefined) parts.push(`owner: ${OWNER_LABELS[meta.ref.owner]}`);
  if (meta.tags.length > 0) parts.push(`tags: ${meta.tags.join(', ')}`);
  if (location !== null) parts.push(inlineCode(location));
  return parts.join(' · ');
}

/** Paragraphs after the heading: the meta line, the context guidance, then `body` without empty parts. */
function withMeta(seg: ItemSegment, location: string | null, body: readonly string[]): string[] {
  const notes = guidance(seg.notes);
  return [
    metaLine(seg, location),
    ...(notes === '' ? [] : [notes]),
    ...body.filter((p) => p !== ''),
  ];
}

/** Paragraphs after the heading of a one-line pointer: the line, then the context guidance. */
function withPointer(seg: ItemSegment, line: string): string[] {
  const notes = guidance(seg.notes);
  return [line, ...(notes === '' ? [] : [notes])];
}

/**
 * A reference's `info` markdown, inlined under the item in every mode ('' when absent or blank): headings
 * nested below the item heading, `ctxman:` links resolved like in inline bodies (relative when the target is
 * placed). A reference has no bundle, so every other link stays as written, without a warning.
 */
function infoBody(c: ItemCtx): string {
  const { seg, meta, level, env } = c;
  const info = meta.ref?.info;
  if (info === undefined || info.trim() === '') return '';
  const body = rewriteLinks(nestHeadings(trimBlankLines(normalizeText(info)), level + 1), {
    fromRel: '',
    files: new Map(),
    targets: env.targets,
    onUnresolved: (destination, reason) => {
      if (reason !== 'no-entry' && reason !== 'malformed') return;
      env.warnings.push({
        code: 'unresolved-link',
        key: seg.key,
        message: `${seg.key} info: link "${destination}" does not resolve (${UNRESOLVED_WHY[reason]})`,
      });
    },
  });
  return body.trim();
}

function documentItem(c: ItemCtx): string[] {
  const { seg, kind, mode, meta, ic, level, env } = c;
  const options = seg.options;
  const description = meta.description.trim();
  // References: what the item is (description, then its info), ahead of where it is and how to get it.
  const about = (): string[] => [description, infoBody(c)];
  switch (kind) {
    case 'kb':
    case 'rca':
    case 'idea':
    case 'task':
    case 'bug':
    case 'feature':
    case 'project': {
      if (mode === 'pointer') {
        const tail = flag(options, 'eager')
          ? env.target.eagerClause(ic.entryAbs)
          : `Read ${inlineCode(ic.entryAbs)} if relevant.`;
        return withPointer(seg, pointerLine(seg, tail));
      }
      if (mode === 'summary') return withMeta(seg, ic.entryAbs, [description]);
      return withMeta(seg, ic.entryAbs, okfBody(seg, ic, level, env));
    }
    case 'skill': {
      if (mode === 'pointer') {
        const tail = flag(options, 'eager')
          ? env.target.eagerClause(ic.entryAbs)
          : `Read ${inlineCode(ic.entryAbs)} and follow it when the task matches.`;
        return withPointer(seg, pointerLine(seg, tail));
      }
      if (mode === 'inline') {
        return withMeta(seg, ic.entryAbs, skillInlineBody(seg, ic, level, env));
      }
      return withMeta(seg, ic.rootAbs, [description, ...skillInstallBody(seg, ic, env)]);
    }
    case 'local-repo':
    case 'local-folder':
      return withMeta(seg, ic.local?.root ?? null, localBody(seg, ic, about()));
    case 'remote-repo':
      return withMeta(
        seg,
        meta.ref !== undefined && 'uri' in meta.ref ? meta.ref.uri : null,
        remoteRepoBody(seg, about(), env.root),
      );
    case 'remote-skill':
      return withMeta(
        seg,
        meta.ref !== undefined && 'uri' in meta.ref ? meta.ref.uri : null,
        remoteSkillBody(seg, about(), env),
      );
  }
}

/** `about` = the description and the info of the reference (render.ts#documentItem). */
function localBody(seg: ItemSegment, ic: ItemContent, about: readonly string[]): string[] {
  const local = ic.local;
  const ref = seg.meta?.ref;
  if (local === undefined) return [...about];
  const subpath = ref !== undefined && 'subpath' in ref ? cleanSubpath(ref.subpath) : '';
  const [what, inside] = seg.kind === 'local-folder' ? ['files', 'folder'] : ['code', 'repository'];
  const out = [
    ...about,
    subpath === ''
      ? `Read the ${what} at ${inlineCode(local.target)} when the task needs it.`
      : `Read the ${what} at ${inlineCode(local.target)} (inside the ${inside} ${inlineCode(local.root)}) when the task needs it.`,
  ];
  if (!local.exists) {
    out.push(`The path ${inlineCode(local.target)} does not exist on this machine.`);
    return out;
  }
  out.push(...treeLines(seg, ic, inlineCode(local.target)));
  return out;
}

function remoteRepoBody(seg: ItemSegment, about: readonly string[], root: string): string[] {
  const ref = seg.meta?.ref;
  if (ref === undefined || ref.type !== 'remote-repo') return [...about];
  if (seg.mode !== 'clone') {
    const subpath = cleanSubpath(ref.subpath);
    return [
      ...about,
      `Git repository ${inlineCode(ref.uri)}${subpath === '' ? '' : `, relevant path ${inlineCode(subpath)}`}. Clone it only if the task needs its contents.`,
    ];
  }
  return [...about, ...cloneCommands(seg, ref, root)];
}

function remoteSkillBody(seg: ItemSegment, about: readonly string[], env: Env): string[] {
  const ref = seg.meta?.ref;
  if (ref === undefined || ref.type !== 'remote-skill') return [...about];
  if (seg.mode === 'describe') {
    const subpath = cleanSubpath(ref.subpath);
    const lead =
      classifyRemoteUri(ref.uri) === 'archive'
        ? `Agent skill packaged as an archive at ${inlineCode(ref.uri)}`
        : `Agent skill in the git repository ${inlineCode(ref.uri)}`;
    return [
      ...about,
      `${lead}${subpath === '' ? '' : ` (skill folder ${inlineCode(subpath)})`}. Install it only if the task needs it.`,
    ];
  }
  return [...about, ...installCommands(seg, ref, env)];
}

// ---- the working-directory document (plans/INFLATE_V3_PLAN.md §7.3)

/** `Details: see …` line of a compact repository / folder / remote-skill item. */
function detailsLine(seg: ItemSegment, env: Env): string {
  if (seg.kind === 'remote-skill') return 'Details: see Skills.';
  if (seg.kind === 'local-folder') return 'Details: see Folders.';
  return env.dir?.primary === seg.key
    ? 'Details: see Primary repository.'
    : 'Details: see Repositories.';
}

/** Where the item is, for its facts line: a relative link when placed, "not placed: <absolute link>" when not. */
function locationOf(c: ItemCtx, view: MaterialView | undefined): string {
  const { seg, kind, meta, ic, env } = c;
  const placed = view?.dest != null;
  const unplaced = (target: string | null): string =>
    target === null ? 'not placed' : `not placed: ${target}`;
  switch (familyOf(kind)) {
    case 'okf':
    case 'skill': {
      const link = pathRef(env, env.pathOf(ic.entryAbs));
      return placed ? link : unplaced(link);
    }
    case 'local-repo':
    case 'local-folder': {
      if (view?.dest != null) return pathRef(env, view.dest, true);
      const root = ic.local?.root ?? env.dir?.output.materials[seg.key]?.sourceAbs ?? null;
      return unplaced(root === null ? null : pathRef(env, root, true));
    }
    default: {
      if (view?.dest != null) return pathRef(env, view.dest, true);
      const uri = meta.ref !== undefined && 'uri' in meta.ref ? meta.ref.uri : null;
      return unplaced(uri === null ? null : inlineCode(uri));
    }
  }
}

/**
 * `key · kind · state, stale, tags · location · placement [· primary] [· editable|read-only]`: the first line
 * of every item of a working-directory document.
 */
function factsLine(c: ItemCtx, view: MaterialView | undefined): string {
  const { seg, kind, meta, env } = c;
  const parts = [inlineCode(seg.key), ITEM_KIND_LABELS[kind]];
  if (meta.state !== undefined) parts.push(`state: ${stateLabel(meta.state)}`);
  if (meta.stale && meta.staleAfter !== undefined) parts.push(`stale since ${meta.staleAfter}`);
  if (meta.tags.length > 0) parts.push(`tags: ${meta.tags.join(', ')}`);
  parts.push(locationOf(c, view));
  if (view !== undefined) parts.push(placementWord(view));
  if (hasAccess(kind)) {
    if (env.dir?.primary === seg.key) parts.push('primary');
    parts.push(access(env.dir?.output.materials[seg.key]));
  }
  return parts.join(' · ');
}

/** The "Summary + links" file list: at most SUMMARY_FILES_LIMIT concept files, then "and N more in <folder>". */
function filesLine(ic: ItemContent, env: Env): string {
  const concepts = ic.concepts ?? [];
  if (concepts.length === 0) return '';
  const root = env.pathOf(ic.rootAbs);
  const files = new Map((ic.files ?? []).map((f) => [f.rel, env.pathOf(f.abs)] as const));
  const shown = concepts
    .slice(0, SUMMARY_FILES_LIMIT)
    .map((rel) => pathLink(files.get(rel) ?? `${root}/${rel}`));
  const more = concepts.length - shown.length;
  return `Files: ${shown.join(', ')}${more > 0 ? `, and ${more} more in ${pathLink(root, { folder: true })}` : ''}`;
}

function directoryItem(c: ItemCtx): string[] {
  const { seg, kind, mode, meta, ic, level, env } = c;
  const options = seg.options;
  const view = placedView(seg, env);
  const description = meta.description.trim();
  const facts = (body: readonly string[]): string[] => {
    const notes = guidance(seg.notes);
    return [factsLine(c, view), ...(notes === '' ? [] : [notes]), ...body.filter((p) => p !== '')];
  };

  switch (kind) {
    case 'kb':
    case 'rca':
    case 'idea':
    case 'task':
    case 'bug':
    case 'feature':
    case 'project': {
      if (mode === 'pointer') {
        const tail = flag(options, 'eager')
          ? env.target.eagerClause(env.pathOf(ic.entryAbs))
          : `Read ${pathRef(env, env.pathOf(ic.entryAbs))} if relevant.`;
        return withPointer(seg, pointerLine(seg, tail));
      }
      if (mode === 'summary') {
        // Placed: the files are right there, so list them instead of inlining anything.
        return facts([description, view === undefined ? '' : filesLine(ic, env)]);
      }
      return facts(okfBody(seg, ic, level, env));
    }
    case 'skill': {
      if (mode === 'pointer') {
        if (flag(options, 'eager')) {
          return withPointer(
            seg,
            pointerLine(seg, env.target.eagerClause(env.pathOf(ic.entryAbs))),
          );
        }
        // The harness discovers a placed skill; the facts line links its SKILL.md.
        if (view !== undefined) return facts([description]);
        return withPointer(
          seg,
          pointerLine(
            seg,
            `Read ${pathRef(env, env.pathOf(ic.entryAbs))} and follow it when the task matches.`,
          ),
        );
      }
      if (mode === 'inline') return facts(skillInlineBody(seg, ic, level, env));
      // `install` while the skill is not placed: the commands; placed (a stale mode): just say where it is
      return facts([description, ...(view === undefined ? skillInstallBody(seg, ic, env) : [])]);
    }
    case 'local-repo':
    case 'local-folder': {
      const local = ic.local;
      const out = [infoBody(c), detailsLine(seg, env)];
      if (local !== undefined && !local.exists) {
        out.push(`The path ${inlineCode(local.target)} does not exist on this machine.`);
      } else if (local !== undefined) {
        out.push(...treeLines(seg, ic, pathRef(env, env.pathOf(local.target), true)));
      }
      return facts(out);
    }
    case 'remote-repo': {
      const ref = meta.ref;
      const out = [infoBody(c), detailsLine(seg, env)];
      if (
        view === undefined &&
        mode === 'clone' &&
        ref !== undefined &&
        ref.type === 'remote-repo'
      ) {
        out.push(...cloneCommands(seg, ref, env.root));
      }
      return facts(out);
    }
    case 'remote-skill': {
      const ref = meta.ref;
      const out = [infoBody(c), detailsLine(seg, env)];
      if (
        view === undefined &&
        mode === 'install' &&
        ref !== undefined &&
        ref.type === 'remote-skill'
      ) {
        out.push(...installCommands(seg, ref, env));
      }
      return facts(out);
    }
  }
}

// ---------------------------------------------------------------- segments

function renderSegment(
  segment: Segment,
  plan: ExpandedPlan,
  env: Env,
): { text: string; title: string } {
  switch (segment.type) {
    case 'context-intro': {
      const lines = [`## Context: ${segment.title}`];
      if (segment.description.trim() !== '') lines.push(segment.description.trim());
      if (segment.crossRefs.length > 0) {
        const refs = segment.crossRefs.map((key) => {
          const target = plan.segments.find((s) => s.key === key);
          const title = target?.type === 'item' ? target.title : key;
          return `**${title}** (${inlineCode(key)})`;
        });
        lines.push(`Also relevant here, included in another section: ${refs.join(', ')}.`);
      }
      return { text: lines.join('\n\n'), title: segment.title };
    }
    case 'section-intro':
      return { text: `## ${segment.title}`, title: segment.title };
    case 'markdown': {
      // Nested under the group like the items there (## when ungrouped, ### inside a group).
      const body = trimBlankLines(normalizeText(segment.body));
      return {
        text: nestHeadings(body, segment.group === null ? 2 : 3),
        title: firstHeadingText(body) ?? `Markdown ${segment.id}`,
      };
    }
    case 'item':
      return { text: renderItem(segment, env), title: segment.title };
  }
}

// ---------------------------------------------------------------- working directory sections (plans/INFLATE_V3_PLAN.md §7.2)

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** ` — ${description}` (whitespace collapsed) or '' when the description is blank. */
const dashed = (description: string): string => {
  const flat = collapse(description);
  return flat === '' ? '' : ` — ${flat}`;
};

const isRepoKind = (kind: ItemKind): boolean => kind === 'local-repo' || kind === 'remote-repo';
const isSkillKind = (kind: ItemKind): boolean => kind === 'skill' || kind === 'remote-skill';
/** Repositories and local folders: listed `editable` or `read-only`. */
const hasAccess = (kind: ItemKind): boolean => isRepoKind(kind) || kind === 'local-folder';

/** `owner: me|not me` as a ` · `-prefixed suffix; '' when the owner is unknown. */
const ownerPart = (view: MaterialView): string =>
  view.owner === null ? '' : ` · owner: ${OWNER_LABELS[view.owner]}`;

/** `git` → cloned, `archive` → downloaded: how a remote skill is fetched; null when the URI kind is unknown. */
function fetchWord(view: MaterialView): 'cloned' | 'downloaded' | null {
  const kind = view.uriKind ?? (view.uri === null ? null : classifyRemoteUri(view.uri));
  return kind === 'archive' ? 'downloaded' : kind === 'git' ? 'cloned' : null;
}

/** How a placed item got into the directory: the word of facts lines and of the Placement legend. */
function placementWord(view: MaterialView): string {
  switch (view.kind) {
    case 'remote-repo':
      return 'git clone';
    case 'remote-skill':
      return fetchWord(view) ?? 'installed';
    default:
      // okf, local skills, local repositories and local folders: a symlink or a copy
      return view.material === 'copy' ? 'copy' : 'symlink';
  }
}

/** The note of a map row: the placement word, with the clone details. */
function placement(view: MaterialView): string {
  return view.kind === 'remote-repo'
    ? `git clone${view.sparse ? ', sparse' : ''}${view.branch === null ? '' : `, branch ${view.branch}`}`
    : placementWord(view);
}

/**
 * May the session change this repository or folder? A cloned remote repository only when it is there; a local
 * repository or folder stays where it is (also when it is not placed or its link failed), so the flag counts
 * there too.
 */
function access(view: MaterialView | undefined): 'editable' | 'read-only' {
  if (view === undefined || view.edit !== true) return 'read-only';
  return view.kind === 'remote-repo' && !isPlacedView(view) ? 'read-only' : 'editable';
}

function directoryMap(dir: DirEnv, target: TargetDef): string {
  const { files, contextFile } = dir.output;
  const rows: { name: string; note?: string }[] = [{ name: contextFile, note: 'this file' }];
  const fileNotes: Record<Exclude<FileRole, 'context'>, string> = {
    'claude-md': 'loads this file',
    'agents-md': 'points to this file',
    gitignore: 'ignores the machine-specific paths below',
  };
  for (const role of ['claude-md', 'agents-md', 'gitignore'] as const) {
    const file = files.find((f) => f.role === role);
    if (file !== undefined) rows.push({ name: file.path, note: fileNotes[role] });
  }
  const placed = dir.views.filter(isPlacedView);
  const group = (name: string, views: readonly MaterialView[]): void => {
    if (views.length === 0) return;
    rows.push({ name });
    for (const view of views) {
      const last = (view.dest ?? '').split('/').pop() ?? '';
      const description = truncateText(view.description, 56);
      const note = [
        placement(view),
        ...(dir.primary === view.key ? ['primary'] : []),
        ...(hasAccess(view.kind) && access(view) === 'editable' ? ['editable'] : []),
        ...(description === '' ? [] : [description]),
      ].join(' · ');
      rows.push({ name: `  ${last}/`, note });
    }
  };
  group(
    `${REPOS_DIR}/`,
    placed.filter((v) => isRepoKind(v.kind)),
  );
  group(
    `${FOLDERS_DIR}/`,
    placed.filter((v) => v.kind === 'local-folder'),
  );
  for (const ds of OKF_DATASET_IDS) {
    group(
      `${ds}/`,
      placed.filter((v) => v.kind === ds),
    );
  }
  group(
    `${target.skillsDir}/`,
    placed.filter((v) => isSkillKind(v.kind)),
  );
  return `${headingText(2, 'Working directory map')}\n\n${fenced(alignRows(rows).join('\n'), 'text')}`;
}

/** `## Placement`: what symlink / copy / clone mean here, only for the placements that occur. */
function placementSection(dir: DirEnv): string {
  const placed = dir.views.filter(isPlacedView);
  const bullets: string[] = [];
  if (placed.some((v) => v.material === 'symlink')) {
    const folder = placed.some((v) => v.material === 'symlink' && v.kind === 'local-folder');
    bullets.push(
      `- **symlink**: the original folder, live; edits change the source (your ctxman entry${folder ? ', local repository or local folder' : ' or local repository'}).`,
    );
  }
  if (placed.some((v) => v.material === 'copy')) {
    bullets.push(
      '- **copy**: a snapshot taken when this directory was inflated; edits stay here and are replaced by the next inflate.',
    );
  }
  if (placed.some((v) => v.material === 'clone')) {
    bullets.push(
      '- **git clone**: a checkout of the remote repository; the next inflate pulls (fast-forward only) and keeps local changes and unpushed commits.',
    );
  }
  const fetched = placed.filter((v) => v.kind === 'remote-skill').map(fetchWord);
  const words = (['downloaded', 'cloned'] as const).filter((w) => fetched.includes(w));
  if (fetched.length > 0) {
    bullets.push(
      `- ${(words.length === 0 ? ['installed'] : words).map((w) => `**${w}**`).join(' / ')} skill: fetched from its URI and copied in without history; replaced by the next inflate.`,
    );
  }
  if (dir.views.some((v) => !isPlacedView(v))) {
    bullets.push(
      '- **not placed**: outside this directory; open the absolute path, or fetch the URI only when the task needs it.',
    );
  }
  const repos = dir.views.some((v) => isRepoKind(v.kind));
  const folders = dir.views.some((v) => v.kind === 'local-folder');
  if (repos || folders) {
    const what = repos && folders ? 'repositories and folders' : repos ? 'repositories' : 'folders';
    bullets.push(
      `- **editable** ${what} may be changed for this task; **read-only** ones are reference material: read them, do not change them.`,
    );
  }
  if (dir.views.some((v) => familyOf(v.kind) === 'okf' || v.kind === 'skill')) {
    bullets.push(
      '- Knowledge, work items and skills from ctxman are your own notes; `owner` says whether a repository or remote skill is yours.',
    );
  }
  return bullets.length === 0 ? '' : `${headingText(2, 'Placement')}\n\n${bullets.join('\n')}`;
}

function primarySection(view: MaterialView): string {
  const dest = view.dest ?? '';
  const link = pathLink(dest, { folder: true });
  const editable = access(view) === 'editable';
  const source =
    view.material === 'clone'
      ? `git clone of ${inlineCode(view.uri ?? '')}, ` +
        ((view.depth ?? 1) > 0 ? `shallow (depth ${view.depth ?? 1})` : 'full history') +
        (view.branch === null ? '' : `, branch ${inlineCode(view.branch)}`) +
        (view.sparse && view.subpath !== null
          ? `, sparse checkout of ${inlineCode(view.subpath)}`
          : '')
      : `${view.material === 'copy' ? 'copy of' : 'symlink to'} ${inlineCode(view.sourceAbs ?? '')}`;
  const facts = [`- Source: ${source}`];
  if (view.subpath !== null) {
    facts.push(`- Start in: ${pathLink(`${dest}/${view.subpath}`, { folder: true })}`);
  }
  return [
    headingText(2, 'Primary repository'),
    `**${view.title}** · ${link} · ${inlineCode(view.key)}${ownerPart(view)} · ${access(view)}`,
    collapse(view.description) === '' ? '' : view.description.trim(),
    facts.join('\n'),
    editable
      ? `Work in ${link} unless the task says otherwise.`
      : 'Read it to answer the task; it is read-only.',
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

/** One bullet of `## Repositories` / `## Folders`: where it is, how it got there, owner, access, description. */
function sourceBullet(view: MaterialView): string {
  const local = view.kind !== 'remote-repo';
  const placed = isPlacedView(view);
  const origin = local ? view.sourceAbs : view.uri;
  // abs paths of local repositories and folders are links, URIs stay in backticks
  const originRef =
    origin === null ? '' : local ? pathLink(origin, { folder: true }) : inlineCode(origin);
  const where = placed
    ? pathLink(view.dest ?? '', { folder: true })
    : view.state === 'failed'
      ? `not placed (${view.reason ?? 'the step failed'}): ${originRef}`
      : local
        ? `not placed: ${originRef}`
        : `not cloned: ${originRef}`;
  const how = !placed
    ? ''
    : local
      ? ` · ${view.material === 'copy' ? 'copy of' : 'symlink to'} ${inlineCode(view.sourceAbs ?? '')}`
      : ` · git clone of ${inlineCode(view.uri ?? '')}`;
  const relevant =
    view.subpath === null
      ? ''
      : ` · relevant path ${placed ? pathLink(`${view.dest}/${view.subpath}`, { folder: true }) : inlineCode(view.subpath)}`;
  return `- **${view.title}** · ${where}${how}${relevant}${ownerPart(view)} · ${access(view)}${dashed(view.description)}`;
}

function repositoriesSection(dir: DirEnv): string {
  const bullets = dir.views
    .filter((v) => isRepoKind(v.kind) && v.key !== dir.primary)
    .map(sourceBullet);
  return bullets.length === 0 ? '' : `${headingText(2, 'Repositories')}\n\n${bullets.join('\n')}`;
}

/** `## Folders`: every local folder (a plain folder, not a git repository), placed or not. */
function foldersSection(dir: DirEnv): string {
  const bullets = dir.views.filter((v) => v.kind === 'local-folder').map(sourceBullet);
  return bullets.length === 0 ? '' : `${headingText(2, 'Folders')}\n\n${bullets.join('\n')}`;
}

function skillsSection(dir: DirEnv, env: Env): string {
  const views = dir.views.filter((v) => isSkillKind(v.kind));
  if (views.length === 0) return '';
  const placed = views.filter(isPlacedView);
  const missing = views.filter((v) => !isPlacedView(v));
  const subpathOf = (view: MaterialView): string =>
    view.subpath === null ? '' : ` (${inlineCode(view.subpath)})`;
  const parts: string[] = [headingText(2, 'Skills')];
  if (placed.length > 0) {
    parts.push(env.target.skillsIntro);
    parts.push(
      placed
        .map((view) => {
          const how =
            view.kind === 'skill'
              ? `${view.material === 'copy' ? 'copy of' : 'symlink to'} the ctxman skill`
              : `${placementWord(view)} from ${inlineCode(view.uri ?? '')}${subpathOf(view)}`;
          return `- ${pathLink(view.dest ?? '', { folder: true })} · **${view.title}** · ${how}${ownerPart(view)}${dashed(view.description)}`;
        })
        .join('\n'),
    );
  }
  if (missing.length > 0) {
    parts.push('Not installed:');
    parts.push(
      missing
        .map((view) => {
          const local = view.kind === 'skill';
          const entry = local ? (env.content.items[view.key]?.entryAbs ?? view.sourceAbs) : null;
          const origin = local
            ? entry === null
              ? inlineCode(view.key)
              : pathLink(entry)
            : `${inlineCode(view.uri ?? '')}${subpathOf(view)}`;
          const source =
            view.state === 'failed'
              ? `not installed (${view.reason ?? 'the step failed'}): ${origin}`
              : origin;
          return `- **${view.title}** · ${source}${ownerPart(view)}${dashed(view.description)}`;
        })
        .join('\n'),
    );
  }
  return parts.join('\n\n');
}

const warningKey = (w: InflateWarning): string => `${w.code}\u0000${w.key ?? ''}\u0000${w.message}`;

/**
 * Renders the plan. Without `ctx.output` this is the single document with absolute paths; with it, the
 * working-directory document of plans/INFLATE_V3_PLAN.md §7 (paths relative to `output.dir` for every
 * mounted item, as markdown links).
 */
export function renderPlan(
  plan: ExpandedPlan,
  content: PlanContent,
  ctx: { generatedAt: string; output?: RenderOutput },
): InflateResult {
  const recipe = plan.recipe;
  const output = ctx.output;
  const target = TARGETS[output?.target ?? recipe.target];
  const pathOf = output === undefined ? identity : createPathMapper(output.materials);
  const primaryView = output?.primary == null ? undefined : output.materials[output.primary];
  const dirEnv: DirEnv | undefined =
    output === undefined
      ? undefined
      : {
          output,
          primary: primaryView !== undefined && isPlacedView(primaryView) ? primaryView.key : null,
          views: Object.values(output.materials),
        };
  const env: Env = {
    target,
    content,
    pathOf,
    targets:
      output === undefined
        ? content.targets
        : Object.fromEntries(
            Object.entries(content.targets).map(([key, ref]) => [
              key,
              ref === null ? null : { ...ref, abs: pathOf(ref.abs) },
            ]),
          ),
    root: output === undefined ? 'the project root' : 'this directory',
    warnings: [],
    ...(dirEnv === undefined ? {} : { dir: dirEnv }),
  };

  const headerLines =
    output === undefined || dirEnv === undefined
      ? [
          `# ${recipe.name}`,
          '',
          `> ${target.sessionLine}`,
          `> ${HEADER_PATHS_LINE}`,
          ...(target.skillsLine === null ? [] : [`> ${target.skillsLine}`]),
        ]
      : [
          `# ${recipe.name}`,
          '',
          `> ${target.sessionLine}`,
          `> This directory is the working root (${inlineCode(output.dir)}). Links and paths below are relative to it; absolute paths point outside it. Read the referenced files and run the listed commands only when the task needs them.`,
          ...(target.skillsLine === null ? [] : [`> ${target.skillsLine}`]),
          ...output.files.flatMap(({ path, role }) =>
            role === 'claude-md'
              ? [`> ${inlineCode(path)} in this directory loads this file.`]
              : role === 'agents-md'
                ? [`> ${inlineCode(path)} in this directory points to this file.`]
                : [],
          ),
        ];
  const header = headerLines.join('\n');
  const preamble = trimBlankLines(normalizeText(recipe.preamble ?? ''));
  const sections =
    dirEnv === undefined
      ? []
      : [
          directoryMap(dirEnv, target),
          placementSection(dirEnv),
          dirEnv.primary === null || primaryView === undefined ? '' : primarySection(primaryView),
          repositoriesSection(dirEnv),
          foldersSection(dirEnv),
          skillsSection(dirEnv, env),
        ];

  const rendered = plan.segments.map((segment) => ({
    segment,
    ...renderSegment(segment, plan, env),
  }));
  const markdown =
    [header, preamble, ...sections, ...rendered.map((r) => r.text)]
      .filter((part) => part !== '')
      .join('\n\n') + '\n';
  const bytes = byteLength(markdown);

  // Warnings found while rendering (unresolved links), deduped like every other stage.
  const renderedWarnings: InflateWarning[] = [];
  for (const w of env.warnings) {
    if (!renderedWarnings.some((seen) => warningKey(seen) === warningKey(w)))
      renderedWarnings.push(w);
  }

  const manifestSegments: ManifestSegment[] = rendered.map(({ segment, text, title }) => {
    const entry: ManifestSegment = {
      key: segment.key,
      type: segment.type,
      title,
      status: segment.status === 'loading' ? 'missing' : segment.status,
      via: [],
      adhoc: false,
      bytes: text === '' ? 0 : byteLength(text),
      warnings: [
        ...segment.warnings,
        ...[...content.warnings, ...renderedWarnings].filter(
          (w) =>
            w.key === segment.key && !segment.warnings.some((s) => warningKey(s) === warningKey(w)),
        ),
      ],
    };
    if (segment.type === 'item') {
      entry.dataset = segment.dataset;
      entry.slug = segment.slug;
      entry.via = [...segment.via];
      entry.adhoc = segment.adhoc;
      if (segment.kind !== null) entry.kind = segment.kind;
      const view = output?.materials[segment.key];
      if (segment.mode !== null && segment.kind !== null) {
        entry.mode = segment.mode;
        // The label of the mode list the item was rendered from: a placed item is "Summary + links" / "Link".
        const placed = view !== undefined && isPlacedView(view);
        const label = (
          modesForPlacement(segment.kind, placed).find((m) => m.id === segment.mode) ??
          modeDef(segment.kind, segment.mode)
        )?.label;
        if (label !== undefined) entry.modeLabel = label;
        entry.options = { ...segment.options };
      }
      const entryAbs = content.items[segment.key]?.entryAbs;
      if (entryAbs !== undefined) entry.source = entryAbs;
      if (view !== undefined) {
        entry.material = view.material;
        if (view.dest !== null) entry.dest = view.dest;
      }
    }
    return entry;
  });

  const items = plan.segments.filter((s): s is ItemSegment => s.type === 'item');
  const counts = { included: 0, excluded: 0, missing: 0 };
  for (const item of items) {
    if (item.status === 'included') counts.included++;
    else if (item.status === 'excluded') counts.excluded++;
    else counts.missing++;
  }

  const renderWarnings: InflateWarning[] = [...renderedWarnings];
  if (bytes > LARGE_OUTPUT_BYTES) {
    renderWarnings.push({
      code: 'large-output',
      message: `the document is ${Math.round(bytes / 1024)} KB (over 512 KB); use summary or pointer modes for large items`,
    });
  }
  const seen = new Set<string>();
  const warnings: InflateWarning[] = [];
  for (const w of [...plan.warnings, ...content.warnings, ...renderWarnings]) {
    const id = warningKey(w);
    if (seen.has(id)) continue;
    seen.add(id);
    warnings.push(w);
  }

  const manifest: InflateManifest = {
    recipe: recipe.name,
    target: recipe.target,
    layout: recipe.layout,
    generatedAt: ctx.generatedAt,
    bytes,
    counts,
    contexts: plan.contexts.map((c) => ({
      slug: c.slug,
      status: c.status === 'loading' ? 'missing' : c.status,
    })),
    segments: manifestSegments,
    warnings,
  };
  if (output !== undefined) {
    manifest.output = { dir: output.dir, contextFile: output.contextFile, primary: output.primary };
  }
  return { markdown, manifest };
}
