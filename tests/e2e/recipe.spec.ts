// Recipe pages (INFLATE_SPEC §8.2): the /recipe list, the /recipe/<slug> composition view, the dashboard panel and
// the links into /inflate. Read-only: the seed recipe is never written here.
import { expect, test } from '@playwright/test';
import { SEED_RECIPE } from './helpers.ts';

test.describe('recipe list', () => {
  test('/recipe lists the seed with its target badge and context count', async ({ page }) => {
    const response = await page.goto('/recipe');
    expect(response?.status()).toBe(200);
    const row = page.locator(`[data-testid="list-row"][data-slug="${SEED_RECIPE}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('recipe-target-badge')).toHaveText('Claude Code');

    const headers = await page.getByTestId('list-results').locator('thead th').allTextContents();
    const column = headers.findIndex((h) => h.trim() === 'Contexts');
    expect(column).toBeGreaterThanOrEqual(0);
    await expect(row.locator('td').nth(column)).toHaveText('1');
  });

  test('the New recipe link opens the create form', async ({ page }) => {
    await page.goto('/recipe');
    const link = page.getByTestId('list-new-entry');
    await expect(link).toHaveAttribute('href', '/new/recipe');
    await link.click();
    await expect(page).toHaveURL(/\/new\/recipe$/);
    await expect(page.getByTestId('dform')).toBeVisible();
    await expect(page.getByTestId('dform')).toHaveAttribute('data-mode', 'create');
  });

  test('a recipe row opens the recipe from any cell', async ({ page }) => {
    await page.goto('/recipe');
    const row = page.locator(`[data-testid="list-row"][data-slug="${SEED_RECIPE}"]`);
    await row.locator('td').nth(1).click({ force: true });
    await expect(page).toHaveURL(new RegExp(`/recipe/${SEED_RECIPE}$`));
  });
});

test.describe('recipe detail', () => {
  test('/recipe/<seed> shows the composition panels and opens the recipe in Inflate', async ({
    page,
  }) => {
    const response = await page.goto(`/recipe/${SEED_RECIPE}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('detail-slug')).toHaveText(SEED_RECIPE);

    const composition = page.getByTestId('recipe-composition');
    await expect(composition).toBeVisible();
    await expect(
      composition.locator('[data-testid="recipe-context"][data-slug="ctxman-dev"]'),
    ).toBeVisible();
    await expect(
      composition.locator('[data-testid="recipe-item"][data-key="skill/ctxman-add-entry"]'),
    ).toBeVisible();
    await expect(
      composition.locator('[data-testid="recipe-override"][data-key="kb/ctxman"]'),
    ).toBeVisible();
    await expect(composition.getByTestId('recipe-block').first()).toHaveAttribute('data-id', 'b1');
    await expect(composition.getByTestId('recipe-preamble')).toBeVisible();
    // The seed writes to a working directory: the Output panel says where, with its primary repository.
    const output = composition.getByTestId('recipe-output');
    await expect(output).toBeVisible();
    await expect(output).toContainText('~/ctxman-inflate/ctxman-dev-brief');
    await expect(output).toContainText('LLM_CONTEXT.md');
    await expect(output.getByTestId('recipe-output-primary')).toContainText('reference/astro-docs');
    await expect(composition.getByTestId('recipe-order')).toBeVisible();
    // The preamble and every markdown block have a pencil that the MarkdownTargets island enables.
    await expect(composition.getByTestId('recipe-edit-preamble')).toBeEnabled();
    await expect(composition.getByTestId('recipe-block-edit').first()).toBeEnabled();
    await expect(page.getByTestId('detail-edit')).toHaveAttribute(
      'href',
      `/recipe/${SEED_RECIPE}?edit=1`,
    );
    // The context row is a whole-row link.
    await expect(
      composition.locator(
        '[data-testid="recipe-context"][data-slug="ctxman-dev"] a.cx-rowlink__main',
      ),
    ).toHaveAttribute('href', '/context/ctxman-dev');

    const open = page.getByTestId('detail-open-inflate');
    await expect(open).toHaveAttribute('href', `/inflate?recipe=${SEED_RECIPE}`);
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/inflate\\?recipe=${SEED_RECIPE}$`));
    await expect(page.getByTestId('inflate')).toBeVisible();
    await expect(page.getByTestId('inflate-view-recipe')).toHaveAttribute(
      'href',
      `/recipe/${SEED_RECIPE}`,
    );
  });

  test('an unknown recipe is a 404 page', async ({ page }) => {
    const response = await page.goto('/recipe/nope');
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('notfound-path')).toHaveText('/recipe/nope');
  });
});

test.describe('dashboard', () => {
  test('the dashboard has the Recipes tile and a Recipes panel that links into Inflate', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('dataset-card-recipe')).toBeVisible();

    const panel = page.getByTestId('dashboard-recipes');
    await expect(panel).toBeVisible();
    const row = panel.locator(`[data-testid="dashboard-recipe"][data-slug="${SEED_RECIPE}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole('link', { name: 'Inflate', exact: true })).toHaveAttribute(
      'href',
      `/inflate?recipe=${SEED_RECIPE}`,
    );
    await expect(panel.getByTestId('dashboard-recipe-new')).toHaveAttribute(
      'href',
      '/inflate?recipe=new',
    );
  });
});
