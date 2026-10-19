// Markdown popup editors (ROUND2_UI_SPEC §F.2, ROUND3_SPEC §F.4/§G): the pencil buttons on the context page (a
// link's notes) and on the recipe page (preamble, markdown blocks) open a Monaco modal; Save writes the yaml through
// the context / recipe API and reloads the page. The modal has an "Insert link…" button (and Mod+Alt+K) that picks an
// entry, and keeps its unsaved text in localStorage: a page reload (no native prompt) followed by opening the same
// popup restores it with a banner. Contexts and recipes are created per run through the API (the seed recipe is never
// written) and removed afterwards; every assertion about what was saved reads the yaml file in the e2e data copy.
// Monaco in Playwright's "Desktop Chrome" profile expects Control+a / Control+End (Windows user agent).
import { expect, test } from './fixtures.ts';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  API,
  afterReload,
  bumpMtime,
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
    timeout: 15_000,
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

    await afterReload(page, () => page.getByTestId('md-save').click());

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
    await afterReload(page, () => page.getByTestId('md-save').click());

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

    // someone edits the description while the popup is open (the mtime is bumped below so it differs)
    const current = await request.get(`${API}/context/${name}`);
    const { context } = (await current.json()) as { context: Record<string, unknown> };
    const put = await request.put(`${API}/context/${name}`, {
      data: { ...context, description: 'Changed behind the popup' },
    });
    expect(put.status()).toBe(200);
    bumpMtime(`context/${name}.yaml`);

    await page.getByTestId('md-save').click();
    await expect(page.getByTestId('md-conflict-dialog')).toBeVisible();
    expect(savedContext(name).links[0]?.notes).toBeUndefined();

    await afterReload(page, () => page.getByTestId('md-conflict-overwrite').click());
    const saved = savedContext(name);
    expect(saved.links[0]?.notes).toContain('popup note');
    expect(saved.description).toBe('Changed behind the popup');
  });
});

/** Opens the first link's notes popup of the context page and waits for Monaco. */
async function openFirstNotes(page: Page, name: string): Promise<void> {
  await page.goto(`/context/${name}`);
  await openPopup(
    page,
    page.getByTestId('context-link').first().getByTestId('context-link-edit-notes'),
  );
}

/** localStorage key of the first link's notes popup (src/ui/markdown/draft-restore.ts `mdDraftKey` + the prefix). */
const firstNotesDraftKey = (name: string): string =>
  `ctxman:draft:md:/api/context/${name}#notes:kb:ctxman`;

/** Waits (inside the page, every animation frame) until the draft under `key` contains `text`. */
async function draftHas(page: Page, key: string, text: string): Promise<void> {
  await page.waitForFunction(
    ([k, want]) => {
      const raw = localStorage.getItem(k);
      return raw !== null && (JSON.parse(raw) as { text: string }).text.includes(want);
    },
    [key, text] as const,
  );
}

async function storedDraft(
  page: Page,
  key: string,
): Promise<{ text: string; base: string } | null> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw === null ? null : (JSON.parse(raw) as { text: string; base: string });
  }, key);
}

test.describe('insert link', () => {
  test('the toolbar button picks an entry and inserts a ctxman link; Mod+Alt+K opens the same picker', async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const name = await createContext(request, TWO_LINKS);
    await openFirstNotes(page, name);
    await typeAtEnd(page, 'See ');
    await page.getByTestId('md-insert-link').click();
    await expect(page.getByTestId('link-picker')).toBeVisible();
    await page.getByTestId('link-picker-search').fill('okf-format');
    await expect(page.getByTestId('link-picker-row')).toHaveCount(1);
    await page.getByTestId('link-picker-pick').click();
    await expect(page.getByTestId('link-picker')).toHaveCount(0);
    // the popup stays open, the text is in, and the focus is back in the editor (Space types a space)
    await expect(page.getByTestId('md-modal')).toBeVisible();
    await expect(page.getByTestId('md-editor').locator('.view-lines')).toContainText(
      'See [OKF format](ctxman:kb/okf-format)',
    );
    await expect(page.getByTestId('md-editor').locator('.monaco-editor textarea')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('link-picker')).toHaveCount(0);

    // Mod+Alt+K (Control: Monaco in the "Desktop Chrome" profile reports a Windows user agent); Esc closes only the picker
    await page.keyboard.press('Control+Alt+k');
    await expect(page.getByTestId('link-picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('link-picker')).toHaveCount(0);
    await expect(page.getByTestId('md-modal')).toBeVisible();

    await afterReload(page, () => page.getByTestId('md-save').click());
    expect(savedContext(name).links[0]?.notes).toContain('See [OKF format](ctxman:kb/okf-format)');
    await expect(
      page.getByTestId('context-link').first().getByTestId('context-link-notes'),
    ).toContainText('OKF format');
    expect(errors).toEqual([]);
  });
});

test.describe('drafts survive a reload (no native prompt)', () => {
  test('unsaved text comes back when the popup is opened again after a reload; Discard drops it', async ({
    page,
    request,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      void dialog.dismiss();
    });
    const name = await createContext(request, TWO_LINKS);
    const key = firstNotesDraftKey(name);
    await openFirstNotes(page, name);
    await expect(page.getByTestId('md-draft-restored')).toHaveCount(0);
    await typeAtEnd(page, 'DRAFT-NOTE-TEXT');
    await draftHas(page, key, 'DRAFT-NOTE-TEXT');

    await page.reload();
    expect(dialogs).toEqual([]);
    await openPopup(
      page,
      page.getByTestId('context-link').first().getByTestId('context-link-edit-notes'),
    );
    const banner = page.getByTestId('md-draft-restored');
    await expect(banner).toBeVisible();
    await expect(banner).not.toHaveAttribute('data-stale', /.*/);
    await expect(page.getByTestId('md-editor').locator('.view-lines')).toContainText(
      'DRAFT-NOTE-TEXT',
    );
    await expect(page.getByTestId('md-save')).toBeEnabled();

    await page.getByTestId('md-draft-discard').click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId('md-editor').locator('.view-lines')).not.toContainText(
      'DRAFT-NOTE-TEXT',
    );
    await expect(page.getByTestId('md-save')).toBeDisabled();
    expect(await storedDraft(page, key)).toBeNull();
    expect(savedContext(name).links[0]?.notes).toBeUndefined();
  });

  test('a draft whose file changed on disk is restored with a warning', async ({
    page,
    request,
  }) => {
    const name = await createContext(request, TWO_LINKS);
    await openFirstNotes(page, name);
    await typeAtEnd(page, 'STALE-NOTE-TEXT');
    await draftHas(page, firstNotesDraftKey(name), 'STALE-NOTE-TEXT');

    // someone edits the description meanwhile (the mtime is bumped below so it differs)
    const current = await request.get(`${API}/context/${name}`);
    const { context } = (await current.json()) as { context: Record<string, unknown> };
    const put = await request.put(`${API}/context/${name}`, {
      data: { ...context, description: 'Changed while the draft sat in storage' },
    });
    expect(put.status()).toBe(200);
    bumpMtime(`context/${name}.yaml`);

    await page.reload();
    await openPopup(
      page,
      page.getByTestId('context-link').first().getByTestId('context-link-edit-notes'),
    );
    const banner = page.getByTestId('md-draft-restored');
    await expect(banner).toHaveAttribute('data-stale', 'true');
    await expect(banner).toContainText('the file changed on disk since');
    await expect(page.getByTestId('md-editor').locator('.view-lines')).toContainText(
      'STALE-NOTE-TEXT',
    );
    // saving keeps the disk version's other fields (read-modify-write) and writes the restored note
    await afterReload(page, () => page.getByTestId('md-save').click());
    const saved = savedContext(name);
    expect(saved.links[0]?.notes).toContain('STALE-NOTE-TEXT');
    expect(saved.description).toBe('Changed while the draft sat in storage');
    // the draft is consumed: opening the popup again shows no banner
    await openPopup(
      page,
      page.getByTestId('context-link').first().getByTestId('context-link-edit-notes'),
    );
    await expect(page.getByTestId('md-draft-restored')).toHaveCount(0);
    expect(await storedDraft(page, firstNotesDraftKey(name))).toBeNull();
  });

  test('Cancel + Discard removes the draft', async ({ page, request }) => {
    const name = await createContext(request, TWO_LINKS);
    await openFirstNotes(page, name);
    await typeAtEnd(page, 'never kept');
    await draftHas(page, firstNotesDraftKey(name), 'never kept');
    await page.getByTestId('md-cancel').click();
    await page.getByTestId('md-discard-dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('md-modal')).toHaveCount(0);
    expect(await storedDraft(page, firstNotesDraftKey(name))).toBeNull();
    await page.reload();
    await openPopup(
      page,
      page.getByTestId('context-link').first().getByTestId('context-link-edit-notes'),
    );
    await expect(page.getByTestId('md-draft-restored')).toHaveCount(0);
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

    await afterReload(page, () => page.getByTestId('md-save').click());

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
    await afterReload(page, () => page.getByTestId('md-save').click());

    const after = readRecipeYaml(name);
    const afterBlocks = after.markdown as { id: string; body: string }[];
    expect(afterBlocks[0]?.body).toContain('Block line from the popup spec.');
    expect(afterBlocks[0]?.body).toContain(blocks[0]?.body.trim() ?? '');
    expect(after.preamble).toBe(before.preamble);
    expect(dataExists(`recipe/${name}.yaml`)).toBe(true);
  });
});

test.describe('reference info', () => {
  const references: string[] = [];
  test.afterEach(async ({ request }) => {
    for (const name of references.splice(0)) await request.delete(`${API}/reference/${name}`);
  });

  test('the Info pencil writes the info through the reference API; the page renders it after the reload', async ({
    page,
    request,
  }) => {
    const name = uniqueName('e2e-mdref');
    const response = await request.post(`${API}/reference`, {
      data: {
        name,
        description: 'E2E reference',
        type: 'local-folder',
        path: '/tmp/x',
        owner: 'me',
      },
    });
    expect(response.status()).toBe(201);
    references.push(name);

    await page.goto(`/reference/${name}`);
    await expect(page.getByTestId('reference-info')).toContainText('None');
    await openPopup(page, page.getByTestId('reference-edit-info'));
    await expect(page.getByTestId('md-modal')).toContainText('Edit info');
    await typeAtEnd(page, '## Layout\n\nOne file per week.');
    await afterReload(page, () => page.getByTestId('md-save').click());

    const saved = readYaml(`reference/${name}.yaml`) as Record<string, unknown>;
    expect(saved).toMatchObject({ name, type: 'local-folder', path: '/tmp/x' });
    expect(String(saved.info)).toContain('## Layout');
    expect(String(saved.info)).toContain('One file per week.');
    const panel = page.getByTestId('reference-info');
    await expect(panel.locator('h2', { hasText: 'Layout' })).toBeVisible();
    await expect(panel).toContainText('One file per week.');
  });
});

test.describe('snippet markdown', () => {
  const snippets: string[] = [];
  test.afterEach(async ({ request }) => {
    for (const name of snippets.splice(0)) await request.delete(`${API}/snippet/${name}`);
  });

  test('the Markdown pencil writes through the snippet API; the page renders it after the reload', async ({
    page,
    request,
  }) => {
    const name = uniqueName('e2e-mdsnip');
    const response = await request.post(`${API}/snippet`, {
      data: { name, description: 'E2E snippet', markdown: 'First line.\n' },
    });
    expect(response.status()).toBe(201);
    snippets.push(name);

    await page.goto(`/snippet/${name}`);
    const panel = page.getByTestId('snippet-markdown');
    await expect(panel).toContainText('First line.');
    await openPopup(page, page.getByTestId('snippet-edit-markdown'));
    await expect(page.getByTestId('md-modal')).toContainText('Edit markdown');
    await typeAtEnd(page, '\n## Then\n\nSecond part.');
    await afterReload(page, () => page.getByTestId('md-save').click());

    const saved = readYaml(`snippet/${name}.yaml`) as Record<string, unknown>;
    expect(saved).toMatchObject({ name, description: 'E2E snippet' });
    expect(String(saved.markdown)).toContain('First line.');
    expect(String(saved.markdown)).toContain('## Then');
    await expect(panel.locator('h2', { hasText: 'Then' })).toBeVisible();
    await expect(panel).toContainText('Second part.');
  });
});
