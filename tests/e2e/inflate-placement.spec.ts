// Inflate v3 (plans/INFLATE_V3_PLAN.md): "placement first". Every item of a recipe with a working directory answers
// two questions, Place (the material) and "In <context file>" (the mode), and repositories carry an Editable flag.
// Covered here from the UI: the new defaults (symlinked skill, cloned remote repository, git skill cloned, archive
// skill downloaded) and the "Don't place" choice, the placement summary strip, the Editable checkbox (saved as the
// recipe override `edit`, visible in the dry-run document) and the Run view Editable checkbox (a run override).
// Every test works on its own recipe (created through the API, removed afterwards); the seed is only read. The
// working directories are OS temp dirs that are planned (dry run) or, in the one run test, really written.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures.ts';
import type { APIRequestContext, Locator, Page, Response } from '@playwright/test';
import { API, deleteRecipeQuietly, readRecipeYaml, uniqueName } from './helpers.ts';
import type { RecipeBody } from './helpers.ts';
import { E2E_GIT_URI, E2E_LOCAL_FIXTURE } from './paths.ts';

const LOCAL_REF = 'e2e-place-local';
const REPO_REF = 'e2e-place-repo';
const LOCAL_KEY = `reference/${LOCAL_REF}`;
const REPO_KEY = `reference/${REPO_REF}`;

interface OverrideRow {
  key: string;
  material?: string;
  edit?: boolean;
}

/** `/api/inflate/plan` answer, the part the specs read. */
interface PlanAnswer {
  applied: string[];
  document: { markdown: string };
}

let base = '';
/** Recipes created by the test in progress; removed after it, whatever happened. */
const created = new Set<string>();

test.beforeAll(async ({ request }) => {
  base = mkdtempSync(path.join(os.tmpdir(), 'ctxman-e2e-place-'));
  // A rerun in the same worker (retry) finds them again: start from a clean slate.
  await request.delete(`${API}/reference/${LOCAL_REF}`);
  await request.delete(`${API}/reference/${REPO_REF}`);
  const repo = await request.post(`${API}/reference`, {
    data: {
      name: REPO_REF,
      description: 'Fixture git repository for the Inflate placement spec.',
      type: 'remote-repo',
      uri: E2E_GIT_URI,
      subpath: 'docs',
      owner: 'me',
    },
  });
  expect(repo.status(), await repo.text()).toBe(201);
  const local = await request.post(`${API}/reference`, {
    data: {
      name: LOCAL_REF,
      description: 'Fixture local folder for the Inflate placement spec.',
      type: 'local-repo',
      path: E2E_LOCAL_FIXTURE,
      owner: 'me',
    },
  });
  expect(local.status(), await local.text()).toBe(201);
});

test.afterAll(async ({ request }) => {
  await request.delete(`${API}/reference/${REPO_REF}`);
  await request.delete(`${API}/reference/${LOCAL_REF}`);
  rmSync(base, { recursive: true, force: true });
});

test.afterEach(async ({ request }) => {
  for (const name of created) await deleteRecipeQuietly(request, name);
  created.clear();
});

// ---------------------------------------------------------------- helpers

interface MadeRecipe {
  name: string;
  dir: string;
}

/** Creates a claude-code recipe with `items` (`dataset/slug`) and a working directory under the temp base. */
async function makeRecipe(
  request: APIRequestContext,
  items: string[],
  options: { primary?: string; overrides?: OverrideRow[] } = {},
): Promise<MadeRecipe> {
  const name = uniqueName('e2e-plc');
  const dir = path.join(base, name);
  const response = await request.post(`${API}/recipe`, {
    data: {
      name,
      description: 'Inflate placement spec',
      target: 'claude-code',
      layout: 'grouped',
      contexts: [],
      items: items.map((key) => {
        const [dataset, slug] = key.split('/');
        return { dataset, slug };
      }),
      ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
      output: { dir, ...(options.primary === undefined ? {} : { primary: options.primary }) },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  created.add(name);
  return { name, dir };
}

async function openInflate(page: Page, name: string, query = ''): Promise<void> {
  await page.goto(`/inflate?recipe=${name}${query}`);
  await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute('href', `/recipe/${name}`);
}

function segmentRow(page: Page, key: string): Locator {
  return page.locator(`[data-testid="inflate-segment"][data-key="${key}"]`);
}

const summary = (page: Page): Locator => page.getByTestId('inflate-placement-summary');

/** The Editable checkbox input of a composition row. */
const editBox = (page: Page, key: string): Locator =>
  segmentRow(page, key).getByTestId('inflate-segment-edit').getByRole('checkbox');

function overrideIn(recipe: RecipeBody, key: string): OverrideRow | undefined {
  return ((recipe.overrides ?? []) as OverrideRow[]).find((o) => o.key === key);
}

/**
 * The next POST /api/inflate/plan (the dry run behind the relative preview) whose request body satisfies `check`.
 * The dry run refreshes about 400 ms after each edit: register this BEFORE the edit and await it after.
 */
function planWith(
  page: Page,
  check: (body: {
    recipe: RecipeBody;
    overrides?: { items?: Record<string, OverrideRow> };
  }) => boolean,
): Promise<Response> {
  return page.waitForResponse((res) => {
    if (res.request().method() !== 'POST') return false;
    if (new URL(res.url()).pathname !== '/api/inflate/plan') return false;
    return check(res.request().postDataJSON() as Parameters<typeof check>[0]);
  });
}

const markdownOf = async (response: Response): Promise<string> =>
  ((await response.json()) as PlanAnswer).document.markdown;

async function saveRecipe(page: Page): Promise<void> {
  const put = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' && new URL(res.url()).pathname.startsWith('/api/recipe/'),
  );
  await page.getByTestId('inflate-save').click();
  expect((await put).status()).toBe(200);
  await expect(page.getByTestId('inflate-status')).toHaveText(/^Saved/);
}

// ---------------------------------------------------------------- defaults and the summary strip

test.describe('placement defaults', () => {
  const ITEMS = [
    'kb/okf-format',
    'skill/okf-authoring',
    REPO_KEY,
    LOCAL_KEY,
    'reference/anthropic-skills', // remote skill, git URI
    'reference/ksa-modding', // remote skill, https archive
  ];

  test('with a directory: skill and bundle symlinked, remote repository and git skill cloned, archive skill downloaded', async ({
    page,
    request,
  }) => {
    const { name, dir } = await makeRecipe(request, ITEMS);
    await openInflate(page, name);
    await expect(segmentRow(page, 'kb/okf-format')).toBeVisible();

    const place = (key: string) => segmentRow(page, key).getByTestId('inflate-segment-material');
    const mode = (key: string) => segmentRow(page, key).getByTestId('inflate-segment-mode');

    // Place column: the v3 built-in defaults
    await expect(place('skill/okf-authoring')).toContainText('Symlink');
    await expect(place('kb/okf-format')).toContainText('Symlink');
    await expect(place(LOCAL_KEY)).toContainText('Symlink');
    await expect(place(REPO_KEY)).toContainText('Clone');
    await expect(place('reference/anthropic-skills')).toContainText('Clone');
    await expect(place('reference/ksa-modding')).toContainText('Download');
    await expect(place('reference/ksa-modding')).not.toContainText('Clone');
    await expect(
      segmentRow(page, 'skill/okf-authoring').getByTestId('inflate-segment-dest'),
    ).toHaveText('.claude/skills/okf-authoring');
    await expect(segmentRow(page, REPO_KEY).getByTestId('inflate-segment-dest')).toHaveText(
      `repos/${REPO_REF}`,
    );

    // "In AGENTS.md" column (the default context file): a placed item is referenced with links, not inlined
    await expect(mode('kb/okf-format')).toContainText('Summary + links');
    await expect(mode('skill/okf-authoring')).toContainText('Link');
    await expect(mode(REPO_KEY)).toHaveText('Describe'); // one choice: static text, not a Select
    await expect(mode(LOCAL_KEY)).toContainText('Describe');
    await expect(segmentRow(page, 'kb/okf-format').getByText('In AGENTS.md')).toBeVisible();

    // owners come from the reference entries
    await expect(segmentRow(page, REPO_KEY).getByTestId('inflate-segment-owner')).toHaveAttribute(
      'data-owner',
      'me',
    );
    await expect(
      segmentRow(page, 'reference/anthropic-skills').getByTestId('inflate-segment-owner'),
    ).toHaveAttribute('data-owner', 'not-me');

    // 3 symlinks (bundle, skill, local folder), 2 clones (repository, git skill), 1 download (archive skill)
    await expect(summary(page)).toHaveText(`${dir} · 3 symlink · 2 clone · 1 download`);

    // the built-in defaults are listed per kind IN THE RECIPE only
    await page.getByTestId('inflate-defaults-toggle').click();
    await expect(page.getByTestId('inflate-defaults')).toBeVisible();
    await expect(page.getByTestId('inflate-default-material-skill')).toContainText(
      'Default (Symlink)',
    );
    await expect(page.getByTestId('inflate-default-material-local-repo')).toContainText(
      'Default (Symlink)',
    );
    await expect(page.getByTestId('inflate-default-material-remote-repo')).toContainText(
      'Default (Clone)',
    );
    await expect(page.getByTestId('inflate-default-material-remote-skill')).toContainText(
      'Default (Clone or download)',
    );
    await expect(page.getByTestId('inflate-default-kb')).toContainText('Default (Summary + links)');
    await expect(page.getByTestId('inflate-default-skill')).toContainText('Default (Link)');
    for (const absent of ['task', 'bug', 'feature', 'project', 'rca', 'idea']) {
      await expect(page.getByTestId(`inflate-default-${absent}`)).toHaveCount(0);
    }
  });

  test('the dry run places the skill with a symlink and clones the remote repository', async ({
    page,
    request,
  }) => {
    const { name } = await makeRecipe(request, ITEMS);
    await openInflate(page, name, '&view=run');
    await expect(page.getByTestId('inflate-dirplan-status')).toHaveAttribute('data-kind', 'ready');
    const kindOf = async (id: string) =>
      page
        .locator(`[data-testid="inflate-dirplan-step"][data-step-id="${id}"]`)
        .getAttribute('data-kind');
    expect(await kindOf('skill:skill/okf-authoring')).toBe('symlink');
    expect(await kindOf('okf:kb/okf-format')).toBe('symlink');
    expect(await kindOf(`link:${LOCAL_KEY}`)).toBe('symlink');
    expect(await kindOf(`clone:${REPO_KEY}`)).toBe('gitClone');
    expect(await kindOf('stage:reference/anthropic-skills')).toBe('gitClone');
    expect(await kindOf('dl:reference/ksa-modding')).toBe('download');
    // nothing is written by a dry run
    expect(existsSync(path.join(base, name))).toBe(false);
  });

  test('Place offers "Don\'t place" for every kind; choosing it updates the strip and the mode list', async ({
    page,
    request,
  }) => {
    const { name, dir } = await makeRecipe(request, ITEMS);
    await openInflate(page, name);
    await expect(summary(page)).toHaveText(`${dir} · 3 symlink · 2 clone · 1 download`);

    // skill: Symlink, Copy, Don't place (symlink first = the default)
    const skill = segmentRow(page, 'skill/okf-authoring');
    await skill.getByTestId('inflate-segment-material').click();
    await expect(page.getByRole('option')).toHaveText([/^Symlink/, /^Copy/, /^Don't place/]);
    await page.getByRole('option', { name: /^Don't place/ }).click();
    await expect(skill.getByTestId('inflate-segment-material')).toContainText("Don't place");
    await expect(skill.getByTestId('inflate-segment-dest')).toHaveCount(0);
    // not placed: the document installs it with commands again (claude-code), the mode list is the full family
    await expect(skill.getByTestId('inflate-segment-mode')).toContainText('Install');
    await expect(summary(page)).toHaveText(
      `${dir} · 2 symlink · 2 clone · 1 download · 1 not placed`,
    );

    // remote repository: Clone, Don't place
    const repo = segmentRow(page, REPO_KEY);
    await repo.getByTestId('inflate-segment-material').click();
    await expect(page.getByRole('option')).toHaveText([/^Clone/, /^Don't place/]);
    await page.keyboard.press('Escape');

    // archive skill: Download, Don't place (a git skill says Clone)
    const archive = segmentRow(page, 'reference/ksa-modding');
    await archive.getByTestId('inflate-segment-material').click();
    await expect(page.getByRole('option')).toHaveText([/^Download/, /^Don't place/]);
    await page.getByRole('option', { name: /^Don't place/ }).click();
    await expect(archive.getByTestId('inflate-segment-dest')).toHaveCount(0);
    await expect(summary(page)).toHaveText(`${dir} · 2 symlink · 2 clone · 2 not placed`);

    // local repository: Symlink, Worktree, Copy, Don't place
    await segmentRow(page, LOCAL_KEY).getByTestId('inflate-segment-material').click();
    await expect(page.getByRole('option')).toHaveText([
      /^Symlink/,
      /^Worktree/,
      /^Copy/,
      /^Don't place/,
    ]);
    await page.getByRole('option', { name: /^Copy/ }).click();
    await expect(summary(page)).toHaveText(`${dir} · 1 symlink · 1 copy · 2 clone · 2 not placed`);

    // a recipe without a directory has no strip and no Place column
    await page.getByTestId('inflate-output-clear').click();
    await expect(summary(page)).toHaveCount(0);
    await expect(page.getByTestId('inflate-segment-material')).toHaveCount(0);
    await page.getByTestId('inflate-output-default').click();
    await expect(summary(page)).toBeVisible();
  });

  test('a Place choice that equals the default is not saved; a different one is', async ({
    page,
    request,
  }) => {
    const { name } = await makeRecipe(request, ['skill/okf-authoring']);
    await openInflate(page, name);
    const skill = segmentRow(page, 'skill/okf-authoring');
    await expect(skill).toBeVisible();

    await skill.getByTestId('inflate-segment-material').click();
    await page.getByRole('option', { name: /^Copy/ }).click();
    await saveRecipe(page);
    expect(overrideIn(readRecipeYaml(name), 'skill/okf-authoring')).toMatchObject({
      material: 'copy',
    });

    await skill.getByTestId('inflate-segment-material').click();
    await page.getByRole('option', { name: /^Symlink/ }).click();
    await saveRecipe(page);
    expect(overrideIn(readRecipeYaml(name), 'skill/okf-authoring')).toBeUndefined();
  });
});

// ---------------------------------------------------------------- Editable

test.describe('Editable repositories', () => {
  test('the primary is editable by default; toggling writes edit, changes the dry-run document and the strip', async ({
    page,
    request,
  }) => {
    const { name, dir } = await makeRecipe(request, [REPO_KEY, LOCAL_KEY], { primary: REPO_KEY });
    await openInflate(page, name);
    await expect(segmentRow(page, REPO_KEY)).toBeVisible();

    // defaults: the primary is editable, the other repository is read-only
    await expect(editBox(page, REPO_KEY)).toBeChecked();
    await expect(editBox(page, LOCAL_KEY)).not.toBeChecked();
    await expect(summary(page)).toHaveText(
      `${dir} · 1 symlink · 1 clone · primary: ${REPO_REF} · editable: ${REPO_REF}`,
    );

    // 1. the other repository becomes editable
    const editable = planWith(
      page,
      (b) => b.recipe.overrides !== undefined && overrideIn(b.recipe, LOCAL_KEY)?.edit === true,
    );
    await segmentRow(page, LOCAL_KEY).getByTestId('inflate-segment-edit').click();
    await expect(editBox(page, LOCAL_KEY)).toBeChecked();
    const afterLocal = await markdownOf(await editable);
    expect(afterLocal).toMatch(
      new RegExp(`\\*\\*${LOCAL_REF}\\*\\* · .* · owner: me · editable — `),
    );
    expect(afterLocal).toMatch(new RegExp(`${LOCAL_REF}/ +symlink · editable · `));
    await expect(summary(page)).toHaveText(
      `${dir} · 1 symlink · 1 clone · primary: ${REPO_REF} · editable: ${REPO_REF}, ${LOCAL_REF}`,
    );
    await saveRecipe(page);
    expect(overrideIn(readRecipeYaml(name), LOCAL_KEY)).toEqual({ key: LOCAL_KEY, edit: true });

    // 2. the primary becomes read-only: the document stops telling the session to work there
    const readOnly = planWith(page, (b) => overrideIn(b.recipe, REPO_KEY)?.edit === false);
    await segmentRow(page, REPO_KEY).getByTestId('inflate-segment-edit').click();
    await expect(editBox(page, REPO_KEY)).not.toBeChecked();
    const afterRepo = await markdownOf(await readOnly);
    expect(afterRepo).toContain('Read it to answer the task; it is read-only.');
    expect(afterRepo).not.toContain('unless the task says otherwise');
    // the map row only says what is special: `primary`, and `editable` when it is
    expect(afterRepo).toMatch(new RegExp(`${REPO_REF}/ +git clone · primary · Fixture`));
    await expect(summary(page)).toHaveText(
      `${dir} · 1 symlink · 1 clone · primary: ${REPO_REF} · editable: ${LOCAL_REF}`,
    );
    await saveRecipe(page);
    expect(overrideIn(readRecipeYaml(name), REPO_KEY)).toEqual({ key: REPO_KEY, edit: false });

    // 3. back to the default (primary editable): the override is dropped, not stored as `edit: true`
    const back = planWith(page, (b) => overrideIn(b.recipe, REPO_KEY) === undefined);
    await segmentRow(page, REPO_KEY).getByTestId('inflate-segment-edit').click();
    await expect(editBox(page, REPO_KEY)).toBeChecked();
    expect(await markdownOf(await back)).toContain('unless the task says otherwise');
    await saveRecipe(page);
    expect(overrideIn(readRecipeYaml(name), REPO_KEY)).toBeUndefined();
    expect(overrideIn(readRecipeYaml(name), LOCAL_KEY)).toEqual({ key: LOCAL_KEY, edit: true });
  });

  test('moving Primary moves the default: the new primary is editable, the old one is not', async ({
    page,
    request,
  }) => {
    const { name } = await makeRecipe(request, [REPO_KEY, LOCAL_KEY], { primary: REPO_KEY });
    await openInflate(page, name);
    await expect(editBox(page, REPO_KEY)).toBeChecked();

    await segmentRow(page, LOCAL_KEY).getByTestId('inflate-segment-primary').click();
    await expect(editBox(page, LOCAL_KEY)).toBeChecked();
    await expect(editBox(page, REPO_KEY)).not.toBeChecked();
    await saveRecipe(page);
    // both flags are the defaults for their role, so nothing is stored for them
    const saved = readRecipeYaml(name);
    expect(overrideIn(saved, LOCAL_KEY)).toBeUndefined();
    expect(overrideIn(saved, REPO_KEY)).toBeUndefined();
    expect((saved.output as { primary: string }).primary).toBe(LOCAL_KEY);
  });

  test('a copy cannot be edited; the stored flag applies again with Symlink', async ({
    page,
    request,
  }) => {
    const { name, dir } = await makeRecipe(request, [LOCAL_KEY], {
      overrides: [{ key: LOCAL_KEY, edit: true }],
    });
    await openInflate(page, name);
    await expect(editBox(page, LOCAL_KEY)).toBeChecked();
    await expect(summary(page)).toHaveText(`${dir} · 1 symlink · editable: ${LOCAL_REF}`);

    const row = segmentRow(page, LOCAL_KEY);
    await row.getByTestId('inflate-segment-material').click();
    await page.getByRole('option', { name: /^Copy/ }).click();
    await expect(row.getByTestId('inflate-segment-edit')).toHaveCount(0);
    await expect(row.getByTestId('inflate-segment-primary')).toHaveCount(0);
    await expect(summary(page)).toHaveText(`${dir} · 1 copy`);

    await row.getByTestId('inflate-segment-material').click();
    await page.getByRole('option', { name: /^Symlink/ }).click();
    await expect(editBox(page, LOCAL_KEY)).toBeChecked();
    await expect(summary(page)).toHaveText(`${dir} · 1 symlink · editable: ${LOCAL_REF}`);
  });

  test('a remote repository that is not placed has no Editable checkbox', async ({
    page,
    request,
  }) => {
    const { name } = await makeRecipe(request, [REPO_KEY]);
    await openInflate(page, name);
    const row = segmentRow(page, REPO_KEY);
    await expect(row.getByTestId('inflate-segment-primary')).toBeVisible();
    await expect(row.getByTestId('inflate-segment-edit')).toBeVisible();
    await row.getByTestId('inflate-segment-material').click();
    await page.getByRole('option', { name: /^Don't place/ }).click();
    await expect(row.getByTestId('inflate-segment-edit')).toHaveCount(0);
    await expect(row.getByTestId('inflate-segment-primary')).toHaveCount(0);
  });

  test('the recipe page shows the saved flags', async ({ page, request }) => {
    const { name } = await makeRecipe(request, [REPO_KEY, LOCAL_KEY], {
      primary: REPO_KEY,
      overrides: [
        { key: REPO_KEY, material: 'clone', edit: false },
        { key: LOCAL_KEY, edit: true },
      ],
    });
    await page.goto(`/recipe/${name}`);
    const overrides = page.getByTestId('recipe-composition');
    await expect(
      overrides
        .locator(`[data-testid="recipe-override"][data-key="${REPO_KEY}"]`)
        .getByTestId('recipe-override-edit'),
    ).toHaveText('read-only');
    await expect(
      overrides
        .locator(`[data-testid="recipe-override"][data-key="${LOCAL_KEY}"]`)
        .getByTestId('recipe-override-edit'),
    ).toHaveText('editable');
    // the Output panel lists who may be changed: the primary is read-only here, the local folder is editable
    const editable = overrides.getByTestId('recipe-output-editable');
    await expect(editable).toContainText(LOCAL_KEY);
    await expect(editable).not.toContainText(REPO_KEY);
  });
});

// ---------------------------------------------------------------- Run view

test.describe('Run view Editable', () => {
  test('Editable is a run override: it changes the dry-run document and a real run, not the recipe, until saved', async ({
    page,
    request,
  }) => {
    const { name, dir } = await makeRecipe(request, ['kb/okf-format', LOCAL_KEY]);
    await openInflate(page, name, '&view=run');
    await expect(page.getByTestId('inflate-dirplan-status')).toHaveAttribute('data-kind', 'ready');

    const item = page.locator(`[data-testid="inflate-run-item"][data-key="${LOCAL_KEY}"]`);
    const checkbox = item.getByTestId('inflate-run-item-edit').getByRole('checkbox');
    await expect(item).toHaveAttribute('data-overridden', 'false');
    await expect(checkbox).not.toBeChecked();
    // only repositories have the flag
    await expect(
      page
        .locator('[data-testid="inflate-run-item"][data-key="kb/okf-format"]')
        .getByTestId('inflate-run-item-edit'),
    ).toHaveCount(0);

    // on: marked as overridden, sent with the dry run, shown in its document
    const planned = planWith(page, (b) => b.overrides?.items?.[LOCAL_KEY]?.edit === true);
    await item.getByTestId('inflate-run-item-edit').click();
    await expect(checkbox).toBeChecked();
    await expect(item).toHaveAttribute('data-overridden', 'true');
    await expect(page.getByTestId('inflate-run-overrides')).toContainText('1 run override');
    const answer = (await (await planned).json()) as PlanAnswer;
    expect(answer.applied).toEqual([LOCAL_KEY]);
    expect(answer.document.markdown).toMatch(
      new RegExp(`\\*\\*${LOCAL_REF}\\*\\* · .* · owner: me · editable — `),
    );
    // the recipe itself did not change
    await expect(page.getByTestId('inflate-status')).toHaveText('No changes');
    expect(overrideIn(readRecipeYaml(name), LOCAL_KEY)).toBeUndefined();

    // the per-item reset undoes it
    await item.getByTestId('inflate-run-item-reset').click();
    await expect(item).toHaveAttribute('data-overridden', 'false');
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByTestId('inflate-run-overrides')).toHaveCount(0);

    // on again, and run it for real
    await expect(page.getByTestId('inflate-dirplan-status')).toHaveAttribute('data-kind', 'ready');
    await item.getByTestId('inflate-run-item-edit').click();
    await expect(checkbox).toBeChecked();
    await expect(page.getByTestId('inflate-dirplan-status')).toHaveAttribute('data-kind', 'ready');
    await page.getByTestId('inflate-run-start').click();
    await expect(page.getByTestId('inflate-job')).toHaveAttribute('data-status', 'done', {
      timeout: 15_000,
    });
    const context = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(context).toMatch(new RegExp(`\\*\\*${LOCAL_REF}\\*\\* · .* · owner: me · editable — `));
    expect(context).toMatch(new RegExp(`${LOCAL_REF}/ +symlink · editable · `));
    expect(overrideIn(readRecipeYaml(name), LOCAL_KEY)).toBeUndefined();

    // "Save to recipe" moves the run override into the working recipe; Save writes it
    await page.getByTestId('inflate-job-back').click();
    await expect(page.getByTestId('inflate-run-overrides')).toBeVisible();
    await page.getByTestId('inflate-run-overrides-save').click();
    await expect(page.getByTestId('inflate-run-overrides')).toHaveCount(0);
    await expect(page.getByTestId('inflate-status')).toHaveText('Unsaved changes');
    await expect(checkbox).toBeChecked();
    await saveRecipe(page);
    expect(overrideIn(readRecipeYaml(name), LOCAL_KEY)).toEqual({ key: LOCAL_KEY, edit: true });
  });
});
