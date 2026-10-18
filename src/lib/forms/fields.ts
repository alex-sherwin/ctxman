// PURE (no fs, no astro:*; browser-safe): which fields the DataForm shows for each yaml dataset (reference,
// context, recipe), the empty / normalized document shapes and the client-side validation (ROUND2_UI_SPEC §H.1).
// The zod schemas in src/datasets/schemas.ts stay the source of truth; this module only decides what the form
// renders and maps zod issues to one message per field.
import { DATASET_SCHEMAS } from '../../datasets/schemas.ts';
import {
  OWNERS,
  OWNER_LABELS,
  REFERENCE_TYPES,
  REFERENCE_TYPE_LABELS,
} from '../../datasets/registry.ts';
import { INFLATE_LAYOUTS, INFLATE_TARGETS, LAYOUT_LABELS, TARGETS } from '../inflate/catalog.ts';
import { describeIssue } from '../findings.ts';
import { nameProblem } from '../names.ts';

export const YAML_DATASETS = ['reference', 'context', 'recipe'] as const;
export type YamlDatasetId = (typeof YAML_DATASETS)[number];

export function isYamlDatasetId(value: unknown): value is YamlDatasetId {
  return typeof value === 'string' && (YAML_DATASETS as readonly string[]).includes(value);
}

export type FormDoc = Record<string, unknown>;

export type FieldKind = 'name' | 'text' | 'tags' | 'select' | 'markdown';

export interface FieldOption {
  id: string;
  label: string;
  description?: string;
}

export interface FieldDef {
  id: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  mono?: boolean;
  /** Static help text, or one that depends on the working document (reference `uri` per type). */
  help?: string | ((doc: FormDoc) => string);
  placeholder?: string;
  options?: readonly FieldOption[];
  /** Shown only when true for the working doc (the reference type switch). */
  when?: (doc: FormDoc) => boolean;
}

const REFERENCE_TYPE_OPTIONS: readonly FieldOption[] = REFERENCE_TYPES.map((id) => ({
  id,
  label: REFERENCE_TYPE_LABELS[id],
}));
const OWNER_OPTIONS: readonly FieldOption[] = OWNERS.map((id) => ({
  id,
  label: OWNER_LABELS[id],
}));
const TARGET_OPTIONS: readonly FieldOption[] = INFLATE_TARGETS.map((id) => ({
  id,
  label: TARGETS[id].label,
}));
const LAYOUT_OPTIONS: readonly FieldOption[] = INFLATE_LAYOUTS.map((id) => ({
  id,
  label: LAYOUT_LABELS[id],
}));

const isLocal = (doc: FormDoc): boolean => doc.type === 'local-repo';

const URI_HELP: Record<string, string> = {
  'remote-repo':
    'git URI: git@host:org/repo.git, ssh://git@host/org/repo.git or https://host/org/repo[.git]',
  'remote-skill':
    'git URI (git@host:org/repo.git, ssh://…, https://host/org/repo[.git]) or an https archive ending .tar.gz, .tgz or .zip',
};

const NAME_FIELD: FieldDef = {
  id: 'name',
  label: 'Name',
  kind: 'name',
  required: true,
  mono: true,
};
const DESCRIPTION_FIELD: FieldDef = {
  id: 'description',
  label: 'Description',
  kind: 'text',
  required: true,
};
const TAGS_FIELD: FieldDef = { id: 'tags', label: 'Tags', kind: 'tags' };

/** Fields in render order. */
export const FORM_FIELDS: Record<YamlDatasetId, readonly FieldDef[]> = {
  reference: [
    NAME_FIELD,
    DESCRIPTION_FIELD,
    TAGS_FIELD,
    { id: 'type', label: 'Type', kind: 'select', required: true, options: REFERENCE_TYPE_OPTIONS },
    {
      id: 'path',
      label: 'Path',
      kind: 'text',
      required: true,
      mono: true,
      help: 'Absolute or ~/ path of the repo root',
      placeholder: '~/repos/my-repo',
      when: isLocal,
    },
    {
      id: 'uri',
      label: 'URI',
      kind: 'text',
      required: true,
      mono: true,
      help: (doc) => URI_HELP[String(doc.type)] ?? URI_HELP['remote-repo'] ?? '',
      placeholder: 'git@github.com:org/repo.git',
      when: (doc) => !isLocal(doc),
    },
    {
      id: 'subpath',
      label: 'Subpath',
      kind: 'text',
      mono: true,
      help: 'Folder inside the repo (or archive); empty = the root',
    },
    { id: 'owner', label: 'Owner', kind: 'select', required: true, options: OWNER_OPTIONS },
  ],
  context: [NAME_FIELD, DESCRIPTION_FIELD, TAGS_FIELD],
  recipe: [
    NAME_FIELD,
    DESCRIPTION_FIELD,
    TAGS_FIELD,
    { id: 'target', label: 'Target', kind: 'select', required: true, options: TARGET_OPTIONS },
    { id: 'layout', label: 'Layout', kind: 'select', required: true, options: LAYOUT_OPTIONS },
    {
      id: 'preamble',
      label: 'Preamble',
      kind: 'markdown',
      help: 'Instructions placed at the top of the generated document (markdown)',
    },
  ],
};

/** The fields of `ds` that are shown for `doc` (the `when` predicate applied). */
export function visibleFields(ds: YamlDatasetId, doc: FormDoc): readonly FieldDef[] {
  return FORM_FIELDS[ds].filter((f) => f.when === undefined || f.when(doc));
}

export function fieldHelp(def: FieldDef, doc: FormDoc): string | undefined {
  return typeof def.help === 'function' ? def.help(doc) : def.help;
}

/** Where the data the form cannot edit is edited (context links, recipe composition). */
export const LINKED_EDITOR: Record<
  YamlDatasetId,
  { label: string; href: (slug: string) => string } | null
> = {
  reference: null,
  context: {
    label: 'Edit links in Forge',
    href: (slug) => `/forge?context=${encodeURIComponent(slug)}`,
  },
  recipe: {
    label: 'Edit composition in Inflate',
    href: (slug) => `/inflate?recipe=${encodeURIComponent(slug)}`,
  },
};

/** A blank document for the create mode (valid once the user typed name, description and the required field). */
export function emptyDoc(ds: YamlDatasetId): FormDoc {
  switch (ds) {
    case 'reference':
      return { name: '', description: '', type: 'local-repo', path: '', owner: 'me' };
    case 'context':
      return { name: '', description: '', links: [] };
    case 'recipe':
      return {
        name: '',
        description: '',
        target: 'claude-code',
        layout: 'grouped',
        contexts: [],
        items: [],
        markdown: [],
        overrides: [],
        order: [],
        defaults: {},
      };
  }
}

const trimmed = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

function tagList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];
}

/** Adds `key: value` unless the value is undefined. */
function put(out: FormDoc, key: string, value: unknown): void {
  if (value !== undefined) out[key] = value;
}

/**
 * The document the API receives: strings trimmed, optional empty values (subpath, tags, preamble) dropped.
 * Reference keeps only the keys of the active type variant (`path` for local-repo, `uri` for the remote
 * types), in the serializer's key order; context and recipe keep every other key (links, composition) as is.
 */
export function normalizeDoc(ds: YamlDatasetId, doc: FormDoc): FormDoc {
  const tags = tagList(doc.tags);
  if (ds === 'reference') {
    const out: FormDoc = {};
    put(out, 'name', trimmed(doc.name));
    put(out, 'description', trimmed(doc.description));
    put(out, 'type', doc.type);
    if (isLocal(doc)) put(out, 'path', trimmed(doc.path));
    else put(out, 'uri', trimmed(doc.uri));
    const subpath = trimmed(doc.subpath);
    if (typeof subpath === 'string' && subpath !== '') out.subpath = subpath;
    put(out, 'owner', doc.owner);
    if (tags.length > 0) out.tags = tags;
    return out;
  }
  const out: FormDoc = { ...doc, name: trimmed(doc.name), description: trimmed(doc.description) };
  if (tags.length > 0) out.tags = tags;
  else delete out.tags;
  if (ds === 'context') {
    out.links = Array.isArray(doc.links) ? doc.links : [];
    return out;
  }
  const { preamble } = doc;
  if (typeof preamble !== 'string' || preamble.trim() === '') delete out.preamble;
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out;
}

export type ValidateResult =
  | { ok: true; doc: unknown }
  | { ok: false; errors: Record<string, string> };

/** Key under which issues that belong to no single field (root issues) are reported. */
export const FORM_ERROR_KEY = '_';

/**
 * Validates `doc` as it would be sent (`normalizeDoc`) with the dataset's zod schema. `errors` has one message
 * per top-level field id (the first issue wins); a required empty text field says 'Required'; `name` follows
 * `nameProblem` (src/lib/names.ts). `expectedName` (edit mode) makes a different name an error.
 */
export function validateDoc(
  ds: YamlDatasetId,
  doc: FormDoc,
  expectedName?: string,
): ValidateResult {
  const normalized = normalizeDoc(ds, doc);
  const errors: Record<string, string> = {};

  const name = typeof normalized.name === 'string' ? normalized.name : '';
  const nameError = nameProblem(name, undefined, ds);
  if (nameError !== null) errors.name = nameError;
  else if (expectedName !== undefined && name !== expectedName) {
    errors.name = `Names can't be changed (this entry is "${expectedName}")`;
  }

  for (const def of visibleFields(ds, normalized)) {
    if (def.required !== true || def.kind !== 'text' || errors[def.id] !== undefined) continue;
    const value = normalized[def.id];
    if (value === undefined || value === '') errors[def.id] = 'Required';
  }

  const parsed = DATASET_SCHEMAS[ds].safeParse(normalized);
  if (parsed.success && Object.keys(errors).length === 0) return { ok: true, doc: parsed.data };
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const first = issue.path[0];
      const key = first === undefined ? FORM_ERROR_KEY : String(first);
      if (errors[key] === undefined) errors[key] = describeIssue(issue, normalized);
    }
  }
  return { ok: false, errors };
}

/**
 * The line shown instead of the fields the form cannot edit: "N links — edit in Forge" (context),
 * "N contexts · N items · N blocks — edit in Inflate" (recipe); null for reference.
 */
export function readonlySummary(ds: YamlDatasetId, doc: FormDoc): string | null {
  const count = (key: string): number => (Array.isArray(doc[key]) ? doc[key].length : 0);
  const plural = (n: number, one: string, many = `${one}s`): string =>
    `${n} ${n === 1 ? one : many}`;
  if (ds === 'context') return `${plural(count('links'), 'link')} — edit in Forge`;
  if (ds === 'recipe') {
    return `${plural(count('contexts'), 'context')} · ${plural(count('items'), 'item')} · ${plural(count('markdown'), 'block')} — edit in Inflate`;
  }
  return null;
}
