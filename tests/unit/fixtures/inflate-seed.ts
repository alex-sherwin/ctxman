// Test helpers: a data directory shaped like the shipped seed (context ctxman-dev + recipe ctxman-dev-brief,
// plans/INFLATE_V2_SPEC.md §6.4 / §9.6) with short bodies, built in code in a temp dir (never ./data).
import type { RecipeData } from '../../../src/datasets/schemas.ts';
import { createFsSources } from '../../../src/lib/inflate/fs-sources.ts';
import { prepareInflate } from '../../../src/lib/inflate/pipeline.ts';
import type { PlanContent } from '../../../src/lib/inflate/pipeline.ts';
import type { ExpandedPlan } from '../../../src/lib/inflate/expand.ts';
import { parseRecipe } from '../../../src/lib/inflate/recipe.ts';
import { withYamlComments } from './data-fixtures.ts';

export const SEED_NOW = '2026-10-17T12:00:00.000Z';

const okfEntry = (
  type: string,
  name: string,
  description: string,
  extra = '',
  body = `# ${name}\n`,
): string =>
  `---\nokf_version: "0.2"\ntype: ${type}\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}`;

/** The kb/ctxman bundle: index.md (the entry, with a Concepts section), one concept, links to a mounted and an unmounted entry. */
function ctxmanBundle(): Record<string, string> {
  return {
    'kb/ctxman/index.md': okfEntry(
      'Knowledge Base',
      'ctxman',
      'What ctxman is, how it is built, and how to work with its datasets, context forge, search and checks.',
      'title: ctxman\ntags: [ctxman, architecture, docs]\n',
      '# ctxman\n\nSee [datasets](/concepts/datasets.md), the [idea](ctxman:idea/context-inflate) and the [docs](ctxman:reference/astro-docs).\n',
    ),
    'kb/ctxman/concepts/datasets.md': `---\ntype: Concept\ndescription: The datasets.\n---\n\n# Datasets\n\nBack to [entry](../index.md).\n`,
  };
}

/** Every entry of the shipped ctxman-dev context, with short bodies. */
export function seedTree(extra: Record<string, string> = {}): Record<string, string> {
  return withYamlComments({
    ...ctxmanBundle(),
    'kb/astro-content-layer/index.md': okfEntry(
      'Knowledge Base',
      'astro-content-layer',
      'How Astro 7 content collections, loaders and schemas work.',
    ),
    'rca/astro-dev-full-reload-on-save/index.md': okfEntry(
      'Root Cause Analysis',
      'astro-dev-full-reload-on-save',
      'Saving a context in the forge reloaded the whole page, because the loader watched the file.',
    ),
    'idea/context-inflate/index.md': okfEntry(
      'Idea',
      'context-inflate',
      'A tool that turns selected contexts plus user instructions into one document.',
      'state: pending\n',
    ),
    'task/write-agents-md/index.md': okfEntry(
      'Task',
      'write-agents-md',
      'Write and maintain the agent guide at the repository root.',
      'state: pending\n',
    ),
    'bug/stale-badge-timezone/index.md': okfEntry(
      'Bug',
      'stale-badge-timezone',
      'The stale badge flips a day early with a negative UTC offset.',
      'state: pending\n',
    ),
    'feature/context-forge/index.md': okfEntry(
      'Feature',
      'context-forge',
      'A UI at /forge to discover entries across datasets and build contexts.',
      'state: in-progress\n',
    ),
    'project/ctxman-v1/index.md': okfEntry(
      'Project',
      'ctxman-v1',
      'Deliver the first complete version of ctxman with ten datasets.',
      'state: in-progress\n',
    ),
    'skill/okf-authoring/SKILL.md': `---\nname: okf-authoring\ndescription: Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project).\n---\n\n# OKF authoring\n\nFollow the checklist.\n`,
    'skill/ctxman-add-entry/SKILL.md': `---\nname: ctxman-add-entry\ndescription: Create a new ctxman dataset entry with the add scripts.\n---\n\n# Add an entry\n\nRun the script.\n`,
    'reference/astro-docs.yaml': `name: astro-docs\ndescription: The Astro documentation source, English content. Consult it for content collections, loaders, routing and configuration.\ntype: remote-repo\nuri: https://github.com/withastro/docs.git\nsubpath: src/content/docs/en\nowner: not-me\ntags:\n  - astro\n  - docs\n`,
    'context/ctxman-dev.yaml': `name: ctxman-dev
description: Everything an agent needs to work on ctxman itself.
links:
  - dataset: kb
    slug: ctxman
    notes: |
      Start here.
  - dataset: kb
    slug: astro-content-layer
  - dataset: rca
    slug: astro-dev-full-reload-on-save
  - dataset: idea
    slug: context-inflate
  - dataset: task
    slug: write-agents-md
  - dataset: bug
    slug: stale-badge-timezone
  - dataset: feature
    slug: context-forge
  - dataset: project
    slug: ctxman-v1
  - dataset: skill
    slug: okf-authoring
  - dataset: reference
    slug: astro-docs
    notes: |
      Upstream Astro docs.
`,
    ...extra,
  });
}

/** `reference/<name>.yaml` text. */
export const referenceYaml = (
  name: string,
  fields: string,
  description = `Desc ${name}.`,
): string => `name: ${name}\ndescription: ${description}\n${fields}`;

/** The shipped recipe ctxman-dev-brief (short preamble / block), with optional top-level changes. */
export function seedRecipe(change: Record<string, unknown> = {}): RecipeData {
  const parsed = parseRecipe({
    name: 'ctxman-dev-brief',
    description: 'Session brief for working on ctxman itself.',
    target: 'claude-code',
    layout: 'grouped',
    output: { dir: '~/ctxman-inflate/ctxman-dev-brief', primary: 'reference/astro-docs' },
    preamble: 'You are working on ctxman.\n\nUse pnpm only.\n',
    contexts: ['ctxman-dev'],
    items: [{ dataset: 'skill', slug: 'ctxman-add-entry' }],
    markdown: [{ id: 'b1', body: '## Ground rules\n\n- Keep AGENTS.md current.\n' }],
    overrides: [
      { key: 'kb/ctxman', mode: 'inline-bundle' },
      { key: 'bug/stale-badge-timezone', exclude: true },
      {
        key: 'reference/astro-docs',
        mode: 'clone',
        options: { sparse: true },
        material: 'clone',
        materialOptions: { subpathOnly: true },
      },
    ],
    order: ['md:b1', 'ctx:ctxman-dev'],
    ...change,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.recipe;
}

/** expand + gather over a fixture data dir. */
export async function prepare(
  dataDir: string,
  recipe: RecipeData,
  homeDir = '/home/test',
): Promise<{ plan: ExpandedPlan; content: PlanContent }> {
  return prepareInflate(recipe, createFsSources({ dataDir, nowMs: Date.parse(SEED_NOW), homeDir }));
}
