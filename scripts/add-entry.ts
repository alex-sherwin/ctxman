// Scaffold a new entry of any dataset from its template. Never overwrites.
// Usage: node scripts/add-entry.ts <dataset> <name> [--title T] [--description D] [--state S]
//          [--type local-repo|remote-repo|remote-skill] [--path P] [--uri U] [--subpath S]
//          [--owner me|not-me] [--json]
// Exit 0 created, 1 refused / self-check failed, 2 usage error.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import {
  DATASET_IDS,
  datasetDef,
  entryUrl,
  isDatasetId,
  isOkfDatasetId,
  isReferenceType,
  OWNERS,
  REFERENCE_TYPES,
} from '../src/datasets/registry.ts';
import type { DatasetId, Owner } from '../src/datasets/registry.ts';
import { DATASET_SCHEMAS } from '../src/datasets/schemas.ts';
import { resolveDataDir } from '../src/lib/data-dir.ts';
import { entryAbsPath, entryFileRelPath } from '../src/lib/freshness.ts';
import { parseFrontmatter, validateOkfFile } from '../src/lib/okf.ts';
import {
  GIT_URI_MESSAGE,
  SKILL_URI_MESSAGE,
  classifyRemoteUri,
  isGitUri,
} from '../src/lib/remote-uri.ts';
import { planNewEntry } from '../src/lib/templates.ts';
import type { PlannedFile } from '../src/lib/templates.ts';
import { parseYaml } from '../src/lib/yaml.ts';
import { EXIT_FINDINGS, EXIT_OK, EXIT_USAGE, writeError, writeJson, writeLine } from './cli.ts';

const USAGE = `Usage: node scripts/add-entry.ts <dataset> <name> [options]

  dataset      one of: ${DATASET_IDS.join(', ')}
  name         kebab-case entry name (becomes the directory / file name and slug)

Options:
  --title T          human title (default: derived from the name)
  --description D    one-line description (default: "TODO: describe <title>.")
  --state S          lifecycle state (idea, task, bug, feature, project only; default: first state)
  --type T           reference only: ${REFERENCE_TYPES.join(' | ')} (default: remote-repo)
  --path P           reference local-repo: repo root on this machine
  --uri U            reference remote-repo: git URI (git@host:org/repo.git, ssh://…, https://…);
                     remote-skill: git URI or https URL ending .tar.gz / .tgz / .zip
  --subpath S        reference: repo-relative sub folder
  --owner O          reference: ${OWNERS.join(' | ')} (default: me)
  --json             print one JSON document instead of text
  -h, --help         show this help

Targets CTXMAN_DATA_DIR (default ./data). Exit 0 created, 1 refused, 2 usage error.`;

const wantsJson = process.argv.slice(2).includes('--json');

function finish(code: number, error?: string): void {
  if (error !== undefined) {
    writeError(`add-entry: ${error}`);
    if (wantsJson) writeJson({ ok: false, error });
  }
  process.exitCode = code;
}

/** `data/<rel>` when the data dir is the default ./data, else the absolute path. */
function displayPath(dataDir: string, relPath: string): string {
  const usesDefault = dataDir === path.resolve(process.cwd(), 'data');
  return usesDefault ? `data/${relPath}` : path.join(dataDir, ...relPath.split('/'));
}

function problemsOf(
  dataset: DatasetId,
  name: string,
  planned: PlannedFile,
  source: string,
): string[] {
  const def = datasetDef(dataset);
  const fail = (message: string): string[] => [`${planned.relPath}: ${message}`];
  const schemaProblems = (data: unknown): string[] => {
    const result = DATASET_SCHEMAS[dataset].safeParse(data);
    const issues = result.success
      ? []
      : result.error.issues.map(
          (i) => `${planned.relPath}: ${i.path.map(String).join('.') || '(root)'}: ${i.message}`,
        );
    const given = (data as { name?: unknown } | null)?.name;
    if (result.success && given !== name)
      issues.push(`${planned.relPath}: name must equal "${name}"`);
    return issues;
  };

  if (def.kind === 'okf' && isOkfDatasetId(dataset)) {
    const relPath = planned.relPath.slice(`${dataset}/${name}/`.length);
    return validateOkfFile({ dataset, bundle: name, relPath, source, file: planned.relPath })
      .filter((f) => f.severity === 'error')
      .map((f) => `${f.file}: ${f.rule}: ${f.message}`);
  }
  if (def.kind === 'skill') {
    const parsed = parseFrontmatter(source);
    return parsed.ok ? schemaProblems(parsed.doc.data) : fail(parsed.error);
  }
  try {
    return schemaProblems(parseYaml(source));
  } catch (error) {
    return fail((error as Error).message);
  }
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        title: { type: 'string' },
        description: { type: 'string' },
        state: { type: 'string' },
        type: { type: 'string' },
        path: { type: 'string' },
        uri: { type: 'string' },
        subpath: { type: 'string' },
        owner: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    writeError(USAGE);
    return finish(EXIT_USAGE, (error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    writeLine(USAGE);
    return finish(EXIT_OK);
  }

  const [datasetArg, name, ...extra] = positionals;
  if (datasetArg === undefined || name === undefined || extra.length > 0) {
    writeError(USAGE);
    return finish(EXIT_USAGE, 'expected exactly <dataset> and <name>');
  }
  if (!isDatasetId(datasetArg)) {
    return finish(
      EXIT_USAGE,
      `unknown dataset "${datasetArg}"; use one of: ${DATASET_IDS.join(', ')}`,
    );
  }
  const dataset = datasetArg;

  const referenceOnly = (['type', 'path', 'uri', 'subpath', 'owner'] as const).filter(
    (k) => values[k] !== undefined,
  );
  if (dataset !== 'reference' && referenceOnly.length > 0) {
    return finish(EXIT_USAGE, `--${referenceOnly[0]} only applies to the reference dataset`);
  }
  if (values.type !== undefined && !isReferenceType(values.type)) {
    return finish(
      EXIT_USAGE,
      `invalid --type "${values.type}"; use one of: ${REFERENCE_TYPES.join(', ')}`,
    );
  }
  if (values.owner !== undefined && !(OWNERS as readonly string[]).includes(values.owner)) {
    return finish(
      EXIT_USAGE,
      `invalid --owner "${values.owner}"; use one of: ${OWNERS.join(', ')}`,
    );
  }
  if (dataset === 'reference') {
    const type = values.type ?? 'remote-repo';
    if (values.path !== undefined && type !== 'local-repo') {
      return finish(EXIT_USAGE, '--path only applies to --type local-repo');
    }
    if (values.uri !== undefined && type === 'local-repo') {
      return finish(EXIT_USAGE, '--uri only applies to --type remote-repo or remote-skill');
    }
    if (values.uri !== undefined) {
      const uri = values.uri.trim();
      if (type === 'remote-repo' && !isGitUri(uri)) {
        return finish(EXIT_USAGE, `invalid --uri "${uri}": ${GIT_URI_MESSAGE}`);
      }
      if (type === 'remote-skill' && classifyRemoteUri(uri) === null) {
        return finish(EXIT_USAGE, `invalid --uri "${uri}": ${SKILL_URI_MESSAGE}`);
      }
    }
  }

  const dataDir = resolveDataDir();
  let planned: PlannedFile[];
  try {
    planned = planNewEntry(dataset, name, {
      ...(values.title === undefined ? {} : { title: values.title }),
      ...(values.description === undefined ? {} : { description: values.description }),
      ...(values.state === undefined ? {} : { state: values.state }),
      ...(values.type === undefined || !isReferenceType(values.type) ? {} : { type: values.type }),
      ...(values.path === undefined ? {} : { path: values.path }),
      ...(values.uri === undefined ? {} : { uri: values.uri }),
      ...(values.subpath === undefined ? {} : { subpath: values.subpath }),
      ...(values.owner === undefined ? {} : { owner: values.owner as Owner }),
      now: new Date(),
    });
  } catch (error) {
    return finish(EXIT_USAGE, (error as Error).message);
  }

  const target = entryAbsPath(dataset, name, dataDir);
  if (existsSync(target)) {
    const rel =
      datasetDef(dataset).kind === 'data' ? `${dataset}/${name}.yaml` : `${dataset}/${name}`;
    return finish(EXIT_FINDINGS, `${displayPath(dataDir, rel)} already exists`);
  }

  // Write (never overwriting), then re-read and validate; undo everything on failure.
  const written: string[] = [];
  const rollback = async (): Promise<void> => {
    for (const abs of written) await unlink(abs).catch(() => undefined);
    if (datasetDef(dataset).kind !== 'data') await rmdir(target).catch(() => undefined);
  };
  try {
    for (const file of planned) {
      const abs = path.join(dataDir, ...file.relPath.split('/'));
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, file.content, { encoding: 'utf8', flag: 'wx' });
      written.push(abs);
    }
    const problems: string[] = [];
    for (const file of planned) {
      const source = await readFile(path.join(dataDir, ...file.relPath.split('/')), 'utf8');
      problems.push(...problemsOf(dataset, name, file, source));
    }
    if (problems.length > 0) {
      await rollback();
      return finish(
        EXIT_FINDINGS,
        `generated files failed validation:\n  ${problems.join('\n  ')}`,
      );
    }
  } catch (error) {
    await rollback();
    const code = (error as NodeJS.ErrnoException).code;
    return finish(
      EXIT_FINDINGS,
      code === 'EEXIST'
        ? `${displayPath(dataDir, planned[0]?.relPath ?? name)} already exists`
        : `could not write the entry: ${(error as Error).message}`,
    );
  }

  const files = planned.map((f) => f.relPath);
  if (values.json) {
    writeJson({ ok: true, dataset, slug: name, path: entryFileRelPath(dataset, name), files });
  } else {
    writeLine(`Created ${dataset} "${name}":`);
    for (const rel of files) writeLine(`  ${displayPath(dataDir, rel)}`);
    writeLine(`Open: http://127.0.0.1:4321${entryUrl(dataset, name)}`);
  }
  return finish(EXIT_OK);
}

await main();
