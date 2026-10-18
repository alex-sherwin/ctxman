// NODE: writes the files `templates.ts` `planNewEntry` planned for a NEW entry, validates what landed on disk and
// undoes everything when it does not pass. Shared by `scripts/add-entry.ts` (exit codes) and the create API
// (`entry-io.createEntry`); extracted from the script so both use the same files, validation and rollback
// (plans/ROUND3_SPEC.md §D.6). Never overwrites.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { datasetDef, isOkfDatasetId } from '../datasets/registry.ts';
import type { DatasetId } from '../datasets/registry.ts';
import { DATASET_SCHEMAS } from '../datasets/schemas.ts';
import { validate } from '../datasets/validate.ts';
import { resolveDataDir } from './data-dir.ts';
import { describeIssue, issuePath } from './findings.ts';
import { entryAbsPath } from './freshness.ts';
import { parseFrontmatter, validateOkfFile } from './okf.ts';
import type { PlannedFile } from './templates.ts';
import { parseYaml } from './yaml.ts';

/**
 * `exists`: the entry (directory or yaml file) is already on disk, `relPath` is its data-dir-relative path.
 * `invalid`: a generated file failed validation (`problems`, one line each); everything was rolled back.
 * `io`: the write failed for another reason; everything was rolled back.
 */
export class EntryCreateError extends Error {
  code: 'exists' | 'invalid' | 'io';
  /** For `exists`: data-dir-relative posix path that already exists (the entry directory / yaml file, or the first planned file). */
  relPath?: string;
  /** For `invalid`: `<file>: <problem>` lines. */
  problems: string[];
  constructor(
    code: EntryCreateError['code'],
    message: string,
    extra: { relPath?: string; problems?: string[] } = {},
  ) {
    super(message);
    this.name = 'EntryCreateError';
    this.code = code;
    this.problems = extra.problems ?? [];
    if (extra.relPath !== undefined) this.relPath = extra.relPath;
  }
}

/**
 * The validation errors of one freshly generated file: okf files through `validateOkfFile` (errors only), skill
 * and data files through their arktype schema (+ `name` must equal the entry name). `source` is what was read back
 * from disk. Empty = fine.
 */
export function plannedProblems(
  dataset: DatasetId,
  name: string,
  planned: PlannedFile,
  source: string,
): string[] {
  const def = datasetDef(dataset);
  const fail = (message: string): string[] => [`${planned.relPath}: ${message}`];
  const schemaProblems = (data: unknown): string[] => {
    const result = validate(DATASET_SCHEMAS[dataset], data);
    const issues = result.success
      ? []
      : result.issues.map(
          (i) => `${planned.relPath}: ${issuePath(i.path) || '(root)'}: ${describeIssue(i, data)}`,
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

/**
 * Writes `planned` below `dataDir` (never overwriting: `wx`), reads every file back and validates it. On any
 * failure the files written so far (and the entry directory, when empty) are removed and an `EntryCreateError` is
 * thrown. Returns the data-dir-relative paths written, in plan order.
 */
export async function writePlannedEntry(
  dataset: DatasetId,
  name: string,
  planned: readonly PlannedFile[],
  dataDir: string = resolveDataDir(),
): Promise<string[]> {
  const def = datasetDef(dataset);
  const target = entryAbsPath(dataset, name, dataDir);
  if (existsSync(target)) {
    throw new EntryCreateError(
      'exists',
      `${def.kind === 'data' ? `${dataset}/${name}.yaml` : `${dataset}/${name}`} already exists`,
      { relPath: def.kind === 'data' ? `${dataset}/${name}.yaml` : `${dataset}/${name}` },
    );
  }

  const written: string[] = [];
  const rollback = async (): Promise<void> => {
    for (const abs of written) await unlink(abs).catch(() => undefined);
    if (def.kind !== 'data') await rmdir(target).catch(() => undefined);
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
      problems.push(...plannedProblems(dataset, name, file, source));
    }
    if (problems.length > 0) {
      await rollback();
      throw new EntryCreateError(
        'invalid',
        `generated files failed validation:\n  ${problems.join('\n  ')}`,
        { problems },
      );
    }
  } catch (error) {
    if (error instanceof EntryCreateError) throw error;
    await rollback();
    const first = planned[0]?.relPath ?? name;
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new EntryCreateError('exists', `${first} already exists`, { relPath: first });
    }
    throw new EntryCreateError('io', `could not write the entry: ${(error as Error).message}`);
  }
  return planned.map((f) => f.relPath);
}
