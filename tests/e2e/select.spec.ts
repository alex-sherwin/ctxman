// Kit Select v2 (ROUND2_UI_SPEC §B.2/§B.3): searchable popover (Autocomplete + SearchField), keyboard behavior,
// open-state chevron, and the SSR native sort select. Uses the Tools "Add entry" dataset select (no data written).
import { expect, test } from './fixtures.ts';
import type { Locator, Page } from '@playwright/test';

const TRIGGER = 'tools-add-dataset';

function trigger(page: Page): Locator {
  return page.getByTestId(TRIGGER);
}
function search(page: Page): Locator {
  return page.getByTestId(`${TRIGGER}-search`);
}
function popover(page: Page): Locator {
  return page.getByTestId(`${TRIGGER}-popover`);
}

async function openSelect(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(popover(page)).toBeVisible();
  await expect(search(page)).toBeFocused();
}

test.describe('Select v2', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tools?add=task');
    await expect(trigger(page)).toContainText('Tasks');
  });

  test('opening focuses the filter input and lists every option', async ({ page }) => {
    await openSelect(page);
    await expect(popover(page).getByRole('option')).toHaveCount(11);
    await expect(popover(page).getByRole('option', { name: /Bugs/ })).toBeVisible();
  });

  test('typing filters, Enter selects and closes, reopening starts with an empty query', async ({
    page,
  }) => {
    await openSelect(page);
    await page.keyboard.type('bu');
    await expect(popover(page).getByRole('option')).toHaveCount(1);
    await expect(popover(page).getByRole('option', { name: /Bugs/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(popover(page)).toHaveCount(0);
    await expect(trigger(page)).toContainText('Bugs');
    await expect(trigger(page)).toBeFocused();

    await openSelect(page);
    await expect(search(page)).toHaveValue('');
    await expect(popover(page).getByRole('option')).toHaveCount(11);
  });

  test('a query without matches shows the empty text', async ({ page }) => {
    await openSelect(page);
    await page.keyboard.type('zzzz');
    // react-aria renders the empty state inside the listbox as its single `role=option` element.
    await expect(popover(page).getByRole('option')).toHaveCount(1);
    await expect(popover(page).getByRole('option')).toHaveText('No matches');
  });

  test('Esc clears the query first, then closes and refocuses the trigger', async ({ page }) => {
    await openSelect(page);
    await page.keyboard.type('fea');
    await expect(popover(page).getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(search(page)).toHaveValue('');
    await expect(popover(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    await expect(trigger(page)).toContainText('Tasks');
  });

  test('clicking an option selects it', async ({ page }) => {
    await openSelect(page);
    await popover(page)
      .getByRole('option', { name: /Features/ })
      .click();
    await expect(popover(page)).toHaveCount(0);
    await expect(trigger(page)).toContainText('Features');
  });

  test('the chevron rotates while the popover is open and rests when closed', async ({ page }) => {
    const chevron = page.locator('.ck-select__chevron').first();
    const transform = () => chevron.evaluate((el) => getComputedStyle(el).transform);
    await expect.poll(transform).toBe('none');
    await openSelect(page);
    await expect(page.locator('.ck-select[data-open] .ck-select__chevron')).toHaveCount(1);
    // rotate(180deg) settles as matrix(-1, 0, 0, -1, 0, 0) once the transition ends.
    await expect.poll(transform).toBe('matrix(-1, 0, 0, -1, 0, 0)');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect.poll(transform).toBe('none');
  });
});

test.describe('native select twin', () => {
  test('the list sort select still navigates with ?sort=name', async ({ page }) => {
    await page.goto('/kb');
    await page.getByTestId('list-sort').selectOption('name');
    await expect(page).toHaveURL(/[?&]sort=name(&|$)/);
    await expect(page.getByTestId('list-sort')).toHaveValue('name');
  });
});
