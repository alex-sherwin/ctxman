// DataForm cases (ROUND2_UI_SPEC §H, §L): create (/new/reference, /new/context, /new/recipe) and edit (?edit=1 on the
// detail pages: scalar edits through PUT, Cancel, Delete, the YAML tab). Names are `e2e-*`; every created entry is
// removed again.
// A reference is a glob-loaded file: the dev server reloads the page ~0.7 s after the write, and the form resumes its
// navigation to the new entry after that reload (src/stores/data-form.ts), so these tests only assert the end state.
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  API,
  createRecipeCopy,
  dataExists,
  deleteRecipeQuietly,
  readYaml,
  settleDevReload,
  uniqueName,
} from './helpers.ts';

type Ds = 'reference' | 'context' | 'recipe';
const created: { ds: Ds; name: string }[] = [];

test.afterEach(async ({ request }) => {
  const list = created.splice(0);
  for (const { ds, name } of list) await request.delete(`/api/${ds}/${name}`);
  if (list.some((c) => c.ds === 'reference')) await settleDevReload();
});

async function openNew(page: Page, ds: Ds, search = ''): Promise<void> {
  await page.goto(`/new/${ds}${search}`);
  await expect(page.getByTestId('dform')).toBeVisible();
  await expect(
    page.getByTestId(search.includes('view=yaml') ? 'dform-yaml-editor' : 'dform-field-name'),
  ).toBeVisible();
}

async function pick(page: Page, field: string, option: string): Promise<void> {
  await page.getByTestId(`dform-field-${field}`).click();
  await page.getByRole('option', { name: option }).click();
  await expect(page.getByTestId(`dform-field-${field}`)).toContainText(option);
}

/**
 * Replaces the whole text of the YAML editor (select all + type; Monaco auto-indents, so no nested lines). The
 * Playwright "Desktop Chrome" profile reports a Windows user agent, so Monaco binds select-all to Control+A
 * even on macOS (where `ControlOrMeta` would press Cmd and fall through to the native textarea).
 */
async function replaceYaml(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('dform-yaml-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
  await editor.locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text);
}

test.describe('/new/reference', () => {
  test('the type switch swaps the path field for uri', async ({ page }) => {
    await openNew(page, 'reference');
    await expect(page.getByTestId('dform')).toHaveAttribute('data-mode', 'create');
    await expect(page.getByTestId('dform-field-type')).toContainText('Local repo');
    await expect(page.getByTestId('dform-field-path')).toBeVisible();
    await expect(page.getByTestId('dform-field-uri')).toHaveCount(0);
    await expect(page.getByTestId('dform-field-subpath')).toBeVisible();
    await expect(page.getByTestId('dform-field-owner')).toContainText('me');

    await pick(page, 'type', 'Remote repo');
    await expect(page.getByTestId('dform-field-path')).toHaveCount(0);
    await expect(page.getByTestId('dform-field-uri')).toBeVisible();
    await expect(page.getByTestId('dform-field-subpath')).toBeVisible();

    await pick(page, 'type', 'Remote skill');
    await expect(page.getByTestId('dform-field-uri')).toBeVisible();
    await expect(page.getByTestId('dform')).toContainText('https archive');

    await pick(page, 'type', 'Local repo');
    await expect(page.getByTestId('dform-field-path')).toBeVisible();
    await expect(page.getByTestId('dform-field-uri')).toHaveCount(0);
  });

  test('an invalid name and an invalid uri show field errors and send nothing', async ({
    page,
  }) => {
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && r.method() !== 'GET')
        writes.push(`${r.method()} ${r.url()}`);
    });
    await openNew(page, 'reference');

    await page.getByTestId('dform-field-name').fill('Bad Name');
    await expect(page.locator('.ck-field__error')).toContainText('lowercase letters');
    await page.getByTestId('dform-field-name').fill('e2e-ref-invalid');
    await expect(page.locator('.ck-field__error')).toHaveCount(0);

    await page.getByTestId('dform-field-description').fill('Invalid uri');
    await pick(page, 'type', 'Remote repo');
    await page.getByTestId('dform-field-uri').fill('nope');
    await page.getByTestId('dform-save').click();
    await expect(page.locator('.ck-field__error')).toContainText('must be a git URI');
    await expect(page.getByTestId('dform-field-uri')).toBeFocused();
    await expect(page.getByTestId('dform-status')).toHaveText('Fix the highlighted fields');
    expect(writes).toEqual([]);
    expect(dataExists('reference/e2e-ref-invalid.yaml')).toBe(false);

    // empty required fields say Required once Save was attempted
    await page.getByTestId('dform-field-uri').fill('');
    await page.getByTestId('dform-field-description').fill('');
    await page.getByTestId('dform-save').click();
    await expect(page.locator('.ck-field__error')).toHaveText(['Required', 'Required']);
  });

  test('creates a reference and opens it', async ({ page }) => {
    const name = uniqueName('e2e-ref');
    created.push({ ds: 'reference', name });
    await openNew(page, 'reference');
    await page.getByTestId('dform-field-name').fill(name);
    await page.getByTestId('dform-field-description').fill('Created by the forms spec');
    await pick(page, 'type', 'Remote repo');
    await page.getByTestId('dform-field-uri').fill('git@github.com:org/e2e-forms.git');
    await page.getByTestId('dform-field-subpath').fill('docs');
    await pick(page, 'owner', 'not me');
    await page.getByTestId('dform-field-tags-add-tag').fill('forms');
    await page.getByTestId('dform-field-tags-add-tag').press('Enter');
    await page.getByTestId('dform-field-tags-add-tag').fill('e2e');
    await page.getByTestId('dform-field-tags-add-tag').press('Enter');
    await expect(page.getByTestId('dform-field-tags-tags')).toContainText('forms');
    await expect(page.getByTestId('dform-save')).toHaveText('Create');
    await page.getByTestId('dform-save').click();

    await expect(page).toHaveURL(new RegExp(`/reference/${name}$`), { timeout: 15_000 });
    expect(readYaml(`reference/${name}.yaml`)).toEqual({
      name,
      description: 'Created by the forms spec',
      type: 'remote-repo',
      uri: 'git@github.com:org/e2e-forms.git',
      subpath: 'docs',
      owner: 'not-me',
      tags: ['forms', 'e2e'],
    });
    await settleDevReload();
  });
});

test.describe('/new/context', () => {
  test('creates a context with tags (Enter in a field submits)', async ({ page }) => {
    const name = uniqueName('e2e-ctx');
    created.push({ ds: 'context', name });
    await openNew(page, 'context');
    await expect(page.getByTestId('dform-summary')).toContainText('Forge');
    await page.getByTestId('dform-field-name').fill(name);
    await page.getByTestId('dform-field-tags-add-tag').fill('Alpha Beta');
    await page.getByTestId('dform-field-tags-add-tag').press('Enter');
    await expect(page.getByTestId('dform-field-tags-tags')).toContainText('alpha-beta');
    await page.getByTestId('dform-field-description').fill('Created by the forms spec');
    await page.getByTestId('dform-field-description').press('Enter');

    await expect(page).toHaveURL(new RegExp(`/context/${name}$`), { timeout: 15_000 });
    expect(readYaml(`context/${name}.yaml`)).toEqual({
      name,
      description: 'Created by the forms spec',
      tags: ['alpha-beta'],
      links: [],
    });
  });

  test('an existing name is refused live, and Save shows what is missing', async ({ page }) => {
    await openNew(page, 'context');
    await page.getByTestId('dform-field-name').fill('ctxman-dev');
    await expect(page.locator('.ck-field__error')).toContainText('already exists');
    await page.getByTestId('dform-save').click();
    await expect(page.getByTestId('dform-status')).toHaveText('Fix the highlighted fields');
    await expect(page.locator('.ck-field__error')).toHaveText([
      'A context with this name already exists',
      'Required',
    ]);
  });

  test('Cancel leaves at once when clean, and asks first when something was typed', async ({
    page,
  }) => {
    await openNew(page, 'context');
    await page.getByTestId('dform-cancel').click();
    await expect(page).toHaveURL(/\/context$/);

    await openNew(page, 'context');
    await page.getByTestId('dform-field-name').fill('e2e-ctx-discard');
    await expect(page.getByTestId('dform-status')).toHaveText('Unsaved changes');
    await page.getByTestId('dform-cancel').click();
    await expect(page.getByTestId('dform-discard-dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByTestId('dform-discard-dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/new\/context$/);
    await page.getByTestId('dform-cancel').click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/context$/);
    expect(dataExists('context/e2e-ctx-discard.yaml')).toBe(false);
  });
});

test.describe('/new/recipe', () => {
  test('creates a recipe with target, layout and a preamble', async ({ page }) => {
    const name = uniqueName('e2e-recipe');
    created.push({ ds: 'recipe', name });
    await openNew(page, 'recipe');
    await expect(page.getByTestId('dform-summary')).toContainText('Inflate');
    await page.getByTestId('dform-field-name').fill(name);
    await page.getByTestId('dform-field-description').fill('Created by the forms spec');
    await pick(page, 'target', 'Codex');
    await pick(page, 'layout', 'Flat');
    const preamble = page.getByTestId('dform-field-preamble');
    await expect(preamble.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
    await preamble.locator('.monaco-editor textarea').focus();
    await page.keyboard.type('Read the docs first.');
    await page.getByTestId('dform-save').click();

    await expect(page).toHaveURL(new RegExp(`/recipe/${name}$`), { timeout: 15_000 });
    expect(readYaml(`recipe/${name}.yaml`)).toMatchObject({
      name,
      description: 'Created by the forms spec',
      target: 'codex',
      layout: 'flat',
      preamble: 'Read the docs first.\n',
      contexts: [],
      items: [],
    });
  });
});

test.describe('YAML tab', () => {
  test('edits sync to the form and back; the view is in the URL', async ({ page }) => {
    await openNew(page, 'context');
    await page.getByTestId('dform-field-name').fill('e2e-ctx-yaml');
    await page.getByTestId('dform-field-description').fill('From the form');

    await page.getByTestId('dform-view-yaml').click();
    await expect(page).toHaveURL(/[?&]view=yaml/);
    const editor = page.getByTestId('dform-yaml-editor');
    await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
    await expect(editor.locator('.view-lines')).toContainText('name: e2e-ctx-yaml');
    await expect(editor.locator('.view-lines')).toContainText('description: From the form');
    await expect(page.getByTestId('dform-yaml-issues')).toContainText('Valid');

    await replaceYaml(page, 'name: e2e-ctx-yaml\ndescription: From the yaml\nlinks: []\n');
    await expect(page.getByTestId('dform-yaml-issues')).toContainText('Valid');
    await page.getByTestId('dform-view-form').click();
    await expect(page).not.toHaveURL(/view=yaml/);
    await expect(page.getByTestId('dform-field-description')).toHaveValue('From the yaml');

    await page.getByTestId('dform-field-description').fill('From the form again');
    await page.getByTestId('dform-view-yaml').click();
    await expect(page.getByTestId('dform-yaml-editor').locator('.view-lines')).toContainText(
      'description: From the form again',
    );
  });

  test('invalid YAML disables Save and the form tab until it is fixed', async ({ page }) => {
    await openNew(page, 'context', '?view=yaml');
    await replaceYaml(page, 'name: e2e-ctx-yaml\ndescription: [oops\n');
    await expect(page.getByTestId('dform-yaml-issues')).toContainText('invalid');
    await expect(page.getByTestId('dform-yaml-issue').first()).toBeVisible();
    await expect(page.getByTestId('dform-save')).toBeDisabled();
    await expect(page.getByTestId('dform-view-form')).toBeDisabled();

    await replaceYaml(page, 'name: e2e-ctx-yaml\ndescription: Fixed\nlinks: []\n');
    await expect(page.getByTestId('dform-yaml-issues')).toContainText('Valid');
    await expect(page.getByTestId('dform-save')).toBeEnabled();
    await page.getByTestId('dform-view-form').click();
    await expect(page.getByTestId('dform-field-name')).toHaveValue('e2e-ctx-yaml');
  });

  test('monaco-yaml flags a schema problem and the list names the position', async ({ page }) => {
    await openNew(page, 'reference', '?view=yaml');
    await replaceYaml(
      page,
      'name: e2e-ref-yaml\ndescription: d\ntype: local-repo\npath: ~/x\nowner: someone\n',
    );
    // the JSON-Schema warning comes from monaco-yaml, the list entry from the zod check
    await expect(
      page.getByTestId('dform-yaml-editor').locator('.squiggly-warning'),
    ).not.toHaveCount(0);
    await expect(page.getByTestId('dform-yaml-issue')).toContainText('owner');
    await expect(page.getByTestId('dform-save')).toBeDisabled();
  });

  test('a YAML-only problem (duplicate link) is a marker and the Create from YAML works', async ({
    page,
  }) => {
    const name = uniqueName('e2e-ctx');
    created.push({ ds: 'context', name });
    await openNew(page, 'context', '?view=yaml');
    await replaceYaml(
      page,
      `name: ${name}\ndescription: yaml create\nlinks:\n- {dataset: kb, slug: ctxman}\n- {dataset: kb, slug: ctxman}\n`,
    );
    await expect(page.getByTestId('dform-yaml-issue')).toContainText('duplicate link kb/ctxman');
    await expect(page.getByTestId('dform-yaml-editor').locator('.squiggly-error')).not.toHaveCount(
      0,
    );
    await replaceYaml(
      page,
      `name: ${name}\ndescription: yaml create\nlinks:\n- {dataset: kb, slug: ctxman}\n`,
    );
    await expect(page.getByTestId('dform-yaml-issues')).toContainText('Valid');
    await page.getByTestId('dform-save').click();
    await expect(page).toHaveURL(new RegExp(`/context/${name}$`), { timeout: 15_000 });
    expect(readYaml(`context/${name}.yaml`)).toEqual({
      name,
      description: 'yaml create',
      links: [{ dataset: 'kb', slug: 'ctxman' }],
    });
  });
});

// ---------------------------------------------------------------- edit mode (/<ds>/<slug>?edit=1)

/** A reference through the API; it is glob-loaded, so wait until the list sees it and the dev reload has passed. */
async function createReference(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.post(`${API}/reference`, {
    data: {
      name,
      description: 'Edit me',
      type: 'remote-repo',
      uri: 'git@github.com:org/e2e-edit.git',
      owner: 'me',
      tags: ['e2e'],
    },
  });
  expect(response.status()).toBe(201);
  created.push({ ds: 'reference', name });
  await expect
    .poll(async () => {
      const list = await request.get(`${API}/entries?dataset=reference`);
      const { entries } = (await list.json()) as { entries: { slug: string }[] };
      return entries.some((e) => e.slug === name);
    })
    .toBe(true);
  await settleDevReload();
}

async function createContext(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.post(`${API}/context`, {
    data: {
      name,
      description: 'Edit me',
      tags: ['e2e'],
      links: [
        { dataset: 'kb', slug: 'ctxman', notes: 'Keep this note.' },
        { dataset: 'task', slug: 'write-agents-md' },
      ],
    },
  });
  expect(response.status()).toBe(201);
  created.push({ ds: 'context', name });
}

async function openEdit(page: Page, ds: Ds, name: string, search = ''): Promise<void> {
  await page.goto(`/${ds}/${name}?edit=1${search}`);
  await expect(page.getByTestId('dform')).toHaveAttribute('data-mode', 'edit');
  await expect(
    page.getByTestId(search.includes('view=yaml') ? 'dform-yaml-editor' : 'dform-field-name'),
  ).toBeVisible();
}

test.describe('edit: reference', () => {
  test('the form is filled from the file; the name cannot change; Save sends a PUT and the page shows the new values', async ({
    page,
    request,
  }) => {
    const name = uniqueName('e2e-ref');
    await createReference(request, name);
    await openEdit(page, 'reference', name);
    await expect(page.getByTestId('dform-field-name')).toHaveValue(name);
    await expect(page.getByTestId('dform-field-name')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('dform-field-description')).toHaveValue('Edit me');
    await expect(page.getByTestId('dform-field-type')).toContainText('Remote repo');
    await expect(page.getByTestId('dform-field-uri')).toHaveValue(
      'git@github.com:org/e2e-edit.git',
    );
    await expect(page.getByTestId('dform-field-tags-tags')).toContainText('e2e');
    await expect(page.getByTestId('dform-save')).toHaveText('Save');
    await expect(page.getByTestId('dform-save')).toBeDisabled();

    await page.getByTestId('dform-field-description').fill('Edited by the forms spec');
    await pick(page, 'owner', 'not me');
    await page.getByTestId('dform-field-tags-add-tag').fill('edited');
    await page.getByTestId('dform-field-tags-add-tag').press('Enter');
    await expect(page.getByTestId('dform-status')).toHaveText('Unsaved changes');
    const put = page.waitForRequest(
      (r) => r.method() === 'PUT' && r.url().endsWith(`/api/reference/${name}`),
    );
    await page.getByTestId('dform-save').click();
    await put;

    await expect(page).toHaveURL(new RegExp(`/reference/${name}$`), { timeout: 15_000 });
    await expect(page.getByTestId('detail-content')).toContainText('Edited by the forms spec');
    await expect(page.getByTestId('reference-fields')).toContainText('not me');
    expect(readYaml(`reference/${name}.yaml`)).toEqual({
      name,
      description: 'Edited by the forms spec',
      type: 'remote-repo',
      uri: 'git@github.com:org/e2e-edit.git',
      owner: 'not-me',
      tags: ['e2e', 'edited'],
    });
    await settleDevReload();
  });

  test('Cancel goes back to the detail page, and asks first when something changed', async ({
    page,
    request,
  }) => {
    const name = uniqueName('e2e-ref');
    await createReference(request, name);
    await openEdit(page, 'reference', name);
    await page.getByTestId('dform-cancel').click();
    await expect(page).toHaveURL(new RegExp(`/reference/${name}$`));
    await expect(page.getByTestId('reference-fields')).toBeVisible();

    await openEdit(page, 'reference', name);
    await page.getByTestId('dform-field-description').fill('never saved');
    await page.getByTestId('dform-cancel').click();
    await expect(page.getByTestId('dform-discard-dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/edit=1/);
    await page.getByTestId('dform-cancel').click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(new RegExp(`/reference/${name}$`));
    expect(readYaml(`reference/${name}.yaml`)).toMatchObject({ description: 'Edit me' });
  });

  test('Delete asks for confirmation, removes the file and lands on the list without the row', async ({
    page,
    request,
  }) => {
    const name = uniqueName('e2e-ref');
    await createReference(request, name);
    await openEdit(page, 'reference', name);
    await page.getByTestId('dform-delete').click();
    const dialog = page.getByTestId('dform-delete-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(dataExists(`reference/${name}.yaml`)).toBe(true);

    await page.getByTestId('dform-delete').click();
    await page.getByTestId('dform-delete-dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/reference$/, { timeout: 15_000 });
    expect(dataExists(`reference/${name}.yaml`)).toBe(false);
    await expect(page.locator(`[data-testid="list-row"][data-slug="${name}"]`)).toHaveCount(0);
    await settleDevReload();
  });

  test('the YAML tab edits the same document', async ({ page, request }) => {
    const name = uniqueName('e2e-ref');
    await createReference(request, name);
    await openEdit(page, 'reference', name, '&view=yaml');
    await expect(page.getByTestId('dform-yaml-editor').locator('.view-lines')).toContainText(
      `name: ${name}`,
    );
    await replaceYaml(
      page,
      `name: ${name}\ndescription: From the yaml tab\ntype: remote-repo\nuri: git@github.com:org/e2e-edit.git\nowner: me\n`,
    );
    await expect(page.getByTestId('dform-yaml-issues')).toContainText('Valid');
    await page.getByTestId('dform-save').click();
    await expect(page).toHaveURL(new RegExp(`/reference/${name}$`), { timeout: 15_000 });
    await expect(page.getByTestId('detail-content')).toContainText('From the yaml tab');
    expect(readYaml(`reference/${name}.yaml`)).toMatchObject({ description: 'From the yaml tab' });
    await settleDevReload();
  });
});

test.describe('edit: context', () => {
  test('a scalar edit keeps the links and their notes', async ({ page, request }) => {
    const name = uniqueName('e2e-ctx');
    await createContext(request, name);
    await openEdit(page, 'context', name);
    await expect(page.getByTestId('dform-summary')).toContainText('2 links');
    await expect(page.getByTestId('dform-open-linked')).toHaveAttribute(
      'href',
      `/forge?context=${name}`,
    );
    await page.getByTestId('dform-field-description').fill('Edited context description');
    await page.getByTestId('dform-field-tags-add-tag').fill('edited');
    await page.getByTestId('dform-field-tags-add-tag').press('Enter');
    await page.getByTestId('dform-save').click();

    await expect(page).toHaveURL(new RegExp(`/context/${name}$`), { timeout: 15_000 });
    await expect(page.getByTestId('detail-content')).toContainText('Edited context description');
    await expect(page.getByTestId('context-link')).toHaveCount(2);
    expect(readYaml(`context/${name}.yaml`)).toEqual({
      name,
      description: 'Edited context description',
      tags: ['e2e', 'edited'],
      links: [
        { dataset: 'kb', slug: 'ctxman', notes: 'Keep this note.\n' },
        { dataset: 'task', slug: 'write-agents-md' },
      ],
    });
  });

  test('Delete removes the context and lands on the list', async ({ page, request }) => {
    const name = uniqueName('e2e-ctx');
    await createContext(request, name);
    await openEdit(page, 'context', name);
    await page.getByTestId('dform-delete').click();
    await page.getByTestId('dform-delete-dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/context$/, { timeout: 15_000 });
    expect(dataExists(`context/${name}.yaml`)).toBe(false);
  });
});

test.describe('edit: recipe', () => {
  test('target and layout are edited through the form and saved', async ({ page, request }) => {
    const name = uniqueName('e2e-recipe');
    await createRecipeCopy(request, name);
    created.push({ ds: 'recipe', name });
    await openEdit(page, 'recipe', name);
    await expect(page.getByTestId('dform-summary')).toContainText('Inflate');
    await expect(page.getByTestId('dform-field-target')).toContainText('Claude Code');
    await pick(page, 'target', 'Codex');
    await pick(page, 'layout', 'Flat');
    await page.getByTestId('dform-save').click();

    await expect(page).toHaveURL(new RegExp(`/recipe/${name}$`), { timeout: 15_000 });
    expect(readYaml(`recipe/${name}.yaml`)).toMatchObject({
      name,
      target: 'codex',
      layout: 'flat',
      contexts: ['ctxman-dev'],
    });
    await expect(page.getByTestId('detail-aside')).toContainText('Codex');
    await expect(page.getByTestId('recipe-composition')).toBeVisible();
    await deleteRecipeQuietly(request, name);
  });
});

test.describe('routing', () => {
  test('?edit=1 on a missing yaml entry is a 404 that still mounts the form (it says "not found")', async ({
    page,
  }) => {
    const response = await page.goto('/reference/e2e-no-such-reference?edit=1');
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('dform-not-found')).toBeVisible();
    // without ?edit=1 it is the plain not-found page
    const plain = await page.goto('/reference/e2e-no-such-reference');
    expect(plain?.status()).toBe(404);
    await expect(page.getByTestId('notfound-path')).toBeVisible();
  });

  test('/new/<ds> exists only for reference, context and recipe', async ({ page }) => {
    for (const ds of ['kb', 'task', 'skill', 'nope']) {
      const response = await page.goto(`/new/${ds}`);
      expect(response?.status(), ds).toBe(404);
    }
    const ok = await page.goto('/new/reference');
    expect(ok?.status()).toBe(200);
    await expect(page.getByTestId('dform')).toBeVisible();
  });
});
