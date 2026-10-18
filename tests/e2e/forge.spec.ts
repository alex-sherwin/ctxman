// Context Forge (UI_SPEC §H, ROUND2_UI_SPEC §D, ROUND3_SPEC §E.8 / §G): New context dialog, Discover + add and its
// tab counts, the All tab and "Add with children", invalid entries, the links list (kit OrderedList: drag and drop
// by mouse and keyboard, up / down fallback), notes in Monaco, save / reorder / reload, the context Select, YAML
// view validation, delete, and the draft that survives a reload (no native beforeunload prompt). Contexts are
// created per test through the API so tests stay independent;
// every assertion on persisted data reads the YAML file or the API, not the rendered page alone.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  API,
  dataExists,
  dataPath,
  modKey,
  pasteIntoMonaco,
  readYaml,
  settleDevReload,
  typeIntoMonaco,
} from './helpers.ts';

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

async function createContextViaApi(
  request: APIRequestContext,
  name: string,
  links: SavedLink[] = [],
): Promise<void> {
  const response = await request.post(`${API}/context`, {
    data: { name, description: `E2E context ${name}`, tags: [], links },
  });
  expect(response.status()).toBe(201);
}

/** Four seed entries, in a fixed order, for the reorder tests. */
const FOUR_LINKS: SavedLink[] = [
  { dataset: 'kb', slug: 'ctxman' },
  { dataset: 'task', slug: 'write-agents-md' },
  { dataset: 'bug', slug: 'stale-badge-timezone' },
  { dataset: 'kb', slug: 'okf-format' },
];
const FOUR_KEYS = FOUR_LINKS.map((l) => `${l.dataset}:${l.slug}`);

/** A context with the four links, open in the Forge with its rows rendered. */
async function openFourLinks(page: Page, request: APIRequestContext): Promise<string> {
  const name = uniqueName('e2e-ctx');
  await createContextViaApi(request, name, FOUR_LINKS);
  await page.goto(`/forge?context=${name}`);
  await expect(page.getByTestId('forge-link')).toHaveCount(4);
  expect(await linkKeys(page)).toEqual(FOUR_KEYS);
  // The entries cache fills in after mount (row titles, tab counts) and re-renders the rows: let it settle
  // before a test starts dragging.
  await expect(page.getByTestId('forge-tab-reference')).toContainText(/\d+$/);
  await expect(page.getByTestId('forge-tab-skill')).toContainText(/\d+$/);
  return name;
}

/** The accessible name of the focused element (during a keyboard drag: "Insert between X and Y"). */
const focusedLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');

/**
 * Keyboard drag of the row at `from`: Enter on its handle, `downs` x ArrowDown over the drop targets. Waits for
 * the focus to land on each drop target (react-aria moves it asynchronously, and a key pressed too early is
 * lost). Leaves the drag open: finish it with Enter (drop) or Escape (cancel).
 */
async function keyboardDrag(page: Page, from: number, downs: number): Promise<void> {
  await page.getByTestId('forge-link-handle').nth(from).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => focusedLabel(page)).toMatch(/^Insert /);
  for (let i = 0; i < downs; i++) {
    const previous = await focusedLabel(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedLabel(page)).not.toBe(previous);
  }
}

/** The links on disk, as `dataset:slug`. */
function savedKeys(name: string): string[] {
  return savedContext(name).links.map((l) => `${l.dataset}:${l.slug}`);
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
});

test('the context page lists the links in the order the Forge saved', async ({ page, request }) => {
  const name = uniqueName('e2e-ctx');
  await createContextViaApi(request, name, [
    { dataset: 'kb', slug: 'ctxman' },
    { dataset: 'task', slug: 'write-agents-md' },
  ]);
  await page.goto(`/forge?context=${name}`);
  await expect(page.getByTestId('forge-link')).toHaveCount(2);
  await page.getByTestId('forge-link-down').first().click();
  await page.getByTestId('forge-save').click();
  await expect(page.getByTestId('forge-status')).toContainText('Saved');
  // task before kb: the saved order, not the registry's dataset order (kb first)
  await expect.poll(() => savedKeys(name)).toEqual(['task:write-agents-md', 'kb:ctxman']);

  await page.goto(`/context/${name}`);
  const links = page.getByTestId('context-link');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAttribute('data-slug', 'write-agents-md');
  await expect(links.nth(1)).toHaveAttribute('data-slug', 'ctxman');
});

test.describe('Discover tab counts', () => {
  const DATASETS = ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project', 'skill', 'reference'];

  test('every tab shows its count on load, without a click', async ({ page, request }) => {
    await page.goto('/forge');
    for (const ds of ['all', ...DATASETS]) {
      await expect(page.getByTestId(`forge-tab-${ds}`)).toContainText(/\d+$/);
    }
    // All = the sum of the dataset tabs
    const counts = await Promise.all(
      DATASETS.map(async (ds) => {
        const text = await page.getByTestId(`forge-tab-${ds}`).innerText();
        return Number(/(\d+)$/.exec(text)?.[1]);
      }),
    );
    const total = counts.reduce((a, b) => a + b, 0);
    await expect(page.getByTestId('forge-tab-all')).toContainText(new RegExp(`${total}$`));
    for (const ds of ['kb', 'reference']) {
      const api = await request.get(`${API}/entries?dataset=${ds}`);
      const { entries } = (await api.json()) as { entries: unknown[] };
      await expect(page.getByTestId(`forge-tab-${ds}`)).toContainText(String(entries.length));
    }
    // The active tab was not the only one fetched: no tab other than kb was clicked.
    await expect(page).not.toHaveURL(/dataset=/);
  });

  test('a tab shows an ellipsis while its entries load', async ({ page }) => {
    await page.route('**/api/entries**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    await page.goto('/forge');
    await expect(page.getByTestId('forge-tab-kb')).toBeVisible();
    // every dataset tab plus the All tab
    await expect(page.locator('.ck-tabs__count[data-loading]')).toHaveCount(DATASETS.length + 1);
    await expect(page.getByTestId('forge-tab-kb')).toContainText(/\d+$/);
    await expect(page.locator('.ck-tabs__count[data-loading]')).toHaveCount(0);
  });
});

test.describe('Links list (drag and drop)', () => {
  test('a drag handle reorders by keyboard; Save writes the new order', async ({
    page,
    request,
  }) => {
    const name = await openFourLinks(page, request);
    const [a, b, c, d] = FOUR_KEYS;

    // Focus the handle of row 1, lift it with Enter, ArrowDown over the drop targets, drop with Enter.
    await keyboardDrag(page, 0, 2);
    await page.keyboard.press('Enter');
    await expect.poll(() => linkKeys(page)).toEqual([b, c, a, d]);
    await expect(page.getByTestId('forge-status')).toHaveText('Unsaved changes');
    expect(savedKeys(name)).toEqual(FOUR_KEYS); // nothing written before Save

    await page.getByTestId('forge-save').click();
    await expect(page.getByTestId('forge-status')).toContainText('Saved');
    await expect.poll(() => savedKeys(name)).toEqual([b, c, a, d]);
    const api = await request.get(`${API}/context/${name}`);
    const body = (await api.json()) as { context: SavedContext };
    expect(body.context.links.map((l) => `${l.dataset}:${l.slug}`)).toEqual([b, c, a, d]);
  });

  test('Escape cancels a keyboard drag', async ({ page, request }) => {
    await openFourLinks(page, request);
    await keyboardDrag(page, 0, 1);
    await page.keyboard.press('Escape');
    await expect.poll(() => focusedLabel(page)).not.toMatch(/^Insert /);
    expect(await linkKeys(page)).toEqual(FOUR_KEYS);
    await expect(page.getByTestId('forge-status')).toHaveText('No changes');
  });

  test('a mouse drag from the grip reorders; Save writes the new order', async ({
    page,
    request,
  }) => {
    const name = await openFourLinks(page, request);
    const [a, b, c, d] = FOUR_KEYS;

    const handle = await page.getByTestId('forge-link-handle').first().boundingBox();
    const third = await page.getByTestId('forge-link').nth(2).boundingBox();
    expect(handle).not.toBeNull();
    expect(third).not.toBeNull();
    if (handle === null || third === null) return;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 10, handle.y + 30, { steps: 5 });
    await page.mouse.move(third.x + 100, third.y + third.height - 4, { steps: 15 });
    await page.mouse.up();
    await expect.poll(() => linkKeys(page)).toEqual([b, c, a, d]);

    await page.getByTestId('forge-save').click();
    await expect(page.getByTestId('forge-status')).toContainText('Saved');
    await expect.poll(() => savedKeys(name)).toEqual([b, c, a, d]);
  });

  test('a mouse drag that starts outside the grip does not move a row', async ({
    page,
    request,
  }) => {
    await openFourLinks(page, request);
    const badge = await page.getByTestId('forge-link').first().locator('.ck-badge').boundingBox();
    const third = await page.getByTestId('forge-link').nth(2).boundingBox();
    expect(badge).not.toBeNull();
    expect(third).not.toBeNull();
    if (badge === null || third === null) return;
    await page.mouse.move(badge.x + badge.width / 2, badge.y + badge.height / 2);
    await page.mouse.down();
    await page.mouse.move(badge.x + 10, badge.y + 30, { steps: 5 });
    await page.mouse.move(third.x + 100, third.y + third.height - 4, { steps: 15 });
    await page.mouse.up();
    expect(await linkKeys(page)).toEqual(FOUR_KEYS);
    await expect(page.getByTestId('forge-status')).toHaveText('No changes');
  });

  test('the up / down buttons keep the focus on the moved row', async ({ page, request }) => {
    await openFourLinks(page, request);
    const [a, b] = FOUR_KEYS;
    const row = (key: string) => page.locator(`[data-testid="forge-link"][data-key="${key}"]`);

    await row(a).getByTestId('forge-link-down').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => linkKeys(page)).toEqual([b, a, ...FOUR_KEYS.slice(2)]);
    await expect(row(a).getByTestId('forge-link-down')).toBeFocused();

    await row(a).getByTestId('forge-link-up').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => linkKeys(page)).toEqual(FOUR_KEYS);
    await expect(row(a).getByTestId('forge-link-up')).toBeDisabled(); // first row: no "up"
    await expect(row(a).getByTestId('forge-link-down')).toBeFocused(); // falls back to the other button
  });

  test('typing in a notes editor inside a row works, the collapsed row previews it, and Cmd/Ctrl+S saves from there', async ({
    page,
    request,
  }) => {
    const name = await openFourLinks(page, request);
    const row = page.locator('[data-testid="forge-link"][data-key="task:write-agents-md"]');
    await row.getByTestId('forge-link-notes-toggle').click();
    await expect(page.getByTestId('forge-link-notes').locator('.monaco-editor')).toBeVisible();
    // Letters, Space, Home / End and Enter belong to the editor, not to the list's keyboard navigation.
    await typeIntoMonaco(page, 'forge-link-notes', 'first line here');
    await page.keyboard.press('Home');
    await page.keyboard.type('Start: ');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second');
    await expect(page.getByTestId('forge-status')).toHaveText('Unsaved changes');

    // Rows stop their key events from bubbling; the shortcut must still reach the store.
    const put = page.waitForResponse(
      (res) => res.request().method() === 'PUT' && res.url().includes(`/api/context/${name}`),
    );
    await page.keyboard.press(`${modKey}+s`);
    expect((await put).status()).toBe(200);
    await expect(page.getByTestId('forge-status')).toContainText('Saved');
    const notes = savedContext(name).links.find((l) => l.slug === 'write-agents-md')?.notes;
    expect(notes?.trim().split('\n')).toEqual(['Start: first line here', 'second']);

    await row.getByTestId('forge-link-notes-toggle').click();
    await expect(row.getByTestId('forge-link-notes-preview')).toHaveText('Start: first line here');
    await expect(page.getByTestId('forge-link-notes')).toHaveCount(0);
  });
});

test('the context Select filters its options and keeps "New context…" pinned', async ({ page }) => {
  await page.goto('/forge?context=ctxman-dev');
  await expect(page.getByTestId('forge-context-name')).toHaveValue('ctxman-dev');
  const trigger = page.getByTestId('forge-context-select');
  await trigger.click();
  const search = page.getByTestId('forge-context-select-search');
  await expect(search).toBeFocused();
  await expect(page.getByRole('option', { name: /okf-authoring/ })).toBeVisible();

  await search.fill('okf-auth');
  await expect(page.getByRole('option', { name: /okf-authoring/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /ctxman-dev/ })).toHaveCount(0);
  await expect(page.getByTestId('forge-context-new')).toBeVisible();

  await search.fill('no-such-context-zzz');
  await expect(page.getByRole('option', { name: /okf-authoring/ })).toHaveCount(0);
  await expect(page.getByTestId('forge-context-new')).toBeVisible(); // pinned: never filtered out

  await page.getByTestId('forge-context-new').click();
  await expect(page).toHaveURL(/[?&]context=new(&|$)/);
  await expect(page.getByTestId('forge-new-dialog')).toBeVisible();
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
  // A syntax error is marked by monaco-yaml (error squiggle); its worker starts with the first YAML editor,
  // so give a cold dev server time.
  await expect(
    page.getByTestId('forge-yaml-editor').locator('.squiggly-error').first(),
  ).toBeAttached({ timeout: 15_000 });
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

test.describe('YAML view diagnostics', () => {
  /** Puts the caret at the end of line 1 (`name: …`) without relying on a platform-specific shortcut. */
  async function endOfFirstLine(page: Page): Promise<void> {
    await page.getByTestId('forge-yaml-editor').locator('.view-line').first().click();
    await page.keyboard.press('End');
  }

  test('a problem the JSON Schema covers is drawn by monaco-yaml and listed', async ({
    page,
    request,
  }) => {
    const name = uniqueName('e2e-ctx');
    await createContextViaApi(request, name);
    await page.goto(`/forge?context=${name}&view=yaml`);
    const editor = page.getByTestId('forge-yaml-editor');
    await expect(editor.locator('.monaco-editor')).toBeVisible();

    await endOfFirstLine(page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('bogus: 1');
    await expect(page.getByTestId('forge-yaml-issues')).toContainText('invalid');
    await expect(page.getByTestId('forge-yaml-issue').first()).toContainText('bogus');
    // The store hands the editor no marker for it (the schema covers it), so this squiggle is monaco-yaml's
    // (schema violations are warnings there; its worker starts with the first YAML editor).
    await expect(editor.locator('.squiggly-warning').first()).toBeAttached({ timeout: 15_000 });
    await expect(editor.locator('.squiggly-error')).toHaveCount(0);
    await expect(page.getByTestId('forge-save')).toBeDisabled();
  });

  test('a problem only the app can detect (a changed name) is still marked and listed', async ({
    page,
    request,
  }) => {
    const name = uniqueName('e2e-ctx');
    await createContextViaApi(request, name);
    await page.goto(`/forge?context=${name}&view=yaml`);
    const editor = page.getByTestId('forge-yaml-editor');
    await expect(editor.locator('.monaco-editor')).toBeVisible();

    await endOfFirstLine(page);
    await page.keyboard.type('-renamed');
    await expect(page.getByTestId('forge-yaml-issue').first()).toContainText('name must stay');
    await expect(editor.locator('.squiggly-error').first()).toBeAttached();
    await expect(page.getByTestId('forge-save')).toBeDisabled();
    await expect(page.getByTestId('forge-view-form')).toBeDisabled();
  });
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

/** Opens /forge on context `name` (plus extra query text) and waits until it is loaded. */
async function openContext(page: Page, name: string, query = ''): Promise<void> {
  await page.goto(`/forge?context=${name}${query}`);
  await expect(page.getByTestId('forge-context-name')).toHaveValue(name);
}

/** The `child` relations of a seed entry, as `dataset:slug` in file order (from the entries API). */
async function childKeysOf(
  request: APIRequestContext,
  dataset: string,
  slug: string,
): Promise<string[]> {
  const response = await request.get(`${API}/entries?dataset=${dataset}`);
  const { entries } = (await response.json()) as {
    entries: { slug: string; relations?: { dataset: string; slug: string; rel: string }[] }[];
  };
  const entry = entries.find((e) => e.slug === slug);
  return (entry?.relations ?? [])
    .filter((r) => r.rel === 'child')
    .map((r) => `${r.dataset}:${r.slug}`);
}

test.describe('All tab', () => {
  test('lists rows of several datasets, filters across them and adds from it', async ({
    page,
    request,
  }) => {
    const name = uniqueName('e2e-ctx');
    await createContextViaApi(request, name);
    await openContext(page, name);
    await page.getByTestId('forge-tab-all').click();
    await expect(page).toHaveURL(/[?&]dataset=all(&|$)/);

    // rows of more than one dataset, each saying which; no per-lifecycle state chips on the merged list
    const datasets = async () =>
      new Set(
        await page
          .getByTestId('forge-result')
          .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.dataset)),
      );
    await expect.poll(async () => (await datasets()).size).toBeGreaterThan(4);
    for (const ds of ['kb', 'task', 'skill']) expect(await datasets()).toContain(ds);
    await expect(page.locator('[data-testid="forge-result"] .ck-badge--ds').first()).toBeVisible();
    await expect(page.getByTestId('forge-state-chips')).toHaveCount(0);
    await expect(page.getByTestId('forge-tag-chips')).toBeVisible();

    // the filter spans datasets: "agents" matches a task and a kb / idea entry
    await page.getByTestId('forge-filter-q').fill('agents');
    await expect(page).toHaveURL(/[?&]q=agents(&|$)/);
    await expect
      .poll(async () => (await datasets()).has('task') && (await datasets()).size >= 2)
      .toBe(true);

    // add from the merged list
    const row = page.locator(
      '[data-testid="forge-result"][data-dataset="task"][data-slug="write-agents-md"]',
    );
    await row.getByTestId('forge-add').click();
    await expect(
      page.locator('[data-testid="forge-link"][data-key="task:write-agents-md"]'),
    ).toBeVisible();
    await expect(row).toHaveAttribute('data-added', 'true');
    await page.getByTestId('forge-save').click();
    await expect(page.getByTestId('forge-status')).toContainText('Saved');
    await expect.poll(() => savedKeys(name)).toEqual(['task:write-agents-md']);
  });

  test('the All tab is URL state: it survives a reload and the back button', async ({ page }) => {
    await page.goto('/forge?dataset=all&q=forge');
    await expect(page.getByTestId('forge-filter-q')).toHaveValue('forge');
    await expect(page.getByTestId('forge-tab-all')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.getByTestId('forge-result').count()).toBeGreaterThan(1);
    await page.getByTestId('forge-tab-task').click();
    await expect(page).toHaveURL(/[?&]dataset=task(&|$)/);
    await page.goBack();
    await expect(page).toHaveURL(/[?&]dataset=all(&|$)/);
    await expect(page.getByTestId('forge-tab-all')).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Add with children', () => {
  test('a project is added together with its children, in file order', async ({
    page,
    request,
  }) => {
    const children = await childKeysOf(request, 'project', 'ctxman-v1');
    expect(children.length).toBeGreaterThanOrEqual(10);
    const name = uniqueName('e2e-ctx');
    await createContextViaApi(request, name);
    await openContext(page, name, '&dataset=all');

    await page.getByTestId('forge-filter-q').fill('ctxman-v1');
    const row = page.locator('[data-testid="forge-result"][data-slug="ctxman-v1"]');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('forge-add-children')).toContainText(
      new RegExp(`add with ${children.length} children`, 'i'),
    );
    await row.getByTestId('forge-add-children').click();
    await expect(page.getByTestId('forge-link')).toHaveCount(children.length + 1);
    expect(await linkKeys(page)).toEqual(['project:ctxman-v1', ...children]);
    // everything is linked: no children button left, the row is marked added
    await expect(row.getByTestId('forge-add-children')).toHaveCount(0);
    await expect(row).toHaveAttribute('data-added', 'true');

    await page.getByTestId('forge-save').click();
    await expect(page.getByTestId('forge-status')).toContainText('Saved');
    await expect.poll(() => savedKeys(name)).toEqual(['project:ctxman-v1', ...children]);
  });

  test('children that are already linked are skipped and not counted', async ({
    page,
    request,
  }) => {
    const children = await childKeysOf(request, 'project', 'ctxman-v1');
    const linked = children[2] ?? '';
    const [dataset, slug] = linked.split(':');
    const name = uniqueName('e2e-ctx');
    await createContextViaApi(request, name, [{ dataset: dataset ?? '', slug: slug ?? '' }]);
    await openContext(page, name, '&dataset=project');

    const row = page.locator('[data-testid="forge-result"][data-slug="ctxman-v1"]');
    await expect(row.getByTestId('forge-add-children')).toContainText(
      new RegExp(`add with ${children.length - 1} children`, 'i'),
    );
    await row.getByTestId('forge-add-children').click();
    // the pre-linked child keeps its place, the project and the other children follow
    const expected = [linked, 'project:ctxman-v1', ...children.filter((k) => k !== linked)];
    await expect(page.getByTestId('forge-link')).toHaveCount(expected.length);
    expect(await linkKeys(page)).toEqual(expected);
  });

  test('an already added project offers only its missing children', async ({ page, request }) => {
    const children = await childKeysOf(request, 'project', 'ctxman-v1');
    const name = uniqueName('e2e-ctx');
    await createContextViaApi(request, name, [{ dataset: 'project', slug: 'ctxman-v1' }]);
    await openContext(page, name, '&dataset=project');
    const row = page.locator('[data-testid="forge-result"][data-slug="ctxman-v1"]');
    await expect(row).toHaveAttribute('data-added', 'true');
    await expect(row.getByTestId('forge-add-children')).toContainText(
      new RegExp(`\\+ add ${children.length} children`, 'i'),
    );
    await row.getByTestId('forge-add-children').click();
    await expect(page.getByTestId('forge-link')).toHaveCount(children.length + 1);
    expect(await linkKeys(page)).toEqual(['project:ctxman-v1', ...children]);
  });

  test('an entry without children has no such button', async ({ page, request }) => {
    const name = uniqueName('e2e-ctx');
    await createContextViaApi(request, name);
    await openContext(page, name, '&dataset=task');
    await expect(page.getByTestId('forge-result').first()).toBeVisible();
    await expect(page.getByTestId('forge-add-children')).toHaveCount(0);
  });
});

test.describe('Invalid entries', () => {
  test('an entry whose file fails its schema is listed, flagged and dimmed', async ({
    page,
    request,
  }) => {
    const slug = uniqueName('e2e-invalid-idea');
    const dir = dataPath(`idea/${slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/index.md`,
      `---\ntype: Idea\nname: ${slug}\ndescription: An idea with a state that does not exist\nstate: done\n---\n\n# Bad\n`,
    );
    try {
      await settleDevReload();
      const name = uniqueName('e2e-ctx');
      await createContextViaApi(request, name);
      await openContext(page, name, `&dataset=all&q=${slug}`);
      const row = page.locator(`[data-testid="forge-result"][data-slug="${slug}"]`);
      await expect(row).toHaveCount(1);
      await expect(row).toHaveAttribute('data-invalid', '');
      await expect(row.getByTestId('forge-invalid')).toContainText('invalid');
      await expect(row.getByTestId('forge-invalid').locator('.ck-badge')).toHaveAttribute(
        'title',
        /state/,
      );
      // still addable: the link row carries the flag too
      await row.getByTestId('forge-add').click();
      const link = page.locator(`[data-testid="forge-link"][data-key="idea:${slug}"]`);
      await expect(link).toBeVisible();
      await expect(link).toContainText('invalid');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await settleDevReload();
    }
  });
});

test.describe('Unsaved changes survive a reload (no native prompt)', () => {
  /** Counts native dialogs and reports whether a `beforeunload` handler asks to block the unload. */
  function watchDialogs(page: Page): { count: () => number } {
    let count = 0;
    page.on('dialog', (dialog) => {
      count++;
      void dialog.dismiss();
    });
    return { count: () => count };
  }
  const blocksUnload = (page: Page) =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });

  test('a reload restores the draft with a banner; Discard goes back to the saved context', async ({
    page,
    request,
  }) => {
    const name = uniqueName('e2e-ctx');
    await createContextViaApi(request, name, [{ dataset: 'kb', slug: 'ctxman' }]);
    const dialogs = watchDialogs(page);
    await openContext(page, name);
    await expect(page.getByTestId('forge-draft-restored')).toHaveCount(0);

    await addFromDiscover(page, 'task', 'write-agents-md');
    await page.getByTestId('forge-context-description').fill('Edited but not saved');
    await expect(page.getByTestId('forge-status')).toContainText('Unsaved');
    expect(await blocksUnload(page)).toBe(false);

    await page.reload();
    await expect(page.getByTestId('forge-draft-restored')).toBeVisible();
    await expect(page.getByTestId('forge-draft-restored')).toContainText(
      'Restored unsaved changes from earlier.',
    );
    await expect(page.getByTestId('forge-draft-restored')).not.toHaveAttribute('data-stale', /.*/);
    expect(dialogs.count()).toBe(0);
    expect(await linkKeys(page)).toEqual(['kb:ctxman', 'task:write-agents-md']);
    await expect(page.getByTestId('forge-context-description')).toHaveValue('Edited but not saved');
    await expect(page.getByTestId('forge-status')).toContainText('Unsaved');

    // nothing was written to disk, and the draft outlives a second reload
    expect(savedContext(name).description).toBe(`E2E context ${name}`);
    expect(savedKeys(name)).toEqual(['kb:ctxman']);
    await page.reload();
    await expect(page.getByTestId('forge-draft-restored')).toBeVisible();
    await expect(page.getByTestId('forge-link')).toHaveCount(2);

    await page.getByTestId('forge-draft-discard').click();
    await expect(page.getByTestId('forge-draft-restored')).toHaveCount(0);
    expect(await linkKeys(page)).toEqual(['kb:ctxman']);
    await expect(page.getByTestId('forge-context-description')).toHaveValue(`E2E context ${name}`);
    await expect(page.getByTestId('forge-status')).toHaveText('No changes');
    await page.reload();
    await expect(page.getByTestId('forge-context-name')).toHaveValue(name);
    await expect(page.getByTestId('forge-draft-restored')).toHaveCount(0);
    expect(await linkKeys(page)).toEqual(['kb:ctxman']);
    expect(dialogs.count()).toBe(0);
  });

  test('a draft of a file that changed on disk is restored with the stale warning; Save clears it', async ({
    page,
    request,
  }) => {
    const name = uniqueName('e2e-ctx');
    await createContextViaApi(request, name, [{ dataset: 'kb', slug: 'ctxman' }]);
    await openContext(page, name);
    await addFromDiscover(page, 'task', 'write-agents-md');

    // the file changes behind the draft's back
    const put = await request.put(`${API}/context/${name}`, {
      data: {
        name,
        description: 'changed elsewhere',
        tags: [],
        links: [{ dataset: 'kb', slug: 'ctxman' }],
      },
    });
    expect(put.status()).toBe(200);

    await page.reload();
    const banner = page.getByTestId('forge-draft-restored');
    await expect(banner).toHaveAttribute('data-stale', 'true');
    await expect(banner).toContainText('the file changed on disk since');
    expect(await linkKeys(page)).toEqual(['kb:ctxman', 'task:write-agents-md']);
    // still stale after another reload: the warning is about the draft's base, not about this visit
    await page.reload();
    await expect(page.getByTestId('forge-draft-restored')).toHaveAttribute('data-stale', 'true');

    // saving overwrites the file, clears the draft and the banner
    await page.getByTestId('forge-save').click();
    await expect(page.getByTestId('forge-status')).toContainText('Saved');
    await expect(page.getByTestId('forge-draft-restored')).toHaveCount(0);
    await expect.poll(() => savedKeys(name)).toEqual(['kb:ctxman', 'task:write-agents-md']);
    await page.reload();
    await expect(page.getByTestId('forge-link')).toHaveCount(2);
    await expect(page.getByTestId('forge-draft-restored')).toHaveCount(0);
  });

  test('the in-app discard dialog still guards a context switch', async ({ page, request }) => {
    const a = uniqueName('e2e-ctx');
    const b = uniqueName('e2e-ctx');
    await createContextViaApi(request, a);
    await createContextViaApi(request, b);
    await openContext(page, a);
    await page.getByTestId('forge-context-description').fill('Unsaved');
    await page.getByTestId('forge-context-select').click();
    await page.getByRole('option', { name: b, exact: true }).click();
    const dialog = page.getByTestId('forge-discard-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('forge-context-name')).toHaveValue(b);
    // discarded for good: coming back to `a` finds no draft
    await openContext(page, a);
    await expect(page.getByTestId('forge-draft-restored')).toHaveCount(0);
    await expect(page.getByTestId('forge-context-description')).toHaveValue(`E2E context ${a}`);
  });
});
