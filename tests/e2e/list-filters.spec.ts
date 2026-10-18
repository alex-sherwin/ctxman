// Dataset list filters: chips, text, sort and clear all live in the URL (UI_SPEC §E). The filter form is
// a plain GET form enhanced by a script: every chip / sort change is a real navigation, so history works.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { API, afterReload, chipOf, dataPath, uniqueName } from './helpers.ts';

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

test.describe('state select and invalid files (own e2e tasks)', () => {
  // Serial: the tests chain on one e2e task (pending -> in-progress -> complete) and a broken one repaired in the last test.
  test.describe.configure({ mode: 'serial' });
  const pending = uniqueName('e2e-lf-pending');
  const broken = uniqueName('e2e-lf-broken');

  test.beforeAll(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    try {
      for (const [name, title] of [
        [pending, 'E2E list filter pending'],
        [broken, 'E2E list filter broken'],
      ] as const) {
        const created = await request.post(`${API}/entry/task`, {
          data: {
            name,
            title,
            description: 'Created by the list-filters spec.',
            state: 'pending',
          },
        });
        expect(created.status()).toBe(201);
      }
    } finally {
      await request.dispose();
    }
    // an invalid file: `done` is not a task state (written by hand, like a mistake in an editor)
    const file = dataPath(`task/${broken}/index.md`);
    writeFileSync(file, readFileSync(file, 'utf8').replace('state: pending', 'state: done'));
  });

  test.afterAll(() => {
    for (const name of [pending, broken]) {
      rmSync(dataPath(`task/${name}`), { recursive: true, force: true });
    }
  });

  test('a list row state select PATCHes the state and keeps ?state= and ?sort=', async ({
    page,
  }) => {
    await page.goto('/task?state=pending&sort=name');
    const row = page.locator(`[data-testid="list-row"][data-slug="${pending}"]`);
    const select = row.getByTestId('state-select');
    await expect(select).toHaveValue('pending');
    // the page reloads itself after the saved state: the filter no longer matches the task
    await afterReload(page, () => select.selectOption('in-progress'));
    await expect(row).toHaveCount(0);
    await expect(page).toHaveURL(/\/task\?state=pending&sort=name$/);
    await expect(page.getByTestId('list-chip-state-pending')).toBeChecked();
    expect(readFileSync(dataPath(`task/${pending}/index.md`), 'utf8')).toContain(
      'state: in-progress',
    );

    await page.goto('/task?state=in-progress');
    await expect(
      page.locator(`[data-testid="list-row"][data-slug="${pending}"]`).getByTestId('state-select'),
    ).toHaveValue('in-progress');
  });

  test('the detail header select changes the state; the Details panel follows after the reload', async ({
    page,
  }) => {
    await page.goto(`/task/${pending}`);
    await expect(page.getByTestId('state-select')).toHaveValue('in-progress');
    // the island shows the saved message when it mounts: change the state after that, like a user would
    await expect(page.getByTestId('meta-edit')).toBeEnabled();
    await afterReload(page, () => page.getByTestId('state-select').selectOption('complete'));
    await expect(page.getByTestId('detail-meta').locator('.ck-badge--state')).toHaveText(
      'Complete',
    );
    await expect(page.getByTestId('state-select')).toHaveValue('complete');
    await expect(page.getByTestId('entry-status')).toHaveText('State set to Complete');
  });

  test('a rejected state change goes back to the old value and shows the message', async ({
    page,
  }) => {
    await page.goto(`/task/${pending}`);
    await page.route(`**/api/entry/task/${pending}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'conflict', message: 'Changed on disk' }),
          })
        : route.continue(),
    );
    await page.getByTestId('state-select').selectOption('pending');
    await expect(page.getByTestId('state-select-status')).toHaveText('Changed on disk');
    await expect(page.getByTestId('state-select-status')).toHaveAttribute('data-kind', 'error');
    await expect(page.getByTestId('state-select')).toHaveValue('complete');
    await expect(page.getByTestId('state-select')).toBeEnabled();
  });

  test('an invalid file is flagged in the list, on the dashboard and on its page, and can be repaired', async ({
    page,
  }) => {
    await page.goto('/task');
    const row = page.locator(`[data-testid="list-row"][data-slug="${broken}"]`);
    await expect(row.getByTestId('invalid-badge')).toBeVisible();
    await expect(row.getByTestId('invalid-badge')).toHaveAttribute('title', /state/);
    await expect(row.getByTestId('state-select').locator('option:checked')).toHaveText(
      'done (invalid)',
    );
    // the healthy rows carry no badge
    await expect(
      page.locator(`[data-testid="list-row"][data-slug="${pending}"]`).getByTestId('invalid-badge'),
    ).toHaveCount(0);

    await page.goto('/');
    await expect(page.getByTestId('dashboard-invalid')).toContainText('E2E list filter broken');

    await page.goto(`/task/${broken}`);
    const banner = page.getByTestId('invalid-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("This entry's file is invalid");
    await expect(banner).toContainText('state');
    await expect(page.getByTestId('invalid-fix')).toHaveAttribute('href', `/task/${broken}?edit=1`);
    await expect(page.getByTestId('state-select').locator('option:checked')).toHaveText(
      'done (invalid)',
    );

    // choosing a real state repairs the file
    await afterReload(page, () => page.getByTestId('state-select').selectOption('pending'));
    await expect(page.getByTestId('invalid-banner')).toHaveCount(0);
    await expect(page.getByTestId('state-select')).toHaveValue('pending');
    expect(readFileSync(dataPath(`task/${broken}/index.md`), 'utf8')).toContain('state: pending');
  });
});
