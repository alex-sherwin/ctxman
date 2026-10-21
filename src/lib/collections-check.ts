// NODE: schema compliance of every data file (globs, ids, schemas), in plain Node, reporting ALL problems
// instead of stopping at the first. The `collections/*` rule ids are historical. Rule ids: PLAN.md §E.10.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DATASET_IDS,
  OKF_DATASET_IDS,
  OKF_ENTRY_FILE,
  REFERENCE_TYPE_LABELS,
} from '../datasets/registry.ts';
import type { DatasetId, OkfDatasetId, ReferenceType } from '../datasets/registry.ts';
import { DATASET_SCHEMAS, docSchema } from '../datasets/schemas.ts';
import type { RecipeData } from '../datasets/schemas.ts';
import { validate } from '../datasets/validate.ts';
import { walkFiles } from './bundles.ts';
import { datasetDir, resolveDataDir, resolveServerOrigin } from './data-dir.ts';
import { issueMessage, sortFindings } from './findings.ts';
import type { Finding, PathIssue } from './findings.ts';
import { entryFileRelPath } from './freshness.ts';
import {
  EXTRA_KEY,
  ctxKey,
  defaultMaterialFor,
  isMaterialFor,
  isPortableAbsoluteDir,
  isPrimaryEligible,
  itemKey,
  mdKey,
} from './inflate/catalog.ts';
import { parseFrontmatter, parseFrontmatterLoose } from './okf.ts';
import { schemaCommentLine, schemaCommentStatus } from './schema-comment.ts';
import { validateSkillFile } from './skill-check.ts';
import { parseYaml } from './yaml.ts';

interface Ctx {
  dataDir: string;
  findings: Finding[];
  files: Set<string>;
  /** Schema-valid contexts: file stem -> keys (`dataset/slug`) of their links. Filled before recipes run. */
  contextLinks: Map<string, Set<string>>;
  /** Schema-valid references: file stem -> type. Filled before recipes run. */
  referenceTypes: Map<string, ReferenceType>;
  /** Schema-valid recipes, checked against `contextLinks` once every yaml dataset has been read. */
  recipes: { file: string; recipe: RecipeData }[];
}

function add(
  ctx: Ctx,
  severity: Finding['severity'],
  rule: string,
  file: string,
  message: string,
  line?: number,
): void {
  ctx.findings.push(
    line === undefined
      ? { severity, rule, file, message }
      : { severity, rule, file, line, message },
  );
}

function schemaIssues(ctx: Ctx, file: string, issues: readonly PathIssue[], root: unknown): void {
  for (const issue of issues) {
    add(ctx, 'error', 'collections/schema', file, issueMessage(issue, root));
  }
}

async function dirEntries(abs: string) {
  try {
    return (await readdir(abs, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- okf datasets (+ the docs collection)

async function checkOkfDataset(ctx: Ctx, dataset: OkfDatasetId): Promise<void> {
  const base = datasetDir(dataset, ctx.dataDir);
  for (const entry of await dirEntries(base)) {
    if (!entry.isDirectory()) continue;
    const bundle = entry.name;
    const root = path.join(base, bundle);
    for (const relPath of (await walkFiles(root)).filter((f) => f.endsWith('.md'))) {
      const file = `${dataset}/${bundle}/${relPath}`;
      const source = await readFile(path.join(root, ...relPath.split('/')), 'utf8');
      ctx.files.add(file);

      if (relPath === OKF_ENTRY_FILE) {
        // The entry collection (glob '*/index.md', id = directory name).
        const parsed = parseFrontmatter(source);
        if (!parsed.ok) {
          add(
            ctx,
            'error',
            'collections/schema',
            file,
            `frontmatter: ${parsed.error}`,
            parsed.line,
          );
          continue;
        }
        const result = validate(DATASET_SCHEMAS[dataset], parsed.doc.data);
        if (!result.success) schemaIssues(ctx, file, result.issues, parsed.doc.data);
        const name = parsed.doc.data.name;
        if (typeof name === 'string' && name !== bundle) {
          add(
            ctx,
            'error',
            'collections/name-mismatch',
            file,
            `name "${name}" must equal the directory name "${bundle}"`,
          );
        }
        continue;
      }

      // The `docs` collection (every other markdown file in an okf bundle): loose schema.
      let data: Record<string, unknown>;
      try {
        data = parseFrontmatterLoose(source).data;
      } catch (error) {
        add(ctx, 'error', 'collections/schema', file, `frontmatter: ${(error as Error).message}`);
        continue;
      }
      const result = validate(docSchema, data);
      if (!result.success) schemaIssues(ctx, file, result.issues, data);
    }
  }
}

// ---------------------------------------------------------------- skills

async function checkSkills(ctx: Ctx): Promise<void> {
  const base = datasetDir('skill', ctx.dataDir);
  for (const entry of await dirEntries(base)) {
    if (!entry.isDirectory()) {
      add(
        ctx,
        'warning',
        'collections/stray-file',
        `skill/${entry.name}`,
        'only skill directories belong in data/skill/',
      );
      continue;
    }
    const file = `skill/${entry.name}/SKILL.md`;
    const abs = path.join(base, entry.name, 'SKILL.md');
    if (!existsSync(abs)) {
      add(
        ctx,
        'error',
        'collections/missing-skill-md',
        `skill/${entry.name}`,
        'skill directory has no SKILL.md',
      );
      continue;
    }
    ctx.files.add(file);
    // Shared with the doc editor (doc-io.ts): parse errors, the strict agentskills.io schema, name == dir.
    ctx.findings.push(...validateSkillFile(await readFile(abs, 'utf8'), entry.name, file));
  }
}

// ---------------------------------------------------------------- reference + snippet + context + recipe (yaml)

async function checkYamlDataset(
  ctx: Ctx,
  dataset: 'reference' | 'snippet' | 'context' | 'recipe',
): Promise<void> {
  const base = datasetDir(dataset, ctx.dataDir);
  const linkChecks: { file: string; links: { dataset: DatasetId; slug: string }[] }[] = [];

  for (const entry of await dirEntries(base)) {
    const rel = `${dataset}/${entry.name}`;
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) {
      add(
        ctx,
        'warning',
        'collections/stray-file',
        rel,
        entry.name.endsWith('.yml')
          ? 'astro only loads *.yaml; rename this .yml file'
          : `only <name>.yaml files belong in data/${dataset}/`,
      );
      continue;
    }
    ctx.files.add(rel);
    const stem = entry.name.slice(0, -'.yaml'.length);
    const source = await readFile(path.join(base, entry.name), 'utf8');
    // Not a schema rule: the first line only points editors at this server's /api/schemas/<dataset>.
    const commentStatus = schemaCommentStatus(dataset, source);
    if (commentStatus !== 'ok') {
      const line = schemaCommentLine(dataset, resolveServerOrigin());
      add(
        ctx,
        'warning',
        'collections/yaml-schema-comment',
        rel,
        commentStatus === 'missing'
          ? `first line must be "${line}" (pnpm run fix:yaml-comments adds it)`
          : `schema comment must point at this server's /api/schemas/${dataset} (pnpm run fix:yaml-comments fixes it)`,
        1,
      );
    }
    let value: unknown;
    try {
      value = parseYaml(source);
    } catch (error) {
      const message = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
      const linePos = (error as { linePos?: { line?: number }[] }).linePos?.[0]?.line;
      add(ctx, 'error', 'collections/schema', rel, `YAML: ${message}`, linePos);
      continue;
    }
    const input = value !== null && typeof value === 'object' ? value : {};
    const result = validate(DATASET_SCHEMAS[dataset], input);
    if (!result.success) {
      schemaIssues(ctx, rel, result.issues, input);
      continue;
    }
    const name = (result.data as { name: string }).name;
    if (name !== stem) {
      add(
        ctx,
        'error',
        'collections/name-mismatch',
        rel,
        `name "${name}" must equal the file name "${stem}"`,
      );
    }
    if (dataset === 'context') {
      const links = (result.data as { links: { dataset: DatasetId; slug: string }[] }).links;
      linkChecks.push({ file: rel, links });
      ctx.contextLinks.set(stem, new Set(links.map((l) => `${l.dataset}/${l.slug}`)));
    }
    if (dataset === 'reference') {
      ctx.referenceTypes.set(stem, (result.data as { type: ReferenceType }).type);
    }
    if (dataset === 'recipe') ctx.recipes.push({ file: rel, recipe: result.data as RecipeData });
  }

  for (const { file, links } of linkChecks) {
    for (const link of links) {
      const target = path.join(
        ctx.dataDir,
        ...entryFileRelPath(link.dataset, link.slug).split('/'),
      );
      if (!existsSync(target)) {
        add(
          ctx,
          'warning',
          'collections/dangling-link',
          file,
          `link ${link.dataset}/${link.slug} does not exist`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------- recipe references

/**
 * Working-directory output of a recipe (plans/INFLATE_V2_SPEC.md §12): a relative `output.dir`, a `material` on
 * a `reference/<slug>` override that its reference type cannot have, and an unusable `output.primary`.
 * Returns the primary key when it still has to be checked for reachability once the reachable set is known.
 */
function checkRecipeOutput(ctx: Ctx, file: string, recipe: RecipeData): string | null {
  const dir = recipe.output?.dir;
  if (dir !== undefined && !isPortableAbsoluteDir(dir)) {
    add(
      ctx,
      'warning',
      'collections/recipe-output-dir-relative',
      file,
      `output.dir "${dir}" must be absolute or start with ~/`,
    );
  }

  for (const override of recipe.overrides) {
    if (override.material === undefined || !override.key.startsWith('reference/')) continue;
    const type = ctx.referenceTypes.get(override.key.slice('reference/'.length));
    if (type === undefined || isMaterialFor(type, override.material)) continue;
    add(
      ctx,
      'warning',
      'collections/recipe-material-invalid',
      file,
      `material "${override.material}" does not apply to ${override.key} (${REFERENCE_TYPE_LABELS[type]})`,
    );
  }

  const primary = recipe.output?.primary;
  if (primary === undefined) return null;
  const type = ctx.referenceTypes.get(primary.slice('reference/'.length));
  if (type !== 'local-repo' && type !== 'remote-repo') {
    add(
      ctx,
      'warning',
      'collections/recipe-primary-invalid',
      file,
      `primary ${primary} must be a remote-repo or local-repo reference`,
    );
    return null;
  }
  const material =
    recipe.overrides.find((o) => o.key === primary)?.material ??
    recipe.defaults[type]?.material ??
    defaultMaterialFor(type, recipe.target);
  if (!isPrimaryEligible(type, material)) {
    add(
      ctx,
      'warning',
      'collections/recipe-primary-invalid',
      file,
      `primary ${primary} needs material clone (remote-repo) or symlink or worktree (local-repo)`,
    );
    return null;
  }
  return primary;
}

/**
 * Warnings for what a recipe points at: contexts and ad hoc items that do not exist, and (only when every
 * listed context exists and is valid, so the reachable set is known) overrides and order keys that match
 * nothing in the recipe, and a primary repository that is not an item of the recipe.
 */
function checkRecipeReferences(ctx: Ctx): void {
  for (const { file, recipe } of ctx.recipes) {
    let allContextsKnown = true;
    for (const slug of recipe.contexts) {
      if (ctx.contextLinks.has(slug)) continue;
      allContextsKnown = false;
      if (!existsSync(path.join(ctx.dataDir, 'context', `${slug}.yaml`))) {
        add(
          ctx,
          'warning',
          'collections/recipe-context-missing',
          file,
          `context ${slug} does not exist`,
        );
      }
    }

    const reachable = new Set<string>();
    for (const item of recipe.items) {
      const key = itemKey(item.dataset, item.slug);
      reachable.add(key);
      const target = path.join(
        ctx.dataDir,
        ...entryFileRelPath(item.dataset, item.slug).split('/'),
      );
      if (!existsSync(target)) {
        add(ctx, 'warning', 'collections/recipe-item-missing', file, `item ${key} does not exist`);
      }
    }
    const primaryToReach = checkRecipeOutput(ctx, file, recipe);
    if (!allContextsKnown) continue;

    for (const slug of recipe.contexts) {
      for (const key of ctx.contextLinks.get(slug) ?? []) reachable.add(key);
    }
    if (primaryToReach !== null && !reachable.has(primaryToReach)) {
      add(
        ctx,
        'warning',
        'collections/recipe-primary-invalid',
        file,
        `primary ${primaryToReach} is not an item of this recipe`,
      );
    }
    for (const override of recipe.overrides) {
      if (!reachable.has(override.key)) {
        add(
          ctx,
          'warning',
          'collections/recipe-override-stale',
          file,
          `override ${override.key} matches no item of this recipe`,
        );
      }
    }
    const validOrder = new Set<string>([
      EXTRA_KEY,
      ...recipe.contexts.map(ctxKey),
      ...reachable,
      ...recipe.markdown.map((block) => mdKey(block.id)),
    ]);
    for (const key of recipe.order) {
      if (!validOrder.has(key)) {
        add(
          ctx,
          'warning',
          'collections/recipe-order-stale',
          file,
          `order key ${key} matches nothing in this recipe`,
        );
      }
    }
  }
}

/** Validates every data file against its dataset schema; see PLAN.md §E.10 for the rules. */
export async function checkCollections(
  dataDir: string = resolveDataDir(),
): Promise<{ findings: Finding[]; filesChecked: number }> {
  const ctx: Ctx = {
    dataDir,
    findings: [],
    files: new Set(),
    contextLinks: new Map(),
    referenceTypes: new Map(),
    recipes: [],
  };

  for (const entry of await dirEntries(dataDir)) {
    if (entry.isDirectory() && !(DATASET_IDS as readonly string[]).includes(entry.name)) {
      add(
        ctx,
        'warning',
        'collections/unknown-dir',
        entry.name,
        `data/${entry.name} is not a ctxman dataset and is ignored`,
      );
    }
  }

  for (const dataset of OKF_DATASET_IDS) await checkOkfDataset(ctx, dataset);
  await checkSkills(ctx);
  await checkYamlDataset(ctx, 'reference');
  await checkYamlDataset(ctx, 'snippet');
  await checkYamlDataset(ctx, 'context');
  await checkYamlDataset(ctx, 'recipe');
  checkRecipeReferences(ctx);

  return { findings: sortFindings(ctx.findings), filesChecked: ctx.files.size };
}
