// Dataset list filters: chips, text, sort and clear all live in the URL (UI_SPEC §E). The filter form is
// a plain GET form enhanced by a script: every chip / sort change is a real navigation, so history works.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { chipOf } from './helpers.ts';

/** `data-slug` of every rendered row, in display order. */
async function rowSlugs(page: Page): Promise<string[]> {
  return page
    .getByTestId('list-row')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.slug ?? ''));
}

test.describe('task list filters', () => {
  test('state chips update the URL and the rows', async ({ page }) => {
    await page.goto('/task');
    await expect(page.getByTestId('list-row')).toHaveCount(4);

    await chipOf(page, 'list-chip-state-pending').click();
    await expect(page).toHaveURL(/[?&]state=pending(&|$)/);
    await expect(page).not.toHaveURL(/complete/);
    await expect(page.getByTestId('list-row')).toHaveCount(1);
    await expect(page.getByTestId('list-chip-state-pending')).toBeChecked();

    await chipOf(page, 'list-chip-state-complete').click();
    await expect(page).toHaveURL(/[?&]state=pending&state=complete(&|$)/);
    await expect(page.getByTestId('list-row')).toHaveCount(3);
    expect((await rowSlugs(page)).sort()).toEqual([
      'forge-e2e-coverage',
      'seed-sample-data',
      'write-agents-md',
    ]);
  });

  test('a reload keeps the chips and the rows', async ({ page }) => {
    await page.goto('/task?state=pending&state=complete');
    await expect(page.getByTestId('list-row')).toHaveCount(3);
    await page.reload();
    await expect(page.getByTestId('list-row')).toHaveCount(3);
    await expect(page.getByTestId('list-chip-state-pending')).toBeChecked();
    await expect(page.getByTestId('list-chip-state-complete')).toBeChecked();
    await expect(page.getByTestId('list-chip-state-in-progress')).not.toBeChecked();
  });

  test('back and forward restore the previous filter state', async ({ page }) => {
    await page.goto('/task');
    await chipOf(page, 'list-chip-state-pending').click();
    await expect(page.getByTestId('list-row')).toHaveCount(1);
    await chipOf(page, 'list-chip-state-complete').click();
    await expect(page.getByTestId('list-row')).toHaveCount(3);

    await page.goBack();
    await expect(page).toHaveURL(/[?&]state=pending(&|$)/);
    await expect(page).not.toHaveURL(/complete/);
    await expect(page.getByTestId('list-row')).toHaveCount(1);

    await page.goBack();
    await expect(page).toHaveURL(/\/task\/?$/);
    await expect(page.getByTestId('list-row')).toHaveCount(4);

    await page.goForward();
    await expect(page.getByTestId('list-row')).toHaveCount(1);
  });

  test('text filter applies on Enter and clear removes every filter', async ({ page }) => {
    await page.goto('/task');
    const q = page.getByTestId('list-filter-q');
    await q.fill('agents');
    await q.press('Enter');
    await expect(page).toHaveURL(/[?&]q=agents(&|$)/);
    await expect(page.getByTestId('list-row')).toHaveCount(1);
    expect(await rowSlugs(page)).toEqual(['write-agents-md']);
    await expect(page.getByTestId('list-result-count')).toHaveText('1 of 4');

    await page.getByTestId('list-filter-clear').click();
    await expect(page).toHaveURL(/\/task\/?$/);
    await expect(page.getByTestId('list-row')).toHaveCount(4);
    await expect(page.getByTestId('list-filter-q')).toHaveValue('');
  });

  test('sort select writes sort=name and orders rows by name', async ({ page }) => {
    await page.goto('/task');
    await page.getByTestId('list-sort').selectOption('name');
    await expect(page).toHaveURL(/[?&]sort=name(&|$)/);
    await expect(page.getByTestId('list-sort')).toHaveValue('name');
    expect(await rowSlugs(page)).toEqual([
      'forge-e2e-coverage',
      'seed-sample-data',
      'windows-smoke-test',
      'write-agents-md',
    ]);
  });
});

test('reference type radio writes type=remote-repo', async ({ page }) => {
  await page.goto('/reference');
  await expect(page.getByTestId('list-row')).toHaveCount(10);
  await chipOf(page, 'list-chip-type-remote-repo').click();
  await expect(page).toHaveURL(/[?&]type=remote-repo(&|$)/);
  expect((await rowSlugs(page)).sort()).toEqual([
    'astro-docs',
    'blasto',
    'catcom',
    'flexo',
    'gatos',
    'purrtty',
    'unscience',
  ]);
  await expect(page.getByTestId('list-chip-type-remote-repo')).toBeChecked();
});

test('the reference list marks remote-skill entries with a git / archive badge', async ({
  page,
}) => {
  await page.goto('/reference?type=remote-skill');
  expect((await rowSlugs(page)).sort()).toEqual(['anthropic-skills', 'ksa-modding']);
  const badge = (slug: string) =>
    page.locator(`[data-testid="list-row"][data-slug="${slug}"] [data-testid="uri-kind-badge"]`);
  await expect(badge('ksa-modding')).toHaveText('archive');
  await expect(badge('anthropic-skills')).toHaveText('git');
});
