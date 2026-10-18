// Inflate into a working directory (plans/INFLATE_V2_SPEC.md §10, §14.2) over Playwright's request context:
// POST /api/inflate/plan, POST /api/inflate/run, GET /api/inflate/jobs/:id, POST /api/inflate/jobs/:id/cancel.
// No browser. The web server reaches a local git repository (.tmp/e2e-git) through git's insteadOf env. Runs use no
// step delay; only the busy/cancel test slows its run through the x-ctxman-step-delay-ms header.
// Working directories are OS temp dirs, removed afterwards.
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
    const context = readFileSync(path.join(dir, 'LLM_CONTEXT.md'), 'utf8');
    expect(context).toContain('## Working directory map');
    expect(context).toContain(HAS_GIT ? '## Primary repository' : '## Repositories');
    // placed paths are relative markdown links, never the absolute ctxman data path
    expect(context).toContain(`[\`repos/${REPO_REF}/\`](repos/${REPO_REF}/)`);
    expect(context).toContain('[`kb/okf-format/index.md`](kb/okf-format/index.md)');
    expect(context).toContain('## Placement');
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

    const context = readFileSync(path.join(dir, 'LLM_CONTEXT.md'), 'utf8');
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

    const context = readFileSync(path.join(dir, 'LLM_CONTEXT.md'), 'utf8');
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
