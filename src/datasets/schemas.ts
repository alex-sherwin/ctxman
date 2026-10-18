// PURE (no fs, no astro:*; browser-safe). arktype is the ONLY validator of ctxman: every dataset has one Type
// here (runtime validation of data files and API bodies, TypeScript types and, for the three YAML datasets, the
// JSON Schemas in schemas/ through src/lib/json-schema.ts). Callers go through the facade
// src/datasets/validate.ts (`validate(schema, input)`), never call a Type directly. NEVER import another validator or
// 'astro:content' here.
import { type } from 'arktype';
import type { Type } from 'arktype';
import {
  BUG_STATES,
  ENTRY_RELS,
  FEATURE_STATES,
  IDEA_STATES,
  LINKABLE_DATASETS,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  OWNERS,
  PROJECT_STATES,
  TASK_STATES,
  isLocalReferenceType,
} from './registry.ts';
import type { DatasetId } from './registry.ts';
import {
  CLONE_DIR_MESSAGE,
  CONTEXT_FILE_MESSAGE,
  CONTEXT_FILE_PATTERN,
  DEFAULT_CONTEXT_FILE,
  GIT_REF_MESSAGE,
  INFLATE_LAYOUTS,
  INFLATE_TARGETS,
  ITEM_KEY_PATTERN,
  ITEM_KINDS,
  MATERIAL_IDS,
  PRIMARY_KEY_PATTERN,
  REFERENCE_MATERIAL_IDS,
  REFERENCE_MODE_IDS,
  SEGMENT_KEY_PATTERN,
  isMaterialFor,
  isModeFor,
  materialsFor,
  MODE_IDS,
  modesFor,
  parseItemKey,
} from '../lib/inflate/catalog.ts';
import type { ItemKind } from '../lib/inflate/catalog.ts';
import {
  GIT_URI_MESSAGE,
  SKILL_URI_MESSAGE,
  classifyRemoteUri,
  isGitUri,
} from '../lib/remote-uri.ts';

// ---------------------------------------------------------------- JSON-Schema-only hints

/**
 * Lenient SUPERSET of isGitUri / classifyRemoteUri (scp-style, ssh://, https://), emitted ONLY as the JSON
 * Schema `pattern` of `uri` so editors flag obvious typos. The exact rule stays in the arktype narrow.
 */
export const REMOTE_URI_HINT_PATTERN =
  '^(?:[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\\s:/]\\S*|ssh://\\S+|https://\\S+)$';

/** The language of catalog.isSafeRelativeDir as one regex (parity-tested against it). */
export const CLONE_DIR_PATTERN =
  /^(?!\.\.?(?:\/|$))(?:[A-Za-z0-9._-]|\{name\})+(?:\/(?!\.\.?(?:\/|$))(?:[A-Za-z0-9._-]|\{name\})+)*$/;

/**
 * The language of catalog.isSafeGitRef as one regex (parity-tested against it): '' or 1..200 characters, a
 * leading letter or digit, then letters, digits and . _ / -, without '..', '//', a trailing '/' or '.lock'
 * ('@{' cannot occur: '@' and '{' are outside the character set).
 */
export const GIT_REF_PATTERN =
  /^(?:|(?!.*\.\.)(?!.*\/\/)(?!.*\/$)(?!.*\.lock$)[A-Za-z0-9][A-Za-z0-9._/-]{0,199})$/;

/** `edit` (the Editable flag of a repository) is only meaningful on a `reference/<slug>` key. */
const EDIT_KEY_PREFIX = 'reference/';
const EDIT_KEY_MESSAGE = 'edit applies to repositories only (a reference/<slug> key)';

export const NAME_MESSAGE =
  'must be kebab-case: a-z, 0-9, single hyphens, no leading/trailing hyphen (max 64 characters)';

/** Narrow predicates: the generator maps them (by identity) to REMOTE_URI_HINT_PATTERN. */
export const gitUriNarrow = (s: string, ctx: { mustBe(expected: string): false }): boolean =>
  isGitUri(s) || ctx.mustBe(GIT_URI_MESSAGE);
export const skillUriNarrow = (s: string, ctx: { mustBe(expected: string): false }): boolean =>
  classifyRemoteUri(s) !== null || ctx.mustBe(SKILL_URI_MESSAGE);

// ---------------------------------------------------------------- shared pieces

/** Entry name == directory name / file stem == slug. */
export const nameSchema = type(`string <= ${NAME_MAX_LENGTH}`)
  .and(NAME_PATTERN)
  .describe(NAME_MESSAGE);
/** At least one non-whitespace character (the value itself is NOT trimmed). */
const nonBlank = type(/\S/).describe('must not be blank');
const tags = type('string > 0')
  .array()
  .default(() => []);
const owner = type.enumerated(...OWNERS);
const linkableDataset = type.enumerated(...LINKABLE_DATASETS);

/**
 * YAML is parsed with the `timestamp` custom tag (src/lib/yaml.ts), so unquoted dates arrive as Date objects;
 * quoted ones as strings. Accept both, output a Date.
 */
export const dateSchema = type('Date | string.date.parse');

/**
 * A date or an ISO date string that is NOT converted (the output keeps its input). Used inside provenance
 * events, which sit in a `Event | Event[]` union (a morph there makes the union indeterminate in arktype).
 */
const dateLike = type('Date | string').narrow((value, ctx) =>
  Number.isNaN(new Date(value).getTime()) ? ctx.mustBe('a parsable date') : true,
);

// ---------------------------------------------------------------- OKF v0.2 provenance / lifecycle

/** OKF actor: `<producer>/<version>`, `human:<id>`, or `process:<id>`. Not format-enforced (advisory). */
export const okfEventSchema = type({ by: 'string > 0', at: dateLike });
export const okfSourceSchema = type({
  'id?': 'string > 0',
  resource: 'string > 0',
  'title?': 'string',
  'author?': 'string',
});
export const OKF_STATUSES = ['draft', 'stable', 'deprecated'] as const;

/** Keys shared by every concept and the entry index.md (`description` differs: optional vs required). Unknown keys are preserved (arktype objects are loose). */
const okfSharedShape = {
  type: nonBlank,
  'title?': 'string',
  'resource?': 'string',
  tags,
  'sources?': okfSourceSchema.array(),
  'generated?': okfEventSchema,
  'verified?': okfEventSchema.or(okfEventSchema.array()),
  'status?': type.enumerated(...OKF_STATUSES),
  'stale_after?': dateSchema,
} as const;

/** Any non-reserved OKF concept file (not index.md / log.md). */
export const okfConceptSchema = type({ ...okfSharedShape, 'description?': 'string' });

/**
 * One structured relation of an okf entry (entry index.md frontmatter `links`); `from` is the entry that declares it.
 * `rel`: `child` = this entry contains the target (projects), `related` symmetric, `depends-on` = this needs the
 * target first.
 */
export const entryLinkSchema = type({
  '+': 'reject',
  dataset: linkableDataset,
  slug: nameSchema,
  /** Absent in hand-written files = 'related'. ctxman always writes it. */
  rel: type.enumerated(...ENTRY_RELS).default('related'),
});
/** Array-level narrow (NOT object-level: the kb/rca schema is `.merge`d per lifecycle dataset): one link per target. */
export const entryLinksSchema = entryLinkSchema.array().narrow((links, ctx) => {
  const seen = new Set<string>();
  let ok = true;
  links.forEach((link, index) => {
    const key = `${link.dataset}/${link.slug}`;
    if (seen.has(key)) {
      ok = ctx.reject({ path: [...ctx.path, index], message: `duplicate link ${key}` });
    }
    seen.add(key);
  });
  return ok;
});

/** Bundle entry (root index.md) for kb / rca (no lifecycle); `okf_version` leads the frontmatter. */
export const okfEntrySchema = type({
  'okf_version?': "'0.2'",
  ...okfSharedShape,
  name: nameSchema,
  description: nonBlank,
  'links?': entryLinksSchema,
});

export const kbSchema = okfEntrySchema;
export const rcaSchema = okfEntrySchema;
export const ideaSchema = okfEntrySchema.merge({ state: type.enumerated(...IDEA_STATES) });
export const taskSchema = okfEntrySchema.merge({ state: type.enumerated(...TASK_STATES) });
export const bugSchema = okfEntrySchema.merge({ state: type.enumerated(...BUG_STATES) });
export const featureSchema = okfEntrySchema.merge({ state: type.enumerated(...FEATURE_STATES) });
export const projectSchema = okfEntrySchema.merge({ state: type.enumerated(...PROJECT_STATES) });

/**
 * Every .md file inside okf bundles (entry index.md, concepts, nested index.md, log.md): the lenient "docs" shape.
 * Loose on purpose — strict OKF rules are enforced by scripts/check-okf.ts, not by page rendering.
 */
export const docSchema = type({
  'type?': 'string',
  'name?': 'string',
  'title?': 'string',
  'description?': 'string',
  tags,
  'state?': 'string',
  'okf_version?': 'string | number',
  'status?': 'string',
  'stale_after?': dateSchema,
});

// ---------------------------------------------------------------- skill (agentskills.io)

/** agentskills.io SKILL.md frontmatter. Strict: the spec defines exactly these fields. */
export const skillSchema = type({
  '+': 'reject',
  name: nameSchema,
  // `string <= 1024` first: arktype caches the intersection, and the JSON Schema of recipe `output.dir` (same pair)
  // only stays byte-identical when this one is built in that order.
  description: type('string <= 1024').and(nonBlank),
  'license?': 'string',
  'compatibility?': '1 <= string <= 500',
  'metadata?': 'Record<string, string>',
  'allowed-tools?': 'string',
});

// ---------------------------------------------------------------- reference (yaml, discriminated)

/** Optional markdown about the referenced thing, inlined under its item by Context Inflate. */
const referenceInfo = type('string');

export const localRepoReferenceSchema = type({
  '+': 'reject',
  name: nameSchema,
  description: nonBlank,
  tags,
  type: "'local-repo'",
  /** Absolute path (or ~-prefixed) to the repo root on this machine. */
  path: 'string > 0',
  'subpath?': 'string',
  owner,
  'info?': referenceInfo,
});
export const localFolderReferenceSchema = type({
  '+': 'reject',
  name: nameSchema,
  description: nonBlank,
  tags,
  type: "'local-folder'",
  /** Absolute path (or ~-prefixed) to a plain folder (not a git repository) on this machine. */
  path: 'string > 0',
  'subpath?': 'string',
  owner,
  'info?': referenceInfo,
});
export const remoteRepoReferenceSchema = type({
  '+': 'reject',
  name: nameSchema,
  description: nonBlank,
  tags,
  type: "'remote-repo'",
  /** git URI: git@host:org/repo.git, ssh://git@host/org/repo.git, https://host/org/repo[.git]. */
  uri: type('string > 0').narrow(gitUriNarrow).describe(GIT_URI_MESSAGE),
  'subpath?': 'string',
  owner,
  'info?': referenceInfo,
});
export const remoteSkillReferenceSchema = type({
  '+': 'reject',
  name: nameSchema,
  description: nonBlank,
  tags,
  type: "'remote-skill'",
  /** git URI (as remote-repo) OR an https URL ending .tar.gz / .tgz / .zip (see src/lib/remote-uri.ts). */
  uri: type('string > 0').narrow(skillUriNarrow).describe(SKILL_URI_MESSAGE),
  /** Skill folder inside the repo / archive; '' / null / absent = root. */
  'subpath?': 'string | null',
  owner,
  'info?': referenceInfo,
});
export const referenceSchema = localRepoReferenceSchema
  .or(localFolderReferenceSchema)
  .or(remoteRepoReferenceSchema)
  .or(remoteSkillReferenceSchema);

// ---------------------------------------------------------------- context (yaml)

export const contextLinkSchema = type({
  '+': 'reject',
  dataset: linkableDataset,
  slug: nameSchema,
  /** Optional markdown guidance for the consuming agent about this link in this context. */
  'notes?': 'string',
});
export const contextSchema = type({
  '+': 'reject',
  name: nameSchema,
  description: nonBlank,
  tags,
  links: contextLinkSchema.array().default(() => []),
}).narrow((c, ctx) => {
  // Not expressible in JSON Schema (uniqueItems would compare whole links, notes included).
  const seen = new Set<string>();
  let ok = true;
  c.links.forEach((link, index) => {
    const key = `${link.dataset}/${link.slug}`;
    if (seen.has(key))
      ok = ctx.reject({ path: ['links', index], message: `duplicate link ${key}` });
    seen.add(key);
  });
  return ok;
});

// ---------------------------------------------------------------- recipe (yaml, Context Inflate)

export const inflateOptionsSchema = type({
  '+': 'reject',
  'includeFrontmatter?': 'boolean',
  'includeLog?': 'boolean',
  'shiftHeadings?': 'boolean',
  'rewriteLinks?': 'boolean',
  'eager?': 'boolean',
  'symlink?': 'boolean',
  'treeLimit?': '1 <= number.integer <= 500',
  'cloneDir?': type('1 <= string <= 200').and(CLONE_DIR_PATTERN).describe(CLONE_DIR_MESSAGE),
  'shallow?': 'boolean',
  'sparse?': 'boolean',
});
export const recipeItemSchema = type({ '+': 'reject', dataset: linkableDataset, slug: nameSchema });
export const recipeMarkdownSchema = type({ '+': 'reject', id: nameSchema, body: 'string' });

/** Options of the materials clone / install (plans/INFLATE_V2_SPEC.md §4.1). */
export const materialOptionsSchema = type({
  '+': 'reject',
  /** Commits of history; 0 = full history. */
  'cloneDepth?': '0 <= number.integer <= 100000',
  /** '' = the default branch. */
  'branch?': type('string <= 200').and(GIT_REF_PATTERN).describe(GIT_REF_MESSAGE),
  'subpathOnly?': 'boolean',
});
export const contextFileSchema = type(CONTEXT_FILE_PATTERN).describe(CONTEXT_FILE_MESSAGE);
export const primaryKeySchema = type(PRIMARY_KEY_PATTERN).describe('must be reference/<slug>');
export const recipeStubsSchema = type({
  '+': 'reject',
  'agentsMd?': 'boolean',
  'claudeMd?': 'boolean',
  'gitignore?': 'boolean',
});
export const recipeOutputSchema = type({
  '+': 'reject',
  /** Absolute or ~-prefixed; relativity is a check WARNING (collections/recipe-output-dir-relative), refused at run time. */
  'dir?': type('string <= 1024')
    .and(nonBlank)
    .pipe((dir) => dir.trim()),
  contextFile: type(CONTEXT_FILE_PATTERN)
    .describe(CONTEXT_FILE_MESSAGE)
    .default(DEFAULT_CONTEXT_FILE),
  /** `reference/<slug>`: the main repository of the working directory (reachability is a check warning). */
  'primary?': type(PRIMARY_KEY_PATTERN).describe('must be reference/<slug>'),
  'allowNonEmpty?': 'boolean',
  'stubs?': recipeStubsSchema,
});

export const recipeOverrideSchema = type({
  '+': 'reject',
  key: type(ITEM_KEY_PATTERN).describe('must be <dataset>/<slug> of a linkable dataset'),
  'mode?': type.enumerated(...MODE_IDS),
  'options?': inflateOptionsSchema,
  'material?': type.enumerated(...MATERIAL_IDS),
  'materialOptions?': materialOptionsSchema,
  /** Repositories only (`reference/<slug>` keys): may the session change files there? Default: true for the primary. */
  'edit?': 'boolean',
  'exclude?': 'boolean',
});

/**
 * Per-kind default: `mode` and `material` are limited to those of that kind (JSON Schema expresses it; the
 * friendly "does not apply to <kind> items" wording is produced by findings.describeIssue).
 */
const kindDefaultSchema = (kind: ItemKind) =>
  type({
    '+': 'reject',
    'mode?': type.enumerated(...modesFor(kind).map((m) => m.id)),
    'options?': inflateOptionsSchema,
    'material?': type.enumerated(...materialsFor(kind).map((m) => m.id)),
    'materialOptions?': materialOptionsSchema,
  });
type KindDefaultSchema = ReturnType<typeof kindDefaultSchema>;
const defaultsDef = Object.fromEntries(
  ITEM_KINDS.map((kind) => [`${kind}?`, kindDefaultSchema(kind)]),
) as Record<`${ItemKind}?`, KindDefaultSchema>;
export const recipeDefaultsSchema = type({ '+': 'reject', ...defaultsDef });

export const recipeSchema = type({
  '+': 'reject',
  name: nameSchema,
  description: nonBlank,
  tags,
  target: type.enumerated(...INFLATE_TARGETS).default('claude-code'),
  layout: type.enumerated(...INFLATE_LAYOUTS).default('grouped'),
  /** Working directory output (Inflate v2); absent = the single-document render only. */
  'output?': recipeOutputSchema,
  /** Top-of-document markdown instructions from the user (verbatim). */
  'preamble?': 'string',
  contexts: nameSchema.array().default(() => []),
  items: recipeItemSchema.array().default(() => []),
  markdown: recipeMarkdownSchema.array().default(() => []),
  overrides: recipeOverrideSchema.array().default(() => []),
  order: type(SEGMENT_KEY_PATTERN)
    .describe('must be <dataset>/<slug>, md:<id>, ctx:<context> or sec:extra')
    .array()
    .default(() => []),
  defaults: recipeDefaultsSchema.default(() => ({})),
}).narrow((r, ctx) => {
  // Duplicates and override mode / material applicability: not expressible in JSON Schema.
  let ok = true;
  const duplicates = <T>(
    list: readonly T[],
    keyOf: (item: T) => string,
    path: (index: number) => (string | number)[],
    message: (key: string) => string,
  ): void => {
    const seen = new Set<string>();
    list.forEach((item, index) => {
      const key = keyOf(item);
      if (seen.has(key)) ok = ctx.reject({ path: path(index), message: message(key) });
      seen.add(key);
    });
  };
  duplicates(
    r.contexts,
    (s) => s,
    (i) => ['contexts', i],
    (k) => `duplicate context ${k}`,
  );
  duplicates(
    r.items,
    (x) => `${x.dataset}/${x.slug}`,
    (i) => ['items', i],
    (k) => `duplicate item ${k}`,
  );
  duplicates(
    r.markdown,
    (b) => b.id,
    (i) => ['markdown', i, 'id'],
    (k) => `duplicate markdown block id ${k}`,
  );
  duplicates(
    r.overrides,
    (o) => o.key,
    (i) => ['overrides', i, 'key'],
    (k) => `duplicate override ${k}`,
  );
  duplicates(
    r.order,
    (k) => k,
    (i) => ['order', i],
    (k) => `duplicate order key ${k}`,
  );
  r.overrides.forEach((override, index) => {
    if (override.edit !== undefined && !override.key.startsWith(EDIT_KEY_PREFIX)) {
      ok = ctx.reject({ path: ['overrides', index, 'edit'], message: EDIT_KEY_MESSAGE });
    }
    const parsed = parseItemKey(override.key);
    if (parsed === null) return;
    if (override.mode !== undefined) {
      const applies =
        parsed.dataset === 'reference'
          ? (REFERENCE_MODE_IDS as readonly string[]).includes(override.mode)
          : isModeFor(parsed.dataset, override.mode);
      if (!applies) {
        ok = ctx.reject({
          path: ['overrides', index, 'mode'],
          message: `mode "${override.mode}" does not apply to ${override.key}`,
        });
      }
    }
    if (override.material !== undefined) {
      const applies =
        parsed.dataset === 'reference'
          ? (REFERENCE_MATERIAL_IDS as readonly string[]).includes(override.material)
          : isMaterialFor(parsed.dataset, override.material);
      if (!applies) {
        ok = ctx.reject({
          path: ['overrides', index, 'material'],
          message: `material "${override.material}" does not apply to ${override.key}`,
        });
      }
    }
  });
  return ok;
});

// ---------------------------------------------------------------- run overrides (API only, never stored)

/** One item's run-time material choice (plans/INFLATE_V2_SPEC.md §4.1) and, for a repository, its Editable flag. */
export const runItemOverrideSchema = type({
  '+': 'reject',
  'material?': type.enumerated(...MATERIAL_IDS),
  'materialOptions?': materialOptionsSchema,
  'edit?': 'boolean',
});
/** Run-time overrides of a working-directory run: applied by applyRunOverrides before anything else. */
export const runOverridesSchema = type({
  '+': 'reject',
  'dir?': type('string.trim').to('1 <= string <= 1024'),
  'contextFile?': contextFileSchema,
  /** null = no primary for this run. */
  'primary?': primaryKeySchema.or('null'),
  'allowNonEmpty?': 'boolean',
  items: type({ '[string]': runItemOverrideSchema })
    .narrow((items, ctx) => {
      let ok = true;
      for (const [key, given] of Object.entries(items)) {
        if (!ITEM_KEY_PATTERN.test(key)) {
          ok = ctx.reject({
            path: [...ctx.path, key],
            message: 'must be <dataset>/<slug> of a linkable dataset',
          });
        } else if (given.edit !== undefined && !key.startsWith(EDIT_KEY_PREFIX)) {
          ok = ctx.reject({ path: [...ctx.path, key, 'edit'], message: EDIT_KEY_MESSAGE });
        }
      }
      return ok;
    })
    .default(() => ({})),
});

// ---------------------------------------------------------------- types + lookup

export type OkfConcept = typeof okfConceptSchema.infer;
export type OkfEntry = typeof okfEntrySchema.infer;
export type KbData = typeof kbSchema.infer;
export type RcaData = typeof rcaSchema.infer;
export type IdeaData = typeof ideaSchema.infer;
export type TaskData = typeof taskSchema.infer;
export type BugData = typeof bugSchema.infer;
export type FeatureData = typeof featureSchema.infer;
export type ProjectData = typeof projectSchema.infer;
export type SkillData = typeof skillSchema.infer;
export type ReferenceData = typeof referenceSchema.infer;
/** Input shape (before defaults): what API bodies carry. */
export type ReferenceInput = typeof referenceSchema.inferIn;
/** local-repo and local-folder: a `path` on this machine (the remote types carry a `uri`). */
export type LocalReferenceData = Extract<ReferenceData, { path: string }>;
export const isLocalReference = (r: ReferenceData): r is LocalReferenceData =>
  isLocalReferenceType(r.type);
/** A structured relation of an okf entry; `rel` is always present after parsing (default 'related'). */
export type EntryLink = typeof entryLinkSchema.infer;
/** Input shape (before the `rel` default): what API clients send. */
export type EntryLinkInput = typeof entryLinkSchema.inferIn;
export type ContextLink = typeof contextLinkSchema.infer;
export type ContextData = typeof contextSchema.infer;
/** Input shape (before defaults) — what API clients send and what context-io writes. */
export type ContextInput = typeof contextSchema.inferIn;
export type DocData = typeof docSchema.infer;
export type InflateOptionsInput = typeof inflateOptionsSchema.infer;
export type RecipeItem = typeof recipeItemSchema.infer;
export type RecipeMarkdown = typeof recipeMarkdownSchema.infer;
export type RecipeOverride = typeof recipeOverrideSchema.infer;
export type MaterialOptionsInput = typeof materialOptionsSchema.infer;
export type RecipeOutput = typeof recipeOutputSchema.infer;
export type InflateRunOverrides = typeof runOverridesSchema.infer;
export type InflateRunOverridesInput = typeof runOverridesSchema.inferIn;
/** All arrays + defaults present (after defaults are applied). */
export type RecipeData = typeof recipeSchema.infer;
/** Input shape (before defaults): what API bodies carry. */
export type RecipeInput = typeof recipeSchema.inferIn;

/** Schema per dataset id (used by the check libs, the io modules and the entry index). */
export const DATASET_SCHEMAS = {
  kb: kbSchema,
  rca: rcaSchema,
  idea: ideaSchema,
  task: taskSchema,
  bug: bugSchema,
  feature: featureSchema,
  project: projectSchema,
  skill: skillSchema,
  reference: referenceSchema,
  context: contextSchema,
  recipe: recipeSchema,
} as const satisfies Record<DatasetId, Type<any, any>>;

/** The arktype model of each YAML dataset (keys = SCHEMA_DATASETS order); the source of schemas/*.schema.json. */
export const YAML_DATASET_TYPES = {
  reference: referenceSchema,
  context: contextSchema,
  recipe: recipeSchema,
} as const;
