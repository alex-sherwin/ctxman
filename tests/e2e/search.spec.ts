// Global search widget (UI_SPEC §G): open paths, URL sync (?search=1&sq=&in=), Esc semantics, navigation.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { API, modKey, openSearch } from './helpers.ts';

/**
 * Keyboard shortcuts are listened to by the search island, which mounts after hydration (a few hundred ms after
 * a page load). Press the shortcut until the widget reacts; each attempt is bounded, so this never sleeps blindly.
 */
async function pressUntilOpen(page: Page, key: string): Promise<void> {
  await expect(async () => {
    await page.keyboard.press(key);
    await expect(page.getByTestId('search-input')).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

/** `href` of every rendered search result, in display order. */
async function resultHrefs(page: Page): Promise<string[]> {
  return page
    .getByTestId('search-result')
    .evaluateAll((items) => items.map((item) => item.getAttribute('href') ?? ''));
}

test.describe('global search', () => {
  test('the header button opens the modal, focuses the input and sets search=1', async ({
    page,
  }) => {
    await page.goto('/');
    await openSearch(page);
    await expect(page.getByTestId('search-modal')).toBeVisible();
    await expect(page).toHaveURL(/[?&]search=1(&|$)/);
  });

  test('typing sets sq= and filters results; a dataset chip sets in=', async ({ page }) => {
    await page.goto('/');
    await openSearch(page);
    await page.getByTestId('search-input').fill('forge');
    await expect(page).toHaveURL(/[?&]sq=forge(&|$)/);
    await expect(page.getByTestId('search-count')).toContainText('results');
    await expect.poll(() => resultHrefs(page)).toContain('/feature/context-forge');

    await page.getByTestId('search-chip-feature').click();
    await expect(page).toHaveURL(/[?&]in=feature(&|$)/);
    await expect(page.getByTestId('search-chip-feature')).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => {
        const hrefs = await resultHrefs(page);
        return hrefs.length > 0 && hrefs.every((href) => href.startsWith('/feature/'));
      })
      .toBe(true);
  });

  test('Escape clears the query first, then closes and drops the search params', async ({
    page,
  }) => {
    // Opened with the shortcut: a header-button click would arm the shell's 300 ms fallback (see the 300 ms regression test below).
    await page.goto('/');
    await pressUntilOpen(page, `${modKey}+K`);
    await page.getByTestId('search-chip-feature').click();
    await page.getByTestId('search-input').fill('forge');
    await expect(page).toHaveURL(/[?&]sq=forge/);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('search-input')).toHaveValue('');
    await expect(page.getByTestId('search-modal')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('search-modal')).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    expect(new URL(page.url()).searchParams.has('search')).toBe(false);
    expect(new URL(page.url()).searchParams.has('sq')).toBe(false);
    expect(new URL(page.url()).searchParams.has('in')).toBe(false);
  });

  test(`${modKey}+K opens the widget from anywhere`, async ({ page }) => {
    await page.goto('/kb/ctxman');
    await pressUntilOpen(page, `${modKey}+K`);
    await expect(page).toHaveURL(/[?&]search=1(&|$)/);
  });

  test('"/" opens the widget when no text field has focus', async ({ page }) => {
    await page.goto('/kb/ctxman');
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await pressUntilOpen(page, '/');
    await expect(page).toHaveURL(/[?&]search=1(&|$)/);
  });

  test('a deep link opens the widget pre-filled with its dataset chip selected', async ({
    page,
  }) => {
    await page.goto('/task?search=1&sq=agents&in=task');
    await expect(page.getByTestId('search-input')).toHaveValue('agents');
    await expect(page.getByTestId('search-chip-task')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('search-chip-all')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => resultHrefs(page)).toContain('/task/write-agents-md');
  });

  test('Enter opens the focused result; Back returns with the widget open and the query intact', async ({
    page,
  }) => {
    await page.goto('/');
    await openSearch(page);
    await page.getByTestId('search-input').fill('forge');
    await expect.poll(() => resultHrefs(page)).toContain('/feature/context-forge');

    // The first result is focused when the query changes (UI_SPEC §G.6): Enter follows its link.
    const [first] = await resultHrefs(page);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL((url) => url.pathname === first);
    await expect(page.getByTestId('detail-slug')).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('search-modal')).toBeVisible();
    await expect(page.getByTestId('search-input')).toHaveValue('forge');
    await expect(page).toHaveURL(/[?&]sq=forge(&|$)/);
  });

  test('Back from an opened widget closes it', async ({ page }) => {
    await page.goto('/');
    await pressUntilOpen(page, `${modKey}+K`);
    await expect(page.getByTestId('search-modal')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('search-modal')).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test('the search index is fetched on the first open only', async ({ page }) => {
    const indexRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes(`${API}/search-index.json`)) indexRequests.push(request.url());
    });
    // Opened from the URL, so no click (and no click fallback timer) is involved.
    await page.goto('/?search=1');
    await expect(page.getByTestId('search-input')).toBeFocused();
    await page.getByTestId('search-input').fill('forge');
    await expect.poll(() => resultHrefs(page)).toContain('/feature/context-forge');
    await expect.poll(() => indexRequests.length).toBe(1);

    await page.keyboard.press('Escape'); // clears the query
    await page.keyboard.press('Escape'); // closes
    await expect(page.getByTestId('search-modal')).toHaveCount(0);
    await openSearch(page);
    await page.getByTestId('search-input').fill('global');
    await expect.poll(() => resultHrefs(page)).not.toHaveLength(0);
    expect(indexRequests).toHaveLength(1);
  });

  // Regression: the shell's 300 ms click fallback used to reload with ?search=1 after a fast open + Esc.
  test('closing the widget within 300 ms of opening it does not reopen it', async ({ page }) => {
    await page.goto('/kb/ctxman');
    await pressUntilOpen(page, `${modKey}+K`); // the island is mounted once the shortcut works
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('search-modal')).toHaveCount(0);

    await page.getByTestId('search-button').click();
    await expect(page.getByTestId('search-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800); // longer than the 300 ms fallback
    await expect(page.getByTestId('search-modal')).toHaveCount(0);
    await expect(page).not.toHaveURL(/search=1/);
  });
});
