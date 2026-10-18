// Markdown editing in place (ROUND2_UI_SPEC §F.1, §G.1; ROUND3_SPEC §E-§G): the DocEditor island next to the SSR
// preview of an okf entry (Preview | Edit toggle, Monaco, explicit Save with Cmd/Ctrl+S, conflict dialog,
// validation + link warnings, entry-link completion and the "Insert link…" picker, drafts kept in localStorage
// with NO native beforeunload prompt) and the "Open in IDE" button handled by src/scripts/shell.ts. The entry is
// created per run through the add script (the same one `pnpm run add:kb` runs, via /api/scripts/add) and removed
// afterwards; every assertion about what was saved reads the file in the e2e data copy.
//
// Facts this spec relies on (from the island authors): Monaco in Playwright's "Desktop Chrome" profile reports a
// Windows user agent, so its shortcuts are Control+a / Control+s even on macOS; a 409 always logs a browser console
// error (excluded from the zero-error assertion); a conflict is simulated with the HMR websocket frozen
// (`page.routeWebSocket`) so the dev reload that follows the on-disk edit cannot reset the page.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures.ts';
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
const MAIN = `kb/${name}/index.md`;
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

/**
 * Pastes `text` at the very end of the file: a synthetic paste event inserts it verbatim (typing would open the
 * link completion on `](`). Not `pasteIntoMonaco` from helpers.ts, which moves with ControlOrMeta+End (see typeAtEnd).
 */
async function pasteAtEnd(page: Page, text: string): Promise<void> {
  const textarea = page.getByTestId('doc-editor').locator('.monaco-editor textarea');
  await textarea.focus();
  await page.keyboard.press('Control+End');
  await textarea.evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

/** Cmd/Ctrl+S inside Monaco (Control: see the file header). */
async function pressSave(page: Page): Promise<void> {
  await page.keyboard.press('Control+s');
}

test.describe('Open in IDE', () => {
  test.skip(process.platform === 'win32', 'the fake IDE command is a posix script');

  test('opens the entry folder with index.md and reports it inline', async ({ page }) => {
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
      (r) => r.request().method() === 'PUT' && r.url().endsWith(`/api/doc/kb/${name}/index.md`),
    );
    await pressSave(page);
    expect((await put).status()).toBe(200);

    // back to the preview at once (edit removed from the URL), the old HTML dimmed until the reload
    await expect(page).not.toHaveURL(/edit=1/);
    expect(readDataText(MAIN)).toContain(marker);
    await reloaded;
    // Exactly ONE reload follows a save (src/stores/doc-editor.ts, RELOAD_AFTER_SAVE_MS); "Saved" survives it and
    // nothing reloads again afterwards. Listen before asserting.
    let loads = 0;
    page.on('load', () => loads++);
    await expect(page.getByTestId('doc-status')).toHaveText('Saved');
    await expect(page.getByTestId('doc-editor')).toHaveCount(0);
    await expectPreviewShows(page, marker);
    await page.waitForTimeout(2500);
    expect(loads).toBe(0);
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

/** localStorage key of the draft of `kb/<name>/index.md` (src/stores/doc-editor.ts `docKey` + draft-backup.ts). */
const MAIN_DRAFT_KEY = `ctxman:draft:doc:kb/${name}/index.md`;

/** The persisted draft of index.md (null when none): what an unsaved reload would bring back. */
async function storedDraft(page: Page): Promise<{ text: string; base: string } | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as { text: string; base: string });
  }, MAIN_DRAFT_KEY);
}

/** What the editor shows at the end of the file (the cursor is there after `typeAtEnd`; Monaco renders only that part). */
const viewLines = (page: Page) => page.getByTestId('doc-editor').locator('.view-lines');

/** Collects every native dialog (a `beforeunload` prompt would show up here) and dismisses it. */
function trackDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on('dialog', (dialog) => {
    seen.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return seen;
}

test.describe('entry links in the editor', () => {
  test('"Insert link…" opens the picker; picking inserts a ctxman link at the cursor and returns the focus', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await openEditor(page, `/kb/${name}`);
    await typeAtEnd(page, '\n\nSee ');
    await page.getByTestId('doc-insert-link').click();
    await expect(page.getByTestId('link-picker')).toBeVisible();
    await page.getByTestId('link-picker-search').fill('okf-format');
    await expect(page.getByTestId('link-picker-row')).toHaveCount(1);
    await page.getByTestId('link-picker-pick').click();
    await expect(page.getByTestId('link-picker')).toHaveCount(0);

    await expect(viewLines(page)).toContainText('See [OKF format](ctxman:kb/okf-format)');
    // the editor has the focus again: a Space types a space instead of pressing the toolbar button again
    await expect(page.getByTestId('doc-editor').locator('.monaco-editor textarea')).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.type('and more');
    await expect(page.getByTestId('link-picker')).toHaveCount(0);
    await expect(viewLines(page)).toContainText('(ctxman:kb/okf-format) and more');
    await expect(page.getByTestId('doc-save')).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('a selection becomes the link text', async ({ page }) => {
    await openEditor(page, `/kb/${name}`);
    await typeAtEnd(page, '\n\nselected words');
    await page.keyboard.press('Shift+Control+ArrowLeft');
    await page.keyboard.press('Shift+Control+ArrowLeft');
    await page.getByTestId('doc-insert-link').click();
    await page.getByTestId('link-picker-search').fill('okf-format');
    await page.getByTestId('link-picker-pick').click();
    await expect(viewLines(page)).toContainText('[selected words](ctxman:kb/okf-format)');
  });

  test('Mod+Alt+K opens the picker; Esc closes it and the focus is back in the editor', async ({
    page,
  }) => {
    await openEditor(page, `/kb/${name}`);
    await typeAtEnd(page, ' ');
    // Control: Monaco in the "Desktop Chrome" profile reports a Windows user agent (see the file header)
    await page.keyboard.press('Control+Alt+k');
    await expect(page.getByTestId('link-picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('link-picker')).toHaveCount(0);
    await expect(page.getByTestId('doc-editor').locator('.monaco-editor textarea')).toBeFocused();
    // Esc inside the picker must not leave edit mode
    await expect(page).toHaveURL(/edit=1/);
  });

  test('`[[` and `](` complete entries; `ctxman:` completes a target', async ({ page }) => {
    await openEditor(page, `/kb/${name}`);
    const suggest = page.locator('.monaco-editor .suggest-widget.visible');

    await typeAtEnd(page, '\n\n[[Write');
    await expect(suggest).toBeVisible();
    await expect(suggest).toContainText('Write AGENTS.md');
    await page.keyboard.press('Enter');
    await expect(viewLines(page)).toContainText('[Write AGENTS.md](ctxman:task/write-agents-md)');

    await page.keyboard.type('\n\n[a](');
    await expect(suggest).toBeVisible();
    await expect(suggest).toContainText('okf-format');
    // the destination kind inserts `ctxman:<ds>/<slug>` and the closing paren
    await page.keyboard.type('okf-f');
    await page.keyboard.press('Enter');
    await expect(viewLines(page)).toContainText('[a](ctxman:kb/okf-format)');

    await page.keyboard.type('\n\nsee ctxman:');
    await expect(suggest).toBeVisible();
    await expect(suggest).toContainText('okf-format');
    await page.keyboard.press('Escape');
    await expect(suggest).toHaveCount(0);
    await expect(page).toHaveURL(/edit=1/);
  });

  test('saving broken links succeeds with warnings; the preview marks the links broken', async ({
    page,
  }) => {
    await openEditor(page, `/kb/${name}`);
    await pasteAtEnd(
      page,
      '\n\nLinks gone wrong: [a](./e2e-missing-note.md) and [b](ctxman:idea/e2e-nope).\n',
    );
    // the paste has reached the model (and the editor is dirty) before the shortcut runs
    await expect(viewLines(page)).toContainText('ctxman:idea/e2e-nope');
    await expect(page.getByTestId('doc-save')).toBeEnabled();
    const reloaded = nextPageLoad(page);
    const put = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().endsWith(`/api/doc/kb/${name}/index.md`),
    );
    await pressSave(page);
    const response = await put;
    expect(response.status()).toBe(200);
    // link findings come back as `error` severity but are warnings: the save is never blocked
    const body = (await response.json()) as { warnings: { rule: string; severity: string }[] };
    expect(body.warnings.map((w) => w.rule).sort()).toEqual([
      'links/broken',
      'links/ctxman-target',
    ]);
    expect(readDataText(MAIN)).toContain('ctxman:idea/e2e-nope');

    await reloaded;
    await expect(page.getByTestId('doc-status')).toHaveText('Saved · 2 warnings');
    const list = page.getByTestId('doc-warnings');
    await expect(list).toContainText('links/broken');
    await expect(list).toContainText('links/ctxman-target');
    await expect(list.locator('li')).toHaveCount(2);
    // the preview renders from the content layer, which can lag the dev reload by ~1 s (settle reload)
    await expect(page.locator('[data-testid="detail-content"] a.cx-link--broken')).toHaveCount(2, {
      timeout: 15_000,
    });
  });
});

test.describe('drafts survive a reload (no native prompt)', () => {
  test('a dirty editor reloads without a dialog and offers the draft back; Discard drops it', async ({
    page,
  }) => {
    const dialogs = trackDialogs(page);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await openEditor(page, `/kb/${name}`);
    await typeAtEnd(page, '\n\nDRAFT-LINE-ONE');
    await expect(page.getByTestId('doc-save')).toBeEnabled();
    await expect
      .poll(async () => (await storedDraft(page))?.text ?? '')
      .toContain('DRAFT-LINE-ONE');

    await page.reload();
    await expect(page.getByTestId('doc-editor').locator('.monaco-editor')).toBeVisible({
      timeout: 30_000,
    });
    expect(dialogs).toEqual([]);
    const banner = page.getByTestId('doc-draft-restored');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Restored unsaved changes');
    await expect(banner).not.toHaveAttribute('data-stale', /.*/);
    await expect(page.getByTestId('doc-save')).toBeEnabled();
    await page.getByTestId('doc-editor').locator('.monaco-editor textarea').focus();
    await page.keyboard.press('Control+End');
    await expect(viewLines(page)).toContainText('DRAFT-LINE-ONE');

    await page.getByTestId('doc-draft-discard').click();
    await expect(banner).toHaveCount(0);
    await expect(viewLines(page)).not.toContainText('DRAFT-LINE-ONE');
    await expect(page.getByTestId('doc-save')).toBeDisabled();
    expect(await storedDraft(page)).toBeNull();
    expect(readDataText(MAIN)).not.toContain('DRAFT-LINE-ONE');
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a draft whose file changed on disk is restored with a warning; saving overwrites the disk text', async ({
    page,
  }) => {
    // the dev reload that follows the on-disk edit is held back; the reload below is explicit
    await page.routeWebSocket(/.*/, () => {});
    const dialogs = trackDialogs(page);
    await openEditor(page, `/kb/${name}`);
    await typeAtEnd(page, '\n\nSTALE-DRAFT-LINE');
    await expect
      .poll(async () => (await storedDraft(page))?.text ?? '')
      .toContain('STALE-DRAFT-LINE');

    await new Promise((resolve) => setTimeout(resolve, 50)); // the mtime must differ from the loaded one
    writeFileSync(dataPath(MAIN), `${readDataText(MAIN)}\nDISK-EDIT-LINE\n`);
    await page.reload();

    const banner = page.getByTestId('doc-draft-restored');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toHaveAttribute('data-stale', 'true');
    await expect(banner).toContainText('the file changed on disk since');
    expect(dialogs).toEqual([]);
    await page.getByTestId('doc-editor').locator('.monaco-editor textarea').focus();
    await page.keyboard.press('Control+End');
    await expect(viewLines(page)).toContainText('STALE-DRAFT-LINE');
    await expect(viewLines(page)).not.toContainText('DISK-EDIT-LINE');

    // Discard shows the version that is on disk now
    await page.getByTestId('doc-draft-discard').click();
    await expect(banner).toHaveCount(0);
    await expect(viewLines(page)).toContainText('DISK-EDIT-LINE');
    expect(await storedDraft(page)).toBeNull();
  });

  test('a preview with a stored draft offers "Resume editing"; Cancel + Discard removes the offer', async ({
    page,
  }) => {
    const dialogs = trackDialogs(page);
    await openEditor(page, `/kb/${name}`);
    await typeAtEnd(page, '\n\nRESUME-DRAFT-LINE');
    await expect
      .poll(async () => (await storedDraft(page))?.text ?? '')
      .toContain('RESUME-DRAFT-LINE');

    await page.goto(`/kb/${name}`);
    expect(dialogs).toEqual([]);
    const available = page.getByTestId('doc-draft-available');
    await expect(available).toBeVisible({ timeout: 30_000 });
    await expect(available).toContainText('Unsaved changes to this file');
    await expect(page.getByTestId('doc-draft-restored')).toHaveCount(0);

    await page.getByTestId('doc-draft-resume').click();
    await expect(page).toHaveURL(/edit=1/);
    await expect(page.getByTestId('doc-draft-restored')).toBeVisible({ timeout: 30_000 });
    await expect(available).toHaveCount(0);

    await page.getByTestId('doc-cancel').click();
    await page.getByTestId('doc-discard-dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page).not.toHaveURL(/edit=1/);
    await expect(available).toHaveCount(0);
    expect(await storedDraft(page)).toBeNull();
  });

  test('a saved draft is gone: the reloaded page has no draft offer', async ({ page }) => {
    await openEditor(page, `/kb/${name}`);
    await typeAtEnd(page, '\n\nSAVED-DRAFT-LINE');
    await expect
      .poll(async () => (await storedDraft(page))?.text ?? '')
      .toContain('SAVED-DRAFT-LINE');
    const reloaded = nextPageLoad(page);
    await pressSave(page);
    await expect(page).not.toHaveURL(/edit=1/);
    expect(await storedDraft(page)).toBeNull();
    await reloaded;
    await expect(page.getByTestId('doc-status')).toBeVisible();
    await expect(page.getByTestId('doc-draft-available')).toHaveCount(0);
    expect(readDataText(MAIN)).toContain('SAVED-DRAFT-LINE');
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
