// Detail-page tools of an okf entry (ROUND3_SPEC §E.1, §E.5, §J): the Details dialog behind `meta-edit`, Add to
// context, `+ Add file`, Delete on a sub-doc page, the "Create this file" page of a missing file and the `….md`
// redirect. Every test
// works on its own e2e-* kb entry / contexts (created through the API, removed in afterAll); the seed entries are
// only read. The island enables the SSR buttons on mount, so each test waits for an enabled button first.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { API, afterApi, dataPath, readDataText, uniqueName } from './helpers.ts';

const kb = uniqueName('e2e-et-kb');
const task = uniqueName('e2e-et-task');
const ctxOld = uniqueName('e2e-et-ctx-old');
const ctxNew = uniqueName('e2e-et-ctx-new');
const kbMain = `kb/${kb}/index.md`;

// Serial: the tests share one kb entry and chain on what earlier ones wrote (renamed title, added links, concepts).
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  try {
    const created = await request.post(`${API}/entry/kb`, {
      data: { name: kb, title: 'E2E tools kb', description: 'Entry for the entry-tools spec.' },
    });
    expect(created.status()).toBe(201);
    // An unknown frontmatter key and hand-written prose: the Details dialog must keep both.
    const file = dataPath(kbMain);
    const source = readFileSync(file, 'utf8');
    const close = source.indexOf('\n---\n', 4);
    writeFileSync(
      file,
      `${source.slice(0, close)}\ncustom_note: keep me${source.slice(close)}\nHand-written prose.\n`,
    );
    expect(
      (
        await request.post(`${API}/entry/task`, {
          data: { name: task, title: 'E2E tools task', description: 'Task for the lock test.' },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await request.post(`${API}/context`, {
          data: {
            name: ctxOld,
            description: 'Existing context of the entry-tools spec.',
            links: [{ dataset: 'kb', slug: 'ctxman' }],
          },
        })
      ).status(),
    ).toBe(201);
  } finally {
    await request.dispose();
  }
});

test.afterAll(async ({ playwright, baseURL }) => {
  rmSync(dataPath(`kb/${kb}`), { recursive: true, force: true });
  rmSync(dataPath(`task/${task}`), { recursive: true, force: true });
  const request = await playwright.request.newContext({ baseURL });
  try {
    for (const name of [ctxOld, ctxNew]) await request.delete(`${API}/context/${name}`);
  } finally {
    await request.dispose();
  }
});

/** Opens a page and waits until the EntryTools island has enabled the SSR action buttons. */
async function open(page: Page, url: string, button: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId(button)).toBeEnabled();
}

test('meta-edit opens the Details dialog; saving changes the header and keeps unknown keys and the body', async ({
  page,
}) => {
  await open(page, `/kb/${kb}`, 'meta-edit');
  await page.getByTestId('meta-edit').click();
  await expect(page.getByTestId('fm-dialog')).toBeVisible();
  await expect(page.getByTestId('fm-title')).toHaveValue('E2E tools kb');

  await page.getByTestId('fm-title').fill('E2E tools kb renamed');
  await page.getByTestId('fm-add-tag').fill('e2e-fm');
  await page.getByTestId('fm-add-tag').press('Enter');
  await page.getByTestId('fm-stale-after').fill('2031-05-06');
  await page.getByTestId('fm-okf-status').click();
  await page.getByRole('option', { name: 'Stable' }).click();
  const patched = await afterApi(page, 'PATCH', `${API}/entry/kb/`, () =>
    page.getByTestId('fm-save').click(),
  );
  expect(patched.status()).toBe(200);
  await expect(page.getByTestId('fm-dialog')).toBeHidden();

  // the page is server rendered: the header shows the new title once it has been loaded again
  await expect(page.locator('h1').first()).toHaveText('E2E tools kb renamed');
  await expect(page.getByTestId('entry-status')).toHaveText('Saved details');
  await expect(page.getByTestId('detail-meta')).toContainText('2031-05-06');

  const saved = readDataText(kbMain);
  expect(saved).toContain('title: E2E tools kb renamed');
  expect(saved).toContain('e2e-fm');
  expect(saved).toContain('stale_after: 2031-05-06');
  expect(saved).toContain('status: stable');
  expect(saved).toContain('custom_note: keep me');
  expect(saved).toContain('\nHand-written prose.\n');
});

test('a task logs time (Enter adds a valid ISO 8601 duration) and a resolution date in the Details dialog', async ({
  page,
}) => {
  await open(page, `/task/${task}`, 'meta-edit');
  await page.getByTestId('meta-edit').click();
  await expect(page.getByTestId('fm-dialog')).toBeVisible();
  const input = page.getByTestId('fm-add-time');
  await input.fill('pt1h30m');
  await input.press('Enter');
  await input.fill('PT45M');
  await input.press('Enter');
  // an invalid value stays in the input with the problem shown, and Enter never submits the dialog
  await input.fill('90 minutes');
  await input.press('Enter');
  await expect(input).toHaveValue('90 minutes');
  await expect(page.getByTestId('fm-dialog')).toContainText('Not an ISO 8601 duration');
  await expect(page.getByTestId('fm-time')).toContainText('PT1H30M');
  await expect(page.getByTestId('fm-time')).toContainText('PT45M');
  await expect(page.getByTestId('fm-time-total')).toHaveText('Total 2h 15m');
  await input.fill('');
  await page.getByTestId('fm-resolved').fill('2026-10-19T14:30+02:00');
  const patched = await afterApi(page, 'PATCH', `${API}/entry/task/`, () =>
    page.getByTestId('fm-save').click(),
  );
  expect(patched.status()).toBe(200);
  expect(patched.request().postDataJSON()).toMatchObject({
    time: ['PT1H30M', 'PT45M'],
    resolved: '2026-10-19T14:30+02:00',
  });
  await expect(page.getByTestId('fm-dialog')).toBeHidden();
  await expect(page.getByTestId('meta-time')).toContainText('PT1H30M');
  await expect(page.getByTestId('meta-time-total')).toHaveText('Total 2h 15m');
  await expect(page.getByTestId('meta-resolved')).toHaveText('2026-10-19T14:30+02:00');
  const saved = readDataText(`task/${task}/index.md`);
  expect(saved).toContain('\ntime: [PT1H30M, PT45M]\n');
  expect(saved).toContain('\nresolved: 2026-10-19T14:30+02:00\n');

  // a kb entry has no time tracking: the dialog does not offer it
  await open(page, `/kb/${kb}`, 'meta-edit');
  await page.getByTestId('meta-edit').click();
  await expect(page.getByTestId('fm-title')).toBeVisible();
  await expect(page.getByTestId('fm-add-time')).toHaveCount(0);
  await expect(page.getByTestId('fm-resolved')).toHaveCount(0);
});

test('the header state select and the action buttons lock while the doc editor is open', async ({
  page,
}) => {
  await open(page, `/task/${task}`, 'meta-edit');
  await expect(page.getByTestId('state-select')).toBeEnabled();
  await page.goto(`/task/${task}?edit=1`);
  const lockTitle = 'Leave the editor first';
  await expect(page.getByTestId('state-select')).toBeDisabled();
  await expect(page.getByTestId('state-select')).toHaveAttribute('title', lockTitle);
  await expect(page.getByTestId('meta-edit')).toBeDisabled();
  await expect(page.getByTestId('entry-add-to-context')).toBeDisabled();
  await expect(page.getByTestId('files-add-file')).toBeDisabled();
});

test('the lock applies only to a page with a doc editor: reference ?edit=1 (DataForm) keeps Add to context enabled', async ({
  page,
}) => {
  await page.goto('/reference/astro-docs?edit=1');
  await expect(page.getByTestId('dform')).toBeVisible();
  // the island enabled the SSR button and nothing locked it again (a DataForm page has no DocEditor)
  await expect(page.getByTestId('entry-add-to-context')).toBeEnabled();
  await expect(page.getByTestId('entry-add-to-context')).not.toHaveAttribute(
    'title',
    'Leave the editor first',
  );
  await expect(page.getByTestId('entry-add-to-context')).not.toHaveAttribute('data-edit-locked');
});

test('entry-add-to-context adds the entry to an existing context; the back-references list it', async ({
  page,
}) => {
  await open(page, `/kb/${kb}`, 'entry-add-to-context');
  await expect(
    page.getByTestId('detail-backrefs').locator(`a[href="/context/${ctxOld}"]`),
  ).toHaveCount(0);
  await page.getByTestId('entry-add-to-context').click();
  await expect(page.getByTestId('add-to-context-dialog')).toBeVisible();
  await expect(page.getByTestId('add-to-context-submit')).toBeDisabled();
  await page.getByTestId('add-to-context-select').click();
  await page.getByRole('option', { name: new RegExp(`^${ctxOld}`) }).click();
  await page.getByTestId('add-to-context-submit').click();

  await expect(page.getByTestId('entry-status')).toHaveText(`Added to ${ctxOld}`);
  await expect(
    page.getByTestId('detail-backrefs').locator(`a[href="/context/${ctxOld}"]`),
  ).toBeVisible();
  expect(readDataText(`context/${ctxOld}.yaml`)).toContain(`slug: ${kb}`);

  // the context is now disabled in the select ("already linked")
  await page.getByTestId('entry-add-to-context').click();
  await page.getByTestId('add-to-context-select').click();
  await expect(page.getByRole('option', { name: new RegExp(`^${ctxOld}`) })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('entry-add-to-context creates a new context with the entry as its first link', async ({
  page,
}) => {
  await open(page, `/kb/${kb}`, 'entry-add-to-context');
  await page.getByTestId('entry-add-to-context').click();
  await page.getByTestId('add-to-context-select').click();
  await page.getByRole('option', { name: /New context/ }).click();
  await page.getByTestId('add-to-context-name').fill('Not A Name');
  await expect(page.getByTestId('add-to-context-submit')).toBeDisabled();
  await page.getByTestId('add-to-context-name').fill(ctxNew);
  await page.getByTestId('add-to-context-submit').click();

  await expect(page.getByTestId('entry-status')).toHaveText(`Added to ${ctxNew}`);
  const yaml = readDataText(`context/${ctxNew}.yaml`);
  expect(yaml).toContain(`dataset: kb`);
  expect(yaml).toContain(`slug: ${kb}`);
  await expect(
    page.getByTestId('detail-backrefs').locator(`a[href="/context/${ctxNew}"]`),
  ).toBeVisible();
});

test('files-add-file creates a file at a typed folder path (folders created), lists it and opens it in the editor', async ({
  page,
}) => {
  const name = uniqueName('e2e-file');
  await open(page, `/kb/${kb}`, 'files-add-file');
  await expect(page.getByTestId('files-add-file')).toHaveText('+ Add file');
  await page.getByTestId('files-add-file').click();
  await expect(page.getByTestId('add-file-dialog')).toBeVisible();
  // the OKF type starts as `article`
  await expect(page.getByTestId('add-file-type')).toHaveValue('article');
  // a bad path is refused before anything is sent
  await page.getByTestId('add-file-name').fill('references/');
  await expect(page.getByTestId('add-file-dialog')).toContainText(
    'Add a file name after the last /',
  );
  await expect(page.getByTestId('add-file-submit')).toBeDisabled();
  // `.md` is added when left out; the title follows the file name
  await page.getByTestId('add-file-name').fill(`references/deep/${name}`);
  await expect(page.getByTestId('add-file-path')).toHaveText(`kb/${kb}/references/deep/${name}.md`);
  await page.getByTestId('add-file-submit').click();

  await expect(page).toHaveURL(new RegExp(`/kb/${kb}/doc/references/deep/${name}\\?edit=1$`));
  expect(existsSync(dataPath(`kb/${kb}/references/deep/${name}.md`))).toBe(true);
  expect(readDataText(`kb/${kb}/index.md`)).toContain(`](/references/deep/${name}.md)`);
  // the file is typed `article` and listed under `## Links` (the entry has no `## Concepts` to reuse)
  expect(readDataText(`kb/${kb}/references/deep/${name}.md`)).toMatch(/^---\ntype: article\n/);
  const index = readDataText(`kb/${kb}/index.md`);
  expect(index).toContain('\n## Links\n');
  expect(index).not.toContain('## Concepts');

  await page.goto(`/kb/${kb}`);
  // the new folder of the file tree starts closed on the entry page
  const files = page.getByTestId('detail-files');
  const link = files.locator(`a[href="/kb/${kb}/doc/references/deep/${name}"]`);
  await expect(link).toBeHidden();
  await files.locator('[data-testid="files-dir"][data-path="references"] > summary').click();
  await files.locator('[data-testid="files-dir"][data-path="references/deep"] > summary').click();
  await expect(link).toBeVisible();
  // the doc page offers the button too
  await page.goto(`/kb/${kb}/doc/references/deep/${name}`);
  await expect(page.getByTestId('files-add-file')).toBeEnabled();
});

test('Delete on a sub-doc page removes the file after a confirmation and returns to the entry page; the entry has none', async ({
  page,
  request,
}) => {
  const rel = `notes/${uniqueName('e2e-del')}.md`;
  expect(
    (
      await request.post(`${API}/doc/kb/${kb}/${rel}`, { data: { title: 'E2E delete me' } })
    ).status(),
  ).toBe(201);
  // the entry index.md is the whole bundle: its delete is the ⋯ menu, not this button
  await open(page, `/kb/${kb}`, 'meta-edit');
  await expect(page.getByTestId('doc-tools')).toBeVisible();
  await expect(page.getByTestId('doc-delete')).toHaveCount(0);

  await page.goto(`/kb/${kb}/doc/${rel.replace(/\.md$/, '')}`);
  const button = page.getByTestId('doc-delete');
  await expect(button).toBeEnabled();
  // right after the Preview | Edit toggle, borderless until hovered, then red
  const toggle = (await page.getByTestId('doc-view-toggle').boundingBox())!;
  expect((await button.boundingBox())!.x).toBeGreaterThan(toggle.x + toggle.width - 1);
  await expect(button).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  await button.hover();
  await expect(button).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  await page.mouse.move(0, 0);
  // locked while editing
  await page.getByTestId('doc-view-edit').click();
  await expect(button).toBeDisabled();
  await page.getByTestId('doc-view-preview').click();
  await expect(button).toBeEnabled();

  await button.click();
  await expect(page.getByTestId('doc-delete-dialog')).toContainText(`kb/${kb}/${rel}`);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('doc-delete-dialog')).toBeHidden();
  expect(existsSync(dataPath(`kb/${kb}/${rel}`))).toBe(true);

  await button.click();
  const deleted = await afterApi(page, 'DELETE', `${API}/doc/kb/${kb}/`, () =>
    page.getByTestId('doc-delete-dialog').getByRole('button', { name: 'Delete' }).click(),
  );
  expect(deleted.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/kb/${kb}$`));
  await expect(page.getByTestId('entry-status')).toHaveText(`Deleted ${rel}`);
  expect(existsSync(dataPath(`kb/${kb}/${rel}`))).toBe(false);
  expect(existsSync(dataPath(`kb/${kb}/notes`))).toBe(false);
  expect(readDataText(`kb/${kb}/index.md`)).not.toContain(rel);
});

test('a missing concept shows "Create this file"; creating it opens the new page', async ({
  page,
}) => {
  const concept = uniqueName('e2e-missing');
  const response = await page.goto(`/kb/${kb}/doc/concepts/${concept}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId('doc-missing')).toContainText(`concepts/${concept}.md`);
  await expect(page.getByTestId('doc-missing')).toContainText("doesn't exist yet");
  const create = page.getByTestId('doc-missing-create');
  await expect(create).toBeEnabled();
  await expect(create).toHaveAttribute('data-path', `concepts/${concept}.md`);
  await create.click();

  // the path is fixed by the button: no path field
  await expect(page.getByTestId('add-file-dialog')).toBeVisible();
  await expect(page.getByTestId('add-file-path')).toHaveText(`kb/${kb}/concepts/${concept}.md`);
  await expect(page.getByTestId('add-file-name')).toHaveCount(0);
  await page.getByTestId('add-file-title').fill('E2E missing concept');
  await page.getByTestId('add-file-submit').click();
  await expect(page).toHaveURL(new RegExp(`/kb/${kb}/doc/concepts/${concept}\\?edit=1$`));
  const source = readDataText(`kb/${kb}/concepts/${concept}.md`);
  expect(source).toContain('title: E2E missing concept');
});

test('only a concept path of an existing bundle offers to be created', async ({
  page,
  request,
}) => {
  // reserved files, an unknown bundle and a non-doc dataset are plain 404s without the create button
  for (const url of [
    `/kb/${kb}/doc/concepts/index`,
    `/kb/${kb}/doc/nope/log`,
    '/kb/e2e-no-such-bundle/doc/concepts/x',
  ]) {
    const response = await page.goto(url);
    expect(response?.status(), url).toBe(404);
    await expect(page.getByTestId('doc-missing'), url).toHaveCount(0);
  }
  expect((await request.get('/skill/okf-authoring/doc/concepts/x')).status()).toBe(404);
});

test('a .md doc URL redirects to the extensionless page (query kept)', async ({
  page,
  request,
}) => {
  const redirect = await request.get('/kb/ctxman/doc/concepts/datasets.md?edit=1', {
    maxRedirects: 0,
  });
  expect(redirect.status()).toBe(301);
  expect(redirect.headers().location).toBe('/kb/ctxman/doc/concepts/datasets?edit=1');
  const main = await request.get('/kb/ctxman/doc/index.md', { maxRedirects: 0 });
  expect(main.status()).toBe(301);
  expect(main.headers().location).toBe('/kb/ctxman');
  const bare = await request.get('/kb/ctxman/doc/index', { maxRedirects: 0 });
  expect(bare.status()).toBe(301);
  expect(bare.headers().location).toBe('/kb/ctxman');

  await page.goto('/kb/ctxman/doc/concepts/datasets.md');
  await expect(page).toHaveURL(/\/kb\/ctxman\/doc\/concepts\/datasets$/);
  await expect(page.getByTestId('detail-path')).toHaveText('concepts/datasets.md');
});
