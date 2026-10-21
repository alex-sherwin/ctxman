// "Copy as JIRA Markup": the three markdown Copy buttons are split buttons (`[ Copy | v ]`). The left part keeps the
// plain Copy (test ids `doc-copy`, `inflate-copy`, `snippet-copy`, `data-copied`); the arrow `<base>-more` opens the
// menu `<base>-menu` whose one item `<base>-jira` copies `markdownToJira(markdown)` (src/lib/jira-markup.ts) and
// confirms on the LEFT part. Three places, two implementations:
//   - the okf / skill doc toolbar (React: DocEditor -> MarkdownCopyButton -> kit CopySplitButton, a react-aria Menu),
//   - the Inflate preview (React, the same component; disabled until there is markdown),
//   - the snippet page Markdown panel (SSR src/components/MarkdownCopyButton.astro driven by src/scripts/shell.ts: an
//     HTML `popover` moved to <body>, keyboard handled by hand).
// What lands on the clipboard is compared with `markdownToJira(<the markdown>)` computed here, in the test process, from
// the data copy on disk (or the render response), so the page's conversion is checked against the converter itself.
// The converter loads lazily (src/lib/copy-formats.ts): a request listener proves it is not fetched at page load and is
// fetched once the arrow is hovered, focused or opened. Chromium rejects clipboard writes from an unfocused page, which
// the app swallows: every test brings the page to front first. All reads of the seed corpus are read-only; the one
// editing test works on its own entry (like doc-edit.spec.ts) and never saves.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { markdownToJira } from '../../src/lib/jira-markup.ts';
import { expect, test } from './fixtures.ts';
import { API, dataPath, gate, readDataText, readYaml, SEED_RECIPE, uniqueName } from './helpers.ts';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const MORE_LABEL = 'More copy options';
const JIRA_LABEL = 'Copy as JIRA Markup';

/** The file's text without its frontmatter block, as the doc toolbar copies it. */
const bodyOnDisk = (rel: string): string =>
  readDataText(rel).replace(/^---\n[\s\S]*?\n---\n\s*/, '');

async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Collects the URL of every request for the converter chunk (`jira-markup.<hash>.js`), from now on. */
function trackConverterRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('jira-markup')) urls.push(request.url());
  });
  return urls;
}

/** The live status that follows a Copy button (the kit `CopyButton` and `CopyButton.astro` both put it right after). */
function statusOf(page: Page, testId: string): Locator {
  return page.locator(`[data-testid="${testId}"] + [role="status"]`);
}

// ---------------------------------------------------------------------------------------------------------------
// Doc toolbar (React)
// ---------------------------------------------------------------------------------------------------------------

test.describe('doc toolbar', () => {
  const DOC_PAGE = '/kb/ctxman/doc/concepts/adding-entries';
  const DOC_FILE = 'kb/ctxman/concepts/adding-entries.md';

  /** Opens the seed concept doc and focuses the page so a clipboard write is accepted. */
  async function openDoc(page: Page, route = DOC_PAGE): Promise<void> {
    await page.goto(route);
    await expect(page.getByTestId('doc-copy-more')).toBeVisible();
    await page.bringToFront();
  }

  test('the arrow opens the menu; "Copy as JIRA Markup" copies the converted body and confirms on Copy', async ({
    page,
  }) => {
    await openDoc(page);
    const copy = page.getByTestId('doc-copy');
    const more = page.getByTestId('doc-copy-more');
    const menu = page.getByTestId('doc-copy-menu');
    const item = page.getByTestId('doc-copy-jira');

    // the left part is the old Copy, the arrow sits right of it
    await expect(copy).toHaveAccessibleName('Copy markdown');
    await expect(more).toHaveAccessibleName(MORE_LABEL);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
    const copyBox = (await copy.boundingBox())!;
    const moreBox = (await more.boundingBox())!;
    expect(moreBox.x).toBeGreaterThanOrEqual(copyBox.x + copyBox.width - 1);

    await more.click();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAccessibleName(MORE_LABEL);
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitem')).toHaveText([JIRA_LABEL]);
    await expect(item).toBeFocused();

    await item.click();
    await expect(copy).toHaveAttribute('data-copied', '');
    await expect(statusOf(page, 'doc-copy')).toHaveText('Copied as JIRA Markup');
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');

    const body = bodyOnDisk(DOC_FILE);
    const text = await clipboardText(page);
    expect(text).toBe(markdownToJira(body));
    expect(text).not.toBe(body);
    // Jira markers where the markdown has a heading, a fence and inline code
    expect(text).toContain('h1. Adding entries');
    expect(text).toContain('{code:bash}');
    expect(text).toContain('{{');
    expect(text).not.toContain('# Adding entries\n\nAlways');
    expect(text).not.toContain('```');
  });

  test('the plain Copy part still copies the markdown, and says "Copied"', async ({ page }) => {
    await openDoc(page);
    await page.getByTestId('doc-copy').click();
    await expect(page.getByTestId('doc-copy')).toHaveAttribute('data-copied', '');
    await expect(statusOf(page, 'doc-copy')).toHaveText('Copied');
    // the menu stayed closed: the plain Copy never opens it
    await expect(page.getByTestId('doc-copy-menu')).toBeHidden();
    const body = bodyOnDisk(DOC_FILE);
    const text = await clipboardText(page);
    expect(text).toBe(body);
    expect(text).toContain('# Adding entries');
    expect(text).toContain('```bash');
    expect(text).not.toContain('h1. ');
  });

  test('Enter on the focused arrow opens the menu on its item; Escape closes it and returns focus to the arrow', async ({
    page,
  }) => {
    await openDoc(page);
    const more = page.getByTestId('doc-copy-more');
    const menu = page.getByTestId('doc-copy-menu');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('doc-copy-jira')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();
    // nothing was copied
    await expect(page.getByTestId('doc-copy')).not.toHaveAttribute('data-copied', '');
  });

  test('ArrowDown on the arrow opens the menu; Enter on the item copies as Jira', async ({
    page,
  }) => {
    await openDoc(page);
    const more = page.getByTestId('doc-copy-more');
    await more.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('doc-copy-menu')).toBeVisible();
    await expect(page.getByTestId('doc-copy-jira')).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('doc-copy')).toHaveAttribute('data-copied', '');
    await expect(statusOf(page, 'doc-copy')).toHaveText('Copied as JIRA Markup');
    await expect(page.getByTestId('doc-copy-menu')).toBeHidden();
    await expect(more).toBeFocused();
    expect(await clipboardText(page)).toBe(markdownToJira(bodyOnDisk(DOC_FILE)));
  });

  test('a skill page converts SKILL.md without its frontmatter', async ({ page }) => {
    await openDoc(page, '/skill/ctxman-add-entry');
    await page.getByTestId('doc-copy-more').click();
    await page.getByTestId('doc-copy-jira').click();
    await expect(page.getByTestId('doc-copy')).toHaveAttribute('data-copied', '');
    const body = bodyOnDisk('skill/ctxman-add-entry/SKILL.md');
    const text = await clipboardText(page);
    expect(text).toBe(markdownToJira(body));
    expect(text).not.toContain('allowed-tools');
    expect(text).not.toContain('name: ctxman-add-entry');
    expect(text).toMatch(/^h1\. /);
  });

  test('the converter chunk is not requested at page load: hovering the arrow starts it, opening the menu uses it', async ({
    page,
  }) => {
    const requests = trackConverterRequests(page);
    await openDoc(page);
    // the page and the island are up, and so is a plain Copy: none of it needs the converter
    await page.getByTestId('doc-copy').click();
    await expect(page.getByTestId('doc-copy')).toHaveAttribute('data-copied', '');
    expect(requests).toEqual([]);

    const loaded = page.waitForRequest((r) => r.url().includes('jira-markup'));
    await page.getByTestId('doc-copy-more').hover();
    expect((await loaded).url()).toContain('jira-markup');
    await expect(page.getByTestId('doc-copy-menu')).toBeHidden();

    await page.getByTestId('doc-copy-more').click();
    await page.getByTestId('doc-copy-jira').click();
    await expect(page.getByTestId('doc-copy')).toHaveAttribute('data-copied', '');
    expect(await clipboardText(page)).toBe(markdownToJira(bodyOnDisk(DOC_FILE)));
    // one fetch, then the module is cached
    expect(requests).toHaveLength(1);
  });

  test('opening the menu loads the converter when the pointer never hovered the arrow (keyboard)', async ({
    page,
  }) => {
    const requests = trackConverterRequests(page);
    await openDoc(page);
    expect(requests).toEqual([]);
    const loaded = page.waitForRequest((r) => r.url().includes('jira-markup'));
    await page.getByTestId('doc-copy-more').focus();
    await loaded;
    expect(requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Doc toolbar while editing (React, Monaco): its own entry, never saved
// ---------------------------------------------------------------------------------------------------------------

test.describe('doc toolbar while editing', () => {
  const NOTE_TEXT =
    '---\ntype: Concept\ndescription: A concept for the Jira copy spec.\n---\n# E2E note\n\nOriginal text.\n';

  const editTest = test.extend<{ doc: { name: string; note: string; notePage: string } }>({
    doc: async ({ request }, use) => {
      const name = uniqueName('e2e-copyjira');
      const response = await request.post(`${API}/entry/kb`, {
        data: { name, title: 'E2E copy jira', description: 'Created by the copy-jira spec' },
      });
      expect(response.status()).toBe(201);
      const file = `kb/${name}/concepts/e2e-note.md`;
      mkdirSync(path.join(dataPath(`kb/${name}`), 'concepts'), { recursive: true });
      writeFileSync(dataPath(file), NOTE_TEXT);
      try {
        await use({ name, note: file, notePage: `/kb/${name}/doc/concepts/e2e-note` });
      } finally {
        rmSync(dataPath(`kb/${name}`), { recursive: true, force: true });
      }
    },
  });

  editTest(
    'copies the unsaved draft as Jira, without the discard dialog and without saving',
    async ({ page, doc }) => {
      await page.goto(doc.notePage);
      await expect(page.getByTestId('doc-tools')).toBeVisible();
      await page.getByTestId('doc-view-edit').click();
      await expect(page).toHaveURL(/[?&]edit=1/);
      const editor = page.getByTestId('doc-editor');
      await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });

      // a synthetic paste at the very end inserts the lines verbatim (typing would auto-indent and complete)
      const added = '\n## Draft heading\n\nSome **bold** text and `inline` code.\n';
      const textarea = editor.locator('.monaco-editor textarea');
      await textarea.focus();
      await page.keyboard.press('Control+End');
      await textarea.evaluate((el, value) => {
        const data = new DataTransfer();
        data.setData('text/plain', value);
        el.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, added);
      await expect(page.getByTestId('doc-save')).toBeEnabled();
      await expect(editor.locator('.view-lines')).toContainText('Draft heading');

      await page.bringToFront();
      await page.getByTestId('doc-copy-more').click();
      await expect(page.getByTestId('doc-copy-menu')).toBeVisible();
      await page.getByTestId('doc-copy-jira').click();
      await expect(page.getByTestId('doc-copy')).toHaveAttribute('data-copied', '');
      await expect(statusOf(page, 'doc-copy')).toHaveText('Copied as JIRA Markup');

      const draftBody = '# E2E note\n\nOriginal text.\n' + added;
      const text = await clipboardText(page);
      expect(text).toBe(markdownToJira(draftBody));
      expect(text).toContain('h1. E2E note');
      expect(text).toContain('h2. Draft heading');
      expect(text).toContain('*bold*');
      expect(text).toContain('{{inline}}');
      expect(text).not.toContain('type: Concept');
      expect(text).not.toContain('---');

      // the toolbar stays in edit mode: no leave dialog, still dirty, nothing written to disk
      await expect(page.getByTestId('doc-discard-dialog')).toHaveCount(0);
      await expect(page).toHaveURL(/[?&]edit=1/);
      await expect(editor.locator('.monaco-editor')).toBeVisible();
      await expect(page.getByTestId('doc-save')).toBeEnabled();
      expect(readDataText(doc.note)).toBe(NOTE_TEXT);

      // and the plain Copy of the same draft is still the markdown
      await page.getByTestId('doc-copy').click();
      await expect(statusOf(page, 'doc-copy')).toHaveText('Copied');
      expect(await clipboardText(page)).toBe(draftBody);
      await expect(page.getByTestId('doc-discard-dialog')).toHaveCount(0);
    },
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Inflate preview (React)
// ---------------------------------------------------------------------------------------------------------------

test.describe('inflate preview', () => {
  const PREVIEW = `/inflate?recipe=${SEED_RECIPE}&view=preview`;

  /**
   * Opens the preview of the seed recipe and returns the document it shows. The recipe has an output directory, so the
   * preview is the dry run's relative-path document (`POST /api/inflate/plan`, `document.markdown`), not the render of
   * `POST /api/inflate/render`; the page asks for it once per load.
   */
  async function openPreview(page: Page): Promise<string> {
    const planned = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/inflate/plan',
    );
    await page.goto(PREVIEW);
    await expect(page.getByTestId('inflate-render-status')).toHaveAttribute('data-kind', 'ready');
    await expect(page.getByTestId('inflate-copy')).toBeEnabled();
    await page.bringToFront();
    const plan = (await (await planned).json()) as { document: { markdown: string } };
    expect(plan.document.markdown.startsWith(`# ${SEED_RECIPE}\n`)).toBe(true);
    return plan.document.markdown;
  }

  test('the whole split button is disabled until the document is rendered', async ({ page }) => {
    const release = gate();
    await page.route('**/api/inflate/plan', async (route) => {
      await release.wait;
      await route.continue();
    });
    await page.goto(PREVIEW);
    const copy = page.getByTestId('inflate-copy');
    const more = page.getByTestId('inflate-copy-more');
    await expect(copy).toBeVisible();
    await expect(more).toBeVisible();
    await expect(copy).toBeDisabled();
    await expect(more).toBeDisabled();
    await expect(page.getByTestId('inflate-render-status')).not.toHaveAttribute(
      'data-kind',
      'ready',
    );

    release.open();
    await expect(page.getByTestId('inflate-render-status')).toHaveAttribute('data-kind', 'ready');
    await expect(copy).toBeEnabled();
    await expect(more).toBeEnabled();
    await more.click();
    await expect(page.getByTestId('inflate-copy-menu')).toBeVisible();
    await expect(page.getByTestId('inflate-copy-jira')).toHaveText(JIRA_LABEL);
  });

  test('"Copy as JIRA Markup" copies the rendered document converted; Copy still copies it as is', async ({
    page,
  }) => {
    const markdown = await openPreview(page);
    const copy = page.getByTestId('inflate-copy');
    const more = page.getByTestId('inflate-copy-more');
    await expect(more).toHaveAccessibleName(MORE_LABEL);

    await more.click();
    await expect(page.getByTestId('inflate-copy-menu')).toBeVisible();
    await expect(page.getByTestId('inflate-copy-jira')).toBeFocused();
    await page.getByTestId('inflate-copy-jira').click();
    await expect(copy).toHaveAttribute('data-copied', '');
    await expect(statusOf(page, 'inflate-copy')).toHaveText('Copied as JIRA Markup');
    await expect(page.getByTestId('inflate-copy-menu')).toBeHidden();
    const jira = await clipboardText(page);
    expect(jira).toBe(markdownToJira(markdown));
    expect(jira.startsWith(`h1. ${SEED_RECIPE}\n`)).toBe(true);
    expect(jira).not.toBe(markdown);

    // the plain Copy after it: the markdown again (and "Copied")
    await expect(copy).not.toHaveAttribute('data-copied', '');
    await copy.click();
    await expect(copy).toHaveAttribute('data-copied', '');
    await expect(statusOf(page, 'inflate-copy')).toHaveText('Copied');
    expect(await clipboardText(page)).toBe(markdown);
  });

  test('keyboard: ArrowDown on the arrow opens the menu, Enter on the item copies as Jira', async ({
    page,
  }) => {
    const markdown = await openPreview(page);
    await page.getByTestId('inflate-copy-more').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('inflate-copy-menu')).toBeVisible();
    await expect(page.getByTestId('inflate-copy-jira')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inflate-copy')).toHaveAttribute('data-copied', '');
    expect(await clipboardText(page)).toBe(markdownToJira(markdown));
  });

  test('the converter chunk is not requested at page load, but is once the menu opens', async ({
    page,
  }) => {
    const requests = trackConverterRequests(page);
    await openPreview(page);
    expect(requests).toEqual([]);
    const loaded = page.waitForRequest((r) => r.url().includes('jira-markup'));
    await page.getByTestId('inflate-copy-more').click();
    await expect(page.getByTestId('inflate-copy-menu')).toBeVisible();
    await loaded;
    await page.getByTestId('inflate-copy-jira').click();
    await expect(page.getByTestId('inflate-copy')).toHaveAttribute('data-copied', '');
    expect(requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Snippet page (SSR markup + src/scripts/shell.ts)
// ---------------------------------------------------------------------------------------------------------------

test.describe('snippet page', () => {
  const SNIPPET = 'conventional-commits';
  const snippetMarkdown = (): string =>
    (readYaml(`snippet/${SNIPPET}.yaml`) as { markdown: string }).markdown;

  async function openSnippet(page: Page): Promise<void> {
    await page.goto(`/snippet/${SNIPPET}`);
    await expect(page.getByTestId('snippet-copy-more')).toBeVisible();
    await page.bringToFront();
  }

  test('the arrow opens the menu under it; "Copy as JIRA Markup" copies the converted markdown and confirms on Copy', async ({
    page,
  }) => {
    await openSnippet(page);
    const copy = page.getByTestId('snippet-copy');
    const more = page.getByTestId('snippet-copy-more');
    const menu = page.getByTestId('snippet-copy-menu');
    const item = page.getByTestId('snippet-copy-jira');

    await expect(copy).toHaveAccessibleName('Copy markdown');
    await expect(more).toHaveAccessibleName(MORE_LABEL);
    await expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();

    await more.click();
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toHaveAccessibleName(MORE_LABEL);
    await expect(item).toHaveText(JIRA_LABEL);
    // the first item takes focus once the menu is placed (same frame), so the geometry below is final
    await expect(item).toBeFocused();
    // portaled to <body>, under the arrow, right edges aligned
    await expect(page.locator('body > [data-copy-popover]')).toHaveCount(1);
    const moreBox = (await more.boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.y).toBeGreaterThanOrEqual(moreBox.y + moreBox.height);
    expect(Math.abs(menuBox.x + menuBox.width - (moreBox.x + moreBox.width))).toBeLessThanOrEqual(
      2,
    );

    await item.click();
    await expect(copy).toHaveAttribute('data-copied', '');
    await expect(statusOf(page, 'snippet-copy')).toHaveText('Copied as JIRA Markup');
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');

    const markdown = snippetMarkdown();
    const text = await clipboardText(page);
    expect(text).toBe(markdownToJira(markdown));
    expect(text).not.toBe(markdown);
    // the source has inline code and a link: Jira's `{{...}}` and `[text|url]`
    expect(markdown).toContain('`feat`');
    expect(text).toContain('{{feat}}');
    expect(text).toContain('[Conventional Commit|https://www.conventionalcommits.org/]');
    expect(text).not.toContain('`');
  });

  test('the plain Copy part still copies the markdown, and says "Copied"', async ({ page }) => {
    await openSnippet(page);
    await page.getByTestId('snippet-copy').click();
    await expect(page.getByTestId('snippet-copy')).toHaveAttribute('data-copied', '');
    await expect(statusOf(page, 'snippet-copy')).toHaveText('Copied');
    await expect(page.getByTestId('snippet-copy-menu')).toBeHidden();
    expect(await clipboardText(page)).toBe(snippetMarkdown());
  });

  test('ArrowDown on the arrow opens the menu on its item; Escape closes it and returns focus to the arrow', async ({
    page,
  }) => {
    await openSnippet(page);
    const more = page.getByTestId('snippet-copy-more');
    const menu = page.getByTestId('snippet-copy-menu');
    await more.focus();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('snippet-copy-jira')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();
    await expect(page.getByTestId('snippet-copy')).not.toHaveAttribute('data-copied', '');

    // ArrowUp opens it too (on the last item, which is the only one)
    await page.keyboard.press('ArrowUp');
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('snippet-copy-jira')).toBeFocused();
  });

  test('ArrowDown opens, Enter on the item copies as Jira and closes the menu', async ({
    page,
  }) => {
    await openSnippet(page);
    const more = page.getByTestId('snippet-copy-more');
    await more.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('snippet-copy-jira')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('snippet-copy')).toHaveAttribute('data-copied', '');
    await expect(statusOf(page, 'snippet-copy')).toHaveText('Copied as JIRA Markup');
    await expect(page.getByTestId('snippet-copy-menu')).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();
    expect(await clipboardText(page)).toBe(markdownToJira(snippetMarkdown()));
  });

  test('Enter on the arrow opens the menu natively; Space on the item copies as Jira', async ({
    page,
  }) => {
    await openSnippet(page);
    const more = page.getByTestId('snippet-copy-more');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('snippet-copy-menu')).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('snippet-copy-jira')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('snippet-copy')).toHaveAttribute('data-copied', '');
    await expect(page.getByTestId('snippet-copy-menu')).toBeHidden();
    expect(await clipboardText(page)).toBe(markdownToJira(snippetMarkdown()));
  });

  test('Tab closes the menu and moves on from the arrow; an outside click closes it too', async ({
    page,
  }) => {
    await openSnippet(page);
    const more = page.getByTestId('snippet-copy-more');
    const menu = page.getByTestId('snippet-copy-menu');
    await more.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('snippet-copy-jira')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    // focus moved on to the next control of the panel heading, not back into the menu
    await expect(page.getByTestId('snippet-edit-markdown')).toBeFocused();
    await expect(page.getByTestId('snippet-copy')).not.toHaveAttribute('data-copied', '');

    await more.click();
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.cx-snippet__body').click({ position: { x: 4, y: 4 } });
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('snippet-copy')).not.toHaveAttribute('data-copied', '');
  });

  test('the converter chunk is not requested at page load: focusing the arrow starts it, choosing the item uses it', async ({
    page,
  }) => {
    const requests = trackConverterRequests(page);
    await openSnippet(page);
    // the plain Copy (shell.ts) does not need the converter
    await page.getByTestId('snippet-copy').click();
    await expect(page.getByTestId('snippet-copy')).toHaveAttribute('data-copied', '');
    expect(requests).toEqual([]);

    const loaded = page.waitForRequest((r) => r.url().includes('jira-markup'));
    await page.getByTestId('snippet-copy-more').focus();
    expect((await loaded).url()).toContain('jira-markup');
    await expect(page.getByTestId('snippet-copy-menu')).toBeHidden();

    await page.keyboard.press('ArrowDown');
    await page.getByTestId('snippet-copy-jira').click();
    await expect(statusOf(page, 'snippet-copy')).toHaveText('Copied as JIRA Markup');
    expect(await clipboardText(page)).toBe(markdownToJira(snippetMarkdown()));
    expect(requests).toHaveLength(1);
  });

  test('opening the menu alone loads the converter: a script click on the arrow (no hover, no focus)', async ({
    page,
  }) => {
    const requests = trackConverterRequests(page);
    await openSnippet(page);
    expect(requests).toEqual([]);
    // Playwright's own click hovers first, which already starts the load: click from the page so only the open can
    const loaded = page.waitForRequest((r) => r.url().includes('jira-markup'));
    await page.getByTestId('snippet-copy-more').evaluate((el: HTMLElement) => el.click());
    await expect(page.getByTestId('snippet-copy-menu')).toBeVisible();
    await loaded;
    await page.getByTestId('snippet-copy-jira').click();
    await expect(page.getByTestId('snippet-copy')).toHaveAttribute('data-copied', '');
    expect(requests).toHaveLength(1);
  });
});
