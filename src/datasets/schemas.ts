// Zod 4 schemas for every dataset. Imports plain 'zod' (the same zod 4 instance astro uses —
// node_modules/astro has no nested zod), so Node scripts, Vitest, and src/content.config.ts all
// share one definition. NEVER import 'astro:content' / 'astro/zod' here.
import { z } from 'zod';
import {
  BUG_STATES,
  FEATURE_STATES,
  IDEA_STATES,
  LINKABLE_DATASETS,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  OWNERS,
  PROJECT_STATES,
  TASK_STATES,
} from './registry.ts';
import type { DatasetId } from './registry.ts';
import {
  classifyRemoteUri,
  GIT_URI_MESSAGE,
  isGitUri,
  SKILL_URI_MESSAGE,
} from '../lib/remote-uri.ts';

/** Entry name == directory name / file stem == collection entry id. */
export const nameSchema = z
  .string()
  .min(1)
  .max(NAME_MAX_LENGTH)
  .regex(NAME_PATTERN, 'must be kebab-case: a-z, 0-9, single hyphens, no leading/trailing hyphen');

/**
 * YAML is parsed with the `timestamp` custom tag (astro's parser, and src/lib/okf.ts mirrors it),
 * so unquoted dates arrive as Date objects; quoted ones as strings. Accept both, output Date.
 */
export const dateSchema = z.coerce.date();

const tagsSchema = z.array(z.string().min(1)).default([]);

// ---------------------------------------------------------------- OKF v0.2 provenance / lifecycle

/** OKF actor: `<producer>/<version>`, `human:<id>`, or `process:<id>`. Not format-enforced (advisory). */
const actorSchema = z.string().min(1);
export const okfEventSchema = z.object({ by: actorSchema, at: dateSchema });
export const okfSourceSchema = z.looseObject({
  id: z.string().min(1).optional(),
  resource: z.string().min(1),
  title: z.string().optional(),
  author: z.string().optional(),
});
export const OKF_STATUSES = ['draft', 'stable', 'deprecated'] as const;

/** Optional OKF keys shared by every concept. Unknown keys are preserved (looseObject). */
const okfConceptShape = {
  type: z.string().trim().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  resource: z.string().optional(),
  tags: tagsSchema,
  sources: z.array(okfSourceSchema).optional(),
  generated: okfEventSchema.optional(),
  verified: z.union([okfEventSchema, z.array(okfEventSchema)]).optional(),
  status: z.enum(OKF_STATUSES).optional(),
  stale_after: dateSchema.optional(),
};

/** Any non-reserved OKF concept file (not index.md / log.md). */
export const okfConceptSchema = z.looseObject(okfConceptShape);

/** Bundle entry concept main.md for kb / rca (no lifecycle). */
export const okfEntrySchema = z.looseObject({
  ...okfConceptShape,
  name: nameSchema,
  description: z.string().trim().min(1),
});

export const kbSchema = okfEntrySchema;
export const rcaSchema = okfEntrySchema;
export const ideaSchema = okfEntrySchema.extend({ state: z.enum(IDEA_STATES) });
export const taskSchema = okfEntrySchema.extend({ state: z.enum(TASK_STATES) });
export const bugSchema = okfEntrySchema.extend({ state: z.enum(BUG_STATES) });
export const featureSchema = okfEntrySchema.extend({ state: z.enum(FEATURE_STATES) });
export const projectSchema = okfEntrySchema.extend({ state: z.enum(PROJECT_STATES) });

/** Bundle-root index.md: only okf_version is allowed (OKF v0.2). Nested index.md: no frontmatter. */
export const okfIndexSchema = z.strictObject({ okf_version: z.literal('0.2').optional() });

/**
 * `docs` collection: EVERY .md file inside okf bundles (main.md, concepts, index.md, log.md).
 * Loose on purpose — strict OKF rules are enforced by scripts/check-okf.ts, not the site build.
 */
export const docSchema = z.looseObject({
  type: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: tagsSchema,
  state: z.string().optional(),
  okf_version: z.union([z.string(), z.number()]).optional(),
  status: z.string().optional(),
  stale_after: dateSchema.optional(),
});

// ---------------------------------------------------------------- skill (agentskills.io)

/** agentskills.io SKILL.md frontmatter. Strict: the spec defines exactly these fields. */
export const skillSchema = z.strictObject({
  name: nameSchema,
  description: z.string().trim().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.string().min(1).max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  'allowed-tools': z.string().optional(),
});

// ---------------------------------------------------------------- reference (yaml, discriminated)

const ownerSchema = z.enum(OWNERS);
const referenceBase = {
  name: nameSchema,
  description: z.string().trim().min(1),
  tags: tagsSchema,
};
export const localRepoReferenceSchema = z.strictObject({
  ...referenceBase,
  type: z.literal('local-repo'),
  /** Absolute path (or ~-prefixed) to the repo root on this machine. */
  path: z.string().min(1),
  subpath: z.string().optional(),
  owner: ownerSchema,
});
export const remoteRepoReferenceSchema = z.strictObject({
  ...referenceBase,
  type: z.literal('remote-repo'),
  /** git URI: git@host:org/repo.git, ssh://git@host/org/repo.git, https://host/org/repo[.git]. */
  uri: z.string().min(1).refine(isGitUri, { error: GIT_URI_MESSAGE }),
  subpath: z.string().optional(),
  owner: ownerSchema,
});
export const remoteSkillReferenceSchema = z.strictObject({
  ...referenceBase,
  type: z.literal('remote-skill'),
  /** git URI (as remote-repo) OR an https URL ending .tar.gz / .tgz / .zip (see src/lib/remote-uri.ts). */
  uri: z
    .string()
    .min(1)
    .refine((uri) => classifyRemoteUri(uri) !== null, { error: SKILL_URI_MESSAGE }),
  /** Skill folder inside the repo / archive; '' / null / absent = root. */
  subpath: z.string().nullish(),
  owner: ownerSchema,
});
export const referenceSchema = z.discriminatedUnion('type', [
  localRepoReferenceSchema,
  remoteRepoReferenceSchema,
  remoteSkillReferenceSchema,
]);

// ---------------------------------------------------------------- context (yaml)

export const contextLinkSchema = z.strictObject({
  dataset: z.enum(LINKABLE_DATASETS),
  slug: nameSchema,
  /** Optional markdown guidance for the consuming agent about this link in this context. */
  notes: z.string().optional(),
});
export const contextSchema = z
  .strictObject({
    name: nameSchema,
    description: z.string().trim().min(1),
    tags: tagsSchema,
    links: z.array(contextLinkSchema).default([]),
  })
  .superRefine((ctx, issues) => {
    const seen = new Set<string>();
    ctx.links.forEach((link, index) => {
      const key = `${link.dataset}/${link.slug}`;
      if (seen.has(key)) {
        issues.addIssue({
          code: 'custom',
          path: ['links', index],
          message: `duplicate link ${key}`,
        });
      }
      seen.add(key);
    });
  });

// ---------------------------------------------------------------- types + lookup

export type OkfConcept = z.infer<typeof okfConceptSchema>;
export type OkfEntry = z.infer<typeof okfEntrySchema>;
export type KbData = z.infer<typeof kbSchema>;
export type RcaData = z.infer<typeof rcaSchema>;
export type IdeaData = z.infer<typeof ideaSchema>;
export type TaskData = z.infer<typeof taskSchema>;
export type BugData = z.infer<typeof bugSchema>;
export type FeatureData = z.infer<typeof featureSchema>;
export type ProjectData = z.infer<typeof projectSchema>;
export type SkillData = z.infer<typeof skillSchema>;
export type ReferenceData = z.infer<typeof referenceSchema>;
export type ContextLink = z.infer<typeof contextLinkSchema>;
export type ContextData = z.infer<typeof contextSchema>;
/** Input shape (before defaults) — what API clients send and what context-io writes. */
export type ContextInput = z.input<typeof contextSchema>;
export type DocData = z.infer<typeof docSchema>;

/** Schema per dataset id (used by content.config.ts, check-collections.ts, context-io.ts). */
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
} as const satisfies Record<DatasetId, z.ZodType>;
