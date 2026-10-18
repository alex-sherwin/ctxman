// SERVER (no astro:*): the MCP resources of /mcp (plans/CORE_REFACTOR_PLAN.md §8). Two URI templates:
//   ctxman://{dataset}/{slug}                 the entry file as it is on disk (index.md / SKILL.md / <slug>.yaml)
//   ctxman://{dataset}/{slug}/doc/{+path}     one text file of an okf bundle / skill directory
// `resources/list` enumerates every entry (not the bundle files: use list-bundle-files). Reads go to the disk on
// every call and reuse the bundle guards (safeJoin + realpath inside the bundle, 512 KB cap).
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DATASET_IDS, datasetDef, isValidName } from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';
import { MAX_TEXT_BYTES, resolveBundleFile } from '../bundles.ts';
import { listAllEntries } from '../entries.ts';
import { entryAbsPath } from '../freshness.ts';
import type { ToolContext } from './tools.ts';

export const RESOURCE_ENTRY_TEMPLATE = 'ctxman://{dataset}/{slug}';
export const RESOURCE_DOC_TEMPLATE = 'ctxman://{dataset}/{slug}/doc/{+path}';

export const entryUri = (dataset: string, slug: string): string => `ctxman://${dataset}/${slug}`;

export const docUri = (dataset: string, slug: string, relPath: string): string =>
  `ctxman://${dataset}/${slug}/doc/${relPath.split('/').map(encodeURIComponent).join('/')}`;

/** `text/markdown` for .md, else `text/plain`. */
export function mimeForPath(relPath: string): string {
  return relPath.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain';
}

/** okf + skill entry files are markdown; the yaml datasets are `application/yaml`. */
export function entryMime(dataset: DatasetId): string {
  return datasetDef(dataset).kind === 'data' ? 'application/yaml' : 'text/markdown';
}

export interface ResourceListing {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/** One resource per entry of every dataset (invalid files included), dataset order then slug. */
export async function listEntryResources(ctx: ToolContext): Promise<ResourceListing[]> {
  const all = await listAllEntries(ctx.nowMs, ctx.dataDir);
  return DATASET_IDS.flatMap((dataset) =>
    all[dataset].map((s) => ({
      uri: entryUri(dataset, s.slug),
      name: `${dataset}/${s.slug}${s.title === undefined ? '' : `: ${s.title}`}`,
      description: s.description,
      mimeType: entryMime(dataset),
    })),
  );
}

/** Thrown for an unknown entry / file; server.ts turns it into the SDK's resource-not-found error. */
export class ResourceMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceMissingError';
  }
}

function asDataset(value: string): DatasetId {
  if (!(DATASET_IDS as readonly string[]).includes(value)) {
    throw new ResourceMissingError(`unknown dataset "${value}"`);
  }
  return value as DatasetId;
}

async function readCapped(abs: string, size: number, label: string): Promise<string> {
  if (size > MAX_TEXT_BYTES)
    throw new ResourceMissingError(`${label} is larger than ${MAX_TEXT_BYTES} bytes`);
  const buf = await readFile(abs);
  if (buf.includes(0)) throw new ResourceMissingError(`${label} is not a text file`);
  return buf.toString('utf8');
}

/** The entry file as on disk. Throws ResourceMissingError. */
export async function readEntryResource(
  ctx: ToolContext,
  datasetRaw: string,
  slug: string,
): Promise<{ uri: string; mimeType: string; text: string }> {
  const dataset = asDataset(datasetRaw);
  if (!isValidName(slug)) throw new ResourceMissingError(`"${slug}" is not a valid entry name`);
  const def = datasetDef(dataset);
  if (def.kind === 'data') {
    const abs = entryAbsPath(dataset, slug, ctx.dataDir);
    let source: string;
    try {
      source = await readCapped(abs, (await stat(abs)).size, `${dataset}/${slug}`);
    } catch (error) {
      if (error instanceof ResourceMissingError) throw error;
      throw new ResourceMissingError(`${dataset} "${slug}" does not exist`);
    }
    return { uri: entryUri(dataset, slug), mimeType: 'application/yaml', text: source };
  }
  const file = await resolveBundleFile(
    dataset as Exclude<DatasetId, 'reference' | 'context' | 'recipe'>,
    slug,
    def.entryFile,
    ctx.dataDir,
  );
  if (!file.ok) throw new ResourceMissingError(`${dataset} "${slug}" does not exist`);
  return {
    uri: entryUri(dataset, slug),
    mimeType: 'text/markdown',
    text: await readCapped(file.realAbs, file.size, `${dataset}/${slug}`),
  };
}

/** One text file of a bundle / skill directory. Throws ResourceMissingError. */
export async function readDocResource(
  ctx: ToolContext,
  datasetRaw: string,
  slug: string,
  relPath: string,
): Promise<{ uri: string; mimeType: string; text: string }> {
  const dataset = asDataset(datasetRaw);
  if (datasetDef(dataset).kind === 'data') {
    throw new ResourceMissingError(
      `${dataset} entries are single yaml files; read ${entryUri(dataset, slug)}`,
    );
  }
  const file = await resolveBundleFile(
    dataset as Exclude<DatasetId, 'reference' | 'context' | 'recipe'>,
    slug,
    relPath,
    ctx.dataDir,
  );
  if (!file.ok)
    throw new ResourceMissingError(`${relPath} not found in ${dataset}/${slug} (${file.reason})`);
  return {
    uri: docUri(dataset, slug, relPath),
    mimeType: mimeForPath(path.posix.basename(relPath)),
    text: await readCapped(file.realAbs, file.size, relPath),
  };
}
