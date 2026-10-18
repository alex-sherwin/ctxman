// Inflate into a working directory (plans/INFLATE_V2_SPEC.md §10, §14.2) over Playwright's request context:
// POST /api/inflate/plan, POST /api/inflate/run, GET /api/inflate/jobs/:id, POST /api/inflate/jobs/:id/cancel.
// No browser. The web server reaches a local git repository (.tmp/e2e-git) through git's insteadOf env and sleeps
// CTXMAN_INFLATE_STEP_DELAY_MS before every step. Working directories are OS temp dirs, removed afterwards.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { API, E2E_DATA_DIR, settleDevReload } from './helpers.ts';
import { E2E_GIT_FIXTURE, E2E_GIT_URI, E2E_LOCAL_FIXTURE } from './paths.ts';

test.describe.configure({ mode: 'serial' });

interface ErrorBody {
  error: string;
  message: string;
  jobId?: string;
  issues?: { path: string; message: string }[];
}
interface JobStep {
  id: string;
  kind: string;
  status: string;
  action: string | null;
  message: string | null;
  tail: string[];
}
interface Job {
  id: string;
  recipe: string;
  dir: string;
  contextFile: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  cancelRequested: boolean;
  steps: JobStep[];
  warnings: { code: string; message: string }[];
  error: string | null;
  summary: Record<string, number> | null;
}
interface PlanBody {
  dir: string | null;
  dirInput: string | null;
  contextFile: string;
  dirState: {
    exists: boolean;
    empty: boolean;
    hasManifest: boolean;
    manifestRecipe: string | null;
  } | null;
  blocking: { code: string; message: string }[];
  steps: { id: string; kind: string; path: string; expect: string }[];
  warnings: { code: string; message: string }[];
  document: { markdown: string; manifest: { warnings: unknown[] } };
  applied: string[];
}
interface Manifest {
  format: string;
  recipe: string;
  generatedAt: string;
  jobId: string;
  entries: { path: string; type: string }[];
}

const HAS_GIT = existsSync(path.join(E2E_GIT_FIXTURE, '.git'));
const REPO_REF = 'e2e-run-repo';
const LOCAL_REF = 'e2e-run-local';
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

let base = '';
const temps: string[] = [];
const freshDir = (name = 'w'): string => path.join(base, `${name}-${temps.length}`);

test.beforeAll(async ({ request }) => {
  base = mkdtempSync(path.join(os.tmpdir(), 'ctxman-e2e-run-'));
  const repo = await request.post(`${API}/reference`, {
    data: {
      name: REPO_REF,
      description: 'Fixture git repository for the Inflate run spec.',
      type: 'remote-repo',
      uri: E2E_GIT_URI,
      subpath: 'docs',
      owner: 'me',
    },
  });
  expect(repo.status()).toBe(201);
  const local = await request.post(`${API}/reference`, {
    data: {
      name: LOCAL_REF,
      description: 'Fixture local folder for the Inflate run spec.',
      type: 'local-repo',
      path: E2E_LOCAL_FIXTURE,
      owner: 'me',
    },
  });
  expect(local.status()).toBe(201);
});

test.afterAll(async ({ request }) => {
  await request.delete(`${API}/reference/${REPO_REF}`);
  await request.delete(`${API}/reference/${LOCAL_REF}`);
  rmSync(base, { recursive: true, force: true });
  await settleDevReload();
});

/** The recipe the run specs inflate: one bundle, one skill, a cloned repo (primary) and a linked folder. */
function recipe(dir: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'e2e-run',
    description: 'Inflate run spec',
    target: 'claude-code',
    layout: 'grouped',
    contexts: [],
    items: [
      { dataset: 'kb', slug: 'okf-format' },
      { dataset: 'skill', slug: 'okf-authoring' },
      { dataset: 'reference', slug: REPO_REF },
      { dataset: 'reference', slug: LOCAL_REF },
    ],
    overrides: [
      { key: `reference/${REPO_REF}`, material: 'clone' },
      { key: `reference/${LOCAL_REF}`, material: 'symlink' },
    ],
    ...(dir === null ? {} : { output: { dir, primary: `reference/${REPO_REF}` } }),
    ...extra,
  };
}

const errorOf = async (response: APIResponse): Promise<ErrorBody> =>
  (await response.json()) as ErrorBody;

const plan = (request: APIRequestContext, body: unknown): Promise<APIResponse> =>
  request.post(`${API}/inflate/plan`, { data: body });
const run = (request: APIRequestContext, body: unknown): Promise<APIResponse> =>
  request.post(`${API}/inflate/run`, { data: body });

async function getJob(request: APIRequestContext, id: string): Promise<Job> {
  const response = await request.get(`${API}/inflate/jobs/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Job;
}

/** Polls the job until `done(job)`; fails the test after `timeoutMs`. */
async function waitFor(
  request: APIRequestContext,
  id: string,
  done: (job: Job) => boolean,
  timeoutMs = 45_000,
): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await getJob(request, id);
    if (done(job)) return job;
    if (Date.now() > deadline)
      throw new Error(
        `job ${id} did not settle: ${JSON.stringify(job.steps.map((s) => [s.id, s.status]))}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

/** Starts a run and waits for it to finish. */
async function runToEnd(request: APIRequestContext, body: unknown): Promise<Job> {
  const response = await run(request, body);
  expect(response.status(), await response.text()).toBe(202);
  const started = (await response.json()) as { jobId: string };
  return waitFor(request, started.jobId, (job) => TERMINAL.has(job.status));
}

const stepStatus = (job: Job): Record<string, string> =>
  Object.fromEntries(job.steps.map((s) => [s.id, s.status]));
const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(path.join(dir, '.ctxman-inflate.json'), 'utf8')) as Manifest;
const isLink = (p: string): boolean =>
  lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() === true;
const stable = (m: Manifest): unknown => ({ ...m, generatedAt: '', jobId: '' });

test.describe('plan (dry run)', () => {
  test('200 with the step list, blocking, dirState and the relative document; nothing is written', async ({
    request,
  }) => {
    const dir = freshDir();
    const response = await plan(request, { recipe: recipe(dir) });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const body = (await response.json()) as PlanBody;
    expect(body.dir).toBe(path.resolve(dir));
    expect(body.contextFile).toBe('LLM_CONTEXT.md');
    expect(body.blocking).toEqual([]);
    expect(body.dirState).toEqual({
      exists: false,
      empty: true,
      hasManifest: false,
      manifestRecipe: null,
    });
    expect(body.applied).toEqual([]);
    expect(body.steps.map((s) => s.id)).toEqual(
      HAS_GIT
        ? [
            'dir',
            'okf:kb/okf-format',
            'skill:skill/okf-authoring',
            `link:reference/${LOCAL_REF}`,
            `clone:reference/${REPO_REF}`,
            'context',
            'stub:CLAUDE.md',
            'stub:.gitignore',
            'manifest',
          ]
        : [
            'dir',
            'okf:kb/okf-format',
            'skill:skill/okf-authoring',
            `link:reference/${LOCAL_REF}`,
            'context',
            'stub:CLAUDE.md',
            'stub:.gitignore',
            'manifest',
          ],
    );
    expect(body.steps.find((s) => s.id === 'okf:kb/okf-format')).toMatchObject({
      kind: 'symlink',
      path: 'kb/okf-format',
      expect: 'create',
    });
    expect(body.document.markdown).toContain('## Working directory map');
    expect(body.document.markdown).toContain('`kb/okf-format`');
    expect(existsSync(dir)).toBe(false);
  });

  test('run overrides are applied and listed; the document-mode answer has no directory', async ({
    request,
  }) => {
    const dir = freshDir();
    const overridden = (await (
      await plan(request, {
        recipe: recipe(null),
        overrides: {
          dir,
          contextFile: 'CONTEXT.md',
          primary: null,
          items: { 'kb/okf-format': { material: 'copy' } },
        },
      })
    ).json()) as PlanBody;
    expect(overridden.applied).toEqual(['dir', 'contextFile', 'primary', 'kb/okf-format']);
    expect(overridden.contextFile).toBe('CONTEXT.md');
    expect(overridden.steps.find((s) => s.id === 'okf:kb/okf-format')?.kind).toBe('copyDir');
    expect(overridden.steps.find((s) => s.id === 'context')?.path).toBe('CONTEXT.md');

    const documentMode = (await (await plan(request, { recipe: recipe(null) })).json()) as PlanBody;
    expect(documentMode).toMatchObject({
      dir: null,
      dirInput: null,
      dirState: null,
      blocking: [],
      steps: [],
      applied: [],
    });
    expect(documentMode.document.markdown).not.toContain('## Working directory map');
  });

  test('a directory the rules refuse is reported as blocking (200), with the absolute document', async ({
    request,
  }) => {
    for (const dir of [
      'relative/dir',
      path.join(E2E_DATA_DIR, 'out'),
      path.resolve('.tmp', 'e2e-run-inside-repo'),
      path.join(base, 'node_modules', 'w'),
    ]) {
      const body = (await (await plan(request, { recipe: recipe(dir) })).json()) as PlanBody;
      expect(
        body.blocking.map((b) => b.code),
        dir,
      ).toEqual(['bad-dir']);
      expect(body.steps).toEqual([]);
      expect(body.dir).toBeNull();
      expect(body.dirInput).toBe(dir);
      expect(body.document.markdown).not.toContain('## Working directory map');
    }
  });

  test('a non-empty directory without a manifest is blocking until allowNonEmpty', async ({
    request,
  }) => {
    const dir = freshDir('occupied');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'notes.txt'), 'mine');
    const blocked = (await (await plan(request, { recipe: recipe(dir) })).json()) as PlanBody;
    expect(blocked.blocking.map((b) => b.code)).toEqual(['dir-not-empty']);
    expect(blocked.blocking[0]?.message).toContain('is not empty');
    expect(blocked.steps.length).toBeGreaterThan(4);
    expect(blocked.dirState).toMatchObject({ exists: true, empty: false, hasManifest: false });
    const allowed = (await (
      await plan(request, { recipe: recipe(dir), overrides: { allowNonEmpty: true } })
    ).json()) as PlanBody;
    expect(allowed.blocking).toEqual([]);
    expect(allowed.applied).toEqual(['allowNonEmpty']);
  });
});

test.describe('run', () => {
  const workDir = (): string => path.join(base, 'work');

  test('places every material, writes the relative context, stubs and manifest', async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const dir = workDir();
    const response = await run(request, { recipe: recipe(dir) });
    expect(response.status(), await response.text()).toBe(202);
    const started = (await response.json()) as { jobId: string; job: Job };
    expect(response.headers().location).toBe(`/api/inflate/jobs/${started.jobId}`);
    expect(['queued', 'running']).toContain(started.job.status);
    expect(started.job.dir).toBe(path.resolve(dir));
    expect(started.job.contextFile).toBe(path.join(path.resolve(dir), 'LLM_CONTEXT.md'));

    const job = await waitFor(request, started.jobId, (j) => TERMINAL.has(j.status));
    expect(job.status, JSON.stringify(job.steps.filter((s) => s.status !== 'ok'))).toBe('done');
    expect(job.error).toBeNull();
    expect(job.steps.every((s) => s.status === 'ok')).toBe(true);
    expect(job.summary).toMatchObject({ failed: 0, cancelled: 0, skipped: 0 });
    expect(job.steps.find((s) => s.id === 'okf:kb/okf-format')).toMatchObject({
      action: 'created',
      kind: 'symlink',
    });

    // on disk
    expect(isLink(path.join(dir, 'kb', 'okf-format'))).toBe(true);
    expect(realpathSync(path.join(dir, 'kb', 'okf-format'))).toBe(
      realpathSync(path.join(E2E_DATA_DIR, 'kb', 'okf-format')),
    );
    expect(
      lstatSync(path.join(dir, '.claude', 'skills', 'okf-authoring', 'SKILL.md')).isFile(),
    ).toBe(true);
    expect(isLink(path.join(dir, '.claude', 'skills', 'okf-authoring'))).toBe(false);
    expect(isLink(path.join(dir, 'repos', LOCAL_REF))).toBe(true);
    expect(realpathSync(path.join(dir, 'repos', LOCAL_REF))).toBe(realpathSync(E2E_LOCAL_FIXTURE));
    if (HAS_GIT) {
      expect(existsSync(path.join(dir, 'repos', REPO_REF, '.git'))).toBe(true);
      expect(existsSync(path.join(dir, 'repos', REPO_REF, 'docs', 'guide.md'))).toBe(true);
    }
    const context = readFileSync(path.join(dir, 'LLM_CONTEXT.md'), 'utf8');
    expect(context).toContain('## Working directory map');
    expect(context).toContain(HAS_GIT ? '## Primary repository' : '## Repositories');
    expect(context).toContain(`\`repos/${REPO_REF}\``);
    expect(context).not.toContain(path.join(E2E_DATA_DIR, 'kb', 'okf-format'));
    expect(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').endsWith('@LLM_CONTEXT.md\n')).toBe(
      true,
    );
    expect(readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('/.ctxman-inflate.json');

    const manifest = readManifest(dir);
    expect(manifest).toMatchObject({ format: 'ctxman-inflate', recipe: 'e2e-run', jobId: job.id });
    expect(manifest.entries.map((e) => e.path)).toEqual(
      [
        '.claude/skills/okf-authoring',
        '.gitignore',
        'CLAUDE.md',
        'LLM_CONTEXT.md',
        'kb/okf-format',
        ...(HAS_GIT ? [`repos/${REPO_REF}`] : []),
        `repos/${LOCAL_REF}`,
      ].sort(),
    );
    expect(existsSync(path.join(dir, '.ctxman-tmp'))).toBe(false);
  });

  test('the finished job stays readable; cancelling it is 409 not-running', async ({ request }) => {
    const dir = path.join(base, 'readable');
    const job = await runToEnd(request, { recipe: recipe(dir) });
    expect(job.status).toBe('done');
    expect((await getJob(request, job.id)).status).toBe('done');
    const cancel = await request.post(`${API}/inflate/jobs/${job.id}/cancel`, { data: {} });
    expect(cancel.status()).toBe(409);
    expect((await errorOf(cancel)).error).toBe('not-running');
  });

  test('a second identical run is idempotent: links kept, clone pulled, context and stubs unchanged', async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const dir = workDir();
    const before = readManifest(dir);
    const job = await runToEnd(request, { recipe: recipe(dir) });
    expect(job.status).toBe('done');
    const status = stepStatus(job);
    expect(status['okf:kb/okf-format']).toBe('unchanged');
    expect(status[`link:reference/${LOCAL_REF}`]).toBe('unchanged');
    if (HAS_GIT) expect(status[`clone:reference/${REPO_REF}`]).toBe('unchanged');
    expect(status['context']).toBe('unchanged');
    expect(status['stub:CLAUDE.md']).toBe('unchanged');
    expect(status['stub:.gitignore']).toBe('unchanged');
    expect(job.steps.find((s) => s.id === 'skill:skill/okf-authoring')).toMatchObject({
      status: 'ok',
      action: 'replaced',
    });
    const after = readManifest(dir);
    expect(stable(after)).toEqual(stable(before));
    expect(after.jobId).toBe(job.id);
    expect(after.jobId).not.toBe(before.jobId);
  });

  test('removing an item removes only its symlink; the data entry and everything else stay', async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const dir = workDir();
    const body = {
      recipe: recipe(dir),
      overrides: { items: { 'kb/okf-format': { material: 'none' } } },
    };
    const planned = (await (await plan(request, body)).json()) as PlanBody;
    expect(planned.blocking).toEqual([]);
    expect(planned.steps.map((s) => s.id)).toContain('rm:kb/okf-format');
    expect(planned.steps.find((s) => s.id === 'rm:kb/okf-format')).toMatchObject({
      kind: 'remove',
      expect: 'remove',
    });

    const job = await runToEnd(request, body);
    expect(job.status).toBe('done');
    expect(job.steps.find((s) => s.id === 'rm:kb/okf-format')).toMatchObject({
      status: 'ok',
      action: 'removed',
    });
    expect(job.summary?.removed).toBe(1);
    expect(isLink(path.join(dir, 'kb', 'okf-format'))).toBe(false);
    expect(existsSync(path.join(E2E_DATA_DIR, 'kb', 'okf-format', 'index.md'))).toBe(true);
    expect(isLink(path.join(dir, 'repos', LOCAL_REF))).toBe(true);
    expect(existsSync(path.join(dir, '.claude', 'skills', 'okf-authoring', 'SKILL.md'))).toBe(true);
    if (HAS_GIT) expect(existsSync(path.join(dir, 'repos', REPO_REF, '.git'))).toBe(true);
    expect(readManifest(dir).entries.map((e) => e.path)).not.toContain('kb/okf-format');
  });

  test('a clone with local changes is kept when its item is removed (and the step says why)', async ({
    request,
  }) => {
    test.skip(!HAS_GIT, 'git is not available');
    test.setTimeout(90_000);
    const dir = workDir();
    writeFileSync(path.join(dir, 'repos', REPO_REF, 'my-notes.txt'), 'local work');
    const job = await runToEnd(request, {
      recipe: recipe(dir),
      overrides: { primary: null, items: { [`reference/${REPO_REF}`]: { material: 'none' } } },
    });
    expect(job.status).toBe('done');
    expect(job.steps.find((s) => s.id === `rm:repos/${REPO_REF}`)).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message: `kept repos/${REPO_REF}: it has local changes or unpushed commits`,
    });
    expect(existsSync(path.join(dir, 'repos', REPO_REF, 'my-notes.txt'))).toBe(true);
    expect(readManifest(dir).entries.map((e) => e.path)).toContain(`repos/${REPO_REF}`);
  });
});

test.describe('busy and cancel', () => {
  test('a second run while one is in progress is 409 busy; cancelling ends the job cancelled with a valid manifest', async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const dir = path.join(base, 'cancel');
    const started = await run(request, { recipe: recipe(dir) });
    expect(started.status(), await started.text()).toBe(202);
    const { jobId } = (await started.json()) as { jobId: string };

    const busy = await run(request, { recipe: recipe(path.join(base, 'cancel-other')) });
    expect(busy.status()).toBe(409);
    const busyBody = await errorOf(busy);
    expect(busyBody).toMatchObject({
      error: 'busy',
      message: 'another inflate run is in progress',
      jobId,
    });
    // the same directory is busy too (not dir-not-empty from the half-written run)
    expect((await errorOf(await run(request, { recipe: recipe(dir) }))).error).toBe('busy');

    // wait until the run is past its first steps, then cancel
    await waitFor(request, jobId, (j) => j.steps.filter((s) => s.status === 'ok').length >= 2);
    const cancel = await request.post(`${API}/inflate/jobs/${jobId}/cancel`, { data: {} });
    expect(cancel.status()).toBe(200);
    const cancelled = ((await cancel.json()) as { job: Job }).job;
    expect(cancelled.cancelRequested).toBe(true);
    expect(['running', 'cancelled']).toContain(cancelled.status);

    const job = await waitFor(request, jobId, (j) => TERMINAL.has(j.status));
    expect(job.status).toBe('cancelled');
    expect(job.cancelRequested).toBe(true);
    const statuses = stepStatus(job);
    expect(Object.values(statuses)).toContain('cancelled');
    expect(statuses['dir']).toBe('ok');
    expect(statuses['manifest']).toBe('ok');
    const manifest = readManifest(dir);
    expect(manifest.format).toBe('ctxman-inflate');
    expect(manifest.entries.length).toBeLessThan(7);

    // the slot is free again
    const next = await runToEnd(request, { recipe: recipe(dir) });
    expect(next.status).toBe('done');
    expect(readManifest(dir).entries.length).toBeGreaterThanOrEqual(HAS_GIT ? 7 : 6);
  });
});

test.describe('safety', () => {
  test('run refuses what plan blocks: bad-dir 400, dir-not-directory 400, dir-not-empty 409', async ({
    request,
  }) => {
    for (const dir of [
      'relative/dir',
      path.join(E2E_DATA_DIR, 'out'),
      path.resolve('.tmp', 'e2e-run-inside-repo'),
      path.join(base, 'node_modules', 'w'),
      os.homedir(),
    ]) {
      const response = await run(request, { recipe: recipe(dir) });
      expect(response.status(), dir).toBe(400);
      expect((await errorOf(response)).error).toBe('bad-dir');
    }
    const file = path.join(base, 'a-file');
    writeFileSync(file, 'x');
    const notDir = await run(request, { recipe: recipe(file) });
    expect(notDir.status()).toBe(400);
    expect((await errorOf(notDir)).error).toBe('dir-not-directory');

    const occupied = path.join(base, 'occupied-run');
    mkdirSync(occupied, { recursive: true });
    writeFileSync(path.join(occupied, 'precious.txt'), 'keep me');
    const refused = await run(request, { recipe: recipe(occupied) });
    expect(refused.status()).toBe(409);
    const refusedBody = await errorOf(refused);
    expect(refusedBody.error).toBe('dir-not-empty');
    expect(refusedBody.message).toContain('is not empty');
    expect(readFileSync(path.join(occupied, 'precious.txt'), 'utf8')).toBe('keep me');
    expect(existsSync(path.join(occupied, '.ctxman-inflate.json'))).toBe(false);
  });

  test('allowNonEmpty uses the occupied directory and never touches the foreign files', async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const occupied = path.join(base, 'occupied-allowed');
    mkdirSync(path.join(occupied, 'kb'), { recursive: true });
    writeFileSync(path.join(occupied, 'precious.txt'), 'keep me');
    writeFileSync(path.join(occupied, 'CLAUDE.md'), 'my own instructions\n');
    const job = await runToEnd(request, {
      recipe: recipe(occupied),
      overrides: { allowNonEmpty: true },
    });
    expect(job.status).toBe('done');
    expect(readFileSync(path.join(occupied, 'precious.txt'), 'utf8')).toBe('keep me');
    // an existing CLAUDE.md that ctxman did not write is kept, with the step saying so
    expect(readFileSync(path.join(occupied, 'CLAUDE.md'), 'utf8')).toBe('my own instructions\n');
    expect(job.steps.find((s) => s.id === 'stub:CLAUDE.md')).toMatchObject({
      status: 'skipped',
      action: 'kept',
    });
    expect(readManifest(occupied).entries.map((e) => e.path)).not.toContain('CLAUDE.md');
  });

  test('a path that already exists and is not ours fails that step only', async ({ request }) => {
    test.setTimeout(90_000);
    const occupied = path.join(base, 'occupied-conflict');
    mkdirSync(path.join(occupied, 'kb', 'okf-format'), { recursive: true });
    writeFileSync(path.join(occupied, 'kb', 'okf-format', 'mine.md'), 'mine');
    const job = await runToEnd(request, {
      recipe: recipe(occupied),
      overrides: { allowNonEmpty: true },
    });
    expect(job.status).toBe('failed');
    const statuses = stepStatus(job);
    expect(statuses['okf:kb/okf-format']).toBe('failed');
    expect(job.steps.find((s) => s.id === 'okf:kb/okf-format')?.message).toBe(
      'kb/okf-format exists and was not created by ctxman',
    );
    expect(statuses['skill:skill/okf-authoring']).toBe('ok');
    expect(statuses['context']).toBe('ok');
    expect(readFileSync(path.join(occupied, 'kb', 'okf-format', 'mine.md'), 'utf8')).toBe('mine');
    // the context file describes the real outcome
    expect(readFileSync(path.join(occupied, 'LLM_CONTEXT.md'), 'utf8')).toContain('kb/okf-format');
  });
});

test.describe('request contracts', () => {
  test('run without a directory is 400 no-dir', async ({ request }) => {
    const response = await run(request, { recipe: recipe(null) });
    expect(response.status()).toBe(400);
    expect((await errorOf(response)).error).toBe('no-dir');
  });

  test('plan and run validate the body: 400 invalid with prefixed issue paths', async ({
    request,
  }) => {
    for (const call of [plan, run]) {
      const bad = await call(request, {
        recipe: recipe(null, { target: 'nope' }),
        overrides: { items: { 'kb/okf-format': { material: 'weird' } } },
      });
      expect(bad.status()).toBe(400);
      const body = await errorOf(bad);
      expect(body.error).toBe('invalid');
      const paths = (body.issues ?? []).map((i) => i.path);
      expect(paths).toContain('recipe.target');
      expect(paths.some((p) => p.startsWith('overrides.items'))).toBe(true);

      const extra = await call(request, { recipe: recipe(null), unexpected: true });
      expect(extra.status()).toBe(400);
      expect((await errorOf(extra)).error).toBe('invalid');
    }
  });

  test('guards: text/plain 415, malformed JSON 400, foreign Origin 403, wrong methods 405', async ({
    request,
  }) => {
    for (const route of ['plan', 'run']) {
      const plain = await request.post(`${API}/inflate/${route}`, {
        headers: { 'content-type': 'text/plain' },
        data: '{}',
      });
      expect(plain.status(), route).toBe(415);
      const broken = await request.post(`${API}/inflate/${route}`, {
        headers: { 'content-type': 'application/json' },
        data: Buffer.from('{nope'),
      });
      expect(broken.status(), route).toBe(400);
      expect((await errorOf(broken)).error).toBe('bad-json');
      const foreign = await request.post(`${API}/inflate/${route}`, {
        headers: { origin: 'https://evil.example' },
        data: { recipe: recipe(null) },
      });
      expect(foreign.status(), route).toBe(403);
      expect((await errorOf(foreign)).error).toBe('forbidden-origin');
      const get = await request.get(`${API}/inflate/${route}`);
      expect(get.status(), route).toBe(405);
      expect(get.headers().allow).toBe('POST');
    }
  });

  test('jobs: bad id 400, unknown id 404, cancel validates and 404s, wrong methods 405', async ({
    request,
  }) => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    const badId = await request.get(`${API}/inflate/jobs/not-an-id`);
    expect(badId.status()).toBe(400);
    expect((await errorOf(badId)).error).toBe('bad-id');
    const missing = await request.get(`${API}/inflate/jobs/${unknown}`);
    expect(missing.status()).toBe(404);
    expect(await errorOf(missing)).toMatchObject({
      error: 'not-found',
      message: 'this run is no longer known to the server',
    });

    expect(
      (await request.post(`${API}/inflate/jobs/not-an-id/cancel`, { data: {} })).status(),
    ).toBe(400);
    expect(
      (await request.post(`${API}/inflate/jobs/${unknown}/cancel`, { data: {} })).status(),
    ).toBe(404);
    expect((await request.post(`${API}/inflate/jobs/${unknown}/cancel`)).status()).toBe(404);
    const foreign = await request.post(`${API}/inflate/jobs/${unknown}/cancel`, {
      headers: { origin: 'https://evil.example' },
      data: {},
    });
    expect(foreign.status()).toBe(403);
    const withBody = await request.post(`${API}/inflate/jobs/${unknown}/cancel`, {
      data: { force: true },
    });
    expect(withBody.status()).toBe(400);

    const post = await request.post(`${API}/inflate/jobs/${unknown}`, { data: {} });
    expect(post.status()).toBe(405);
    expect(post.headers().allow).toBe('GET');
    expect((await request.get(`${API}/inflate/jobs/${unknown}/cancel`)).status()).toBe(405);
  });
});
