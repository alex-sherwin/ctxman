// NODE: the real `InflateSources` (plans/INFLATE_SPEC.md §5.7): reads contexts, items, bundle files and
// local directories from the filesystem. Never import from the browser island.
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { datasetDef, isLinkableDatasetId, isValidName } from '../../datasets/registry.ts';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import { DATASET_SCHEMAS, referenceSchema, snippetSchema } from '../../datasets/schemas.ts';
import { validate } from '../../datasets/validate.ts';
import { listBundleFiles, readBundleText } from '../bundles.ts';
import { ContextIoError, readContext } from '../context-io.ts';
import { datasetDir, resolveDataDir } from '../data-dir.ts';
import { summarize } from '../entry-summary.ts';
import { issueMessage } from '../findings.ts';
import { entryAbsPath, entryFileRelPath } from '../freshness.ts';
import { parseFrontmatterLoose } from '../okf.ts';
import { parseYaml } from '../yaml.ts';
import { itemMetaFromSummary } from './expand.ts';
import type { ContextLookup, ItemLookup } from './expand.ts';
import type { EntryRef, InflateSources } from './pipeline.ts';

const errorCode = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException | null)?.code;
const messageOf = (error: unknown): string =>
  error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
const compareNames = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

async function classify(abs: string): Promise<'dir' | 'file' | null> {
  try {
    const st = await stat(abs);
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null;
  } catch {
    return null;
  }
}

export function createFsSources(
  opts: { dataDir?: string; nowMs?: number; homeDir?: string; cwd?: string } = {},
): InflateSources {
  const dataDir = opts.dataDir ?? resolveDataDir();
  const nowMs = opts.nowMs ?? Date.now();
  const home = opts.homeDir ?? os.homedir();
  const cwd = opts.cwd ?? process.cwd();

  const entryFile = (dataset: Parameters<typeof entryFileRelPath>[0], slug: string): string =>
    path.join(dataDir, ...entryFileRelPath(dataset, slug).split('/'));

  async function readContextLookup(slug: string): Promise<ContextLookup> {
    try {
      const record = await readContext(slug, dataDir);
      return { status: 'ready', context: record.context };
    } catch (error) {
      if (!(error instanceof ContextIoError)) throw error;
      if (error.code === 'not-found' || error.code === 'bad-slug') return { status: 'missing' };
      const issues = error.issues
        .map((i) => (i.path === '' ? i.message : `${i.path}: ${i.message}`))
        .join('; ');
      return {
        status: 'invalid',
        message: issues === '' ? error.message : `${error.message}: ${issues}`,
      };
    }
  }

  /** okf `index.md` / skill `SKILL.md`: frontmatter parsed loosely, validated with the dataset schema. */
  async function readFrontmatterItem(
    dataset: Exclude<LinkableDatasetId, 'reference' | 'snippet'>,
    slug: string,
  ): Promise<ItemLookup> {
    const file = datasetDef(dataset).entryFile;
    const text = await readBundleText(dataset, slug, file, dataDir);
    if (text === null) return { status: 'missing' };
    let data: Record<string, unknown>;
    try {
      data = parseFrontmatterLoose(text).data;
    } catch (error) {
      return { status: 'invalid', message: messageOf(error) };
    }
    const parsed = validate(DATASET_SCHEMAS[dataset], data);
    if (!parsed.success) {
      const issue = parsed.issues[0];
      return {
        status: 'invalid',
        message: issue === undefined ? 'does not match the schema' : issueMessage(issue, data),
      };
    }
    return {
      status: 'ready',
      meta: itemMetaFromSummary(summarize(dataset, slug, data, new Date(0), nowMs)),
    };
  }

  /** `reference/<slug>.yaml` / `snippet/<slug>.yaml` parsed (not validated), or the lookup that ends the read. */
  async function readYamlItem(
    dataset: 'reference' | 'snippet',
    slug: string,
  ): Promise<{ data: Record<string, unknown> } | { lookup: ItemLookup }> {
    let source: string;
    try {
      source = await readFile(path.join(datasetDir(dataset, dataDir), `${slug}.yaml`), 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EISDIR') {
        return { lookup: { status: 'missing' } };
      }
      throw error;
    }
    let value: unknown;
    try {
      value = parseYaml(source);
    } catch (error) {
      return { lookup: { status: 'invalid', message: messageOf(error) } };
    }
    return {
      data: (value !== null && typeof value === 'object' ? value : {}) as Record<string, unknown>,
    };
  }

  function invalidLookup(
    issue: Parameters<typeof issueMessage>[0] | undefined,
    data: Record<string, unknown>,
  ): ItemLookup {
    return {
      status: 'invalid',
      message: issue === undefined ? 'does not match the schema' : issueMessage(issue, data),
    };
  }

  async function readReferenceItem(slug: string): Promise<ItemLookup> {
    const read = await readYamlItem('reference', slug);
    if ('lookup' in read) return read.lookup;
    const data = read.data;
    const parsed = validate(referenceSchema, data);
    if (!parsed.success) return invalidLookup(parsed.issues[0], data);
    return {
      status: 'ready',
      meta: {
        ...itemMetaFromSummary(summarize('reference', slug, data, new Date(0), nowMs)),
        ref: parsed.data,
      },
    };
  }

  async function readSnippetItem(slug: string): Promise<ItemLookup> {
    const read = await readYamlItem('snippet', slug);
    if ('lookup' in read) return read.lookup;
    const data = read.data;
    const parsed = validate(snippetSchema, data);
    if (!parsed.success) return invalidLookup(parsed.issues[0], data);
    return {
      status: 'ready',
      meta: {
        ...itemMetaFromSummary(summarize('snippet', slug, data, new Date(0), nowMs)),
        markdown: parsed.data.markdown,
      },
    };
  }

  async function readItem(dataset: LinkableDatasetId, slug: string): Promise<ItemLookup> {
    if (!isValidName(slug)) return { status: 'missing' };
    if (dataset === 'reference') return readReferenceItem(slug);
    if (dataset === 'snippet') return readSnippetItem(slug);
    return readFrontmatterItem(dataset, slug);
  }

  return {
    readContext: readContextLookup,
    readItem,

    async entryRef(dataset, slug): Promise<EntryRef | null> {
      if (!isValidName(slug)) return null;
      const abs = entryFile(dataset, slug);
      if ((await classify(abs)) !== 'file') return null;
      if (isLinkableDatasetId(dataset)) {
        const found = await readItem(dataset, slug);
        return { title: found.status === 'ready' ? found.meta.title : slug, abs };
      }
      return { title: slug, abs };
    },

    itemPaths(dataset, slug) {
      return { rootAbs: entryAbsPath(dataset, slug, dataDir), entryAbs: entryFile(dataset, slug) };
    },

    async listFiles(dataset, slug) {
      const rootAbs = entryAbsPath(dataset, slug, dataDir);
      return (await listBundleFiles(dataset, slug, dataDir)).map((f) => ({
        rel: f.path,
        abs: path.join(rootAbs, ...f.path.split('/')),
        kind: f.kind,
      }));
    },

    readText: (dataset, slug, rel) => readBundleText(dataset, slug, rel, dataDir),

    localPaths(p, subpath) {
      const root =
        p === '~'
          ? home
          : p.startsWith('~/') || p.startsWith('~\\')
            ? path.join(home, p.slice(2))
            : path.resolve(cwd, p);
      const target =
        subpath !== undefined && subpath.trim() !== ''
          ? path.join(root, ...subpath.split(/[\\/]+/).filter(Boolean))
          : root;
      return { root, target };
    },

    statPath: classify,

    async listDir(abs) {
      let entries;
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch {
        return null;
      }
      const rows: { name: string; dir: boolean }[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const dir = entry.isSymbolicLink()
          ? (await classify(path.join(abs, entry.name))) === 'dir'
          : entry.isDirectory();
        rows.push({ name: entry.name, dir });
      }
      return rows.sort(
        (a, b) =>
          Number(b.dir) - Number(a.dir) ||
          compareNames(a.name.toLowerCase(), b.name.toLowerCase()) ||
          compareNames(a.name, b.name),
      );
    },
  };
}
