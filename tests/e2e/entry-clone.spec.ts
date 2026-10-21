// Cloning an okf bundle from the detail header's ⋯ menu (Clone…, CloneEntryDialog) and POST /api/entry/<ds>/<slug>/clone.
// Every worker builds its own e2e-* source task in beforeAll (entry API, a concept through the doc API, a log.md in the
// worker's data copy) and removes everything it created in afterAll; seed entries are only opened, never written.
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { API, dataExists, dataPath, readDataText, uniqueName, waitForApi } from './helpers.ts';

const LOG = '# Update log\n\n## 2026-10-20\n* **Create**: Created by the clone spec.\n';

/** The source task of this worker and every entry a test created (removed in afterAll). */
let source = '';
const created = new Set<string>();

async function createTask(request: APIRequestContext, name: string, title: string): Promise<void> {
  const response = await request.post(`${API}/entry/task`, {
    data: {
      name,
      title,
      description: 'Created by the clone spec.',
      tags: ['e2e', 'clone'],
      issueKey: 'E2E-1',
    },
  });
  expect(response.status()).toBe(201);
  created.add(name);
}

/** Every file of `task/<name>` (posix, sorted) with its text. */
function bundleFiles(name: string): Record<string, string> {
  const root = dataPath(`task/${name}`);
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const d of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel === '' ? d.name : `${rel}/${d.name}`;
      if (d.isDirectory()) walk(child);
      else out[child] = readDataText(`task/${name}/${child}`);
    }
  };
  walk('');
  return out;
}

async function openCloneDialog(page: Page): Promise<void> {
  await page.getByTestId('detail-menu-slot').getByTestId('entry-menu').click();
  await page.getByTestId('entry-menu-clone').click();
  await expect(page.getByTestId('clone-dialog')).toBeVisible();
  await expect(page.getByTestId('clone-name')).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  source = uniqueName('e2e-clone-src');
  await createTask(request, source, `E2E clone ${source}`);
  const concept = await request.post(`${API}/doc/task/${source}/concepts/notes.md`, {
    data: { title: 'Clone notes', description: 'A concept of the clone source.' },
  });
  expect(concept.status()).toBe(201);
  const patched = await request.patch(`${API}/entry/task/${source}`, {
    data: { state: 'in-progress', addTime: ['PT1H'] },
  });
  expect(patched.status()).toBe(200);
  // No API creates a log.md (only MCP append-log): write it into this worker's data copy.
  writeFileSync(dataPath(`task/${source}/log.md`), LOG);
});

test.afterAll(async ({ request }) => {
  for (const name of created) await request.delete(`${API}/entry/task/${name}`);
  created.clear();
});

test('Clone… copies the whole bundle into a new entry and opens it', async ({ page }) => {
  const before = bundleFiles(source);
  const name = uniqueName(`${source}-dup`);
  await page.goto(`/task/${source}`);
  await openCloneDialog(page);

  // prefilled: the suggestion, "(copy)", the description and tags, the DEFAULT state, no issue key
  await expect(page.getByTestId('clone-name')).toHaveValue(`${source}-copy`);
  await expect(page.getByTestId('clone-title')).toHaveValue(`E2E clone ${source} (copy)`);
  await expect(page.getByTestId('clone-description')).toHaveValue('Created by the clone spec.');
  await expect(page.getByTestId('clone-state')).toContainText('Pending');
  await expect(page.getByTestId('clone-issue-key')).toHaveValue('');
  await expect(page.getByTestId('clone-tags')).toContainText('e2e');
  await expect(page.getByTestId('clone-tags')).toContainText('clone');
  await expect(page.getByTestId('clone-opt-links')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('clone-opt-time')).not.toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('clone-opt-time')).toContainText('1h');
  await expect(page.getByTestId('clone-opt-children')).toHaveCount(0);
  await expect(page.getByTestId('clone-note')).toContainText('not added to the projects');

  await page.getByTestId('clone-name').fill(name);
  await page.getByTestId('clone-title').fill('E2E cloned task');
  const response = waitForApi(page, 'POST', `${API}/entry/task/${source}/clone`);
  await page.getByTestId('clone-submit').click();
  expect((await response).status()).toBe(201);
  created.add(name);
  await page.waitForURL(`**/task/${name}`);

  // the new page: its title, the concept file in the Files panel
  await expect(page.locator('h1.cx-pagehead__title')).toHaveText('E2E cloned task');
  await expect(page.getByTestId('detail-content').getByRole('heading', { level: 1 })).toHaveText(
    'E2E cloned task',
  );
  await expect(page.getByTestId('detail-slug')).toHaveText(name);
  const files = page.getByTestId('detail-files');
  await expect(files.locator('[data-testid="files-dir"][data-path="concepts"]')).toBeVisible();
  await expect(files.locator('a[title="concepts/notes.md"]')).toHaveCount(1);
  await expect(files.locator('a[title="log.md"]')).toBeVisible();

  // on disk: the same files; only the listed keys of index.md changed; the log has the clone line on top
  const after = bundleFiles(name);
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  expect(after['concepts/notes.md']).toBe(before['concepts/notes.md']);
  const index = after['index.md']!;
  expect(index).toContain(`\nname: ${name}\n`);
  expect(index).toContain('\ntitle: E2E cloned task\n');
  expect(index).toContain('\nstate: pending\n');
  expect(index).toContain('\ntags: [e2e, clone]\n');
  expect(index).not.toContain('issueKey');
  expect(index).not.toContain('time:');
  expect(index).toContain('\n# E2E cloned task\n');
  expect(index).toContain('(/concepts/notes.md)');
  expect(after['log.md']).toMatch(
    new RegExp(
      `^# Update log\\n\\n## \\d{4}-\\d{2}-\\d{2}\\n\\* \\*\\*Create\\*\\*: Cloned from \\[E2E clone ${source}\\]\\(ctxman:task/${source}\\)\\.\\n`,
    ),
  );
  expect(after['log.md']).toContain(LOG.slice('# Update log\n\n'.length));

  // the original is unchanged
  expect(bundleFiles(source)).toEqual(before);
});

test('a taken name answers 409: the dialog stays open with the error on the name', async ({
  page,
  request,
}) => {
  // The dialog checks names against the entries it loaded; a task created after that load only the server knows.
  const taken = uniqueName('e2e-clone-taken');
  const loaded = waitForApi(page, 'GET', `${API}/entries`);
  await page.goto(`/task/${source}`);
  await openCloneDialog(page);
  await loaded;
  await createTask(request, taken, 'E2E clone taken');
  const takenIndex = readDataText(`task/${taken}/index.md`);

  await page.getByTestId('clone-name').fill(taken);
  await expect(page.getByTestId('clone-submit')).toBeEnabled();
  const response = waitForApi(page, 'POST', `${API}/entry/task/${source}/clone`);
  await page.getByTestId('clone-submit').click();
  expect((await response).status()).toBe(409);

  const dialog = page.getByTestId('clone-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('clone-name')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toContainText('A task with this name already exists');
  await expect(page.getByTestId('clone-error')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(`/task/${source}`);
  expect(readDataText(`task/${taken}/index.md`)).toBe(takenIndex);

  // Cancel closes it; nothing was written
  await page.getByTestId('clone-cancel').click();
  await expect(dialog).toHaveCount(0);
  expect(dataExists(`task/${source}-copy`)).toBe(false);
});

test('Clone… is only in the detail menu of okf entries', async ({ page }) => {
  for (const url of ['/skill/ctxman-add-entry', '/reference/ctxman-repo', '/context/ctxman-dev']) {
    await page.goto(url);
    await page.getByTestId('detail-menu-slot').getByTestId('entry-menu').click();
    await expect(page.getByTestId('entry-menu-delete'), url).toBeVisible();
    await expect(page.getByTestId('entry-menu-clone'), url).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  // list rows: Log time and Delete, never Clone
  await page.goto('/task');
  await expect(page.getByTestId('list-row').first()).toBeVisible();
  await expect(page.getByTestId('row-delete').first()).toBeVisible();
  await expect(page.getByTestId('entry-menu-clone')).toHaveCount(0);
});

test('Clone… is disabled while the doc editor is open', async ({ page }) => {
  await page.goto(`/task/${source}?edit=1`);
  await expect(page.getByTestId('doc-editor').locator('.monaco-editor')).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId('detail-menu-slot').getByTestId('entry-menu').click();
  const item = page.getByTestId('entry-menu-clone');
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item.getByTitle('Leave the editor first')).toHaveCount(1);
  await page.keyboard.press('Escape');
});

test('POST /api/entry/<ds>/<slug>/clone: 201 + location, then 400 / 403 / 404 / 409 / 415', async ({
  request,
}) => {
  const url = `${API}/entry/task/${source}/clone`;
  const name = uniqueName('e2e-clone-api');

  const foreign = await request.post(url, {
    headers: { origin: 'http://evil.test' },
    data: { name, description: 'x' },
  });
  expect(foreign.status()).toBe(403);
  const notJson = await request.post(url, {
    headers: { 'content-type': 'text/plain' },
    data: JSON.stringify({ name, description: 'x' }),
  });
  expect(notJson.status()).toBe(415);
  expect(dataExists(`task/${name}`)).toBe(false);

  const ok = await request.post(url, {
    data: { name, description: 'Cloned through the API.', time: true, children: true },
  });
  expect(ok.status()).toBe(201);
  created.add(name);
  expect(ok.headers()['location']).toBe(`/task/${name}`);
  const body = (await ok.json()) as { slug: string; url: string; files: string[] };
  expect(body).toMatchObject({ slug: name, url: `/task/${name}` });
  expect(body.files).toContain(`task/${name}/concepts/notes.md`);
  // omitted title and tags: "(copy)" and the original's; time: true keeps the logged time
  const index = readDataText(`task/${name}/index.md`);
  expect(index).toContain(`\ntitle: E2E clone ${source} (copy)\n`);
  expect(index).toContain('\ntags: [e2e, clone]\n');
  expect(index).toContain('\ntime: [PT1H]\n');

  const status = async (path: string, data: unknown): Promise<[number, string]> => {
    const response = await request.post(path, { data });
    return [response.status(), ((await response.json()) as { error: string }).error];
  };
  expect(await status(url, { name, description: 'x' })).toEqual([409, 'exists']);
  expect(await status(url, { name: 'Not Valid', description: 'x' })).toEqual([400, 'invalid']);
  expect(await status(url, { name: 'e2e-x', description: 'x', nope: 1 })).toEqual([400, 'invalid']);
  expect(
    await status(`${API}/entry/task/e2e-clone-missing/clone`, { name: 'e2e-y', description: 'x' }),
  ).toEqual([404, 'not-found']);
  expect(
    await status(`${API}/entry/skill/ctxman-add-entry/clone`, { name: 'e2e-z', description: 'x' }),
  ).toEqual([400, 'bad-dataset']);
  expect(
    await status(`${API}/entry/task/Bad%20Slug/clone`, { name: 'e2e-z', description: 'x' }),
  ).toEqual([400, 'bad-slug']);
  for (const gone of ['e2e-y', 'e2e-z', 'e2e-x']) expect(dataExists(`task/${gone}`)).toBe(false);
  expect((await request.get(url)).status()).toBe(405);
});
