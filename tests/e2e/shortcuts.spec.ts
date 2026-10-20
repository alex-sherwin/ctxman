// Keyboard shortcuts (Phase 8): `?` help dialog, `c` create for the page context, `l` add link, `i` IDE, `e` edit,
// typing targets.
import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { SEED_RECIPE, modKey, openSearch } from './helpers.ts';

/** The island sets `data-shortcuts-ready` on <body> once its key listener is registered. */
async function ready(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('body[data-shortcuts-ready]')).toBeAttached();
  // Take focus off any autofocused control so the key reaches the page, not a typing target.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test('? opens the shortcuts dialog and Esc closes it', async ({ page }) => {
  await ready(page, '/task');
  await page.keyboard.press('?');
  const dialog = page.getByTestId('shortcuts-dialog');
  await expect(dialog).toBeVisible();
  expect(await page.getByTestId('shortcut-row').count()).toBe(9);
  await expect(dialog).toContainText('New entry');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('the footer ? button opens the dialog', async ({ page }) => {
  await ready(page, '/');
  await page.getByTestId('footer-shortcuts').click();
  await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
});

test('c on a list goes to its create form', async ({ page }) => {
  await ready(page, '/task');
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/new\/task$/);
});

test('c on a project-scoped list creates a child of the project', async ({ page }) => {
  await ready(page, '/task?project=ctxman-v1');
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/new\/task\?parent=ctxman-v1$/);
});

test('c on a project page creates a task for it', async ({ page }) => {
  await ready(page, '/project/ctxman-v1');
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/new\/task\?parent=ctxman-v1$/);
});

test('c on the create form does nothing', async ({ page }) => {
  await ready(page, '/new/task');
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/new\/task$/);
});

test('c on Forge opens the New context dialog', async ({ page }) => {
  await ready(page, '/forge');
  await page.keyboard.press('c');
  await expect(page.getByTestId('forge-new-dialog')).toBeVisible();
});

test('c on Inflate opens the New recipe dialog', async ({ page }) => {
  await ready(page, '/inflate');
  await page.keyboard.press('c');
  await expect(page.getByTestId('inflate-new-dialog')).toBeVisible();
});

test('l on an okf entry page opens the relation picker', async ({ page }) => {
  await ready(page, '/kb/ctxman');
  await expect(page.getByTestId('relation-add')).toBeEnabled();
  await page.keyboard.press('l');
  await expect(page.getByTestId('relation-picker')).toBeVisible();
});

test('. on an entry page opens it in the IDE', async ({ page }) => {
  await ready(page, '/kb/ctxman');
  await expect(page.getByTestId('detail-open-ide')).toBeEnabled();
  await page.keyboard.press('.');
  await expect(page.locator('[data-ide-status]')).toContainText('Opened');
});

test('. does nothing on a page without an Open in IDE button', async ({ page }) => {
  await ready(page, '/task');
  await page.keyboard.press('.');
  await expect(page.locator('[data-ide-status]')).toHaveCount(0);
});

test('l does nothing on a page without a + Link button', async ({ page }) => {
  await ready(page, '/task');
  await page.keyboard.press('l');
  await expect(page.getByTestId('relation-picker')).toHaveCount(0);
});

test('e on an okf entry opens the markdown editor with the cursor in it', async ({ page }) => {
  await ready(page, '/kb/ctxman');
  await expect(page.getByTestId('doc-view-toggle')).toBeVisible();
  await page.keyboard.press('e');
  await expect(page).toHaveURL(/\/kb\/ctxman\?edit=1$/);
  await expect(page.getByTestId('doc-view-edit')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('doc-editor').locator('.monaco-editor textarea')).toBeFocused({
    timeout: 15_000,
  });
});

test('Edit and Preview are history entries: Back and Forward switch modes (click and e)', async ({
  page,
}) => {
  await ready(page, '/kb/ctxman');
  const preview = page.getByTestId('doc-view-preview');
  const editChip = page.getByTestId('doc-view-edit');
  await editChip.click();
  await expect(page).toHaveURL(/\/kb\/ctxman\?edit=1$/);
  await expect(page.getByTestId('doc-editor').locator('.monaco-editor')).toBeVisible({
    timeout: 15_000,
  });
  await preview.click();
  await expect(page).toHaveURL(/\/kb\/ctxman$/);
  await expect(page.getByTestId('detail-content')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/kb\/ctxman\?edit=1$/);
  await expect(editChip).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('detail-content')).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/kb\/ctxman$/);
  await expect(preview).toHaveAttribute('aria-checked', 'true');
  await page.goForward();
  await expect(editChip).toHaveAttribute('aria-checked', 'true');

  // the e key pushes an entry too; Back out of unsaved text asks first
  await page.goBack();
  await expect(preview).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('e');
  await expect(page).toHaveURL(/\/kb\/ctxman\?edit=1$/);
  const textarea = page.getByTestId('doc-editor').locator('.monaco-editor textarea');
  await expect(textarea).toBeFocused();
  await page.keyboard.type('unsaved');
  await page.goBack();
  const discard = page.getByTestId('doc-discard-dialog');
  await expect(discard).toBeVisible();
  await expect(page).toHaveURL(/\/kb\/ctxman\?edit=1$/);
  await discard.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/kb\/ctxman$/);
  await expect(preview).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('doc-draft-available')).toHaveCount(0);
});

test('e on a document page edits that file', async ({ page }) => {
  await ready(page, '/kb/ctxman/doc/concepts/datasets');
  await expect(page.getByTestId('doc-view-toggle')).toBeVisible();
  await page.keyboard.press('e');
  await expect(page).toHaveURL(/\/kb\/ctxman\/doc\/concepts\/datasets\?edit=1$/);
  await expect(page.getByTestId('doc-editor').locator('.monaco-editor textarea')).toBeFocused({
    timeout: 15_000,
  });
});

for (const url of ['/reference/ctxman-repo', '/context/ctxman-dev', `/recipe/${SEED_RECIPE}`]) {
  test(`e on ${url} opens its edit form`, async ({ page }) => {
    await ready(page, url);
    await page.keyboard.press('e');
    await expect(page).toHaveURL(new RegExp(`${url}\\?edit=1$`));
    await expect(page.getByTestId('dform')).toBeVisible();
  });
}

test('e does nothing on a page without an edit mode, or with Shift', async ({ page }) => {
  await ready(page, '/reference/ctxman-repo');
  await page.keyboard.press('Shift+E');
  await page.keyboard.press('?');
  // the help dialog proves the page took the keys in order; Shift+E before it changed nothing
  await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/reference\/ctxman-repo$/);

  await ready(page, '/task');
  await page.keyboard.press('e');
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/task$/);
});

test('typing c in the search box does not navigate', async ({ page }) => {
  await ready(page, '/task');
  await page.keyboard.press(`${modKey}+K`);
  await expect(page.getByTestId('search-input')).toBeFocused();
  await page.keyboard.type('c?l');
  await expect(page.getByTestId('search-input')).toHaveValue('c?l');
  await expect(page).toHaveURL(/\/task\?.*search=1/);
  await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
});

test('shortcuts are ignored while a dialog is open', async ({ page }) => {
  await ready(page, '/task');
  await openSearch(page);
  await page.getByTestId('search-input').blur();
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/task\?.*search=1/);
});
