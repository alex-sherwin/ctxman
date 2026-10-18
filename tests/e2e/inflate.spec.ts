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
  material?: string;
  materialOptions?: Record<string, unknown>;
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

/** The order with `key` moved right before `before` (a key of the order). */
function moveBefore(order: string[], key: string, before: string): string[] {
  const rest = order.filter((k) => k !== key);
  const at = rest.indexOf(before);
  if (at === -1) throw new Error(`unknown key ${before}`);
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}

/**
 * Keyboard drag and drop of a composition row (react-aria): focus the row, Tab to its handle, Enter starts the
 * drag and focuses the first drop target; ArrowDown walks the targets (they wrap), Enter on the one labelled
 * `target` drops. Programmatic `focus()` on a handle is not enough: a list that has no focused row yet moves the
 * focus to its first row.
 */
async function dragWithKeyboard(page: Page, key: string, target: string): Promise<void> {
  await segmentRow(page, key).focus();
  await page.keyboard.press('Tab');
  await expect(segmentRow(page, key).getByTestId('inflate-segment-handle')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(segmentRow(page, key)).toHaveAttribute('data-dragging', 'true');
  for (let i = 0; i < 30; i++) {
    const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    if (label === target) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`no drop target labelled "${target}"`);
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

  test('a markdown row shows a one-line preview while collapsed and the editor when expanded', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    const block = segmentRow(page, 'md:b1');
    await expect(block).toBeVisible();

    // The seed block starts collapsed: chevron + the first line of its body, no editor.
    const preview = block.getByTestId('inflate-md-preview');
    await expect(preview).toHaveText('## Ground rules');
    await expect(block.getByTestId('inflate-md-editor')).toHaveCount(0);
    await expect(block.getByTestId('inflate-md-toggle')).toHaveAttribute('aria-expanded', 'false');

    await block.getByTestId('inflate-md-toggle').click();
    await expect(block.getByTestId('inflate-md-editor')).toBeVisible();
    await expect(preview).toHaveCount(0);
    await expect(block.getByTestId('inflate-md-toggle')).toHaveAttribute('aria-expanded', 'true');

    await block.getByTestId('inflate-md-toggle').click();
    await expect(preview).toHaveText('## Ground rules');
    await expect(block.getByTestId('inflate-md-editor')).toHaveCount(0);

    // A block added with "+ md" opens expanded; its preview says "empty" until it has text.
    await segmentRow(page, 'kb/ctxman').getByTestId('inflate-segment-insert-md').click();
    const added = segmentRow(page, 'md:b2');
    await expect(added.getByTestId('inflate-md-editor')).toBeVisible();
    await expect(added.getByTestId('inflate-md-preview')).toHaveCount(0);
    await typeIntoMonaco(page, 'inflate-md-editor', 'E2E-PREVIEW');
    await added.getByTestId('inflate-md-toggle').click();
    await expect(added.getByTestId('inflate-md-preview')).toHaveText('E2E-PREVIEW');
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

  test('dragging a handle with the mouse reorders the composition and the saved order', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'task/write-agents-md')).toBeVisible();
    await expect.poll(() => segmentKeys(page)).toEqual(SEED_ORDER);

    const handle = await segmentRow(page, 'task/write-agents-md')
      .getByTestId('inflate-segment-handle')
      .boundingBox();
    const over = await segmentRow(page, 'kb/astro-content-layer').boundingBox();
    if (handle === null || over === null) throw new Error('rows are not laid out');
    // Native HTML5 drag: press on the handle, leave the row, hover the upper half of the target row, release.
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 20, { steps: 4 });
    await page.mouse.move(handle.x + 40, over.y + 4, { steps: 12 });
    await page.mouse.up();

    const expected = moveBefore(SEED_ORDER, 'task/write-agents-md', 'kb/astro-content-layer');
    await expect.poll(() => segmentKeys(page)).toEqual(expected);
    await expect(page.getByTestId('inflate-status')).toHaveText('Unsaved changes');
    await saveRecipe(page);
    expect(readRecipeYaml(name).order).toEqual(expected);
  });

  test('a handle reorders by keyboard; Escape cancels a drag', async ({ page, request }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'task/write-agents-md')).toBeVisible();

    // Escape: the drag ends, nothing moved, the recipe is not dirty.
    await segmentRow(page, 'task/write-agents-md').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(segmentRow(page, 'task/write-agents-md')).toHaveAttribute('data-dragging', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(segmentRow(page, 'task/write-agents-md')).not.toHaveAttribute('data-dragging');
    expect(await segmentKeys(page)).toEqual(SEED_ORDER);
    await expect(page.getByTestId('inflate-status')).toHaveText('No changes');

    // Drop between "ctxman" and "Astro content layer": the task lands right after kb/ctxman.
    await dragWithKeyboard(
      page,
      'task/write-agents-md',
      'Insert between ctxman and Astro content layer',
    );
    const expected = moveBefore(SEED_ORDER, 'task/write-agents-md', 'kb/astro-content-layer');
    await expect.poll(() => segmentKeys(page)).toEqual(expected);
    await expect(page.getByTestId('inflate-status')).toHaveText('Unsaved changes');
    await saveRecipe(page);
    expect(readRecipeYaml(name).order).toEqual(expected);
  });

  test('typing in an option input inside a row keeps working and does not reorder', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    const clone = segmentRow(page, 'reference/astro-docs').getByTestId('inflate-opt-cloneDir');
    await expect(clone).toBeVisible();
    const original = await clone.inputValue();

    await clone.click();
    await page.keyboard.press('End');
    await page.keyboard.type('-x y'); // letters and Space stay in the input (no row navigation or type-ahead)
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('Q');
    await expect(clone).toHaveValue(`${original}-xQ y`);
    expect(await segmentKeys(page)).toEqual(SEED_ORDER);

    // A mouse drag inside the input selects text instead of dragging the row.
    const box = await clone.boundingBox();
    if (box === null) throw new Error('input is not laid out');
    await page.mouse.move(box.x + 6, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    expect(
      await clone.evaluate(
        (el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0),
      ),
    ).toBeGreaterThan(3);
    expect(await segmentKeys(page)).toEqual(SEED_ORDER);
  });

  test('Cmd/Ctrl+S saves while the focus is inside a row control', async ({ page, request }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    const clone = segmentRow(page, 'reference/astro-docs').getByTestId('inflate-opt-cloneDir');
    await expect(clone).toBeVisible();

    await clone.click();
    await page.keyboard.press('End');
    await page.keyboard.type('-s');
    await expect(page.getByTestId('inflate-status')).toHaveText('Unsaved changes');
    // Rows stop the propagation of their key events; the shortcut still has to reach the store.
    const put = page.waitForResponse(
      (res) => res.request().method() === 'PUT' && res.url().includes(`/api/recipe/${name}`),
    );
    await page.keyboard.press(`${modKey}+s`);
    expect((await put).status()).toBe(200);
    await expect(page.getByTestId('inflate-status')).toHaveText(/^Saved/);
    const saved = overrideIn(readRecipeYaml(name), 'reference/astro-docs');
    expect(saved?.options?.cloneDir).toContain('-s');
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
    // The manifest is the kit Table (a real <table> with a visible heading).
    await expect(page.getByTestId('inflate-manifest')).toHaveClass(/ck-table/);
    await expect(page.getByRole('heading', { name: 'Manifest' })).toBeVisible();
    await expect(page.getByRole('grid', { name: 'Manifest' })).toBeVisible();
  });

  test('Write file writes the document to an absolute .md path', async ({ page }) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-e2e-'));
    const file = path.join(dir, 'brief.md');
    try {
      // The Write box belongs to the absolute document (a recipe with a directory previews the relative one).
      await openInflate(page, SEED_RECIPE, '&view=preview&paths=absolute');
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
    await openInflate(page, SEED_RECIPE, '&view=preview&paths=absolute');
    await page.getByTestId('inflate-write-path').fill('brief.md');
    await page.getByTestId('inflate-write').click();
    const status = page.getByTestId('inflate-write-status');
    await expect(status).toHaveAttribute('data-kind', 'error');
    await expect(status).toContainText('path must be absolute');
  });
});

test.describe('output directory', () => {
  /** The composition row's controls of a reference item. */
  const astroDocs = (page: Page): Locator => segmentRow(page, 'reference/astro-docs');

  test('the Output panel shows the seed directory and primary repository', async ({ page }) => {
    await openInflate(page, SEED_RECIPE);
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible();
    await expect(page.getByTestId('inflate-output')).toBeVisible();
    await expect(page.getByTestId('inflate-output-toggle')).toContainText(
      '~/ctxman-inflate/ctxman-dev-brief',
    );
    await expect(page.getByTestId('inflate-output-dir')).toHaveValue(
      '~/ctxman-inflate/ctxman-dev-brief',
    );
    await expect(page.getByTestId('inflate-output-contextfile')).toHaveValue('LLM_CONTEXT.md');
    // claude-code: the CLAUDE.md stub and .gitignore on, AGENTS.md off
    await expect(
      page.getByTestId('inflate-output-stub-claudeMd').getByRole('checkbox'),
    ).toBeChecked();
    await expect(
      page.getByTestId('inflate-output-stub-gitignore').getByRole('checkbox'),
    ).toBeChecked();
    await expect(
      page.getByTestId('inflate-output-stub-agentsMd').getByRole('checkbox'),
    ).not.toBeChecked();
    await expect(page.getByTestId('inflate-output-primary')).toContainText('astro-docs');
    await expect(
      astroDocs(page).getByTestId('inflate-segment-primary').getByRole('checkbox'),
    ).toBeChecked();
    await expect(astroDocs(page).getByTestId('inflate-segment-material')).toContainText('Clone');
    await expect(astroDocs(page).getByTestId('inflate-segment-dest')).toHaveText(
      'repos/astro-docs',
    );
    await expect(
      segmentRow(page, 'kb/ctxman').getByTestId('inflate-segment-material'),
    ).toContainText('Symlink');
    await expect(page.getByTestId('inflate-output-run')).toBeVisible();
  });

  test('"Document only" removes the directory and the material controls; "Use default" brings it back', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible();
    await expect(page.getByTestId('inflate-segment-material').first()).toBeVisible();

    await page.getByTestId('inflate-output-clear').click();
    await expect(page.getByTestId('inflate-output-dir')).toHaveValue('');
    await expect(page.getByTestId('inflate-output-toggle')).toContainText('document only');
    await expect(page.getByTestId('inflate-output-clear')).toBeDisabled();
    await expect(page.getByTestId('inflate-segment-material')).toHaveCount(0);
    await expect(page.getByTestId('inflate-segment-dest')).toHaveCount(0);
    await saveRecipe(page);
    expect(readRecipeYaml(name).output).not.toHaveProperty('dir');

    await page.getByTestId('inflate-output-default').click();
    await expect(page.getByTestId('inflate-output-dir')).toHaveValue(`~/ctxman-inflate/${name}`);
    await expect(page.getByTestId('inflate-segment-material').first()).toBeVisible();
    await saveRecipe(page);
    expect((readRecipeYaml(name).output as { dir: string }).dir).toBe(`~/ctxman-inflate/${name}`);

    // typing an invalid directory flags the field
    await page.getByTestId('inflate-output-dir').fill('relative/dir');
    await expect(page.getByText('must be absolute or start with ~/')).toBeVisible();
  });

  test('context file and generated files are saved in the recipe; invalid names are not committed', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(page.getByTestId('inflate-output')).toBeVisible();

    await page.getByTestId('inflate-output-contextfile').fill('not-markdown.txt');
    await expect(page.getByText(/must be a file name ending in \.md/)).toBeVisible();
    await expect(page.getByTestId('inflate-status')).toHaveText('No changes');
    await page.getByTestId('inflate-output-contextfile').fill('CONTEXT.md');
    await expect(page.getByTestId('inflate-status')).toHaveText('Unsaved changes');

    await page.getByTestId('inflate-output-stub-agentsMd').click();
    await page.getByTestId('inflate-output-stub-gitignore').click();
    await saveRecipe(page);
    const output = readRecipeYaml(name).output as {
      contextFile: string;
      stubs: Record<string, boolean>;
    };
    expect(output.contextFile).toBe('CONTEXT.md');
    expect(output.stubs).toEqual({ agentsMd: true, gitignore: false });

    // back to the defaults: the keys go away again
    await page.getByTestId('inflate-output-contextfile').fill('LLM_CONTEXT.md');
    await page.getByTestId('inflate-output-stub-agentsMd').click();
    await page.getByTestId('inflate-output-stub-gitignore').click();
    await saveRecipe(page);
    const reset = readRecipeYaml(name).output as Record<string, unknown>;
    expect(reset).not.toHaveProperty('contextFile');
    expect(reset).not.toHaveProperty('stubs');
  });

  test('a repository row offers its material, clone options and Primary; they are saved', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    const row = astroDocs(page);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('inflate-mopt-cloneDepth')).toContainText('1');
    await expect(row.getByTestId('inflate-mopt-subpathOnly').getByRole('checkbox')).toBeChecked();

    await row.getByTestId('inflate-mopt-cloneDepth').click();
    await page.getByRole('option', { name: 'full', exact: true }).click();
    await expect(row.getByTestId('inflate-mopt-cloneDepth')).toContainText('full');
    // an invalid branch is not committed, a valid one is
    await row.getByTestId('inflate-mopt-branch').fill('-bad');
    await expect(page.getByText(/must be a branch or tag name/)).toBeVisible();
    await row.getByTestId('inflate-mopt-branch').fill('release/1.0');
    await row.getByTestId('inflate-mopt-subpathOnly').click();
    await saveRecipe(page);
    expect(overrideIn(readRecipeYaml(name), 'reference/astro-docs')).toMatchObject({
      material: 'clone',
      materialOptions: { cloneDepth: 0, branch: 'release/1.0' },
    });
    expect(
      (overrideIn(readRecipeYaml(name), 'reference/astro-docs') as { materialOptions: object })
        .materialOptions,
    ).not.toHaveProperty('subpathOnly');

    // Mention only: no options, no Primary, and the primary pick goes with it
    await row.getByTestId('inflate-segment-material').click();
    await page.getByRole('option', { name: /^Mention only/ }).click();
    await expect(row.getByTestId('inflate-segment-primary')).toHaveCount(0);
    await expect(row.getByTestId('inflate-mopt-cloneDepth')).toHaveCount(0);
    await expect(row.getByTestId('inflate-segment-dest')).toHaveCount(0);
    await expect(page.getByTestId('inflate-output-primary')).toContainText('none');
    await saveRecipe(page);
    expect(readRecipeYaml(name).output).not.toHaveProperty('primary');
  });

  test('a default material per kind changes the rows of that kind', async ({ page, request }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible();
    await page.getByRole('button', { name: /Default modes/ }).click();
    await page.getByTestId('inflate-default-material-kb').click();
    await page.getByRole('option', { name: /^Copy/ }).click();
    await expect(
      segmentRow(page, 'kb/ctxman').getByTestId('inflate-segment-material'),
    ).toContainText('Copy');
    await saveRecipe(page);
    expect((readRecipeYaml(name).defaults as { kb: { material: string } }).kb.material).toBe(
      'copy',
    );
  });
});

test.describe('preview paths', () => {
  test('a recipe with a directory previews the relative document and offers the absolute one', async ({
    page,
  }) => {
    await openInflate(page, SEED_RECIPE, '&view=preview');
    await expect(page.getByTestId('inflate-render-status')).toHaveAttribute('data-kind', 'ready', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('inflate-preview-paths-relative')).toBeChecked();
    const lines = page.getByTestId('inflate-preview-editor').locator('.view-lines');
    await expect(lines).toContainText('# ctxman-dev-brief');
    await expect(lines).toContainText('This directory is the working root');
    // the side column explains where a run writes it; no Write box
    await expect(page.getByTestId('inflate-preview-hint')).toContainText('LLM_CONTEXT.md');
    await expect(page.getByTestId('inflate-preview-run')).toBeVisible();
    await expect(page.getByTestId('inflate-write-path')).toHaveCount(0);
    // the manifest says what is placed where
    await expect(page.getByRole('columnheader', { name: 'Material' })).toBeVisible();
    await expect(manifestRow(page, 'reference/astro-docs')).toContainText('Clone');
    await expect(manifestRow(page, 'reference/astro-docs')).toContainText('repos/astro-docs');

    await page.getByTestId('inflate-preview-paths-absolute').click();
    await expect(page).toHaveURL(/[?&]paths=absolute(&|$)/);
    await expect(page.getByTestId('inflate-preview-paths-absolute')).toBeChecked();
    await expect(page.getByTestId('inflate-write-path')).toBeVisible();
    await expect(page.getByTestId('inflate-preview-hint')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Material' })).toHaveCount(0);
    await expect(lines).not.toContainText('This directory is the working root');
    await expect(page.getByTestId('inflate-render-status')).toHaveAttribute('data-kind', 'ready');

    await page.getByTestId('inflate-preview-paths-relative').click();
    await expect(page).not.toHaveURL(/paths=/);
    await expect(page.getByTestId('inflate-preview-hint')).toBeVisible();
  });

  test('without a directory there is only the absolute document and the Write box', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    const recipe = (await (await request.get(`/api/recipe/${name}`)).json()) as {
      recipe: RecipeBody;
    };
    const { output: _removed, ...documentOnly } = recipe.recipe;
    expect((await request.put(`/api/recipe/${name}`, { data: documentOnly })).status()).toBe(200);
    await openInflate(page, name, '&view=preview');
    await expect(page.getByTestId('inflate-render-status')).toHaveAttribute('data-kind', 'ready', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('inflate-preview-paths')).toHaveCount(0);
    await expect(page.getByTestId('inflate-write-path')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Material' })).toHaveCount(0);
  });

  test('the run view is part of the view toggle; a directory typed there plans the seed', async ({
    page,
    request,
  }) => {
    const name = await newCopy(request);
    await openInflate(page, name);
    await page.getByTestId('inflate-view-run').click();
    await expect(page).toHaveURL(/[?&]view=run(&|$)/);
    await expect(page.getByTestId('inflate-run-settings')).toBeVisible();
    await expect(page.getByTestId('inflate-run-dir')).toHaveValue(
      '~/ctxman-inflate/ctxman-dev-brief',
    );

    // A directory that does not exist: the dry run is the same on every machine, and nothing is written.
    const dir = path.join(os.tmpdir(), uniqueName('ctxman-e2e-plan'));
    await page.getByTestId('inflate-run-dir').fill(dir);
    await expect(page.getByTestId('inflate-run-overrides')).toContainText('1 run override');
    await expect(page.getByTestId('inflate-dirplan-status')).toHaveAttribute('data-kind', 'ready', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('inflate-dirplan-step')).toHaveCount(15);
    expect(
      await page
        .getByTestId('inflate-dirplan-step')
        .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.stepId)),
    ).toEqual([
      'dir',
      'okf:kb/ctxman',
      'okf:kb/astro-content-layer',
      'okf:rca/astro-dev-full-reload-on-save',
      'okf:idea/context-inflate',
      'okf:task/write-agents-md',
      'okf:feature/context-forge',
      'okf:project/ctxman-v1',
      'skill:skill/okf-authoring',
      'skill:skill/ctxman-add-entry',
      'clone:reference/astro-docs',
      'context',
      'stub:CLAUDE.md',
      'stub:.gitignore',
      'manifest',
    ]);
    expect(existsSync(dir)).toBe(false);

    await page.getByTestId('inflate-view-compose').click();
    await expect(page).not.toHaveURL(/view=/);
    await expect(segmentRow(page, 'kb/ctxman')).toBeVisible();
    // the run override is not part of the recipe, and the compose view says so
    await expect(page.getByTestId('inflate-status')).toHaveText('No changes');
    await expect(page.getByTestId('inflate-output-overrides')).toContainText('1 run override');
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

  test('the recipe select filters, keeps "+ New recipe…" pinned and opens the dialog', async ({
    page,
  }) => {
    await openInflate(page, SEED_RECIPE);
    await page.getByTestId('inflate-recipe-select').click();
    const search = page.getByTestId('inflate-recipe-select-search');
    await expect(search).toBeFocused();

    await search.fill('zzz-no-such-recipe');
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(page.getByTestId('inflate-recipe-new')).toBeVisible();

    await search.fill(SEED_RECIPE);
    await expect(page.getByRole('option', { name: SEED_RECIPE, exact: true })).toBeVisible();
    await expect(page.getByTestId('inflate-recipe-new')).toBeVisible();

    await page.getByTestId('inflate-recipe-new').click();
    await expect(page).toHaveURL(/[?&]recipe=new(&|$)/);
    await expect(page.getByTestId('inflate-new-dialog')).toBeVisible();
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
