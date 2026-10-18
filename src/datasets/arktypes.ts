// PURE (no fs, no astro:*; never imported by islands or SSR pages): arktype models of the three YAML
// datasets, mirroring src/datasets/schemas.ts (zod stays the runtime validator for Astro collections and
// every *-io module). Their only job is to generate the JSON Schemas in schemas/ (scripts/gen-schemas.ts);
// tests/unit/arktypes-parity.test.ts keeps them in step with zod.
import { type } from 'arktype';
import { LINKABLE_DATASETS, NAME_MAX_LENGTH, NAME_PATTERN, OWNERS } from './registry.ts';
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
  MODE_IDS,
  PRIMARY_KEY_PATTERN,
  REFERENCE_MATERIAL_IDS,
  REFERENCE_MODE_IDS,
  SEGMENT_KEY_PATTERN,
  isMaterialFor,
  isModeFor,
  materialsFor,
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
 * Schema `pattern` of `uri` so editors flag obvious typos. The exact rule stays in the arktype narrow (and zod).
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

export const NAME_MESSAGE =
  'must be kebab-case: a-z, 0-9, single hyphens, no leading/trailing hyphen (max 64 characters)';

// ---------------------------------------------------------------- shared pieces

const name = type(`string <= ${NAME_MAX_LENGTH}`).and(NAME_PATTERN).describe(NAME_MESSAGE);
/** zod `z.string().trim().min(1)`: at least one non-whitespace character. */
const nonBlank = type(/\S/).describe('must not be blank');
const tags = type('string > 0')
  .array()
  .default(() => []);
const owner = type.enumerated(...OWNERS);
const linkableDataset = type.enumerated(...LINKABLE_DATASETS);

/** Narrow predicates: the generator maps them (by identity) to REMOTE_URI_HINT_PATTERN. */
export const gitUriNarrow = (s: string, ctx: { mustBe(expected: string): false }): boolean =>
  isGitUri(s) || ctx.mustBe(GIT_URI_MESSAGE);
export const skillUriNarrow = (s: string, ctx: { mustBe(expected: string): false }): boolean =>
  classifyRemoteUri(s) !== null || ctx.mustBe(SKILL_URI_MESSAGE);

// ---------------------------------------------------------------- reference

export const localRepoReferenceType = type({
  '+': 'reject',
  name,
  description: nonBlank,
  tags,
  type: "'local-repo'",
  path: 'string > 0',
  'subpath?': 'string',
  owner,
});
export const remoteRepoReferenceType = type({
  '+': 'reject',
  name,
  description: nonBlank,
  tags,
  type: "'remote-repo'",
  uri: type('string > 0').narrow(gitUriNarrow).describe(GIT_URI_MESSAGE),
  'subpath?': 'string',
  owner,
});
export const remoteSkillReferenceType = type({
  '+': 'reject',
  name,
  description: nonBlank,
  tags,
  type: "'remote-skill'",
  uri: type('string > 0').narrow(skillUriNarrow).describe(SKILL_URI_MESSAGE),
  'subpath?': 'string | null',
  owner,
});
export const referenceType = localRepoReferenceType
  .or(remoteRepoReferenceType)
  .or(remoteSkillReferenceType);

// ---------------------------------------------------------------- context

export const contextLinkType = type({
  '+': 'reject',
  dataset: linkableDataset,
  slug: name,
  'notes?': 'string',
});
export const contextType = type({
  '+': 'reject',
  name,
  description: nonBlank,
  tags,
  links: contextLinkType.array().default(() => []),
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

// ---------------------------------------------------------------- recipe

export const inflateOptionsType = type({
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

export const materialOptionsType = type({
  '+': 'reject',
  'cloneDepth?': '0 <= number.integer <= 100000',
  'branch?': type('string <= 200').and(GIT_REF_PATTERN).describe(GIT_REF_MESSAGE),
  'subpathOnly?': 'boolean',
});

export const recipeStubsType = type({
  '+': 'reject',
  'agentsMd?': 'boolean',
  'claudeMd?': 'boolean',
  'gitignore?': 'boolean',
});

export const recipeOutputType = type({
  '+': 'reject',
  'dir?': type('string <= 1024').and(nonBlank),
  contextFile: type(CONTEXT_FILE_PATTERN)
    .describe(CONTEXT_FILE_MESSAGE)
    .default(DEFAULT_CONTEXT_FILE),
  'primary?': type(PRIMARY_KEY_PATTERN).describe('must be reference/<slug>'),
  'allowNonEmpty?': 'boolean',
  'stubs?': recipeStubsType,
});

/**
 * Per-kind default: `mode` and `material` are limited to those of that kind (zod checks the same in
 * superRefine).
 */
const kindDefaultType = (kind: ItemKind) =>
  type({
    '+': 'reject',
    'mode?': type.enumerated(...modesFor(kind).map((m) => m.id)),
    'options?': inflateOptionsType,
    'material?': type.enumerated(...materialsFor(kind).map((m) => m.id)),
    'materialOptions?': materialOptionsType,
  });
type KindDefaultType = ReturnType<typeof kindDefaultType>;
const defaultsDef = Object.fromEntries(
  ITEM_KINDS.map((kind) => [`${kind}?`, kindDefaultType(kind)]),
) as Record<`${ItemKind}?`, KindDefaultType>;
export const recipeDefaultsType = type({ '+': 'reject', ...defaultsDef });

export const recipeType = type({
  '+': 'reject',
  name,
  description: nonBlank,
  tags,
  target: type.enumerated(...INFLATE_TARGETS).default('claude-code'),
  layout: type.enumerated(...INFLATE_LAYOUTS).default('grouped'),
  'output?': recipeOutputType,
  'preamble?': 'string',
  contexts: name.array().default(() => []),
  items: type({ '+': 'reject', dataset: linkableDataset, slug: name })
    .array()
    .default(() => []),
  markdown: type({ '+': 'reject', id: name, body: 'string' })
    .array()
    .default(() => []),
  overrides: type({
    '+': 'reject',
    key: type(ITEM_KEY_PATTERN).describe('must be <dataset>/<slug> of a linkable dataset'),
    'mode?': type.enumerated(...MODE_IDS),
    'options?': inflateOptionsType,
    'material?': type.enumerated(...MATERIAL_IDS),
    'materialOptions?': materialOptionsType,
    'exclude?': 'boolean',
  })
    .array()
    .default(() => []),
  order: type(SEGMENT_KEY_PATTERN)
    .describe('must be <dataset>/<slug>, md:<id>, ctx:<context> or sec:extra')
    .array()
    .default(() => []),
  defaults: recipeDefaultsType.default(() => ({})),
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

/** The arktype model of each YAML dataset (keys = SCHEMA_DATASETS order). */
export const YAML_DATASET_TYPES = {
  reference: referenceType,
  context: contextType,
  recipe: recipeType,
} as const;
