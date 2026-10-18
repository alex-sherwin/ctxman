// Tools page (UI_SPEC §I, ROUND3_SPEC §E.7): run the allowlisted check scripts, and the "New entry" panel that picks a
// dataset and links to its create form at /new/<ds> (nothing is created on this page; the forms are covered by
// forms.spec.ts). The `add` script stays allowlisted for the CLI and the API specs.
import { expect, test } from '@playwright/test';

test.describe('checks', () => {
  test('the check scripts are listed with a Run button each', async ({ page }) => {
    await page.goto('/tools');
    await expect(page.getByTestId('tools-scripts')).toBeVisible();
    for (const name of ['check', 'check-okf', 'check-links', 'check-collections']) {
      await expect(page.getByTestId(`tools-script-${name}`)).toBeVisible();
      await expect(page.getByTestId(`tools-run-${name}`)).toBeEnabled();
    }
    // `add` is not a check: entries are created in the forms linked from the New entry panel.
    await expect(page.getByTestId('tools-script-add')).toHaveCount(0);
  });

  test('Run shows the output and an exit code of 0 for the full check', async ({ page }) => {
    await page.goto('/tools');
    await page.getByTestId('tools-run-check').click();
    await expect(page.getByTestId('tools-exit-code')).toHaveText('exit 0');
    await expect(page.getByTestId('tools-stdout')).toContainText('All checks: OK');
  });

  test('the last run survives a page reload', async ({ page }) => {
    await page.goto('/tools');
    await page.getByTestId('tools-run-check-okf').click();
    await expect(page.getByTestId('tools-exit-code')).toHaveText('exit 0');
    await page.reload();
    await expect(page.getByTestId('tools-exit-code')).toHaveText('exit 0');
    await expect(page.getByTestId('tools-script-check-okf')).toContainText('exit 0');
    await page.getByTestId('tools-output-clear').click();
    await expect(page.getByTestId('tools-output-status')).toHaveText('Run a check to see output.');
  });
});

test.describe('new entry panel', () => {
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

  test('there is no create form here: a link to /new/<ds> and the CLI hint instead', async ({
    page,
  }) => {
    await page.goto('/tools?add=task');
    await expect(page.getByTestId('tools-add')).toBeVisible();
    await expect(page.getByTestId('tools-add-form')).toHaveCount(0);
    await expect(page.getByTestId('tools-add-name')).toHaveCount(0);
    await expect(page.getByTestId('tools-add-submit')).toHaveCount(0);
    await expect(page.getByTestId('tools-add-open-form')).toHaveAttribute('href', '/new/task');
    await expect(page.getByTestId('tools-add-open-form')).toContainText('New task form');
    await expect(page.getByTestId('tools-add-cli')).toHaveText('pnpm run add:task <name>');
  });

  test('the link follows the dataset select, for the yaml datasets too', async ({ page }) => {
    await page.goto('/tools?add=task');
    await page.getByTestId('tools-add-dataset').click();
    await page.getByRole('option', { name: /References/ }).click();
    await expect(page.getByTestId('tools-add-open-form')).toHaveAttribute('href', '/new/reference');
    await expect(page.getByTestId('tools-add-open-form')).toContainText('New reference form');
    await expect(page.getByTestId('tools-add-cli')).toHaveText('pnpm run add:reference <name>');
    await expect(page).toHaveURL(/[?&]add=reference(&|$)/);
  });

  test('without a dataset the link is disabled; #add-entry lands on the panel', async ({
    page,
  }) => {
    await page.goto('/tools#add-entry');
    await expect(page.getByTestId('tools-add')).toBeVisible();
    await expect(page.getByTestId('tools-add-open-form')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('tools-add-open-form')).not.toHaveAttribute('href', /.+/);
    await expect(page.getByTestId('tools-add-cli')).toHaveText('pnpm run add:<dataset> <name>');
  });

  test('the link opens the create form of the dataset', async ({ page }) => {
    await page.goto('/tools?add=idea');
    await page.getByTestId('tools-add-open-form').click();
    await expect(page).toHaveURL(/\/new\/idea$/);
    await expect(page.getByTestId('new-entry-form')).toBeVisible();
    await expect(page.getByTestId('new-submit')).toHaveText('Create idea');
  });
});
