// PURE: file templates for `scripts/add-entry.ts` (PLAN.md §F.1). No fs; returns what to write.
// Frontmatter and yaml files are emitted through the `yaml` stringifier so values like
// "TODO: describe X." are quoted correctly (a raw `description: TODO: describe X.` is invalid YAML).
import {
  datasetDef,
  isReferenceType,
  isValidName,
  NAME_MAX_LENGTH,
  OWNERS,
} from '../datasets/registry.ts';
import type { DatasetId, Owner, ReferenceType } from '../datasets/registry.ts';
import { isSchemaDatasetId, withSchemaComment } from './schema-comment.ts';
import { stringifyYaml } from './yaml.ts';

export interface NewEntryOptions {
  title?: string;
  description?: string;
  state?: string;
  type?: ReferenceType;
  path?: string;
  uri?: string;
  subpath?: string;
  owner?: Owner;
  now: Date;
}

export interface PlannedFile {
  /** Data-dir-relative posix path, e.g. 'task/fix-login/main.md'. */
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
const linkText = (value: string): string => value.replace(/([\\[\]])/g, '\\$1');

/**
 * Files to create for a new entry of `dataset`. Throws `Error` with a user-facing message on an invalid
 * name, state or reference type. Defaults: title from the name; description `TODO: describe <title>.`;
 * state = first lifecycle state; reference type remote-repo, owner me, path ~/repos/<name>,
 * uri https://github.com/TODO/<name>.git.
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

  switch (def.kind) {
    case 'okf': {
      const state = def.states ? (opts.state ?? def.states[0]?.id) : undefined;
      const frontmatter: Record<string, unknown> = {
        type: def.okfType,
        name,
        title,
        description,
      };
      if (state !== undefined) frontmatter.state = state;
      frontmatter.tags = [];
      frontmatter.generated = { by: 'process:ctxman-add-entry', at: opts.now.toISOString() };
      const sections = (SECTIONS[dataset] ?? []).map((h) => `## ${h}\n`).join('\n');
      return [
        {
          relPath: `${dataset}/${name}/index.md`,
          content: `---\n${stringifyYaml({ okf_version: '0.2' })}---\n# ${title}\n\n## Entry\n\n* [${linkText(title)}](/main.md) - ${description}\n`,
        },
        {
          relPath: `${dataset}/${name}/main.md`,
          content: `---\n${stringifyYaml(frontmatter)}---\n\n# ${title}\n\n${description}\n\n${sections}`,
        },
        {
          relPath: `${dataset}/${name}/log.md`,
          content: `# Update log\n\n## ${ymd(opts.now)}\n* **Create**: Created [${linkText(title)}](/main.md).\n`,
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
          // reference, context and recipe files start with the yaml-language-server schema comment.
          content: isSchemaDatasetId(dataset) ? withSchemaComment(dataset, body) : body,
        },
      ];
    }
  }
}

/** Starter document of a yaml dataset (reference, context, recipe). */
function dataDoc(
  dataset: DatasetId,
  name: string,
  description: string,
  opts: NewEntryOptions,
): Record<string, unknown> {
  switch (dataset) {
    case 'reference':
      return referenceDoc(name, description, opts);
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
  else doc.uri = opts.uri?.trim() || `https://github.com/TODO/${name}.git`;
  const subpath = opts.subpath?.trim();
  if (subpath) doc.subpath = subpath;
  doc.owner = owner;
  return doc;
}
