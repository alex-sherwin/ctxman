// The ListTable island of the dataset list pages (src/ui/list): header sorting through the URL (`sort` / `dir`),
// resizable columns, the Columns menu (hide / density / reset) and the column menus, with the layout kept per
// dataset in localStorage (`ctxman:table:<ds>`) and the last chosen sort in a cookie (`ctxman-sort-<ds>`); every test
// gets a fresh browser context, so none is stored.
// Read-only: nothing here writes data. Relies on the 4 seed tasks.
import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { chipOf, expectOrder } from './helpers.ts';

const ALPHABETICAL = [
  'forge-e2e-coverage',
  'seed-sample-data',
  'windows-smoke-test',
  'write-agents-md',
];
const ROWS = '[data-testid="list-row"]';
const HEADERS = '[data-testid="list-results"] thead th';

/** Waits for the client-only island to mount (it renders interactive from the start). */
async function mounted(page: Page): Promise<void> {
  await expect(page.getByTestId('list-results')).toBeVisible();
}

async function openList(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await mounted(page);
}

/** Header cell of a column (react-aria puts the column id in `data-key`). */
const header = (page: Page, column: string) => page.locator(`thead th[data-key="${column}"]`);

async function widthOf(page: Page, column: string): Promise<number> {
  return header(page, column).evaluate((th) => Math.round(th.getBoundingClientRect().width));
}

/** Resolves once the header cell of `column` is `px` wide. */
async function expectWidth(page: Page, column: string, px: number): Promise<void> {
  await page.waitForFunction(
    ([key, want]) => {
      const th = document.querySelector(`thead th[data-key="${key}"]`);
      return th !== null && Math.round(th.getBoundingClientRect().width) === want;
    },
    [column, px] as const,
  );
}

test('a header press sorts through the URL, a second press flips it, filters keep it', async ({
  page,
}) => {
  await openList(page, '/task');
  await expect(header(page, 'modified')).toHaveAttribute('aria-sort', 'descending');

  await header(page, 'entry').click();
  await expect(page).toHaveURL(/\/task\?sort=name$/);
  await mounted(page);
  await expectOrder(page, ROWS, 'data-slug', ALPHABETICAL);
  await expect(header(page, 'entry')).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByTestId('list-sort')).toHaveValue('name');

  await header(page, 'entry').click();
  await expect(page).toHaveURL(/\/task\?sort=name&dir=desc$/);
  await mounted(page);
  await expectOrder(page, ROWS, 'data-slug', [...ALPHABETICAL].reverse());
  await expect(header(page, 'entry')).toHaveAttribute('aria-sort', 'descending');

  // a filter chip keeps the direction; another sort from the select starts in its own direction
  await chipOf(page, 'list-chip-state-complete').click();
  await expect(page).toHaveURL(/sort=name&dir=desc&state=complete$/);
  await page.getByTestId('list-sort').selectOption('state');
  await expect(page).toHaveURL(/\/task\?sort=state&state=complete$/);
});

test('a list opened without a sort comes back in the last one chosen, per dataset', async ({
  page,
}) => {
  await openList(page, '/task');
  await header(page, 'entry').click();
  await expect(page).toHaveURL(/\/task\?sort=name$/);
  await header(page, 'entry').click();
  await expect(page).toHaveURL(/\/task\?sort=name&dir=desc$/);

  // a bare list URL (the header nav, Clear, a project's children) is sent to the remembered sort; filters stay
  await openList(page, '/task');
  await expect(page).toHaveURL(/\/task\?sort=name&dir=desc$/);
  await expectOrder(page, ROWS, 'data-slug', [...ALPHABETICAL].reverse());
  await openList(page, '/task?state=complete');
  await expect(page).toHaveURL(/\/task\?state=complete&sort=name&dir=desc$/);
  // a URL that names a sort wins; another list keeps its own (none yet)
  await openList(page, '/task?sort=state');
  await expect(page).toHaveURL(/\/task\?sort=state$/);
  await openList(page, '/bug');
  await expect(page).toHaveURL(/\/bug$/);

  // only filters count for Clear, and it keeps the sort
  await openList(page, '/task?state=complete&sort=name&dir=desc');
  await expect(page.getByTestId('list-filter-clear')).toHaveAttribute(
    'href',
    '/task?sort=name&dir=desc',
  );
  await openList(page, '/task?sort=name');
  await expect(page.getByTestId('list-filter-clear')).toHaveCount(0);

  // choosing the default sort (here from the Sort select) forgets it
  await page.getByTestId('list-sort').selectOption('modified');
  await expect(page).toHaveURL(/\/task$/);
  await mounted(page);
  await expect(header(page, 'modified')).toHaveAttribute('aria-sort', 'descending');
  await openList(page, '/task');
  await expect(page).toHaveURL(/\/task$/);
});

test('a column resizes by its edge and keeps its width after a reload', async ({ page }) => {
  await openList(page, '/task');
  const before = await widthOf(page, 'entry');
  const box = await header(page, 'entry').locator('.ck-table__resizer').boundingBox();
  if (box === null) throw new Error('no resize handle');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expectWidth(page, 'entry', before + 80);
  expect(await page.evaluate(() => localStorage.getItem('ctxman:table:task'))).toContain(
    `"entry":${before + 80}`,
  );

  await page.reload();
  await mounted(page);
  await expectWidth(page, 'entry', before + 80);
  // another list keeps its own layout
  await openList(page, '/bug');
  await expectWidth(page, 'entry', before);
});

test('the Columns menu hides columns and sets the density; both survive a reload until reset', async ({
  page,
}) => {
  await openList(page, '/task');
  await page.getByTestId('list-layout').click();
  await page.getByTestId('list-layout-col-tags').click();
  // the menu stays open for more toggles
  await expect(page.getByTestId('list-layout-col-tags')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('list-layout-density-compact').click();
  await expectOrder(page, HEADERS, 'data-key', ['entry', 'desc', 'state', 'modified', 'actions']);
  await expect(page.locator('table.ck-table--compact')).toHaveCount(1);

  await page.reload();
  await mounted(page);
  await expectOrder(page, HEADERS, 'data-key', ['entry', 'desc', 'state', 'modified', 'actions']);
  await expect(page.locator('table.ck-table--compact')).toHaveCount(1);

  await page.getByTestId('list-layout').click();
  await page.getByTestId('list-layout-reset').click();
  await expectOrder(page, HEADERS, 'data-key', [
    'entry',
    'desc',
    'state',
    'tags',
    'modified',
    'actions',
  ]);
  await expect(page.locator('table.ck-table--compact')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('ctxman:table:task'))).toBeNull();
});

test('a column menu hides its column and sorts either way', async ({ page }) => {
  await openList(page, '/task');
  await header(page, 'desc').hover();
  await page.getByTestId('list-colmenu-desc').click();
  await page.getByRole('menuitem', { name: 'Hide column' }).click();
  await expectOrder(page, HEADERS, 'data-key', ['entry', 'state', 'tags', 'modified', 'actions']);

  await header(page, 'entry').hover();
  await page.getByTestId('list-colmenu-entry').click();
  // Entry is the row header: it can be sorted and resized but never hidden
  await expect(page.getByRole('menuitem', { name: 'Sort descending' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Hide column' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Sort descending' }).click();
  await expect(page).toHaveURL(/\/task\?sort=name&dir=desc$/);
  await mounted(page);
  await expectOrder(page, ROWS, 'data-slug', [...ALPHABETICAL].reverse());
});

test('keyboard: the arrow keys move between rows and Enter opens one', async ({ page }) => {
  await openList(page, '/task?sort=name');
  await page.getByTestId('list-layout').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(`${ROWS}[data-slug="forge-e2e-coverage"]`)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`${ROWS}[data-slug="seed-sample-data"]`)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/task\/seed-sample-data$/);
});

test('the page ships its rows as JSON and renders no table on the server', async ({
  page,
  request,
}) => {
  const html = await (await request.get('/task')).text();
  expect(html).toContain('<script type="application/json" id="ctxman-list-data">');
  expect(html).not.toContain('data-testid="list-row"');

  await openList(page, '/task');
  await expect(page.locator(ROWS)).toHaveCount(4);
  await expect(
    page.locator(`${ROWS}[data-slug="write-agents-md"] a.ck-entryline__title`),
  ).toHaveAttribute('href', '/task/write-agents-md');
});
