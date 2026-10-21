// `t` = Log time (src/lib/shortcuts.ts): on the entry and document pages of a time-tracked dataset it clicks the
// Details panel's clock button (`meta-log-time`, EntryTools opens the shared LogTimeDialog, the status line says what
// was logged and the page reloads); on a time-tracked list the ListTable answers the `ctxman:log-time-shortcut` event
// for the row with the keyboard focus, else the row under the pointer. Nowhere else, and never while typing, with a
// dialog open or while the doc editor is open. Every test creates its own e2e-* tasks through the API and removes them
// after (deleteEntries: through the server, so list-table.spec.ts never sees them).
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import type { APIRequestContext, Page, Response } from '@playwright/test';
import { API, afterApi, afterReload, dataPath, deleteEntries, uniqueName } from './helpers.ts';

const created: string[] = [];

test.afterEach(async ({ request }) => {
  await deleteEntries(
    request,
    created.splice(0).map((name) => `task/${name}`),
  );
});

/** Creates a task; `prefix` gets a random suffix unless `unique` is false (then it is the whole name). */
async function createTask(
  request: APIRequestContext,
  prefix: string,
  title: string,
  unique = true,
) {
  const name = unique ? uniqueName(prefix) : prefix;
  const response = await request.post(`${API}/entry/task`, {
    data: {
      name,
      title: `${title} ${name}`,
      description: 'Created by the log time shortcut spec.',
    },
  });
  expect(response.status()).toBe(201);
  created.push(name);
  return { name, title: `${title} ${name}` };
}

/** Opens a page once the Shortcuts island listens, with the focus on nothing (keys go to the page). */
async function ready(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('body[data-shortcuts-ready]')).toBeAttached();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/**
 * Proves a `t` press did nothing: `?` right after it opens the help dialog, which it never does while another
 * dialog is open, and by then the `t` press has been handled.
 */
async function expectNoLogTime(page: Page): Promise<void> {
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
  await expect(page.getByTestId('log-time-dialog')).toHaveCount(0);
}

const rowOf = (page: Page, slug: string) =>
  page.locator(`[data-testid="list-row"][data-slug="${slug}"]`);

test('t on a task page opens Log time; Enter logs, the page reloads and the Details panel shows it', async ({
  page,
  request,
}) => {
  const task = await createTask(request, 'e2e-lts-page', 'E2E log page');
  await ready(page, `/task/${task.name}`);
  const button = page.getByTestId('meta-log-time');
  await expect(button).toBeEnabled();
  await expect(button).toHaveAccessibleName('Log time (t)');
  await expect(button).toHaveAttribute('aria-keyshortcuts', 'T');
  // nothing logged yet: the Time row is there for the button
  await expect(page.getByTestId('meta-time')).toHaveCount(0);

  await page.keyboard.press('t');
  const dialog = page.getByTestId('log-time-dialog');
  await expect(dialog).toContainText(`Log time on “${task.title}”`);
  const input = page.getByTestId('log-time-input');
  await expect(input).toBeFocused();
  await input.fill('pt1h30m');
  let response: Response | undefined;
  await afterReload(page, async () => {
    response = await afterApi(page, 'PATCH', `${API}/entry/task/${task.name}`, () =>
      input.press('Enter'),
    );
  });
  expect(response?.status()).toBe(200);
  expect(response?.request().postDataJSON()).toEqual({ addTime: ['PT1H30M'] });
  await expect(page.getByTestId('entry-status')).toHaveText(
    `Logged PT1H30M on “${task.title}” (total 1h 30m)`,
  );
  await expect(page.getByTestId('meta-time')).toContainText('PT1H30M');
  await expect(page.getByTestId('meta-time-total')).toContainText('1h 30m');
  expect(readFileSync(dataPath(`task/${task.name}/index.md`), 'utf8')).toContain(
    '\ntime: [PT1H30M]\n',
  );

  // the button itself opens the same dialog; Escape closes it without a request
  await page.getByTestId('meta-log-time').click();
  await expect(page.getByTestId('log-time-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('log-time-dialog')).toHaveCount(0);
});

test('t on a document page of a task logs time on the entry', async ({ page, request }) => {
  const task = await createTask(request, 'e2e-lts-doc', 'E2E log doc');
  const note = await request.post(`${API}/doc/task/${task.name}/concepts/e2e-note.md`, {
    data: { title: 'E2E note' },
  });
  expect(note.status()).toBe(201);
  await ready(page, `/task/${task.name}/doc/concepts/e2e-note`);
  await expect(page.getByTestId('meta-log-time')).toBeEnabled();
  await expect(page.getByTestId('meta-entry-time')).toHaveText('none logged');

  await page.keyboard.press('t');
  await expect(page.getByTestId('log-time-dialog')).toContainText(`Log time on “${task.title}”`);
  await page.getByTestId('log-time-input').fill('PT45M');
  await afterReload(page, () => page.getByTestId('log-time-submit').click());
  await expect(page).toHaveURL(new RegExp(`/task/${task.name}/doc/concepts/e2e-note$`));
  await expect(page.getByTestId('entry-status')).toHaveText(
    `Logged PT45M on “${task.title}” (total 45m)`,
  );
  await expect(page.getByTestId('meta-entry-time')).toHaveText('45m');
});

test('t on a list logs time on the focused row (keyboard), even with another row hovered', async ({
  page,
  request,
}) => {
  // Both names share one token, so `?q=` lists just these two (by title: A, then B). B's title starts with a T: were
  // the key also the grid's type-to-select, the focus would jump from A to B.
  const token = uniqueName('e2e-lts-kb');
  const a = await createTask(request, `${token}-a`, 'E2E log row A', false);
  const b = await createTask(request, `${token}-b`, 'Tally log row B', false);
  await ready(page, `/task?q=${token}&sort=name`);
  await expect(page.locator('[data-testid="list-row"]')).toHaveCount(2);
  await page.getByTestId('list-layout').focus();
  await page.keyboard.press('Tab');
  await expect(rowOf(page, a.name)).toBeFocused();
  await rowOf(page, b.name).hover();

  await page.keyboard.press('t');
  await expect(page.getByTestId('log-time-dialog')).toContainText(`Log time on “${a.title}”`);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('log-time-dialog')).toHaveCount(0);
  await expect(rowOf(page, a.name)).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(rowOf(page, b.name)).toBeFocused();
  await page.keyboard.press('t');
  await expect(page.getByTestId('log-time-dialog')).toContainText(`Log time on “${b.title}”`);
  await page.getByTestId('log-time-input').fill('PT20M');
  await afterReload(page, () => page.getByTestId('log-time-input').press('Enter'));
  await expect(page.getByTestId('list-flash')).toHaveText(
    `Logged PT20M on “${b.title}” (total 20m)`,
  );
  await expect(rowOf(page, b.name).getByTestId('row-time')).toHaveText('20m');
  await expect(rowOf(page, a.name).getByTestId('row-time')).toHaveCount(0);
});

test('t on a list logs time on the hovered row; with no row hovered or focused it does nothing', async ({
  page,
  request,
}) => {
  const a = await createTask(request, 'e2e-lts-hover', 'E2E log hover');
  await ready(page, '/task?sort=name');
  await expect(rowOf(page, a.name)).toBeVisible();

  // the pointer on the page header, not on a row: nothing
  await page.getByRole('heading', { level: 1 }).hover();
  await page.keyboard.press('t');
  await expectNoLogTime(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);

  await rowOf(page, a.name).hover();
  await page.keyboard.press('t');
  await expect(page.getByTestId('log-time-dialog')).toContainText(`Log time on “${a.title}”`);
  await expect(page.getByTestId('log-time-input')).toBeFocused();
});

test('t does nothing on a list without time tracking and while typing in the list filter', async ({
  page,
  request,
}) => {
  await ready(page, '/kb');
  await rowOf(page, 'ctxman').hover();
  await page.keyboard.press('t');
  await expectNoLogTime(page);

  const a = await createTask(request, 'e2e-lts-typing', 'E2E log typing');
  await ready(page, '/task');
  await rowOf(page, a.name).hover();
  const filter = page.getByTestId('list-filter-q');
  await filter.focus();
  await page.keyboard.press('t');
  await expect(filter).toHaveValue('t');
  await expect(page.getByTestId('log-time-dialog')).toHaveCount(0);
});

test('t does nothing on a task page while the doc editor is open', async ({ page, request }) => {
  const task = await createTask(request, 'e2e-lts-edit', 'E2E log edit');
  await ready(page, `/task/${task.name}?edit=1`);
  await expect(page.getByTestId('doc-editor').locator('.monaco-editor')).toBeVisible({
    timeout: 15_000,
  });
  // EntryTools locks the button while the editor is open, and `t` only clicks an enabled one
  await expect(page.getByTestId('meta-log-time')).toBeDisabled();
  await expect(page.getByTestId('meta-log-time')).toHaveAttribute(
    'title',
    'Leave the editor first',
  );
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('t');
  await expectNoLogTime(page);
});
