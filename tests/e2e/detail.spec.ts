// Detail pages (UI_SPEC §F): rendered markdown, rewritten links, file tree, back-references and context pages.
import { expect, test } from '@playwright/test';

test.describe('bundle detail pages', () => {
  test('/kb/ctxman renders the entry markdown, metadata and file tree', async ({ page }) => {
    await page.goto('/kb/ctxman');
    const content = page.getByTestId('detail-content');
    await expect(content.getByRole('heading', { level: 1 })).toHaveText('ctxman');
    await expect(page.getByTestId('detail-slug')).toHaveText('ctxman');
    await expect(page.getByTestId('detail-meta')).toContainText('architecture');
    await expect(page.getByTestId('detail-files')).toContainText('main.md');
    await expect(page.getByTestId('detail-files')).toContainText('concepts/datasets.md');
  });

  test('intra-bundle links are rewritten and navigate to the sub-doc', async ({ page }) => {
    await page.goto('/kb/ctxman');
    // main.md links to the Datasets concept twice (body and reading list): either one is the same route.
    const link = page
      .getByTestId('detail-content')
      .getByRole('link', { name: 'Datasets', exact: true })
      .first();
    await expect(link).toHaveAttribute('href', '/kb/ctxman/doc/concepts/datasets');
    await link.click();
    await expect(page).toHaveURL(/\/kb\/ctxman\/doc\/concepts\/datasets$/);
    await expect(page.getByTestId('detail-path')).toHaveText('concepts/datasets.md');
    await expect(
      page.getByTestId('detail-content').getByRole('heading', { level: 1 }),
    ).toBeVisible();
    // The file tree marks the shown file as the current page.
    await expect(page.getByTestId('detail-files').locator('a[aria-current="page"]')).toContainText(
      'datasets.md',
    );
  });

  test('ctxman: links point at the entry route', async ({ page }) => {
    await page.goto('/kb/ctxman');
    const contextLink = page
      .getByTestId('detail-content')
      .getByRole('link', { name: 'ctxman-dev', exact: true });
    await expect(contextLink).toHaveAttribute('href', '/context/ctxman-dev');

    await page.goto('/kb/ctxman/doc/concepts/datasets');
    const featureLink = page
      .getByTestId('detail-content')
      .getByRole('link', { name: 'context-forge', exact: true });
    await expect(featureLink).toHaveAttribute('href', '/feature/context-forge');
    await featureLink.click();
    await expect(page).toHaveURL(/\/feature\/context-forge$/);
    await expect(page.getByTestId('detail-slug')).toHaveText('context-forge');
  });

  test('file tree links open the other files of the bundle', async ({ page }) => {
    await page.goto('/kb/ctxman/doc/concepts/datasets');
    const files = page.getByTestId('detail-files');
    await files.locator('a[href="/kb/ctxman/doc/log"]').click();
    await expect(page).toHaveURL(/\/kb\/ctxman\/doc\/log$/);
    await expect(page.getByTestId('detail-path')).toHaveText('log.md');
    await expect(page.getByTestId('detail-files').locator('a[aria-current="page"]')).toContainText(
      'log.md',
    );
    await page.getByTestId('detail-files').locator('a[href="/kb/ctxman"]').click();
    await expect(page).toHaveURL(/\/kb\/ctxman$/);
    await expect(page.getByTestId('detail-slug')).toHaveText('ctxman');
  });

  test('a sub-doc page renders (log.md)', async ({ page }) => {
    const response = await page.goto('/kb/ctxman/doc/log');
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('detail-content')).toBeVisible();
    await expect(page.getByTestId('detail-path')).toHaveText('log.md');
  });

  test('back-references list the contexts that link to the entry', async ({ page }) => {
    await page.goto('/kb/ctxman');
    const backrefs = page.getByTestId('detail-backrefs');
    await expect(backrefs).toContainText('Linked from contexts');
    await expect(backrefs.locator('a[href="/context/ctxman-dev"]')).toBeVisible();
    await expect(backrefs.locator('a[href="/forge?context=ctxman-dev"]')).toHaveAttribute(
      'aria-label',
      'Open ctxman-dev in Forge',
    );
  });
});

test.describe('reference detail pages', () => {
  test('a remote-skill tarball shows the archive badge and its URI', async ({ page }) => {
    await page.goto('/reference/ksa-modding');
    const fields = page.getByTestId('reference-fields');
    await expect(fields.getByTestId('uri-kind-badge')).toHaveText('archive');
    await expect(fields).toContainText(
      'https://meow.science.fail/ksa-coffer/downloads/ksa-modding-latest.tar.gz',
    );
    await expect(fields).toContainText('archive root');
  });

  test('a remote-skill git repo shows the git badge; a scp-style remote-repo has none', async ({
    page,
  }) => {
    await page.goto('/reference/anthropic-skills');
    await expect(page.getByTestId('reference-fields').getByTestId('uri-kind-badge')).toHaveText(
      'git',
    );
    await page.goto('/reference/catcom');
    await expect(page.getByTestId('reference-fields')).toContainText(
      'git@github.com:meow-sci/catcom.git',
    );
    await expect(page.getByTestId('uri-kind-badge')).toHaveCount(0);
  });
});

test.describe('context pages', () => {
  test('/context/ctxman-dev groups its links by dataset with rendered notes', async ({ page }) => {
    await page.goto('/context/ctxman-dev');
    await expect(page.getByTestId('detail-content')).toBeVisible();
    await expect(page.getByTestId('context-link')).toHaveCount(10);
    // Groups in registry order; one per dataset that has links (kb, rca, idea, task, bug, feature, project,
    // skill, reference).
    const groups = page.locator('[data-testid^="context-group-"]');
    await expect.poll(() => groups.count()).toBeGreaterThanOrEqual(6);
    await expect(page.getByTestId('context-group-kb')).toBeVisible();
    await expect(page.getByTestId('context-group-task')).toBeVisible();
    // Notes are Markdown: the rca note has inline code, the task note has a list.
    const rcaNotes = page.locator(
      '[data-testid="context-link"][data-slug="astro-dev-full-reload-on-save"]',
    );
    await expect(rcaNotes.locator('code').first()).toBeVisible();
    const taskNotes = page.locator('[data-testid="context-link"][data-slug="write-agents-md"]');
    await expect(taskNotes.locator('li').first()).toBeVisible();
  });

  test('"Open in Forge" on a context page links to the Forge with the context selected', async ({
    page,
  }) => {
    await page.goto('/context/ctxman-dev');
    await expect(page.getByTestId('detail-open-forge')).toHaveAttribute(
      'href',
      '/forge?context=ctxman-dev',
    );
  });
});
