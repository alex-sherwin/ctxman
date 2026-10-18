// Context Inflate UI (INFLATE_SPEC §9, §11.2): the recipe bar, Sources and Composition panes, the Preview view,
// the New recipe dialog and the delete / discard dialogs. Every test that saves works on its own copy of the seed
// recipe (created through the API and removed afterwards); the seed itself is only read. Assertions on persisted
// data read the YAML file in the data copy, never only the rendered page.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page, Response } from '@playwright/test';
import {
  SEED_RECIPE,
  createRecipeCopy,
  dataExists,
  deleteRecipeQuietly,
  modKey,
  readRecipeYaml,
  typeIntoMonaco,
  uniqueName,
} from './helpers.ts';
import type { RecipeBody } from './helpers.ts';

/** The seed's composition in grouped layout (§10): the plan keys in order. */
const SEED_ORDER = [
  'md:b1',
  'ctx:ctxman-dev',
  'kb/ctxman',
  'kb/astro-content-layer',
  'rca/astro-dev-full-reload-on-save',
  'idea/context-inflate',
  'task/write-agents-md',
  'bug/stale-badge-timezone',
  'feature/context-forge',
  'project/ctxman-v1',
  'skill/okf-authoring',
  'reference/astro-docs',
  'sec:extra',
  'skill/ctxman-add-entry',
];

interface OverrideRow {
  key: string;
  mode?: string;
  options?: Record<string, unknown>;
  exclude?: boolean;
}

/** Recipes created by the test in progress; removed after it, whatever happened. */
const created = new Set<string>();

test.afterEach(async ({ request }) => {
  for (const name of created) await deleteRecipeQuietly(request, name);
  created.clear();
});

/** A fresh copy of the seed, removed after the test. */
async function newCopy(request: APIRequestContext): Promise<string> {
  const name = uniqueName('e2e-rcp');
  await createRecipeCopy(request, name);
  created.add(name);
  return name;
}

/** Opens /inflate on `name` (optionally with extra query text) and waits until its recipe is in place. */
async function openInflate(page: Page, name: string, query = ''): Promise<void> {
  await page.goto(`/inflate?recipe=${name}${query}`);
  await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute('href', `/recipe/${name}`, {
    timeout: 15_000,
  });
}

/** The composition row of a plan key (`kb/ctxman`, `ctx:ctxman-dev`, `md:b1`, `sec:extra`, ...). */
function segmentRow(page: Page, key: string): Locator {
  return page.locator(`[data-testid="inflate-segment"][data-key="${key}"]`);
}

/** The manifest row of a plan key in the preview view. */
function manifestRow(page: Page, key: string): Locator {
  return page.locator(`[data-testid="inflate-manifest-row"][data-key="${key}"]`);
}

/** The composition keys in DOM (display) order. */
async function segmentKeys(page: Page): Promise<string[]> {
  return page
    .getByTestId('inflate-segment')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.key ?? ''));
}

function overrideIn(recipe: RecipeBody, key: string): OverrideRow | undefined {
  return ((recipe.overrides ?? []) as OverrideRow[]).find((o) => o.key === key);
}

/** The order with `key` moved one place up (dir -1) or down (dir 1). */
function swapKeys(order: string[], key: string, dir: -1 | 1): string[] {
  const i = order.indexOf(key);
  const j = i + dir;
  const next = [...order];
  const a = next[i];
  const b = next[j];
  if (a === undefined || b === undefined) throw new Error(`cannot move ${key} ${dir}`);
  next[i] = b;
  next[j] = a;
  return next;
}

/**
 * The next POST /api/inflate/render whose request body satisfies `check`. The preview re-renders about 400 ms
 * after each edit, so register this BEFORE the edit and await it after.
 */
function renderWith(page: Page, check: (recipe: RecipeBody) => boolean): Promise<Response> {
  return page.waitForResponse((res) => {
    if (res.request().method() !== 'POST') return false;
    if (new URL(res.url()).pathname !== '/api/inflate/render') return false;
    return check(res.request().postDataJSON() as RecipeBody);
  });
}

/** Clicks Save (Cmd/Ctrl+S is covered by its own test) and waits for the PUT and the status line. */
async function saveRecipe(page: Page): Promise<void> {
  const put = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' && new URL(res.url()).pathname.startsWith('/api/recipe/'),
  );
  await page.getByTestId('inflate-save').click();
  expect((await put).status()).toBe(200);
  await expect(page.getByTestId('inflate-status')).toHaveText(/^Saved/);
}

async function pickRecipe(page: Page, name: string): Promise<void> {
  await page.getByTestId('inflate-recipe-select').click();
  await page.getByRole('option', { name, exact: true }).click();
}

test.describe('seed recipe', () => {
  test('loads the seed in the §10 order, with the excluded item marked', async ({ page }) => {
    await openInflate(page, SEED_RECIPE);
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => segmentKeys(page)).toEqual(SEED_ORDER);
    await expect(page.getByTestId('inflate-segment-count')).toHaveText('14 segments');
    await expect(segmentRow(page, 'bug/stale-badge-timezone')).toHaveAttribute(
      'data-status',
      'excluded',
    );
    await expect(segmentRow(page, 'kb/ctxman').getByTestId('inflate-segment-mode')).toContainText(
      'Inline bundle',
    );
  });
});

test.describe('composition edits', () => {
  test('a mode change re-renders the manifest with the new mode', async ({ page, request }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'kb/astro-content-layer')).toBeVisible();

    const rendered = renderWith(
      page,
      (recipe) => overrideIn(recipe, 'kb/astro-content-layer')?.mode === 'summary',
    );
    await segmentRow(page, 'kb/astro-content-layer').getByTestId('inflate-segment-mode').click();
    await page.getByRole('option', { name: /^Summary/ }).click();
    expect((await rendered).ok()).toBe(true);

    await page.getByTestId('inflate-view-preview').click();
    await expect(page.getByTestId('inflate-render-status')).toHaveAttribute('data-kind', 'ready');
    await expect(manifestRow(page, 'kb/astro-content-layer')).toContainText('Summary');
  });

  test('an option checkbox saves an override and the preview picks it up', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible();

    const rendered = renderWith(
      page,
      (recipe) => overrideIn(recipe, 'kb/ctxman')?.options?.includeFrontmatter === true,
    );
    const row = segmentRow(page, 'kb/ctxman');
    await row.getByTestId('inflate-opt-includeFrontmatter').click();
    await expect(
      row.getByTestId('inflate-opt-includeFrontmatter').getByRole('checkbox'),
    ).toBeChecked();
    expect((await rendered).ok()).toBe(true);

    await saveRecipe(page);
    await expect
      .poll(() => overrideIn(readRecipeYaml(name), 'kb/ctxman')?.options)
      .toEqual({ includeFrontmatter: true });

    await page.getByTestId('inflate-view-preview').click();
    await expect(page.getByTestId('inflate-render-status')).toHaveAttribute('data-kind', 'ready');
  });

  test('a markdown block inserted after an item is saved right after it', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible();

    await segmentRow(page, 'kb/ctxman').getByTestId('inflate-segment-insert-md').click();
    await expect(segmentRow(page, 'md:b2')).toBeVisible();
    await typeIntoMonaco(page, 'inflate-md-editor', 'E2E-MARKER');

    const put = page.waitForResponse(
      (res) => res.request().method() === 'PUT' && res.url().includes(`/api/recipe/${name}`),
    );
    await page.keyboard.press(`${modKey}+s`);
    expect((await put).status()).toBe(200);
    await expect(page.getByTestId('inflate-status')).toHaveText(/^Saved/);

    const saved = readRecipeYaml(name);
    const blocks = saved.markdown as { id: string; body: string }[];
    expect(blocks.find((b) => b.id === 'b2')?.body).toContain('E2E-MARKER');
    const order = saved.order as string[];
    expect(order.indexOf('md:b2')).toBe(order.indexOf('kb/ctxman') + 1);

    const keys = await segmentKeys(page);
    expect(keys.indexOf('md:b2')).toBe(keys.indexOf('kb/ctxman') + 1);
  });

  test('moving an item up and down reorders the composition and the saved order', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'task/write-agents-md')).toBeVisible();

    const task = segmentRow(page, 'task/write-agents-md');
    await task.getByTestId('inflate-segment-up').click();
    const up = swapKeys(SEED_ORDER, 'task/write-agents-md', -1);
    await expect.poll(() => segmentKeys(page)).toEqual(up);
    // The focus follows the moved row: same-direction button of that row.
    await expect(task.getByTestId('inflate-segment-up')).toBeFocused();
    await saveRecipe(page);
    expect(readRecipeYaml(name).order).toEqual(up);

    await task.getByTestId('inflate-segment-down').click();
    await expect.poll(() => segmentKeys(page)).toEqual(SEED_ORDER);
    await saveRecipe(page);
    expect(readRecipeYaml(name).order).toEqual(SEED_ORDER);
  });

  test('unchecking a context removes its items; checking it again restores them', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'ctx:ctxman-dev')).toBeVisible();

    const context = page.locator('[data-testid="inflate-context"][data-slug="ctxman-dev"]');
    await context.click();
    await expect(context.getByRole('checkbox')).not.toBeChecked();
    await expect.poll(() => segmentKeys(page)).not.toContain('ctx:ctxman-dev');
    await expect.poll(() => segmentKeys(page)).not.toContain('kb/ctxman');
    await expect.poll(() => segmentKeys(page)).toContain('skill/ctxman-add-entry');
    await saveRecipe(page);
    expect(readRecipeYaml(name).contexts).toEqual([]);

    await context.click();
    await expect(context.getByRole('checkbox')).toBeChecked();
    await expect(segmentRow(page, 'ctx:ctxman-dev')).toBeVisible();
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible();
    await saveRecipe(page);
    expect(readRecipeYaml(name).contexts).toEqual(['ctxman-dev']);
  });

  test('exclude and include write and remove the exclude override', async ({ page, request }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    const bug = segmentRow(page, 'bug/stale-badge-timezone');
    await expect(bug).toHaveAttribute('data-status', 'excluded');
    const feature = segmentRow(page, 'feature/context-forge');

    await bug.getByTestId('inflate-segment-exclude').click();
    await expect(bug).toHaveAttribute('data-status', 'included');
    await feature.getByTestId('inflate-segment-exclude').click();
    await expect(feature).toHaveAttribute('data-status', 'excluded');
    await saveRecipe(page);

    const saved = readRecipeYaml(name);
    expect(overrideIn(saved, 'bug/stale-badge-timezone')).toBeUndefined();
    expect(overrideIn(saved, 'feature/context-forge')?.exclude).toBe(true);
  });

  test('switching the target changes the default mode of the items', async ({ page, request }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    const skill = segmentRow(page, 'skill/ctxman-add-entry');
    await expect(skill.getByTestId('inflate-segment-mode')).toContainText('Install');

    await page.getByTestId('inflate-target').click();
    await page.getByRole('option', { name: 'Generic agent', exact: true }).click();
    await expect(skill.getByTestId('inflate-segment-mode')).toContainText('Pointer');
    await saveRecipe(page);
    expect(readRecipeYaml(name).target).toBe('generic');
  });

  test('an ad hoc item is added from Add items, saved, then removed', async ({ page, request }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible();

    await page.getByTestId('inflate-filter-q').fill('okf-format');
    const result = page.locator('[data-testid="inflate-result"][data-slug="okf-format"]');
    await expect(result).toBeVisible();
    await result.getByTestId('inflate-add').click();
    await expect(result).toHaveAttribute('data-added', 'true');
    await expect(segmentRow(page, 'kb/okf-format')).toContainText('ad hoc');

    await saveRecipe(page);
    expect(readRecipeYaml(name).items).toContainEqual({ dataset: 'kb', slug: 'okf-format' });

    await segmentRow(page, 'kb/okf-format').getByTestId('inflate-segment-remove').click();
    await expect(segmentRow(page, 'kb/okf-format')).toHaveCount(0);
  });
});

test.describe('preview and output', () => {
  test('?view=preview opens the generated document with its manifest', async ({ page }) => {
    const rendered = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/inflate/render',
    );
    await page.goto(`/inflate?recipe=${SEED_RECIPE}&view=preview`);
    const body = (await (await rendered).json()) as {
      markdown: string;
      manifest: { segments: { key: string }[] };
    };

    expect(body.markdown.startsWith(`# ${SEED_RECIPE}\n`)).toBe(true);
    expect(body.markdown).toContain('## Context: ctxman-dev');
    expect(body.markdown).toContain('### ctxman');
    expect(body.markdown).toContain('## Additional items');
    expect(body.markdown).toContain('.claude/skills/ctxman-add-entry');

    await expect(page.getByTestId('inflate-view-preview')).toBeChecked();
    await expect(page.getByTestId('inflate-render-status')).toHaveAttribute('data-kind', 'ready');
    await expect(page.getByTestId('inflate-preview-editor').locator('.view-lines')).toContainText(
      `# ${SEED_RECIPE}`,
    );
    expect(body.manifest.segments.length).toBeGreaterThanOrEqual(13);
    await expect(page.getByTestId('inflate-manifest-row')).toHaveCount(
      body.manifest.segments.length,
    );
  });

  test('Write file writes the document to an absolute .md path', async ({ page }) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-e2e-'));
    const file = path.join(dir, 'brief.md');
    try {
      await openInflate(page, SEED_RECIPE, '&view=preview');
      await page.getByTestId('inflate-write-path').fill(file);
      await page.getByTestId('inflate-write').click();
      const status = page.getByTestId('inflate-write-status');
      await expect(status).toHaveAttribute('data-kind', 'ok');
      await expect(status).toContainText(file);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8').startsWith(`# ${SEED_RECIPE}\n`)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a relative write path is refused with bad-path', async ({ page }) => {
    await openInflate(page, SEED_RECIPE, '&view=preview');
    await page.getByTestId('inflate-write-path').fill('brief.md');
    await page.getByTestId('inflate-write').click();
    const status = page.getByTestId('inflate-write-status');
    await expect(status).toHaveAttribute('data-kind', 'error');
    await expect(status).toContainText('path must be absolute');
  });
});

test.describe('copy and download', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('Copy puts the document on the clipboard; Download names it after the recipe', async ({
    page,
  }) => {
    await openInflate(page, SEED_RECIPE, '&view=preview');
    await expect(page.getByTestId('inflate-render-status')).toHaveAttribute('data-kind', 'ready');
    await expect(page.getByTestId('inflate-copy')).toBeEnabled();

    // Chromium rejects clipboard writes from an unfocused page ("Document is not focused"), which the app
    // swallows; bring the page to front so the click is the only thing that decides the outcome.
    await page.bringToFront();
    await page.getByTestId('inflate-copy').click();
    await expect(page.getByTestId('inflate-copy')).toHaveText('Copied');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard.startsWith(`# ${SEED_RECIPE}\n`)).toBe(true);

    const download = page.waitForEvent('download');
    await page.getByTestId('inflate-download').click();
    expect((await download).suggestedFilename()).toBe(`${SEED_RECIPE}.md`);
  });
});

test.describe('New recipe dialog', () => {
  test('validates the name, then creates the recipe and selects it', async ({ page }) => {
    const name = uniqueName('e2e-rcp');
    created.add(name);
    await page.goto('/inflate?recipe=new');
    const dialog = page.getByTestId('inflate-new-dialog');
    await expect(dialog).toBeVisible();
    const create = page.getByTestId('inflate-new-create');
    await expect(create).toBeDisabled();

    await page.getByTestId('inflate-new-name').fill('new');
    await expect(dialog.getByText('"new" is reserved')).toBeVisible();
    await page.getByTestId('inflate-new-name').fill('Not Valid');
    await expect(
      dialog.getByText(/Use lowercase letters, digits and single hyphens/),
    ).toBeVisible();
    await page.getByTestId('inflate-new-name').fill(SEED_RECIPE);
    await expect(dialog.getByText(/already exists/)).toBeVisible();
    await expect(create).toBeDisabled();

    await page.getByTestId('inflate-new-name').fill(name);
    await expect(create).toBeDisabled(); // description still empty
    await page.getByTestId('inflate-new-description').fill('Created by the e2e suite');
    await expect(create).toBeEnabled();
    await create.click();

    await expect(page).toHaveURL(new RegExp(`[?&]recipe=${name}(&|$)`));
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute(
      'href',
      `/recipe/${name}`,
    );
    await expect.poll(() => dataExists(`recipe/${name}.yaml`)).toBe(true);
    expect(readRecipeYaml(name)).toMatchObject({
      name,
      description: 'Created by the e2e suite',
      target: 'claude-code',
      layout: 'grouped',
      contexts: [],
    });

    // A context chosen in Sources gets its segments; saving writes it to the recipe.
    await page.locator('[data-testid="inflate-context"][data-slug="okf-authoring"]').click();
    await expect(segmentRow(page, 'ctx:okf-authoring')).toBeVisible();
    await saveRecipe(page);
    expect(readRecipeYaml(name).contexts).toEqual(['okf-authoring']);
  });

  test('Cancel closes the dialog without selecting a recipe', async ({ page }) => {
    await page.goto('/inflate?recipe=new');
    await expect(page.getByTestId('inflate-new-dialog')).toBeVisible();
    await page.getByTestId('inflate-new-cancel').click();
    await expect(page.getByTestId('inflate-new-dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(/recipe=new/);
    await expect(page.getByTestId('inflate-empty-new')).toBeVisible();
  });
});

test.describe('switching, deleting and history', () => {
  test('switching recipe with unsaved edits asks first', async ({ page, request }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible();
    const original = readRecipeYaml(name).description;

    await page.getByTestId('inflate-description').fill('Edited but not saved');
    await page.getByTestId('inflate-recipe-select').click();
    await page.getByRole('option', { name: SEED_RECIPE, exact: true }).click();
    const dialog = page.getByTestId('inflate-discard-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute(
      'href',
      `/recipe/${name}`,
    );
    await expect(page.getByTestId('inflate-description')).toHaveValue('Edited but not saved');

    await pickRecipe(page, SEED_RECIPE);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute(
      'href',
      `/recipe/${SEED_RECIPE}`,
    );
    await expect(page).toHaveURL(new RegExp(`[?&]recipe=${SEED_RECIPE}(&|$)`));
    await expect(page.getByTestId('inflate-description')).not.toHaveValue('Edited but not saved');
    expect(readRecipeYaml(name).description).toBe(original);
  });

  test('Delete asks first, then removes the recipe from disk and from the list', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible();

    await page.getByTestId('inflate-delete').click();
    const dialog = page.getByTestId('inflate-delete-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(dataExists(`recipe/${name}.yaml`)).toBe(true);

    await page.getByTestId('inflate-delete').click();
    const deleted = page.waitForResponse(
      (res) => res.request().method() === 'DELETE' && res.url().includes(`/api/recipe/${name}`),
    );
    await page
      .getByTestId('inflate-delete-dialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    expect((await deleted).status()).toBe(204);
    await expect(page.getByTestId('inflate-status')).toHaveText(`Deleted ${name}`);
    created.delete(name);
    await expect.poll(() => dataExists(`recipe/${name}.yaml`)).toBe(false);

    await page.goto('/recipe');
    await expect(page.getByTestId('list-results')).toBeVisible();
    await expect(page.locator(`[data-testid="list-row"][data-slug="${name}"]`)).toHaveCount(0);
  });

  test('back and forward restore the recipe and the view', async ({ page, request }) => {
    const first = await newCopy(request);
    const second = await newCopy(request);
    await page.goto('/inflate');
    await expect(page.getByTestId('inflate-empty-new')).toBeVisible();

    await pickRecipe(page, first);
    await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute(
      'href',
      `/recipe/${first}`,
    );
    await pickRecipe(page, second);
    await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute(
      'href',
      `/recipe/${second}`,
    );
    // The view is a replaceState on the current entry, so going back lands on the compose view of `first`.
    await page.getByTestId('inflate-view-preview').click();
    await expect(page).toHaveURL(/[?&]view=preview(&|$)/);

    await page.goBack();
    await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute(
      'href',
      `/recipe/${first}`,
    );
    await expect(page.getByTestId('inflate-view-compose')).toBeChecked();

    await page.goForward();
    await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute(
      'href',
      `/recipe/${second}`,
    );
    await expect(page.getByTestId('inflate-view-preview')).toBeChecked();
  });
});
