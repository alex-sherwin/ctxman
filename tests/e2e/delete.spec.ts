// Deleting entries: the list row menu (okf), the detail page menu (yaml datasets), the confirm dialog (Cancel, a
// failed delete) and DELETE /api/entry/<ds>/<slug>. Every case creates its own e2e-* entry through the API.
import { expect, test } from './fixtures.ts';
import type { APIRequestContext, Page } from '@playwright/test';
import { API, afterApi, afterReload, dataExists, uniqueName, waitForApi } from './helpers.ts';

async function createTask(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.post(`${API}/entry/task`, {
    data: { name, title: `E2E delete ${name}`, description: 'Created by the delete spec.' },
  });
  expect(response.status()).toBe(201);
}

async function createReference(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.post(`${API}/reference`, {
    data: {
      name,
      description: 'Created by the delete spec.',
      type: 'remote-repo',
      uri: 'https://github.com/example/repo.git',
      owner: 'not-me',
    },
  });
  expect(response.status()).toBe(201);
}

async function createContext(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.post(`${API}/context`, {
    data: {
      name,
      description: 'Created by the delete spec.',
      links: [{ dataset: 'kb', slug: 'ctxman' }],
    },
  });
  expect(response.status()).toBe(201);
}

/** Opens the menu of the element under `scope` (a page or a row) and chooses Delete…; the dialog is open after. */
async function chooseDelete(page: Page, scope: Pick<Page, 'getByTestId'>): Promise<void> {
  await scope.getByTestId('entry-menu').click();
  await page.getByTestId('entry-menu-delete').click();
  await expect(page.getByTestId('entry-delete-dialog')).toBeVisible();
}

test('the list row menu deletes a task and the list reloads without it', async ({
  page,
  request,
}) => {
  const name = uniqueName('e2e-del-row');
  await createTask(request, name);
  await page.goto('/task');
  const row = page.locator(`[data-testid="list-row"][data-slug="${name}"]`);
  await expect(row).toHaveCount(1);
  await chooseDelete(page, row);
  const dialog = page.getByTestId('entry-delete-dialog');
  await expect(dialog).toContainText(`Delete task “E2E delete ${name}”?`);
  await expect(dialog).toContainText(
    `This removes the whole folder task/${name} and every file in it.`,
  );

  let response;
  await afterReload(page, async () => {
    response = await afterApi(page, 'DELETE', `${API}/entry/task/${name}`, () =>
      dialog.getByRole('button', { name: 'Delete' }).click(),
    );
  });
  expect(response!.status()).toBe(204);
  await expect(page.getByTestId('list-results')).toBeVisible();
  await expect(page.locator(`[data-testid="list-row"][data-slug="${name}"]`)).toHaveCount(0);
  const list = await request.get(`${API}/entries?dataset=task`);
  expect(JSON.stringify(await list.json())).not.toContain(name);
  expect(dataExists(`task/${name}`)).toBe(false);
});

test('the detail menu deletes a reference and goes back to the list', async ({ page, request }) => {
  const name = uniqueName('e2e-del-ref');
  await createReference(request, name);
  await page.goto(`/reference/${name}`);
  await chooseDelete(page, page.getByTestId('detail-menu-slot'));
  const dialog = page.getByTestId('entry-delete-dialog');
  await expect(dialog).toContainText(`This removes reference/${name}.yaml.`);
  const response = waitForApi(page, 'DELETE', `${API}/reference/${name}`);
  await dialog.getByRole('button', { name: 'Delete' }).click();
  expect((await response).status()).toBe(204);
  await page.waitForURL('**/reference');
  expect(new URL(page.url()).pathname).toBe('/reference');
  expect((await request.get(`/reference/${name}`)).status()).toBe(404);
  expect(dataExists(`reference/${name}.yaml`)).toBe(false);
});

test('the detail menu deletes a context', async ({ page, request }) => {
  const name = uniqueName('e2e-del-ctx');
  await createContext(request, name);
  await page.goto(`/context/${name}`);
  await chooseDelete(page, page.getByTestId('detail-menu-slot'));
  const response = waitForApi(page, 'DELETE', `${API}/context/${name}`);
  await page.getByTestId('entry-delete-dialog').getByRole('button', { name: 'Delete' }).click();
  expect((await response).status()).toBe(204);
  await page.waitForURL('**/context');
  expect((await request.get(`/context/${name}`)).status()).toBe(404);
});

test('the detail menu deletes an okf entry', async ({ page, request }) => {
  const name = uniqueName('e2e-del-det');
  await createTask(request, name);
  await page.goto(`/task/${name}`);
  await chooseDelete(page, page.getByTestId('detail-menu-slot'));
  const response = waitForApi(page, 'DELETE', `${API}/entry/task/${name}`);
  await page.getByTestId('entry-delete-dialog').getByRole('button', { name: 'Delete' }).click();
  expect((await response).status()).toBe(204);
  await page.waitForURL('**/task');
  expect((await request.get(`/task/${name}`)).status()).toBe(404);
});

test('Cancel keeps the entry', async ({ page, request }) => {
  const name = uniqueName('e2e-del-cancel');
  await createTask(request, name);
  await page.goto(`/task/${name}`);
  await chooseDelete(page, page.getByTestId('detail-menu-slot'));
  await page.getByTestId('entry-delete-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('entry-delete-dialog')).toHaveCount(0);
  expect((await request.get(`${API}/entry/task/${name}`)).status()).toBe(200);
  expect(dataExists(`task/${name}`)).toBe(true);
  await request.delete(`${API}/entry/task/${name}`);
});

test('a failed delete shows the error and keeps the dialog open', async ({ page, request }) => {
  const name = uniqueName('e2e-del-fail');
  await createTask(request, name);
  await page.route(`**${API}/entry/task/${name}`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'not-found', message: 'task entry is already gone' }),
        })
      : route.continue(),
  );
  await page.goto(`/task/${name}`);
  await chooseDelete(page, page.getByTestId('detail-menu-slot'));
  const dialog = page.getByTestId('entry-delete-dialog');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('entry-delete-error')).toHaveText('task entry is already gone');
  await expect(dialog).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/task/${name}`);
  await page.unroute(`**${API}/entry/task/${name}`);
  expect((await request.delete(`${API}/entry/task/${name}`)).status()).toBe(204);
});

test('DELETE /api/entry: 204 then 404, 400 for a bad slug or dataset, 403 for a foreign origin', async ({
  request,
}) => {
  const name = uniqueName('e2e-del-api');
  await createTask(request, name);

  const foreign = await request.delete(`${API}/entry/task/${name}`, {
    headers: { origin: 'http://evil.test' },
  });
  expect(foreign.status()).toBe(403);
  expect(dataExists(`task/${name}`)).toBe(true);

  const missing = await request.delete(`${API}/entry/task/e2e-del-missing`);
  expect(missing.status()).toBe(404);
  expect(((await missing.json()) as { error: string }).error).toBe('not-found');

  const bad = await request.delete(`${API}/entry/task/not%20valid`);
  expect(bad.status()).toBe(400);
  expect(((await bad.json()) as { error: string }).error).toBe('bad-slug');

  const badDataset = await request.delete(`${API}/entry/reference/${name}`);
  expect(badDataset.status()).toBe(400);
  expect(((await badDataset.json()) as { error: string }).error).toBe('bad-dataset');

  const ok = await request.delete(`${API}/entry/task/${name}`);
  expect(ok.status()).toBe(204);
  expect(dataExists(`task/${name}`)).toBe(false);
  expect((await request.delete(`${API}/entry/task/${name}`)).status()).toBe(404);
});

test('Delete is disabled while the doc editor is open', async ({ page, request }) => {
  const name = uniqueName('e2e-del-edit');
  await createTask(request, name);
  await page.goto(`/task/${name}?edit=1`);
  await expect(page.getByTestId('doc-editor').locator('.monaco-editor')).toBeVisible();
  await page.getByTestId('detail-menu-slot').getByTestId('entry-menu').click();
  const item = page.getByTestId('entry-menu-delete');
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item.getByTitle('Leave the editor first')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await request.delete(`${API}/entry/task/${name}`);
});
