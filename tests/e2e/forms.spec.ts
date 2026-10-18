// DataForm cases (ROUND2_UI_SPEC §H, §L): create (/new/reference, /new/context, /new/recipe) and edit (?edit=1 on the
// detail pages: scalar edits through PUT, Cancel, Delete, the YAML tab), plus the NewEntryForm of the okf and skill
// datasets (/new/task, /new/skill, ... ROUND3_SPEC §E.7). Names are `e2e-*`; every created entry is removed again
// (the okf / skill ones by deleting their folder, there is no delete API for them).
// Writes are visible on the next request (everything reads the disk) and the form navigates to the new entry
// itself (src/stores/data-form.ts); these tests assert the end state.
import { rmSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  API,
  createRecipeCopy,
  dataExists,
  dataPath,
  deleteRecipeQuietly,
  readDataText,
  readYaml,
  uniqueName,
} from './helpers.ts';

type Ds = 'reference' | 'context' | 'recipe';
const created: { ds: Ds; name: string }[] = [];

test.afterEach(async ({ request }) => {
  for (const { ds, name } of created.splice(0)) await request.delete(`/api/${ds}/${name}`);
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
  await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
  await editor.locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+a');
  // insertText, not type: a typed Enter accepts monaco-yaml's open completion item when the worker answers in time
  // (a flake that appears once the page is fast enough); the whole text goes in as one input event.
  await page.keyboard.insertText(text);
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

    await expect(page).toHaveURL(new RegExp(`/reference/${name}$`));
    expect(readYaml(`reference/${name}.yaml`)).toEqual({
      name,
      description: 'Created by the forms spec',
      type: 'remote-repo',
      uri: 'git@github.com:org/e2e-forms.git',
      subpath: 'docs',
      owner: 'not-me',
      tags: ['forms', 'e2e'],
    });
  });
});

test.describe('/new/context', () => {
  test('creates a context with tags (Enter in a field submits)', async ({ page }) => {
    const name = uniqueName('e2e-ctx');
    created.push({ ds: 'context', name });
    await openNew(page, 'context');
    await expect(page.getByTestId('dform-summary')).toContainText('Forge');
    await page.getByTestId('dform-field-name').fill(name);
    // typed text is split on commas and whitespace (UX-26): two tags, the last one committed by Enter
    await page.getByTestId('dform-field-tags-add-tag').fill('Alpha Beta');
    await page.getByTestId('dform-field-tags-add-tag').press('Enter');
    await expect(page.getByTestId('dform-field-tags-tags')).toContainText('alpha');
    await expect(page.getByTestId('dform-field-tags-tags')).toContainText('beta');
    await page.getByTestId('dform-field-description').fill('Created by the forms spec');
    await page.getByTestId('dform-field-description').press('Enter');

    await expect(page).toHaveURL(new RegExp(`/context/${name}$`));
    expect(readYaml(`context/${name}.yaml`)).toEqual({
      name,
      description: 'Created by the forms spec',
      tags: ['alpha', 'beta'],
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
    await expect(preamble.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
    await preamble.locator('.monaco-editor textarea').focus();
    await page.keyboard.type('Read the docs first.');
    await page.getByTestId('dform-save').click();

    await expect(page).toHaveURL(new RegExp(`/recipe/${name}$`));
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
    await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
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
    // the JSON-Schema warning comes from monaco-yaml, the list entry from the schema check
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
    await expect(page).toHaveURL(new RegExp(`/context/${name}$`));
    expect(readYaml(`context/${name}.yaml`)).toEqual({
      name,
      description: 'yaml create',
      links: [{ dataset: 'kb', slug: 'ctxman' }],
    });
  });
});

// ---------------------------------------------------------------- NewEntryForm (okf + skill datasets)

const nProject = uniqueName('e2e-nf-proj');
const nTask = uniqueName('e2e-nf-task');
const nSkill = uniqueName('e2e-nf-skill');
const NAV_KEY = 'ctxman:saved:new-entry-nav';

async function openNewEntry(page: Page, ds: string, search = ''): Promise<void> {
  await page.goto(`/new/${ds}${search}`);
  await expect(page.getByTestId('new-entry-form')).toBeVisible();
  await expect(page.getByTestId('new-name')).toBeVisible();
}

test.describe('/new/<okf> and /new/skill (NewEntryForm)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    try {
      const response = await request.post(`${API}/entry/project`, {
        data: { name: nProject, title: 'E2E form project', description: 'Parent of the form task' },
      });
      expect(response.status()).toBe(201);
    } finally {
      await request.dispose();
    }
  });

  test.afterAll(async () => {
    rmSync(dataPath(`project/${nProject}`), { recursive: true, force: true });
    rmSync(dataPath(`task/${nTask}`), { recursive: true, force: true });
    rmSync(dataPath(`skill/${nSkill}`), { recursive: true, force: true });
  });

  test('?parent= prefills the project; Create writes the entry, links the project and opens it', async ({
    page,
    request,
  }) => {
    await openNewEntry(page, 'task', `?parent=${nProject}`);
    await expect(page.getByTestId('new-parent')).toContainText('E2E form project');
    await expect(page.getByTestId('new-state')).toContainText('Pending');
    await expect(page.getByTestId('new-submit')).toHaveText('Create task');
    await expect(page.getByTestId('new-cancel')).toHaveAttribute('href', '/task');

    await page.getByTestId('new-name').fill(nTask);
    await expect(page.getByTestId('new-title')).toHaveAttribute('placeholder', /^E2e nf task/);
    await page.getByTestId('new-title').fill('E2E form task');
    await page.getByTestId('new-description').fill('Created by the NewEntryForm spec');
    await page.getByTestId('new-state').click();
    await page.getByRole('option', { name: 'In progress' }).click();
    await expect(page.getByTestId('new-state')).toContainText('In progress');
    // typed text is split on whitespace (UX-26): two tags
    await page.getByTestId('new-add-tag').fill('alpha beta');
    await page.getByTestId('new-add-tag').press('Enter');
    await expect(page.getByTestId('new-tags')).toContainText('alpha');
    await expect(page.getByTestId('new-tags')).toContainText('beta');
    await page.getByTestId('new-submit').click();

    await expect(page).toHaveURL(new RegExp(`/task/${nTask}$`));
    await expect(page.getByTestId('detail-slug')).toHaveText(nTask);
    await expect(page.getByTestId('detail-meta')).toContainText('In progress');
    await expect(page.getByTestId('detail-meta')).toContainText('alpha');
    const file = readDataText(`task/${nTask}/index.md`);
    expect(file).toContain(`name: ${nTask}`);
    expect(file).toContain('title: E2E form task');
    expect(file).toContain('state: in-progress');
    expect(file).toContain('tags: [alpha, beta]');

    // the project owns the link: a `child` entry in its frontmatter
    const response = await request.get(`${API}/entry/project/${nProject}`);
    expect(response.status()).toBe(200);
    const { frontmatter } = (await response.json()) as {
      frontmatter: { links?: { dataset: string; slug: string; rel: string }[] };
    };
    expect(frontmatter.links).toContainEqual({ dataset: 'task', slug: nTask, rel: 'child' });
  });

  test('an empty form shows what is missing, sends nothing and focuses the name', async ({
    page,
  }) => {
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(r.url());
    });
    await openNewEntry(page, 'task');
    await expect(page.getByTestId('new-parent')).toContainText('None');
    await page.getByTestId('new-submit').click();
    await expect(page.getByTestId('new-error')).toHaveText('Fix the highlighted fields');
    await expect(page.locator('.ck-field__error')).toHaveText(['Required', 'Required']);
    await expect(page.getByTestId('new-name')).toBeFocused();

    // the name rule is live: invalid and taken names are refused while typing
    await page.getByTestId('new-name').fill('Bad Name');
    await expect(page.locator('.ck-field__error').first()).toContainText('lowercase letters');
    await page.getByTestId('new-name').fill(nTask);
    await expect(page.locator('.ck-field__error').first()).toHaveText(
      'A task with this name already exists',
    );
    expect(writes).toEqual([]);
  });

  test('a name the server already has (stale list) is refused with a 409 on the name', async ({
    page,
  }) => {
    // The client thinks nothing exists, so only the server can refuse.
    await page.route('**/api/entries?dataset=task', (route) =>
      route.fulfill({ json: { entries: [] } }),
    );
    await openNewEntry(page, 'task');
    await page.getByTestId('new-name').fill('write-agents-md');
    await expect(page.locator('.ck-field__error')).toHaveCount(0);
    await page.getByTestId('new-description').fill('Duplicate of a seed task');
    await page.getByTestId('new-submit').click();
    await expect(page.locator('.ck-field__error')).toHaveText(
      'A task with this name already exists',
    );
    await expect(page.getByTestId('new-error')).toHaveText('A task with this name already exists');
    await expect(page).toHaveURL(/\/new\/task$/);
    // typing a new name clears the server error
    await page.getByTestId('new-name').fill('write-agents-md-2');
    await expect(page.locator('.ck-field__error')).toHaveCount(0);
  });

  test('a ?parent= that is not a project is reported and can be cleared with None', async ({
    page,
  }) => {
    await openNewEntry(page, 'task', '?parent=e2e-no-such-project');
    await expect(page.locator('.ck-field__error')).toHaveText(
      'Project "e2e-no-such-project" does not exist',
    );
    await page.getByTestId('new-parent').click();
    await page.getByRole('option', { name: 'None' }).click();
    await expect(page.locator('.ck-field__error')).toHaveCount(0);
  });

  test('/new/skill has no state, title or tags; Create opens the skill', async ({ page }) => {
    await openNewEntry(page, 'skill');
    await expect(page.getByTestId('new-state')).toHaveCount(0);
    await expect(page.getByTestId('new-title')).toHaveCount(0);
    await expect(page.getByTestId('new-tags')).toHaveCount(0);
    await expect(page.getByTestId('new-submit')).toHaveText('Create skill');
    await page.getByTestId('new-name').fill(nSkill);
    await page.getByTestId('new-description').fill('A skill from the form. Use when testing it.');
    await page.getByTestId('new-description').press('Enter');

    await expect(page).toHaveURL(new RegExp(`/skill/${nSkill}$`));
    await expect(page.getByTestId('detail-slug')).toHaveText(nSkill);
    expect(readDataText(`skill/${nSkill}/SKILL.md`)).toContain(`name: ${nSkill}`);
  });

  test('/new/kb has title and tags but no state', async ({ page }) => {
    await openNewEntry(page, 'kb');
    await expect(page.getByTestId('new-title')).toBeVisible();
    await expect(page.getByTestId('new-tags')).toBeVisible();
    await expect(page.getByTestId('new-state')).toHaveCount(0);
    await expect(page.getByTestId('new-parent')).toBeVisible();
  });

  test('Cancel leaves a clean form for the list', async ({ page }) => {
    await openNewEntry(page, 'bug');
    await page.getByTestId('new-cancel').click();
    await expect(page).toHaveURL(/\/bug$/);
  });

  test('a fresh parked navigation resumes; a stale one does not', async ({ page }) => {
    await openNewEntry(page, 'task');
    await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [
      NAV_KEY,
      `${Date.now() - 60_000}|/kb/ctxman`,
    ] as const);
    await page.reload();
    await expect(page.getByTestId('new-name')).toBeVisible();
    // The resume decision is synchronous at mount (initNewEntry): a stale park leaves the URL alone.
    await expect(page).toHaveURL(/\/new\/task$/);

    await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [
      NAV_KEY,
      `${Date.now()}|/kb/ctxman`,
    ] as const);
    await page.reload();
    await expect(page).toHaveURL(/\/kb\/ctxman$/);
  });

  test('the list page "New" button of an okf dataset opens its form', async ({ page }) => {
    await page.goto('/kb');
    const link = page.getByTestId('list-new-entry');
    await expect(link).toHaveAttribute('href', '/new/kb');
    await link.click();
    await expect(page.getByTestId('new-entry-form')).toBeVisible();
  });
});

// ---------------------------------------------------------------- edit mode (/<ds>/<slug>?edit=1)

/** A reference through the API (it is on disk once the 201 arrives). */
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
  const list = await request.get(`${API}/entries?dataset=reference`);
  const { entries } = (await list.json()) as { entries: { slug: string }[] };
  expect(entries.map((e) => e.slug)).toContain(name);
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

    await expect(page).toHaveURL(new RegExp(`/reference/${name}$`));
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
    await expect(page).toHaveURL(/\/reference$/);
    expect(dataExists(`reference/${name}.yaml`)).toBe(false);
    await expect(page.locator(`[data-testid="list-row"][data-slug="${name}"]`)).toHaveCount(0);
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
    await expect(page).toHaveURL(new RegExp(`/reference/${name}$`));
    await expect(page.getByTestId('detail-content')).toContainText('From the yaml tab');
    expect(readYaml(`reference/${name}.yaml`)).toMatchObject({ description: 'From the yaml tab' });
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

    await expect(page).toHaveURL(new RegExp(`/context/${name}$`));
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
    await expect(page).toHaveURL(/\/context$/);
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

    await expect(page).toHaveURL(new RegExp(`/recipe/${name}$`));
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
  test('?edit=1 on a missing yaml entry is the plain 404 page (the form never mounts)', async ({
    page,
  }) => {
    const response = await page.goto('/reference/e2e-no-such-reference?edit=1');
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('notfound-path')).toBeVisible();
    await expect(page.getByTestId('dform-not-found')).toHaveCount(0);
    // without ?edit=1 it is the same not-found page
    const plain = await page.goto('/reference/e2e-no-such-reference');
    expect(plain?.status()).toBe(404);
    await expect(page.getByTestId('notfound-path')).toBeVisible();
  });

  test('/new/<ds> exists for every dataset and is a 404 for anything else', async ({ page }) => {
    for (const ds of ['nope', 'index', 'forge']) {
      const response = await page.goto(`/new/${ds}`);
      expect(response?.status(), ds).toBe(404);
    }
    for (const ds of ['reference', 'context', 'recipe']) {
      const ok = await page.goto(`/new/${ds}`);
      expect(ok?.status(), ds).toBe(200);
      await expect(page.getByTestId('dform')).toBeVisible();
    }
    for (const ds of ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project', 'skill']) {
      const ok = await page.goto(`/new/${ds}`);
      expect(ok?.status(), ds).toBe(200);
      await expect(page.getByTestId('new-entry-form')).toBeVisible();
      await expect(page.getByTestId('new-submit')).toHaveText(/^Create /);
    }
  });
});
