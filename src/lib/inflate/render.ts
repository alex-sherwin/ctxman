// NODE* (no fs calls of its own; imports src/lib/okf.ts through markdown.ts): renders an ExpandedPlan plus
// the gathered file contents into ONE markdown document and a JSON manifest (plans/INFLATE_SPEC.md §6.3).
// With `ctx.output` (a working directory, plans/INFLATE_V2_SPEC.md §9) the same document is rendered with paths
// relative to the directory and the directory map / primary / repositories / skills sections; without it the
// output is the single document with absolute paths. Brief quality (plans/ROUND3_SPEC.md §H): the entry
// description is printed when the body lacks it, empty template sections are dropped, markdown blocks nest
// under their group, links that do not resolve become `unresolved-link` warnings. Never import from the
// browser island.
import {
  OKF_DATASET_IDS,
  OKF_ENTRY_FILE,
  OWNER_LABELS,
  stateLabel,
} from '../../datasets/registry.ts';
import { maskMarkdownCode, parseFrontmatterLoose, splitFrontmatter } from '../okf.ts';
import { classifyRemoteUri } from '../remote-uri.ts';
import { ITEM_KIND_LABELS, OPTION_DEFS, REPOS_DIR, TARGETS, modeDef } from './catalog.ts';
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

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

const HEADER_PATHS_LINE =
  'Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.';

// ---------------------------------------------------------------- small helpers

const flag = (options: Partial<InflateOptions>, id: BooleanOptionId): boolean =>
  options[id] ?? (OPTION_DEFS[id].default as boolean);

const shBlock = (lines: readonly string[]): string => fenced(lines.join('\n'), 'sh');

const listLines = (rows: readonly { rel: string; abs: string }[]): string =>
  rows.map((row) => `- ${inlineCode(row.rel)} — ${inlineCode(row.abs)}`).join('\n');

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

// ---------------------------------------------------------------- item rendering

interface DirEnv {
  output: RenderOutput;
  /** Valid, not failed primary key. */
  primary: string | null;
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

/** The view of an item that is placed in the directory (dest known, not failed); undefined otherwise. */
function placedView(seg: ItemSegment, env: Env): MaterialView | undefined {
  const view = env.dir?.output.materials[seg.key];
  return view !== undefined && view.dest !== null && view.state !== 'failed' ? view : undefined;
}

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
 * absolute (unresolved ones reported) → trimmed.
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

function pointerLine(seg: ItemSegment, tail: string): string {
  const description = (seg.meta?.description ?? '').trim();
  const label = seg.kind === null ? '' : ITEM_KIND_LABELS[seg.kind];
  return `${inlineCode(seg.key)} · ${label} · ${description === '' ? '' : `${description} `}${tail}`;
}

function renderItem(seg: ItemSegment, env: Env): string {
  const { kind, mode, meta } = seg;
  if (seg.status !== 'included' || kind === null || mode === null || meta === null) return '';
  const ic = env.content.items[seg.key];
  if (ic === undefined) return '';
  const p = env.pathOf;
  const placed = placedView(seg, env);
  const level = seg.group === null ? 2 : 3;
  const options = seg.options;
  const description = meta.description.trim();
  const parts: string[] = [headingText(level, seg.title)];
  const withMeta = (location: string | null, body: readonly string[]): void => {
    parts.push(metaLine(seg, location));
    const notes = guidance(seg.notes);
    if (notes !== '') parts.push(notes);
    parts.push(...body.filter((p) => p !== ''));
  };
  const withPointer = (line: string): void => {
    parts.push(line);
    const notes = guidance(seg.notes);
    if (notes !== '') parts.push(notes);
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
          ? env.target.eagerClause(p(ic.entryAbs))
          : `Read ${inlineCode(p(ic.entryAbs))} if relevant.`;
        withPointer(pointerLine(seg, tail));
      } else if (mode === 'summary') {
        withMeta(p(ic.entryAbs), [description]);
      } else {
        withMeta(p(ic.entryAbs), okfBody(seg, ic, level, env));
      }
      break;
    }
    case 'skill': {
      if (mode === 'pointer') {
        const tail = flag(options, 'eager')
          ? env.target.eagerClause(p(ic.entryAbs))
          : `Read ${inlineCode(p(ic.entryAbs))} and follow it when the task matches.`;
        withPointer(pointerLine(seg, tail));
      } else if (mode === 'inline') {
        withMeta(p(ic.entryAbs), skillInlineBody(seg, ic, level, env));
      } else if (placed?.dest !== undefined && placed.dest !== null) {
        withMeta(p(ic.rootAbs), [description, `Installed at ${inlineCode(`${placed.dest}/`)}.`]);
      } else {
        const dest = `${env.target.skillsDir}/${seg.slug}`;
        const lines = [
          `mkdir -p ${shQuote(env.target.skillsDir)}`,
          `${options.symlink === true ? 'ln -s' : 'cp -R'} ${shQuote(ic.rootAbs)} ${shQuote(dest)}`,
        ];
        withMeta(ic.rootAbs, [
          description,
          `Install this skill into the project (run from ${env.root}):`,
          shBlock(lines),
        ]);
      }
      break;
    }
    case 'local-repo': {
      if (placed?.dest != null) {
        withMeta(placed.dest, localPlacedBody(seg, ic, description, placed.dest, env));
      } else {
        withMeta(ic.local?.root ?? null, localBody(seg, ic, description));
      }
      break;
    }
    case 'remote-repo': {
      if (placed?.dest != null) {
        withMeta(
          placed.dest,
          remotePlacedBody(description, placed, placed.dest, env.dir?.primary === seg.key),
        );
      } else {
        withMeta(
          meta.ref !== undefined && 'uri' in meta.ref ? meta.ref.uri : null,
          remoteRepoBody(seg, description, env.root),
        );
      }
      break;
    }
    case 'remote-skill': {
      if (placed?.dest != null) {
        withMeta(placed.dest, [
          description,
          `Installed at ${inlineCode(`${placed.dest}/`)} from ${inlineCode(placed.uri ?? '')}.`,
        ]);
      } else {
        withMeta(
          meta.ref !== undefined && 'uri' in meta.ref ? meta.ref.uri : null,
          remoteSkillBody(seg, description, env),
        );
      }
      break;
    }
  }
  const failed = env.dir?.output.materials[seg.key];
  if (failed?.state === 'failed') {
    parts.push(`Not placed in this directory: ${failed.reason ?? 'the step failed'}.`);
  }
  return parts.join('\n\n');
}

// ---- okf

/** Lower case, whitespace collapsed: how the description is looked for in a rendered body. */
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

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
      out.push(
        `More in this bundle (under ${inlineCode(env.pathOf(ic.rootAbs))}): ${concepts.map((c) => inlineCode(c)).join(', ')}.`,
      );
    }
    return out;
  }

  // inline-bundle
  const section = (heading: string, rel: string, text: string, title: string): void => {
    out.push(headingText(level + 1, heading));
    out.push(`${inlineCode(rel)} · ${inlineCode(files.get(rel) ?? rel)}`);
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
  if (others.length > 0) out.push('Other files in this bundle:', listLines(others));
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
      `Files in this skill (under ${inlineCode(env.pathOf(ic.rootAbs))}):`,
      listLines(others),
    );
  }
  return out;
}

// ---- local repo

function localBody(seg: ItemSegment, ic: ItemContent, description: string): string[] {
  const local = ic.local;
  const ref = seg.meta?.ref;
  if (local === undefined) return [description];
  const subpath = ref !== undefined && 'subpath' in ref ? cleanSubpath(ref.subpath) : '';
  const out = [
    description,
    subpath === ''
      ? `Read the code at ${inlineCode(local.target)} when the task needs it.`
      : `Read the code at ${inlineCode(local.target)} (inside the repository ${inlineCode(local.root)}) when the task needs it.`,
  ];
  if (!local.exists) {
    out.push(`The path ${inlineCode(local.target)} does not exist on this machine.`);
    return out;
  }
  out.push(...treeLines(seg, ic, local.target));
  return out;
}

/** Tree mode: the top-level entries of the local path (titled `label`); [] for any other mode. */
function treeLines(seg: ItemSegment, ic: ItemContent, label: string): string[] {
  if (seg.mode !== 'tree' || ic.tree == null) return [];
  const limit = seg.options.treeLimit ?? (OPTION_DEFS.treeLimit.default as number);
  const shown = ic.tree.entries.slice(0, limit);
  const out = [`Top-level entries of ${inlineCode(label)} (${shown.length} of ${ic.tree.total}):`];
  if (shown.length > 0) {
    out.push(fenced(shown.map((e) => (e.dir ? `${e.name}/` : e.name)).join('\n'), 'text'));
  }
  return out;
}

/** Working directory: the repository is a symlink at `dest`, so the tree is titled with the relative path. */
function localPlacedBody(
  seg: ItemSegment,
  ic: ItemContent,
  description: string,
  dest: string,
  env: Env,
): string[] {
  const local = ic.local;
  if (local === undefined) return [description];
  return [
    description,
    `Linked at ${inlineCode(dest)} → ${inlineCode(local.root)}.`,
    ...treeLines(seg, ic, env.pathOf(local.target)),
  ];
}

// ---- remote repo / skill

/** Working directory: the repository is cloned at `dest`. */
function remotePlacedBody(
  description: string,
  view: MaterialView,
  dest: string,
  primary: boolean,
): string[] {
  const out = [
    description,
    primary
      ? `Cloned at ${inlineCode(dest)} (the primary repository).`
      : `Cloned at ${inlineCode(dest)}.`,
  ];
  if (view.subpath !== null) out.push(`Relevant path ${inlineCode(`${dest}/${view.subpath}`)}.`);
  return out;
}

function remoteRepoBody(seg: ItemSegment, description: string, root: string): string[] {
  const ref = seg.meta?.ref;
  if (ref === undefined || ref.type !== 'remote-repo') return [description];
  const subpath = cleanSubpath(ref.subpath);
  if (seg.mode !== 'clone') {
    return [
      description,
      `Git repository ${inlineCode(ref.uri)}${subpath === '' ? '' : `, relevant path ${inlineCode(subpath)}`}. Clone it only if the task needs its contents.`,
    ];
  }
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
    description,
    `Clone it into the project (run from ${root}; keep \`.ctxman/\` out of version control):`,
    shBlock(lines),
  ];
  if (subpath !== '') out.push(`Then read ${inlineCode(`${dir}/${subpath}`)}.`);
  return out;
}

function remoteSkillBody(seg: ItemSegment, description: string, env: Env): string[] {
  const ref = seg.meta?.ref;
  if (ref === undefined || ref.type !== 'remote-skill') return [description];
  const subpath = cleanSubpath(ref.subpath);
  const archive = classifyRemoteUri(ref.uri) === 'archive';
  if (seg.mode === 'describe') {
    const lead = archive
      ? `Agent skill packaged as an archive at ${inlineCode(ref.uri)}`
      : `Agent skill in the git repository ${inlineCode(ref.uri)}`;
    return [
      description,
      `${lead}${subpath === '' ? '' : ` (skill folder ${inlineCode(subpath)})`}. Install it only if the task needs it.`,
    ];
  }

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
    description,
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

// ---------------------------------------------------------------- working directory sections (spec §9.3-§9.5)

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** ` — ${description}` (whitespace collapsed) or '' when the description is blank. */
const dashed = (description: string): string => {
  const flat = collapse(description);
  return flat === '' ? '' : ` — ${flat}`;
};

/** The views in segment order that have a placed dest (not failed). */
const placedViews = (dir: DirEnv): MaterialView[] =>
  Object.values(dir.output.materials).filter((v) => v.dest !== null && v.state !== 'failed');

const isRepoKind = (kind: ItemKind): boolean => kind === 'local-repo' || kind === 'remote-repo';
const isSkillKind = (kind: ItemKind): boolean => kind === 'skill' || kind === 'remote-skill';

/** How a placed item got there (the note of a map row). */
function placement(view: MaterialView): string {
  switch (view.kind) {
    case 'local-repo':
      return 'symlink';
    case 'remote-repo':
      return `git clone${view.sparse ? ', sparse' : ''}${view.branch === null ? '' : `, branch ${view.branch}`}`;
    case 'remote-skill':
      return 'installed';
    case 'skill':
      return 'copy';
    default:
      return view.material === 'symlink' ? 'symlink' : 'copy';
  }
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
  const placed = placedViews(dir);
  const group = (name: string, views: readonly MaterialView[]): void => {
    if (views.length === 0) return;
    rows.push({ name });
    for (const view of views) {
      const last = (view.dest ?? '').split('/').pop() ?? '';
      const description = truncateText(view.description, 56);
      const note = [
        placement(view),
        ...(dir.primary === view.key ? ['primary'] : []),
        ...(description === '' ? [] : [description]),
      ].join(' · ');
      rows.push({ name: `  ${last}/`, note });
    }
  };
  group(
    `${REPOS_DIR}/`,
    placed.filter((v) => isRepoKind(v.kind)),
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

function primarySection(view: MaterialView): string {
  const owner = view.owner === null ? '' : ` · owner: ${OWNER_LABELS[view.owner]}`;
  const dest = view.dest ?? '';
  const source =
    view.material === 'clone'
      ? `git clone of ${inlineCode(view.uri ?? '')}, ` +
        ((view.depth ?? 1) > 0 ? `shallow (depth ${view.depth ?? 1})` : 'full history') +
        (view.branch === null ? '' : `, branch ${inlineCode(view.branch)}`) +
        (view.sparse && view.subpath !== null
          ? `, sparse checkout of ${inlineCode(view.subpath)}`
          : '')
      : `symlink to ${inlineCode(view.sourceAbs ?? '')}`;
  const facts = [`- Source: ${source}`];
  if (view.subpath !== null) facts.push(`- Start in: ${inlineCode(`${dest}/${view.subpath}`)}`);
  return [
    headingText(2, 'Primary repository'),
    `**${view.title}** · ${inlineCode(dest)} · ${inlineCode(view.key)}${owner}`,
    collapse(view.description) === '' ? '' : view.description.trim(),
    facts.join('\n'),
    `Work in ${inlineCode(dest)} unless the task says otherwise.`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

function repositoriesSection(dir: DirEnv): string {
  const bullets = Object.values(dir.output.materials)
    .filter((v) => isRepoKind(v.kind) && v.key !== dir.primary)
    .map((view) => {
      const placed = view.dest !== null && view.state !== 'failed';
      const origin = view.kind === 'remote-repo' ? view.uri : view.sourceAbs;
      const local = view.kind === 'local-repo';
      const where = placed
        ? view.kind === 'remote-repo'
          ? `${inlineCode(view.dest ?? '')} (git clone of ${inlineCode(view.uri ?? '')})`
          : `${inlineCode(view.dest ?? '')} (symlink to ${inlineCode(view.sourceAbs ?? '')})`
        : view.state === 'failed'
          ? `not placed (${view.reason ?? 'the step failed'}): ${inlineCode(origin ?? '')}`
          : `${local ? 'not linked' : 'not cloned'}: ${inlineCode(origin ?? '')}`;
      const relevant =
        view.subpath === null
          ? ''
          : ` · relevant path ${inlineCode(placed ? `${view.dest}/${view.subpath}` : view.subpath)}`;
      const owner = view.owner === null ? '' : ` · owner: ${OWNER_LABELS[view.owner]}`;
      return `- **${view.title}** · ${where}${relevant} · ${inlineCode(view.key)}${owner}${dashed(view.description)}`;
    });
  return bullets.length === 0 ? '' : `${headingText(2, 'Repositories')}\n\n${bullets.join('\n')}`;
}

function skillsSection(dir: DirEnv, env: Env): string {
  const views = Object.values(dir.output.materials).filter((v) => isSkillKind(v.kind));
  if (views.length === 0) return '';
  const placed = views.filter((v) => v.dest !== null && v.state !== 'failed');
  const missing = views.filter((v) => !placed.includes(v));
  const parts: string[] = [headingText(2, 'Skills')];
  if (placed.length > 0) {
    parts.push(env.target.skillsIntro);
    parts.push(
      placed
        .map((view) => {
          const subpath = view.subpath === null ? '' : ` (${inlineCode(view.subpath)})`;
          const how =
            view.kind === 'skill'
              ? `copy of ${inlineCode(view.key)}`
              : `from ${inlineCode(view.uri ?? '')}${subpath}`;
          return `- ${inlineCode(`${view.dest}/`)} · **${view.title}** · ${how}${dashed(view.description)}`;
        })
        .join('\n'),
    );
  }
  if (missing.length > 0) {
    parts.push('Not installed:');
    parts.push(
      missing
        .map((view) => {
          const subpath = view.subpath === null ? '' : ` (${inlineCode(view.subpath)})`;
          const origin =
            view.kind === 'skill'
              ? inlineCode(env.content.items[view.key]?.entryAbs ?? view.sourceAbs ?? view.key)
              : `${inlineCode(view.uri ?? '')}${subpath}`;
          const source =
            view.state === 'failed'
              ? `not installed (${view.reason ?? 'the step failed'}): ${origin}`
              : origin;
          return `- **${view.title}** · ${inlineCode(view.key)} · ${source}${dashed(view.description)}`;
        })
        .join('\n'),
    );
  }
  return parts.join('\n\n');
}

const warningKey = (w: InflateWarning): string => `${w.code}\u0000${w.key ?? ''}\u0000${w.message}`;

/**
 * Renders the plan. Without `ctx.output` this is the single document with absolute paths; with it, the
 * working-directory document of plans/INFLATE_V2_SPEC.md §9 (paths relative to `output.dir` for every
 * mounted item).
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
          primary:
            primaryView !== undefined && primaryView.dest !== null && primaryView.state !== 'failed'
              ? primaryView.key
              : null,
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
          `> This directory is the working root (${inlineCode(output.dir)}). Relative paths below are relative to it; absolute paths point outside it. Read the referenced files and run the listed commands only when the task needs them.`,
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
          dirEnv.primary === null || primaryView === undefined ? '' : primarySection(primaryView),
          repositoriesSection(dirEnv),
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
      if (segment.mode !== null && segment.kind !== null) {
        entry.mode = segment.mode;
        const label = modeDef(segment.kind, segment.mode)?.label;
        if (label !== undefined) entry.modeLabel = label;
        entry.options = { ...segment.options };
      }
      const entryAbs = content.items[segment.key]?.entryAbs;
      if (entryAbs !== undefined) entry.source = entryAbs;
      const view = output?.materials[segment.key];
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
