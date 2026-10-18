// Markdown popup editors (ROUND2_UI_SPEC §F.2): the pencil buttons on the context page (a link's notes) and on the
// recipe page (preamble, markdown blocks) open a Monaco modal; Save writes the yaml through the context / recipe API
// and reloads the page. Contexts and recipes are created per run through the API (the seed recipe is never written)
// and removed afterwards; every assertion about what was saved reads the yaml file in the e2e data copy.
// Monaco in Playwright's "Desktop Chrome" profile expects Control+a / Control+End (Windows user agent).
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  API,
  createRecipeCopy,
  dataExists,
  deleteRecipeQuietly,
  readRecipeYaml,
  readYaml,
  uniqueName,
} from './helpers.ts';

interface SavedLink {
  dataset: string;
  slug: string;
  notes?: string;
}
interface SavedContext {
  name: string;
  description: string;
  links: SavedLink[];
}

const contexts: string[] = [];
const recipes: string[] = [];

test.afterEach(async ({ request }) => {
  for (const name of contexts.splice(0)) await request.delete(`${API}/context/${name}`);
  for (const name of recipes.splice(0)) await deleteRecipeQuietly(request, name);
});

async function createContext(request: APIRequestContext, links: SavedLink[]): Promise<string> {
  const name = uniqueName('e2e-mdctx');
  const response = await request.post(`${API}/context`, {
    data: { name, description: `E2E context ${name}`, tags: [], links },
  });
  expect(response.status()).toBe(201);
  contexts.push(name);
  return name;
}

async function createRecipe(request: APIRequestContext): Promise<string> {
  const name = uniqueName('e2e-mdrecipe');
  await createRecipeCopy(request, name);
  recipes.push(name);
  return name;
}

const TWO_LINKS: SavedLink[] = [
  { dataset: 'kb', slug: 'ctxman' },
  { dataset: 'task', slug: 'write-agents-md', notes: 'Existing note.' },
];

const savedContext = (name: string): SavedContext =>
  readYaml(`context/${name}.yaml`) as SavedContext;

/** Types at the very end of the modal's editor (Control+End: see the file header). */
async function typeAtEnd(page: Page, text: string): Promise<void> {
  await page.getByTestId('md-editor').locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

/** Clicks the (enabled) pencil and waits for Monaco in the modal. */
async function openPopup(page: Page, pencil: ReturnType<Page['getByTestId']>): Promise<void> {
  await expect(pencil).toBeEnabled();
  await pencil.click();
  await expect(page.getByTestId('md-modal')).toBeVisible();
  await expect(page.getByTestId('md-editor').locator('.monaco-editor')).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('context notes', () => {
  test('a note typed in the popup is saved to the yaml and shown after the reload', async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const name = await createContext(request, TWO_LINKS);
    await page.goto(`/context/${name}`);
    const first = page.getByTestId('context-link').first();
    await expect(first).toHaveAttribute('data-key', 'kb:ctxman');
    await expect(first.getByTestId('context-link-notes')).toHaveCount(0);

    await openPopup(page, first.getByTestId('context-link-edit-notes'));
    await expect(page.getByTestId('md-modal')).toContainText('Edit notes for');
    await expect(page.getByTestId('md-save')).toBeDisabled();
    await typeAtEnd(page, 'A **bold** note from the popup spec.');
    await expect(page.getByTestId('md-save')).toBeEnabled();

    const reloaded = page.waitForEvent('load', { timeout: 10_000 });
    await page.getByTestId('md-save').click();
    await reloaded;

    // the yaml has the note on the first link; the second link kept its own
    const saved = savedContext(name);
    expect(saved.links[0]?.notes).toContain('A **bold** note from the popup spec.');
    expect(saved.links[1]?.notes?.trim()).toBe('Existing note.');
    // the rendered notes show it (Markdown: bold -> <strong>)
    const notes = page.getByTestId('context-link').first().getByTestId('context-link-notes');
    await expect(notes).toContainText('A bold note from the popup spec.');
    await expect(notes.locator('strong')).toHaveText('bold');
    await expect(page.getByTestId('md-modal')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the popup loads the current notes; clearing them removes the notes key', async ({
    page,
    request,
  }) => {
    const name = await createContext(request, TWO_LINKS);
    await page.goto(`/context/${name}`);
    const second = page.getByTestId('context-link').nth(1);
    await expect(second.getByTestId('context-link-notes')).toContainText('Existing note.');

    await openPopup(page, second.getByTestId('context-link-edit-notes'));
    await expect(page.getByTestId('md-editor').locator('.view-lines')).toContainText(
      'Existing note.',
    );
    await page.getByTestId('md-editor').locator('.monaco-editor textarea').focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    const reloaded = page.waitForEvent('load', { timeout: 10_000 });
    await page.getByTestId('md-save').click();
    await reloaded;

    expect(savedContext(name).links[1]).toEqual({ dataset: 'task', slug: 'write-agents-md' });
    await expect(
      page.getByTestId('context-link').nth(1).getByTestId('context-link-notes'),
    ).toHaveCount(0);
  });

  test('Cancel with unsaved text asks first; discarding changes nothing', async ({
    page,
    request,
  }) => {
    const name = await createContext(request, TWO_LINKS);
    await page.goto(`/context/${name}`);
    await openPopup(
      page,
      page.getByTestId('context-link').first().getByTestId('context-link-edit-notes'),
    );
    await typeAtEnd(page, 'never saved');
    await page.getByTestId('md-cancel').click();
    await expect(page.getByTestId('md-discard-dialog')).toBeVisible();
    await page.getByTestId('md-discard-dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('md-discard-dialog')).toHaveCount(0);
    await expect(page.getByTestId('md-modal')).toBeVisible();

    await page.getByTestId('md-cancel').click();
    await page.getByTestId('md-discard-dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('md-modal')).toHaveCount(0);
    expect(savedContext(name).links[0]?.notes).toBeUndefined();
  });

  test('a change on disk behind the popup is a conflict; Overwrite keeps the other edits', async ({
    page,
    request,
  }) => {
    const name = await createContext(request, TWO_LINKS);
    await page.goto(`/context/${name}`);
    await openPopup(
      page,
      page.getByTestId('context-link').first().getByTestId('context-link-edit-notes'),
    );
    await typeAtEnd(page, 'popup note');

    // someone edits the description while the popup is open (a pause: the mtime must differ)
    await new Promise((resolve) => setTimeout(resolve, 50));
    const current = await request.get(`${API}/context/${name}`);
    const { context } = (await current.json()) as { context: Record<string, unknown> };
    const put = await request.put(`${API}/context/${name}`, {
      data: { ...context, description: 'Changed behind the popup' },
    });
    expect(put.status()).toBe(200);

    await page.getByTestId('md-save').click();
    await expect(page.getByTestId('md-conflict-dialog')).toBeVisible();
    expect(savedContext(name).links[0]?.notes).toBeUndefined();

    const reloaded = page.waitForEvent('load', { timeout: 10_000 });
    await page.getByTestId('md-conflict-overwrite').click();
    await reloaded;
    const saved = savedContext(name);
    expect(saved.links[0]?.notes).toContain('popup note');
    expect(saved.description).toBe('Changed behind the popup');
  });
});

test.describe('recipe preamble and blocks', () => {
  test('the preamble popup appends text and the page shows it after the reload', async ({
    page,
    request,
  }) => {
    const name = await createRecipe(request);
    await page.goto(`/recipe/${name}`);
    const preamble = page.getByTestId('recipe-preamble');
    await expect(preamble).toContainText('You are working on ctxman');

    await openPopup(page, page.getByTestId('recipe-edit-preamble'));
    await expect(page.getByTestId('md-modal')).toContainText('Edit preamble');
    await expect(page.getByTestId('md-editor').locator('.view-lines')).toContainText(
      'You are working on ctxman',
    );
    await typeAtEnd(page, '\n\nAlways run the popup spec first.');

    const reloaded = page.waitForEvent('load', { timeout: 10_000 });
    await page.getByTestId('md-save').click();
    await reloaded;

    const saved = readRecipeYaml(name);
    expect(saved.preamble).toContain('You are working on ctxman');
    expect(saved.preamble).toContain('Always run the popup spec first.');
    await expect(page.getByTestId('recipe-preamble')).toContainText(
      'Always run the popup spec first.',
    );
  });

  test('a markdown block popup edits that block only', async ({ page, request }) => {
    const name = await createRecipe(request);
    const before = readRecipeYaml(name);
    const blocks = before.markdown as { id: string; body: string }[];
    expect(blocks.length).toBeGreaterThan(0);

    await page.goto(`/recipe/${name}`);
    const block = page.getByTestId('recipe-block').first();
    await expect(block).toHaveAttribute('data-id', blocks[0]?.id ?? '');
    await openPopup(page, block.getByTestId('recipe-block-edit'));
    await typeAtEnd(page, '\n\nBlock line from the popup spec.');
    const reloaded = page.waitForEvent('load', { timeout: 10_000 });
    await page.getByTestId('md-save').click();
    await reloaded;

    const after = readRecipeYaml(name);
    const afterBlocks = after.markdown as { id: string; body: string }[];
    expect(afterBlocks[0]?.body).toContain('Block line from the popup spec.');
    expect(afterBlocks[0]?.body).toContain(blocks[0]?.body.trim() ?? '');
    expect(after.preamble).toBe(before.preamble);
    expect(dataExists(`recipe/${name}.yaml`)).toBe(true);
  });
});
