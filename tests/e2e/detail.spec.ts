// Detail pages (UI_SPEC §F, ROUND2_UI_SPEC §G): rendered markdown, rewritten links, the two-column okf layout,
// file tree, back-references, context pages (links in context order) and clickable list rows.
import { appendFileSync, rmSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import { settleAfter } from './dev-reload.ts';
import { API, dataPath, uniqueName } from './helpers.ts';

test.describe('bundle detail pages', () => {
  test('/kb/ctxman renders the entry markdown, metadata and file tree', async ({ page }) => {
    await page.goto('/kb/ctxman');
    const content = page.getByTestId('detail-content');
    await expect(content.getByRole('heading', { level: 1 })).toHaveText('ctxman');
    await expect(page.getByTestId('detail-slug')).toHaveText('ctxman');
    await expect(page.getByTestId('detail-meta')).toContainText('architecture');
    await expect(page.getByTestId('detail-files')).toContainText('index.md');
    await expect(page.getByTestId('detail-files')).toContainText('concepts/datasets.md');
  });

  test('the details column sits LEFT of the content and carries Open in IDE', async ({ page }) => {
    await page.goto('/kb/ctxman');
    const aside = page.getByTestId('detail-aside');
    const content = page.getByTestId('detail-content');
    await expect(aside.getByTestId('detail-open-ide')).toBeVisible();
    await expect(aside.getByTestId('detail-open-ide')).toHaveAttribute('data-dataset', 'kb');
    await expect(aside.getByTestId('detail-open-ide')).toHaveAttribute('data-path', 'index.md');
    const asideBox = await aside.boundingBox();
    const contentBox = await content.boundingBox();
    expect(asideBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    expect(asideBox!.x + asideBox!.width).toBeLessThanOrEqual(contentBox!.x);
    // the DocEditor toolbar mounts above the preview
    await expect(page.getByTestId('doc-tools')).toBeVisible();
    await expect(page.getByTestId('doc-view-preview')).toBeVisible();
  });

  test('a skill page and a sub-doc page use the same two-column layout', async ({ page }) => {
    await page.goto('/skill/okf-authoring');
    await expect(page.getByTestId('detail-open-ide')).toHaveAttribute('data-path', 'SKILL.md');
    await expect(page.getByTestId('doc-tools')).toBeVisible();
    await page.goto('/kb/ctxman/doc/concepts/datasets');
    await expect(page.getByTestId('detail-open-ide')).toHaveAttribute(
      'data-path',
      'concepts/datasets.md',
    );
    await expect(page.getByTestId('doc-tools')).toBeVisible();
  });

  test('intra-bundle links are rewritten and navigate to the sub-doc', async ({ page }) => {
    await page.goto('/kb/ctxman');
    // index.md links to the Datasets concept twice (body and reading list): either one is the same route.
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
  test('/context/ctxman-dev lists its links in context order with rendered notes', async ({
    page,
    request,
  }) => {
    const api = await request.get(`${API}/context/ctxman-dev`);
    const { context } = (await api.json()) as {
      context: { links: { dataset: string; slug: string }[] };
    };
    const keys = context.links.map((l) => `${l.dataset}:${l.slug}`);

    await page.goto('/context/ctxman-dev');
    await expect(page.getByTestId('detail-content')).toBeVisible();
    const rows = page.getByTestId('context-link');
    await expect(rows).toHaveCount(10);
    // Stored order, no grouping by dataset (the old context-group-* sections are gone).
    expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-key')))).toEqual(
      keys,
    );
    await expect(page.locator('[data-testid^="context-group-"]')).toHaveCount(0);

    // The dataset badge comes before the title (2nd child of the line, after the number).
    const first = rows.first();
    await expect(first.locator('.cx-ctxlink__line > :nth-child(2)')).toHaveClass(/ck-badge/);
    await expect(first.locator('.cx-ctxlink__line > :nth-child(3)')).toHaveClass(
      /ck-entryline__title/,
    );
    await expect(first.locator('.ck-badge').first()).toHaveText('kb');

    // The left border color follows the row's dataset (data-ds -> --ds-c).
    for (const row of await rows.all()) {
      const ds = (await row.getAttribute('data-ds')) ?? '';
      const expected = await page.evaluate((dataset) => {
        const probe = document.createElement('span');
        probe.style.color = `var(--ds-${dataset})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }, ds);
      const border = await row.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.borderLeftColor, width: cs.borderLeftWidth };
      });
      expect(border.width, ds).toBe('2px');
      expect(border.color, ds).toBe(expected);
    }

    // Notes are Markdown: the rca note has inline code, the task note has a list.
    const rcaNotes = page.locator(
      '[data-testid="context-link"][data-slug="astro-dev-full-reload-on-save"]',
    );
    await expect(rcaNotes.locator('code').first()).toBeVisible();
    const taskNotes = page.locator('[data-testid="context-link"][data-slug="write-agents-md"]');
    await expect(taskNotes.locator('li').first()).toBeVisible();

    // Every row has a pencil that the MarkdownTargets island enables.
    const pencils = page.getByTestId('context-link-edit-notes');
    await expect(pencils).toHaveCount(10);
    await expect(pencils.first()).toBeEnabled();
  });

  test('a context row is a link: clicking beside the title opens the entry', async ({ page }) => {
    await page.goto('/context/ctxman-dev');
    const row = page.locator('[data-testid="context-link"][data-slug="write-agents-md"]');
    await expect(row.locator('a.cx-rowlink__main')).toHaveAttribute(
      'href',
      '/task/write-agents-md',
    );
    // The stretched link covers the row, so Playwright's own hit test would refuse the click: force it.
    await row.locator('.cx-ctxlink__num').click({ force: true });
    await expect(page).toHaveURL(/\/task\/write-agents-md$/);
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

test.describe('yaml dataset pages', () => {
  test('a reference page has an Edit button that opens the form', async ({ page }) => {
    await page.goto('/reference/astro-docs');
    const edit = page.getByTestId('detail-edit');
    await expect(edit).toHaveAttribute('href', '/reference/astro-docs?edit=1');
    await edit.click();
    await expect(page).toHaveURL(/\/reference\/astro-docs\?edit=1$/);
    await expect(page.getByTestId('dform')).toHaveAttribute('data-mode', 'edit');
    await expect(page.getByTestId('detail-edit')).toHaveCount(0);
    await expect(page.getByTestId('detail-aside')).toBeVisible();
  });
});

test.describe('clickable rows', () => {
  test('a list row opens its entry from any cell; ctrl/cmd-click opens a new tab instead', async ({
    page,
    context,
  }) => {
    await page.goto('/kb');
    const row = page.locator('[data-testid="list-row"][data-slug="ctxman"]');
    const cell = row.locator('td').nth(1); // Description
    await expect(row.locator('a.cx-rowlink__main')).toHaveAttribute('href', '/kb/ctxman');

    // Modified click: a new tab opens, this page stays where it is.
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      cell.click({ force: true, modifiers: ['ControlOrMeta'] }),
    ]);
    // the new tab can still be on about:blank when the `page` event fires: wait for its navigation
    await tab.waitForURL(/\/kb\/ctxman$/);
    await tab.close();
    await expect(page).toHaveURL(/\/kb$/);

    // Plain click on the description cell (the stretched link covers it).
    await cell.click({ force: true });
    await expect(page).toHaveURL(/\/kb\/ctxman$/);
  });

  test('inline buttons inside a clickable row keep working', async ({ page }) => {
    await page.goto('/');
    const row = page.getByTestId('dashboard-contexts').locator('li.cx-rowlink').first();
    await row.getByRole('link', { name: 'Forge', exact: true }).click();
    await expect(page).toHaveURL(/\/forge\?context=/);

    // back-references: the "Forge" button next to the context link
    await page.goto('/kb/ctxman');
    await page
      .getByTestId('detail-backrefs')
      .getByRole('link', { name: 'Open ctxman-dev in Forge' })
      .click();
    await expect(page).toHaveURL(/\/forge\?context=ctxman-dev$/);
  });

  test('dashboard and back-reference rows open their entry', async ({ page }) => {
    await page.goto('/');
    const recent = page.getByTestId('dashboard-recent').getByTestId('minilist-row').first();
    const href = await recent.locator('a.cx-rowlink__main').getAttribute('href');
    expect(href).toMatch(/^\/[a-z]+\/[a-z0-9-]+$/);
    await recent.locator('time, .cx-freshness').first().click({ force: true });
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    await page.goto('/kb/ctxman');
    // Target the seed context explicitly: other specs may leave extra contexts
    // (without notes) that link kb/ctxman and would sort first.
    const ref = page
      .getByTestId('detail-backrefs')
      .locator('li.cx-rowlink', { has: page.locator('a[href="/context/ctxman-dev"]') });
    await ref.locator('.cx-backref__notes').click({ force: true });
    await expect(page).toHaveURL(/\/context\/ctxman-dev$/);
  });
});

test.describe('relation panels, header state and tool buttons (ROUND3_SPEC §E)', () => {
  test('a task page shows its parent, the state select and the Details / Files buttons', async ({
    page,
  }) => {
    await page.goto('/task/write-agents-md');
    await expect(page.getByTestId('state-select')).toHaveValue('complete');
    await expect(page.getByTestId('detail-parent')).toHaveText('Part of ctxman v1');
    await expect(page.getByTestId('detail-parent')).toHaveAttribute('href', '/project/ctxman-v1');
    const linkedFrom = page
      .getByTestId('detail-linked-from')
      .locator('[data-testid="relation-row"][data-key="project/ctxman-v1"]');
    await expect(linkedFrom).toContainText('Parent');
    // the SSR buttons start disabled; the EntryTools island enables them
    for (const id of ['meta-edit', 'files-new-concept', 'entry-add-to-context', 'relation-add']) {
      await expect(page.getByTestId(id), id).toBeEnabled();
    }
    // mentions of the body are listed under "Links to", with the other entries' states
    await expect(
      page
        .getByTestId('detail-links-to')
        .locator('[data-testid="relation-row"][data-key="kb/ctxman"]'),
    ).toContainText('Mentions');
    // a task is not a project: no Children panel
    await expect(page.getByTestId('children-panel')).toHaveCount(0);
  });

  test('the project page lists its eleven children in file order with a remove button each', async ({
    page,
  }) => {
    await page.goto('/project/ctxman-v1');
    const rows = page.getByTestId('children-row');
    await expect(rows).toHaveCount(11);
    expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-key')))).toEqual([
      'feature/global-search',
      'feature/context-forge',
      'feature/tools-runner',
      'task/write-agents-md',
      'task/forge-e2e-coverage',
      'task/seed-sample-data',
      'task/windows-smoke-test',
      'bug/forge-reorder-focus',
      'bug/stale-badge-timezone',
      'idea/okf-graph-view',
      'feature/entry-relations',
    ]);
    await expect(page.getByTestId('children-remove')).toHaveCount(11);
    await expect(page.getByTestId('children-add')).toBeEnabled();
    await expect(page.getByTestId('entry-build-context')).toBeEnabled();
    await expect(page.getByTestId('children-progress')).toHaveText(/^\d+ of 11 done$/);
    // "Links to" keeps the non-child links (related), the children are in their own panel
    const related = page.getByTestId('detail-links-to').getByTestId('relation-row');
    await expect(related).toHaveCount(4);
    expect(
      await related.evaluateAll((els) => els.map((el) => el.getAttribute('data-rel'))),
    ).toEqual(['related', 'related', 'related', 'related']);
    // "View tasks of this project" is the list filter
    await expect(page.getByTestId('children-view-task')).toHaveAccessibleName(
      'View tasks of this project',
    );
    await page.getByTestId('children-view-task').click();
    await expect(page).toHaveURL(/\/task\?project=ctxman-v1$/);
    await expect(page.getByTestId('list-row')).toHaveCount(4);
    await expect(page.getByTestId('list-project-chip')).toBeChecked();
  });

  test('reference, skill and context pages get the panels and buttons that fit them', async ({
    page,
  }) => {
    // reference: Linked from only, Add to context, no Details edit (its own form edits it)
    await page.goto('/reference/astro-docs');
    await expect(page.getByTestId('detail-linked-from')).toBeVisible();
    await expect(page.getByTestId('detail-links-to')).toHaveCount(0);
    await expect(page.getByTestId('entry-add-to-context')).toBeEnabled();
    await expect(page.getByTestId('meta-edit')).toHaveCount(0);
    await expect(page.getByTestId('state-select')).toHaveCount(0);

    // skill: Details edit, no concepts / frontmatter links
    await page.goto('/skill/okf-authoring');
    await expect(page.getByTestId('meta-edit')).toBeEnabled();
    await expect(page.getByTestId('files-new-concept')).toHaveCount(0);
    await expect(page.getByTestId('relation-add')).toHaveCount(0);

    // context: none of it
    await page.goto('/context/ctxman-dev');
    await expect(page.getByTestId('detail-content')).toBeVisible();
    for (const id of ['entry-add-to-context', 'detail-linked-from', 'meta-edit', 'entry-status']) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }
  });
});

test.describe('broken links', () => {
  const name = uniqueName('e2e-detail-broken');

  test.beforeAll(async ({ browser, playwright, baseURL }) => {
    await settleAfter(browser, baseURL, async () => {
      const request = await playwright.request.newContext({ baseURL });
      try {
        const created = await request.post(`${API}/entry/kb`, {
          data: { name, title: 'E2E broken links', description: 'Links that do not resolve.' },
        });
        expect(created.status()).toBe(201);
      } finally {
        await request.dispose();
      }
      appendFileSync(
        dataPath(`kb/${name}/index.md`),
        '\nSee [ghost](ctxman:task/e2e-no-such-task), [file](./concepts/e2e-nope.md) and [fine](ctxman:kb/ctxman).\n',
      );
    });
  });

  test.afterAll(async ({ browser, baseURL }) => {
    await settleAfter(browser, baseURL, async () => {
      rmSync(dataPath(`kb/${name}`), { recursive: true, force: true });
    });
  });

  test('links to missing entries and files render dashed with a reason; valid ones do not', async ({
    page,
  }) => {
    await page.goto(`/kb/${name}`);
    const broken = page.locator('.cx-prose a.cx-link--broken');
    await expect(broken).toHaveCount(2);
    await expect(broken.nth(0)).toHaveAttribute('title', 'Missing: task/e2e-no-such-task');
    await expect(broken.nth(1)).toHaveAttribute('title', 'Missing file: concepts/e2e-nope.md');
    for (const link of await broken.all()) {
      const style = await link.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { decoration: cs.textDecorationStyle, cursor: cs.cursor };
      });
      expect(style).toEqual({ decoration: 'dashed', cursor: 'help' });
    }
    await expect(page.locator('.cx-prose a', { hasText: 'fine' })).not.toHaveClass(
      /cx-link--broken/,
    );
    // the dangling ctxman: link also shows as a missing row under "Links to"
    const missing = page
      .getByTestId('detail-links-to')
      .locator('[data-testid="relation-row"][data-key="task/e2e-no-such-task"]');
    await expect(missing).toBeVisible();
    await expect(missing.getByTestId('relation-missing')).toHaveText('missing');
  });
});
