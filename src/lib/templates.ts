// PURE: file templates for `scripts/add-entry.ts` (PLAN.md §F.1). No fs; returns what to write.
// Frontmatter and yaml files are emitted through the `yaml` stringifier so values like
// "TODO: describe X." are quoted correctly (a raw `description: TODO: describe X.` is invalid YAML).
import { Document, isSeq } from 'yaml';
import {
  datasetDef,
  isReferenceType,
  isValidName,
  NAME_MAX_LENGTH,
  OKF_ENTRY_FILE,
  OWNERS,
} from '../datasets/registry.ts';
import type { DatasetId, Owner, ReferenceType } from '../datasets/registry.ts';
import { TAG_PATTERN } from './names.ts';
import { DEFAULT_SERVER_ORIGIN, isSchemaDatasetId, withSchemaComment } from './schema-comment.ts';
import { stringifyYaml } from './yaml.ts';

export interface NewEntryOptions {
  title?: string;
  description?: string;
  state?: string;
  /** okf only; written as `tags: [a, b]` (default `[]`). Each tag must match TAG_PATTERN. */
  tags?: readonly string[];
  type?: ReferenceType;
  path?: string;
  uri?: string;
  subpath?: string;
  owner?: Owner;
  /** snippet only: the markdown (default: a TODO placeholder). */
  markdown?: string;
  /** Origin of the schema modeline of yaml files (callers pass `resolveServerOrigin()`; default http://127.0.0.1:4321). */
  serverOrigin?: string;
  now: Date;
}

export interface PlannedFile {
  /** Data-dir-relative posix path, e.g. 'task/fix-login/index.md'. */
  relPath: string;
  content: string;
}

/** Message shown for an invalid entry name (UI_SPEC §H.6 wording). */
export const NAME_HELP = 'Use lowercase letters, digits and single hyphens, e.g. auth-refactor';

/** 'fix-login-bug' -> 'Fix login bug'. */
export function titleFromName(name: string): string {
  const spaced = name.replaceAll('-', ' ').trim();
  return spaced === '' ? spaced : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const SECTIONS: Record<string, readonly string[]> = {
  kb: ['Overview', 'Details'],
  rca: ['Summary', 'Timeline', 'Root cause', 'Resolution', 'Prevention'],
  idea: ['Problem', 'Proposal', 'Open questions'],
  task: ['Goal', 'Steps', 'Done when'],
  bug: ['Symptoms', 'Reproduction', 'Expected vs actual', 'Diagnosis', 'Fix'],
  feature: ['Motivation', 'Requirements', 'Design', 'Acceptance criteria'],
  project: ['Goals', 'Scope', 'Milestones', 'Related'],
};

const oneLine = (value: string): string => value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
/** Escapes characters that would end markdown link text early. */
export const linkText = (value: string): string => value.replace(/([\\[\]])/g, '\\$1');

/** okf frontmatter YAML: like `stringifyYaml`, but a non-empty `tags` list is a flow sequence (`tags: [a, b]`, as in the seeds). */
function okfFrontmatterYaml(frontmatter: Record<string, unknown>): string {
  const doc = new Document(frontmatter);
  const tags = doc.get('tags', true);
  if (isSeq(tags)) tags.flow = true;
  return doc.toString({ blockQuote: 'literal', lineWidth: 0, flowCollectionPadding: false });
}

/**
 * Files to create for a new entry of `dataset`. Throws `Error` with a user-facing message on an invalid
 * name, state or reference type. Defaults: title from the name; description `TODO: describe <title>.`;
 * state = first lifecycle state; reference type remote-repo, owner me, path ~/repos/<name>
 * (local-repo) or ~/<name> (local-folder), uri https://github.com/TODO/<name>.git; snippet markdown
 * `TODO: write the <title> snippet.`.
 */
export function planNewEntry(
  dataset: DatasetId,
  name: string,
  opts: NewEntryOptions,
): PlannedFile[] {
  if (!isValidName(name)) {
    throw new Error(
      name.length > NAME_MAX_LENGTH
        ? `Name is too long (${NAME_MAX_LENGTH} characters max)`
        : NAME_HELP,
    );
  }
  const def = datasetDef(dataset);
  const title = oneLine(opts.title ?? '') || titleFromName(name);
  const description = oneLine(opts.description ?? '') || `TODO: describe ${title}.`;

  if (opts.state !== undefined) {
    if (!def.states) throw new Error(`${dataset} entries have no lifecycle state`);
    if (!def.states.some((s) => s.id === opts.state)) {
      throw new Error(
        `Invalid state "${opts.state}" for ${dataset}; use one of: ${def.states.map((s) => s.id).join(', ')}`,
      );
    }
  }
  if (opts.type !== undefined && dataset !== 'reference') {
    throw new Error('type only applies to reference entries');
  }
  if (opts.markdown !== undefined && dataset !== 'snippet') {
    throw new Error('markdown only applies to snippet entries');
  }
  if (opts.tags !== undefined) {
    if (def.kind !== 'okf' && opts.tags.length > 0) {
      throw new Error('tags only apply to okf entries');
    }
    const bad = opts.tags.find((tag) => !TAG_PATTERN.test(tag));
    if (bad !== undefined) {
      throw new Error(`Invalid tag "${bad}"; use lowercase letters, digits and hyphens`);
    }
  }

  switch (def.kind) {
    case 'okf': {
      const state = def.states ? (opts.state ?? def.states[0]?.id) : undefined;
      const frontmatter: Record<string, unknown> = {
        okf_version: '0.2',
        type: def.okfType,
        name,
        title,
        description,
      };
      if (state !== undefined) frontmatter.state = state;
      frontmatter.tags = [...(opts.tags ?? [])];
      frontmatter.generated = { by: 'process:ctxman-add-entry', at: opts.now.toISOString() };
      const sections = (SECTIONS[dataset] ?? []).map((h) => `## ${h}\n`).join('\n');
      return [
        {
          relPath: `${dataset}/${name}/${OKF_ENTRY_FILE}`,
          content: `---\n${okfFrontmatterYaml(frontmatter)}---\n\n# ${title}\n\n${description}\n\n${sections}`,
        },
        {
          relPath: `${dataset}/${name}/log.md`,
          content: `# Update log\n\n## ${ymd(opts.now)}\n* **Create**: Created [${linkText(title)}](/index.md).\n`,
        },
      ];
    }
    case 'skill':
      return [
        {
          relPath: `skill/${name}/SKILL.md`,
          content: `---\n${stringifyYaml({ name, description })}---\n\n# ${title}\n\n## When to use\n\n## Instructions\n`,
        },
      ];
    case 'data': {
      const body = stringifyYaml(dataDoc(dataset, name, description, opts));
      return [
        {
          relPath: `${dataset}/${name}.yaml`,
          // reference, snippet, context and recipe files start with the yaml-language-server schema comment.
          content: isSchemaDatasetId(dataset)
            ? withSchemaComment(dataset, body, opts.serverOrigin ?? DEFAULT_SERVER_ORIGIN)
            : body,
        },
      ];
    }
  }
}

/** Starter document of a yaml dataset (reference, snippet, context, recipe). */
function dataDoc(
  dataset: DatasetId,
  name: string,
  description: string,
  opts: NewEntryOptions,
): Record<string, unknown> {
  switch (dataset) {
    case 'reference':
      return referenceDoc(name, description, opts);
    case 'snippet': {
      // Equals serializeSnippet() of the parsed result (src/lib/snippet-yaml.ts): markdown last.
      const markdown = opts.markdown?.trim() ? opts.markdown : '';
      return {
        name,
        description,
        markdown: markdown === '' ? `TODO: write the ${titleFromName(name)} snippet.\n` : markdown,
      };
    }
    case 'recipe':
      // Equals serializeRecipe() of the parsed result (src/lib/inflate/recipe.ts).
      return {
        name,
        description,
        target: 'claude-code',
        layout: 'grouped',
        contexts: [],
        items: [],
      };
    default:
      return { name, description, links: [] };
  }
}

function referenceDoc(
  name: string,
  description: string,
  opts: NewEntryOptions,
): Record<string, unknown> {
  const type = opts.type ?? 'remote-repo';
  if (!isReferenceType(type)) throw new Error(`Invalid reference type "${String(type)}"`);
  const owner = opts.owner ?? 'me';
  if (!(OWNERS as readonly string[]).includes(owner)) {
    throw new Error(`Invalid owner "${owner}"; use me or not-me`);
  }
  const doc: Record<string, unknown> = { name, description, type };
  if (type === 'local-repo') doc.path = opts.path?.trim() || `~/repos/${name}`;
  else if (type === 'local-folder') doc.path = opts.path?.trim() || `~/${name}`;
  else doc.uri = opts.uri?.trim() || `https://github.com/TODO/${name}.git`;
  const subpath = opts.subpath?.trim();
  if (subpath) doc.subpath = subpath;
  doc.owner = owner;
  return doc;
}
