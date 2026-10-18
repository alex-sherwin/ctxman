// Every page renders with its main test ids; unknown routes are 404 (PLAN §J.2 smoke).
import { expect, test } from '@playwright/test';
import { E2E_DATA_DIR } from './helpers.ts';

const DATASETS = [
  'kb',
  'rca',
  'idea',
  'task',
  'bug',
  'feature',
  'project',
  'skill',
  'reference',
  'context',
  'recipe',
] as const;

test('dashboard renders the shell and dataset navigation', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId('app-header')).toBeVisible();
  const nav = page.getByTestId('primary-nav');
  for (const ds of DATASETS) await expect(nav.getByTestId(`nav-${ds}`)).toHaveCount(1);
  await expect(nav.getByTestId('nav-forge')).toHaveCount(1);
  await expect(nav.getByTestId('nav-inflate')).toHaveCount(1);
  await expect(nav.getByTestId('nav-tools')).toHaveCount(1);
  await expect(page.getByTestId('dashboard-cards')).toBeVisible();
  await expect(page.getByTestId('footer-data-dir')).toHaveText(E2E_DATA_DIR);
});

for (const ds of DATASETS) {
  test(`/${ds} list page returns 200 with its filter form`, async ({ page }) => {
    const response = await page.goto(`/${ds}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('list-filter-form')).toBeVisible();
    await expect(page.getByTestId('list-result-count')).toBeVisible();
  });
}

const DETAIL_ROUTES = [
  { path: '/kb/ctxman', testId: 'detail-content' },
  { path: '/kb/ctxman/doc/concepts/datasets', testId: 'detail-content' },
  { path: '/context/ctxman-dev', testId: 'context-links' },
  { path: '/recipe/ctxman-dev-brief', testId: 'recipe-composition' },
  { path: '/skill/okf-authoring', testId: 'detail-files' },
  { path: '/reference/astro-docs', testId: 'reference-fields' },
  { path: '/task/write-agents-md', testId: 'detail-content' },
  { path: '/project/ctxman-v1', testId: 'children-panel' },
] as const;

for (const route of DETAIL_ROUTES) {
  test(`${route.path} detail page returns 200 with its main panels`, async ({ page }) => {
    const response = await page.goto(route.path);
    expect(response?.status()).toBe(200);
    // The page title is the first h1; the markdown body of a bundle may contain its own h1 too.
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.getByTestId(route.testId)).toBeVisible();
    await expect(page.getByTestId('detail-aside')).toBeVisible();
  });
}

// okf + skill pages mount the DocEditor toolbar and the Open in IDE button next to the SSR preview.
for (const route of ['/kb/ctxman', '/kb/ctxman/doc/concepts/datasets', '/skill/okf-authoring']) {
  test(`${route} mounts the doc toolbar and Open in IDE`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByTestId('doc-tools')).toBeVisible();
    await expect(page.getByTestId('detail-open-ide')).toBeVisible();
  });
}

// yaml datasets keep the DataForm island (D6): reference, context and recipe.
for (const ds of ['reference', 'context', 'recipe']) {
  test(`/new/${ds} returns 200 and mounts the DataForm island`, async ({ page }) => {
    const response = await page.goto(`/new/${ds}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('dform')).toBeVisible();
    await expect(page.getByTestId('dform-field-name')).toBeVisible();
  });
}

// okf + skill: the create form of round 3 (NewEntryForm island).
for (const ds of ['task', 'skill']) {
  test(`/new/${ds} returns 200 and mounts the NewEntryForm island`, async ({ page }) => {
    const response = await page.goto(`/new/${ds}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('new-entry-form')).toBeVisible();
    await expect(page.getByTestId('new-name')).toBeVisible();
  });
}

test('/<ds>/<slug>?edit=1 mounts the DataForm instead of the SSR view for yaml datasets', async ({
  page,
}) => {
  const response = await page.goto('/reference/astro-docs?edit=1');
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId('dform')).toHaveAttribute('data-mode', 'edit');
  await expect(page.getByTestId('reference-fields')).toHaveCount(0);
  await expect(page.getByTestId('detail-aside')).toBeVisible();
});

test('/forge returns 200 and mounts the Forge island', async ({ page }) => {
  const response = await page.goto('/forge');
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId('forge')).toBeVisible();
  await expect(page.getByTestId('forge-discover')).toBeVisible();
  await expect(page.getByTestId('forge-context')).toBeVisible();
});

test('/inflate returns 200 and mounts the Inflate island', async ({ page }) => {
  const response = await page.goto('/inflate');
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId('inflate')).toBeVisible();
  await expect(page.getByTestId('inflate-recipe-select')).toBeVisible();
  await expect(page.getByTestId('inflate-empty-new')).toBeVisible();
});

test('/tools returns 200 and mounts the Tools island', async ({ page }) => {
  const response = await page.goto('/tools');
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId('tools')).toBeVisible();
  await expect(page.getByTestId('tools-scripts')).toBeVisible();
  await expect(page.getByTestId('tools-add')).toBeVisible();
});

test('unknown routes are 404', async ({ page }) => {
  const nope = await page.goto('/nope');
  expect(nope?.status()).toBe(404);
  await expect(page.getByTestId('notfound-path')).toHaveText('/nope');

  const kbNope = await page.goto('/kb/nope');
  expect(kbNope?.status()).toBe(404);
});

test('the 404 page shows the requested path without a trailing slash', async ({ page }) => {
  await page.goto('/nope');
  await expect(page.getByTestId('notfound-path')).toHaveText('/nope');
});
