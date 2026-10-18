// POST /api/ide/open  body { dataset: DatasetId, slug: string, path?: string }
//   -> 200 { ok: true, command: string[] }   (= [command, root, file], absolute paths)
// POST /api/ide/open  body { dir: string }  (an inflated working directory: it must hold a valid
//   .ctxman-inflate.json; INFLATE_V2_SPEC §10.5) -> 200 { ok: true, command: string[] }   (= [command, dir])
// GET  /api/ide/open -> 200 { available: boolean, command: string | null }  (resolution only, never spawns)
// 400 bad-json | invalid (issues) | bad-slug | bad-path, 403 forbidden-origin, 404 not-found, 405,
// 415 unsupported-media-type, 500 ide-spawn-failed, 501 ide-not-found. ROUND2_BACKEND_SPEC §B.3.
// Security: local-only server + Origin guard + a fixed command (the request never chooses the executable);
// only the entry dir (okf / skill), the data dir (yaml datasets) or a directory ctxman inflated is ever opened.
import type { APIRoute } from 'astro';
import { DATASET_IDS, isDatasetId, isValidName } from '../../../datasets/registry.ts';
import type { Issue } from '../../../lib/context-io.ts';
import { apiError, json, methodNotAllowed, readJson } from '../../../lib/http.ts';
import type { IdeTarget } from '../../../lib/ide.ts';
import {
  buildIdeInvocation,
  ideTargetFor,
  ideTargetForDir,
  IDE_COMMAND_ENV,
  launchIde,
  resolveIdeCommand,
} from '../../../lib/ide.ts';

export const GET: APIRoute = () => {
  const resolved = resolveIdeCommand();
  return json({ available: resolved.ok, command: resolved.ok ? resolved.command : null });
};

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;

  const value = body.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return apiError(
      400,
      'invalid',
      'body must be a JSON object { dataset, slug, path? } or { dir }',
      [{ path: '', message: 'must be an object' }],
    );
  }
  const record = value as Record<string, unknown>;

  // { dir }: an inflated working directory. `dir` is the only key allowed in that variant.
  if (Object.hasOwn(record, 'dir')) {
    const dirIssues: Issue[] = [];
    if (typeof record.dir !== 'string')
      dirIssues.push({ path: 'dir', message: 'must be a string' });
    for (const key of Object.keys(record)) {
      if (key !== 'dir') dirIssues.push({ path: key, message: 'unexpected property' });
    }
    if (dirIssues.length > 0 || typeof record.dir !== 'string') {
      return apiError(400, 'invalid', 'request body is invalid', dirIssues);
    }
    const found = await ideTargetForDir(record.dir);
    if (!found.ok) {
      return apiError(found.error === 'not-found' ? 404 : 400, found.error, found.message);
    }
    return launch(found.target);
  }

  const issues: Issue[] = [];
  if (!isDatasetId(record.dataset)) {
    issues.push({ path: 'dataset', message: `must be one of ${DATASET_IDS.join(', ')}` });
  }
  if (typeof record.slug !== 'string') issues.push({ path: 'slug', message: 'must be a string' });
  if (record.path !== undefined && typeof record.path !== 'string') {
    issues.push({ path: 'path', message: 'must be a string' });
  }
  for (const key of Object.keys(record)) {
    if (key !== 'dataset' && key !== 'slug' && key !== 'path') {
      issues.push({ path: key, message: 'unexpected property' });
    }
  }
  const { dataset, slug } = record;
  if (issues.length > 0 || !isDatasetId(dataset) || typeof slug !== 'string') {
    return apiError(400, 'invalid', 'request body is invalid', issues);
  }
  if (!isValidName(slug)) {
    return apiError(
      400,
      'bad-slug',
      `"${slug}" is not a valid entry name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }

  const found = await ideTargetFor(dataset, slug, record.path as string | undefined);
  if (!found.ok)
    return apiError(found.error === 'not-found' ? 404 : 400, found.error, found.message);
  return launch(found.target);
};

/** Resolve the IDE command and start it on `target`: 200 { ok, command }, 501 ide-not-found, 500 ide-spawn-failed. */
async function launch(target: IdeTarget): Promise<Response> {
  const resolved = resolveIdeCommand();
  if (!resolved.ok) {
    return apiError(
      501,
      'ide-not-found',
      `no IDE command found (tried: ${resolved.tried.join(', ') || 'nothing'}); install the VS Code "code" command or set ${IDE_COMMAND_ENV}`,
    );
  }

  try {
    const invocation = buildIdeInvocation(resolved.command, target);
    await launchIde(invocation, target.root);
    return json({ ok: true, command: invocation.display });
  } catch (error) {
    return apiError(
      500,
      'ide-spawn-failed',
      `could not start ${resolved.command}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export const ALL: APIRoute = () => methodNotAllowed(['GET', 'POST']);
