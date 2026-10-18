// NODE* (no fs calls of its own; imports src/lib/okf.ts through markdown.ts): renders an ExpandedPlan plus
// the gathered file contents into ONE markdown document and a JSON manifest (plans/INFLATE_SPEC.md §6.3).
// Never import from the browser island.
import { OWNER_LABELS, stateLabel } from '../../datasets/registry.ts';
import { maskMarkdownCode, parseFrontmatterLoose, splitFrontmatter } from '../okf.ts';
import { classifyRemoteUri } from '../remote-uri.ts';
import { ITEM_KIND_LABELS, OPTION_DEFS, TARGETS, modeDef } from './catalog.ts';
import type {
  BooleanOptionId,
  InflateLayout,
  InflateOptions,
  InflateTarget,
  ItemKind,
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
import { normalizeText } from './recipe.ts';
import {
  fenced,
  guidance,
  headingText,
  inlineCode,
  rewriteLinks,
  shQuote,
  shiftHeadings,
  stripLeadingTitle,
} from './markdown.ts';
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
}

export interface InflateResult {
  markdown: string;
  manifest: InflateManifest;
}

export const LARGE_OUTPUT_BYTES = 512 * 1024;

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

const HEADER_PATHS_LINE =
  'Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.';

// ---------------------------------------------------------------- small helpers

const flag = (options: Partial<InflateOptions>, id: BooleanOptionId): boolean =>
  options[id] ?? (OPTION_DEFS[id].default as boolean);

/** `subpath` trimmed with leading / trailing slashes removed; '' when absent. */
function cleanSubpath(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
}

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

interface Env {
  target: TargetDef;
  content: PlanContent;
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
}

/** frontmatter dropped → leading title dropped → headings shifted → links made absolute → trimmed. */
function renderBody(a: BodyArgs): string {
  const text = a.text.replace(/\r\n?/g, '\n');
  let body = splitFrontmatter(text)?.body ?? text;
  body = stripLeadingTitle(body, a.title);
  if (flag(a.options, 'shiftHeadings')) body = shiftHeadings(body, a.base);
  if (flag(a.options, 'rewriteLinks')) {
    body = rewriteLinks(body, { fromRel: a.fromRel, files: a.files, targets: a.targets });
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
          ? env.target.eagerClause(ic.entryAbs)
          : `Read ${inlineCode(ic.entryAbs)} if relevant.`;
        withPointer(pointerLine(seg, tail));
      } else if (mode === 'summary') {
        withMeta(ic.entryAbs, [description]);
      } else {
        withMeta(ic.entryAbs, okfBody(seg, ic, level, env));
      }
      break;
    }
    case 'skill': {
      if (mode === 'pointer') {
        const tail = flag(options, 'eager')
          ? env.target.eagerClause(ic.entryAbs)
          : `Read ${inlineCode(ic.entryAbs)} and follow it when the task matches.`;
        withPointer(pointerLine(seg, tail));
      } else if (mode === 'inline') {
        withMeta(ic.entryAbs, skillInlineBody(seg, ic, level, env));
      } else {
        const dest = `${env.target.skillsDir}/${seg.slug}`;
        const lines = [
          `mkdir -p ${shQuote(env.target.skillsDir)}`,
          `${options.symlink === true ? 'ln -s' : 'cp -R'} ${shQuote(ic.rootAbs)} ${shQuote(dest)}`,
        ];
        withMeta(ic.rootAbs, [
          description,
          'Install this skill into the project (run from the project root):',
          shBlock(lines),
        ]);
      }
      break;
    }
    case 'local-repo': {
      withMeta(ic.local?.root ?? null, localBody(seg, ic, description));
      break;
    }
    case 'remote-repo': {
      withMeta(
        meta.ref !== undefined && 'uri' in meta.ref ? meta.ref.uri : null,
        remoteRepoBody(seg, description),
      );
      break;
    }
    case 'remote-skill': {
      withMeta(
        meta.ref !== undefined && 'uri' in meta.ref ? meta.ref.uri : null,
        remoteSkillBody(seg, description, env),
      );
      break;
    }
  }
  return parts.join('\n\n');
}

// ---- okf

function okfBody(seg: ItemSegment, ic: ItemContent, level: number, env: Env): string[] {
  const options = seg.options;
  const files = new Map((ic.files ?? []).map((f) => [f.rel, f.abs] as const));
  const targets = env.content.targets;
  const main = ic.texts?.['main.md'];
  const out: string[] = [];
  const concepts = ic.concepts ?? [];

  if (main !== undefined && main !== null) {
    out.push(frontmatterBlock(main, options));
    out.push(
      renderBody({
        text: main,
        fromRel: 'main.md',
        title: seg.title,
        base: level + 1,
        options,
        files,
        targets,
      }),
    );
  }

  if (seg.mode === 'inline-main') {
    if (concepts.length > 0) {
      out.push(
        `More in this bundle (under ${inlineCode(ic.rootAbs)}): ${concepts.map((c) => inlineCode(c)).join(', ')}.`,
      );
    }
    return out;
  }

  // inline-bundle
  const section = (heading: string, rel: string, text: string, title: string): void => {
    out.push(headingText(level + 1, heading));
    out.push(`${inlineCode(rel)} · ${inlineCode(files.get(rel) ?? rel)}`);
    out.push(renderBody({ text, fromRel: rel, title, base: level + 2, options, files, targets }));
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
  const others = (ic.files ?? []).filter((f) => f.kind !== 'markdown');
  if (others.length > 0) out.push('Other files in this bundle:', listLines(others));
  return out;
}

// ---- skill

function skillInlineBody(seg: ItemSegment, ic: ItemContent, level: number, env: Env): string[] {
  const options = seg.options;
  const files = new Map((ic.files ?? []).map((f) => [f.rel, f.abs] as const));
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
        targets: env.content.targets,
      }),
    );
  }
  const others = (ic.files ?? []).filter((f) => f.rel !== 'SKILL.md');
  if (others.length > 0) {
    out.push(`Files in this skill (under ${inlineCode(ic.rootAbs)}):`, listLines(others));
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
  if (seg.mode === 'tree' && ic.tree != null) {
    const limit = seg.options.treeLimit ?? (OPTION_DEFS.treeLimit.default as number);
    const shown = ic.tree.entries.slice(0, limit);
    out.push(
      `Top-level entries of ${inlineCode(local.target)} (${shown.length} of ${ic.tree.total}):`,
    );
    if (shown.length > 0) {
      out.push(fenced(shown.map((e) => (e.dir ? `${e.name}/` : e.name)).join('\n'), 'text'));
    }
  }
  return out;
}

// ---- remote repo / skill

function remoteRepoBody(seg: ItemSegment, description: string): string[] {
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
    'Clone it into the project (run from the project root; keep `.ctxman/` out of version control):',
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
    `Install this skill into ${inlineCode(`${dest}/`)} (run from the project root):`,
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
    case 'markdown':
      return { text: trimBlankLines(normalizeText(segment.body)), title: `Markdown ${segment.id}` };
    case 'item':
      return { text: renderItem(segment, env), title: segment.title };
  }
}

const warningKey = (w: InflateWarning): string => `${w.code}\u0000${w.key ?? ''}\u0000${w.message}`;

export function renderPlan(
  plan: ExpandedPlan,
  content: PlanContent,
  ctx: { generatedAt: string },
): InflateResult {
  const recipe = plan.recipe;
  const target = TARGETS[recipe.target];
  const env: Env = { target, content };

  const header = [
    `# ${recipe.name}`,
    '',
    `> ${target.sessionLine}`,
    `> ${HEADER_PATHS_LINE}`,
    ...(target.skillsLine === null ? [] : [`> ${target.skillsLine}`]),
  ].join('\n');
  const preamble = trimBlankLines(normalizeText(recipe.preamble ?? ''));

  const rendered = plan.segments.map((segment) => ({
    segment,
    ...renderSegment(segment, plan, env),
  }));
  const markdown =
    [header, preamble, ...rendered.map((r) => r.text)].filter((part) => part !== '').join('\n\n') +
    '\n';
  const bytes = byteLength(markdown);

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
        ...content.warnings.filter(
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

  const renderWarnings: InflateWarning[] = [];
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

  return {
    markdown,
    manifest: {
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
    },
  };
}
