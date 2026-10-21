// Inflate into a working directory (plans/INFLATE_V2_SPEC.md §10, §14.2) over Playwright's request context:
// POST /api/inflate/plan, POST /api/inflate/run, GET /api/inflate/jobs/:id, POST /api/inflate/jobs/:id/cancel.
// No browser. The web server reaches a local git repository (.tmp/e2e-git) through git's insteadOf env. Runs use no
// step delay; only the busy/cancel test slows its run through the x-ctxman-step-delay-ms header.
// Working directories are OS temp dirs, removed afterwards.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures.ts';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { API, E2E_DATA_DIR, pollUntil } from './helpers.ts';
import { E2E_GIT_FIXTURE, E2E_GIT_URI, E2E_LOCAL_FIXTURE, STEP_DELAY_HEADER } from './paths.ts';

// Serial: the server runs ONE Inflate job at a time (409 busy) and the tests share the base dir and three references.
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
const FOLDER_REF = 'e2e-run-folder';
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
  const folder = await request.post(`${API}/reference`, {
    data: {
      name: FOLDER_REF,
      description: 'Fixture plain folder for the Inflate run spec.',
      type: 'local-folder',
      path: E2E_LOCAL_FIXTURE,
      owner: 'not-me',
      info: '## Notes\n\nPlain files, no git.\n',
    },
  });
  expect(folder.status()).toBe(201);
});

test.afterAll(async ({ request }) => {
  await request.delete(`${API}/reference/${REPO_REF}`);
  await request.delete(`${API}/reference/${LOCAL_REF}`);
  await request.delete(`${API}/reference/${FOLDER_REF}`);
  rmSync(base, { recursive: true, force: true });
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
const run = (
  request: APIRequestContext,
  body: unknown,
  headers?: Record<string, string>,
): Promise<APIResponse> => request.post(`${API}/inflate/run`, { data: body, headers });

async function getJob(request: APIRequestContext, id: string): Promise<Job> {
  const response = await request.get(`${API}/inflate/jobs/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Job;
}

/** Polls the job (no event exists for it) until `done(job)`. */
const waitFor = (
  request: APIRequestContext,
  id: string,
  done: (job: Job) => boolean,
): Promise<Job> => pollUntil(() => getJob(request, id), done);

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
    expect(body.contextFile).toBe('AGENTS.md');
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
    // v3 default: a skill is symlinked, not copied
    expect(body.steps.find((s) => s.id === 'skill:skill/okf-authoring')).toMatchObject({
      kind: 'symlink',
      path: '.claude/skills/okf-authoring',
      expect: 'create',
    });
    expect(body.document.markdown).toContain('## Working directory map');
    expect(body.document.markdown).toContain('[`kb/okf-format/index.md`](kb/okf-format/index.md)');
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
    const dir = workDir();
    const response = await run(request, { recipe: recipe(dir) });
    expect(response.status(), await response.text()).toBe(202);
    const started = (await response.json()) as { jobId: string; job: Job };
    expect(response.headers().location).toBe(`/api/inflate/jobs/${started.jobId}`);
    expect(['queued', 'running']).toContain(started.job.status);
    expect(started.job.dir).toBe(path.resolve(dir));
    expect(started.job.contextFile).toBe(path.join(path.resolve(dir), 'AGENTS.md'));

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
    // the skill default is a symlink to the ctxman skill folder (v3), so SKILL.md is reached through the link
    expect(isLink(path.join(dir, '.claude', 'skills', 'okf-authoring'))).toBe(true);
    expect(realpathSync(path.join(dir, '.claude', 'skills', 'okf-authoring'))).toBe(
      realpathSync(path.join(E2E_DATA_DIR, 'skill', 'okf-authoring')),
    );
    expect(
      lstatSync(path.join(dir, '.claude', 'skills', 'okf-authoring', 'SKILL.md')).isFile(),
    ).toBe(true);
    expect(isLink(path.join(dir, 'repos', LOCAL_REF))).toBe(true);
    expect(realpathSync(path.join(dir, 'repos', LOCAL_REF))).toBe(realpathSync(E2E_LOCAL_FIXTURE));
    if (HAS_GIT) {
      expect(existsSync(path.join(dir, 'repos', REPO_REF, '.git'))).toBe(true);
      expect(existsSync(path.join(dir, 'repos', REPO_REF, 'docs', 'guide.md'))).toBe(true);
    }
    const context = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(context).toContain('## Working directory map');
    expect(context).toContain(HAS_GIT ? '## Primary repository' : '## Repositories');
    // placed paths are relative markdown links, never the absolute ctxman data path
    expect(context).toContain(`[\`repos/${REPO_REF}/\`](repos/${REPO_REF}/)`);
    expect(context).toContain('[`kb/okf-format/index.md`](kb/okf-format/index.md)');
    expect(context).toContain('## Placement');
    expect(context).not.toContain(path.join(E2E_DATA_DIR, 'kb', 'okf-format'));
    expect(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').endsWith('@AGENTS.md\n')).toBe(true);
    expect(readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('/.ctxman-inflate.json');

    const manifest = readManifest(dir);
    expect(manifest).toMatchObject({ format: 'ctxman-inflate', recipe: 'e2e-run', jobId: job.id });
    expect(manifest.entries.map((e) => e.path)).toEqual(
      [
        '.claude/skills/okf-authoring',
        '.gitignore',
        'CLAUDE.md',
        'AGENTS.md',
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
    // a symlinked skill is idempotent like an okf link (v3 default); a skill COPY is replaced (own test below)
    expect(status['skill:skill/okf-authoring']).toBe('unchanged');
    const after = readManifest(dir);
    expect(stable(after)).toEqual(stable(before));
    expect(after.jobId).toBe(job.id);
    expect(after.jobId).not.toBe(before.jobId);
  });

  test('removing an item removes only its symlink; the data entry and everything else stay', async ({
    request,
  }) => {
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
    const dir = path.join(base, 'cancel');
    // a 250 ms delay per step (this run only) keeps it in progress; cancel aborts the sleeping step
    const started = await run(request, { recipe: recipe(dir) }, { [STEP_DELAY_HEADER]: '250' });
    expect(started.status(), await started.text()).toBe(202);
    const { jobId } = (await started.json()) as { jobId: string };
    await waitFor(request, jobId, (j) =>
      j.steps.some((s) => s.status === 'running' && s.id !== 'dir'),
    );

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

    // a step past `dir` is running (waited for above): cancel
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

test.describe('placement and editable (v3)', () => {
  test('Editable: the primary defaults to editable; edit run overrides flip repositories in the document', async ({
    request,
  }) => {
    test.skip(!HAS_GIT, 'git is not available (the primary repository needs its clone)');
    const dir = freshDir('editable');
    const byDefault = (await (await plan(request, { recipe: recipe(dir) })).json()) as PlanBody;
    const text = byDefault.document.markdown;
    expect(text).toContain(`**${REPO_REF}** · [\`repos/${REPO_REF}/\`](repos/${REPO_REF}/)`);
    expect(text).toMatch(new RegExp(`reference/${REPO_REF}\`? · owner: me · editable\\n`));
    expect(text).toContain(
      `Work in [\`repos/${REPO_REF}/\`](repos/${REPO_REF}/) unless the task says`,
    );
    expect(text).toMatch(new RegExp(`\\*\\*${LOCAL_REF}\\*\\* · .* · owner: me · read-only — `));
    expect(text).toContain('- **editable** repositories may be changed for this task');
    expect(byDefault.applied).toEqual([]);

    const flipped = (await (
      await plan(request, {
        recipe: recipe(dir),
        overrides: {
          items: {
            [`reference/${REPO_REF}`]: { edit: false },
            [`reference/${LOCAL_REF}`]: { edit: true },
          },
        },
      })
    ).json()) as PlanBody;
    expect(flipped.blocking).toEqual([]);
    expect([...flipped.applied].sort()).toEqual([
      `reference/${LOCAL_REF}`,
      `reference/${REPO_REF}`,
    ]);
    const after = flipped.document.markdown;
    expect(after).toContain('Read it to answer the task; it is read-only.');
    expect(after).not.toContain('unless the task says otherwise');
    expect(after).toMatch(new RegExp(`\\*\\*${LOCAL_REF}\\*\\* · .* · owner: me · editable — `));
    // the map names it too
    expect(after).toMatch(new RegExp(`${LOCAL_REF}/ +symlink · editable · `));
    // the map row only says what is special: `primary`, and `editable` when it is
    expect(after).toMatch(new RegExp(`${REPO_REF}/ +git clone · primary · Fixture`));
  });

  test('edit on a key that is not a repository is 400 invalid, and nothing runs', async ({
    request,
  }) => {
    const dir = freshDir('bad-edit');
    for (const call of [plan, run]) {
      const bad = await call(request, {
        recipe: recipe(dir),
        overrides: { items: { 'kb/okf-format': { edit: true } } },
      });
      expect(bad.status()).toBe(400);
      const body = await errorOf(bad);
      expect(body.error).toBe('invalid');
      expect(
        body.issues?.some((i) => i.path.startsWith('overrides.items') && i.path.endsWith('edit')),
      ).toBe(true);
      expect(body.issues?.some((i) => i.message.includes('repositories only'))).toBe(true);
    }
    expect(existsSync(dir)).toBe(false);
  });

  test('Copy places a skill and a local repository as snapshots; a second run replaces them', async ({
    request,
  }) => {
    const dir = path.join(base, 'copies');
    const body = {
      recipe: recipe(dir),
      overrides: {
        primary: null,
        items: {
          'skill/okf-authoring': { material: 'copy' },
          [`reference/${LOCAL_REF}`]: { material: 'copy' },
          [`reference/${REPO_REF}`]: { material: 'none' },
        },
      },
    };
    const planned = (await (await plan(request, body)).json()) as PlanBody;
    expect(planned.blocking).toEqual([]);
    expect(planned.steps.find((s) => s.id === 'skill:skill/okf-authoring')?.kind).toBe('copyDir');
    expect(planned.steps.find((s) => s.id === `link:reference/${LOCAL_REF}`)).toMatchObject({
      kind: 'copyDir',
      path: `repos/${LOCAL_REF}`,
    });
    expect(planned.steps.find((s) => s.id === 'okf:kb/okf-format')?.kind).toBe('symlink');

    const first = await runToEnd(request, body);
    expect(first.status, JSON.stringify(first.steps.filter((s) => s.status !== 'ok'))).toBe('done');
    const skillDir = path.join(dir, '.claude', 'skills', 'okf-authoring');
    const repoDir = path.join(dir, 'repos', LOCAL_REF);
    for (const copied of [skillDir, repoDir]) {
      expect(isLink(copied), copied).toBe(false);
      expect(lstatSync(copied).isDirectory(), copied).toBe(true);
    }
    expect(lstatSync(path.join(skillDir, 'SKILL.md')).isFile()).toBe(true);
    expect(readFileSync(path.join(repoDir, 'README.md'), 'utf8')).toBe('# local folder\n');
    expect(isLink(path.join(dir, 'kb', 'okf-format'))).toBe(true);
    expect(existsSync(path.join(repoDir, '.git'))).toBe(false);

    const context = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(context).toContain(
      '- **copy**: a snapshot taken when this directory was inflated; edits stay here and are replaced by the next inflate.',
    );
    expect(context).toContain('copy of the ctxman skill');
    expect(context).toContain(`copy of \`${E2E_LOCAL_FIXTURE}\``);
    expect(readManifest(dir).entries.map((e) => e.path)).toEqual(
      expect.arrayContaining(['.claude/skills/okf-authoring', `repos/${LOCAL_REF}`]),
    );

    // a snapshot is replaced by the next run (a link would be unchanged)
    const second = await runToEnd(request, body);
    expect(second.status).toBe('done');
    for (const id of ['skill:skill/okf-authoring', `link:reference/${LOCAL_REF}`]) {
      expect(
        second.steps.find((s) => s.id === id),
        id,
      ).toMatchObject({
        status: 'ok',
        action: 'replaced',
      });
    }
    expect(stepStatus(second)['okf:kb/okf-format']).toBe('unchanged');
  });

  test('a local folder is symlinked into folders/<name>, listed under Folders and its info inlined', async ({
    request,
  }) => {
    const dir = path.join(base, 'folders');
    const body = {
      recipe: {
        ...recipe(dir),
        items: [{ dataset: 'reference', slug: FOLDER_REF }],
        overrides: [],
        output: { dir },
      },
    };
    const job = await runToEnd(request, body);
    expect(job.status, JSON.stringify(job.steps.filter((s) => s.status !== 'ok'))).toBe('done');
    expect(stepStatus(job)[`link:reference/${FOLDER_REF}`]).toBe('ok');
    const linked = path.join(dir, 'folders', FOLDER_REF);
    expect(isLink(linked)).toBe(true);
    expect(realpathSync(linked)).toBe(realpathSync(E2E_LOCAL_FIXTURE));
    expect(readManifest(dir).entries).toContainEqual({
      path: `folders/${FOLDER_REF}`,
      type: 'symlink',
      key: `reference/${FOLDER_REF}`,
      target: E2E_LOCAL_FIXTURE,
    });
    expect(readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('\n/folders/\n');

    const context = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(context).toContain(
      `- **${FOLDER_REF}** · [\`folders/${FOLDER_REF}/\`](folders/${FOLDER_REF}/) · symlink to \`${E2E_LOCAL_FIXTURE}\` · owner: not me · read-only`,
    );
    expect(context).toContain('Details: see Folders.');
    expect(context).not.toContain('## Repositories');
    // the reference info, nested under the item (### in the grouped layout)
    expect(context).toContain('#### Notes\n\nPlain files, no git.\n\nDetails: see Folders.');
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
    expect(readFileSync(path.join(occupied, 'AGENTS.md'), 'utf8')).toContain('kb/okf-format');
  });
});

/** `git -C <cwd> <args>` (argv, no shell): the trimmed stdout. Commits carry a throwaway identity. */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    'git',
    ['-C', cwd, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
const worktreePaths = (repo: string): string[] =>
  git(repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));

test.describe('worktrees and work branches (a git repository made by the test)', () => {
  test.skip(!HAS_GIT, 'git is not available');
  // Serial by the file (one job at a time): the tests share the source repository, `work` and what it holds.
  const WT_REF = 'e2e-run-wt';
  const FOLDER = 'e2e-wt-dir';
  const BRANCH = 'e2e/work';
  let source = '';
  let work = '';
  const dest = (): string => path.join(work, 'repos', FOLDER);

  /** One local repository item placed with `material` (and its options), `codex` so that AGENTS.md is the only file. */
  function wtRecipe(
    dir: string,
    material: string,
    opts: Record<string, unknown> | null,
  ): Record<string, unknown> {
    return {
      name: 'e2e-run-wt',
      description: 'Worktree run spec',
      target: 'codex',
      layout: 'grouped',
      contexts: [],
      items: [{ dataset: 'reference', slug: WT_REF }],
      overrides: [
        {
          key: `reference/${WT_REF}`,
          material,
          ...(opts === null ? {} : { materialOptions: opts }),
        },
      ],
      output: { dir, ...(material === 'none' ? {} : { primary: `reference/${WT_REF}` }) },
    };
  }

  test.beforeAll(async ({ request }) => {
    source = path.join(base, 'wt-source');
    work = path.join(base, 'wt-work');
    mkdirSync(source, { recursive: true });
    git(source, 'init', '-q', '-b', 'trunk');
    writeFileSync(path.join(source, 'README.md'), '# worktree source\n');
    git(source, 'add', '-A');
    git(source, 'commit', '-qm', 'one');
    const created = await request.post(`${API}/reference`, {
      data: {
        name: WT_REF,
        description: 'A git repository made by the worktree spec.',
        type: 'local-repo',
        path: source,
        folder: FOLDER,
        owner: 'me',
      },
    });
    expect(created.status(), await created.text()).toBe(201);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/reference/${WT_REF}`);
    // drop the registrations of deleted folders, then remove the work trees that are left (the source is the first)
    git(source, 'worktree', 'prune');
    for (const wt of worktreePaths(source).slice(1)) {
      git(source, 'worktree', 'remove', '--force', '--', wt);
    }
  });

  test('the dry run plans a gitWorktree step at repos/<folder> and writes nothing', async ({
    request,
  }) => {
    const body = (await (
      await plan(request, { recipe: wtRecipe(work, 'worktree', { newBranch: BRANCH }) })
    ).json()) as PlanBody;
    expect(body.blocking).toEqual([]);
    expect(body.steps.map((s) => s.id)).toEqual([
      'dir',
      `worktree:reference/${WT_REF}`,
      'context',
      'stub:.gitignore',
      'manifest',
    ]);
    expect(body.steps.find((s) => s.id === `worktree:reference/${WT_REF}`)).toMatchObject({
      kind: 'gitWorktree',
      path: `repos/${FOLDER}`,
      expect: 'create',
    });
    const text = body.document.markdown;
    expect(text).toContain(`repos/${FOLDER}/`);
    expect(text).toContain(`work on branch \`${BRANCH}\``);
    expect(text).toContain('**Where to work**');
    expect(existsSync(work)).toBe(false);
    expect(git(source, 'branch', '--list', BRANCH)).toBe('');
  });

  test('a run adds the worktree on the new branch; the branch and its commits live in the source repository', async ({
    request,
  }) => {
    const job = await runToEnd(request, {
      recipe: wtRecipe(work, 'worktree', { newBranch: BRANCH }),
    });
    expect(job.status, JSON.stringify(job.steps.filter((s) => s.status !== 'ok'))).toBe('done');
    expect(job.steps.find((s) => s.id === `worktree:reference/${WT_REF}`)).toMatchObject({
      status: 'ok',
      action: 'created',
      message: `new branch ${BRANCH} from HEAD`,
    });

    // on disk: a linked work tree (its `.git` is a file) checked out on the new branch
    expect(git(dest(), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
    expect(lstatSync(path.join(dest(), '.git')).isFile()).toBe(true);
    expect(readFileSync(path.join(dest(), 'README.md'), 'utf8')).toBe('# worktree source\n');
    expect(worktreePaths(source)).toContain(realpathSync(dest()));
    // the branch is in the source repository, started at its HEAD
    expect(git(source, 'rev-parse', `refs/heads/${BRANCH}`)).toBe(
      git(source, 'rev-parse', 'trunk'),
    );

    expect(readManifest(work).entries).toContainEqual({
      path: `repos/${FOLDER}`,
      type: 'worktree',
      key: `reference/${WT_REF}`,
      repo: realpathSync(source),
      branch: null,
      newBranch: BRANCH,
    });
    // the context file is AGENTS.md (the default); the primary repository's work branch reads out
    expect(existsSync(path.join(work, 'LLM_CONTEXT.md'))).toBe(false);
    const context = readFileSync(path.join(work, 'AGENTS.md'), 'utf8');
    expect(context).toContain('## Working directory map');
    expect(context).toContain(`[\`repos/${FOLDER}/\`](repos/${FOLDER}/)`);
    expect(context).toContain('**Where to work**');
    expect(context).toContain(`work on branch \`${BRANCH}\``);
    expect(context).toContain('git worktree');
    expect(readFileSync(path.join(work, '.gitignore'), 'utf8')).toContain('/repos/');

    // a commit made in the worktree lands in the source repository's branch
    writeFileSync(path.join(dest(), 'notes.md'), 'agent notes\n');
    git(dest(), 'add', '-A');
    git(dest(), 'commit', '-qm', 'agent work');
    expect(git(source, 'log', '-1', '--format=%s', BRANCH)).toBe('agent work');
  });

  test('a second run leaves the worktree as it is; another New branch is kept, not switched to', async ({
    request,
  }) => {
    const same = await runToEnd(request, {
      recipe: wtRecipe(work, 'worktree', { newBranch: BRANCH }),
    });
    expect(same.status).toBe('done');
    expect(same.steps.find((s) => s.id === `worktree:reference/${WT_REF}`)?.status).toBe(
      'unchanged',
    );
    expect(git(dest(), 'log', '-1', '--format=%s')).toBe('agent work');

    const other = await runToEnd(request, {
      recipe: wtRecipe(work, 'worktree', { newBranch: 'e2e/other' }),
    });
    expect(other.status).toBe('done');
    expect(other.steps.find((s) => s.id === `worktree:reference/${WT_REF}`)).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message: `on branch ${BRANCH}, recipe wants e2e/other; left as is`,
    });
    expect(git(dest(), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
    expect(git(source, 'branch', '--list', 'e2e/other')).toBe('');
  });

  test('a clean worktree is removed when the item stops being placed; its branch stays', async ({
    request,
  }) => {
    const job = await runToEnd(request, { recipe: wtRecipe(work, 'none', null) });
    expect(job.status, JSON.stringify(job.steps.filter((s) => s.status !== 'ok'))).toBe('done');
    expect(job.steps.find((s) => s.id === `rm:repos/${FOLDER}`)).toMatchObject({
      status: 'ok',
      action: 'removed',
    });
    expect(existsSync(dest())).toBe(false);
    // `git worktree remove` + prune: nothing stale in the source repository, and the commits are still on the branch
    expect(worktreePaths(source)).toEqual([realpathSync(source)]);
    expect(git(source, 'worktree', 'list', '--porcelain')).not.toContain('prunable');
    expect(git(source, 'log', '-1', '--format=%s', BRANCH)).toBe('agent work');
    expect(readManifest(work).entries.map((e) => e.path)).not.toContain(`repos/${FOLDER}`);
  });

  test('an existing branch of that name is checked out, and a worktree with local changes is kept', async ({
    request,
  }) => {
    // the branch exists from the first run: it is checked out instead of created
    const again = await runToEnd(request, {
      recipe: wtRecipe(work, 'worktree', { newBranch: BRANCH }),
    });
    expect(again.status).toBe('done');
    expect(again.steps.find((s) => s.id === `worktree:reference/${WT_REF}`)).toMatchObject({
      status: 'ok',
      action: 'created',
      message: `the branch ${BRANCH} already exists in the repository: checked it out`,
    });
    expect(git(dest(), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
    expect(readFileSync(path.join(dest(), 'notes.md'), 'utf8')).toBe('agent notes\n');

    // an untracked file makes git refuse; ctxman keeps the folder and says why
    writeFileSync(path.join(dest(), 'scratch.txt'), 'not committed');
    const job = await runToEnd(request, { recipe: wtRecipe(work, 'none', null) });
    expect(job.status).toBe('done');
    expect(job.steps.find((s) => s.id === `rm:repos/${FOLDER}`)).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message: `kept repos/${FOLDER}: it has local changes; left in place`,
    });
    expect(existsSync(path.join(dest(), 'scratch.txt'))).toBe(true);
    expect(worktreePaths(source)).toContain(realpathSync(dest()));
    expect(readManifest(work).entries.map((e) => e.path)).toContain(`repos/${FOLDER}`);
  });

  test('Branch alone checks it out; no branch at all gives a detached HEAD', async ({
    request,
  }) => {
    git(source, 'branch', 'e2e/plain');
    const branchDir = path.join(base, 'wt-branch');
    const onBranch = await runToEnd(request, {
      recipe: wtRecipe(branchDir, 'worktree', { branch: 'e2e/plain' }),
    });
    expect(onBranch.status, JSON.stringify(onBranch.steps.filter((s) => s.status !== 'ok'))).toBe(
      'done',
    );
    expect(git(path.join(branchDir, 'repos', FOLDER), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      'e2e/plain',
    );

    const detachedDir = path.join(base, 'wt-detached');
    const detached = await runToEnd(request, { recipe: wtRecipe(detachedDir, 'worktree', null) });
    expect(detached.status).toBe('done');
    expect(git(path.join(detachedDir, 'repos', FOLDER), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      'HEAD',
    );
    // a branch another work tree has checked out is refused with the hint (the source is on trunk)
    const busyDir = path.join(base, 'wt-busy');
    const busy = await runToEnd(request, {
      recipe: wtRecipe(busyDir, 'worktree', { branch: 'trunk' }),
    });
    expect(busy.status).toBe('failed');
    expect(busy.steps.find((s) => s.id === `worktree:reference/${WT_REF}`)?.message).toContain(
      'set New branch to work on a branch of your own',
    );
    expect(existsSync(path.join(busyDir, 'repos', FOLDER))).toBe(false);
  });
});

test.describe('a clone on a work branch', () => {
  test.skip(!HAS_GIT, 'git is not available');

  test('New branch switches the clone to it; a second run only fetches and leaves the branch alone', async ({
    request,
  }) => {
    const dir = path.join(base, 'clone-work');
    const body = {
      recipe: {
        name: 'e2e-run-clone-work',
        description: 'Clone work branch spec',
        target: 'generic',
        layout: 'grouped',
        contexts: [],
        items: [{ dataset: 'reference', slug: REPO_REF }],
        overrides: [
          {
            key: `reference/${REPO_REF}`,
            material: 'clone',
            materialOptions: { newBranch: 'e2e/clone-work' },
          },
        ],
        output: { dir, primary: `reference/${REPO_REF}` },
      },
    };
    const first = await runToEnd(request, body);
    expect(first.status, JSON.stringify(first.steps.filter((s) => s.status !== 'ok'))).toBe('done');
    const clone = path.join(dir, 'repos', REPO_REF);
    expect(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('e2e/clone-work');
    // full history is the default: no shallow marker
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('false');
    expect(readManifest(dir).entries).toContainEqual(
      expect.objectContaining({
        path: `repos/${REPO_REF}`,
        type: 'clone',
        depth: 0,
        newBranch: 'e2e/clone-work',
      }),
    );
    expect(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toContain(
      'work on branch `e2e/clone-work`',
    );

    writeFileSync(path.join(clone, 'mine.txt'), 'work in progress');
    const second = await runToEnd(request, body);
    expect(second.status).toBe('done');
    expect(second.steps.find((s) => s.id === `clone:reference/${REPO_REF}`)).toMatchObject({
      status: 'unchanged',
      message: 'on work branch e2e/clone-work; fetched origin',
    });
    expect(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('e2e/clone-work');
    expect(readFileSync(path.join(clone, 'mine.txt'), 'utf8')).toBe('work in progress');
  });

  // KNOWN GAP (found by the real-git validation of the work-branch change): removal asks `git status --branch` for
  // "[ahead N]", which git prints only for a branch WITH an upstream. A work branch made by `git switch -c` has none,
  // so a commit on it is invisible and the clone is deleted (src/lib/inflate/material-exec.ts, removeRecorded, case
  // 'clone'). Turn this into a plain `test` once removal also checks `git rev-list --branches --not --remotes`.
  test.fixme('a clone with a commit on its work branch is kept when its item stops being placed', async ({
    request,
  }) => {
    const dir = path.join(base, 'clone-work-commit');
    const place = (material: string, opts?: Record<string, unknown>): Record<string, unknown> => ({
      name: 'e2e-run-clone-work',
      description: 'Clone work branch removal spec',
      target: 'generic',
      layout: 'grouped',
      contexts: [],
      items: [{ dataset: 'reference', slug: REPO_REF }],
      overrides: [
        {
          key: `reference/${REPO_REF}`,
          material,
          ...(opts === undefined ? {} : { materialOptions: opts }),
        },
      ],
      output: { dir },
    });
    const first = await runToEnd(request, {
      recipe: place('clone', { newBranch: 'e2e/clone-commit' }),
    });
    expect(first.status).toBe('done');
    const clone = path.join(dir, 'repos', REPO_REF);
    writeFileSync(path.join(clone, 'mine.txt'), 'work');
    git(clone, 'add', 'mine.txt');
    git(clone, 'commit', '-qm', 'my work');

    const removal = await runToEnd(request, { recipe: place('none') });
    expect(removal.status).toBe('done');
    expect(removal.steps.find((s) => s.id === `rm:repos/${REPO_REF}`)).toMatchObject({
      status: 'skipped',
      action: 'kept',
    });
    expect(git(clone, 'log', '-1', '--format=%s')).toBe('my work');
  });
});

test.describe('AGENTS.md as the context file', () => {
  const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
  /** The stub text an older ctxman wrote for `role` (it pointed at LLM_CONTEXT.md). */
  const oldStub = (role: 'claude-md' | 'agents-md'): string =>
    role === 'claude-md'
      ? [
          '# e2e-old',
          '',
          'Generated by ctxman from the recipe `e2e-old`. LLM_CONTEXT.md maps the repositories, skills and knowledge in this directory; read it first.',
          '',
          '@LLM_CONTEXT.md',
          '',
        ].join('\n')
      : [
          '# e2e-old',
          '',
          'Generated by ctxman from the recipe `e2e-old`. Read `LLM_CONTEXT.md` first: it maps the repositories, skills and knowledge in this directory.',
          '',
          'Paths in it are relative to this directory.',
          '',
        ].join('\n');

  /** A directory as ctxman wrote it before AGENTS.md became the default: LLM_CONTEXT.md, one stub, one linked folder. */
  function oldLayout(dir: string, target: 'claude-code' | 'codex'): string {
    const role = target === 'claude-code' ? 'claude-md' : 'agents-md';
    const stubFile = target === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md';
    const context = '# old context\n';
    const stub = oldStub(role);
    mkdirSync(path.join(dir, 'folders'), { recursive: true });
    symlinkSync(E2E_LOCAL_FIXTURE, path.join(dir, 'folders', FOLDER_REF), 'dir');
    writeFileSync(path.join(dir, 'LLM_CONTEXT.md'), context);
    writeFileSync(path.join(dir, stubFile), stub);
    const entries = [
      { path: 'LLM_CONTEXT.md', type: 'file', role: 'context', sha256: sha(context) },
      { path: stubFile, type: 'file', role, sha256: sha(stub) },
      {
        path: `folders/${FOLDER_REF}`,
        type: 'symlink',
        key: `reference/${FOLDER_REF}`,
        target: E2E_LOCAL_FIXTURE,
      },
    ].sort((a, b) => (a.path < b.path ? -1 : 1));
    writeFileSync(
      path.join(dir, '.ctxman-inflate.json'),
      JSON.stringify({
        format: 'ctxman-inflate',
        version: 1,
        recipe: 'e2e-old',
        target,
        contextFile: 'LLM_CONTEXT.md',
        generatedAt: '2026-01-01T00:00:00.000Z',
        jobId: 'old-job',
        entries,
      }),
    );
    return stubFile;
  }
  const folderRecipe = (dir: string, target: 'claude-code' | 'codex'): Record<string, unknown> => ({
    name: 'e2e-old',
    description: 'Old layout spec',
    target,
    layout: 'grouped',
    contexts: [],
    items: [{ dataset: 'reference', slug: FOLDER_REF }],
    overrides: [{ key: `reference/${FOLDER_REF}`, material: 'symlink' }],
    output: { dir },
  });

  test('a claude-code directory made with LLM_CONTEXT.md: the unedited file goes, CLAUDE.md imports @AGENTS.md', async ({
    request,
  }) => {
    const dir = path.join(base, 'old-claude');
    oldLayout(dir, 'claude-code');
    const planned = (await (
      await plan(request, { recipe: folderRecipe(dir, 'claude-code') })
    ).json()) as PlanBody;
    expect(planned.blocking).toEqual([]);
    expect(planned.warnings.map((w) => w.code)).not.toContain('context-file-exists');
    expect(planned.steps.find((s) => s.id === 'rm:LLM_CONTEXT.md')).toMatchObject({
      kind: 'remove',
      expect: 'remove',
    });

    const job = await runToEnd(request, { recipe: folderRecipe(dir, 'claude-code') });
    expect(job.status, JSON.stringify(job.steps.filter((s) => s.status !== 'ok'))).toBe('done');
    expect(existsSync(path.join(dir, 'LLM_CONTEXT.md'))).toBe(false);
    expect(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toContain('## Working directory map');
    const claude = readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude.endsWith('@AGENTS.md\n')).toBe(true);
    expect(claude).not.toContain('LLM_CONTEXT.md');
    const manifest = readManifest(dir) as Manifest & { contextFile: string };
    expect(manifest.contextFile).toBe('AGENTS.md');
    expect(manifest.entries.map((e) => e.path)).not.toContain('LLM_CONTEXT.md');

    // and it settles: the next run changes nothing
    const next = await runToEnd(request, { recipe: folderRecipe(dir, 'claude-code') });
    expect(next.status).toBe('done');
    expect(next.steps.find((s) => s.id === 'context')?.status).toBe('unchanged');
    expect(next.steps.find((s) => s.id === 'stub:CLAUDE.md')?.status).toBe('unchanged');
  });

  test('a codex directory whose AGENTS.md was an unedited stub: the context file replaces it', async ({
    request,
  }) => {
    const dir = path.join(base, 'old-codex');
    oldLayout(dir, 'codex');
    const job = await runToEnd(request, { recipe: folderRecipe(dir, 'codex') });
    expect(job.status, JSON.stringify(job.steps.filter((s) => s.status !== 'ok'))).toBe('done');
    expect(existsSync(path.join(dir, 'LLM_CONTEXT.md'))).toBe(false);
    expect(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toContain('## Working directory map');
    expect(job.steps.find((s) => s.id === 'context')).toMatchObject({
      status: 'ok',
      action: 'written',
      message: 'replaced the AGENTS.md stub',
    });
    const entry = readManifest(dir).entries.find((e) => e.path === 'AGENTS.md');
    expect(entry).toMatchObject({ type: 'file', role: 'context' });
  });

  test('an edited stub, or an AGENTS.md ctxman never wrote: the dry run warns, the context step fails with the hint, the file stays', async ({
    request,
  }) => {
    const hint = 'move it away or choose another context file name';
    // 1. a stub the user edited
    const edited = path.join(base, 'old-codex-edited');
    oldLayout(edited, 'codex');
    writeFileSync(path.join(edited, 'AGENTS.md'), `${oldStub('agents-md')}\nmy own notes\n`);
    const planned = (await (
      await plan(request, { recipe: folderRecipe(edited, 'codex') })
    ).json()) as PlanBody;
    const warning = planned.warnings.find((w) => w.code === 'context-file-exists');
    expect(warning?.message).toContain('is a stub ctxman wrote earlier and it was edited since');
    expect(warning?.message).toContain(hint);
    const job = await runToEnd(request, { recipe: folderRecipe(edited, 'codex') });
    expect(job.status).toBe('failed');
    expect(job.steps.find((s) => s.id === 'context')).toMatchObject({ status: 'failed' });
    expect(job.steps.find((s) => s.id === 'context')?.message).toContain(hint);
    expect(readFileSync(path.join(edited, 'AGENTS.md'), 'utf8')).toContain('my own notes');

    // 2. an AGENTS.md that is the user's own (no manifest says otherwise)
    const foreign = path.join(base, 'foreign-agents');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(path.join(foreign, 'AGENTS.md'), 'my own project rules\n');
    const overrides = { allowNonEmpty: true };
    const foreignPlan = (await (
      await plan(request, { recipe: folderRecipe(foreign, 'claude-code'), overrides })
    ).json()) as PlanBody;
    expect(foreignPlan.warnings.find((w) => w.code === 'context-file-exists')?.message).toContain(
      'was not written by ctxman',
    );
    const foreignJob = await runToEnd(request, {
      recipe: folderRecipe(foreign, 'claude-code'),
      overrides,
    });
    expect(foreignJob.status).toBe('failed');
    expect(foreignJob.steps.find((s) => s.id === 'context')?.message).toBe(
      `AGENTS.md exists and was not written by ctxman; ${hint}`,
    );
    expect(readFileSync(path.join(foreign, 'AGENTS.md'), 'utf8')).toBe('my own project rules\n');
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
