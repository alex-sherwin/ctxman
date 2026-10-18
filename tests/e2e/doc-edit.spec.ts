// Markdown editing in place (ROUND2_UI_SPEC §F.1, §G.1): the DocEditor island next to the SSR preview of an okf entry
// (Preview | Edit toggle, Monaco, explicit Save with Cmd/Ctrl+S, conflict dialog, validation warnings) and the
// "Open in IDE" button handled by src/scripts/shell.ts. The entry is created per run through the add script (the
// same one `pnpm run add:kb` runs, via /api/scripts/add) and removed afterwards; every assertion about what was
// saved reads the file in the e2e data copy.
//
// Facts this spec relies on (from the island authors): Monaco in Playwright's "Desktop Chrome" profile reports a
// Windows user agent, so its shortcuts are Control+a / Control+s even on macOS; a 409 always logs a browser console
// error (excluded from the zero-error assertion); a conflict is simulated with the HMR websocket frozen
// (`page.routeWebSocket`) so the dev reload that follows the on-disk edit cannot reset the page.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  API,
  dataPath,
  nextPageLoad,
  readDataText,
  settleDevReload,
  uniqueName,
} from './helpers.ts';
import { E2E_IDE_RECORD } from './paths.ts';

test.describe.configure({ mode: 'serial' });

const name = uniqueName('e2e-docedit');
const entryDir = dataPath(`kb/${name}`);
const MAIN = `kb/${name}/main.md`;
const NOTE = `kb/${name}/concepts/e2e-note.md`;
const NOTE_PAGE = `/kb/${name}/doc/concepts/e2e-note`;
const NOTE_TEXT =
  '---\ntype: Concept\ndescription: A concept for the doc editor spec.\n---\n# E2E note\n\nOriginal text.\n';

test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  try {
    const response = await request.post(`${API}/scripts/add`, {
      data: {
        dataset: 'kb',
        name,
        title: 'E2E doc edit',
        description: 'Created by the doc edit spec',
      },
    });
    expect(response.status()).toBe(200);
    expect(((await response.json()) as { code: number }).code).toBe(0);
    mkdirSync(path.join(entryDir, 'concepts'), { recursive: true });
    writeFileSync(dataPath(NOTE), NOTE_TEXT);
    // the glob loader picks both files up (and the dev server reloads open pages): wait until the entry renders
    await expect
      .poll(async () => (await request.get(`/kb/${name}/doc/concepts/e2e-note`)).status(), {
        timeout: 15_000,
      })
      .toBe(200);
  } finally {
    await request.dispose();
  }
  await settleDevReload(2000);
});

test.afterAll(async () => {
  rmSync(entryDir, { recursive: true, force: true });
  await settleDevReload();
});

/** Every recorded fake-code run, oldest first (tests/e2e/fixtures/fake-code.mjs appends one JSON line per run). */
function recordedCalls(): string[][] {
  if (!existsSync(E2E_IDE_RECORD)) return [];
  return readFileSync(E2E_IDE_RECORD, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string[]);
}

/** Opens `route` in edit mode and waits until Monaco shows the file. */
async function openEditor(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(page.getByTestId('doc-tools')).toBeVisible();
  await page.getByTestId('doc-view-edit').click();
  await expect(page).toHaveURL(/[?&]edit=1/);
  await expect(page.getByTestId('doc-editor').locator('.monaco-editor')).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * The preview shows `text`. The dev server reloads the page ~0.7 s after the write, which can be a hair BEFORE the
 * content layer has re-read the file (~1 s), so that first reloaded page may still render the old HTML. The store
 * (src/stores/doc-editor.ts, `SETTLE_RELOAD_MS`) therefore reloads ONCE more by itself ~1.5 s later; wait for it
 * without reloading manually. One manual reload stays as a tolerant safety net (the dev server is slow under load)
 * and is reported as an annotation so a regression of the settle reload does not pass silently.
 */
async function expectPreviewShows(page: Page, text: string): Promise<void> {
  const content = page.getByTestId('detail-content');
  try {
    await expect(content).toContainText(text, { timeout: 12_000 });
  } catch {
    test.info().annotations.push({
      type: 'settle-reload-missed',
      description: `the preview did not show "${text}" without a manual reload`,
    });
    await page.reload();
    await expect(content).toContainText(text, { timeout: 12_000 });
  }
}

/**
 * Types `text` at the very end of the file. Not `typeIntoMonaco` from helpers.ts: it presses ControlOrMeta+End, and
 * on macOS Monaco (Windows user agent, see the file header) ignores Meta+End, so the text would land at the top.
 */
async function typeAtEnd(page: Page, text: string): Promise<void> {
  await page.getByTestId('doc-editor').locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

/** Cmd/Ctrl+S inside Monaco (Control: see the file header). */
async function pressSave(page: Page): Promise<void> {
  await page.keyboard.press('Control+s');
}

test.describe('Open in IDE', () => {
  test.skip(process.platform === 'win32', 'the fake IDE command is a posix script');

  test('opens the entry folder with main.md and reports it inline', async ({ page }) => {
    await page.goto(`/kb/${name}`);
    const button = page.getByTestId('detail-open-ide');
    await expect(button).toBeEnabled();
    await expect(page.getByTestId('detail-ide-status')).toHaveText('');
    await button.click();
    await expect(page.getByTestId('detail-ide-status')).toHaveText('Opened in VS Code');
    await expect(page.getByTestId('detail-ide-status')).toHaveAttribute('data-kind', 'ok');
    await expect(button).toBeEnabled();
    await expect
      .poll(() => recordedCalls().some((c) => c[0] === entryDir && c[1] === dataPath(MAIN)))
      .toBe(true);
  });

  test('a sub-doc page opens that file', async ({ page }) => {
    await page.goto(NOTE_PAGE);
    await page.getByTestId('detail-open-ide').click();
    await expect(page.getByTestId('detail-ide-status')).toHaveText('Opened in VS Code');
    await expect
      .poll(() => recordedCalls().some((c) => c[0] === entryDir && c[1] === dataPath(NOTE)))
      .toBe(true);
  });

  test('a 501 shows the install hint inline and re-enables the button', async ({ page }) => {
    await page.route('**/api/ide/open', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 501,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'ide-not-found', message: 'no IDE command found' }),
          })
        : route.fallback(),
    );
    await page.goto(`/kb/${name}`);
    await page.getByTestId('detail-open-ide').click();
    const status = page.getByTestId('detail-ide-status');
    await expect(status).toContainText('`code` command not found');
    await expect(status).toContainText("Install 'code' command in PATH");
    await expect(status).toHaveAttribute('data-kind', 'error');
    await expect(page.getByTestId('detail-open-ide')).toBeEnabled();
  });

  test('another error shows the server message', async ({ page }) => {
    await page.route('**/api/ide/open', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'ide-spawn-failed', message: 'could not start code' }),
          })
        : route.fallback(),
    );
    await page.goto(`/kb/${name}`);
    await page.getByTestId('detail-open-ide').click();
    await expect(page.getByTestId('detail-ide-status')).toHaveText('could not start code');
  });

  test('the button is disabled up front when GET reports no IDE command', async ({ page }) => {
    await page.route('**/api/ide/open', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ available: false, command: null }),
          })
        : route.fallback(),
    );
    await page.goto(`/kb/${name}`);
    const button = page.getByTestId('detail-open-ide');
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', /command not found/);
  });
});

test.describe('edit mode', () => {
  test('Edit toggle loads the file; saving writes it, leaves edit and the reload shows the text', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`/kb/${name}`);
    await expect(page.getByTestId('detail-content')).toBeVisible();
    await expect(page.getByTestId('doc-save')).toHaveCount(0);

    await page.getByTestId('doc-view-edit').click();
    await expect(page).toHaveURL(/[?&]edit=1/);
    await expect(page.getByTestId('detail-content')).toBeHidden();
    const editor = page.getByTestId('doc-editor');
    await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
    // Monaco shows the file: frontmatter included
    await expect(editor.locator('.view-lines')).toContainText(`name: ${name}`);
    await expect(page.getByTestId('doc-save')).toBeDisabled();

    const marker = `Edited by the doc edit spec ${Math.random().toString(36).slice(2, 8)}.`;
    await typeAtEnd(page, `\n\n${marker}`);
    await expect(page.getByTestId('doc-save')).toBeEnabled();
    await expect(page.getByTestId('doc-tools')).toContainText('Unsaved changes');

    const reloaded = nextPageLoad(page);
    const put = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().endsWith(`/api/doc/kb/${name}/main.md`),
    );
    await pressSave(page);
    expect((await put).status()).toBe(200);

    // back to the preview at once (edit removed from the URL), the old HTML dimmed until the reload
    await expect(page).not.toHaveURL(/edit=1/);
    expect(readDataText(MAIN)).toContain(marker);
    await reloaded;
    // The store reloads exactly ONCE more ~1.5 s later (the content layer may lag the dev reload), keeps "Saved"
    // visible across it and never loops (src/stores/doc-editor.ts, SETTLE_RELOAD_MS). Listen before asserting.
    let loads = 0;
    page.on('load', () => loads++);
    const settled = nextPageLoad(page);
    await expect(page.getByTestId('doc-status')).toHaveText('Saved');
    await expect(page.getByTestId('doc-editor')).toHaveCount(0);
    await settled;
    await expect(page.getByTestId('doc-status')).toHaveText('Saved');
    await expectPreviewShows(page, marker);
    await page.waitForTimeout(2500);
    expect(loads).toBe(1);
    expect(errors).toEqual([]);
  });

  test('?edit=1 opens straight into the editor; Cancel leaves it', async ({ page }) => {
    await page.goto(`/kb/${name}?edit=1`);
    await expect(page.getByTestId('detail-content')).toBeHidden();
    await expect(page.getByTestId('doc-editor').locator('.monaco-editor')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('doc-view-edit')).toHaveAttribute('data-selected', 'true');
    await page.getByTestId('doc-cancel').click();
    await expect(page).not.toHaveURL(/edit=1/);
    await expect(page.getByTestId('detail-content')).toBeVisible();
  });

  test('leaving edit with unsaved changes asks first', async ({ page }) => {
    await openEditor(page, `/kb/${name}`);
    await typeAtEnd(page, ' unsaved');
    await page.getByTestId('doc-view-preview').click();
    await expect(page.getByTestId('doc-discard-dialog')).toBeVisible();
    await page.getByTestId('doc-discard-dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('doc-discard-dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/edit=1/);
    await page.getByTestId('doc-cancel').click();
    await page.getByTestId('doc-discard-dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page).not.toHaveURL(/edit=1/);
    await expect(page.getByTestId('detail-content')).toBeVisible();
    expect(readDataText(MAIN)).not.toContain('unsaved');
  });

  test('a sub-doc page edits its own file', async ({ page }) => {
    await openEditor(page, NOTE_PAGE);
    await expect(page.getByTestId('doc-tools')).toContainText('concepts/e2e-note.md');
    await expect(page.getByTestId('doc-editor').locator('.view-lines')).toContainText(
      'Original text.',
    );
    const reloaded = nextPageLoad(page);
    await typeAtEnd(page, 'Second paragraph.');
    await pressSave(page);
    await expect(page).not.toHaveURL(/edit=1/);
    await reloaded;
    await expectPreviewShows(page, 'Second paragraph.');
    expect(readDataText(NOTE)).toContain('Second paragraph.');
  });

  test('frontmatter that fails validation is saved anyway and the findings are listed', async ({
    page,
  }) => {
    await openEditor(page, NOTE_PAGE);
    const editor = page.getByTestId('doc-editor');
    await editor.locator('.monaco-editor textarea').focus();
    await page.keyboard.press('Control+a');
    // no `type`: every concept needs one (okf rule); the save is never blocked by findings
    await page.keyboard.type('---\ndescription: No type here.\n---\n# E2E note\n\nAfter save.\n');
    const reloaded = nextPageLoad(page);
    const put = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes('/api/doc/'),
    );
    await pressSave(page);
    const response = await put;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { warnings: { message: string }[] };
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(readDataText(NOTE)).toContain('No type here.');

    await reloaded;
    await expect(page.getByTestId('doc-status')).toContainText('warning');
    const list = page.getByTestId('doc-warnings');
    await expect(list).toBeVisible();
    await expect(list).toContainText(body.warnings[0]?.message ?? '');
    await expectPreviewShows(page, 'After save.');
  });
});

test.describe('conflicts', () => {
  /** The file changes on disk behind the editor's back. The dev reload that follows is held back. */
  async function openFrozen(page: Page, route: string): Promise<void> {
    await page.routeWebSocket(/.*/, () => {});
    await openEditor(page, route);
  }

  /** Write after a pause so the mtime differs from the one the editor loaded. */
  async function changeOnDisk(rel: string, text: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    writeFileSync(dataPath(rel), text);
  }

  test('Save over a changed file opens the dialog; "load disk version" takes the disk text', async ({
    page,
  }) => {
    await openFrozen(page, NOTE_PAGE);
    await typeAtEnd(page, ' mine');
    await changeOnDisk(NOTE, `${NOTE_TEXT}\nDisk wins ${name}.\n`);

    await pressSave(page);
    await expect(page.getByTestId('doc-conflict-dialog')).toBeVisible();
    await expect(page.getByTestId('doc-tools')).toContainText('Changed on disk');
    await page.getByTestId('doc-conflict-reload').click();
    await expect(page.getByTestId('doc-conflict-dialog')).toHaveCount(0);
    await expect(page.getByTestId('doc-editor').locator('.view-lines')).toContainText(
      `Disk wins ${name}.`,
    );
    await expect(page.getByTestId('doc-editor').locator('.view-lines')).not.toContainText('mine');
    await expect(page.getByTestId('doc-save')).toBeDisabled();
    expect(readDataText(NOTE)).toContain(`Disk wins ${name}.`);
  });

  test('"Keep editing" closes the dialog and keeps the draft; "Overwrite" saves it', async ({
    page,
  }) => {
    await openFrozen(page, NOTE_PAGE);
    await typeAtEnd(page, ' my-overwrite');
    await changeOnDisk(NOTE, `${NOTE_TEXT}\nOther writer.\n`);

    await pressSave(page);
    await expect(page.getByTestId('doc-conflict-dialog')).toBeVisible();
    await page.getByTestId('doc-conflict-cancel').click();
    await expect(page.getByTestId('doc-conflict-dialog')).toHaveCount(0);
    await expect(page.getByTestId('doc-editor').locator('.view-lines')).toContainText(
      'my-overwrite',
    );
    expect(readDataText(NOTE)).not.toContain('my-overwrite');

    await pressSave(page);
    await expect(page.getByTestId('doc-conflict-dialog')).toBeVisible();
    const put = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes('/api/doc/'),
    );
    await page.getByTestId('doc-conflict-overwrite').click();
    expect((await put).status()).toBe(200);
    await expect(page).not.toHaveURL(/edit=1/);
    const saved = readDataText(NOTE);
    expect(saved).toContain('my-overwrite');
    expect(saved).not.toContain('Other writer.');
  });
});
