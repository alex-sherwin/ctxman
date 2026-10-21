// What a ListTable row does in place, without opening the entry: the state select (a change saves and reloads the
// list) and the icon buttons of the actions column (Log time on time-tracked datasets, Delete…; the delete flow
// itself is in delete.spec.ts). Every test creates its own e2e-* task through the API and removes it after.
import { readFileSync, rmSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import type { APIRequestContext, Page } from '@playwright/test';
import { API, afterApi, afterReload, dataPath, uniqueName } from './helpers.ts';

const created: string[] = [];

async function createTask(request: APIRequestContext, prefix: string): Promise<string> {
  const name = uniqueName(prefix);
  const response = await request.post(`${API}/entry/task`, {
    data: { name, title: `E2E row ${name}`, description: 'Created by the list row actions spec.' },
  });
  expect(response.status()).toBe(201);
  created.push(name);
  return name;
}

test.afterAll(() => {
  for (const name of created) rmSync(dataPath(`task/${name}`), { recursive: true, force: true });
});

const rowOf = (page: Page, slug: string) =>
  page.locator(`[data-testid="list-row"][data-slug="${slug}"]`);

test('changing the state in a row saves it and reloads the list; the entry never opens', async ({
  page,
  request,
}) => {
  const name = await createTask(request, 'e2e-row-state');
  await page.goto('/task?sort=name');
  const select = rowOf(page, name).getByTestId('state-select');
  await expect(select).toHaveValue('pending');
  // Picking an option makes the browser fire a click on the select without a pointer press (detail 0), and Enter /
  // Space reach the row too: none of them may press the row link.
  await select.dispatchEvent('click');
  await select.focus();
  await page.keyboard.press('Enter');
  await afterReload(page, () => select.selectOption('in-progress'));
  await expect(page).toHaveURL(/\/task\?sort=name$/);
  await expect(rowOf(page, name).getByTestId('state-select')).toHaveValue('in-progress');
  expect(readFileSync(dataPath(`task/${name}/index.md`), 'utf8')).toContain('state: in-progress');
});

test('Log time opens a focused duration field; Enter appends it and the list says what was logged', async ({
  page,
  request,
}) => {
  const name = await createTask(request, 'e2e-row-time');
  await page.goto('/task?sort=name');
  const row = rowOf(page, name);
  await row.getByTestId('row-log-time').click();
  const dialog = page.getByTestId('log-time-dialog');
  await expect(dialog).toContainText(`Log time on “E2E row ${name}”`);
  const input = page.getByTestId('log-time-input');
  await expect(input).toBeFocused();

  // not a duration: the problem shows, nothing is sent and the dialog stays
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH') writes.push(r.url());
  });
  await page.keyboard.type('45 minutes');
  await page.keyboard.press('Enter');
  await expect(dialog).toContainText('Not an ISO 8601 duration');
  await expect(input).toHaveValue('45 minutes');
  expect(writes).toEqual([]);

  await input.fill('pt45m');
  let response;
  await afterReload(page, async () => {
    response = await afterApi(page, 'PATCH', `${API}/entry/task/${name}`, () =>
      input.press('Enter'),
    );
  });
  expect(response!.status()).toBe(200);
  expect(response!.request().postDataJSON()).toEqual({ addTime: ['PT45M'] });
  await expect(page).toHaveURL(/\/task\?sort=name$/);
  await expect(page.getByTestId('list-flash')).toHaveText(
    `Logged PT45M on “E2E row ${name}” (total 45m)`,
  );
  expect(readFileSync(dataPath(`task/${name}/index.md`), 'utf8')).toContain('\ntime: [PT45M]\n');

  // a second entry adds to the list; Add works like Enter
  await rowOf(page, name).getByTestId('row-log-time').click();
  await page.getByTestId('log-time-input').fill('PT1H');
  await afterReload(page, () => page.getByTestId('log-time-submit').click());
  await expect(page.getByTestId('list-flash')).toHaveText(
    `Logged PT1H on “E2E row ${name}” (total 1h 45m)`,
  );
  expect(readFileSync(dataPath(`task/${name}/index.md`), 'utf8')).toContain(
    '\ntime: [PT45M, PT1H]\n',
  );

  // the message is shown once
  await page.reload();
  await expect(page.getByTestId('list-results')).toBeVisible();
  await expect(page.getByTestId('list-flash')).toHaveCount(0);
});

test('Cancel and Escape close Log time without a request', async ({ page, request }) => {
  const name = await createTask(request, 'e2e-row-cancel');
  await page.goto('/task');
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH') writes.push(r.url());
  });
  await rowOf(page, name).getByTestId('row-log-time').click();
  await page.getByTestId('log-time-input').fill('PT1H');
  await page.getByTestId('log-time-cancel').click();
  await expect(page.getByTestId('log-time-dialog')).toHaveCount(0);
  await rowOf(page, name).getByTestId('row-log-time').click();
  await expect(page.getByTestId('log-time-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('log-time-dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/task$/);
  expect(writes).toEqual([]);
});

test('rows without time tracking have only Delete', async ({ page }) => {
  await page.goto('/kb');
  const row = rowOf(page, 'ctxman');
  await expect(row.getByTestId('row-delete')).toBeVisible();
  await expect(row.getByTestId('row-log-time')).toHaveCount(0);
  await page.goto('/reference');
  await expect(page.getByTestId('row-delete').first()).toBeVisible();
  await expect(page.getByTestId('row-log-time')).toHaveCount(0);
});
