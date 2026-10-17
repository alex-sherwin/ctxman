// Tools page (UI_SPEC §I): run the allowlisted check scripts, scaffold an entry with the add script, and keep the
// last run across the dev server's full reload (okf data writes trigger one).
import { expect, test } from '@playwright/test';
import { dataExists, nextPageLoad, readDataText } from './helpers.ts';

function uniqueName(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
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

  test('creates an idea: result with path and link, file on disk, link opens the entry', async ({
    page,
  }) => {
    const name = uniqueName('e2e-idea');
    await page.goto('/tools?add=idea');
    await expect(page.getByTestId('tools-add-dataset')).toContainText('Ideas');
    await page.getByTestId('tools-add-name').fill(name);
    await page.getByTestId('tools-add-title').fill('E2E idea');
    await page.getByTestId('tools-add-description').fill('Created by the e2e suite');
    const reloaded = nextPageLoad(page);
    await page.getByTestId('tools-add-submit').click();

    await expect(page.getByTestId('tools-add-result')).toBeVisible();
    await expect(page.getByTestId('tools-add-path')).toHaveText(`idea/${name}/main.md`);
    await expect.poll(() => dataExists(`idea/${name}/main.md`)).toBe(true);
    expect(readDataText(`idea/${name}/main.md`)).toContain(`name: ${name}`);

    // The dev server reloads the page after the okf data write; the result is restored from sessionStorage.
    await reloaded;
    await expect(page.getByTestId('tools-add-result')).toBeVisible();
    await expect(page.getByTestId('tools-add-path')).toHaveText(`idea/${name}/main.md`);
    await page.getByTestId('tools-add-open').click();
    await expect(page).toHaveURL(new RegExp(`/idea/${name}$`));
    await expect(page.getByTestId('detail-slug')).toHaveText(name);
    await expect(page.getByTestId('detail-content')).toContainText('Created by the e2e suite');
  });

  test('adding the same name again exits non-zero with "already exists" on stderr', async ({
    page,
  }) => {
    const name = uniqueName('e2e-idea');
    await page.goto('/tools?add=idea');
    await page.getByTestId('tools-add-name').fill(name);
    await page.getByTestId('tools-add-description').fill('First try');
    const reloaded = nextPageLoad(page);
    await page.getByTestId('tools-add-submit').click();
    await expect(page.getByTestId('tools-add-path')).toHaveText(`idea/${name}/main.md`);
    await expect.poll(() => dataExists(`idea/${name}/main.md`)).toBe(true);
    await reloaded;
    // The reload resets the form's own drafts (only the dataset is URL state), so fill it in again.
    await page.getByTestId('tools-add-name').fill(name);
    await page.getByTestId('tools-add-description').fill('First try');
    await page.getByTestId('tools-add-submit').click();
    await expect(page.getByTestId('tools-exit-code')).toHaveText(/^exit [1-9]\d*$/);
    await expect(page.getByTestId('tools-stderr')).toContainText('already exists');
  });
});
