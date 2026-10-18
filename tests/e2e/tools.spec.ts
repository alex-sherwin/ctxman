// Tools page (UI_SPEC §I, ROUND2_UI_SPEC §I): run the allowlisted check scripts and scaffold an entry with the add
// script. A successful add opens the new entry: contexts / recipes at once, okf / skill / reference entries once
// `/api/entries` lists them (the dev server also reloads the page ~0.7 s after such a write; the saved run resumes).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dataExists, readDataText, uniqueName } from './helpers.ts';

const RUN_KEY = 'ctxman:tools:last-run';

async function fillAddForm(
  page: Page,
  name: string,
  description = 'Created by the e2e suite',
): Promise<void> {
  await page.getByTestId('tools-add-name').fill(name);
  await page.getByTestId('tools-add-title').fill('E2E entry');
  await page.getByTestId('tools-add-description').fill(description);
}

test.describe('checks', () => {
  test('the check scripts are listed with a Run button each', async ({ page }) => {
    await page.goto('/tools');
    await expect(page.getByTestId('tools-scripts')).toBeVisible();
    for (const name of ['check', 'check-okf', 'check-links', 'check-collections']) {
      await expect(page.getByTestId(`tools-script-${name}`)).toBeVisible();
      await expect(page.getByTestId(`tools-run-${name}`)).toBeEnabled();
    }
    // `add` is not a check: it lives in the Add entry panel.
    await expect(page.getByTestId('tools-script-add')).toHaveCount(0);
  });

  test('Run shows the output and an exit code of 0 for the full check', async ({ page }) => {
    await page.goto('/tools');
    await page.getByTestId('tools-run-check').click();
    await expect(page.getByTestId('tools-exit-code')).toHaveText('exit 0');
    await expect(page.getByTestId('tools-stdout')).toContainText('All checks: OK');
  });
});

test.describe('add entry', () => {
  test('?add=task preselects the dataset; ?add=bug preselects another', async ({ page }) => {
    await page.goto('/tools?add=task');
    await expect(page.getByTestId('tools-add-dataset')).toContainText('Tasks');
    await page.goto('/tools?add=bug');
    await expect(page.getByTestId('tools-add-dataset')).toContainText('Bugs');
  });

  test('the dataset select filters by label or id and writes ?add=', async ({ page }) => {
    await page.goto('/tools?add=task');
    await page.getByTestId('tools-add-dataset').click();
    await page.getByTestId('tools-add-dataset-search').fill('kb');
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tools-add-dataset')).toContainText('Knowledge base');
    await expect(page).toHaveURL(/[?&]add=kb(&|$)/);
  });

  test('creates an idea and opens it once the entry is listed (surviving the dev reload)', async ({
    page,
  }) => {
    const name = uniqueName('e2e-idea');
    await page.goto('/tools?add=idea');
    await expect(page.getByTestId('tools-add-dataset')).toContainText('Ideas');
    await fillAddForm(page, name);
    await page.getByTestId('tools-add-submit').click();

    // The result panel appears first, with the "Opening…" status while the entry is not listed yet.
    await expect(page.getByTestId('tools-add-path')).toHaveText(`idea/${name}/main.md`);
    await expect(page.getByTestId('tools-add-opening')).toBeVisible();

    await expect(page).toHaveURL(new RegExp(`/idea/${name}$`), { timeout: 15_000 });
    await expect(page.getByTestId('detail-slug')).toHaveText(name);
    await expect(page.getByTestId('detail-content')).toContainText('Created by the e2e suite');
    expect(dataExists(`idea/${name}/main.md`)).toBe(true);
    expect(readDataText(`idea/${name}/main.md`)).toContain(`name: ${name}`);
  });

  test('coming back to /tools shows the result and does not navigate again', async ({ page }) => {
    const name = uniqueName('e2e-task');
    await page.goto('/tools?add=task');
    await fillAddForm(page, name);
    await page.getByTestId('tools-add-submit').click();
    await expect(page).toHaveURL(new RegExp(`/task/${name}$`), { timeout: 15_000 });

    await page.goto('/tools?add=task');
    await expect(page.getByTestId('tools-add-path')).toHaveText(`task/${name}/main.md`);
    await expect(page.getByTestId('tools-add-opening')).toHaveCount(0);
    await page.waitForTimeout(1500); // a resumed follow would have navigated by now
    await expect(page).toHaveURL(/\/tools\?add=task$/);
    // The link in the result panel still works.
    await page.getByTestId('tools-add-open').click();
    await expect(page).toHaveURL(new RegExp(`/task/${name}$`));
  });

  test('creating a context opens it at once', async ({ page, request }) => {
    const name = uniqueName('e2e-ctx');
    await page.goto('/tools?add=context');
    await expect(page.getByTestId('tools-add-dataset')).toContainText('Contexts');
    await fillAddForm(page, name);
    await page.getByTestId('tools-add-submit').click();
    await expect(page).toHaveURL(new RegExp(`/context/${name}$`), { timeout: 15_000 });
    await expect(page.getByTestId('detail-slug')).toHaveText(name);
    expect(dataExists(`context/${name}.yaml`)).toBe(true);
    await request.delete(`/api/context/${name}`);
  });

  test('creating a recipe opens it at once', async ({ page, request }) => {
    const name = uniqueName('e2e-recipe');
    await page.goto('/tools?add=recipe');
    await expect(page.getByTestId('tools-add-dataset')).toContainText('Inflate recipes');
    await fillAddForm(page, name);
    await page.getByTestId('tools-add-submit').click();
    await expect(page).toHaveURL(new RegExp(`/recipe/${name}$`), { timeout: 15_000 });
    await expect(page.getByTestId('detail-slug')).toHaveText(name);
    await request.delete(`/api/recipe/${name}`);
  });

  test('adding the same name again exits non-zero with "already exists" and does not navigate', async ({
    page,
  }) => {
    const name = uniqueName('e2e-idea');
    await page.goto('/tools?add=idea');
    await fillAddForm(page, name, 'First try');
    await page.getByTestId('tools-add-submit').click();
    await expect(page).toHaveURL(new RegExp(`/idea/${name}$`), { timeout: 15_000 });
    expect(dataExists(`idea/${name}/main.md`)).toBe(true);

    await page.goto('/tools?add=idea');
    await fillAddForm(page, name, 'First try');
    await page.getByTestId('tools-add-submit').click();
    await expect(page.getByTestId('tools-exit-code')).toHaveText(/^exit [1-9]\d*$/);
    await expect(page.getByTestId('tools-stderr')).toContainText('already exists');
    await expect(page.getByTestId('tools-add-opening')).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/tools\?add=idea$/);
  });

  test('an entry that never gets listed keeps the result panel and explains', async ({ page }) => {
    const name = uniqueName('e2e-idea');
    // The built-server case: the snapshot never lists the new entry.
    await page.route('**/api/entries?dataset=idea', (route) =>
      route.fulfill({ json: { entries: [] } }),
    );
    await page.goto('/tools?add=idea');
    await fillAddForm(page, name);
    await page.getByTestId('tools-add-submit').click();
    await expect(page.getByTestId('tools-add-path')).toHaveText(`idea/${name}/main.md`);
    await expect(page.getByTestId('tools-add-follow-timeout')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('tools-add-opening')).toHaveCount(0);
    await expect(page.getByTestId('tools-add-open')).toHaveAttribute('href', `/idea/${name}`);
    await expect(page).toHaveURL(/\/tools\?add=idea$/);
  });

  test('a saved follow resumes after a plain reload; an expired one is dropped', async ({
    page,
  }) => {
    // `kb/ctxman` is a seed entry that is already listed, so the resumed follow navigates at once.
    const run = (followUntil: number) => ({
      status: 'done',
      script: 'add',
      code: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      created: { dataset: 'kb', slug: 'ctxman', path: 'kb/ctxman/main.md', url: '/kb/ctxman' },
      follow: true,
      followUntil,
    });
    await page.goto('/tools');
    await expect(page.getByTestId('tools-add')).toBeVisible();
    await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [
      RUN_KEY,
      JSON.stringify(run(Date.now() - 1000)),
    ] as const);
    await page.reload();
    await expect(page.getByTestId('tools-add-path')).toHaveText('kb/ctxman/main.md');
    await expect(page.getByTestId('tools-add-opening')).toHaveCount(0);
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/tools$/);

    await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [
      RUN_KEY,
      JSON.stringify(run(Date.now() + 60_000)),
    ] as const);
    await page.reload();
    await expect(page).toHaveURL(/\/kb\/ctxman$/, { timeout: 15_000 });
  });
});
