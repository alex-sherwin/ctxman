// Relations in the UI (ROUND3_SPEC §E.2, §E.4, §J): the Children panel of a project, the parent chip and the
// "Linked from" / "Links to" panels of its children, adding and removing links through the EntryTools dialogs, the
// `?project=` list filter and "Build context". Everything runs on an e2e-* project with its own tasks (never the seed
// project, so `/task?project=ctxman-v1` stays the 4 seed tasks); each write is followed by a page load (dev reload).
import { readFileSync, rmSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import type { Locator, Page } from '@playwright/test';
import { settleAfter } from './dev-reload.ts';
import { API, dataPath, readDataText, readYaml, uniqueName } from './helpers.ts';

const project = uniqueName('e2e-rel-proj');
const taskA = uniqueName('e2e-rel-a'); // created with `parent`
const taskB = uniqueName('e2e-rel-b'); // added through the "Add existing" picker
const mainOf = (ds: string, slug: string): string => `${ds}/${slug}/index.md`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  await settleAfter(browser, baseURL, async () => {
    const request = await playwright.request.newContext({ baseURL });
    try {
      const projectResponse = await request.post(`${API}/entry/project`, {
        data: {
          name: project,
          title: 'E2E relations project',
          description: 'Project for the relations spec.',
        },
      });
      expect(projectResponse.status()).toBe(201);
      const a = await request.post(`${API}/entry/task`, {
        data: {
          name: taskA,
          title: 'E2E relations task A',
          description: 'Created as a child.',
          parent: project,
        },
      });
      expect(a.status()).toBe(201);
      const b = await request.post(`${API}/entry/task`, {
        data: {
          name: taskB,
          title: 'E2E relations task B',
          description: 'Added later.',
          state: 'complete',
        },
      });
      expect(b.status()).toBe(201);
    } finally {
      await request.dispose();
    }
  });
});

test.afterAll(async ({ browser, playwright, baseURL }) => {
  await settleAfter(browser, baseURL, async () => {
    for (const [ds, slug] of [
      ['task', taskA],
      ['task', taskB],
      ['project', project],
    ] as const) {
      rmSync(dataPath(`${ds}/${slug}`), { recursive: true, force: true });
    }
    const request = await playwright.request.newContext({ baseURL });
    try {
      await request.delete(`${API}/context/${project}`);
    } finally {
      await request.dispose();
    }
  });
});

/** Opens a detail page and waits for the island to enable a button that is on it. */
async function open(page: Page, url: string, button: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId(button)).toBeEnabled();
}

/** The row of the other entry `key` in a panel. */
const rowOf = (panel: Locator, testId: string, key: string): Locator =>
  panel.locator(`[data-testid="${testId}"][data-key="${key}"]`);

/** Picks `slug` in the open relation picker (search, then the row's button). */
async function pick(page: Page, key: string): Promise<void> {
  await expect(page.getByTestId('relation-picker')).toBeVisible();
  await page.getByTestId('relation-picker-search').fill(key.split('/')[1] ?? key);
  await page
    .locator(`[data-testid="relation-picker-row"][data-key="${key}"]`)
    .getByTestId('relation-picker-pick')
    .click();
}

test('the project lists the child it was created with and its progress', async ({ page }) => {
  await open(page, `/project/${project}`, 'children-add');
  const panel = page.getByTestId('children-panel');
  await expect(panel.getByTestId('children-row')).toHaveCount(1);
  await expect(rowOf(panel, 'children-row', `task/${taskA}`)).toContainText('E2E relations task A');
  await expect(panel.getByTestId('children-progress')).toHaveText('0 of 1 done');
  // New / View links of the footer
  await expect(panel.getByTestId('children-new-task')).toHaveAttribute(
    'href',
    `/new/task?parent=${project}`,
  );
  await expect(panel.getByTestId('children-new-feature')).toHaveAttribute(
    'href',
    `/new/feature?parent=${project}`,
  );
  await expect(panel.getByTestId('children-view-task')).toHaveAttribute(
    'href',
    `/task?project=${project}`,
  );
  await expect(panel.getByTestId('children-view-task')).toContainText('1');
  // the children are not repeated under "Links to"
  await expect(page.getByTestId('detail-links-to').getByTestId('relation-row')).toHaveCount(0);
});

test('"Add existing" links a task as a child; the child page shows the parent', async ({
  page,
}) => {
  await open(page, `/project/${project}`, 'children-add');
  await page.getByTestId('children-add').click();
  await expect(page.getByTestId('relation-picker')).toHaveAttribute('data-mode', 'child');
  // a child that is already linked cannot be picked again
  await page.getByTestId('relation-picker-search').fill(taskA);
  await expect(
    page.locator(`[data-testid="relation-picker-row"][data-key="task/${taskA}"]`),
  ).toHaveAttribute('aria-disabled', 'true');
  await pick(page, `task/${taskB}`);

  const panel = page.getByTestId('children-panel');
  await expect(panel.getByTestId('children-row')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByTestId('entry-status')).toHaveText(/^Linked /);
  // B is complete, A pending
  await expect(panel.getByTestId('children-progress')).toHaveText('1 of 2 done');
  expect(readDataText(mainOf('project', project))).toMatch(
    new RegExp(`slug: ${taskB}\\n\\s+rel: child`),
  );

  for (const slug of [taskA, taskB]) {
    await page.goto(`/task/${slug}`);
    const parent = page.getByTestId('detail-parent');
    await expect(parent).toHaveText('Part of E2E relations project');
    await expect(parent).toHaveAttribute('href', `/project/${project}`);
    const linkedFrom = rowOf(
      page.getByTestId('detail-linked-from'),
      'relation-row',
      `project/${project}`,
    );
    await expect(linkedFrom).toContainText('Parent');
    await expect(linkedFrom).toHaveAttribute('data-rel', 'child');
  }
});

test('relation-add with "Depends on" shows on both pages; relation-remove takes it away again', async ({
  page,
}) => {
  await open(page, `/task/${taskA}`, 'relation-add');
  await page.getByTestId('relation-add').click();
  await page.getByTestId('relation-rel').click();
  await page.getByRole('option', { name: 'Depends on' }).click();
  await pick(page, `task/${taskB}`);

  const links = page.getByTestId('detail-links-to');
  const out = rowOf(links, 'relation-row', `task/${taskB}`);
  await expect(out).toBeVisible({ timeout: 15_000 });
  await expect(out).toHaveAttribute('data-rel', 'depends-on');
  await expect(out).toContainText('Depends on');
  await expect(out).toHaveAttribute('data-source', 'frontmatter');

  await page.goto(`/task/${taskB}`);
  const incoming = rowOf(page.getByTestId('detail-linked-from'), 'relation-row', `task/${taskA}`);
  await expect(incoming).toContainText('Required by');
  // an incoming row has no remove button: only the entry that declares a link edits it
  await expect(incoming.getByTestId('relation-remove')).toHaveCount(0);

  await open(page, `/task/${taskA}`, 'relation-add');
  await rowOf(page.getByTestId('detail-links-to'), 'relation-row', `task/${taskB}`)
    .getByTestId('relation-remove')
    .click();
  const dialog = page.getByTestId('relation-remove-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(
    rowOf(page.getByTestId('detail-links-to'), 'relation-row', `task/${taskB}`),
  ).toHaveCount(0, {
    timeout: 15_000,
  });
  // the last link is gone: the key leaves the frontmatter
  expect(readFileSync(dataPath(mainOf('task', taskA)), 'utf8')).not.toContain('links:');
});

test("/task?project=<slug> lists exactly the project's tasks; unticking the chip drops the filter", async ({
  page,
}) => {
  await page.goto(`/task?project=${project}`);
  const chip = page.getByTestId('list-project-chip');
  await expect(chip).toBeChecked();
  await expect(page.locator('label.ck-chip', { has: chip })).toContainText('E2E relations project');
  const slugs = await page
    .getByTestId('list-row')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.slug));
  expect(slugs.sort()).toEqual([taskA, taskB].sort());
  await expect(page.getByTestId('list-result-count')).toHaveText('2 of 2');
  // other filters keep the project
  await page.getByTestId('list-sort').selectOption('name');
  await expect(page).toHaveURL(new RegExp(`project=${project}`));
  await expect(page).toHaveURL(/sort=name/);

  await page.locator('label.ck-chip', { has: chip }).click();
  await expect(page).not.toHaveURL(/project=/);
  await expect(page.getByTestId('list-project-chip')).toHaveCount(0);
  // the "New" button of a project-scoped list pre-fills the parent
  await page.goto(`/task?project=${project}`);
  await expect(page.getByTestId('list-new-entry')).toHaveAttribute(
    'href',
    `/new/task?parent=${project}`,
  );
});

test('the seed project filter shows its four tasks', async ({ page }) => {
  await page.goto('/task?project=ctxman-v1');
  await expect(page.getByTestId('list-row')).toHaveCount(4);
  await expect(page.getByTestId('list-project-chip')).toBeChecked();
});

test('entry-build-context creates a context from the project and opens it in the Forge', async ({
  page,
}) => {
  await open(page, `/project/${project}`, 'entry-build-context');
  await page.getByTestId('entry-build-context').click();
  await expect(page.getByTestId('build-context-dialog')).toBeVisible();
  // the project (locked) and its two children are checked
  await expect(page.getByTestId('build-context-item')).toHaveCount(3);
  await expect(page.getByTestId('build-context-name')).toHaveValue(project);
  await page.getByTestId('build-context-submit').click();

  await expect(page).toHaveURL(new RegExp(`/forge\\?context=${project}$`), { timeout: 15_000 });
  const saved = readYaml(`context/${project}.yaml`) as {
    links: { dataset: string; slug: string }[];
  };
  expect(saved.links.map((l) => `${l.dataset}/${l.slug}`)).toEqual([
    `project/${project}`,
    `task/${taskA}`,
    `task/${taskB}`,
  ]);
});

test('children-remove drops a child; with the last one the project has no links key', async ({
  page,
}) => {
  await open(page, `/project/${project}`, 'children-add');
  const panel = page.getByTestId('children-panel');
  for (const slug of [taskA, taskB]) {
    await rowOf(panel, 'children-row', `task/${slug}`).getByTestId('children-remove').click();
    await page
      .getByTestId('relation-remove-dialog')
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    await expect(rowOf(panel, 'children-row', `task/${slug}`)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('children-add')).toBeEnabled();
  }
  await expect(panel.getByTestId('children-row')).toHaveCount(0);
  expect(readFileSync(dataPath(mainOf('project', project)), 'utf8')).not.toContain('links:');
  // the tasks do not point to the project any more
  await page.goto(`/task/${taskA}`);
  await expect(page.getByTestId('detail-parent')).toHaveCount(0);
});
