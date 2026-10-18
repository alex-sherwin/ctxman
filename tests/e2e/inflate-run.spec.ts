// Inflate into a working directory from the UI (plans/INFLATE_V2_SPEC.md §11, §14.2): the Run view with its dry
// run, the job progress, re-runs, cancel and the safety rules, plus the compose-side controls that feed it
// (single-select Primary, run-time overrides saved to the recipe) and "Open in IDE" for an inflated directory.
// The web server reaches a local git repository (.tmp/e2e-git) through git's insteadOf env and runs a fake `code`
// that records its argv. Runs use no step delay; the Cancel and live-progress tests slow their own runs through
// `slowInflateSteps`. Every working directory is an OS temp dir; nothing here ever runs into the recipe's default `~/ctxman-inflate/...`.
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
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  API,
  E2E_DATA_DIR,
  modKey,
  pollUntil,
  readRecipeYaml,
  slowInflateSteps,
  uniqueName,
} from './helpers.ts';
import { E2E_GIT_FIXTURE, E2E_GIT_URI, E2E_IDE_RECORD, E2E_LOCAL_FIXTURE } from './paths.ts';

// Serial: the server runs ONE Inflate job at a time (409 busy), and later tests re-run what the first one placed.
test.describe.configure({ mode: 'serial' });
test.skip(!existsSync(path.join(E2E_GIT_FIXTURE, '.git')), 'git is not available');
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const REPO_REF = 'e2e-ui-repo';
const LOCAL_REF = 'e2e-ui-local';

let base = '';
let recipeName = '';
/** The job of the first run (the deep-link test reopens it). */
let firstJobId = '';
const workDir = (): string => path.join(base, 'w');

test.beforeAll(async ({ request }) => {
  base = mkdtempSync(path.join(os.tmpdir(), 'ctxman-e2e-ui-run-'));
  recipeName = uniqueName('e2e-run');
  const repo = await request.post(`${API}/reference`, {
    data: {
      name: REPO_REF,
      description: 'Fixture git repository for the Inflate run view spec.',
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
      description: 'Fixture local folder for the Inflate run view spec.',
      type: 'local-repo',
      path: E2E_LOCAL_FIXTURE,
      owner: 'me',
    },
  });
  expect(local.status()).toBe(201);
  const recipe = await request.post(`${API}/recipe`, {
    data: {
      name: recipeName,
      description: 'Run view spec',
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
      output: { dir: workDir(), primary: `reference/${REPO_REF}` },
    },
  });
  expect(recipe.status(), await recipe.text()).toBe(201);
});

test.afterAll(async ({ request }) => {
  await request.delete(`${API}/recipe/${recipeName}`);
  await request.delete(`${API}/reference/${REPO_REF}`);
  await request.delete(`${API}/reference/${LOCAL_REF}`);
  rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- helpers

/** Opens /inflate for the spec recipe and waits until it is loaded. */
async function openInflate(page: Page, query = ''): Promise<void> {
  await page.goto(`/inflate?recipe=${recipeName}${query}`);
  await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute(
    'href',
    `/recipe/${recipeName}`,
  );
}

/** The Run view with a ready dry run. */
async function openRun(page: Page): Promise<void> {
  await openInflate(page, '&view=run');
  await waitPlanReady(page);
}

const planStatus = (page: Page): Locator => page.getByTestId('inflate-dirplan-status');

async function waitPlanReady(page: Page): Promise<void> {
  await expect(planStatus(page)).toHaveAttribute('data-kind', 'ready');
}

const planStepIds = (page: Page): Promise<string[]> =>
  page
    .getByTestId('inflate-dirplan-step')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.stepId ?? ''));

const jobStep = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="inflate-job-step"][data-step-id="${id}"]`);

/** Waits for the job on screen to reach `status` (the progress polls every 500 ms). */
async function jobEnds(
  page: Page,
  status: 'done' | 'cancelled' | 'failed' = 'done',
): Promise<void> {
  await expect(page.getByTestId('inflate-job')).toHaveAttribute('data-status', status, {
    timeout: 15_000,
  });
}

function jobIdOf(page: Page): string {
  const id = new URL(page.url()).searchParams.get('job');
  if (id === null) throw new Error(`no job in ${page.url()}`);
  return id;
}

interface Manifest {
  format: string;
  recipe: string;
  generatedAt: string;
  jobId: string;
  entries: { path: string; type: string }[];
}
const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(path.join(dir, '.ctxman-inflate.json'), 'utf8')) as Manifest;
const stable = (m: Manifest): unknown => ({ ...m, generatedAt: '', jobId: '' });
const isLink = (p: string): boolean =>
  lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() === true;

/** Every recorded fake-code run, oldest first. */
function recordedCalls(): string[][] {
  if (!existsSync(E2E_IDE_RECORD)) return [];
  return readFileSync(E2E_IDE_RECORD, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string[]);
}

async function saveRecipe(page: Page): Promise<void> {
  const put = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' && new URL(res.url()).pathname.startsWith('/api/recipe/'),
  );
  await page.getByTestId('inflate-save').click();
  expect((await put).status()).toBe(200);
  await expect(page.getByTestId('inflate-status')).toHaveText(/^Saved/);
}

// ---------------------------------------------------------------- dry run and run

test.describe('Run view', () => {
  test('the dry run lists every step of a run and writes nothing', async ({ page }) => {
    await openRun(page);
    expect(await planStepIds(page)).toEqual([
      'dir',
      'okf:kb/okf-format',
      'skill:skill/okf-authoring',
      `link:reference/${LOCAL_REF}`,
      `clone:reference/${REPO_REF}`,
      'context',
      'stub:CLAUDE.md',
      'stub:.gitignore',
      'manifest',
    ]);
    await expect(planStatus(page)).toHaveText('9 steps · 0 warnings');
    await expect(page.getByTestId('inflate-dirplan-blocking')).toHaveCount(0);
    await expect(page.getByTestId('inflate-run-start')).toBeEnabled();
    await expect(page.getByTestId('inflate-run-dir')).toHaveValue(workDir());
    // every step says what it will do
    await expect(
      page.locator('[data-testid="inflate-dirplan-step"][data-step-id="okf:kb/okf-format"]'),
    ).toHaveAttribute('data-expect', 'create');
    expect(existsSync(workDir())).toBe(false);
  });

  test('Run places the material with live progress, then offers the summary', async ({ page }) => {
    await slowInflateSteps(page, 300); // a running step stays on screen for a while
    await openRun(page);
    await page.getByTestId('inflate-run-start').click();

    await expect(page.getByTestId('inflate-job')).toBeVisible();
    await expect(page).toHaveURL(/[?&]view=run(&|$)/);
    await expect(page).toHaveURL(/[?&]job=/); // the job id reaches the URL a moment after the job panel shows
    firstJobId = jobIdOf(page);
    expect(firstJobId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      page.locator('[data-testid="inflate-job-step"][data-status="running"]').first(),
    ).toBeVisible();
    await expect(page.getByTestId('inflate-job-cancel')).toBeVisible();
    await expect(page.getByTestId('inflate-job-status')).toHaveText(
      /^(Queued|Running step \d+ of 9)/,
    );

    await jobEnds(page);
    await expect(page.getByTestId('inflate-job-status')).toHaveText(
      /^Done in .+: \d+ ok, \d+ unchanged$/,
    );
    await expect(page.getByTestId('inflate-job-cancel')).toHaveCount(0);
    for (const id of ['dir', 'okf:kb/okf-format', `clone:reference/${REPO_REF}`, 'manifest']) {
      await expect(jobStep(page, id)).toHaveAttribute('data-status', 'ok');
    }
    await expect(page.getByTestId('inflate-job-step')).toHaveCount(9);
    // the clone shows what git printed
    await expect(
      jobStep(page, `clone:reference/${REPO_REF}`).getByTestId('inflate-job-step-tail'),
    ).toBeVisible();
    await expect(page.getByTestId('inflate-job-summary')).toBeVisible();
    await expect(page.getByTestId('inflate-job-dir')).toHaveText(workDir());

    // on disk
    const dir = workDir();
    expect(existsSync(path.join(dir, 'repos', REPO_REF, '.git'))).toBe(true);
    expect(existsSync(path.join(dir, 'repos', REPO_REF, 'docs', 'guide.md'))).toBe(true);
    expect(isLink(path.join(dir, 'kb', 'okf-format'))).toBe(true);
    expect(realpathSync(path.join(dir, 'kb', 'okf-format'))).toBe(
      realpathSync(path.join(E2E_DATA_DIR, 'kb', 'okf-format')),
    );
    expect(isLink(path.join(dir, 'repos', LOCAL_REF))).toBe(true);
    expect(realpathSync(path.join(dir, 'repos', LOCAL_REF))).toBe(realpathSync(E2E_LOCAL_FIXTURE));
    expect(
      lstatSync(path.join(dir, '.claude', 'skills', 'okf-authoring', 'SKILL.md')).isFile(),
    ).toBe(true);
    const context = readFileSync(path.join(dir, 'LLM_CONTEXT.md'), 'utf8');
    expect(context).toContain('## Working directory map');
    expect(context).toContain('## Primary repository');
    // placed paths are relative markdown links, never the absolute ctxman data path
    expect(context).toContain(`[\`repos/${REPO_REF}/\`](repos/${REPO_REF}/)`);
    expect(context).toContain('## Placement');
    expect(context).not.toContain(path.join(E2E_DATA_DIR, 'kb', 'okf-format'));
    expect(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').endsWith('@LLM_CONTEXT.md\n')).toBe(
      true,
    );
    const manifest = readManifest(dir);
    expect(manifest.recipe).toBe(recipeName);
    expect(manifest.jobId).toBe(firstJobId);
    expect(manifest.entries).toHaveLength(7); // 4 materials + LLM_CONTEXT.md + CLAUDE.md + .gitignore
  });

  test('Open in IDE starts the editor on the directory; Copy path copies it', async ({ page }) => {
    await openInflate(page, `&view=run&job=${firstJobId}`);
    await jobEnds(page);
    await expect(page.getByTestId('inflate-job-open-ide')).toBeVisible();

    const before = recordedCalls().length;
    await page.getByTestId('inflate-job-open-ide').click();
    await expect(page.getByTestId('inflate-job-ide-status')).toHaveText('Opened in the IDE');
    await pollUntil(recordedCalls, (calls) => calls.length === before + 1);
    expect(recordedCalls()[before]).toEqual([workDir()]);

    // Chromium rejects clipboard writes from an unfocused page, which the app swallows: bring it to front.
    await page.bringToFront();
    await page.getByTestId('inflate-job-copy-path').click();
    await expect(page.getByTestId('inflate-job-copy-path')).toHaveAttribute('data-copied', '');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(workDir());
  });

  test('a reload with job= shows the same run; an unknown run says it is gone', async ({
    page,
  }) => {
    await openInflate(page, `&view=run&job=${firstJobId}`);
    await jobEnds(page);
    await expect(page.getByTestId('inflate-job-step')).toHaveCount(9);
    await expect(page.getByTestId('inflate-job-summary')).toBeVisible();

    await page.reload();
    await jobEnds(page);
    await expect(page.getByTestId('inflate-job-step')).toHaveCount(9);

    await page.goto(
      `/inflate?recipe=${recipeName}&view=run&job=11111111-1111-4111-8111-111111111111`,
    );
    await expect(page.getByTestId('inflate-job')).toHaveAttribute('data-status', 'lost');
    await expect(page.getByTestId('inflate-job-status')).toHaveText(
      'This run is no longer known to the server (it restarted).',
    );
    await page.getByTestId('inflate-job-back').click();
    await expect(page.getByTestId('inflate-run-start')).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]job=/);
  });

  test('a second run changes nothing that is already in place', async ({ page }) => {
    const before = readManifest(workDir());
    await openRun(page);
    await expect(page.getByTestId('inflate-run-start')).toHaveText(/^run$/i);
    await page.getByTestId('inflate-run-start').click();
    await jobEnds(page);
    for (const id of [
      'okf:kb/okf-format',
      `link:reference/${LOCAL_REF}`,
      `clone:reference/${REPO_REF}`,
      'context',
      'stub:CLAUDE.md',
      'stub:.gitignore',
    ]) {
      await expect(jobStep(page, id), id).toHaveAttribute('data-status', 'unchanged');
    }
    const after = readManifest(workDir());
    expect(stable(after)).toEqual(stable(before));
    expect(after.jobId).toBe(jobIdOf(page));
    expect(after.jobId).not.toBe(before.jobId);

    // back to the plan: the directory is now ours, and the button says "Run again"
    await page.getByTestId('inflate-job-back').click();
    await waitPlanReady(page);
    await expect(page.getByTestId('inflate-run-start')).toHaveText(/^run again$/i);
    const stepRow = (id: string): Locator =>
      page.locator(`[data-testid="inflate-dirplan-step"][data-step-id="${id}"]`);
    await expect(stepRow('dir')).toHaveAttribute('data-expect', 'keep');
    await expect(stepRow('okf:kb/okf-format')).toHaveAttribute('data-expect', 'replace');
  });

  test('a run override that stops placing an item removes only its link', async ({ page }) => {
    await openRun(page);
    const item = page.locator('[data-testid="inflate-run-item"][data-key="kb/okf-format"]');
    await expect(item).toHaveAttribute('data-overridden', 'false');
    await item.getByTestId('inflate-run-item-material').click();
    await page.getByRole('option', { name: /^Don't place/ }).click();
    await expect(item).toHaveAttribute('data-overridden', 'true');
    await expect(page.getByTestId('inflate-run-overrides')).toContainText('1 run override');
    await waitPlanReady(page);
    expect(await planStepIds(page)).toContain('rm:kb/okf-format');

    await page.getByTestId('inflate-run-start').click();
    await jobEnds(page);
    await expect(jobStep(page, 'rm:kb/okf-format')).toHaveAttribute('data-status', 'ok');
    expect(isLink(path.join(workDir(), 'kb', 'okf-format'))).toBe(false);
    expect(existsSync(path.join(E2E_DATA_DIR, 'kb', 'okf-format', 'index.md'))).toBe(true);
    expect(isLink(path.join(workDir(), 'repos', LOCAL_REF))).toBe(true);
    expect(readManifest(workDir()).entries.map((e) => e.path)).not.toContain('kb/okf-format');
  });

  test('Cancel stops the run; the directory keeps a valid manifest', async ({ page }) => {
    const dir = path.join(base, 'cancelled');
    await slowInflateSteps(page, 600); // longer than the 500 ms UI poll: every step is seen running; Cancel aborts the sleep
    await openRun(page);
    await page.getByTestId('inflate-run-dir').fill(dir);
    await expect(page.getByTestId('inflate-run-overrides')).toContainText('1 run override');
    await waitPlanReady(page);

    await page.getByTestId('inflate-run-start').click();
    // past the first step (it creates the directory), so the manifest step has something to write into
    await expect(
      page
        .locator(
          '[data-testid="inflate-job-step"][data-status="running"]:not([data-step-id="dir"])',
        )
        .first(),
    ).toBeVisible();
    await page.getByTestId('inflate-job-cancel').click();
    await jobEnds(page, 'cancelled');
    await expect(page.getByTestId('inflate-job-status')).toHaveText('Cancelled');
    expect(
      await page.locator('[data-status="cancelled"][data-testid="inflate-job-step"]').count(),
    ).toBeGreaterThan(0);
    expect(readManifest(dir).format).toBe('ctxman-inflate');

    // the slot is free again: back to the plan and run once more to the end, at full speed
    await page.unroute('**/api/inflate/run');
    await page.getByTestId('inflate-job-back').click();
    await waitPlanReady(page);
    await page.getByTestId('inflate-run-start').click();
    await jobEnds(page);
    expect(readManifest(dir).entries.length).toBeGreaterThanOrEqual(6);
  });

  test('a directory that is not empty blocks the run until it is allowed', async ({ page }) => {
    const occupied = path.join(base, 'occupied');
    mkdirSync(occupied, { recursive: true });
    writeFileSync(path.join(occupied, 'precious.txt'), 'keep me');
    await openRun(page);
    await page.getByTestId('inflate-run-dir').fill(occupied);

    await expect(planStatus(page)).toHaveAttribute('data-kind', 'blocked');
    await expect(planStatus(page)).toContainText('is not empty');
    await expect(page.getByTestId('inflate-dirplan-blocking')).toContainText('is not empty');
    await expect(page.getByTestId('inflate-run-start')).toBeDisabled();

    await page.getByTestId('inflate-run-allownonempty').click();
    await expect(planStatus(page)).toHaveAttribute('data-kind', 'ready');
    await expect(page.getByTestId('inflate-dirplan-blocking')).toHaveCount(0);
    await expect(page.getByTestId('inflate-run-start')).toBeEnabled();
    await expect(page.getByTestId('inflate-run-overrides')).toContainText('2 run overrides');
    expect(readFileSync(path.join(occupied, 'precious.txt'), 'utf8')).toBe('keep me');
    expect(existsSync(path.join(occupied, '.ctxman-inflate.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------- compose: primary, run overrides

test.describe('compose and run overrides', () => {
  test('Primary is single-select across the repository rows', async ({ page }) => {
    await openInflate(page);
    const primary = (ref: string): Locator =>
      page
        .locator(`[data-testid="inflate-segment"][data-key="reference/${ref}"]`)
        .getByTestId('inflate-segment-primary');
    await expect(primary(REPO_REF).getByRole('checkbox')).toBeChecked();
    await expect(primary(LOCAL_REF).getByRole('checkbox')).not.toBeChecked();

    await primary(LOCAL_REF).click();
    await expect(primary(LOCAL_REF).getByRole('checkbox')).toBeChecked();
    await expect(primary(REPO_REF).getByRole('checkbox')).not.toBeChecked();
    await primary(REPO_REF).click();
    await expect(primary(REPO_REF).getByRole('checkbox')).toBeChecked();
    await expect(primary(LOCAL_REF).getByRole('checkbox')).not.toBeChecked();

    // a row only offers Primary while its material can be primary
    const repoRow = page.locator(
      `[data-testid="inflate-segment"][data-key="reference/${REPO_REF}"]`,
    );
    await repoRow.getByTestId('inflate-segment-material').click();
    await page.getByRole('option', { name: /^Don't place/ }).click();
    await expect(primary(REPO_REF)).toHaveCount(0);
    await expect(page.getByTestId('inflate-output-primary')).toContainText('none');
    await repoRow.getByTestId('inflate-segment-material').click();
    await page.getByRole('option', { name: /^Clone/ }).click();
    await expect(primary(REPO_REF)).toBeVisible();
    await expect(primary(REPO_REF).getByRole('checkbox')).not.toBeChecked();

    await primary(LOCAL_REF).click();
    await saveRecipe(page);
    const output = readRecipeYaml(recipeName).output as { primary?: string; dir?: string };
    expect(output.primary).toBe(`reference/${LOCAL_REF}`);
    expect(output.dir).toBe(workDir());
  });

  test('a run override is marked, saved to the recipe on request and persisted by Save', async ({
    page,
  }) => {
    const saved = path.join(base, 'saved-dir');
    await openRun(page);
    await expect(page.getByTestId('inflate-run-overrides')).toHaveCount(0);

    await page.getByTestId('inflate-run-dir').fill(saved);
    await expect(page.getByTestId('inflate-run-overrides')).toContainText('1 run override');
    await expect(page.getByTestId('inflate-status')).toHaveText('No changes');
    expect((readRecipeYaml(recipeName).output as { dir: string }).dir).toBe(workDir());

    await page.getByTestId('inflate-run-overrides-save').click();
    await expect(page.getByTestId('inflate-run-overrides')).toHaveCount(0);
    await expect(page.getByTestId('inflate-status')).toHaveText('Unsaved changes');
    await expect(page.getByTestId('inflate-run-dirty')).toBeVisible();
    await expect(page.getByTestId('inflate-run-dir')).toHaveValue(saved);
    // not persisted until the recipe is saved
    expect((readRecipeYaml(recipeName).output as { dir: string }).dir).toBe(workDir());
    await page.keyboard.press(`${modKey}+s`);
    await expect(page.getByTestId('inflate-status')).toHaveText(/^Saved/);
    expect((readRecipeYaml(recipeName).output as { dir: string }).dir).toBe(saved);
  });

  test('Clear drops the overrides without touching the recipe', async ({ page }) => {
    await openRun(page);
    await page.getByTestId('inflate-run-contextfile').fill('CONTEXT.md');
    await expect(page.getByTestId('inflate-run-overrides')).toContainText('1 run override');
    await waitPlanReady(page);
    expect(await planStepIds(page)).toContain('context');
    await expect(
      page.locator('[data-testid="inflate-dirplan-step"][data-step-id="context"]'),
    ).toContainText('CONTEXT.md');
    await page.getByTestId('inflate-run-overrides-clear').click();
    await expect(page.getByTestId('inflate-run-overrides')).toHaveCount(0);
    await expect(page.getByTestId('inflate-run-contextfile')).toHaveValue('LLM_CONTEXT.md');
    await expect(page.getByTestId('inflate-status')).toHaveText('No changes');
  });
});

// ---------------------------------------------------------------- Open in IDE API ({ dir })

test.describe('Open in IDE for an inflated directory (API)', () => {
  const open = (request: APIRequestContext, data: unknown) =>
    request.post(`${API}/ide/open`, { data });

  test('a directory with a ctxman manifest opens as a folder alone', async ({ request }) => {
    const before = recordedCalls().length;
    const response = await open(request, { dir: workDir() });
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as { ok: boolean; command: string[] };
    expect(body.ok).toBe(true);
    expect(body.command.slice(1)).toEqual([workDir()]);
    await pollUntil(recordedCalls, (calls) => calls.length === before + 1);
    expect(recordedCalls()[before]).toEqual([workDir()]);
  });

  test('anything else is refused and never starts the IDE', async ({ request }) => {
    const plain = path.join(base, 'not-inflated');
    mkdirSync(plain, { recursive: true });
    writeFileSync(path.join(plain, 'README.md'), 'x');
    const before = recordedCalls().length;
    const cases: [unknown, number, string][] = [
      [{ dir: plain }, 404, 'not-found'],
      [{ dir: path.join(base, 'missing') }, 404, 'not-found'],
      [{ dir: 'relative/dir' }, 400, 'bad-path'],
      [{ dir: E2E_DATA_DIR }, 400, 'bad-path'],
      [{ dir: os.homedir() }, 400, 'bad-path'],
      [{ dir: 5 }, 400, 'invalid'],
      [{ dir: workDir(), dataset: 'kb', slug: 'ctxman' }, 400, 'invalid'],
    ];
    for (const [data, status, code] of cases) {
      const response = await open(request, data);
      expect(response.status(), JSON.stringify(data)).toBe(status);
      expect(((await response.json()) as { error: string }).error, JSON.stringify(data)).toBe(code);
    }
    expect(recordedCalls().length).toBe(before);
  });
});
