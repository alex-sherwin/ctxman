// Context Forge (UI_SPEC §H): New context dialog, Discover + add, notes in Monaco, save / reorder / reload,
// YAML view validation and delete. Contexts are created per test through the API so tests stay independent;
// every assertion on persisted data reads the YAML file or the API, not the rendered page alone.
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { API, dataExists, pasteIntoMonaco, readYaml, typeIntoMonaco } from './helpers.ts';

interface SavedLink {
  dataset: string;
  slug: string;
  notes?: string;
}
interface SavedContext {
  name: string;
  description: string;
  tags?: string[];
  links: SavedLink[];
}

/** A context name that no other test uses (the data copy is shared by the whole run). */
function uniqueName(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createContextViaApi(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.post(`${API}/context`, {
    data: { name, description: `E2E context ${name}`, tags: [], links: [] },
  });
  expect(response.status()).toBe(201);
}

function savedContext(name: string): SavedContext {
  return readYaml(`context/${name}.yaml`) as SavedContext;
}

/** The rendered link rows, by dataset:slug key, in display order. */
async function linkKeys(page: Page): Promise<string[]> {
  return page
    .getByTestId('forge-link')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.key ?? ''));
}

async function addFromDiscover(page: Page, dataset: string, slug: string): Promise<void> {
  await page.getByTestId(`forge-tab-${dataset}`).click();
  const row = page.locator(`[data-testid="forge-result"][data-slug="${slug}"]`);
  await expect(row).toBeVisible();
  await row.getByTestId('forge-add').click();
  await expect(
    page.locator(`[data-testid="forge-link"][data-key="${dataset}:${slug}"]`),
  ).toBeVisible();
}

test.describe('New context dialog', () => {
  test('validates the name, then creates the context and selects it', async ({ page, request }) => {
    const name = uniqueName('e2e-ctx');
    await page.goto('/forge?context=new');
    const dialog = page.getByTestId('forge-new-dialog');
    await expect(dialog).toBeVisible();
    const create = page.getByTestId('forge-new-create');
    await expect(create).toBeDisabled();

    await page.getByTestId('forge-new-name').fill('Not Valid');
    await expect(
      dialog.getByText(/Use lowercase letters, digits and single hyphens/),
    ).toBeVisible();
    await expect(create).toBeDisabled();

    await page.getByTestId('forge-new-name').fill(name);
    await expect(create).toBeDisabled(); // description is still empty
    await page.getByTestId('forge-new-description').fill('Created by the e2e suite');
    await expect(create).toBeEnabled();
    await create.click();

    await expect(page).toHaveURL(new RegExp(`[?&]context=${name}(&|$)`));
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('forge-context-name')).toHaveValue(name);
    await expect.poll(() => dataExists(`context/${name}.yaml`)).toBe(true);
    expect(savedContext(name).description).toBe('Created by the e2e suite');
    const api = await request.get(`${API}/context/${name}`);
    expect(((await api.json()) as { context: SavedContext }).context.description).toBe(
      'Created by the e2e suite',
    );
  });

  test('a name that already exists is rejected with the server message', async ({ page }) => {
    await page.goto('/forge?context=new');
    await expect(page.getByTestId('forge-new-dialog')).toBeVisible();
    // The name is checked against the contexts on disk while typing: the button stays disabled.
    await page.getByTestId('forge-new-name').fill('ctxman-dev');
    await page.getByTestId('forge-new-description').fill('Duplicate');
    await expect(page.getByTestId('forge-new-dialog').getByText(/already exists/)).toBeVisible();
    await expect(page.getByTestId('forge-new-create')).toBeDisabled();
    await expect(page).toHaveURL(/[?&]context=new(&|$)/);
    expect(savedContext('ctxman-dev').name).toBe('ctxman-dev');
  });

  test('Cancel closes the dialog and leaves the URL without context=new', async ({ page }) => {
    await page.goto('/forge?context=new');
    await expect(page.getByTestId('forge-new-dialog')).toBeVisible();
    await page.getByTestId('forge-new-cancel').click();
    await expect(page.getByTestId('forge-new-dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(/context=new/);
  });
});

test('Discover tabs and the text filter write dataset and q to the URL', async ({ page }) => {
  await page.goto('/forge');
  await expect(page.getByTestId('forge-discover')).toBeVisible();
  await page.getByTestId('forge-tab-task').click();
  await expect(page).toHaveURL(/[?&]dataset=task(&|$)/);
  await page.getByTestId('forge-filter-q').fill('agents');
  await expect(page).toHaveURL(/[?&]q=agents(&|$)/);
  await expect(page.getByTestId('forge-result-count')).toHaveText('1 of 4');
  await expect(
    page.locator('[data-testid="forge-result"][data-slug="write-agents-md"]'),
  ).toBeVisible();
  await expect(page.locator('[data-testid="forge-result"]')).toHaveCount(1);
});

test('add, annotate, save, reorder and reload a context', async ({ page, request }) => {
  const name = uniqueName('e2e-ctx');
  await createContextViaApi(request, name);
  await page.goto(`/forge?context=${name}`);
  await expect(page.getByTestId('forge-links')).toHaveCount(0);
  await expect(page.getByTestId('forge-context-name')).toHaveValue(name);

  // Add a kb entry, then a task entry from the other tab.
  await addFromDiscover(page, 'kb', 'ctxman');
  await addFromDiscover(page, 'task', 'write-agents-md');
  await expect(page.locator('[data-testid="forge-link"]')).toHaveCount(2);
  expect(await linkKeys(page)).toEqual(['kb:ctxman', 'task:write-agents-md']);

  // Notes live in a Monaco editor that mounts when the disclosure opens.
  await page
    .locator('[data-testid="forge-link"][data-key="kb:ctxman"]')
    .getByTestId('forge-link-notes-toggle')
    .click();
  await expect(page.getByTestId('forge-link-notes').locator('.monaco-editor')).toBeVisible();
  await typeIntoMonaco(page, 'forge-link-notes', 'e2e notes for ctxman');

  await page.getByTestId('forge-save').click();
  await expect(page.getByTestId('forge-status')).toContainText('Saved');
  // Notes are stored as a literal block with one trailing newline (context-io normalisation).
  await expect.poll(() => savedContext(name).links[0]?.notes?.trim()).toBe('e2e notes for ctxman');
  const api = await request.get(`${API}/context/${name}`);
  const fromApi = (await api.json()) as { context: SavedContext };
  expect(fromApi.context.links[0]?.notes?.trim()).toBe('e2e notes for ctxman');
  expect(savedContext(name).links.map((l) => `${l.dataset}:${l.slug}`)).toEqual([
    'kb:ctxman',
    'task:write-agents-md',
  ]);

  // Move the kb link down, save, and check the order on disk.
  await page
    .locator('[data-testid="forge-link"][data-key="kb:ctxman"]')
    .getByTestId('forge-link-down')
    .click();
  expect(await linkKeys(page)).toEqual(['task:write-agents-md', 'kb:ctxman']);
  await page.getByTestId('forge-save').click();
  await expect(page.getByTestId('forge-status')).toContainText('Saved');
  await expect
    .poll(() => savedContext(name).links.map((l) => l.slug))
    .toEqual(['write-agents-md', 'ctxman']);

  // The saved order and notes survive a reload.
  await page.reload();
  await expect(page.getByTestId('forge-link')).toHaveCount(2);
  expect(await linkKeys(page)).toEqual(['task:write-agents-md', 'kb:ctxman']);

  // The context page lists the same links.
  // The context page groups links by dataset (registry order: kb before task), so check each group.
  await page.goto(`/context/${name}`);
  await expect(page.getByTestId('context-link')).toHaveCount(2);
  await expect(page.getByTestId('context-group-task').getByTestId('context-link')).toHaveAttribute(
    'data-slug',
    'write-agents-md',
  );
  await expect(page.getByTestId('context-group-kb').getByTestId('context-link')).toHaveAttribute(
    'data-slug',
    'ctxman',
  );
});

test('the YAML view blocks saving invalid YAML and saves once it is valid', async ({
  page,
  request,
}) => {
  const name = uniqueName('e2e-ctx');
  await createContextViaApi(request, name);
  await page.goto(`/forge?context=${name}`);
  await expect(page.getByTestId('forge-context-name')).toHaveValue(name);

  await page.getByTestId('forge-view-yaml').click();
  await expect(page).toHaveURL(/[?&]view=yaml(&|$)/);
  await expect(page.getByTestId('forge-yaml-editor').locator('.monaco-editor')).toBeVisible();
  await expect(page.getByTestId('forge-yaml-issues')).toContainText('Valid');

  // An unclosed flow sequence appended at the end is a syntax error (9 characters: "broken: [").
  await typeIntoMonaco(page, 'forge-yaml-editor', 'broken: [');
  await expect(page.getByTestId('forge-yaml-issues')).toContainText('invalid');
  await expect(page.getByTestId('forge-yaml-issue').first()).toBeVisible();
  // Monaco draws the marker as an error squiggle on the offending line.
  await expect(
    page.getByTestId('forge-yaml-editor').locator('.squiggly-error').first(),
  ).toBeAttached();
  await expect(page.getByTestId('forge-save')).toBeDisabled();
  await expect(page.getByTestId('forge-view-form')).toBeDisabled();

  // Deleting the broken text makes the YAML valid again; saving follows.
  for (let i = 0; i < 'broken: ['.length; i++) await page.keyboard.press('Backspace');
  await expect(page.getByTestId('forge-yaml-issues')).toContainText('Valid');
  await expect(page.getByTestId('forge-save')).toBeDisabled(); // valid but unchanged

  await pasteIntoMonaco(page, 'forge-yaml-editor', 'tags:\n  - yaml\n');
  await expect(page.getByTestId('forge-save')).toBeEnabled();
  await page.getByTestId('forge-save').click();
  await expect(page.getByTestId('forge-status')).toContainText('Saved');
  await expect.poll(() => savedContext(name).tags).toEqual(['yaml']);

  await page.getByTestId('forge-view-form').click();
  await expect(page).not.toHaveURL(/view=yaml/);
  await expect(page.getByTestId('forge-context-description')).toHaveValue(`E2E context ${name}`);
});

test('deleting a context asks first, then removes it', async ({ page, request }) => {
  const name = uniqueName('e2e-ctx');
  await createContextViaApi(request, name);
  await page.goto(`/forge?context=${name}`);
  await expect(page.getByTestId('forge-context-name')).toHaveValue(name);

  await page.getByTestId('forge-delete').click();
  const dialog = page.getByTestId('forge-delete-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => dataExists(`context/${name}.yaml`)).toBe(true);

  await page.getByTestId('forge-delete').click();
  await page.getByTestId('forge-delete-dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('forge-delete-dialog')).toHaveCount(0);
  await expect.poll(() => dataExists(`context/${name}.yaml`)).toBe(false);
  const gone = await request.get(`${API}/context/${name}`);
  expect(gone.status()).toBe(404);
});
