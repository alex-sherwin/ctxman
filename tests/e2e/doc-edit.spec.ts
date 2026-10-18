// Markdown editing in place (ROUND2_UI_SPEC §F.1, §G.1; ROUND3_SPEC §E-§G): the DocEditor island next to the SSR
// preview of an okf entry (Preview | Edit toggle, Monaco, explicit Save with Cmd/Ctrl+S, conflict dialog,
// validation + link warnings, entry-link completion and the "Insert link…" picker, drafts kept in localStorage
// with NO native beforeunload prompt) and the "Open in IDE" button handled by src/scripts/shell.ts. Every test gets
// its own entry (the `doc` fixture: created through POST /api/entry/kb plus one concept file, removed afterwards), so
// the tests run in parallel; every assertion about what was saved reads the file in the worker's data copy.
//
// Facts this spec relies on: Monaco in Playwright's "Desktop Chrome" profile reports a Windows user agent, so its
// shortcuts are Control+a / Control+s even on macOS; a 409 always logs a browser console error (excluded from the
// zero-error assertion); a conflict is simulated by writing the file on disk behind the editor and bumping its mtime.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test as base } from './fixtures.ts';
import type { Page } from '@playwright/test';
import {
  API,
  bumpMtime,
  dataPath,
  nextPageLoad,
  pollUntil,
  readDataText,
  uniqueName,
  waitForApi,
} from './helpers.ts';
import { E2E_IDE_RECORD } from './paths.ts';

interface DocEntry {
  name: string;
  /** Data-relative path of the entry file (an okf bundle's entry file is `index.md`). */
  main: string;
  /** Data-relative path of the one concept file. */
  note: string;
  /** Route of the concept's doc page. */
  notePage: string;
}

const NOTE_TEXT =
  '---\ntype: Concept\ndescription: A concept for the doc editor spec.\n---\n# E2E note\n\nOriginal text.\n';

/** A fresh kb entry with one concept per test (test-scoped, so the tests share nothing and can run in parallel). */
const test = base.extend<{ doc: DocEntry }>({
  doc: async ({ request }, use) => {
    const name = uniqueName('e2e-docedit');
    const response = await request.post(`${API}/entry/kb`, {
      data: { name, title: 'E2E doc edit', description: 'Created by the doc edit spec' },
    });
    expect(response.status()).toBe(201);
    const doc: DocEntry = {
      name,
      main: `kb/${name}/index.md`,
      note: `kb/${name}/concepts/e2e-note.md`,
      notePage: `/kb/${name}/doc/concepts/e2e-note`,
    };
    mkdirSync(path.join(dataPath(`kb/${name}`), 'concepts'), { recursive: true });
    writeFileSync(dataPath(doc.note), NOTE_TEXT);
    try {
      await use(doc);
    } finally {
      rmSync(dataPath(`kb/${name}`), { recursive: true, force: true });
    }
  },
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
    timeout: 15_000,
  });
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

  test('opens the entry folder with index.md and reports it inline', async ({ page, doc }) => {
    await page.goto(`/kb/${doc.name}`);
    const button = page.getByTestId('detail-open-ide');
    await expect(button).toBeEnabled();
    await expect(page.getByTestId('detail-ide-status')).toHaveText('');
    await button.click();
    await expect(page.getByTestId('detail-ide-status')).toHaveText('Opened in VS Code');
    await expect(page.getByTestId('detail-ide-status')).toHaveAttribute('data-kind', 'ok');
    await expect(button).toBeEnabled();
    const entryDir = dataPath(`kb/${doc.name}`);
    await pollUntil(recordedCalls, (calls) =>
      calls.some((c) => c[0] === entryDir && c[1] === dataPath(doc.main)),
    );
  });

  test('a sub-doc page opens that file', async ({ page, doc }) => {
    await page.goto(doc.notePage);
    await page.getByTestId('detail-open-ide').click();
    await expect(page.getByTestId('detail-ide-status')).toHaveText('Opened in VS Code');
    const entryDir = dataPath(`kb/${doc.name}`);
    await pollUntil(recordedCalls, (calls) =>
      calls.some((c) => c[0] === entryDir && c[1] === dataPath(doc.note)),
    );
  });

  test('a 501 shows the install hint inline and re-enables the button', async ({ page, doc }) => {
    await page.route('**/api/ide/open', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 501,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'ide-not-found', message: 'no IDE command found' }),
          })
        : route.fallback(),
    );
    await page.goto(`/kb/${doc.name}`);
    await page.getByTestId('detail-open-ide').click();
    const status = page.getByTestId('detail-ide-status');
    await expect(status).toContainText('`code` command not found');
    await expect(status).toContainText("Install 'code' command in PATH");
    await expect(status).toHaveAttribute('data-kind', 'error');
    await expect(page.getByTestId('detail-open-ide')).toBeEnabled();
  });

  test('another error shows the server message', async ({ page, doc }) => {
    await page.route('**/api/ide/open', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'ide-spawn-failed', message: 'could not start code' }),
          })
        : route.fallback(),
    );
    await page.goto(`/kb/${doc.name}`);
    await page.getByTestId('detail-open-ide').click();
    await expect(page.getByTestId('detail-ide-status')).toHaveText('could not start code');
  });

  test('the button is disabled up front when GET reports no IDE command', async ({ page, doc }) => {
    await page.route('**/api/ide/open', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ available: false, command: null }),
          })
        : route.fallback(),
    );
    await page.goto(`/kb/${doc.name}`);
    const button = page.getByTestId('detail-open-ide');
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', /command not found/);
  });
});

test.describe('edit mode', () => {
  test('Edit toggle loads the file; saving writes it, leaves edit and the reload shows the text', async ({
    page,
    doc,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`/kb/${doc.name}`);
    await expect(page.getByTestId('detail-content')).toBeVisible();
    await expect(page.getByTestId('doc-save')).toHaveCount(0);

    await page.getByTestId('doc-view-edit').click();
    await expect(page).toHaveURL(/[?&]edit=1/);
    await expect(page.getByTestId('detail-content')).toBeHidden();
    const editor = page.getByTestId('doc-editor');
    await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
    // Monaco shows the file: frontmatter included
    await expect(editor.locator('.view-lines')).toContainText(`name: ${doc.name}`);
    await expect(page.getByTestId('doc-save')).toBeDisabled();

    const marker = `Edited by the doc edit spec ${Math.random().toString(36).slice(2, 8)}.`;
    await typeAtEnd(page, `\n\n${marker}`);
    await expect(page.getByTestId('doc-save')).toBeEnabled();
    await expect(page.getByTestId('doc-tools')).toContainText('Unsaved changes');

    const reloaded = nextPageLoad(page);
    const put = waitForApi(page, 'PUT', `/api/doc/${doc.main}`);
    await pressSave(page);
    expect((await put).status()).toBe(200);

    // back to the preview at once (edit removed from the URL), the old HTML dimmed until the reload
    await expect(page).not.toHaveURL(/edit=1/);
    expect(readDataText(doc.main)).toContain(marker);
    await reloaded;
    // "Saved" survives the reload (the one-reload invariant is covered by tests/unit/doc-editor.test.ts)
    await expect(page.getByTestId('doc-status')).toHaveText('Saved');
    await expect(page.getByTestId('doc-editor')).toHaveCount(0);
    await expect(page.getByTestId('detail-content')).toContainText(marker);
    expect(errors).toEqual([]);
  });

  test('?edit=1 opens straight into the editor; Cancel leaves it', async ({ page, doc }) => {
    await page.goto(`/kb/${doc.name}?edit=1`);
    await expect(page.getByTestId('detail-content')).toBeHidden();
    await expect(page.getByTestId('doc-editor').locator('.monaco-editor')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('doc-view-edit')).toHaveAttribute('data-selected', 'true');
    await page.getByTestId('doc-cancel').click();
    await expect(page).not.toHaveURL(/edit=1/);
    await expect(page.getByTestId('detail-content')).toBeVisible();
  });

  test('leaving edit with unsaved changes asks first', async ({ page, doc }) => {
    await openEditor(page, `/kb/${doc.name}`);
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
    expect(readDataText(doc.main)).not.toContain('unsaved');
  });

  test('a sub-doc page edits its own file', async ({ page, doc }) => {
    await openEditor(page, doc.notePage);
    await expect(page.getByTestId('doc-tools')).toContainText('concepts/e2e-note.md');
    await expect(page.getByTestId('doc-editor').locator('.view-lines')).toContainText(
      'Original text.',
    );
    const reloaded = nextPageLoad(page);
    await typeAtEnd(page, 'Second paragraph.');
    await pressSave(page);
    await expect(page).not.toHaveURL(/edit=1/);
    await reloaded;
    await expect(page.getByTestId('detail-content')).toContainText('Second paragraph.');
    expect(readDataText(doc.note)).toContain('Second paragraph.');
  });

  test('frontmatter that fails validation is saved anyway and the findings are listed', async ({
    page,
    doc,
  }) => {
    await openEditor(page, doc.notePage);
    const editor = page.getByTestId('doc-editor');
    await editor.locator('.monaco-editor textarea').focus();
    await page.keyboard.press('Control+a');
    // no `type`: every concept needs one (okf rule); the save is never blocked by findings
    await page.keyboard.type('---\ndescription: No type here.\n---\n# E2E note\n\nAfter save.\n');
    const reloaded = nextPageLoad(page);
    const put = waitForApi(page, 'PUT', '/api/doc/');
    await pressSave(page);
    const response = await put;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { warnings: { message: string }[] };
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(readDataText(doc.note)).toContain('No type here.');

    await reloaded;
    await expect(page.getByTestId('doc-status')).toContainText('warning');
    const list = page.getByTestId('doc-warnings');
    await expect(list).toBeVisible();
    await expect(list).toContainText(body.warnings[0]?.message ?? '');
    await expect(page.getByTestId('detail-content')).toContainText('After save.');
  });
});

/** localStorage key of the draft of `kb/<name>/index.md` (src/stores/doc-editor.ts `docKey` + draft-backup.ts). */
const draftKey = (doc: DocEntry): string => `ctxman:draft:doc:${doc.main}`;

/** The persisted draft of index.md (null when none): what an unsaved reload would bring back. */
async function storedDraft(
  page: Page,
  doc: DocEntry,
): Promise<{ text: string; base: string } | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as { text: string; base: string });
  }, draftKey(doc));
}

/** Waits (inside the page, every animation frame) until the persisted draft of index.md contains `text`. */
async function draftHas(page: Page, doc: DocEntry, text: string): Promise<void> {
  await page.waitForFunction(
    ([key, want]) => {
      const raw = localStorage.getItem(key);
      return raw !== null && (JSON.parse(raw) as { text: string }).text.includes(want);
    },
    [draftKey(doc), text] as const,
  );
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
    doc,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await openEditor(page, `/kb/${doc.name}`);
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

  test('a selection becomes the link text', async ({ page, doc }) => {
    await openEditor(page, `/kb/${doc.name}`);
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
    doc,
  }) => {
    await openEditor(page, `/kb/${doc.name}`);
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

  test('`[[` and `](` complete entries; `ctxman:` completes a target', async ({ page, doc }) => {
    await openEditor(page, `/kb/${doc.name}`);
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
    doc,
  }) => {
    await openEditor(page, `/kb/${doc.name}`);
    await pasteAtEnd(
      page,
      '\n\nLinks gone wrong: [a](./e2e-missing-note.md) and [b](ctxman:idea/e2e-nope).\n',
    );
    // the paste has reached the model (and the editor is dirty) before the shortcut runs
    await expect(viewLines(page)).toContainText('ctxman:idea/e2e-nope');
    await expect(page.getByTestId('doc-save')).toBeEnabled();
    const reloaded = nextPageLoad(page);
    const put = waitForApi(page, 'PUT', `/api/doc/${doc.main}`);
    await pressSave(page);
    const response = await put;
    expect(response.status()).toBe(200);
    // link findings come back as `error` severity but are warnings: the save is never blocked
    const body = (await response.json()) as { warnings: { rule: string; severity: string }[] };
    expect(body.warnings.map((w) => w.rule).sort()).toEqual([
      'links/broken',
      'links/ctxman-target',
    ]);
    expect(readDataText(doc.main)).toContain('ctxman:idea/e2e-nope');

    await reloaded;
    await expect(page.getByTestId('doc-status')).toHaveText('Saved · 2 warnings');
    const list = page.getByTestId('doc-warnings');
    await expect(list).toContainText('links/broken');
    await expect(list).toContainText('links/ctxman-target');
    await expect(list.locator('li')).toHaveCount(2);
    // the reloaded preview draws both broken links dashed
    await expect(page.locator('[data-testid="detail-content"] a.cx-link--broken')).toHaveCount(2);
  });
});

test.describe('drafts survive a reload (no native prompt)', () => {
  test('a dirty editor reloads without a dialog and offers the draft back; Discard drops it', async ({
    page,
    doc,
  }) => {
    const dialogs = trackDialogs(page);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await openEditor(page, `/kb/${doc.name}`);
    await typeAtEnd(page, '\n\nDRAFT-LINE-ONE');
    await expect(page.getByTestId('doc-save')).toBeEnabled();
    await draftHas(page, doc, 'DRAFT-LINE-ONE');

    await page.reload();
    await expect(page.getByTestId('doc-editor').locator('.monaco-editor')).toBeVisible({
      timeout: 15_000,
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
    expect(await storedDraft(page, doc)).toBeNull();
    expect(readDataText(doc.main)).not.toContain('DRAFT-LINE-ONE');
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a draft whose file changed on disk is restored with a warning; saving overwrites the disk text', async ({
    page,
    doc,
  }) => {
    const dialogs = trackDialogs(page);
    await openEditor(page, `/kb/${doc.name}`);
    await typeAtEnd(page, '\n\nSTALE-DRAFT-LINE');
    await draftHas(page, doc, 'STALE-DRAFT-LINE');

    writeFileSync(dataPath(doc.main), `${readDataText(doc.main)}\nDISK-EDIT-LINE\n`);
    bumpMtime(doc.main); // the mtime must differ from the loaded one
    await page.reload();

    const banner = page.getByTestId('doc-draft-restored');
    await expect(banner).toBeVisible({ timeout: 15_000 });
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
    expect(await storedDraft(page, doc)).toBeNull();
  });

  test('a preview with a stored draft offers "Resume editing"; Cancel + Discard removes the offer', async ({
    page,
    doc,
  }) => {
    const dialogs = trackDialogs(page);
    await openEditor(page, `/kb/${doc.name}`);
    await typeAtEnd(page, '\n\nRESUME-DRAFT-LINE');
    await draftHas(page, doc, 'RESUME-DRAFT-LINE');

    await page.goto(`/kb/${doc.name}`);
    expect(dialogs).toEqual([]);
    const available = page.getByTestId('doc-draft-available');
    await expect(available).toBeVisible({ timeout: 15_000 });
    await expect(available).toContainText('Unsaved changes to this file');
    await expect(page.getByTestId('doc-draft-restored')).toHaveCount(0);

    await page.getByTestId('doc-draft-resume').click();
    await expect(page).toHaveURL(/edit=1/);
    await expect(page.getByTestId('doc-draft-restored')).toBeVisible({ timeout: 15_000 });
    await expect(available).toHaveCount(0);

    await page.getByTestId('doc-cancel').click();
    await page.getByTestId('doc-discard-dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page).not.toHaveURL(/edit=1/);
    await expect(available).toHaveCount(0);
    expect(await storedDraft(page, doc)).toBeNull();
  });

  test('a saved draft is gone: the reloaded page has no draft offer', async ({ page, doc }) => {
    await openEditor(page, `/kb/${doc.name}`);
    await typeAtEnd(page, '\n\nSAVED-DRAFT-LINE');
    await draftHas(page, doc, 'SAVED-DRAFT-LINE');
    const reloaded = nextPageLoad(page);
    await pressSave(page);
    await expect(page).not.toHaveURL(/edit=1/);
    expect(await storedDraft(page, doc)).toBeNull();
    await reloaded;
    await expect(page.getByTestId('doc-status')).toBeVisible();
    await expect(page.getByTestId('doc-draft-available')).toHaveCount(0);
    expect(readDataText(doc.main)).toContain('SAVED-DRAFT-LINE');
  });
});

test.describe('conflicts', () => {
  /** The file changes on disk behind the editor's back; the mtime is bumped so it differs from the loaded one. */
  function changeOnDisk(rel: string, text: string): void {
    writeFileSync(dataPath(rel), text);
    bumpMtime(rel);
  }

  test('Save over a changed file opens the dialog; "load disk version" takes the disk text', async ({
    page,
    doc,
  }) => {
    await openEditor(page, doc.notePage);
    await typeAtEnd(page, ' mine');
    changeOnDisk(doc.note, `${NOTE_TEXT}\nDisk wins ${doc.name}.\n`);

    await pressSave(page);
    await expect(page.getByTestId('doc-conflict-dialog')).toBeVisible();
    await expect(page.getByTestId('doc-tools')).toContainText('Changed on disk');
    await page.getByTestId('doc-conflict-reload').click();
    await expect(page.getByTestId('doc-conflict-dialog')).toHaveCount(0);
    await expect(page.getByTestId('doc-editor').locator('.view-lines')).toContainText(
      `Disk wins ${doc.name}.`,
    );
    await expect(page.getByTestId('doc-editor').locator('.view-lines')).not.toContainText('mine');
    await expect(page.getByTestId('doc-save')).toBeDisabled();
    expect(readDataText(doc.note)).toContain(`Disk wins ${doc.name}.`);
  });

  test('"Keep editing" closes the dialog and keeps the draft; "Overwrite" saves it', async ({
    page,
    doc,
  }) => {
    await openEditor(page, doc.notePage);
    await typeAtEnd(page, ' my-overwrite');
    changeOnDisk(doc.note, `${NOTE_TEXT}\nOther writer.\n`);

    await pressSave(page);
    await expect(page.getByTestId('doc-conflict-dialog')).toBeVisible();
    await page.getByTestId('doc-conflict-cancel').click();
    await expect(page.getByTestId('doc-conflict-dialog')).toHaveCount(0);
    await expect(page.getByTestId('doc-editor').locator('.view-lines')).toContainText(
      'my-overwrite',
    );
    expect(readDataText(doc.note)).not.toContain('my-overwrite');

    await pressSave(page);
    await expect(page.getByTestId('doc-conflict-dialog')).toBeVisible();
    const put = waitForApi(page, 'PUT', '/api/doc/');
    await page.getByTestId('doc-conflict-overwrite').click();
    expect((await put).status()).toBe(200);
    await expect(page).not.toHaveURL(/edit=1/);
    const saved = readDataText(doc.note);
    expect(saved).toContain('my-overwrite');
    expect(saved).not.toContain('Other writer.');
  });
});
