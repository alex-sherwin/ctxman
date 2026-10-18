import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import type { Loader } from 'astro/loaders';
import { OKF_DATASET_IDS } from './datasets/registry.ts';
import type { OkfDatasetId } from './datasets/registry.ts';
import {
  bugSchema,
  contextSchema,
  docSchema,
  featureSchema,
  ideaSchema,
  kbSchema,
  projectSchema,
  rcaSchema,
  recipeSchema,
  referenceSchema,
  skillSchema,
  taskSchema,
} from './datasets/schemas.ts';
import { datasetDir, dirUrl, resolveDataDir } from './lib/data-dir.ts';
import { parseYaml } from './lib/yaml.ts';

const dataDir = resolveDataDir();

/** id = first path segment (the bundle / skill directory name). `entry` is posix, relative to base. */
const dirNameId = ({ entry }: { entry: string }): string => entry.split('/')[0] ?? entry;
/** id = file stem of a top-level yaml file. */
const stemId = ({ entry }: { entry: string }): string => entry.replace(/\.ya?ml$/, '');

/**
 * <dataset>/*.yaml loader WITHOUT a file watcher, shared by `context` and `recipe`. The Forge and Inflate
 * write these files at runtime; a glob loader would make `astro dev` push a full browser reload ~0.7s
 * after every save. Runtime reads go through src/lib/context-io.ts / src/lib/recipe-io.ts (fs); these
 * collections exist for schema validation in `astro sync` / `astro build` / typecheck.
 * NEVER call getCollection('context') or getCollection('recipe') in pages/APIs.
 */
function yamlDirLoader(name: string, dir: string): Loader {
  return {
    name: `ctxman-${name}-yaml`,
    load: async ({ store, parseData, generateDigest, config }) => {
      store.clear();
      const files = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.yaml')) : [];
      for (const file of files.sort()) {
        const id = file.slice(0, -'.yaml'.length);
        const filePath = path.join(dir, file);
        const raw = await readFile(filePath, 'utf8');
        const parsed = parseYaml(raw);
        const input =
          parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        const data = await parseData({ id, data: input, filePath });
        // store.set requires a posix path relative to the site root (like the glob loader stores).
        const rel = path.relative(fileURLToPath(config.root), filePath).split(path.sep).join('/');
        store.set({ id, data, filePath: rel, digest: generateDigest(raw) });
      }
    },
  };
}

const okfBundle = (dataset: OkfDatasetId) =>
  glob({ pattern: '*/main.md', base: dirUrl(datasetDir(dataset, dataDir)), generateId: dirNameId });

export const collections = {
  kb: defineCollection({ loader: okfBundle('kb'), schema: kbSchema }),
  rca: defineCollection({ loader: okfBundle('rca'), schema: rcaSchema }),
  idea: defineCollection({ loader: okfBundle('idea'), schema: ideaSchema }),
  task: defineCollection({ loader: okfBundle('task'), schema: taskSchema }),
  bug: defineCollection({ loader: okfBundle('bug'), schema: bugSchema }),
  feature: defineCollection({ loader: okfBundle('feature'), schema: featureSchema }),
  project: defineCollection({ loader: okfBundle('project'), schema: projectSchema }),
  skill: defineCollection({
    loader: glob({
      pattern: '*/SKILL.md',
      base: dirUrl(datasetDir('skill', dataDir)),
      generateId: dirNameId,
    }),
    schema: skillSchema,
  }),
  reference: defineCollection({
    loader: glob({
      pattern: '*.yaml',
      base: dirUrl(datasetDir('reference', dataDir)),
      generateId: stemId,
    }),
    schema: referenceSchema,
  }),
  context: defineCollection({
    loader: yamlDirLoader('context', datasetDir('context', dataDir)),
    schema: contextSchema,
  }),
  recipe: defineCollection({
    loader: yamlDirLoader('recipe', datasetDir('recipe', dataDir)),
    schema: recipeSchema,
  }),
  /** Every markdown file in every okf bundle. id = '<dataset>/<bundle>/<path without .md>', e.g. 'kb/ctxman/index'. */
  docs: defineCollection({
    loader: glob({
      pattern: OKF_DATASET_IDS.map((id) => `${id}/*/**/*.md`),
      base: dirUrl(dataDir),
      generateId: ({ entry }) => entry.replace(/\.md$/, ''),
    }),
    schema: docSchema,
  }),
};
