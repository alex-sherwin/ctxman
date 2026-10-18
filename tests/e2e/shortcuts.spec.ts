// Keyboard shortcuts (Phase 8): `?` help dialog, `c` create for the page context, `l` add link, typing targets.
import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { modKey, openSearch } from './helpers.ts';

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
  expect(await page.getByTestId('shortcut-row').count()).toBe(7);
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

test('l does nothing on a page without a + Link button', async ({ page }) => {
  await ready(page, '/task');
  await page.keyboard.press('l');
  await expect(page.getByTestId('relation-picker')).toHaveCount(0);
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
